// PLA-I73-1: the stopwatch. Guided test 3 took 3 h 47 for a five-step module and the split (building, photos, the
// owner, stalls) had to be put together by hand from events, run logs and the server log. This turns an
// initiative's own records into that split, per step and in total, so every later speed change is measured.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, events, type Task } from "../db/schema.js";

export type Tramo = "construye" | "rehace" | "fotos" | "verifica" | "dueno" | "detenido";
export const TRAMOS: Tramo[] = ["construye", "rehace", "fotos", "verifica", "dueno", "detenido"];

export type CronoEvent = { type: string; at: Date; taskKey: string | null; payload: Record<string, unknown> };
export type CronoRun = { taskKey: string | null; role: string; startedAt: Date | null; endedAt: Date | null };
export type CronoStepIn = { key: string; title: string; phase: number | null; createdAt: Date; createdStatus: string };

export type Segment = { tramo: Tramo; from: string; to: string; ms: number };
export type StepTimes = { key: string; title: string; start: string | null; end: string | null; ms: number; segments: Segment[]; totals: Record<Tramo, number> };
export type Cronometro = {
  start: string | null;
  end: string | null;
  /** wall time from the first step's start to the last step's end (or now while open) */
  ms: number;
  /** time before the first step could start: idea to «Constrúyelo» */
  before_ms: number | null;
  totals: Record<Tramo, number>;
  steps: StepTimes[];
  open: boolean;
};

const zero = (): Record<Tramo, number> => ({ construye: 0, rehace: 0, fotos: 0, verifica: 0, dueno: 0, detenido: 0 });
const LANDED = new Set(["Merged", "Released", "Done"]);
const WORKING = new Set(["Ready", "In progress"]);

type Interval = { from: number; to: number; tramo: Tramo };

/** One step's timeline: from the moment it could start (Ready) until it landed (merged), cut into labelled pieces.
 * A Taller run is building (redoing once the step was sent back), a photo pass is photos, Plania's check run is
 * verifying; the rest is the owner's turn while In review, else stalled (Ready with nobody working). */
export function stepTimes(step: CronoStepIn, evs: CronoEvent[], runs: CronoRun[], now: Date): StepTimes {
  const mine = evs.filter((e) => e.taskKey === step.key).sort((a, b) => a.at.getTime() - b.at.getTime());
  // Status over time.
  const status: { at: number; to: string }[] = [{ at: step.createdAt.getTime(), to: step.createdStatus }];
  for (const e of mine) if (e.type === "task.status" && typeof e.payload.to === "string") status.push({ at: e.at.getTime(), to: e.payload.to });
  const startAt = status.find((s) => s.to !== "Backlog" && s.to !== "Blocked")?.at ?? null;
  const landed = mine.find((e) => e.type === "pr.merged") ?? mine.find((e) => e.type === "task.status" && LANDED.has(String(e.payload.to)));
  const endAt = landed ? landed.at.getTime() : null;
  const empty: StepTimes = { key: step.key, title: step.title, start: null, end: null, ms: 0, segments: [], totals: zero() };
  if (startAt === null) return empty;
  const stop = endAt ?? now.getTime();
  if (stop <= startAt) return { ...empty, start: new Date(startAt).toISOString() };

  // Send-backs: the owner or El Probador returned it (In review → Ready), so later runs are redoing.
  const sendBacks = mine.filter((e) => (e.type === "task.status" && e.payload.from === "In review" && e.payload.to === "Ready") || e.type === "probador.returned").map((e) => e.at.getTime());
  const firstBack = sendBacks.length ? Math.min(...sendBacks) : Infinity;

  const work: Interval[] = [];
  for (const r of runs) {
    if (r.taskKey !== step.key || r.role !== "taller" || !r.startedAt) continue;
    const from = r.startedAt.getTime();
    const to = (r.endedAt ?? now).getTime();
    work.push({ from, to, tramo: from >= firstBack ? "rehace" : "construye" });
  }
  // Photo passes and check runs: start/end event pairs.
  const pairs = (startType: string, endTypes: string[], tramo: Tramo) => {
    let open: number | null = null;
    for (const e of mine) {
      if (e.type === startType) open = e.at.getTime();
      else if (endTypes.includes(e.type) && open !== null) {
        work.push({ from: open, to: e.at.getTime(), tramo });
        open = null;
      }
    }
    if (open !== null && endAt === null) work.push({ from: open, to: now.getTime(), tramo });
  };
  pairs("probador.started", ["probador.pass", "probador.returned"], "fotos");
  pairs("verify.started", ["verify.done"], "verifica");

  const rank: Record<Tramo, number> = { construye: 0, rehace: 0, fotos: 1, verifica: 2, dueno: 3, detenido: 4 };
  const cuts = new Set<number>([startAt, stop]);
  for (const w of work) {
    if (w.to > startAt && w.from < stop) {
      cuts.add(Math.max(w.from, startAt));
      cuts.add(Math.min(w.to, stop));
    }
  }
  for (const s of status) if (s.at > startAt && s.at < stop) cuts.add(s.at);
  const points = [...cuts].sort((a, b) => a - b);
  const statusAt = (t: number) => {
    let cur = status[0]!.to;
    for (const s of status) if (s.at <= t) cur = s.to;
    return cur;
  };
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (b <= a) continue;
    const mid = (a + b) / 2;
    const busy = work.filter((w) => w.from <= mid && w.to > mid).sort((x, y) => rank[x.tramo] - rank[y.tramo])[0];
    const st = statusAt(mid);
    const tramo: Tramo = busy ? busy.tramo : st === "In review" ? "dueno" : WORKING.has(st) || st === "Blocked" ? "detenido" : "detenido";
    const last = segments[segments.length - 1];
    if (last && last.tramo === tramo && Date.parse(last.to) === a) {
      last.to = new Date(b).toISOString();
      last.ms += b - a;
    } else segments.push({ tramo, from: new Date(a).toISOString(), to: new Date(b).toISOString(), ms: b - a });
  }
  const totals = zero();
  for (const s of segments) totals[s.tramo] += s.ms;
  return { key: step.key, title: step.title, start: new Date(startAt).toISOString(), end: endAt ? new Date(endAt).toISOString() : null, ms: stop - startAt, segments, totals };
}

export function cronometro(steps: CronoStepIn[], evs: CronoEvent[], runs: CronoRun[], now: Date, ideaCreatedAt: Date | null = null): Cronometro {
  const out = steps.map((s) => stepTimes(s, evs, runs, now));
  const starts = out.map((s) => s.start).filter((x): x is string => !!x).map(Date.parse);
  const ends = out.map((s) => (s.end ? Date.parse(s.end) : null));
  const open = out.some((s) => s.start && !s.end) || out.some((s) => !s.start);
  const start = starts.length ? Math.min(...starts) : null;
  const end = !open && ends.length && ends.every((e) => e !== null) ? Math.max(...(ends as number[])) : null;
  const totals = zero();
  for (const s of out) for (const t of TRAMOS) totals[t] += s.totals[t];
  return {
    start: start ? new Date(start).toISOString() : null,
    end: end ? new Date(end).toISOString() : null,
    ms: start ? (end ?? now.getTime()) - start : 0,
    before_ms: start && ideaCreatedAt ? Math.max(0, start - ideaCreatedAt.getTime()) : null,
    totals,
    steps: out,
    open,
  };
}

const TYPES = ["task.status", "task.created", "pr.merged", "probador.started", "probador.pass", "probador.returned", "verify.started", "verify.done"];

/** Reads an initiative's records and returns its stopwatch. */
export async function cronometroFor(db: Db, init: Task, kids: Task[], ideaCreatedAt: Date | null, now = new Date()): Promise<Cronometro> {
  if (!kids.length) return cronometro([], [], [], now, ideaCreatedAt);
  const ids = kids.map((k) => k.id);
  const keys = kids.map((k) => k.key);
  const [evRows, runRows] = await Promise.all([
    db
      .select({ type: events.type, at: events.createdAt, taskKey: events.taskKey, payload: events.payload })
      .from(events)
      .where(and(eq(events.projectId, init.projectId), inArray(events.taskId, ids), inArray(events.type, TYPES)))
      .orderBy(asc(events.id)),
    db
      .select({ taskKey: agentRuns.taskKey, role: agentRuns.role, startedAt: agentRuns.startedAt, endedAt: agentRuns.endedAt })
      .from(agentRuns)
      .where(and(eq(agentRuns.projectId, init.projectId), inArray(agentRuns.taskKey, keys))),
  ]);
  const created = new Map<string, string>();
  for (const e of evRows) if (e.type === "task.created" && e.taskKey && !created.has(e.taskKey)) created.set(e.taskKey, String((e.payload as Record<string, unknown>).status ?? "Backlog"));
  const steps: CronoStepIn[] = kids.map((k) => ({ key: k.key, title: k.title, phase: k.phase ?? null, createdAt: k.createdAt, createdStatus: created.get(k.key) ?? "Backlog" }));
  return cronometro(
    steps,
    evRows.map((e) => ({ type: e.type, at: e.at, taskKey: e.taskKey, payload: (e.payload ?? {}) as Record<string, unknown> })),
    runRows,
    now,
    ideaCreatedAt,
  );
}

