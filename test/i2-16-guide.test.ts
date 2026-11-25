// PLA-I2-16: the guide to a first delivery. From first start, each step ticks itself from data (GET /api/guia) as the
// owner does it on the screen's routes, and the guide goes away once a delivery is accepted. A run that could not
// start, or found Claude signed out, shows its reason and fix on the project page and in the guide: one case per
// start failure the runner writes (src/runner/start-failures.ts) plus the signed-out one.
// Throwaway DB and kit; no process is spawned.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const scratch = mkdtempSync(path.join(tmpdir(), "plania-i2-16-"));
const kit = path.join(scratch, "kit");
mkdirSync(path.join(kit, "roles"), { recursive: true });
for (const r of ["product-owner", "research", "artist", "taller"]) writeFileSync(path.join(kit, "roles", `${r}.md`), `# ${r}\n\nFixture prompt.\n`);
process.env.PLANIA_KIT_DIR = kit;
useTestEnv();
for (const k of ["PLANIA_EVENT_WAKES", "PLANIA_PASSWORD_HASH", "PLANIA_RUNNER_TOKEN", "PLANIA_HOME_PROJECT", "PLANIA_PROMPTS_PROJECT"]) delete process.env[k];

const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { issueSetupCode } = await import("../src/db/install.js");
const state = await import("../src/install-state.js");
const { setLatestMachineReading } = await import("../src/api/machine-check.js");
const { propose } = await import("../src/mcp/proposals.js");
const { START_FAILURES } = await import("../src/runner/start-failures.js");
const { ARRANQUE, arranqueLine } = await import("../ui/src/lib/arranque.js");
const ui = await import("../ui/src/lib/primera-entrega.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let cookie = "";
const LOOPBACK = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const headers = () => ({ Cookie: cookie, "Content-Type": "application/json" });
const get = async (url: string) => {
  const r = await app.request(url, { headers: headers() });
  assert.equal(r.status, 200, `${url}: ${await r.clone().text()}`);
  return (await r.json()) as Json;
};
const post = (url: string, body: unknown = {}) => app.request(url, { method: "POST", headers: headers(), body: JSON.stringify(body) });
const guia = () => get("/api/guia") as Promise<ReturnType<typeof Object> & Json>;
const estados = (r: Json) => Object.fromEntries(ui.pasosDe(r as never).map((p) => [p.id, p.estado]));

before(async () => {
  raw = await resetTestDb();
  await raw.query(`delete from projects`);
  ({ db, close: closeDb } = makeDb());
  state.resetInstallState();
  setLatestMachineReading(null);
  const envFile = path.join(scratch, ".env");
  writeFileSync(envFile, "");
  const code = await issueSetupCode(raw, envFile, () => "GUIA-GUIA-GUIA");
  const res = await app.request(
    "http://localhost:3737/api/first-start",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: "Ana", password: "una contraseña larga", time_zone: "Europe/Madrid" }) },
    LOOPBACK,
  );
  assert.equal(res.status, 201, await res.clone().text());
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
});

after(async () => {
  state.resetInstallState();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("I2-16 #2: after first start the guide shows six steps, none done, the machine first", async () => {
  const r = await guia();
  assert.equal(r.visible, true);
  assert.equal(r.proyecto, null, "Asistente's home is not the first project");
  assert.equal(r.maquina, "sin_revisar");
  assert.equal(r.company_paused, true);
  assert.equal(r.est_pct_per_run, 3);
  // The machine step is current beside the first project: a machine check that finds something does not block the rest.
  assert.deepEqual(estados(r), { maquina: "ahora", proyecto: "ahora", reanudar: "luego", pedido: "luego", plan: "luego", entrega: "luego" });
  assert.equal(ui.ofreceEjemplo(r as never), true);
  const pasos = ui.pasosDe(r as never);
  assert.equal(pasos[0]!.href, "/machine/falta");
  assert.equal(pasos[1]!.href, "/ceo?nuevo");
  assert.match(pasos[3]!.texto, /3 % de tu plan de cinco horas/, "the guide says how much of the plan a run uses");
});

test("I2-16 #2: each step ticks from data as the owner goes, and the guide goes away at the first accepted delivery", async () => {
  // Machine: the newest reading any page took.
  setLatestMachineReading({ items: [], ready: false, checked_at: new Date().toISOString() });
  assert.equal((await guia()).maquina, "falta");
  assert.equal(estados(await guia()).maquina, "ahora");
  setLatestMachineReading({ items: [], ready: true, checked_at: new Date().toISOString() });
  assert.deepEqual(estados(await guia()), { maquina: "hecho", proyecto: "ahora", reanudar: "luego", pedido: "luego", plan: "luego", entrega: "luego" });

  // First project: the example (no code, paused, its team). A second click is refused.
  const made = await post("/api/guia/ejemplo");
  assert.equal(made.status, 201, await made.clone().text());
  const ej = (await made.json()) as Json;
  assert.equal(ej.slug, "ejemplo");
  assert.equal((await raw.query(`select settings->'local'->>'no_code' as nc, runs_paused from projects where slug = 'ejemplo'`)).rows[0].nc, "true");
  assert.equal((await post("/api/guia/ejemplo")).status, 409);
  let r = await guia();
  assert.deepEqual(r.proyecto, { slug: "ejemplo", title: "Ejemplo" });
  assert.equal(estados(r).proyecto, "hecho");
  assert.equal(estados(r).reanudar, "ahora");
  // F6: both paused; the guide's one «Iniciar proyecto» resumes the two, and its words say so.
  const paso = ui.pasosDe(r as never, "es")[2]!;
  assert.equal(paso.accion, "reanudar");
  assert.equal(paso.texto, "La compañía y Ejemplo empiezan en pausa. «Iniciar proyecto» pone a andar los dos con un solo botón.");
  assert.equal(paso.href, "/ceo?proyecto=ejemplo&hoja=reanudar:ejemplo");
  assert.deepEqual(ui.aReanudar(r as never), { project: "ejemplo", company: true });

  // Reanudar: the step waits for both.
  assert.equal((await post("/api/company/switch", { paused: false })).status, 200);
  r = await guia();
  assert.equal(estados(r).reanudar, "ahora");
  assert.deepEqual(ui.aReanudar(r as never), { project: "ejemplo", company: false });
  assert.equal(ui.pasosDe(r as never, "es")[2]!.texto, ui.PRIMERA_ENTREGA_WORDS.es.reanudar.proyecto);
  assert.equal((await post("/api/company/projects/ejemplo/switch", { paused: false })).status, 200);
  r = await guia();
  assert.equal(estados(r).reanudar, "hecho");
  assert.equal(ui.pasosDe(r as never)[2]!.accion, undefined, "nothing left to resume");

  // The suggested request, as the guide's button sends it.
  const ask = await post("/api/company/projects/ejemplo/ask", { text: ui.PEDIDO_SUGERIDO, now: false });
  assert.equal(ask.status, 201, await ask.clone().text());
  const order = ((await ask.json()) as Json).key as string;
  r = await guia();
  assert.equal(estados(r).pedido, "hecho");
  assert.equal(estados(r).plan, "ahora");
  assert.equal(r.plan, "nada");

  // The product owner proposes a plan: it waits for «Sí, empiecen».
  const plan = await propose(
    db,
    { project: "ejemplo", kind: "plan", order, title: "Un documento corto", understood: "Quieres un documento de una página.", steps: [{ title: "Escribir el documento", done_when: "El documento está en el ticket", work_type: "research" }] } as never,
    { actor: { agent: "po-ejemplo", session_id: "po-session" } },
  );
  assert.equal(plan.proposal.needs_approval, true);
  assert.equal((await guia()).plan, "espera");
  const yes = await post(`/api/company/decisions/m-${plan.message.id}`, { action: "empezar" });
  assert.equal(yes.status, 200, await yes.clone().text());
  const step = ((await yes.json()) as Json).state.result.created[0] as string;
  r = await guia();
  assert.equal(estados(r).plan, "hecho");
  assert.equal(estados(r).entrega, "ahora");
  assert.equal(r.entrega, "nada");

  // The research seat finishes its step: In review, with its closing line in the project thread.
  // As a run's finish does: its check ticked, the step In review.
  await raw.query(`update checks set done = true, done_at = now() where task_id = (select id from tasks where key = $1)`, [step]);
  await raw.query(`update tasks set status = 'In review' where key = $1`, [step]);
  const thread = (await raw.query(`select t.id from threads t join projects p on p.id = t.project_id where p.slug = 'ejemplo'`)).rows[0].id;
  const msg = (
    await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, 'research-ejemplo', 'research', $2, $3) returning id`, [
      thread,
      `${step} queda En revisión.`,
      JSON.stringify([{ kind: "ticket", ref: step, title: "Escribir el documento" }]),
    ])
  ).rows[0].id;
  assert.equal((await guia()).entrega, "espera");

  const accept = await post(`/api/company/decisions/m-${msg}`, { action: "aceptar" });
  assert.equal(accept.status, 200, await accept.clone().text());
  assert.equal((await raw.query(`select status from tasks where key = $1`, [step])).rows[0].status, "Done");
  r = await guia();
  assert.equal(r.entrega, "aceptada");
  assert.equal(r.visible, false, "the guide disappears after the first accepted delivery");
  assert.ok(ui.pasosDe(r as never).every((p) => p.estado === "hecho"));
});

test("I2-16 #3: a run that could not start shows its reason and fix on the project page and in the guide, one case per failure", async () => {
  const p = (await raw.query(`select id from projects where slug = 'ejemplo'`)).rows[0].id;
  const po = (await raw.query(`select id from agents where slug = 'po-ejemplo'`)).rows[0].id;
  const t = (await raw.query(`select key from tasks where project_id = $1 and kind = 'ticket' order by created_at limit 1`, [p])).rows[0].key as string;
  // The guide reads failures while it shows: reopen it for this test by forgetting the accept.
  await raw.query(`update thread_messages set action_state = null where action_state->>'action' = 'aceptar'`);
  await raw.query(`update tasks set status = 'Ready' where key = $1`, [t]);
  const cases = [...START_FAILURES, "signed out"];
  for (const reason of cases) {
    await raw.query(`delete from agent_runs`);
    const summary = `fail: ${reason} (detail)`;
    await raw.query(`insert into agent_runs (agent_id, project_id, task_key, role, status, summary, queued_at, ended_at) values ($1, $2, $3, 'product-owner', 'fail', $4, now(), now())`, [po, p, t, summary]);
    const words = ARRANQUE[reason];
    assert.ok(words, `${reason} has words`);

    // The project page: the step carries the failure (its board, which the floor's «No pudo arrancar» line reads), and
    // the screen's line says what happened and the fix.
    const page = await get("/api/projects/ejemplo");
    const onBoard = JSON.stringify(page.tablero);
    assert.ok(onBoard.includes(JSON.stringify(summary)), `${reason}: the project page marks the step: ${onBoard.slice(0, 400)}`);
    const line = arranqueLine(summary)!;
    assert.ok(line.includes(words.arregla), `${reason}: the line has the fix: ${line}`);

    // The guide: the same reason and fix where the owner is looking.
    const g = await guia();
    assert.deepEqual({ por: g.fallo?.por, arregla: g.fallo?.arregla, ticket: g.fallo?.ticket }, { por: words.por, arregla: words.arregla, ticket: t }, reason);
  }
  // A run that started and failed for another reason is not a start-up problem.
  await raw.query(`update agent_runs set summary = 'fail: no result (exit 1)'`);
  assert.equal((await guia()).fallo, null);
});

test("I2-16: the guide's words: the plan use, the suggested request, no ticket keys or branch names", () => {
  assert.equal(ui.consumoLinea(5), "Una corrida usa más o menos el 5 % de tu plan de cinco horas, así que este pedido cabe de sobra.");
  assert.match(ui.consumoLinea(Number.NaN), /3 %/);
  assert.ok(ui.PEDIDO_SUGERIDO.length < 200, "a request sized for one run");
  const text = [...Object.values(ui.WORDS), ui.PEDIDO_SUGERIDO, ui.EJEMPLO.goal].join(" ");
  assert.doesNotMatch(text, /PLA-|sandbox|jl\//i);
  assert.match(ui.WORDS.pausa, /Pausar/);
});
