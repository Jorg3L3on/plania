// PLA-I49-3: the brief's action registry, POST /api/brief/act, /act/:id/undo and GET /api/brief/:id/state, through
// the app with the session cookie. Throwaway plania_test_<hash> database; gh is faked through releaseGh.run and the
// GitHub poller gets a fake fetch, so no real gh or GitHub call runs and no live database is touched.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_TZ = "America/Mexico_City";
process.env.PLANIA_HOME_PROJECT = "workia";
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const { pollGithubProject } = await import("../src/jobs/github.js");
const { releaseGh } = await import("../src/mcp/release-ship.js");
const { saveBriefSettings } = await import("../src/brief/settings.js");
const { setAsideItems } = await import("../src/brief/act.js");
const { REGISTRY, ACTION_IDS } = await import("../src/brief/actions.js");
const { BriefData } = await import("../src/brief/types.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "po-workia", session_id: "s-po", machine: "ci" } };
const realGh = releaseGh.run;
const REPO = "Jorg3L3on/zigzag";
const SANDBOX = "5aaaaaa111111111111111111111111111111111";
const MAIN = "0bbbbbb222222222222222222222222222222222";
const MERGE = "7ccccccc33333333333333333333333333333333";

const cookie = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
let n = 0;
const rid = () => `req-${Date.now()}-${(n += 1)}`;
const post = (path: string, body: unknown, headers: Record<string, string> = cookie()) => app.request(`/api/brief${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const get = async (path: string) => (await app.request(`/api/brief${path}`, { headers: cookie() })).json() as Promise<Json>;
async function act(item: string, action: string, extra: Json = {}) {
  const res = await post("/act", { brief_id: briefId, item_id: item, action, request_id: rid(), ...extra });
  return { http: res.status, body: (await res.json()) as Json };
}
const state = async () => (await get(`/${briefId}/state`)) as { read_only: boolean; items: Record<string, Json> };
const events = async (type = "brief.action") => (await raw.query(`select e.payload, p.slug, e.actor from events e join projects p on p.id = e.project_id where e.type = $1 order by e.id`, [type])).rows;

// gh stub: merges and the release ship succeed; every call is recorded.
let calls: string[][] = [];
function stubGh() {
  releaseGh.run = async (args) => {
    calls.push(args);
    const [, verb] = args;
    if (args[0] === "pr" && verb === "view" && args.includes("baseRefName,state,headRefOid,url")) return { ok: true, stdout: JSON.stringify({ baseRefName: "sandbox", state: "OPEN", headRefOid: "abc", url: "https://github.com/Jorg3L3on/workia/pull/78" }), stderr: "" };
    if (args[0] === "pr" && verb === "view" && args.includes("headRefName,baseRefName,state,url")) return { ok: true, stdout: JSON.stringify({ headRefName: "jl/pr-80", baseRefName: "sandbox", state: "OPEN", url: "https://github.com/Jorg3L3on/workia/pull/80" }), stderr: "" };
    if (args[0] === "api" && args.includes("PUT")) return { ok: true, stdout: JSON.stringify({ commit: { sha: "f11e5a1e0000" } }), stderr: "" };
    if (args[0] === "api") return { ok: false, stdout: "", stderr: "HTTP 404: Not Found" };
    if (verb === "list") return { ok: true, stdout: "[]", stderr: "" };
    if (verb === "create") return { ok: true, stdout: `https://github.com/${REPO}/pull/700\n`, stderr: "" };
    if (verb === "view") return { ok: true, stdout: JSON.stringify({ mergeCommit: { oid: MERGE }, url: `https://github.com/${REPO}/pull/700` }), stderr: "" };
    return { ok: true, stdout: "", stderr: "" };
  };
}

// The GitHub poller's fake, for zigzag's release compare (sandbox 2 ahead of main).
const fetch = async (url: string) => {
  const path = url.replace(/^https:\/\/api\.github\.com/, "");
  const ok = (data: unknown) => ({ status: 200, headers: { get: () => null }, json: async () => data });
  if (path.startsWith(`/repos/${REPO}/pulls?`)) return ok([]);
  if (path.startsWith(`/repos/${REPO}/branches`)) return ok([{ name: "sandbox", commit: { sha: SANDBOX } }, { name: "main", commit: { sha: MAIN } }]);
  if (path.startsWith(`/repos/${REPO}/compare/`)) return ok({ status: "ahead", ahead_by: 2, commits: [{ sha: "c1c1c1c1" }, { sha: SANDBOX }] });
  return { status: 404, headers: { get: () => null }, json: async () => ({}) };
};

const ids: Record<string, string> = {};
let briefId = "";
const T = {
  question: "i|workia|000000000001",
  step: "i|workia|000000000002",
  postpone: "i|workia|000000000003",
  first: "i|workia|000000000004",
  hold: "i|workia|000000000005",
  runs: "i|micasa|000000000006",
  prOps: "i|workia|000000000007",
  prCode: "i|workia|000000000008",
  changes: "i|workia|000000000009",
  release: "i|zigzag|000000000010",
  releaseNo: "i|workia|000000000011",
  finding: "i|workia|000000000012",
  plain: "i|cross|000000000013",
  inbox: "i|workia|000000000014",
  file: "i|workia|000000000015",
};

async function delivery(key: string, number: number, workType: string): Promise<void> {
  const p = await findProject(db, "workia");
  const t = (await createTask(db, { project: "workia", title: `Delivery ${key}`, scope: "s", checks: ["c"], work_type: workType } as never, ctx)) as { key: string };
  ids[key] = t.key;
  const url = `https://github.com/Jorg3L3on/workia/pull/${number}`;
  await raw.query(`update tasks set status = 'In review', pr_url = $2 where key = $1 and project_id = $3`, [t.key, url, p.id]);
  await raw.query(`update checks set done = true, done_at = now() where task_id = (select id from tasks where key = $1 and project_id = $2)`, [t.key, p.id]);
  await raw.query(`insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_branch, base_branch) values ($1, 'Jorg3L3on/workia', $2, $3, $4, (select id from tasks where key = $5 and project_id = $1), 'open', $6, 'sandbox')`, [p.id, number, url, `PR ${number}`, t.key, `jl/pr-${number}`]);
  let [th] = (await raw.query(`select id from threads where kind = 'project' and project_id = $1`, [p.id])).rows;
  if (!th) [th] = (await raw.query(`insert into threads (kind, project_id) values ('project', $1) returning id`, [p.id])).rows;
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, 'taller-workia', 'taller', $2, $3)`, [th.id, `${t.key} ready`, JSON.stringify([{ kind: "ticket", ref: t.key, title: "x" }, { kind: "pr", ref: url, title: "PR" }])]);
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await saveBriefSettings(db, { github_mode: "off" });
  const w = await findProject(db, "workia");

  // Workia: a question, a human step, two Ready tickets, an initiative, two deliveries and an audit finding.
  const q = (await createTask(db, { project: "workia", title: "Pricing", scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string };
  ids.q = q.key;
  const [qrow] = (await raw.query(`insert into questions (project_id, task_id, question, options, asked_by) values ($1, (select id from tasks where key = $2 and project_id = $1), 'Monthly or yearly?', '{monthly,yearly}', $3) returning id`, [w.id, q.key, JSON.stringify(ctx.actor)])).rows;
  ids.question = qrow.id;
  const [qrow2] = (await raw.query(`insert into questions (project_id, task_id, question, options, asked_by) values ($1, (select id from tasks where key = $2 and project_id = $1), 'Which logo?', '{a,b}', $3) returning id`, [w.id, q.key, JSON.stringify(ctx.actor)])).rows;
  ids.question2 = qrow2.id;
  const s = (await createTask(db, { project: "workia", title: "Legal", scope: "s", checks: ["c"], status: "Ready", blocked_by: [{ human_action: { text: "Sign the contract" } }] } as never, ctx)) as { key: string };
  ids.s = s.key;
  ids.step = (await raw.query(`select id from blockers where type = 'human_action'`)).rows[0].id;
  const fs = (await createTask(db, { project: "workia", title: "Env example", scope: "s", checks: ["c"], status: "Ready", blocked_by: [{ human_action: { text: "Add the key to .env.example", file: { path: ".env.example", append: "PAY_KEY=" } } }] } as never, ctx)) as { key: string };
  await raw.query(`update tasks set pr_url = 'https://github.com/Jorg3L3on/workia/pull/80' where key = $1 and project_id = $2`, [fs.key, w.id]);
  ids.fileStep = (await raw.query(`select b.id from blockers b join tasks t on t.id = b.task_id where t.key = $1 and t.project_id = $2`, [fs.key, w.id])).rows[0].id;
  ids.r1 = ((await createTask(db, { project: "workia", title: "Renewals", scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string }).key;
  ids.r2 = ((await createTask(db, { project: "workia", title: "Exports", scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string }).key;
  ids.ini = ((await createTask(db, { project: "workia", kind: "initiative", title: "Payroll", scope: "PRD" } as never, ctx)) as { key: string }).key;
  await delivery("ops", 77, "ops");
  await delivery("code", 78, "code");
  await delivery("chg", 79, "code");
  await raw.query(`insert into audit_runs (project_id, at, count, findings) values ($1, now(), 1, $2)`, [w.id, JSON.stringify([{ code: "ENV_DEPLOYED_AT_MISSING", key: null, id: "prod", detail: "prod has no deployed_at", fix_hint: "set_env" }])]);
  await raw.query(`insert into env_states (project_id, env, commit, by, updated_at) values ($1, 'prod', 'abcdef1', $2, now())`, [w.id, JSON.stringify(ctx.actor)]);
  await raw.query(`update projects set runs_paused = false where slug <> 'micasa'`);
  await raw.query(`update projects set runs_paused = true where slug = 'micasa'`);
  await setProject(db, { project: "workia", version: (await findProject(db, "workia")).version, settings: { release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } } }, { actor: { agent: "t", session_id: "s1" } });

  // Zigzag: a release ready to publish (mode merge, two merged tickets, the poller's compare).
  const z = await findProject(db, "zigzag");
  await setProject(db, { project: "zigzag", version: z.version, settings: { github: { repo: REPO }, release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } } }, { actor: { agent: "t", session_id: "s1" } });
  for (const [title, number] of [["Badge", 600], ["Actions", 601]] as const) {
    const t = (await createTask(db, { project: "zigzag", title, scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string };
    await raw.query("update tasks set status = 'Merged', pr_url = $2 where key = $1", [t.key, `https://github.com/${REPO}/pull/${number}`]);
    await raw.query(
      "insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_sha, head_branch, base_branch, merged_at, merge_sha) values ($1, $2, $3, $4, $5, (select id from tasks where key = $6), 'merged', $7, $8, 'sandbox', now(), $7)",
      [z.id, REPO, number, `https://github.com/${REPO}/pull/${number}`, title, t.key, `${number}`.padEnd(40, "e"), `jl/${t.key.toLowerCase()}`],
    );
  }
  await raw.query(`update checks set done = true, done_at = now() where task_id in (select id from tasks where project_id = $1)`, [z.id]);
  await pollGithubProject(db, await findProject(db, "zigzag"), { fetch, env: { GITHUB_TOKEN: "ghp_test" } });

  // Today's brief, v2, one row per kind.
  const row = (status: string, id: string, app: string, title: string, targets: Json[]) => ({ id, app, status, title, ...(targets.length ? { targets } : {}) });
  const data = {
    ...JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8")),
    version: 2,
    items: [
      row("needs_you", T.question, "workia", "Answer: monthly or yearly", [{ kind: "question", project: "workia", id: ids.question, key: ids.q }]),
      row("needs_you", T.step, "workia", "Sign the contract", [{ kind: "step", project: "workia", id: ids.step, key: ids.s }]),
      row("next", T.postpone, "workia", "Start renewals", [{ kind: "ticket", project: "workia", key: ids.r1 }]),
      row("next", T.first, "workia", "Start exports", [{ kind: "ticket", project: "workia", key: ids.r2 }]),
      row("needs_you", T.hold, "workia", "Start building payroll", [{ kind: "initiative", project: "workia", key: ids.ini }]),
      row("needs_you", T.runs, "micasa", "Turn on runs for MiCasa", [{ kind: "runs", project: "micasa" }]),
      row("needs_you", T.prOps, "workia", "Review the ops delivery", [{ kind: "pr", project: "workia", pr: 77, key: ids.ops }]),
      row("needs_you", T.prCode, "workia", "Review the code delivery", [{ kind: "pr", project: "workia", pr: 78, key: ids.code }]),
      row("needs_you", T.changes, "workia", "Review the other delivery", [{ kind: "pr", project: "workia", pr: 79, key: ids.chg }]),
      row("needs_you", T.release, "zigzag", "Publish zigzag", [{ kind: "release", project: "zigzag" }]),
      row("needs_you", T.releaseNo, "workia", "Publish workia", [{ kind: "release", project: "workia" }]),
      row("next", T.finding, "workia", "Fix: prod has no deployed_at", [{ kind: "finding", project: "workia", code: "ENV_DEPLOYED_AT_MISSING" }]),
      row("needs_you", T.plain, "cross", "Close the old PRs", []),
      row("needs_you", T.file, "workia", "Add the key to .env.example", [{ kind: "step", project: "workia", id: ids.fileStep }]),
      row("needs_you", T.inbox, "workia", "Answer: which logo", [{ kind: "question", project: "workia", id: ids.question2, key: ids.q }]),
    ],
  };
  assert.ok(BriefData.safeParse(data).success, JSON.stringify(BriefData.safeParse(data).error?.issues));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  briefId = (await raw.query(`insert into morning_briefs (local_date, generated_at, trigger, mode, data) values ($1, now() - interval '1 minute', 'manual', 'full', $2) returning id`, [today, JSON.stringify(data)])).rows[0].id;
});

beforeEach(() => {
  calls = [];
  stubGh();
});

after(async () => {
  releaseGh.run = realGh;
  await closeDb?.();
  await raw?.end();
});

test("the registry: every action has a level and an input schema; brief-state actions fit any row", () => {
  for (const id of ACTION_IDS) {
    const a = REGISTRY[id];
    assert.equal(a.id, id);
    assert.ok(["instant", "confirm", "wake"].includes(a.level), id);
  }
  assert.equal(REGISTRY.publish.level, "confirm", "publish to main is confirm");
  assert.equal(REGISTRY.later.applies(null, null), true);
});

test("GET state: each open row lists the actions that fit its object now, main one first, then Later and Not relevant", async () => {
  const s = await state();
  assert.equal(s.read_only, false);
  const ids = (k: string) => s.items[k]!.actions.map((a: Json) => a.id);
  // PLA-I49-5: a paused project's row also offers Turn on runs; none of these projects is paused here.
  assert.deepEqual(ids(T.question), ["answer", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.step), ["step_done", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.postpone), ["postpone", "put_first", "start_now", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.hold), ["hold", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.runs), ["resume_runs", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.prCode), ["accept_pr", "request_changes", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.release), ["publish", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.releaseNo), ["give_to_po", "later", "dismiss"], "a release that is not ready offers no Publish");
  assert.deepEqual(ids(T.finding), ["fix_finding", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.plain), ["give_to_po", "later", "dismiss"], "a row with no target still has Give to PO, Later and Not relevant");
  for (const k of Object.values(T)) assert.equal(s.items[k]!.state, "open", k);
  assert.equal((await app.request(`/api/brief/${briefId}/state`)).status, 401, "cookie only");
});

test("answer: picks an option, the question is answered, the row is handled; again is stale", async () => {
  const a = await act(T.question, "answer", { input: { option: 2 } });
  assert.equal(a.http, 200, JSON.stringify(a.body));
  assert.equal(a.body.status, "done");
  assert.equal(a.body.line, "Answered: yearly");
  assert.equal((await raw.query(`select answer from questions where id = $1`, [ids.question])).rows[0].answer, "yearly");
  assert.equal(a.body.state.state, "handled");
  const again = await act(T.question, "answer", { input: { option: 1 } });
  assert.equal(again.body.status, "stale");
  assert.match(again.body.line, /Answered: yearly/);
  assert.equal((await raw.query(`select answer from questions where id = $1`, [ids.question])).rows[0].answer, "yearly");
});

test("check 5: a question answered through the inbox route shows as handled in GET state with no brief action", async () => {
  const res = await app.request(`/api/projects/workia/questions/${ids.question2}/answer`, { method: "POST", headers: cookie(), body: JSON.stringify({ answer: "b" }) });
  assert.equal(res.status, 200, await res.clone().text());
  const s = await state();
  assert.equal(s.items[T.inbox]!.state, "handled");
  assert.equal(s.items[T.inbox]!.line, "Answered: b");
  assert.equal(s.items[T.inbox]!.action_id, null);
  assert.equal((await raw.query(`select count(*)::int as n from brief_actions where item_id = $1`, [T.inbox])).rows[0].n, 0);
});

test("step_done: the human step is resolved; a stale target answers stale", async () => {
  const a = await act(T.step, "step_done", { input: { note: "Signed today" } });
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.notEqual((await raw.query(`select satisfied_at from blockers where id = $1`, [ids.step])).rows[0].satisfied_at, null);
  assert.equal((await act(T.step, "step_done")).body.status, "stale");
});

test("add_to_pr: the file step's lines are committed to the PR and the step resolved; again is stale", async () => {
  assert.deepEqual((await state()).items[T.file]!.actions.map((x: Json) => x.id), ["step_done", "add_to_pr", "give_to_po", "later", "dismiss"]);
  const a = await act(T.file, "add_to_pr");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.match(a.body.line, /Added 1 line to .env.example on jl\/pr-80/);
  assert.ok(calls.some((c) => c[0] === "api" && c.includes("PUT")));
  assert.notEqual((await raw.query(`select satisfied_at from blockers where id = $1`, [ids.fileStep])).rows[0].satisfied_at, null);
  assert.equal((await act(T.file, "add_to_pr")).body.status, "stale");
});

test("postpone and put_first are instant with undo; undo puts the ticket back", async () => {
  const a = await act(T.postpone, "postpone");
  assert.equal(a.body.status, "done");
  assert.equal(a.body.undo, true);
  assert.equal((await raw.query(`select status from tasks where key = $1`, [ids.r1])).rows[0].status, "Backlog");
  assert.equal((await act(T.postpone, "postpone")).body.status, "stale", "no longer Ready");
  const u = await post(`/act/${a.body.action_id}/undo`, {});
  assert.equal(u.status, 200, await u.clone().text());
  assert.equal((await raw.query(`select status from tasks where key = $1`, [ids.r1])).rows[0].status, "Ready");
  assert.equal((await post(`/act/${a.body.action_id}/undo`, {})).status, 409, "only once");

  const f = await act(T.first, "put_first");
  assert.equal(f.body.status, "done");
  assert.equal((await findProject(db, "workia")).settings.next_first, ids.r2);
  assert.equal((await act(T.first, "put_first")).body.status, "stale", "already first");
  assert.equal((await post(`/act/${f.body.action_id}/undo`, {})).status, 200);
  assert.equal((await findProject(db, "workia")).settings.next_first, undefined);
});

test("hold: the initiative goes On hold; undo puts it back to Planning", async () => {
  const a = await act(T.hold, "hold");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.equal((await raw.query(`select status from tasks where key = $1`, [ids.ini])).rows[0].status, "On hold");
  assert.equal((await act(T.hold, "hold")).body.status, "stale");
  assert.equal((await post(`/act/${a.body.action_id}/undo`, {})).status, 200);
  assert.equal((await raw.query(`select status from tasks where key = $1`, [ids.ini])).rows[0].status, "Planning");
});

test("resume_runs: the paused project's runs turn on; again is stale (handled)", async () => {
  const a = await act(T.runs, "resume_runs");
  assert.equal(a.body.status, "done");
  assert.equal((await raw.query(`select runs_paused from projects where slug = 'micasa'`)).rows[0].runs_paused, false);
  const again = await act(T.runs, "resume_runs");
  assert.equal(again.body.status, "stale");
  assert.equal(again.body.line, "Runs are on");
  await raw.query(`update projects set runs_paused = true where slug = 'micasa'`);
});

test("check 3: accept on a ticket with an open check is refused with the thread route's error and changes nothing", async () => {
  await raw.query(`update checks set done = false, done_at = null where task_id = (select id from tasks where key = $1 and project_id = (select id from projects where slug = 'workia'))`, [ids.ops]);
  const a = await act(T.prOps, "accept_pr");
  assert.equal(a.http, 409);
  assert.equal(a.body.status, "failed");
  assert.equal(a.body.error, "CHECKS_OPEN");
  assert.equal((await raw.query(`select status from tasks where key = $1 and project_id = (select id from projects where slug = 'workia')`, [ids.ops])).rows[0].status, "In review");
  assert.equal((await state()).items[T.prOps]!.state, "open", "a failed action leaves the row open");
});

test("accept_pr: a code delivery's PR is merged into sandbox through the thread action", async () => {
  const a = await act(T.prCode, "accept_pr");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.match(a.body.line, /#78 merged into sandbox/);
  assert.ok(calls.some((c) => c[1] === "merge" && c.includes("78")));
  const msg = (await raw.query(`select action_state from thread_messages where body = $1`, [`${ids.code} ready`])).rows[0];
  assert.equal(msg.action_state.action, "aceptar");
  assert.equal((await act(T.prCode, "accept_pr")).body.status, "stale", "the delivery was acted on");
  assert.equal((await act(T.prCode, "request_changes", { input: { text: "x" } })).body.status, "stale", "changes on a merged delivery");
});

test("request_changes: needs a text; the ticket goes back to Ready with the note", async () => {
  assert.equal((await act(T.changes, "request_changes")).http, 400);
  const a = await act(T.changes, "request_changes", { input: { text: "Add the empty state" } });
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.equal((await raw.query(`select status from tasks where key = $1 and project_id = (select id from projects where slug = 'workia')`, [ids.chg])).rows[0].status, "Ready");
});

test("check 2: publish refuses a Bearer token and a release that is not ready; a ready one ships", async () => {
  for (const auth of [`Bearer ${TEST_BEARER}`, "bearer x"]) {
    const res = await post("/act", { brief_id: briefId, item_id: T.release, action: "publish", request_id: rid() }, { ...cookie(), Authorization: auth });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as Json).error, "HUMAN_ONLY");
  }
  const not = await act(T.releaseNo, "publish");
  assert.equal(not.body.status, "stale", "workia's release is not ready");
  assert.equal(calls.length, 0, "gh never ran");
  const a = await act(T.release, "publish");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.match(a.body.line, /Published to main with #700/);
  assert.ok(calls.some((c) => c[1] === "merge"));
  assert.equal((await events("release.merged")).length, 1);
});

test("fix_finding: a one-click finding is fixed through fixFinding", async () => {
  const a = await act(T.finding, "fix_finding");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.equal((await act(T.finding, "fix_finding")).body.status, "stale", "the finding is gone");
  assert.notEqual((await raw.query(`select deployed_at from env_states where env = 'prod' and project_id = (select id from projects where slug = 'workia')`)).rows[0].deployed_at, null);
});

test("later and dismiss: brief state only, with undo; the pipeline sets them aside", async () => {
  const l = await act(T.plain, "later", { input: { until: "2999-01-01" } });
  assert.equal(l.body.status, "done");
  assert.equal(l.body.state.state, "later");
  assert.equal(l.body.state.until, "2999-01-01");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  assert.ok((await setAsideItems(db, today)).has(T.plain));
  assert.ok(!(await setAsideItems(db, "2999-01-02")).has(T.plain), "a later row comes back on its date");
  assert.equal((await post(`/act/${l.body.action_id}/undo`, {})).status, 200);
  assert.equal((await state()).items[T.plain]!.state, "open");
  const d = await act(T.plain, "dismiss", { input: { reason: "already done" } });
  assert.equal(d.body.state.state, "dismissed");
  assert.equal(d.body.line, "Not relevant: already done");
  assert.ok((await setAsideItems(db, "2999-01-02")).has(T.plain));
  assert.equal((await post(`/act/${d.body.action_id}/undo`, {})).status, 200);
});

test("check 4: a double click (same request_id) writes once and replays the first answer", async () => {
  const body = { brief_id: briefId, item_id: T.plain, action: "dismiss", request_id: "double-click-0001" };
  const [a, b] = await Promise.all([post("/act", body), post("/act", body)]);
  const [ja, jb] = [(await a.json()) as Json, (await b.json()) as Json];
  assert.equal((await raw.query(`select count(*)::int as n from brief_actions where request_id = 'double-click-0001'`)).rows[0].n, 1);
  assert.ok([ja.status, jb.status].includes("done"));
  const again = (await (await post("/act", body)).json()) as Json;
  assert.equal(again.replay, true);
  assert.equal(again.action_id, ja.action_id ?? jb.action_id);
  await post(`/act/${again.action_id}/undo`, {});
});

test("check 6: every action left one brief.action event in its project, as the owner", async () => {
  const ev = await events();
  const done = (await raw.query(`select id, item_id, action from brief_actions`)).rows;
  for (const r of done) assert.ok(ev.some((e) => e.payload.action_id === r.id && !e.payload.undone), `${r.action} ${r.item_id}`);
  assert.ok(ev.every((e) => e.actor.agent === "jorge"));
  const by = (item: string) => ev.find((e) => e.payload.item_id === item)!.slug;
  assert.equal(by(T.runs), "micasa");
  assert.equal(by(T.release), "zigzag");
  assert.equal(by(T.plain), "workia", "a cross row goes to the home project");
});

test("bad requests: unknown item, a target that is not the row's, a row with no target, bad input", async () => {
  assert.equal((await act("i|workia|ffffffffffff", "later")).http, 404);
  assert.equal((await act(T.plain, "answer")).http, 409);
  assert.equal((await act(T.question, "later", { target: { kind: "runs", project: "workia" } })).http, 400);
  assert.equal((await act(T.question, "later", { input: { until: "tomorrow" } })).http, 400);
  assert.equal((await post("/act", { brief_id: briefId, action: "later" })).status, 400);
});

test("past days are read-only: no actions in state and act refused", async () => {
  const newer = (await raw.query(`insert into morning_briefs (local_date, generated_at, trigger, mode, data) values ('2999-12-31', now(), 'manual', 'full', '{"items": []}') returning id`)).rows[0].id;
  const s = await state();
  assert.equal(s.read_only, true);
  assert.ok(Object.values(s.items).every((i: Json) => i.actions.length === 0));
  const a = await act(T.plain, "later");
  assert.equal(a.http, 409);
  assert.equal(a.body.error, "READ_ONLY");
  await raw.query(`delete from morning_briefs where id = $1`, [newer]);
});

test("check 7: migration 0050 is additive and runs twice without change", async () => {
  const sql = readFileSync(new URL("../drizzle/migrations/0050_brief_actions.sql", import.meta.url), "utf8");
  const code = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(code, /\b(drop|alter|truncate)\b|\bdelete\s+from\b/i, "additive only");
  assert.match(code, /CREATE TABLE IF NOT EXISTS/);
  const before = (await raw.query(`select count(*)::int as n from brief_actions`)).rows[0].n;
  await raw.query(sql);
  await raw.query(sql);
  assert.equal((await raw.query(`select count(*)::int as n from brief_actions`)).rows[0].n, before);
});
