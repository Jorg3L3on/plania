// PLA-I61 (La idea abierta): the trail names the role, Artist's frames live in Plania, one idea read with its stops and
// deliveries, «visto», answers that send the idea back and wake its owner, and the Diseño tab counting frames.
// Throwaway store and a scratch canvases folder; fake values only.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { resetTestStore, useOwnerCode, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
await useOwnerCode();
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i61-"));
const CANVASES = path.join(scratch, "canvases");
process.env.PLANIA_CAPTURES_DIR = path.join(scratch, "store");
process.env.PLANIA_CANVASES_ROOT = CANVASES;
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const docsMod = await import("../src/mcp/docs.js");
const { attachFrames } = await import("../src/pedidos/frames.js");
const { ensureMember } = await import("../src/runner/team.js");
const { roleOfSession } = await import("../src/api/company-pedido.js");
const { numbered } = await import("../src/api/company-idea.js");

type Json = Record<string, any>;
let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const post = (url: string, body: Json = {}) => app.request(url, { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const get = async (url: string) => {
  const res = await app.request(url, { headers: jorge() });
  return { status: res.status, body: (await res.json()) as Json };
};
const versionOf = async (key: string) => (await store.get("tasks", { key }))!.version;
const stageOf = async (key: string) => (await store.get("tasks", { key }))!.stage;
// The slugs of the agents with a run on a task (queued only when asked).
const runSlugs = async (key: string, status?: string) => {
  const slugs = new Map((await store.find("agents")).map((a) => [a.id, a.slug]));
  return (await store.find("agentRuns", status ? { taskKey: key, status } : { taskKey: key })).filter((r) => slugs.has(r.agentId)).map((r) => slugs.get(r.agentId)!);
};
// Every run, and the run locks that go with them (on delete cascade).
const deleteRuns = () =>
  store.fix(async (uow) => {
    await uow.delete("runLocks", {});
    await uow.delete("agentRuns", {});
  });
// The runner writes as plania-runner with a seat-named session.
const RUN = (seat: string) => ({ actor: { agent: "plania-runner", session_id: `${seat}-micasa-idea-20261117` } });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGM8IWLDwMDAxAAGUAoAFagBHl5+zA0AAAAASUVORK5CYII=", "base64");
const idea = async (text: string) => {
  const res = await post("/api/company/projects/micasa/ask", { text, mode: "forma" });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as Json).key as string;
};
const detail = async (key: string) => {
  const r = await get(`/api/company/projects/micasa/ideas/${key}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const RESEARCH = [
  "## What we learned",
  "Algo.",
  "## Options",
  "1. **shadcn + Radix.** La misma base que Workia.",
  "2. **shadcn + Base UI.** Sin migrar después.",
  "3. **Pieza por pieza.** Solo marcado.",
  "## Recommendation",
  "Opción 1 con el alcance de la 3.",
].join("\n");
// An idea of the owner's taken to Plan by the seats, as the runner writes it.
async function toPlan(text: string): Promise<string> {
  const key = await idea(text);
  await docsMod.attachDoc(db, { project: "micasa", key, title: "Idea", markdown: "## Problem\nx\n## Who it is for\ny\n## Why now\nz\n## Tamaño\nMediano.\n## Solución\nTema propio." }, RUN("po"));
  await writes.setTask(db, { project: "micasa", key, note: "Entendí: toda la app con shadcn." } as never, RUN("po"));
  await writes.setTask(db, { project: "micasa", key, stage: "research", version: await versionOf(key) } as never, RUN("po"));
  await docsMod.attachDoc(db, { project: "micasa", key, title: "Research", markdown: RESEARCH }, RUN("research"));
  await writes.setTask(db, { project: "micasa", key, stage: "design", version: await versionOf(key) } as never, RUN("research"));
  await docsMod.attachDoc(db, { project: "micasa", key, title: "Design", markdown: "## Approach\nx\n## Scope\ny\n## Out of scope\nz" }, RUN("artist"));
  mkdirSync(path.join(CANVASES, key), { recursive: true });
  writeFileSync(path.join(CANVASES, key, "t.png"), PNG);
  writeFileSync(path.join(CANVASES, key, "b1.png"), PNG);
  await attachFrames(
    db,
    {
      project: "micasa",
      key,
      frames: [
        { id: "T", name: "Tema", group: "Tema", hace: "Paleta", porque: "Un lugar", path: path.join(CANVASES, key, "t.png") },
        { id: "B1", name: "Listado", group: "Panel", hace: "Filtros", porque: "Igual que hoy", path: `${key}/b1.png` },
      ],
    },
    RUN("artist"),
  );
  await writes.setTask(db, { project: "micasa", key, stage: "planning", version: await versionOf(key) } as never, RUN("artist"));
  await deleteRuns();
  return key;
}

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const row = (await store.get("projects", { slug: "micasa" }))!;
  const p = { id: row.id, slug: row.slug, title: row.title };
  for (const t of ["research", "artist"] as const) await ensureMember(db, p, t, { reportsTo: "ceo", note: "test" });
  await store.fix((uow) => uow.insert("goals", { projectId: p.id, title: "Lanzar la beta" }));
});
beforeEach(async () => {
  await store.fix(async (uow) => {
    await uow.delete("runLocks", {});
    await uow.delete("agentRuns", {});
    await uow.update("runnerSettings", { id: 1 }, { companyPaused: false });
    await uow.update("projects", {}, { runsPaused: true });
    await uow.update("projects", { slug: "micasa" }, { runsPaused: false });
  });
});
after(async () => {
  await closeDb?.();
  await store?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("I61-1: a runner session is named by its seat in the trail", async () => {
  assert.equal(roleOfSession("research-mianovia-idea1-20261116"), "research");
  assert.equal(roleOfSession("po-mianovia-idea1"), "product-owner");
  assert.equal(roleOfSession("artist-x"), "artist");
  assert.equal(roleOfSession("web"), null);
  const key = await toPlan("Toda la app con shadcn");
  const d = await detail(key);
  const who = (kind: string) => d.trail.filter((x: Json) => x.kind === kind).map((x: Json) => x.who);
  assert.ok(who("doc").includes("research") && who("doc").includes("artist") && who("doc").includes("product-owner"), JSON.stringify(d.trail));
  assert.ok(!d.trail.some((x: Json) => x.who === "plania-runner"));
  assert.ok(d.trail.some((x: Json) => x.kind === "marcos" && x.text === "Subió 2 marcos del diseño."));
});

test("I61-2: attach_frames keeps the order, serves each frame, replaces the set and refuses paths outside the canvases folder", async () => {
  const key = await toPlan("Panel con piezas nuevas");
  const d = await detail(key);
  assert.deepEqual(d.frames.map((f: Json) => [f.frame, f.name, f.group, f.hace]), [["T", "Tema", "Tema", "Paleta"], ["B1", "Listado", "Panel", "Filtros"]]);
  assert.equal(d.frames[0].width, 2);
  const img = await app.request(d.frames[1].url, { headers: jorge() });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("Content-Type"), "image/png");
  assert.equal((await app.request(d.frames[1].url)).status, 401, "behind the owner's session");
  writeFileSync(path.join(scratch, "fuera.png"), PNG);
  await assert.rejects(attachFrames(db, { project: "micasa", key, frames: [{ id: "X", name: "x", path: path.join(scratch, "fuera.png") }] }, RUN("artist")), (e: Json) => e.code === "FRAME_INVALID");
  await assert.rejects(attachFrames(db, { project: "micasa", key, frames: [{ id: "X", name: "x", path: "../fuera.png" }] }, RUN("artist")), /FRAME_INVALID/);
  writeFileSync(path.join(CANVASES, key, "nota.txt"), "no soy imagen");
  await assert.rejects(attachFrames(db, { project: "micasa", key, frames: [{ id: "X", name: "x", path: `${key}/nota.txt` }] }, RUN("artist")), /FRAME_INVALID/);
  await attachFrames(db, { project: "micasa", key, frames: [{ id: "A1", name: "Registro", path: `${key}/t.png` }] }, RUN("artist"));
  assert.deepEqual((await detail(key)).frames.map((f: Json) => f.frame), ["A1"]);
  const ficha = (await get("/api/company/projects/micasa/ficha")).body;
  assert.ok(ficha.lienzos.some((l: Json) => l.key === key && l.count === 1), JSON.stringify(ficha.lienzos));
  assert.ok(ficha.counts.designs >= 1);
});

test("I61-3: the idea read has its six stops, each delivery, who and when; opening a stop marks it seen", async () => {
  const key = await toPlan("Recordatorios por WhatsApp");
  const d = await detail(key);
  assert.deepEqual(d.stops.map((s: Json) => s.stop), ["buzon", "entendido", "investigacion", "diseno", "plan", "lista"]);
  assert.deepEqual(d.stops.map((s: Json) => s.state), ["done", "done", "done", "done", "here", "todo"]);
  assert.deepEqual(d.stops.map((s: Json) => s.by), ["jorge", "product-owner", "research", "artist", null, null]);
  assert.equal(d.pedido, true);
  assert.equal(d.unseen, 3);
  assert.equal(d.research.recommendation, "Opción 1 con el alcance de la 3.");
  assert.deepEqual(d.research.options.map((o: Json) => [o.n, o.title]), [[1, "shadcn + Radix"], [2, "shadcn + Base UI"], [3, "Pieza por pieza"]]);
  assert.equal(d.ficha.tamano, "Mediano.");
  assert.ok(d.quiet_since, "nobody runs on it");
  assert.equal((await post(`/api/company/projects/micasa/ideas/${key}/visto`, { stop: "diseno" })).status, 200);
  const after1 = await detail(key);
  assert.equal(after1.stops.find((s: Json) => s.stop === "diseno").seen, true);
  assert.equal(after1.unseen, 2);
  assert.ok(!after1.trail.some((x: Json) => /visto/i.test(x.kind)), "seen stays out of the trail");
  assert.equal((await post(`/api/company/projects/micasa/ideas/${key}/visto`, { stop: "nope" })).status, 400);
  const ficha = (await get("/api/company/projects/micasa/ficha")).body;
  assert.equal(ficha.ideas.find((i: Json) => i.key === key).unseen, 2);
  // Any idea reads, not only the owner's requests.
  const other = await writes.createTask(db, { project: "micasa", kind: "idea", title: "Idea de un agente", scope: "s" } as never, RUN("po"));
  const o = await detail((other as Json).key);
  assert.equal(o.pedido, false);
  assert.equal((await get(`/api/company/projects/micasa/ideas/MIC-404`)).status, 404);
});

test("I61-4: me gusta marks the trail and undoes; pide cambios with notes sends it back to Diseño and wakes Artist", async () => {
  const key = await toPlan("Ficha de la novia con piezas");
  const url = `/api/company/projects/micasa/ideas/${key}/respuesta`;
  assert.equal((await post(url, { stop: "diseno", verdict: "ok" })).status, 200);
  let d = await detail(key);
  assert.equal(d.stops.find((s: Json) => s.stop === "diseno").answer.verdict, "ok");
  assert.ok(d.trail.some((x: Json) => x.kind === "veredicto" && x.text === "Te gustó el diseño."));
  assert.equal(await stageOf(key), "planning", "ok moves nothing");
  assert.equal((await post(url, { stop: "diseno", verdict: "deshacer" })).status, 200);
  d = await detail(key);
  assert.equal(d.stops.find((s: Json) => s.stop === "diseno").answer, null);
  assert.equal((await post(url, { stop: "diseno", verdict: "deshacer" })).status, 409, "nothing to undo");
  assert.equal((await post(url, { stop: "diseno", verdict: "cambios" })).status, 400, "changes need words or a note");
  const res = await post(url, { stop: "diseno", verdict: "cambios", notes: [{ frame: "B1", x: 52.4, y: 26, text: "Los filtros ocupan media pantalla" }, { frame: "T", x: 10, y: 10, text: "Más contraste" }] });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(await stageOf(key), "design");
  const woke = await runSlugs(key, "queued");
  assert.equal(woke.length, 1, JSON.stringify(woke));
  assert.match(woke[0]!, /artist/);
  const [last] = await store.find("events", { taskKey: key, type: "note" }, { orderBy: [{ column: "id", desc: true }], limit: 1 });
  const note = String((last!.payload as { text?: unknown }).text);
  assert.match(note, /Jorge pide cambios en Diseño/);
  assert.match(note, /Marco B1 \(Listado\), punto 52% desde la izquierda y 26% desde arriba: Los filtros ocupan media pantalla/);
  d = await detail(key);
  assert.deepEqual(d.stops.map((s: Json) => s.state), ["done", "done", "done", "here", "todo", "todo"]);
  assert.ok(d.trail.some((x: Json) => x.text === "Pediste cambios en el diseño con 2 notas."));
});

test("I61-4: another option sends it back to Investigación; correcting the PO goes back to Entendido and wakes the PO; despertar wakes the stage owner", async () => {
  const key = await toPlan("Exportar a Excel");
  const url = `/api/company/projects/micasa/ideas/${key}/respuesta`;
  assert.equal((await post(url, { stop: "investigacion", verdict: "opcion", option: 9 })).status, 400);
  assert.equal((await post(url, { stop: "investigacion", verdict: "opcion", option: 2 })).status, 200);
  assert.equal(await stageOf(key), "research");
  const research = await runSlugs(key);
  assert.deepEqual(research.filter((s) => /artist/.test(s)), [], "one move back: Artist is not woken on the way");
  assert.ok(research.some((s) => /research/.test(s)));
  await deleteRuns();
  assert.equal((await post(url, { stop: "entendido", verdict: "corregir" })).status, 400);
  assert.equal((await post(url, { stop: "entendido", verdict: "corregir", text: "No es la app entera, solo el registro" })).status, 200);
  assert.equal(await stageOf(key), "idea");
  const po = await runSlugs(key, "queued");
  assert.deepEqual(po, ["po-micasa"]);
  await deleteRuns();
  assert.equal((await post(`/api/company/projects/micasa/ideas/${key}/despertar`)).status, 200);
  const woke = await runSlugs(key, "queued");
  assert.deepEqual(woke, ["po-micasa"]);
  assert.ok((await detail(key)).trail.some((x: Json) => x.kind === "despertar"));
});

test("I61-2: Artist's brief on an idea asks for the frames with attach_frames", async () => {
  const { userPrompt } = await import("../src/runner/runner.js");
  const base = { agent: "artist-micasa", project: { slug: "micasa", title: "MiCasa" }, goal: null, task: { key: "MIC-IDEA3", title: "x" }, workspace: null, sessionId: "run-1" };
  assert.match(userPrompt({ ...base, role: "artist" }), /attach_frames \(key MIC-IDEA3\)/);
  assert.doesNotMatch(userPrompt({ ...base, role: "research" }), /attach_frames/);
  assert.doesNotMatch(userPrompt({ ...base, role: "artist", task: { key: "MIC-12", title: "x" } }), /attach_frames/);
});

test("I61-3: numbered options read bold titles, plain ones and long lists whole", () => {
  assert.deepEqual(numbered("1. **Uno.** texto\n2. Dos: más texto\n3. **Tres** y algo"), [
    { n: 1, title: "Uno", text: "texto" },
    { n: 2, title: "Dos", text: "más texto" },
    { n: 3, title: "Tres", text: "y algo" },
  ]);
  assert.deepEqual(numbered(null), []);
});

test("I61-6: each request counts the deliveries he has not opened and names the newest; Lista is not one", async () => {
  const key = await toPlan("Panel de citas por sucursal");
  const tube = async () => ((await get("/api/company")).body.projects as Json[]).find((p) => p.slug === "micasa")!.pedidos.find((x: Json) => x.key === key);
  let t = await tube();
  assert.deepEqual([t.unseen, t.unseen_stop], [3, "diseno"]);
  await post(`/api/company/projects/micasa/ideas/${key}/visto`, { stop: "diseno" });
  t = await tube();
  assert.deepEqual([t.unseen, t.unseen_stop], [2, "investigacion"]);
  await docsMod.attachDoc(db, { project: "micasa", key, title: "Plan", markdown: "## Steps\n1. Uno\n## Done when\nx\n## Risks\ny" }, RUN("po"));
  await writes.setTask(db, { project: "micasa", key, stage: "ready", version: await versionOf(key) } as never, RUN("po"));
  t = await tube();
  assert.deepEqual([t.unseen, t.unseen_stop], [3, "plan"]);
  const d = await detail(key);
  assert.equal(d.unseen, 3, "the idea view agrees, and Lista is not counted");
  assert.equal(d.stops.find((s: Json) => s.stop === "lista").seen, true);
});
