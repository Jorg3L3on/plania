// PLA-I43-1: Send to Plania (spec §6.4, §7.3, §11, D3, D7). Throwaway test DB only: nothing spawns, the PO runs are
// queued agent_runs rows this test moves by hand, and no claude or live database is touched.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_TZ = "America/Mexico_City";
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { setBriefApiDepsForTests } = await import("../src/api/brief.js");
const plan = await import("../src/brief/plan.js");
const { runAsistente, resetAsistenteForTests } = await import("../src/runner/asistente.js");
const { saveBriefSettings } = await import("../src/brief/settings.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
const ENV = { PLANIA_TZ: "America/Mexico_City", PLANIA_HOME_PROJECT: "plania" } as NodeJS.ProcessEnv;
setBriefApiDepsForTests({ env: ENV, liveRuns: () => [] });

const idea = (code: string, app: string, title: string) => ({ id: `d|${app}|${code.toLowerCase().padEnd(12, "0")}`, code, app, title, why: `Why ${title}.`, source: app === "cross" ? "Plania" : app, flags: [] });
const IDEAS = [
  idea("W1", "workia", "Renewal board"),
  idea("W2", "workia", "Contract reminders"),
  idea("W3", "workia", "Invoice export"),
  idea("W4", "workia", "Team roles"),
  idea("Z3", "zigzag", "Route history"),
  idea("F1", "filmia", "Shot list"),
  idea("X1", "cross", "One login for every app"),
];

const cookie = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
const post = (body: unknown) => app.request("/api/brief/plan", { method: "POST", headers: { ...cookie(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
const progress = async (id: string) => (await (await app.request(`/api/brief/plan/${id}`, { headers: cookie() })).json()) as Awaited<ReturnType<typeof plan.planProgress>>;
type Sent = Awaited<ReturnType<typeof plan.sendToPlania>>;

let briefId = "";
async function newBrief(): Promise<string> {
  const data = { version: 1, ideas: IDEAS, items: [], apps: [], language: "en", mode: "full" };
  const r = await raw.query(`insert into morning_briefs (local_date, trigger, mode, data) values ('2026-11-14', 'manual', 'full', $1::jsonb) returning id`, [JSON.stringify(data)]);
  return r.rows[0].id;
}
const messages = async (slug: string) =>
  (await raw.query(`select m.body, m.author_agent, m.links from thread_messages m join threads t on t.id = m.thread_id join projects p on p.id = t.project_id where p.slug = $1 order by m.at`, [slug])).rows as { body: string; author_agent: string; links: { kind: string; ref: string }[] }[];
const runsOf = async (agent: string) => (await raw.query(`select r.id, r.status, r.summary, r.task_key from agent_runs r join agents a on a.id = r.agent_id where a.slug = $1 order by r.queued_at`, [agent])).rows as { id: string; status: string; summary: string; task_key: string | null }[];
const endRun = (id: string, status = "ok") => raw.query(`update agent_runs set status = $2, started_at = now(), ended_at = now() where id = $1`, [id, status]);

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  await raw.query(`insert into projects (slug, title, key_prefix) values ('plania', 'Plania', 'PLA')`);
  // po-workia and po-plania are their project's team; po-zigzag is a company-level row found by its slug (before 0041).
  for (const [slug, project] of [["po-workia", "workia"], ["po-plania", "plania"], ["po-zigzag", null]] as const) {
    await raw.query(
      `insert into agents (slug, name, role, kind, adapter, adapter_config, project_id) values ($1, $1, 'product-owner', 'bot', 'claude_code', '{"command_env":"CLAUDE_CODE_BIN"}'::jsonb, (select id from projects where slug = $2))`,
      [slug, project],
    );
  }
  await saveBriefSettings(db, { enabled: false, github_mode: "off" });
});

beforeEach(async () => {
  await raw.query(`delete from brief_plan_requests; delete from morning_briefs; delete from agent_runs; delete from thread_messages`);
  await raw.query(`update projects set runs_paused = false`);
  await raw.query(`insert into runner_settings (id) values (1) on conflict (id) do nothing`);
  await raw.query(`update runner_settings set company_paused = false`);
  briefId = await newBrief();
});

after(async () => {
  setBriefApiDepsForTests({});
  await raw.end();
});

test("groupCodes: W, Z and X ideas by project, X to the home project, runs of at most 3", () => {
  const groups = plan.groupCodes(IDEAS as never, ["W1", "Z3", "W2", "X1"], "plania");
  assert.deepEqual(
    groups.map((g) => [g.slug, g.codes]),
    [
      ["workia", ["W1", "W2"]],
      ["zigzag", ["Z3"]],
      ["plania", ["X1"]],
    ],
  );
  const big = plan.groupCodes(IDEAS as never, ["W1", "W2", "W3", "W4"], "plania");
  assert.deepEqual(big.map((g) => g.codes), [["W1", "W2", "W3"], ["W4"]]);
  assert.throws(() => plan.groupCodes(IDEAS as never, ["W9"], "plania"), /UNKNOWN_CODES/);
  assert.deepEqual(plan.normalizeCodes([" w1", "Z3", "w1"]), ["W1", "Z3"]);
});

test("check 1: W1 Z3 X1 posts in the workia, zigzag and plania threads and queues po-workia, po-zigzag, po-plania", async () => {
  const res = await post({ brief_id: briefId, codes: ["W1", "Z3", "X1"] });
  assert.equal(res.status, 202);
  const out = (await res.json()) as Sent;
  assert.deepEqual(
    out.targets.map((t) => [t.slug, t.po_agent, t.codes, t.state]),
    [
      ["workia", "po-workia", ["W1"], "queued"],
      ["zigzag", "po-zigzag", ["Z3"], "queued"],
      ["plania", "po-plania", ["X1"], "queued"],
    ],
  );
  assert.equal(out.runs, 3);
  assert.deepEqual(out.estimate_min, [30, 75]);
  for (const [slug, po, code] of [["workia", "po-workia", "W1"], ["zigzag", "po-zigzag", "Z3"], ["plania", "po-plania", "X1"]] as const) {
    const msgs = await messages(slug);
    assert.equal(msgs.length, 1, slug);
    assert.match(msgs[0]!.body, /^## Plan these ideas \(from the Morning brief, 2026-11-14\)/);
    assert.match(msgs[0]!.body, new RegExp(`### ${code}: `));
    assert.equal(msgs[0]!.author_agent, "asistente");
    assert.deepEqual(msgs[0]!.links.map((l) => [l.kind, l.ref]), [["brief_plan", out.request_id]]);
    const runs = await runsOf(po);
    assert.equal(runs.length, 1, po);
    assert.equal(runs[0]!.status, "queued");
    assert.equal(runs[0]!.task_key, null);
    assert.match(runs[0]!.summary, new RegExp(`brief plan ${out.request_id}: the owner chose ideas ${code} in the Morning brief`));
    assert.ok(runs[0]!.summary.length <= 500);
  }
  assert.equal((await messages("filmia")).length, 0);
  const p = await progress(out.request_id);
  assert.equal(p.status, "open");
  assert.deepEqual(p.ideas.map((i) => [i.code, i.slug, i.project, i.state]), [["W1", "workia", "Workia", "queued"], ["Z3", "zigzag", "Zigzag", "queued"], ["X1", "plania", "Plania", "queued"]]);
  assert.equal(p.targets[0]!.run?.status, "queued");
  // The page finds this brief's request after a reload.
  const latest = (await (await app.request("/api/brief/latest", { headers: cookie() })).json()) as { plan_id: string };
  assert.equal(latest.plan_id, out.request_id);
});

test("check 2: one wake per project, at most 3 ideas per run, a follow-up wake for the rest once the run ends", async () => {
  const out = await plan.sendToPlania(db, { briefId, codes: ["W1", "W2", "W3", "W4"] }, { env: ENV });
  assert.deepEqual(out.targets.map((t) => [t.codes, t.state]), [[["W1", "W2", "W3"], "queued"], [["W4"], "queued"]]);
  assert.equal(out.runs, 2);
  assert.deepEqual(out.estimate_min, [20, 50]);
  let runs = await runsOf("po-workia");
  assert.equal(runs.length, 1, "one wake for the first three");
  assert.match(runs[0]!.summary, /ideas W1, W2, W3 in/);
  assert.equal((await messages("workia")).length, 1);
  assert.equal(out.targets[1]!.note, "after the earlier run");

  // Ticks while the first run is queued or running change nothing.
  await plan.resumeWaiting(db);
  await raw.query(`update agent_runs set status = 'running', started_at = now() where id = $1`, [runs[0]!.id]);
  await plan.resumeWaiting(db);
  assert.equal((await runsOf("po-workia")).length, 1);
  assert.equal((await progress(out.request_id)).targets[0]!.state, "running");

  await endRun(runs[0]!.id);
  const tick = await plan.resumeWaiting(db);
  assert.equal(tick.posted, 1);
  runs = await runsOf("po-workia");
  assert.equal(runs.length, 2);
  assert.match(runs[1]!.summary, /ideas W4 in/);
  const msgs = await messages("workia");
  assert.equal(msgs.length, 2);
  assert.match(msgs[1]!.body, /### W4: Team roles/);
  assert.doesNotMatch(msgs[1]!.body, /### W1/);
  const p = await progress(out.request_id);
  assert.deepEqual(p.targets.map((t) => t.state), ["done", "queued"]);

  await endRun(runs[1]!.id);
  await plan.resumeWaiting(db);
  assert.equal((await progress(out.request_id)).status, "done");
  assert.equal((await runsOf("po-workia")).length, 2, "nothing more");
});

test("check 2: a PO busy with another run gets the wake once that run ends (enqueueWake coalesces)", async () => {
  const [{ id: other }] = (await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary) select a.id, a.project_id, 'product-owner', 'running', 'other work' from agents a where a.slug = 'po-workia' returning id`)).rows;
  const out = await plan.sendToPlania(db, { briefId, codes: ["W1"] }, { env: ENV });
  assert.equal(out.targets[0]!.state, "queued");
  assert.equal(out.targets[0]!.note, "waiting for po-workia's current run");
  assert.equal((await messages("workia")).length, 0, "posted with its wake, not before");
  await endRun(other);
  assert.equal((await plan.resumeWaiting(db)).posted, 1);
  assert.equal((await messages("workia")).length, 1);
  assert.equal((await runsOf("po-workia")).filter((r) => r.status === "queued").length, 1);
});

test("check 3 (D7): a paused project gets no message and no wake; both happen once on the first tick after runs are on", async () => {
  await raw.query(`update projects set runs_paused = true where slug = 'zigzag'`);
  const out = await plan.sendToPlania(db, { briefId, codes: ["Z3", "W1"] }, { env: ENV });
  assert.deepEqual(out.targets.map((t) => [t.slug, t.state, t.note]), [["zigzag", "waiting_paused", "Zigzag runs are paused"], ["workia", "queued", null]]);
  assert.equal(out.runs, 2, "the paused one still costs a run later");
  assert.equal((await messages("zigzag")).length, 0);
  assert.equal((await runsOf("po-zigzag")).length, 0);
  assert.equal((await messages("workia")).length, 1, "the other project goes on");

  // Still paused: ticks do nothing.
  for (let i = 0; i < 3; i += 1) await plan.resumeWaiting(db);
  assert.equal((await messages("zigzag")).length, 0);
  assert.equal((await runsOf("po-zigzag")).length, 0);
  const waiting = await progress(out.request_id);
  assert.deepEqual(waiting.ideas.find((i) => i.code === "Z3"), { code: "Z3", slug: "zigzag", project: "Zigzag", title: "Route history", state: "waiting_paused", note: "Zigzag runs are paused", result: null });

  // Runs on: the asistente tick posts and wakes once.
  await raw.query(`update projects set runs_paused = false where slug = 'zigzag'`);
  resetAsistenteForTests();
  const tick = await runAsistente(db, new Date(), { env: ENV });
  assert.equal(tick.plan_posted, 1);
  assert.equal((await messages("zigzag")).length, 1);
  assert.match((await messages("zigzag"))[0]!.body, /### Z3: Route history/);
  assert.equal((await runsOf("po-zigzag")).length, 1);

  // Never twice: later ticks, with the run queued, running or ended, post and wake nothing more.
  for (let i = 0; i < 2; i += 1) await runAsistente(db, new Date(), { env: ENV });
  const [run] = await runsOf("po-zigzag");
  await endRun(run!.id);
  for (let i = 0; i < 2; i += 1) await plan.resumeWaiting(db);
  assert.equal((await messages("zigzag")).length, 1);
  assert.equal((await runsOf("po-zigzag")).length, 1);
  assert.equal((await progress(out.request_id)).targets[0]!.state, "done");
});

test("check 4 (D7): no wake and no message while the company is paused", async () => {
  await raw.query(`update runner_settings set company_paused = true`);
  const out = await plan.sendToPlania(db, { briefId, codes: ["W1", "X1"] }, { env: ENV });
  assert.deepEqual(out.targets.map((t) => [t.state, t.note]), [["waiting_paused", "company runs are paused"], ["waiting_paused", "company runs are paused"]]);
  assert.equal((await raw.query(`select count(*)::int n from agent_runs`)).rows[0].n, 0);
  assert.equal((await messages("workia")).length + (await messages("plania")).length, 0);
  await plan.resumeWaiting(db);
  assert.equal((await raw.query(`select count(*)::int n from agent_runs`)).rows[0].n, 0);
  await raw.query(`update runner_settings set company_paused = false`);
  assert.equal((await plan.resumeWaiting(db)).posted, 2);
  assert.equal((await raw.query(`select count(*)::int n from agent_runs`)).rows[0].n, 2);
});

test("check 5: a project with no product-owner bot fails with the reason, and the others go on", async () => {
  const out = await plan.sendToPlania(db, { briefId, codes: ["F1", "W1"] }, { env: ENV });
  assert.deepEqual(out.targets.map((t) => [t.slug, t.state, t.note]), [["filmia", "failed", "no product-owner bot for filmia"], ["workia", "queued", null]]);
  assert.equal(out.runs, 1);
  assert.equal((await messages("filmia")).length, 0);
  assert.equal((await runsOf("po-workia")).length, 1);
  const [run] = await runsOf("po-workia");
  await endRun(run!.id);
  await plan.resumeWaiting(db);
  assert.equal((await progress(out.request_id)).status, "partial");
});

test("a failed PO run marks its target failed with the run's summary; the request id stays the same", async () => {
  const out = await plan.sendToPlania(db, { briefId, codes: ["W1", "Z3"] }, { env: ENV });
  const [w] = await runsOf("po-workia");
  await raw.query(`update agent_runs set status = 'fail', summary = 'timed out after 45 min', ended_at = now() where id = $1`, [w!.id]);
  await plan.resumeWaiting(db);
  const p = await progress(out.request_id);
  assert.equal(p.targets[0]!.state, "failed");
  assert.match(p.targets[0]!.note!, /^run fail: .*timed out after 45 min/);
  assert.equal(p.targets[1]!.state, "queued", "the other target is not touched");
  assert.equal((await raw.query(`select count(*)::int n from brief_plan_requests`)).rows[0].n, 1);
});

test("POST /plan: unknown codes are 400 and write nothing", async () => {
  const res = await post({ brief_id: briefId, codes: ["W1", "Q7"] });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "UNKNOWN_CODES", codes: ["Q7"] });
  assert.equal((await raw.query(`select count(*)::int n from brief_plan_requests`)).rows[0].n, 0);
  assert.equal((await raw.query(`select count(*)::int n from agent_runs`)).rows[0].n, 0);
});

test("the message fits a thread message even with three ideas at the longest why", () => {
  const long = (code: string) => ({ ...idea(code, "workia", "T".repeat(70)), why: "w".repeat(400), flags: ["cost", "legal", "big"] });
  const body = plan.planMessage({ briefDate: "2026-11-14", requestId: "00000000-0000-4000-8000-000000000000", projectSlug: "workia", ideas: [long("W1"), long("W2"), long("W3")] as never });
  assert.ok(body.length <= 4000, String(body.length));
  for (const c of ["W1", "W2", "W3"]) assert.match(body, new RegExp(`### ${c}: `));
  assert.doesNotMatch(body, /\{\{/);
});

// ---- PLA-I43-2: the render and the request ids

const writes = await import("../src/mcp/writes.js");
const PO_CTX = (requestId: string, tool = "create_task") => ({ actor: { agent: "po-workia", session_id: "run-0000abcd" }, requestId, tool });

test("PLA-I43-2 check 1: the message leaves no {{…}} and lists every chosen idea with its why, flags and source", async () => {
  const req = "11111111-2222-4333-8444-555555555555";
  const chosen = [{ ...IDEAS[0]!, flags: ["cost", "overlap:WRK-I3"] }, IDEAS[1]!, IDEAS[2]!];
  const body = plan.planMessage({ briefDate: "2026-11-14", requestId: req, projectSlug: "workia", ideas: chosen as never });
  assert.doesNotMatch(body, /\{\{[^}]*\}\}/);
  assert.match(body, /^## Plan these ideas \(from the Morning brief, 2026-11-14\)/);
  assert.match(body, new RegExp(`Request: ${req}\\.`));
  assert.match(body, /in this project \(workia\)/);
  for (const i of chosen) {
    assert.match(body, new RegExp(`### ${i.code}: ${i.title}\\n- Why: ${i.why}`));
  }
  assert.match(body, /- Flags: cost, overlap:WRK-I3/);
  assert.match(body, /- Flags: none/);
  assert.match(body, /- Source: workia/);
  assert.match(body, new RegExp(`brief-plan:${req}:W1:idea`));
  assert.match(body, /Steps: idea, idea-doc, initiative, plan-doc, ticket-1/);
  assert.match(body, /NEVER "Ready"/);
  // A cross-app idea is planned in the home project.
  const x = plan.planMessage({ briefDate: "2026-11-14", requestId: req, projectSlug: "plania", ideas: [IDEAS[6]!] as never });
  assert.match(x, /### X1: One login for every app/);
  assert.match(x, /in this project \(plania\)/);
  assert.doesNotMatch(x, /\{\{/);
});

test("PLA-I43-2: request ids are brief-plan:<request>:<code>:<step> and parse back", () => {
  const req = "11111111-2222-4333-8444-555555555555";
  assert.equal(plan.planRequestId(req, "W1", "idea"), `brief-plan:${req}:W1:idea`);
  assert.equal(plan.planRequestId(req, "W1", "ticket-2"), `brief-plan:${req}:W1:ticket-2`);
  assert.throws(() => plan.planRequestId(req, "W1", "anything"), /unknown step/);
  assert.deepEqual(plan.parsePlanRequestId(`brief-plan:${req}:Z3:plan-doc`), { requestId: req, code: "Z3", step: "plan-doc" });
  assert.equal(plan.parsePlanRequestId(`brief-plan:${req}:Z3:bogus`), null);
  assert.equal(plan.parsePlanRequestId("morning_brief:projection:x"), null);
});

test("PLA-I43-2 check 2: sending the same codes again posts nothing, wakes nothing and keeps the request id", async () => {
  const first = await plan.sendToPlania(db, { briefId, codes: ["W1", "Z3"] }, { env: ENV });
  const again = await plan.sendToPlania(db, { briefId, codes: ["Z3", "W1"] }, { env: ENV });
  assert.equal(again.request_id, first.request_id);
  assert.deepEqual(again.already_sent, ["Z3", "W1"]);
  assert.deepEqual(again.targets, []);
  assert.equal(again.runs, 0);
  assert.deepEqual(again.estimate_min, [0, 0]);
  assert.equal((await messages("workia")).length + (await messages("zigzag")).length, 2);
  assert.equal((await raw.query(`select count(*)::int n from agent_runs`)).rows[0].n, 2);
  assert.equal((await raw.query(`select count(*)::int n from brief_plan_requests`)).rows[0].n, 1);
  // A new code from the same brief joins the same request; the sent one is left alone.
  const more = (await (await post({ brief_id: briefId, codes: ["W1", "W2"] })).json()) as Sent;
  assert.equal(more.request_id, first.request_id);
  assert.deepEqual(more.already_sent, ["W1"]);
  assert.deepEqual(more.targets.map((t) => [t.codes, t.state, t.note]), [[["W2"], "queued", "after the earlier run"]]);
  assert.deepEqual((await progress(first.request_id)).codes, ["W1", "Z3", "W2"]);
});

test("PLA-I43-2 check 2: the PO's writes with the same request ids make nothing twice, also after a failed run is re-sent", async () => {
  const sent = await plan.sendToPlania(db, { briefId, codes: ["W1"] }, { env: ENV });
  const id = (step: string) => plan.planRequestId(sent.request_id, "W1", step);
  const ideaA = (await writes.createTask(db, { project: "workia", kind: "idea", title: "Renewal board" } as never, PO_CTX(id("idea")))) as { key: string };
  const ini = (await writes.createTask(db, { project: "workia", kind: "initiative", title: "Renewal board", base_branch: "sandbox" } as never, PO_CTX(id("initiative")))) as { key: string };
  await writes.createTask(db, { project: "workia", parent_key: ini.key, title: "Board page", scope: "s", checks: ["c"], status: "Backlog" } as never, PO_CTX(id("ticket-1")));

  // The run fails half way; the owner sends W1 again. Same request id, a fresh message and wake.
  const [run] = await runsOf("po-workia");
  await raw.query(`update agent_runs set status = 'fail', summary = 'timed out', ended_at = now() where id = $1`, [run!.id]);
  await plan.resumeWaiting(db);
  const resent = await plan.sendToPlania(db, { briefId, codes: ["W1"] }, { env: ENV });
  assert.equal(resent.request_id, sent.request_id);
  assert.deepEqual(resent.targets.map((t) => [t.codes, t.state]), [[["W1"], "queued"]]);
  const runs = await runsOf("po-workia");
  assert.equal(runs.length, 2);
  assert.match(runs[1]!.summary, new RegExp(`brief plan ${sent.request_id}:`));
  assert.equal((await messages("workia")).length, 2);

  // The second run repeats the same writes: each replays the first response.
  const ideaB = (await writes.createTask(db, { project: "workia", kind: "idea", title: "Renewal board" } as never, PO_CTX(id("idea")))) as { key: string };
  const iniB = (await writes.createTask(db, { project: "workia", kind: "initiative", title: "Renewal board", base_branch: "sandbox" } as never, PO_CTX(id("initiative")))) as { key: string };
  await writes.createTask(db, { project: "workia", parent_key: ini.key, title: "Board page", scope: "s", checks: ["c"], status: "Backlog" } as never, PO_CTX(id("ticket-1")));
  assert.equal(ideaB.key, ideaA.key);
  assert.equal(iniB.key, ini.key);
  const count = await raw.query(`select kind, count(*)::int n from tasks t join projects p on p.id = t.project_id where p.slug = 'workia' and t.title in ('Renewal board', 'Board page') group by kind order by kind`);
  assert.deepEqual(count.rows, [{ kind: "idea", n: 1 }, { kind: "initiative", n: 1 }, { kind: "ticket", n: 1 }]);
});
