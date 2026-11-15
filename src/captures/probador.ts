// PLA-I52-3: antes y después. When a delivery with a muestra lands, Plania runs sandbox (antes) and the delivery's
// copy (después) side by side, photographs every view of the muestra at 1280 and 390 on both, marks a path that did
// not exist before as new, and boxes what changed. Only then is the delivery the owner's turn (probadorGate).
// If no picture of the delivery can be taken, the ticket goes back to Taller with the reason; after the second
// failure the card is raised anyway, with what Plania has and why the rest is missing. Nobody is shown a blind card.
import { hostname } from "node:os";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, captureStills, events, projects, tasks, threadMessages, threads, type Project, type Task } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import type { Ctx } from "../mcp/tx.js";
import { setTask } from "../mcp/writes.js";
import { enqueueWake } from "../runner/events.js";
import { pngDiff, type DiffBox } from "./diff.js";
import type { Muestra } from "./muestra.js";
import { encender, encenderEntrega, entregaRead, pruebaInfo, pruebaOf, pruebaRead, BRANCH } from "./prueba.js";
import { runCapture, type CaptureInput, type CaptureSummary, type ViewPage } from "./run.js";
import { imageUrl, readFile } from "./store.js";
import { preguntasOf, type QA } from "./preguntas.js";
import { VIEWPORT_NAMES, type ViewportName } from "./settings.js";

export type ProbadorState = {
  state: "tomando" | "lista" | "fallo";
  attempts: number; // failed tries so far
  error: string | null; // why pictures are missing (lista with error = partial)
  commit: string | null; // the delivery's commit the pictures show
  at: string;
};

export type ProbadorDeps = {
  capture?: (db: Db, input: CaptureInput) => Promise<CaptureSummary>;
  encender?: typeof encender;
  encenderEntrega?: typeof encenderEntrega;
  waitMs?: number;
  pollMs?: number;
  returnToTaller?: boolean; // false: tests that only look at the state
};

const WAIT_MS = 240_000;
const POLL_MS = 1_000;
export const MAX_ATTEMPTS = 2;
const SYSTEM = { agent: "plania", session_id: "plania-probador" };
const ctx = (): Ctx => ({ actor: { ...SYSTEM, machine: hostname() }, system: true, tool: "probador" });
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const running = new Set<string>(); // project/key: one pass at a time per delivery

async function load(db: Db, slug: string, key: string): Promise<{ p: Project; t: Task } | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  return t ? { p, t } : null;
}

async function setState(db: Db, t: Task, s: Omit<ProbadorState, "at">): Promise<ProbadorState> {
  const state = { ...s, at: new Date().toISOString() };
  await db.update(tasks).set({ probador: state }).where(eq(tasks.id, t.id));
  return state;
}

export const viewsOf = (m: Muestra): ViewPage[] =>
  m.vistas.map((v) => ({ key: v.key, label: v.label, path: v.path, ...(v.session ? { session: true } : {}), ...(v.follow ? { follow: v.follow } : {}), ...(v.acciones ? { acciones: v.acciones } : {}) }));

// Takes the delivery's pairs. Returns the new state, or null when there is nothing to show (no capture settings,
// no muestra, no branch). Never throws for a picture problem: that is the state's error.
export async function probar(db: Db, slug: string, key: string, deps: ProbadorDeps = {}): Promise<ProbadorState | null> {
  const id = `${slug}/${key}`;
  if (running.has(id)) return null;
  running.add(id);
  try {
    return await pass(db, slug, key, deps);
  } finally {
    running.delete(id);
  }
}

async function pass(db: Db, slug: string, key: string, deps: ProbadorDeps): Promise<ProbadorState | null> {
  const got = await load(db, slug, key);
  if (!got) return null;
  const { p, t } = got;
  const settings = p.settings.capture;
  const branch = t.branch || t.workspace?.branch;
  if (!settings || !t.muestra || !branch) return null;
  const attempts = t.probador?.attempts ?? 0;
  await setState(db, t, { state: "tomando", attempts, error: null, commit: t.probador?.commit ?? null });

  // Both copies, then wait until each answers (or fails).
  const startSandbox = deps.encender ?? encender;
  const startEntrega = deps.encenderEntrega ?? encenderEntrega;
  const outside = !pruebaOf(slug) && (await pruebaRead(slug, settings)).phase === "running";
  if (!outside) await startSandbox(db, slug).catch(() => null);
  try {
    await startEntrega(db, slug, { key: t.key, branch });
  } catch (e) {
    return failed(db, p, t, attempts, `No se pudo encender la copia de la entrega: ${short(e)}`, deps);
  }
  const until = Date.now() + (deps.waitMs ?? WAIT_MS);
  const settled = (ph: string | undefined) => ph === "live" || ph === "failed";
  for (;;) {
    const e = entregaRead(slug);
    const s = outside ? "live" : pruebaOf(slug)?.phase;
    if (settled(e?.phase) && settled(s)) break;
    if (Date.now() > until) break;
    await sleep(deps.pollMs ?? POLL_MS);
  }
  const e = entregaRead(slug);
  if (!e || e.phase !== "live" || !e.port) return failed(db, p, t, attempts, e?.error ?? "La copia de la entrega no arrancó a tiempo", deps);

  const views = viewsOf(t.muestra);
  const capture = deps.capture ?? runCapture;
  const actor = ctx().actor;
  // Antes: sandbox. A view that is not there yet is a new screen, not an error.
  const sb = outside ? { port: settings.port, phase: "live" } : pruebaOf(slug);
  let antesError: string | null = null;
  if (sb?.phase === "live" && sb.port) {
    const info = pruebaInfo(slug);
    await capture(db, { project: slug, checkout: info?.worktree ?? e.worktree ?? "", base_url: `http://localhost:${sb.port}`, branch: BRANCH, commit: info?.commit ?? undefined, task_key: t.key, views, side: "antes", allow_missing: true, actor }).catch(
      (err) => (antesError = `Antes: ${short(err)}`),
    );
  } else antesError = "Sin antes: la copia de sandbox no arrancó";
  // Después: the delivery.
  let despues: CaptureSummary | null = null;
  try {
    despues = await capture(db, { project: slug, checkout: e.worktree ?? "", base_url: `http://localhost:${e.port}`, branch, commit: e.commit ?? undefined, task_key: t.key, views, side: "despues", actor });
  } catch (err) {
    return failed(db, p, t, attempts, `No se pudo fotografiar la entrega: ${short(err)}`, deps);
  }
  await markDiffs(db, p, t, despues.run_id);
  if (despues.ok === 0) {
    const why = despues.stills.find((x) => x.error)?.error ?? "ninguna vista salió";
    return failed(db, p, t, attempts, `No salió ninguna foto de la entrega: ${why}`, deps);
  }
  const missing = despues.stills.filter((x) => x.status === "error");
  const error = [missing.length ? `${missing.length} de ${despues.stills.length} fotos no salieron (${missing[0]!.error})` : null, antesError].filter(Boolean).join(" · ") || null;
  return setState(db, t, { state: "lista", attempts, error, commit: e.commit ?? null });
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

async function failed(db: Db, p: Project, t: Task, attempts: number, error: string, deps: ProbadorDeps): Promise<ProbadorState> {
  const n = attempts + 1;
  if (n >= MAX_ATTEMPTS) {
    // Second failure: the owner sees the card with what there is and why the rest is missing.
    return setState(db, t, { state: "lista", attempts: n, error, commit: null });
  }
  const state = await setState(db, t, { state: "fallo", attempts: n, error, commit: null });
  if (deps.returnToTaller !== false) await returnToTaller(db, p, t, error);
  return state;
}

async function returnToTaller(db: Db, p: Project, t0: Task, error: string): Promise<void> {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, t0.id)).limit(1);
  if (!t || t.status !== "In review") return;
  const text = `Plania no pudo fotografiar la entrega para El Probador: ${error}. Revisa la muestra (rutas, sesión, acciones) o que la app arranque, y vuelve a entregar.`.slice(0, 2000);
  try {
    await setTask(db, { project: p.slug, key: t.key, status: "Ready", version: t.version, note: text } as never, ctx());
  } catch {
    return;
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
}

export type ProbadorGate = { pending: boolean; hold: string | null };

// Whether a delivery waits for its pictures (pending: the floor shows no card yet) or carries a note about them.
// Only deliveries with a muestra on a project Plania photographs; everything else is unchanged.
export function probadorGate(p: Project | null, t: Task | null, head: string | null): ProbadorGate {
  if (!p?.settings.capture || !t?.muestra) return { pending: false, hold: null };
  const s = t.probador;
  if (!s || s.state === "tomando" || s.state === "fallo") return { pending: true, hold: null };
  if (head && s.commit && !head.startsWith(s.commit.slice(0, 7)) && !s.commit.startsWith(head.slice(0, 7))) return { pending: true, hold: null };
  return { pending: false, hold: s.error ? `Faltan fotos: ${s.error}` : null };
}

// ---- The read El Probador draws (GET /api/projects/:slug/probador/:key)

export type ParShot = { id: string; image_url: string; width: number; height: number | null; taken_at: string } | null;
export type ParSide = { still: ParShot; error: string | null; missing: boolean };
export type ParVista = {
  key: string;
  label: string;
  path: string;
  estado: string | null;
  kind: "nueva" | "cambio" | "igual" | "sin_antes";
} & Record<ViewportName, { antes: ParSide; despues: ParSide; diff: DiffBox | null }>;
export type ProbadorRead = {
  key: string;
  muestra: Muestra | null;
  state: ProbadorState | null;
  vistas: ParVista[];
  entrega: ReturnType<typeof entregaRead>;
  preguntas: QA[]; // PLA-I52-6
};

export async function probadorRead(db: Db, slug: string, key: string): Promise<ProbadorRead | null> {
  const got = await load(db, slug, key);
  if (!got) return null;
  const { t } = got;
  const m = t.muestra ?? null;
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
  const vistas: ParVista[] = (m?.vistas ?? []).map((v) => {
    const per = Object.fromEntries(
      VIEWPORT_NAMES.map((vp) => {
        const d = pick(v.key, vp, "despues");
        const diff = d?.diff && "x" in (d.diff as object) ? (d.diff as DiffBox) : null;
        return [vp, { antes: sideOf(pick(v.key, vp, "antes")), despues: sideOf(d), diff }];
      }),
    ) as Record<ViewportName, { antes: ParSide; despues: ParSide; diff: DiffBox | null }>;
    const desk = pick(v.key, "desktop", "despues");
    const raw = desk?.diff as Record<string, unknown> | null | undefined;
    const kind: ParVista["kind"] = per.desktop.antes.missing || raw?.nueva ? "nueva" : !per.desktop.antes.still ? "sin_antes" : raw && "x" in raw ? "cambio" : desk?.status === "ok" ? "igual" : "sin_antes";
    return { key: v.key, label: v.label, path: v.path, estado: v.estado ?? null, kind, ...per };
  });
  return { key: t.key, muestra: m, state: t.probador ?? null, vistas, entrega: entregaRead(slug), preguntas: await preguntasOf(db, got.p, t) };
}

export function assertKey(key: string): string {
  if (!/^[A-Z][A-Z0-9]*-[A-Z0-9-]+$/.test(key)) throw new ToolError("INVALID_FILTER", { field: "key" });
  return key;
}
