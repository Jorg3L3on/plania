// PLA-I46 phase 1 in the read contract, on a throwaway store with fake values:
//   I46-3  next_move on each card (the plan-next-leg move here; the pure cases are in test/i46-move-ui.test.ts)
//   I46-4  a project goal hanging under a company goal is the plate's goal; a delivered PR names its step in Spanish
//          («Paso N · <ticket title>»), or only «Paso N» when no ticket has that PR
//   I46-5  a week that is mostly cache reads: Máquina's main number is input + output, cache reads and writes apart,
//          and MCP usage_summary returns the same four parts and the same totals
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetTestStore, useOwnerCode, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { reportTokens } = await import("../src/mcp/usage.js");

type Json = Record<string, any>;
let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let client: Client;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const get = async (path: string): Promise<Json> => {
  const res = await app.request(path, { headers: jorge() });
  assert.equal(res.status, 200, path);
  return (await res.json()) as Json;
};
const card = async (): Promise<Json> => (await get("/api/company")).projects.find((p: Json) => p.slug === "micasa");
const PO = { actor: { agent: "po-micasa", session_id: "s-po" } };
const make = (input: Json) => writes.createTask(db, { project: "micasa", scope: "s", ...input } as never, PO);
const STEPS = ["Pantalla de gracias", "Exportar a Excel", "Repaso con la boutique", "Avisos al equipo"];
// A week that is 99 % cache reads: 4k of real work, 590k re-read from the cache, 22k written to it.
const RUN = { input: 3_000, output: 1_000, cache_read: 590_000, cache_create: 22_000 };

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await store.fix((uow) => uow.update("projects", {}, { runsPaused: false }));
  await make({ kind: "initiative", key: "MIC-I1", title: "Contacto, exportación y avisos" });
  for (const [i, step] of STEPS.entries()) await make({ key: `MIC-I1-${i + 1}`, parent_key: "MIC-I1", phase: i + 1, title: step, checks: ["c"], status: "Ready" });
  await make({ kind: "initiative", key: "MIC-I2", title: "Ajustes finales y entrega" });
  const pid = await store.projectId("micasa");
  await store.fix(async (uow) => {
    await uow.update("tasks", { projectId: pid, key: "MIC-I1" }, { status: "Active" });
    const steps = (await uow.find("tasks", { projectId: pid })).filter((t) => t.key.startsWith("MIC-I1-"));
    await uow.update("tasks", { id: steps.map((t) => t.id) }, { status: "Done", statusChangedAt: uow.now });
    await uow.update("tasks", { projectId: pid, key: "MIC-I1-4" }, { prUrl: "https://github.com/fake/micasa/pull/17" });
    // The project goal hangs under a company goal, as list_goals shows Mianovia's.
    const company = await uow.insert("goals", { projectId: null, title: "La compañía entrega" });
    await uow.insert("goals", { projectId: pid, parentId: company.id, title: "Registro listo para la boutique" });
  });

  // Taller delivered PR #17 (English title, the ticket's is Spanish); Research a PR no ticket has.
  const thread = (await get("/api/threads/micasa")) as { id: string };
  const say = (agent: string, role: string, ref: string, title: string) =>
    store.fix((uow) => uow.insert("threadMessages", { threadId: thread.id, authorAgent: agent, authorRole: role, body: "Listo", links: [{ kind: "pr", ref, title }] }));
  await say("taller-micasa", "taller", "https://github.com/fake/micasa/pull/17", "PR #17: Email the team when a registration arrives");
  await say("research-micasa", "research", "https://github.com/fake/micasa/pull/99", "Fix typo in README");

  const research = (await store.get("agents", { slug: "research-micasa" }))!;
  await store.fix((uow) =>
    uow.insert("agentRuns", {
      agentId: research.id,
      projectId: pid,
      taskKey: "MIC-I1-4",
      role: "research",
      status: "ok",
      startedAt: new Date(uow.now.getTime() - 60 * 60_000),
      endedAt: new Date(uow.now.getTime() - 50 * 60_000),
      inputTokens: RUN.input,
      outputTokens: RUN.output,
      cacheReadTokens: RUN.cache_read,
      cacheCreateTokens: RUN.cache_create,
      tokensTotal: RUN.input + RUN.output + RUN.cache_read + RUN.cache_create,
    }),
  );
  // What the runner reports for that run (src/runner/runner.ts): the four parts.
  await reportTokens(db, { project: "micasa", agent: "research-micasa", task_key: "MIC-I1-4", run_id: "r-1/opus", model: "opus", ...RUN, at: new Date().toISOString() }, { actor: { agent: "plania", session_id: "system" } } as never);

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "i46-test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await store?.end();
});

test("I46-3: GET /api/company carries next_move; the leg is complete and the next unplanned, so planning it is the owner's", async () => {
  const p = await card();
  assert.deepEqual(p.next_move, {
    verbo: "planear",
    texto: "Planear «Ajustes finales y entrega»",
    accion: { kind: "plan", text: "Planea «Ajustes finales y entrega»: sus pasos y qué significa hecho en cada uno.", label: "Que PO lo planee" },
    origen: { kind: "route", leg: "MIC-I2" },
  });
  // Once the PO runs on it, the move is gone: nothing asks the owner while the team works.
  const po = (await store.get("agents", { slug: "po-micasa" }))!;
  await store.fix((uow) => uow.insert("agentRuns", { agentId: po.id, projectId: po.projectId!, role: "product-owner", status: "running", startedAt: uow.now }));
  assert.equal((await card()).next_move, null);
  await store.fix((uow) => uow.delete("agentRuns", { status: "running" }));
});

test("I46-4 #1: a project goal under a company goal is the plate's goal, not «Sin meta»", async () => {
  const p = await card();
  assert.equal(p.goal, "Registro listo para la boutique");
  assert.equal(p.rumbo.goal, "Registro listo para la boutique");
});

test("I46-4 #3: a delivered PR names its step by the ticket's Spanish title; with only the PR's own title it says «Paso N»", async () => {
  const p = await card();
  const taller = p.team.find((m: Json) => m.agent === "taller-micasa");
  const research = p.team.find((m: Json) => m.agent === "research-micasa");
  assert.equal(taller.produced.title, "Paso 4 · Avisos al equipo");
  assert.equal(research.produced.title, "Paso 99");
  assert.equal(JSON.stringify(p.team).includes("Email the team"), false, "the English PR title never reaches a window");
});

test("I46-5: a week of mostly cache reads: Máquina's main number is input + output, cache apart; usage_summary agrees", async () => {
  const m = (await get("/api/machine")).plumbing;
  assert.deepEqual(m.usage.week, { used: 4_000, input: 3_000, output: 1_000, cache_read: 590_000, cache_create: 22_000 });
  const mine = m.usage.projects.find((x: Json) => x.slug === "micasa");
  assert.equal(mine.usage.used, 4_000, "a team's line is input + output too");
  assert.equal((await get("/api/company")).plumbing.spend, 4_000, "the sky's plumbing line uses input + output");

  const r = (await client.callTool({ name: "usage_summary", arguments: { project: "micasa" } })) as { content: { text: string }[] };
  const s = JSON.parse(r.content[0]!.text) as Json;
  const row = s.totals.find((t: Json) => t.agent === "research-micasa");
  assert.deepEqual([row.input, row.output, row.cache_read, row.cache_create], [3_000, 1_000, 590_000, 22_000], "the reported four parts");
  const { week, starts_at, ...screen } = s.screen;
  assert.match(week, /^\d{4}-W\d{2}$/);
  assert.ok(starts_at);
  assert.deepEqual(screen, m.usage.week, "the MCP's screen block is Máquina's week");
  const all = JSON.parse(((await client.callTool({ name: "usage_summary", arguments: {} })) as { content: { text: string }[] }).content[0]!.text) as Json;
  assert.equal(all.screen.used, m.usage.week.used);
});
