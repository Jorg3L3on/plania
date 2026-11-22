// PLA-I52-3: antes y después. When a delivery with a muestra lands, Plania runs sandbox (antes) and the delivery's
// copy (después) side by side, photographs every view of the muestra at 1440 and 390 on both, marks a path that did
// not exist before as new, and boxes what changed. Only then is the delivery the owner's turn (probadorGate).
// If no picture of the delivery can be taken, the ticket goes back to Taller with the reason; after the second
// failure the card is raised anyway, with what Plania has and why the rest is missing. Nobody is shown a blind card.
import { hostname } from "node:os";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, captureStills, events, projects, pullRequests, tasks, threadMessages, threads, type Project, type Task } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import type { Ctx } from "../mcp/tx.js";
import { setTask } from "../mcp/writes.js";
import { enqueueWake } from "../runner/events.js";
import { supported } from "../lib/system-support.js";
import { pngDiff, type DiffBox } from "./diff.js";
import type { Muestra } from "./muestra.js";
import { caseViews, emptyCases } from "./vacios.js";
import { measuredWaits } from "./waits.js";
import { apagar, apagarEntrega, cargarDatos, datosDe, encender, encenderEntrega, entregaEnv, entregaRead, hashDatos, pruebaEnv, pruebaInfo, pruebaOf, pruebaRead, BRANCH } from "./prueba.js";
import { runCapture, type CaptureInput, type CaptureSummary, type ViewPage } from "./run.js";
import { imageUrl, readFile } from "./store.js";
import { preguntasOf, type QA } from "./preguntas.js";
import { VIEWPORT_NAMES, type ViewportName } from "./settings.js";
import { SISTEMA } from "../../ui/src/lib/sistema.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: why pictures are missing, the note back to Taller and the card's hold, in the install's language; the
// Spanish is unchanged.
export const PROBADOR_WORDS = defineWords({
  es: {
    planiaFailed: (why: string) => `Plania falló al tomar las fotos: ${why}`,
    noBranch: "La entrega no tiene rama: no hay fotos",
    noStart: (why: string) => `No se pudo encender la copia de la entrega: ${why}`,
    late: "La copia de la entrega no arrancó a tiempo",
    noDatos: (why: string) => `Los datos de la muestra no se cargaron: ${why}`,
    before: (why: string) => `Antes: ${why}`,
    noBefore: "Sin antes: la copia de prueba no arrancó",
    noShoot: (why: string) => `No se pudo fotografiar la entrega: ${why}`,
    noView: "ninguna vista salió",
    noPicture: (why: string) => `No salió ninguna foto de la entrega: ${why}`,
    someMissing: (n: number, of: number, why: string | undefined) => `${n} de ${of} fotos no salieron (${why})`,
    returned: (error: string) => `Plania no pudo fotografiar la entrega para El Probador: ${error}. Revisa la muestra (rutas, sesión, acciones) o que la app arranque, y vuelve a entregar.`,
    olderCommit: (sha: string) => `Las fotos son de un commit anterior (${sha})`,
    unavailable: (what: string) => `Fotos: ${what}`,
    missing: (why: string) => `Faltan fotos: ${why}`,
    waitLane: "Espera a que terminen las fotos de otra entrega.",
    closingLive: "Cierra la copia en vivo de otra entrega que quedó abierta.",
    wrongPage: (why: string) => `No se puede aprobar todavía. ${why}. Hay que corregir la muestra o la pantalla y volver a tomar las fotos.`,
  },
  en: {
    planiaFailed: (why: string) => `Plania failed while taking the pictures: ${why}`,
    noBranch: "The delivery has no branch: no pictures",
    noStart: (why: string) => `Could not turn on the delivery's copy: ${why}`,
    late: "The delivery's copy did not start in time",
    noDatos: (why: string) => `The preview's data did not load: ${why}`,
    before: (why: string) => `Before: ${why}`,
    noBefore: "No before: the test copy did not start",
    noShoot: (why: string) => `Could not photograph the delivery: ${why}`,
    noView: "no view came out",
    noPicture: (why: string) => `No picture of the delivery came out: ${why}`,
    someMissing: (n: number, of: number, why: string | undefined) => `${n} of ${of} pictures did not come out (${why})`,
    returned: (error: string) => `Plania could not photograph the delivery for El Probador: ${error}. Check the preview (paths, session, actions) or that the app starts, and deliver again.`,
    olderCommit: (sha: string) => `The pictures are of an earlier commit (${sha})`,
    unavailable: (what: string) => `Pictures: ${what}`,
    missing: (why: string) => `Pictures missing: ${why}`,
    waitLane: "Waits for another delivery's pictures to finish.",
    closingLive: "Closing another delivery's live copy that was left open.",
    wrongPage: (why: string) => `It cannot be approved yet. ${why}. The preview or the screen needs fixing and the pictures taking again.`,
  },
});

export type ProbadorState = {
  state: "tomando" | "lista" | "fallo";
  attempts: number; // failed tries so far
  error: string | null; // why pictures are missing (lista with error = partial)
  commit: string | null; // the delivery's commit the pictures show
  at: string;
  // PLA-52: the PR head the sweep asked a retake for; a second mismatch on the same head opens the card with the reason.
  for_head?: string | null;
  // PLA-158 (F-27): what a pass in «tomando» waits on (another pass on the project's lane, the delivery copy held by
  // another delivery), in the owner's words; null while it works. The card and the board line show it.
  waiting?: string | null;
  // PLA-I74-10: a photo landed on another page than its view declares. error says which, in the owner's words, and
  // it holds «Aceptar» back (the card and the server's accept).
  wrong?: boolean;
};

export type ProbadorDeps = {
  capture?: (db: Db, input: CaptureInput) => Promise<CaptureSummary>;
  encender?: typeof encender;
  encenderEntrega?: typeof encenderEntrega;
  cargarDatos?: typeof cargarDatos; // PLA-78
  apagarEntrega?: typeof apagarEntrega; // PLA-158
  waitMs?: number;
  pollMs?: number;
  returnToTaller?: boolean; // false: tests that only look at the state
  forHead?: string | null; // PLA-52: the PR head this retake is for (the sweep's)
};

const WAIT_MS = 240_000;
const POLL_MS = 1_000;
export const MAX_ATTEMPTS = 2;
const SYSTEM = { agent: "plania", session_id: "plania-probador" };
const ctx = (): Ctx => ({ actor: { ...SYSTEM, machine: hostname() }, system: true, tool: "probador" });
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const running = new Set<string>(); // project/key: one pass at a time per delivery

// PLA-106 (guided test PLA-86, F-34): a project has one delivery copy, but passes were only kept apart per delivery.
// Two deliveries landing together (MIA-40 and MIA-I10-5) used the copy at once: one rebuilt its database and loaded its
// rows while the other was mid-pass, and the second load failed with a duplicate key. Passes of one project now wait
// their turn on that project's lane; another project's never waits.
const lanes = new Map<string, Promise<unknown>>();
export const laneBusy = (slug: string): boolean => lanes.has(slug);
export function onLane<T>(slug: string, work: () => Promise<T>): Promise<T> {
  const before = lanes.get(slug) ?? Promise.resolve();
  const mine = before.catch(() => undefined).then(work);
  const tail = mine.catch(() => undefined);
  lanes.set(slug, tail);
  void tail.then(() => {
    if (lanes.get(slug) === tail) lanes.delete(slug);
  });
  return mine;
}

async function load(db: Db, slug: string, key: string): Promise<{ p: Project; t: Task } | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  return t ? { p, t } : null;
}

// PLA-I73-1: a pass's start and end are events, so the initiative's stopwatch reads photo time from its own records
// (until now only the server log had it). The end carries each phase's seconds.
async function passEvent(db: Db, t: Pick<Task, "id" | "key" | "projectId">, type: "probador.started" | "probador.pass", payload: Record<string, unknown>): Promise<void> {
  await db
    .insert(events)
    .values({ projectId: t.projectId, taskId: t.id, taskKey: t.key, type, actor: ctx().actor, payload })
    .catch((e) => console.log(`[probador] ${t.key}: could not record ${type}: ${short(e)}`));
}

async function setState(db: Db, t: Task, s: Omit<ProbadorState, "at">): Promise<ProbadorState> {
  const state = { ...s, at: new Date().toISOString() };
  await db.update(tasks).set({ probador: state }).where(eq(tasks.id, t.id));
  return state;
}

export const viewsOf = (m: Muestra): ViewPage[] =>
  m.vistas.map((v) => ({ key: v.key, label: v.label, path: v.path, ...(v.session ? { session: true } : {}), ...(v.follow ? { follow: v.follow } : {}), ...(v.acciones ? { acciones: v.acciones } : {}), ...(v.url ? { url: v.url } : {}) }));

// Takes the delivery's pairs. Returns the new state, or null when there is nothing to show (no capture settings,
// no muestra, no branch). Never throws for a picture problem: that is the state's error.
export async function probar(db: Db, slug: string, key: string, deps: ProbadorDeps = {}): Promise<ProbadorState | null> {
  const id = `${slug}/${key}`;
  if (running.has(id)) return null;
  // PLA-I2-4: nothing to photograph with here (probadorGate says so on the card).
  if (!supported("stills") || !supported("test_copy")) return null;
  running.add(id);
  try {
    // PLA-158 (F-27): a pass behind another one of the same project says so on its card instead of a bare «tomando».
    if (laneBusy(slug)) {
      const got = await load(db, slug, key);
      if (got?.t.muestra && got.p.settings.capture) {
        const s = got.t.probador;
        await setState(db, got.t, { state: "tomando", attempts: s?.attempts ?? 0, error: null, commit: s?.commit ?? null, for_head: deps.forHead ?? s?.for_head ?? null, waiting: say(PROBADOR_WORDS).waitLane });
      }
    }
    return await onLane(slug, () => pass(db, slug, key, deps));
  } catch (e) {
    // PLA-52: never left «tomando». An error of Plania's own is not Taller's to fix: the sweep tries once more, then
    // the card shows with the reason.
    console.log(`[probador] ${id} failed: ${short(e)}`);
    const got = await load(db, slug, key).catch(() => null);
    if (!got) return null;
    return failed(db, got.p, got.t, got.t.probador?.attempts ?? 0, say(PROBADOR_WORDS).planiaFailed(short(e)), { ...deps, returnToTaller: false }).catch((e2) => {
      console.log(`[probador] ${id} could not record the failure: ${short(e2)}`);
      return null;
    });
  } finally {
    running.delete(id);
  }
}

export const probando = (slug: string, key?: string): boolean => (key ? running.has(`${slug}/${key}`) : [...running].some((id) => id.startsWith(`${slug}/`)));

async function pass(db: Db, slug: string, key: string, deps: ProbadorDeps): Promise<ProbadorState | null> {
  const got = await load(db, slug, key);
  if (!got) return null;
  const { p, t } = got;
  const settings = p.settings.capture;
  const branch = t.branch || t.workspace?.branch;
  if (!settings || !t.muestra) return null;
  const attempts = t.probador?.attempts ?? 0;
  // PLA-52: a delivery with no branch cannot be photographed; the card shows with the reason instead of waiting forever.
  if (!branch) return setState(db, t, { state: "lista", attempts, error: say(PROBADOR_WORDS).noBranch, commit: null });
  await setState(db, t, { state: "tomando", attempts, error: null, commit: t.probador?.commit ?? null, for_head: deps.forHead ?? t.probador?.for_head ?? null, waiting: null });
  await passEvent(db, t, "probador.started", { attempts });
  // PLA-110 (guided test PLA-86, F-40): passes took 10–20 minutes and the log could not say where. Each phase's
  // seconds go to the server log at the end, so a slow pass shows its own breakdown.
  const clock = Date.now();
  const lap: string[] = [];
  const mark = (what: string) => lap.push(`${what} ${Math.round((Date.now() - clock) / 1000)}s`);

  // Both copies, then wait until each answers (or fails).
  const startSandbox = deps.encender ?? encender;
  const startEntrega = deps.encenderEntrega ?? encenderEntrega;
  // PLA-154 (guided test 3): «outside» means the app's own dev server answers on settings.port. After a restart reaped
  // the sandbox copy, Plania's own delivery copy was on that port and was photographed as «antes»: every view IGUAL,
  // and the card blamed Taller. A port one of Plania's copies holds is never outside.
  const ownPort = entregaRead(slug)?.port ?? null;
  const outside = !pruebaOf(slug) && ownPort !== settings.port && (await pruebaRead(slug, settings)).phase === "running";
  // PLA-78: a copy whose database carries another muestra's fake rows starts again on a fresh copy, so one
  // delivery's rows never show in another's pictures.
  const want = hashDatos(t.muestra.datos);
  const sbDatos = datosDe(slug, "sandbox");
  if (!outside && sbDatos && sbDatos !== want) await apagar(db, slug).catch(() => null);
  // PLA-158 (F-27): one delivery copy per project. When it holds another delivery (the live copy the owner opened for
  // it and left open), the new delivery wins: that copy closes now and the owner can open the live view again. The
  // card says what the pass is doing meanwhile.
  const held = entregaRead(slug);
  if (held?.key && held.key !== t.key) {
    const state = { state: "tomando" as const, attempts, error: null, commit: t.probador?.commit ?? null, for_head: deps.forHead ?? t.probador?.for_head ?? null };
    await setState(db, t, { ...state, waiting: say(PROBADOR_WORDS).closingLive });
    await (deps.apagarEntrega ?? apagarEntrega)(db, slug).catch(() => null);
    await setState(db, t, { ...state, waiting: null });
  }
  // PLA-I74-10: Artist's empty states are photographed on a copy no muestra rows have touched yet.
  const cases = await emptyCases(db, t);
  const enDatos = datosDe(slug, "entrega");
  if (enDatos && (enDatos !== want || cases.length)) await apagarEntrega(db, slug).catch(() => null);
  if (!outside) await startSandbox(db, slug, { stills: false }).catch(() => null);
  try {
    await startEntrega(db, slug, { key: t.key, branch, head: deps.forHead ?? null });
  } catch (e) {
    return failed(db, p, t, attempts, say(PROBADOR_WORDS).noStart(short(e)), deps);
  }
  // PLA-I74-7: a slow project's copies get the time its check-up measured (and a minute to install and copy the base).
  const until = Date.now() + (deps.waitMs ?? Math.max(WAIT_MS, (await measuredWaits(db, slug)).ready_ms + 60_000));
  const settled = (ph: string | undefined) => ph === "live" || ph === "failed";
  for (;;) {
    const e = entregaRead(slug);
    const s = outside ? "live" : pruebaOf(slug)?.phase;
    if (settled(e?.phase) && settled(s)) break;
    if (Date.now() > until) break;
    await sleep(deps.pollMs ?? POLL_MS);
  }
  const e = entregaRead(slug);
  mark("copias");
  if (!e || e.phase !== "live" || !e.port) return failed(db, p, t, attempts, e?.error ?? say(PROBADOR_WORDS).late, deps);

  // PLA-I74-10: the empty-state cases, before any row is loaded: what the app's migrations and defaults leave.
  let vacios: CaptureSummary | null = null;
  if (cases.length) {
    const capture = deps.capture ?? runCapture;
    const sbLive = !outside && pruebaOf(slug)?.phase === "live" && !datosDe(slug, "sandbox");
    const info = pruebaInfo(slug);
    const sbPort = pruebaOf(slug)?.port;
    if (sbLive && sbPort)
      await capture(db, { project: slug, checkout: info?.worktree ?? e.worktree ?? "", base_url: `http://localhost:${sbPort}`, branch: info?.branch ?? BRANCH, commit: info?.commit ?? undefined, task_key: t.key, views: caseViews(cases), side: "antes", allow_missing: true, actor: ctx().actor, env: pruebaEnv(slug) }).catch(() => null);
    vacios = await capture(db, { project: slug, checkout: e.worktree ?? "", base_url: `http://localhost:${e.port}`, branch, commit: e.commit ?? undefined, task_key: t.key, views: caseViews(cases), side: "despues", actor: ctx().actor, env: entregaEnv(slug) }).catch(() => null);
    mark("vacios");
  }

  // PLA-78: the muestra's fake rows, in the delivery's database (a failure goes back to Taller: its SQL is wrong for
  // its own branch) and in the test copy's (a failure there is fine: the rows may need the branch's new columns).
  if (t.muestra.datos) {
    const load = deps.cargarDatos ?? cargarDatos;
    const d = await load(slug, "entrega", t.muestra.datos);
    if (!d.ok) return failed(db, p, t, attempts, say(PROBADOR_WORDS).noDatos(d.error), deps);
    if (!outside && pruebaOf(slug)?.phase === "live") {
      const a = await load(slug, "sandbox", t.muestra.datos, { bestEffort: true });
      if (!a.ok) console.log(`[probador] ${slug}/${t.key}: antes without the muestra's datos: ${a.error}`);
      else if ("partial" in a && a.partial) console.log(`[probador] ${slug}/${t.key}: antes with the statements that fit sandbox (${a.partial})`);
    }
  }

  // PLA-97 (guided test PLA-86, F-20): the rows the initiative's earlier accepted steps seeded (branch hours, advisors)
  // were gone in every later step's copy. They load after this delivery's own, on both copies.
  for (const sql of await earlierDatos(db, t)) {
    const load = deps.cargarDatos ?? cargarDatos;
    await load(slug, "entrega", sql, { earlier: true }).catch(() => null);
    if (!outside && pruebaOf(slug)?.phase === "live") await load(slug, "sandbox", sql, { earlier: true }).catch(() => null);
  }
  mark("datos");
  const views = viewsOf(t.muestra);
  const capture = deps.capture ?? runCapture;
  const actor = ctx().actor;
  // Antes: sandbox. A view that is not there yet is a new screen, not an error.
  const sb = outside ? { port: settings.port, phase: "live" } : pruebaOf(slug);
  let antesError: string | null = null;
  if (sb?.phase === "live" && sb.port) {
    const info = pruebaInfo(slug);
    await capture(db, { project: slug, checkout: info?.worktree ?? e.worktree ?? "", base_url: `http://localhost:${sb.port}`, branch: info?.branch ?? BRANCH, commit: info?.commit ?? undefined, task_key: t.key, views, side: "antes", allow_missing: true, actor, env: pruebaEnv(slug) }).catch(
      (err) => (antesError = say(PROBADOR_WORDS).before(short(err))),
    );
  } else antesError = say(PROBADOR_WORDS).noBefore;
  mark("antes");
  // Después: the delivery.
  let despues: CaptureSummary | null = null;
  try {
    despues = await capture(db, { project: slug, checkout: e.worktree ?? "", base_url: `http://localhost:${e.port}`, branch, commit: e.commit ?? undefined, task_key: t.key, views, side: "despues", actor, env: entregaEnv(slug) });
  } catch (err) {
    return failed(db, p, t, attempts, say(PROBADOR_WORDS).noShoot(short(err)), deps);
  }
  mark("despues");
  console.log(`[probador] ${slug}/${t.key}: ${lap.join(", ")}`);
  await passEvent(db, t, "probador.pass", { ok: true, phases: lap });
  await markDiffs(db, p, t, despues.run_id);
  if (vacios) {
    await markDiffs(db, p, t, vacios.run_id);
    despues = { ...despues, ok: despues.ok + vacios.ok, failed: despues.failed + vacios.failed, stills: [...despues.stills, ...vacios.stills] };
  }
  if (despues.ok === 0) {
    const why = despues.stills.find((x) => x.error)?.error ?? say(PROBADOR_WORDS).noView;
    const wrongAll = despues.stills.find((x) => x.wrong);
    return failed(db, p, t, attempts, wrongAll ? say(PROBADOR_WORDS).wrongPage(wrongAll.error ?? "") : say(PROBADOR_WORDS).noPicture(why), deps, Boolean(wrongAll));
  }
  const missing = despues.stills.filter((x) => x.status === "error");
  // PLA-I74-10: a wrong page says so first, and the card cannot be accepted until the delivery is photographed right.
  const wrong = despues.stills.find((x) => x.wrong);
  if (wrong) {
    const error = say(PROBADOR_WORDS).wrongPage(wrong.error ?? "");
    return setState(db, t, { state: "lista", attempts, error, commit: e.commit ?? null, for_head: deps.forHead ?? t.probador?.for_head ?? null, wrong: true });
  }
  const error = [missing.length ? say(PROBADOR_WORDS).someMissing(missing.length, despues.stills.length, missing[0]!.error) : null, antesError].filter(Boolean).join(" · ") || null;
  return setState(db, t, { state: "lista", attempts, error, commit: e.commit ?? null, for_head: deps.forHead ?? t.probador?.for_head ?? null });
}

/** PLA-97: the datos of the initiative's earlier accepted steps (Merged, Released or Done), in step order; none for a
 * standalone ticket. PLA-I73-2: a step delivered and still In review counts too, since a stacked step carries its code. */
export async function earlierDatos(db: Db, t: Pick<Task, "id" | "parentId" | "projectId">): Promise<string[]> {
  if (!t.parentId) return [];
  const rows = await db
    .select({ key: tasks.key, phase: tasks.phase, muestra: tasks.muestra })
    .from(tasks)
    .where(and(eq(tasks.projectId, t.projectId), eq(tasks.parentId, t.parentId), ne(tasks.id, t.id), inArray(tasks.status, ["Merged", "Released", "Done", "In review"])));
  return rows
    .filter((r) => !!r.muestra?.datos?.trim())
    .sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || a.key.localeCompare(b.key, "en", { numeric: true }))
    .map((r) => r.muestra!.datos!);
}

// The box on each después still against the newest antes of the same view and width.
async function markDiffs(db: Db, p: Project, t: Task, runId: string): Promise<void> {
  const after = await db.select().from(captureStills).where(and(eq(captureStills.runId, runId), eq(captureStills.status, "ok")));
  for (const a of after) {
    const [b] = await db
      .select()
      .from(captureStills)
      .where(and(eq(captureStills.taskId, t.id), eq(captureStills.side, "antes"), eq(captureStills.pageKey, a.pageKey), eq(captureStills.viewport, a.viewport)))
      .orderBy(desc(captureStills.takenAt))
      .limit(1);
    let diff: DiffBox | { nueva: true } | { unreadable: true } | null = null;
    if (b?.missing) diff = { nueva: true };
    else if (b?.status === "ok" && b.file && a.file) {
      const before = readFile(p.slug, b.file);
      const now = readFile(p.slug, a.file);
      const d = before && now ? pngDiff(before, now) : "unreadable";
      diff = d === "unreadable" ? { unreadable: true } : d;
    }
    if (diff) await db.update(captureStills).set({ diff }).where(eq(captureStills.id, a.id));
  }
}

async function failed(db: Db, p: Project, t: Task, attempts: number, error: string, deps: ProbadorDeps, wrong = false): Promise<ProbadorState> {
  const n = attempts + 1;
  await passEvent(db, t, "probador.pass", { ok: false, error: error.slice(0, 300) });
  if (n >= MAX_ATTEMPTS) {
    // Second failure: the owner sees the card with what there is and why the rest is missing.
    return setState(db, t, { state: "lista", attempts: n, error, commit: null, ...(wrong ? { wrong: true } : {}) });
  }
  const state = await setState(db, t, { state: "fallo", attempts: n, error, commit: null });
  if (deps.returnToTaller !== false && !(await returnToTaller(db, p, t, error))) {
    // PLA-52: it could not go back to Taller: the owner sees the card with the reason, never a hidden delivery.
    return setState(db, t, { state: "lista", attempts: n, error, commit: null, ...(wrong ? { wrong: true } : {}) });
  }
  return state;
}

// False when the ticket is still In review and could not be sent back.
async function returnToTaller(db: Db, p: Project, t0: Task, error: string): Promise<boolean> {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, t0.id)).limit(1);
  if (!t || t.status !== "In review") return true;
  const text = say(PROBADOR_WORDS).returned(error).slice(0, 2000);
  try {
    await setTask(db, { project: p.slug, key: t.key, status: "Ready", version: t.version, note: text } as never, ctx());
  } catch (e) {
    console.log(`[probador] ${p.slug}/${t.key} could not go back to Taller: ${short(e)}`);
    return false;
  }
  const at = new Date().toISOString();
  await db
    .update(threadMessages)
    .set({ actionState: { action: "cambios", at, result: { ticket: t.key, status: "Ready", text, by: "probador" } } as never })
    .where(
      and(
        isNull(threadMessages.actionState),
        sql`${threadMessages.links} @> ${JSON.stringify([{ kind: "ticket", ref: t.key }])}::jsonb`,
        sql`${threadMessages.threadId} in (select ${threads.id} from ${threads} where ${threads.projectId} = ${p.id})`,
      ),
    );
  await db.insert(events).values({ projectId: p.id, taskId: t.id, taskKey: t.key, type: "probador.returned", actor: ctx().actor, payload: { error } });
  if (t.ownerAgent) {
    const [owner] = await db.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1);
    if (owner) await enqueueWake(db, { agent: owner, project: { id: p.id, slug: p.slug }, taskKey: t.key, reason: "Plania could not photograph the delivery: read the note on the ticket" }).catch(() => undefined);
  }
  return true;
}

// ---- PLA-52: the sweep (each heartbeat tick)
// A pass lives in this process only. One an earlier server left «tomando», one that never started, one that failed
// and could not go back to Taller, and pictures of an older commit than the PR head are taken again here, so a
// delivery is never hidden for good. Bounded: a second miss on the same head, or a second failure, opens the card
// with the reason.

const sameCommit = (a: string, b: string) => a.startsWith(b.slice(0, 7)) || b.startsWith(a.slice(0, 7));
const ORPHAN_MS = WAIT_MS + 120_000; // a «tomando» older than a whole pass has nobody behind it
const SETTLE_MS = 120_000;
const sweeping = new Set<Promise<unknown>>();
/** Tests: resolves once every pass the sweep started in this process is done. */
export async function waitForProbador(): Promise<void> {
  while (sweeping.size) await Promise.all([...sweeping]);
}

export type ProbadorSweep = { restarted: number; opened: number };
export async function sweepProbador(db: Db, now = new Date(), deps: ProbadorDeps & { orphanMs?: number; settleMs?: number; force?: boolean } = {}): Promise<ProbadorSweep> {
  const out: ProbadorSweep = { restarted: 0, opened: 0 };
  // Off wherever background work is off (tests, a dev server on the same database), as afterFinish is (warmOn).
  if (!deps.force && (process.env.PLANIA_JOBS === "0" || process.env.PLANIA_WARM_ENTREGA === "0")) return out;
  const rows = await db
    .select({ t: tasks, p: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.status, "In review"), sql`${tasks.muestra} is not null`))
    .orderBy(tasks.statusChangedAt);
  const started = new Set<string>();
  for (const { t, p } of rows) {
    if (!p.settings.capture) continue;
    const s = t.probador;
    const [pr] = await db.select({ head: pullRequests.headSha }).from(pullRequests).where(and(eq(pullRequests.taskId, t.id), eq(pullRequests.state, "open"))).orderBy(desc(pullRequests.updatedAt)).limit(1);
    const head = pr?.head ?? null;
    const age = now.getTime() - Date.parse(s?.at ?? (t.statusChangedAt ?? t.createdAt).toISOString());
    const moved = !!head && !!s?.commit && s.state === "lista" && !sameCommit(head, s.commit);
    const need = !s ? age > (deps.settleMs ?? SETTLE_MS) : s.state === "tomando" ? age > (deps.orphanMs ?? ORPHAN_MS) : s.state === "fallo" ? age > (deps.settleMs ?? SETTLE_MS) : moved;
    if (!need || probando(p.slug) || started.has(p.slug)) continue;
    if (moved && s!.for_head && sameCommit(s!.for_head, head!)) {
      // Asked once for this head already and the copy still shows another commit: show what there is and say so.
      await setState(db, t, { state: "lista", attempts: s!.attempts, error: say(PROBADOR_WORDS).olderCommit(s!.commit!.slice(0, 7)), commit: head, for_head: head });
      out.opened += 1;
      continue;
    }
    started.add(p.slug);
    console.log(`[probador] ${p.slug}/${t.key}: ${!s ? "never started" : s.state === "tomando" ? "left mid-pass by an earlier server" : s.state === "fallo" ? "failed and still In review" : "the PR moved"}; taking the pictures again`);
    const job: Promise<unknown> = probar(db, p.slug, t.key, { ...deps, forHead: head, returnToTaller: s?.state === "fallo" ? false : deps.returnToTaller })
      .catch((e) => console.log(`[probador] ${p.slug}/${t.key} failed: ${short(e)}`))
      .finally(() => sweeping.delete(job));
    sweeping.add(job);
    out.restarted += 1;
  }
  return out;
}

export type ProbadorGate = { pending: boolean; hold: string | null };

// PLA-42: an error saved before the wording fix may still say sandbox; never on screen.
const onScreen = (e: string) => e.replace(/copia de sandbox/g, "copia de prueba").replace(/\bsandbox\b/g, "copia de prueba");

// Whether a delivery waits for its pictures (pending: the floor shows no card yet) or carries a note about them.
// Only deliveries with a muestra on a project Plania photographs; everything else is unchanged.
export function probadorGate(p: Project | null, t: Task | null, head: string | null): ProbadorGate {
  if (!p?.settings.capture || !t?.muestra) return { pending: false, hold: null };
  const s = t.probador;
  // PLA-I2-4: no pictures can come on a system without Chrome or a test copy, so the card never waits for them.
  // A saved error still wins: the owner reads what happened, not only what this machine lacks.
  if (!supported("stills") || !supported("test_copy")) return { pending: false, hold: s?.error ? say(PROBADOR_WORDS).missing(onScreen(s.error)) : say(PROBADOR_WORDS).unavailable(say(SISTEMA).unavailable.toLowerCase()) };
  if (!s || s.state === "tomando" || s.state === "fallo") return { pending: true, hold: null };
  if (head && s.commit && !head.startsWith(s.commit.slice(0, 7)) && !s.commit.startsWith(head.slice(0, 7))) return { pending: true, hold: null };
  // PLA-I74-10: a wrong page holds with its own reason (already in the owner's words).
  if (s.wrong && s.error) return { pending: false, hold: onScreen(s.error) };
  return { pending: false, hold: s.error ? say(PROBADOR_WORDS).missing(onScreen(s.error)) : null };
}

// ---- The read El Probador draws (GET /api/projects/:slug/probador/:key)

export type ParShot = { id: string; image_url: string; width: number; height: number | null; taken_at: string } | null;
export type ParSide = { still: ParShot; error: string | null; missing: boolean };
export type ParVista = {
  key: string;
  label: string;
  path: string;
  estado: string | null;
  // PLA-76: «error» when the delivery's page showed a crash (framework overlay, 5xx) instead of the screen.
  kind: "nueva" | "cambio" | "igual" | "sin_antes" | "error";
} & Record<ViewportName, { antes: ParSide; despues: ParSide; diff: DiffBox | null }>;
export type ProbadorRead = {
  key: string;
  muestra: Muestra | null;
  state: ProbadorState | null;
  vistas: ParVista[];
  entrega: ReturnType<typeof entregaRead>;
  preguntas: QA[]; // PLA-I52-6
};

// PLA-76: the después page crashed (the framework's error overlay, read by run.ts, or a 5xx), as opposed to a picture
// that did not come out for another reason (the login, a missing link).
// PLA-I2-10: run.ts writes these in the install's language (RUN_WORDS crash and answered); both are read, so a
// still taken before a language change still counts.
export const crashed = (error: string | null): boolean => !!error && /muestra un error: |respondió 5\d\d\b|shows an error: |answered 5\d\d\b/.test(error);

export async function probadorRead(db: Db, slug: string, key: string): Promise<ProbadorRead | null> {
  const got = await load(db, slug, key);
  if (!got) return null;
  const { t } = got;
  const m = t.muestra ?? null;
  // PLA-I74-10: the empty-state cases show after the muestra's own views.
  const all = m ? [...m.vistas, ...(await emptyCases(db, t))] : [];
  const rows = m
    ? await db
        .select()
        .from(captureStills)
        .where(and(eq(captureStills.taskId, t.id), inArray(captureStills.side, ["antes", "despues"])))
        .orderBy(desc(captureStills.takenAt))
    : [];
  const pick = (vista: string, vp: ViewportName, side: "antes" | "despues") => rows.find((r) => r.pageKey === vista && r.viewport === vp && r.side === side) ?? null;
  const sideOf = (r: (typeof rows)[number] | null): ParSide => ({
    still: r && r.status === "ok" ? { id: r.id, image_url: imageUrl(slug, r.id), width: r.width, height: r.height, taken_at: r.takenAt.toISOString() } : null,
    error: r && r.status === "error" && !r.missing ? r.error : null,
    missing: Boolean(r?.missing),
  });
  const vistas: ParVista[] = all.map((v) => {
    const per = Object.fromEntries(
      VIEWPORT_NAMES.map((vp) => {
        const d = pick(v.key, vp, "despues");
        const diff = d?.diff && "x" in (d.diff as object) ? (d.diff as DiffBox) : null;
        return [vp, { antes: sideOf(pick(v.key, vp, "antes")), despues: sideOf(d), diff }];
      }),
    ) as Record<ViewportName, { antes: ParSide; despues: ParSide; diff: DiffBox | null }>;
    const desk = pick(v.key, "desktop", "despues");
    const raw = desk?.diff as Record<string, unknown> | null | undefined;
    const kind: ParVista["kind"] = crashed(per.desktop.despues.error) ? "error" : per.desktop.antes.missing || raw?.nueva ? "nueva" : !per.desktop.antes.still ? "sin_antes" : raw && "x" in raw ? "cambio" : desk?.status === "ok" ? "igual" : "sin_antes";
    return { key: v.key, label: v.label, path: v.path, estado: v.estado ?? null, kind, ...per };
  });
  return { key: t.key, muestra: m, state: t.probador ?? null, vistas, entrega: entregaRead(slug), preguntas: await preguntasOf(db, got.p, t) };
}

// PLA-I52-7: the release card's reel. For each ticket the release ships that changed the screen, its newest
// después picture (desktop) and how it changed, so publishing to production also shows what users will see.
export type ReelItem = { key: string; title: string; label: string; kind: "nueva" | "cambio"; image_url: string };
export async function releaseReel(db: Db, projectId: string, slug: string, tickets: { key: string; title: string }[]): Promise<ReelItem[]> {
  const out: ReelItem[] = [];
  for (const tk of tickets.slice(0, 20)) {
    const [t] = await db.select({ id: tasks.id, cambio: tasks.cambio, muestra: tasks.muestra }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.key, tk.key))).limit(1);
    if (!t?.muestra || t.cambio === "no_se_ve") continue;
    const rows = await db
      .select()
      .from(captureStills)
      .where(and(eq(captureStills.taskId, t.id), eq(captureStills.viewport, "desktop"), inArray(captureStills.side, ["antes", "despues"])))
      .orderBy(desc(captureStills.takenAt));
    for (const v of t.muestra.vistas) {
      const d = rows.find((r) => r.pageKey === v.key && r.side === "despues" && r.status === "ok");
      if (!d) continue;
      const a = rows.find((r) => r.pageKey === v.key && r.side === "antes");
      const diff = d.diff as Record<string, unknown> | null;
      const kind = a?.missing || diff?.nueva ? "nueva" : diff && "x" in diff ? "cambio" : null;
      if (!kind) continue;
      out.push({ key: tk.key, title: tk.title, label: v.label, kind, image_url: imageUrl(slug, d.id) });
      break;
    }
  }
  return out;
}

export function assertKey(key: string): string {
  if (!/^[A-Z][A-Z0-9]*-[A-Z0-9-]+$/.test(key)) throw new ToolError("INVALID_FILTER", { field: "key" });
  return key;
}
