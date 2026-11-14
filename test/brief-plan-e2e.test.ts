// PLA-I43-5: Send to Plania end to end (spec acceptance tests 9 and 16, D3, D7), through the real runner queue:
// POST /api/brief/plan → thread messages + queued PO wakes → drainQueue starts them one at a time in the single slot →
// a fake `claude` (no process) does what the PO's run would do through Plania's own write functions → the asistente
// tick reads the results. Throwaway test DB only; no claude, no live database.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_TZ = "America/Mexico_City";
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { setBriefApiDepsForTests } = await import("../src/api/brief.js");
const { saveBriefSettings } = await import("../src/brief/settings.js");
const { BriefData } = await import("../src/brief/types.js");
const pipeline = await import("../src/brief/pipeline.js");
const plan = await import("../src/brief/plan.js");
const writes = await import("../src/mcp/writes.js");
const docs = await import("../src/mcp/docs.js");
const threads = await import("../src/runner/threads.js");
const runner = await import("../src/runner/runner.js");
const asistente = await import("../src/runner/asistente.js");
type PassOutcome = import("../src/brief/claude.js").PassOutcome<unknown>;

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: (() => Promise<void>) | undefined;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-brief-plan-e2e-"));
const ENV = { HOME: scratch, PLANIA_TZ: "America/Mexico_City", PLANIA_HOME_PROJECT: "plania", PLANIA_BRIEF_TOKEN: "brief-read-token-value" } as NodeJS.ProcessEnv;
setBriefApiDepsForTests({ env: ENV, liveRuns: () => [] });

const IDEA_HEADINGS = ["## Problem", "## Who it is for", "## Why now", "## Constraints"];
const PLAN_HEADINGS = ["## Description", "## Steps", "## Sketch link", "## Affected code and impacts", "## Risks", "## Cost", "## Split assessment", "## Done when"];

// ---- The fake PO run

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  finish(subtype = "success"): void {
    const result = { type: "result", subtype, is_error: subtype !== "success", num_turns: 12, session_id: "sess-i43", result: "OK", modelUsage: { "claude-opus-5-5": { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
    this.stdout.write(`${JSON.stringify(result)}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", subtype === "success" ? 0 : 1, null));
  }
}

/** Other runs live in the DB when each fake run is spawned (its own row, matched by pid, is left out). */
const runningAtSpawn: number[] = [];
const spawnedPos: string[] = [];
const fakeErrors: string[] = [];
let readyFor = new Set<string>();

/**
 * What a PO does for "Plan these ideas" (po-plan-ideas.md), with its run's session and brief-plan request ids: per code
 * an idea + Idea doc, an initiative (Planning) + complete Plan doc, two Backlog tickets, the initiative key in the
 * Idea doc's Constraints, then one closing line. A code in readyFor gets its second ticket made Ready by mistake.
 */
async function poRun(prompt: string): Promise<void> {
  const session = /actor session_id (run-[0-9a-f]{8})/.exec(prompt)![1]!;
  const m = /brief plan ([0-9a-f-]{36}): the owner chose ideas ([A-Z0-9, ]+) in the Morning brief/.exec(prompt)!;
  const requestId = m[1]!;
  const codes = m[2]!.split(", ");
  const run = (await raw.query(`select a.slug as po, p.slug from agent_runs r join agents a on a.id = r.agent_id join projects p on p.id = r.project_id where r.id::text like $1`, [`${session.slice(4)}%`])).rows[0];
  spawnedPos.push(run.po);
  // The PO reads its thread first: the message is there, with every chosen idea.
  const thread = (await raw.query(`select m.body from thread_messages m join threads t on t.id = m.thread_id join projects p on p.id = t.project_id where p.slug = $1 and m.author_agent = 'asistente' order by m.at desc limit 1`, [run.slug])).rows[0].body as string;
  for (const c of codes) assert.match(thread, new RegExp(`### ${c}: `));
  const ideas = (await raw.query(`select ideas from brief_plan_requests where id = $1`, [requestId])).rows[0].ideas as { code: string; title: string; why: string }[];
  const ctx = (code: string, step: string, tool = "create_task") => ({ actor: { agent: run.po, session_id: session }, requestId: plan.planRequestId(requestId, code, step), tool });
  const entries: string[] = [];
  for (const code of codes) {
    const i = ideas.find((x) => x.code === code)!;
    const idea = (await writes.createTask(db, { project: run.slug, kind: "idea", title: i.title } as never, ctx(code, "idea"))) as { key: string };
    const ideaDoc = (h: string) => IDEA_HEADINGS.map((x) => `${x}\n${x === "## Constraints" ? h : i.why}`).join("\n\n");
    await docs.attachDoc(db, { project: run.slug, key: idea.key, title: "Idea", markdown: ideaDoc("none yet") } as never, ctx(code, "idea-doc", "attach_doc"));
    const ini = (await writes.createTask(db, { project: run.slug, kind: "initiative", title: i.title, base_branch: "sandbox", scope: `Plan ${code}.` } as never, ctx(code, "initiative"))) as { key: string };
    await docs.attachDoc(db, { project: run.slug, key: ini.key, title: "Plan", markdown: PLAN_HEADINGS.map((h) => `${h}\n${h === "## Cost" ? "$0" : h === "## Sketch link" ? "none yet" : "Planned."}`).join("\n\n") } as never, ctx(code, "plan-doc", "attach_doc"));
    for (const n of [1, 2]) {
      const status = readyFor.has(code) && n === 2 ? "Ready" : "Backlog";
      await writes.createTask(db, { project: run.slug, parent_key: ini.key, title: `${i.title}: phase ${n}`, scope: "s", checks: ["It works (test)"], phase: n, priority: "P2", work_type: "code", status } as never, ctx(code, `ticket-${n}`));
    }
    await docs.attachDoc(db, { project: run.slug, key: idea.key, title: "Idea", markdown: ideaDoc(`Initiative ${ini.key}.`), version: 1 } as never, ctx(code, "constraints", "attach_doc"));
    entries.push(`${code} -> ${ini.key} (2 tickets, Backlog)`);
  }
  await threads.postMessage(db, await threads.resolveThread(db, run.slug), { author: { agent: run.po, role: "product-owner" }, body: `Brief plan ${requestId}: ${entries.join("; ")}.` }, ctx(codes[0]!, "line", "thread_post"));
}

let pid = 60_000;
const deps = () => ({
  env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "plania", CLAUDE_CODE_BIN: "/fake/bin/claude" } as NodeJS.ProcessEnv,
  logDir: path.join(scratch, "logs"),
  tmpDir: path.join(scratch, "tmp"),
  worktreeRoot: path.join(scratch, "worktrees"),
  graceMs: 10,
  liveFlushMs: 0,
  footprints: false,
  git: async () => ({ code: 0, stdout: "", stderr: "" }),
  spawn: (_command: string, args: string[]) => {
    const child = new FakeChild(++pid);
    const prompt = args[args.indexOf("-p") + 1]!;
    setImmediate(async () => {
      try {
        // Only OTHER runs: start() marks this run running (with its pid) right after spawn, and under load that update can land first.
        runningAtSpawn.push(Number((await raw.query(`select count(*)::int n from agent_runs where status = 'running' and pid is distinct from $1`, [child.pid])).rows[0].n));
        await poRun(prompt);
        child.finish();
      } catch (err) {
        fakeErrors.push(String((err as Error)?.stack ?? err));
        child.finish("error_during_execution");
      }
    });
    return child;
  },
  kill: () => undefined,
  reportTokens: async () => undefined,
  probeUsage: async () => null,
});

/** The heartbeat and the asistente tick, by hand: start what is queued (one slot), wait for it, read the results. */
async function drainAll(): Promise<number> {
  let started = 0;
  for (let i = 0; i < 10; i += 1) {
    const out = await runner.drainQueue(db, new Date(), deps() as never);
    assert.ok(out.started <= 1, "one slot: never two runs at once");
    started += out.started;
    await runner.waitForAllRuns();
    await plan.resumeWaiting(db);
    const q = (await raw.query(`select count(*)::int n from agent_runs where status in ('queued', 'running')`)).rows[0].n;
    if (!q) break;
  }
  return started;
}

const cookie = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
const post = (p: string, body: unknown, method = "POST") => app.request(`/api/brief${p}`, { method, headers: { ...cookie(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
const getJson = async (p: string) => (await app.request(`/api/brief${p}`, { headers: cookie() })).json() as Promise<any>;
const count = async (sql: string, args: unknown[] = []) => Number((await raw.query(sql, args)).rows[0].n);
const serverMessages = (slug: string) => count(`select count(*)::int n from thread_messages m join threads t on t.id = m.thread_id join projects p on p.id = t.project_id where p.slug = $1 and m.author_agent = 'asistente'`, [slug]);
const runsOf = (po: string) => count(`select count(*)::int n from agent_runs r join agents a on a.id = r.agent_id where a.slug = $1`, [po]);

// A brief whose ideas are W1, W2, Z1.. Z3, X1 (codes as the server gives them).
const ok = (data: unknown): PassOutcome => ({ ok: true, data, attempts: 1, turns: 2, tokens: { input: 1, output: 2, cacheRead: 0, cacheCreate: 0, total: 3 }, models: [], logPath: path.join(scratch, "fake.jsonl") });
const IDEAS = {
  ideas: [
    { app: "workia", title: "Renewal board", why: "Contracts due soon." },
    { app: "workia", title: "Contract reminders", why: "Owners forget dates." },
    { app: "zigzag", title: "Route history", why: "Drivers ask for it." },
    { app: "zigzag", title: "Late-payer flag", why: "Shops ask." },
    { app: "zigzag", title: "Quote templates", why: "Same quotes every week." },
    { app: "cross", title: "One login for every app", why: "Five passwords today." },
  ],
};
async function newBrief(): Promise<{ id: string; codes: Map<string, string> }> {
  const spawnPass = (async (_db: unknown, input: { pass: string }) => (input.pass === "brief" ? ok({ items: [] }) : ok(IDEAS))) as never;
  const res = await pipeline.runBrief(db, { trigger: "manual" }, { env: ENV, tmpDir: path.join(scratch, "tmp"), liveRuns: () => [], pollMs: 5, buildBrief: async () => ["Corren 5 proyectos."], spawnPass } as never);
  const data = BriefData.parse((await raw.query(`select data from morning_briefs where id = $1`, [res.briefId])).rows[0].data);
  return { id: res.briefId!, codes: new Map(data.ideas.map((i) => [i.title, i.code])) };
}

before(async () => {
  raw = await resetTestDb();
  await raw.query(`insert into projects (slug, title, key_prefix) values ('plania', 'Plania', 'PLA')`);
  ({ db, close: closeDb } = makeDb() as never);
  await seedOrg(db);
  const plania = (await raw.query(`select id from projects where slug = 'plania'`)).rows[0].id;
  await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, 'Prompt: Product owner', '# PO\nPlan, never Ready.', '{"agent":"t","session_id":"s"}'::jsonb)`, [plania]);
  await raw.query(`insert into goals (project_id, title) select id, 'Ship the beta' from projects`);
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 1, cooldown_minutes = 0, plan_guard_pct = 70`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, now() + interval '3 hours')`);
  await saveBriefSettings(db, { github_mode: "off", projects: { workia: { order: 0 }, zigzag: { order: 1 }, filmia: { order: 2 }, micasa: { order: 3 }, plania: { order: 4 } } });
});

after(async () => {
  setBriefApiDepsForTests({});
  await runner.waitForAllRuns();
  await closeDb?.();
  await raw.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("acceptance 9 (D3): W1 + W2, Z3, X1 → three PO runs one after another; each plans fully, none Ready; a resend repeats nothing", async () => {
  await raw.query(`update projects set runs_paused = false where slug in ('workia', 'zigzag', 'plania')`);
  const brief = await newBrief();
  const W1 = brief.codes.get("Renewal board")!;
  const W2 = brief.codes.get("Contract reminders")!;
  const Z3 = brief.codes.get("Quote templates")!;
  const X1 = brief.codes.get("One login for every app")!;
  assert.deepEqual([W1, W2, Z3, X1], ["W1", "W2", "Z3", "X1"]);
  readyFor = new Set(["Z3"]); // po-zigzag leaves one ticket Ready by mistake: the guard puts it back.

  const res = await post("/plan", { brief_id: brief.id, codes: [W1, W2, Z3, X1] });
  assert.equal(res.status, 202);
  const sent = (await res.json()) as Awaited<ReturnType<typeof plan.sendToPlania>>;
  assert.deepEqual(sent.targets.map((t) => [t.slug, t.po_agent, t.codes]), [["workia", "po-workia", ["W1", "W2"]], ["zigzag", "po-zigzag", ["Z3"]], ["plania", "po-plania", ["X1"]]]);
  assert.equal(sent.runs, 3);
  assert.deepEqual(sent.estimate_min, [30, 75]);
  for (const s of ["workia", "zigzag", "plania"]) assert.equal(await serverMessages(s), 1, `"Plan these ideas" in the ${s} thread`);
  assert.equal(await count(`select count(*)::int n from agent_runs where status = 'queued'`), 3);

  // The runner starts them one at a time in the single slot.
  const started = await drainAll();
  assert.deepEqual(fakeErrors, []);
  assert.equal(started, 3);
  assert.deepEqual(runningAtSpawn, [0, 0, 0], "no other run was live when each one was spawned");
  const spans = (await raw.query(`select a.slug, r.status, r.started_at, r.ended_at from agent_runs r join agents a on a.id = r.agent_id order by r.started_at`)).rows;
  assert.deepEqual(spans.map((r: { slug: string; status: string }) => [r.slug, r.status]), [["po-workia", "ok"], ["po-zigzag", "ok"], ["po-plania", "ok"]]);
  for (let i = 1; i < spans.length; i += 1) assert.ok(spans[i].started_at >= spans[i - 1].ended_at, "never two at once: each starts after the previous ended");
  assert.deepEqual(spawnedPos, ["po-workia", "po-zigzag", "po-plania"]);
  assert.equal(await runsOf("po-workia"), 1, "W1 + W2 is one po-workia run");

  const p = await getJson(`/plan/${sent.request_id}`);
  assert.equal(p.status, "done");
  for (const i of p.ideas) {
    const r = i.result;
    assert.equal(r.status, "created", i.code);
    assert.ok(r.ticket_keys.length >= 1);
    const ini = (await raw.query(`select id, status, kind from tasks where key = $1`, [r.initiative_key])).rows[0];
    assert.deepEqual([ini.kind, ini.status], ["initiative", "Planning"]);
    const planDoc = (await raw.query(`select markdown from docs where task_id = $1 and title = 'Plan'`, [ini.id])).rows[0].markdown as string;
    for (const h of PLAN_HEADINGS) assert.ok(planDoc.includes(h), `${i.code} Plan doc has ${h}`);
    const idea = (await raw.query(`select t.kind, t.status, d.markdown from tasks t join docs d on d.task_id = t.id and d.title = 'Idea' where t.key = $1`, [r.idea_key])).rows[0];
    assert.deepEqual([idea.kind, idea.status], ["idea", "Open"]);
    for (const h of IDEA_HEADINGS) assert.ok(idea.markdown.includes(h));
    assert.match(idea.markdown, new RegExp(`Initiative ${r.initiative_key}\\.`));
    const tickets = (await raw.query(`select status from tasks where key = any($1::text[])`, [r.ticket_keys])).rows.map((t: { status: string }) => t.status);
    assert.ok(tickets.every((s: string) => s === "Backlog"), `${i.code}: ${tickets}`);
  }
  // X1 lands in plania.
  assert.match(p.ideas.find((i: any) => i.code === "X1").result.initiative_key, /^PLA-I\d+$/);
  assert.equal(p.ideas.find((i: any) => i.code === "X1").slug, "plania");
  // None ends Ready anywhere; the one made Ready was put back and reported.
  assert.equal(await count(`select count(*)::int n from tasks where kind = 'ticket' and status = 'Ready'`), 0);
  const z3 = p.ideas.find((i: any) => i.code === "Z3").result;
  assert.match(z3.note, /was Ready: put back to Backlog/);
  // The page's progress and the company thread show the keys.
  const company = (await raw.query(`select m.body from thread_messages m join threads t on t.id = m.thread_id where t.kind = 'company'`)).rows.map((r: { body: string }) => r.body);
  assert.equal(company.length, 1);
  for (const i of p.ideas) assert.ok(company[0]!.includes(`${i.code} planned as ${i.result.initiative_key}`), String(company[0]));

  // Sending the same codes again repeats nothing.
  const before = { tasks: await count(`select count(*)::int n from tasks`), runs: await count(`select count(*)::int n from agent_runs`), msgs: await count(`select count(*)::int n from thread_messages`) };
  const again = (await (await post("/plan", { brief_id: brief.id, codes: [W1, W2, Z3, X1] })).json()) as Awaited<ReturnType<typeof plan.sendToPlania>>;
  assert.equal(again.request_id, sent.request_id);
  assert.deepEqual(again.already_sent, ["W1", "W2", "Z3", "X1"]);
  assert.equal(again.runs, 0);
  assert.equal(await drainAll(), 0);
  assert.deepEqual({ tasks: await count(`select count(*)::int n from tasks`), runs: await count(`select count(*)::int n from agent_runs`), msgs: await count(`select count(*)::int n from thread_messages`) }, before);
  readyFor = new Set();
});

test("acceptance 16 (D7): with zigzag paused, Z1 waits; the next brief asks to turn runs on; runs on → posted and woken once; item gone", async () => {
  await raw.query(`update projects set runs_paused = true where slug = 'zigzag'`);
  const brief = await newBrief();
  const Z1 = brief.codes.get("Route history")!;
  assert.equal(Z1, "Z1");
  const zigMsgs = await serverMessages("zigzag");
  const zigRuns = await runsOf("po-zigzag");

  const res = await post("/plan", { brief_id: brief.id, codes: [Z1] });
  const sent = (await res.json()) as Awaited<ReturnType<typeof plan.sendToPlania>>;
  assert.deepEqual(sent.targets.map((t) => [t.slug, t.state, t.note]), [["zigzag", "waiting_paused", "Zigzag runs are paused"]]);
  assert.equal(await serverMessages("zigzag"), zigMsgs, "nothing posted in the zigzag thread");
  assert.equal(await runsOf("po-zigzag"), zigRuns, "no wake queued");
  const waiting = await getJson(`/plan/${sent.request_id}`);
  assert.deepEqual([waiting.ideas[0].state, waiting.ideas[0].note], ["waiting_paused", "Zigzag runs are paused"]);

  // The next brief has "Turn on runs for Zigzag to plan Z1"; checking it keeps it hidden on later briefs.
  const turnOn = async () => {
    const latest = await getJson("/latest");
    const item = latest.brief.data.items.find((i: any) => /^Turn on runs for Zigzag to plan /.test(i.title));
    return { item, checks: latest.checks as string[] };
  };
  await newBrief();
  const first = await turnOn();
  assert.equal(first.item?.title, "Turn on runs for Zigzag to plan Z1");
  assert.equal(first.item.status, "needs_you");
  assert.equal((await post(`/checks/${encodeURIComponent(first.item.id)}`, {}, "PUT")).status, 200);
  await newBrief();
  const second = await turnOn();
  assert.equal(second.item.id, first.item.id, "same stable id");
  assert.ok(second.checks.includes(first.item.id), "checked, so hidden in Not checked");

  // Runs on (Compañía's switch): the next asistente tick posts and wakes po-zigzag, once.
  await raw.query(`update projects set runs_paused = false where slug = 'zigzag'`);
  asistente.resetAsistenteForTests();
  const tick = await asistente.runAsistente(db, new Date(), { env: ENV, brief: { env: ENV, liveRuns: () => [] } as never });
  assert.equal(tick.plan_posted, 1);
  assert.equal(await serverMessages("zigzag"), zigMsgs + 1);
  assert.equal(await runsOf("po-zigzag"), zigRuns + 1);
  for (let i = 0; i < 3; i += 1) await asistente.runAsistente(db, new Date(), { env: ENV, brief: { env: ENV, liveRuns: () => [] } as never });
  assert.equal(await serverMessages("zigzag"), zigMsgs + 1, "no second message on later ticks");
  assert.equal(await runsOf("po-zigzag"), zigRuns + 1, "no second wake on later ticks");

  // The run plans it; the item is gone from the next brief.
  assert.equal(await drainAll(), 1);
  assert.equal((await getJson(`/plan/${sent.request_id}`)).status, "done");
  await newBrief();
  assert.equal((await turnOn()).item, undefined);
});
