// PLA-I30-2/3: the Compañía read gains viewer, prompts, roster and project_facts; the project sheet and the
// prompt doc are new cookie-only reads. Existing fields keep their meaning. Fake data on the throwaway test DB.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { TEST_BEARER, resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");

let store: TestStore;
const cookie = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
type Json = Record<string, any>;
const get = async (path: string, headers: Record<string, string> = cookie()) => {
  const res = await app.request(path, { headers });
  return { status: res.status, body: (await res.json()) as Json };
};

before(async () => {
  store = await resetTestStore();
  await store.fix(async (uow) => {
    await uow.insert("projects", { slug: "plania", title: "Plania", keyPrefix: "PLA" });
    await uow.insert("projects", { slug: "mianovia", title: "Mianovia", keyPrefix: "MIA" });
  });
  await seedOrg(makeDb().db);
  const pla = await store.projectId("plania");
  const mia = await store.projectId("mianovia");
  const actor = { agent: "test", session_id: "s" };
  const po = (await store.get("agents", { slug: "po-mianovia" }))!.id;
  await store.fix(async (uow) => {
    for (const title of ["Prompt: Product owner", "Prompt: Taller", "Prompt: Research", "Prompt: Artist", "Prompt: Asistente"]) {
      await uow.insert("docs", { projectId: pla, title, markdown: `# ${title}\n\nTexto de prueba.`, actor });
    }
    await uow.insert("docs", { projectId: pla, title: "Secreto", markdown: "no", actor });
    await uow.insert("goals", { projectId: mia, title: "Que una novia arme su lista en cinco minutos." });
    const t = (key: string, status: string, extra = "") =>
      uow.insert("tasks", { projectId: mia, key, title: `Ticket ${key}`, kind: "ticket", status, ...(extra ? { blockedNote: extra } : {}) });
    await t("MIA-1", "In progress");
    await t("MIA-2", "Blocked", "espera la API de pagos");
    await t("MIA-3", "Ready");
    await uow.insert("tasks", { projectId: mia, key: "MIA-IDEA1", title: "Filtros por precio", kind: "idea", status: "Open", stage: "design" });
    const now = Date.now();
    await uow.insert("agentRuns", {
      agentId: po, projectId: mia, role: "product-owner", status: "ok", taskKey: "MIA-IDEA1",
      startedAt: new Date(now - 3_600_000), endedAt: new Date(now - 50 * 60_000), tokensTotal: 42000, summary: "escribió 2 ideas",
    });
  });
});

after(async () => {
  await store?.end();
});

// PLA-I32-6: GET /api/company is now the Plan's read contract (test/i32-contract.test.ts); these facts are
// still computed by companyExtras, read here directly.
test("companyExtras computes viewer, prompts, roster and project_facts", async () => {
  const { companyExtras } = await import("../src/api/company-extra.js");
  const { makeDb } = await import("../src/db/client.js");
  const { db, close } = makeDb();
  const body = JSON.parse(JSON.stringify(await companyExtras(db))) as Json;
  await close();
  assert.deepEqual(body.viewer, { can_edit_limits: true });
  const docs = (await store.find("docs")).filter((d) => d.title.startsWith("Prompt: "));
  const byTitle = Object.fromEntries(docs.map((d) => [d.title, d.id]));
  assert.equal(body.prompts.taller.doc_id, byTitle["Prompt: Taller"]);
  assert.equal(body.prompts["product-owner"].doc_id, byTitle["Prompt: Product owner"]);
  assert.equal(body.prompts.asistente.doc_id, byTitle["Prompt: Asistente"]);
  const roles = new Set(body.roster.map((r: Json) => r.role));
  assert.deepEqual([...roles].sort(), ["artist", "asistente", "product-owner", "research", "taller"]);
  assert.equal(body.roster.find((r: Json) => r.slug === "po-mianovia").project, "mianovia");
  assert.equal(body.roster.some((r: Json) => ["cursor", "coach", "claude-code"].includes(r.slug)), false);
  const mia = body.project_facts.mianovia;
  assert.equal(mia.goal, "Que una novia arme su lista en cinco minutos.");
  assert.deepEqual([mia.in_flight, mia.blocked], [1, 1]);
  assert.equal(mia.po.slug, "po-mianovia");
  assert.equal(mia.last_run.tokens, 42000);
  assert.equal(body.project_facts.micasa.goal, null);
  assert.equal(JSON.stringify(body).includes("usd"), false);
});

test("the project sheet carries goal, pipeline, en curso, bloqueado, siguiente and runs with tokens", async () => {
  const { status, body } = await get("/api/company/projects/mianovia");
  assert.equal(status, 200);
  assert.equal(body.goal, "Que una novia arme su lista en cinco minutos.");
  assert.deepEqual(body.pipeline.map((s: Json) => s.stage), ["idea", "research", "design", "planning", "ready"]);
  assert.deepEqual(body.pipeline.find((s: Json) => s.stage === "design"), { stage: "design", count: 1, newest: "Filtros por precio" });
  assert.deepEqual(body.in_progress.map((t: Json) => t.key), ["MIA-1"]);
  assert.deepEqual(body.blocked.map((t: Json) => [t.key, t.why]), [["MIA-2", "espera la API de pagos"]]);
  assert.deepEqual(body.next.map((t: Json) => t.key), ["MIA-3"]);
  assert.equal(body.runs[0].tokens, 42000);
  assert.equal((await get("/api/company/projects/nadie")).status, 404);
});

test("the prompt doc route reads role prompts only, and every new read is cookie-only", async () => {
  const id = (await store.get("docs", { title: "Prompt: Taller" }))!.id;
  const doc = await get(`/api/company/docs/${id}`);
  assert.equal(doc.status, 200);
  assert.equal(doc.body.title, "Prompt: Taller");
  assert.match(doc.body.markdown, /Texto de prueba/);
  const other = (await store.get("docs", { title: "Secreto" }))!.id;
  assert.equal((await get(`/api/company/docs/${other}`)).status, 404);
  for (const path of ["/api/company", "/api/company/projects/mianovia", `/api/company/docs/${id}`]) {
    assert.equal((await get(path, {})).status, 401, path);
    assert.equal((await get(path, { ...cookie(), Authorization: `Bearer ${TEST_BEARER}` })).status, 403, path);
  }
});
