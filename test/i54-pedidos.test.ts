// PLA-I54-1: Pedir's two modes and the floor's tube. «Darle forma» makes an idea the PO shapes (kind idea, stage idea,
// origin jorge, owned by the PO) and wakes the PO on it; «Hacerlo ya» is the Ready ticket plus the wake; the company
// payload lists each project's pedidos with their stop and state. Throwaway store, fake values only.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import { ne, resetTestStore, useOwnerCode, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const runner = await import("../src/runner/runner.js");
const pedidos = await import("../src/api/company-pedidos.js");
const questionsMod = await import("../src/mcp/questions.js");
const docsMod = await import("../src/mcp/docs.js");

type Json = Record<string, any>;
let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i54-pedidos-"));
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const post = (url: string, body: Json) => app.request(url, { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const card = async (slug = "micasa"): Promise<Json> => {
  const res = await app.request("/api/company", { headers: jorge() });
  assert.equal(res.status, 200);
  return ((await res.json()) as Json).projects.find((p: Json) => p.slug === slug) as Json;
};
const queuedFor = async (slug: string) => {
  const agent = (await store.get("agents", { slug }))!;
  return (await store.find("agentRuns", { agentId: agent.id, status: "queued" }, { orderBy: [{ column: "queuedAt" }] })).map((r) => ({ task_key: r.taskKey, summary: r.summary }));
};
const ask = async (body: Json) => {
  const res = await post("/api/company/projects/micasa/ask", body);
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as Json;
};
const taskOf = async (key: string) => (await store.get("tasks", { key }))!;
const versionOf = async (key: string) => (await taskOf(key)).version;
const PO = (session = "run-0000aaaa") => ({ actor: { agent: "po-micasa", session_id: session } });

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  finish(): void {
    const result = { type: "result", subtype: "success", is_error: false, num_turns: 2, session_id: "sess-i54", result: "OK", modelUsage: { "claude-opus-5-5": { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
    this.stdout.write(`${JSON.stringify(result)}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", 0, null));
  }
}
function fakes() {
  const spawned: FakeChild[] = [];
  let n = 70_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude", PLANIA_EVENT_WAKES: "1" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: path.join(scratch, "worktrees"),
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async () => ({ code: 0, stdout: "", stderr: "" }),
    spawn: (_bin: string, args: string[]) => {
      const child = new FakeChild(++n);
      (child as unknown as { args: string[] }).args = args;
      spawned.push(child);
      return child;
    },
    kill: () => undefined,
    reportTokens: async () => undefined,
    probeUsage: async () => null,
  };
  return { deps, spawned };
}

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const actor = { agent: "test", session_id: "s" };
  const micasa = await store.projectId("micasa");
  await store.fix(async (uow) => {
    await uow.insert("docs", { projectId: micasa, title: "Prompt: Product owner", markdown: "# PO", actor });
    await uow.insert("goals", { projectId: micasa, title: "Lanzar la beta" });
  });
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  await store.fix(async (uow) => {
    await uow.delete("agentRuns", {});
    await uow.update("tasks", { kind: "ticket", status: ["Ready", "In progress"] }, { status: "Done" });
    await uow.update("tasks", { kind: "idea", status: "Open" }, { status: "Won't do" });
    await uow.update("runnerSettings", {}, { companyPaused: false, maxConcurrent: 2, cooldownMinutes: 0 });
    await uow.update("projects", { slug: ne("micasa") }, { runsPaused: true });
    await uow.update("projects", { slug: "micasa" }, { runsPaused: false });
    await uow.delete("planReadings", {});
    await uow.insert("planReadings", { at: uow.now, source: "stream", status: "allowed", fiveHourPct: 10, fiveHourResetsAt: new Date(uow.now.getTime() + 3 * 3_600_000) });
  });
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await store?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("I54-1 #1: Darle forma (the default) creates an idea owned by the PO, origin jorge, and wakes the PO on it", async () => {
  const out = await ask({ text: "Que el registro pida menos datos\nHoy son nueve campos." });
  assert.equal(out.mode, "forma");
  assert.equal(out.wake, "queued");
  assert.match(out.key, /^[A-Z]+-IDEA\d+$/);
  const t = await taskOf(out.key);
  const owner = t.ownerAgent ? ((await store.get("agents", { id: t.ownerAgent }))?.slug ?? null) : null;
  assert.deepEqual([t.kind, t.stage, t.status, t.origin, owner, t.title], ["idea", "idea", "Open", "jorge", "po-micasa", "Que el registro pida menos datos"]);
  assert.match(t.scope, /Darle forma\): "Que el registro pida menos datos\nHoy son nueve campos\."/);
  assert.match(t.scope, /`Entendí: …`/);
  assert.match(t.scope, /Nunca crees tickets para Taller/);
  assert.match(t.scope, /Constrúyelo/);
  const q = await queuedFor("po-micasa");
  assert.deepEqual(q.map((r) => r.task_key), [out.key]);
  assert.match(q[0]!.summary, /darle forma/);
  // The PO's run on it is told it is an idea, not a ticket, and why it woke.
  const f = fakes();
  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 1);
  const prompt = (f.spawned[0] as unknown as { args: string[] }).args[1]!;
  assert.match(prompt, new RegExp(`Ticket: ${out.key}`));
  assert.match(prompt, /This is an idea, not a ticket/);
  assert.match(prompt, /Why you woke: pedido de Jorge para darle forma/);
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();
});

test("I54-1 #2: Hacerlo ya is the Ready ticket for the PO plus the wake; an old client's {now} keeps its ticket", async () => {
  const out = await ask({ text: "Corrige el color del botón Guardar", mode: "ya" });
  assert.equal(out.mode, "ya");
  assert.ok(out.woke, "a wake was tried at once");
  const t = await taskOf(out.key);
  assert.deepEqual([t.kind, t.status, t.origin, t.workType], ["ticket", "Ready", "jorge", "ops"]);
  const old = await ask({ text: "Revisa los textos", now: false });
  assert.deepEqual([old.mode, old.woke], ["ya", null]);
  assert.equal((await taskOf(old.key)).kind, "ticket");
  // Too long and bad modes are refused.
  assert.equal((await post("/api/company/projects/micasa/ask", { text: "x".repeat(2001) })).status, 400);
  assert.equal((await post("/api/company/projects/micasa/ask", { text: "hola mundo", mode: "luego" })).status, 400);
  assert.equal((await post("/api/company/projects/micasa/ask", { text: "y".repeat(1800), mode: "forma" })).status, 201, "the textarea takes 2000");
});

test("I54-1 #3: the company payload lists each project's pedidos with stop and state", async () => {
  const a = (await ask({ text: "Recordatorio por WhatsApp un día antes" })).key as string;
  const b = (await ask({ text: "Compartir la ficha por enlace" })).key as string;
  const c = (await ask({ text: "Usar el panel sin conexión" })).key as string;
  let list = (await card()).pedidos as Json[];
  assert.deepEqual(list.map((x) => [x.key, x.stop, x.state, x.who, x.images, x.guardada]), [
    [a, "buzon", "cola", "product-owner", 0, false],
    [b, "buzon", "cola", "product-owner", 0, false],
    [c, "buzon", "cola", "product-owner", 0, false],
  ]);
  const runId = (await store.get("agentRuns", { taskKey: a }))!.id;
  // The PO takes a: a live run; it writes «Entendí» → entendido, trabajando.
  await store.fix((uow) => uow.update("agentRuns", { id: runId }, { status: "running", startedAt: uow.now }));
  await writes.setTask(db, { project: "micasa", key: a, note: "Entendí: un mensaje la víspera de cada prueba." } as never, PO(`run-${runId.slice(0, 8)}`));
  // b gets a question → espera; c moves to research (its Idea doc first) → investigacion, Research's.
  await questionsMod.ask(db, { project: "micasa", key: b, question: "¿El enlace vence?", options: ["Sí", "No"] } as never, PO(`run-${runId.slice(0, 8)}`));
  await docsMod.attachDoc(db, { project: "micasa", key: c, title: "Idea", markdown: "## Problem\nx\n## Who it is for\ny\n## Why now\nz" } as never, PO());
  await writes.setTask(db, { project: "micasa", key: c, stage: "research", version: await versionOf(c) } as never, PO());
  list = (await card()).pedidos as Json[];
  const by = new Map(list.map((x) => [x.key, x]));
  assert.deepEqual([by.get(a)!.stop, by.get(a)!.state, by.get(a)!.understood], ["entendido", "trabajando", "un mensaje la víspera de cada prueba."]);
  assert.deepEqual([by.get(b)!.stop, by.get(b)!.state, by.get(b)!.question.text], ["buzon", "espera", "¿El enlace vence?"]);
  assert.deepEqual([by.get(c)!.stop, by.get(c)!.who], ["investigacion", "research"]);
  // The run ends: a is quiet at Entendido.
  await store.fix((uow) => uow.update("agentRuns", { id: runId }, { status: "ok", endedAt: uow.now }));
  assert.equal(((await card()).pedidos as Json[]).find((x) => x.key === a)!.state, "quieta");
  // Every stage has its stop.
  assert.deepEqual(["idea", "research", "design", "planning", "ready"].map((s) => pedidos.stopOf(s, true)), ["entendido", "investigacion", "diseno", "plan", "lista"]);
  // A promoted, dropped or other-origin idea is not a pedido.
  await store.fix((uow) => uow.update("tasks", { key: b }, { status: "Won't do" }));
  await writes.createTask(db, { project: "micasa", kind: "idea", title: "Una idea del PO" } as never, PO());
  assert.deepEqual(((await card()).pedidos as Json[]).map((x) => x.key), [a, c]);
});

test("I54-1 #4 (PLA-I60): a Darle forma while the PO is busy is queued on its own and starts when the PO's slot frees", async () => {
  const f = fakes();
  const first = (await ask({ text: "Arma el plan del catálogo", mode: "ya" })).key as string;
  await runner.waitForAllRuns();
  await store.fix(async (uow) => {
    await uow.delete("agentRuns", {});
    await uow.update("tasks", { key: first }, { status: "Done" });
  });
  const busy = (await ask({ text: "Primero esto, que corre" })).key as string;
  const idea = (await ask({ text: "Y luego esta idea" })).key as string;
  assert.deepEqual((await queuedFor("po-micasa")).map((r) => r.task_key).sort(), [busy, idea].sort(), "each is a work item of its own");
  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 1, "the PO's cap (1) starts one");
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();
  assert.equal((await runner.drainQueue(db, new Date(), f.deps as never)).started, 1, "the other starts when the slot frees");
  f.spawned[1]!.finish();
  await runner.waitForAllRuns();
});
