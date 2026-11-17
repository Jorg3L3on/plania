// PLA-I32-5: Asistente as a runner role (woken by Jorge's message, routine acceptance; PLA-I41-6 replaced the 07:00
// brief run with the Morning brief pipeline), the idle PO's weekly proposal wake, budgets per project and for Asistente
// (role caps retired), and event wakes routed to the project's own team. Every process is a fake child;
// throwaway DB; nothing reaches a real claude or repo.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";
import { ne, type NewRow } from "../src/store/types.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const runner = await import("../src/runner/runner.js");
const asistente = await import("../src/runner/asistente.js");
const { wakeAgent } = await import("../src/jobs/heartbeat.js");
const { DENY_RULES } = await import("../src/runner/deny.js");

type Db = ReturnType<typeof makeDb>["db"];
let store: TestStore;
let db: Db;
let closeDb: () => Promise<void>;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i32-runner-"));
const A = { actor: { agent: "test-agent", session_id: "s-i32-runner" } };
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  finish(subtype = "success"): void {
    const result = { type: "result", subtype, is_error: subtype !== "success", num_turns: 2, session_id: "sess-i32", result: "OK", modelUsage: { "claude-opus-5-5": { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
    this.stdout.write(`${JSON.stringify(result)}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", subtype === "success" ? 0 : 1, null));
  }
}

function fakes() {
  const spawned: { args: string[]; cwd: string; child: FakeChild }[] = [];
  let pid = 50_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: path.join(scratch, "worktrees"),
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async () => ({ code: 0, stdout: "", stderr: "" }),
    spawn: (_command: string, args: string[], options: { cwd: string }) => {
      const child = new FakeChild(++pid);
      spawned.push({ args, cwd: options.cwd, child });
      return child;
    },
    kill: () => undefined,
    reportTokens: async () => undefined,
    probeUsage: async () => null,
  };
  return { deps, spawned };
}

const pid = async (slug: string) => store.projectId(slug);
const aid = async (slug: string) => (await store.get("agents", { slug }))!.id;
const queued = async () => {
  const slugs = new Map((await store.find("agents")).map((a) => [a.id, a.slug]));
  return (await store.find("agentRuns", { status: ["queued", "running"] }, { orderBy: [{ column: "queuedAt" }] }))
    .filter((r) => slugs.has(r.agentId))
    .map((r) => ({ slug: slugs.get(r.agentId)!, status: r.status, task_key: r.taskKey, summary: r.summary }));
};
const companyMessages = async () =>
  ((await (await app.request("/api/threads/company", { headers: jorge() })).json()) as { messages: { author: { agent: string }; body: string }[] }).messages;
// A fresh plan reading at a given time, so the runner's plan guard reads "ok" then.
const readingAt = async (at: Date) => {
  await store.fix(async (uow) => {
    await uow.delete("planReadings", {});
    await uow.insert("planReadings", { at, source: "stream", status: "allowed", fiveHourPct: 10, fiveHourResetsAt: new Date(at.getTime() + 3 * 3_600_000) });
  });
};
// The runner's one settings row. The migration seeds it on Postgres; a fresh devva store has none until first read.
const runnerSettings = (patch: Partial<NewRow<"runnerSettings">>) =>
  store.fix(async (uow) => ((await uow.get("runnerSettings", { id: 1 })) ? uow.update("runnerSettings", { id: 1 }, patch) : uow.insert("runnerSettings", { id: 1, ...patch })));
// Every goal, and the links to them Postgres would clear (tasks.goal_id is on delete set null).
const deleteGoals = () =>
  store.fix(async (uow) => {
    const ids = (await uow.find("goals")).map((g) => g.id);
    await uow.update("tasks", { goalId: ids }, { goalId: null });
    await uow.delete("goals", {});
  });
const insertGoals = async () => {
  const [micasa, mianovia] = [await pid("micasa"), await pid("mianovia")];
  await store.fix(async (uow) => {
    await uow.insert("goals", { projectId: micasa, title: "Lanzar la beta" });
    await uow.insert("goals", { projectId: mianovia, title: "Primera boda" });
  });
};
const deleteRuns = () => store.fix((uow) => uow.delete("agentRuns", {}));
const wakesOn = { tz: "America/Mexico_City", env: { PLANIA_EVENT_WAKES: "1", PLANIA_HOME_PROJECT: "zigzag" } as NodeJS.ProcessEnv };

before(async () => {
  store = await resetTestStore();
  await store.fix((uow) => uow.insert("projects", { slug: "mianovia", title: "Mianovia", keyPrefix: "MIA" }));
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const actor = { agent: "test", session_id: "s" };
  const micasa = await pid("micasa");
  await store.fix(async (uow) => {
    for (const title of ["Prompt: Product owner", "Prompt: Taller", "Prompt: Research", "Prompt: Artist", "Prompt: Asistente"]) {
      await uow.insert("docs", { projectId: micasa, title, markdown: `# ${title}\nNever main.`, actor });
    }
  });
  await insertGoals();
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  asistente.resetAsistenteForTests();
  await store.fix(async (uow) => {
    await uow.delete("agentRuns", {});
    await uow.delete("heartbeatRuns", {});
    const stale = (await uow.find("events")).filter((e) => e.type.startsWith("asistente.") || e.type === "po.propose_queued");
    await uow.delete("events", { id: stale.map((e) => e.id) });
  });
  await runnerSettings({ companyPaused: false, maxConcurrent: 2, cooldownMinutes: 0, planGuardPct: 70, reserveTokens: 1000 });
  await store.fix(async (uow) => {
    await uow.update("projects", {}, { runsPaused: true });
    await uow.update("projects", { slug: ["micasa", "mianovia"] }, { runsPaused: false });
  });
  await readingAt(new Date());
  await deleteGoals();
  await insertGoals();
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await store?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("I32-5 #1: Jorge's message wakes Asistente; the queued run starts, runs with no ticket and says why it woke", async () => {
  const f = fakes();
  const res = await app.request("/api/threads/company/messages", { method: "POST", headers: jorge(), body: JSON.stringify({ body: "Mianovia: quiero la lista de invitados" }) });
  assert.equal(res.status, 201);
  assert.deepEqual((await queued()).map((r) => [r.slug, r.status]), [["asistente", "queued"]]);
  const drained = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(drained.started, 1, "home project zigzag is paused; Asistente runs anyway");
  const prompt = f.spawned[0]!.args[f.spawned[0]!.args.indexOf("-p") + 1]!;
  assert.match(prompt, /chief of staff/);
  assert.match(prompt, /Why you woke: message from Jorge\./);
  assert.match(prompt, /thread_read company/);
  // Asistente never merges: the deny rules every run gets hold for it too.
  assert.ok(DENY_RULES.includes("Bash(gh pr merge*)"));
  f.spawned[0]!.child.finish();
  await runner.waitForAllRuns();
  const [r] = await store.find("agentRuns");
  const run = r && { status: r.status, role: r.role, slug: (await store.get("projects", { id: r.projectId }))!.slug };
  assert.deepEqual(run, { status: "ok", role: "asistente", slug: "zigzag" });
});

// PLA-I41-6 (D1): the free-text Asistente brief run is gone; the 07:00 step starts the Morning brief pipeline.
// Wakes on and an Asistente agent present: on four days in a row, from 06:00 to 13:00, nothing is ever queued for
// the brief and no asistente.brief_run event is written; one Morning brief a day is stored and projected instead.
test("PLA-I41-6 check 4: no Asistente brief run is ever queued; the Morning brief is stored instead (fake spawnPass)", async () => {
  await deleteGoals();
  const schedule = await import("../src/brief/schedule.js");
  let clock = new Date("2026-11-10T12:00:00Z");
  const spawned: string[] = [];
  const brief = {
    now: () => clock,
    liveRuns: () => [],
    pollMs: 1,
    tmpDir: path.join(scratch, "brief-tmp"),
    spawnPass: async (_db: unknown, input: { pass: string }) => {
      spawned.push(input.pass);
      return { ok: false, reason: "error", summary: "fake pass", attempts: 1, logPath: null } as never;
    },
  };
  const env = { ...wakesOn.env, PLANIA_BRIEF_TOKEN: "fake-read-token" } as NodeJS.ProcessEnv;
  for (let day = 0; day < 4; day += 1) {
    const start = Date.parse("2026-11-10T12:00:00Z") + day * 86_400_000; // 06:00 local
    for (let t = start; t <= start + 7 * 3_600_000; t += 15 * 60_000) {
      clock = new Date(t);
      await readingAt(clock);
      await asistente.runAsistente(db, clock, { ...wakesOn, env, brief });
      await schedule.waitForScheduledBrief();
    }
  }
  const slugs = new Map((await store.find("agents")).map((a) => [a.id, a.slug]));
  const runs = (await store.find("agentRuns")).filter((r) => slugs.has(r.agentId)).map((r) => ({ slug: slugs.get(r.agentId)!, summary: r.summary }));
  assert.equal(runs.filter((r) => /brief/i.test(r.summary)).length, 0, "no run was queued for the brief");
  assert.ok(runs.filter((r) => r.slug === "asistente").every((r) => r.summary.includes("2-hour check")), "Asistente runs only for the 2-hourly check");
  assert.equal(await store.count("events", { type: "asistente.brief_run" }), 0);
  const briefs = (await store.find("morningBriefs", {}, { orderBy: [{ column: "localDate" }] }))
    .filter((b) => b.localDate >= "2026-11-10" && b.localDate <= "2026-11-13")
    .map((b) => ({ d: b.localDate, trigger: b.trigger }));
  assert.deepEqual(briefs, ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].map((d) => ({ d, trigger: "schedule" })), "one scheduled Morning brief a day");
  assert.deepEqual(spawned, Array(4).fill(["brief", "ideas"]).flat(), "pass A then pass B, once a day");
  const ev = (await store.find("events", { type: "asistente.brief" }, { orderBy: [{ column: "id" }] })).map((r) => r.payload);
  assert.ok(ev.length >= 4 && ev.every((p) => p.source === "morning_brief" && p.link === "/brief"), "Brief de hoy is the 0-token projection");
  assert.equal((await companyMessages()).some((m) => m.body.startsWith("Resumen del servidor")), false, "no free-text summary in the company thread");
});

test("I32-5 #2: a PO's ticket In review that Jorge asked for, with its checks done, is accepted by Asistente with a line", async () => {
  const thread = await app.request("/api/threads/micasa/messages", { method: "POST", headers: jorge(), body: JSON.stringify({ body: "Escribe el texto de bienvenida" }) });
  const key = ((await thread.json()) as { created: { key: string } }).created.key;
  await deleteRuns();
  const [t] = await store.fix((uow) => uow.update("tasks", { key }, { status: "In review" }));
  // Not yet: a check is open.
  assert.equal(await asistente.routineAccept(db, new Date()), 0);
  await store.fix((uow) => uow.update("checks", { taskId: t!.id }, { done: true, doneAt: uow.now }));
  // A PO line about it, which loses its buttons once accepted.
  const micasa = await pid("micasa");
  await store.fix(async (uow) => {
    for (const thread of await uow.find("threads", { projectId: micasa })) {
      await uow.insert("threadMessages", { threadId: thread.id, authorAgent: "po-micasa", authorRole: "product-owner", body: "Listo", links: [{ kind: "ticket", ref: key, title: "x" }] });
    }
  });
  // An unrelated ticket of Taller's in review stays untouched.
  const other = (await writes.createTask(db, { project: "micasa", title: "Código", scope: "s", checks: ["c"], work_type: "ops", owner_agent: "taller-micasa" } as never, A)) as { key: string };
  const [o] = await store.fix((uow) => uow.update("tasks", { key: other.key }, { status: "In review", origin: "jorge" }));
  await store.fix((uow) => uow.update("checks", { taskId: o!.id }, { done: true }));

  const out = await asistente.runAsistente(db, new Date("2026-11-13T20:00:00Z"), wakesOn);
  assert.equal(out.accepted, 1);
  assert.equal((await store.get("tasks", { key }))!.status, "Done");
  assert.equal((await store.get("tasks", { key: other.key }))!.status, "In review");
  const msgs = ((await (await app.request("/api/threads/micasa", { headers: jorge() })).json()) as { messages: { author: { agent: string }; body: string; action_state: unknown }[] }).messages;
  assert.match(msgs.at(-1)!.body, new RegExp(`^Acepté ${key}`));
  assert.equal(msgs.at(-1)!.author.agent, "asistente");
  assert.ok(msgs.find((m) => m.author.agent === "po-micasa" && m.body === "Listo")!.action_state, "the PO's line is marked accepted");
  assert.ok((await asistente.buildBrief(db, new Date())).some((l) => l.includes(`Acepté 1 entregable de rutina: ${key}`)));
});

test("I32-5: an idle PO with a goal is woken to propose ideas, at most once a week", async () => {
  const pos = (await store.find("agents", { slug: ["po-micasa", "po-mianovia"] })).map((a) => a.id);
  await store.fix((uow) => uow.update("tasks", { ownerAgent: pos, status: ne("Done") }, { status: "Done" }));
  await store.fix((uow) => uow.update("projects", { slug: "micasa" }, { runsPaused: true }));
  const n1 = await asistente.idleProposals(db, wakesOn.env, new Date());
  assert.equal(n1, 1);
  const [q] = await queued();
  assert.deepEqual([q!.slug, q!.task_key], ["po-mianovia", null]);
  assert.match(q!.summary, /propose 2-3 ideas/);
  await deleteRuns();
  assert.equal(await asistente.idleProposals(db, wakesOn.env, new Date()), 0, "once a week");
  assert.equal(await asistente.idleProposals(db, wakesOn.env, new Date(Date.now() + 8 * 24 * 3_600_000)), 1);
});

test("I32-5 #3 (PLA-21): no budget stops a team or Asistente, however much they spent this week", async () => {
  const f = fakes();
  await writes.createTask(db, { project: "micasa", key: "MIC-900", title: "Arreglo", scope: "s", checks: ["c"], status: "Ready", owner_agent: "taller-micasa" } as never, A);
  await deleteRuns();
  const [research, micasa, asistenteId, zigzag] = [await aid("research-micasa"), await pid("micasa"), await aid("asistente"), await pid("zigzag")];
  await store.fix((uow) => uow.insert("agentRuns", { agentId: research, projectId: micasa, role: "research", status: "ok", startedAt: uow.now, endedAt: uow.now, tokensTotal: 900_000_000 }));
  await store.fix((uow) => uow.insert("agentRuns", { agentId: asistenteId, projectId: zigzag, role: "asistente", status: "ok", startedAt: uow.now, endedAt: uow.now, tokensTotal: 900_000_000 }));
  const ok = await wakeAgent(db, { agent: "taller-micasa", taskKey: "MIC-900", now: new Date() }, { runner: f.deps as never });
  assert.equal(ok.run!.status, "running", ok.run!.summary);
  const asis = await wakeAgent(db, { agent: "asistente", now: new Date() }, { runner: f.deps as never });
  assert.doesNotMatch(asis.run!.summary, /BUDGET/);
  for (const s of f.spawned) s.child.finish();
  await runner.waitForAllRuns();
});

test("I32-5 #4: an event wake on a Mianovia ticket goes to taller-mianovia, never another project's Taller", async () => {
  await writes.createTask(db, { project: "mianovia", key: "MIA-1", title: "Invitaciones", scope: "s", checks: ["c"], work_type: "code" } as never, A);
  const t = (await store.get("tasks", { key: "MIA-1" }))!;
  await writes.setTask(db, { project: "mianovia", key: "MIA-1", status: "Ready", version: t.version } as never, A);
  assert.deepEqual((await queued()).map((r) => [r.slug, r.task_key]), [["taller-mianovia", "MIA-1"]]);

  // An idea moving to research wakes that project's Research.
  await deleteRuns();
  const idea = (await writes.createTask(db, { project: "mianovia", kind: "idea", title: "Mesa de regalos" } as never, A)) as { key: string };
  await store.fix(async (uow) => {
    for (const it of await uow.find("tasks", { key: idea.key })) {
      await uow.insert("docs", { projectId: it.projectId, taskId: it.id, title: "Idea", markdown: "# Idea", actor: { agent: "t", session_id: "s" } });
    }
  });
  const v = (await store.get("tasks", { key: idea.key }))!.version;
  const moved = await writes.setTask(db, { project: "mianovia", key: idea.key, stage: "research", version: v } as never, A).catch((e: Error) => e);
  if (!(moved instanceof Error)) assert.deepEqual((await queued()).map((r) => r.slug), ["research-mianovia"]);
});
