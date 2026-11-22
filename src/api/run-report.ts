// PLA-I74-1: the run report of one initiative. Guided test 4's numbers were put together by hand from a log; this
// counts every rescue from Plania's own records, from the request to publishing (or now while it runs):
//   fixes      tickets of the home project (Plania's own) created while it ran, or that name it in their title or
//              scope; the initiative's own steps never count
//   clicks     owner.click events (src/api/clicks.ts) on it: his decisions, and every other click by control. Before
//              that event existed the screen's own writes are counted instead (estimated: true)
//   heals      turn.healed events on it (the watchdog's; zero until it writes them)
//   stops      time per stop: each stop of the idea up to «Constrúyelo», then building and publishing
//   gap        the longest stretch with nobody's turn: no run working on it, no photo pass or check, and no card
//              open for the owner (a step In review, an open question, the idea ready and waiting for «Constrúyelo»)
//   tokens     tokens per agent role, from the runs on it
// The derivation is pure (runReport) and tested from a seeded log; runReportFor reads the records.
import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, events, projects, questions, tasks, type Task } from "../db/schema.js";
import { isScreenActor } from "../mcp/tx.js";
import { OWNER_CLICK, type DecisionControl } from "./clicks.js";
import { ST } from "../state/status.js";

export const HEALED = "turn.healed";
export type ReportStop = "entendido" | "investigacion" | "diseno" | "plan" | "lista" | "construccion" | "publicado";
export const REPORT_STOPS: ReportStop[] = ["entendido", "investigacion", "diseno", "plan", "lista", "construccion", "publicado"];

export type ReportEvent = { type: string; at: Date; taskKey: string | null; payload: Record<string, unknown>; screen: boolean };
export type ReportRun = { taskKey: string | null; role: string; startedAt: Date | null; endedAt: Date | null; tokens: number };
export type ReportFix = { key: string; title: string; status: string; createdAt: Date; marked: boolean };
export type ReportQuestion = { taskKey: string | null; askedAt: Date; answeredAt: Date | null };
export type ReportInput = {
  /** the initiative, its idea and its steps: every key the report reads */
  keys: string[];
  steps: string[];
  start: Date;
  /** published, else null (the report runs to now) */
  end: Date | null;
  now: Date;
  /** when each stop was reached; null when it was not (the idea's stops, «Constrúyelo», the last step landed) */
  marks: Partial<Record<"buzon" | ReportStop, Date | null>>;
  events: ReportEvent[];
  runs: ReportRun[];
  fixes: ReportFix[];
  questions: ReportQuestion[];
};

export type RunReport = {
  start: string;
  end: string | null;
  open: boolean;
  fixes: { count: number; items: { key: string; title: string; status: string }[] };
  clicks: { decisions: number; extra: number; estimated: boolean; by_decision: Partial<Record<DecisionControl, number>>; extra_by_control: { control: string; n: number }[] };
  heals: number;
  stops: { stop: ReportStop; ms: number | null; open: boolean }[];
  gap: { ms: number; from: string; to: string } | null;
  tokens: { agent: string; tokens: number; runs: number }[];
};

type Span = { from: number; to: number };

/** Merges spans and returns the longest stretch of [from, to] none of them covers. */
export function longestUncovered(spans: Span[], from: number, to: number): Span | null {
  if (to <= from) return null;
  const sorted = spans.map((s) => ({ from: Math.max(from, s.from), to: Math.min(to, s.to) })).filter((s) => s.to > s.from).sort((a, b) => a.from - b.from);
  let best: Span | null = null;
  let cursor = from;
  const take = (a: number, b: number) => {
    if (b > a && (!best || b - a > best.to - best.from)) best = { from: a, to: b };
  };
  for (const s of sorted) {
    take(cursor, s.from);
    cursor = Math.max(cursor, s.to);
  }
  take(cursor, to);
  return best;
}

// The owner's writes before owner.click existed, by event type: which of them were decisions.
const LEGACY_DECISION: Record<string, DecisionControl> = { "task.created": "pedir", "pedido.construir": "construyelo", "question.answered": "respuesta", "release.shipped": "publicar" };
const LEGACY_SKIP = new Set(["idea.visto", "usage.reported", OWNER_CLICK]);

function clicksOf(evs: ReportEvent[]): RunReport["clicks"] {
  const by: Partial<Record<DecisionControl, number>> = {};
  const extra = new Map<string, number>();
  const clicks = evs.filter((e) => e.type === OWNER_CLICK);
  const estimated = clicks.length === 0;
  const add = (decision: DecisionControl | null, control: string) => {
    if (decision) by[decision] = (by[decision] ?? 0) + 1;
    else extra.set(control, (extra.get(control) ?? 0) + 1);
  };
  if (!estimated) for (const e of clicks) add((e.payload.decision as DecisionControl | null) ?? null, String(e.payload.control ?? "otro"));
  else
    for (const e of evs) {
      if (!e.screen || LEGACY_SKIP.has(e.type)) continue;
      if (e.type === "idea.respuesta") {
        const v = e.payload.verdict;
        add(v === "deshacer" ? null : v === "ok" && e.payload.stop === "entendido" ? "asi_es" : v === "ok" && e.payload.stop === "diseno" ? "me_gusta" : "respuesta", "ideas.respuesta");
      } else add(LEGACY_DECISION[e.type] ?? null, e.type);
    }
  const decisions = Object.values(by).reduce((a, n) => a + (n ?? 0), 0);
  const extraList = [...extra].map(([control, n]) => ({ control, n })).sort((a, b) => b.n - a.n || a.control.localeCompare(b.control));
  return { decisions, extra: extraList.reduce((a, x) => a + x.n, 0), estimated, by_decision: by, extra_by_control: extraList };
}

/** Time per stop: from the last stop reached before it to the moment it was reached; the stop it sits on runs to now. */
function stopsOf(input: ReportInput): RunReport["stops"] {
  const order: ("buzon" | ReportStop)[] = ["buzon", ...REPORT_STOPS];
  const stopAt = (input.end ?? input.now).getTime();
  const out: RunReport["stops"] = [];
  let prev: number | null = (input.marks.buzon ?? input.start).getTime();
  let current = false;
  for (const s of order.slice(1) as ReportStop[]) {
    const at = input.marks[s]?.getTime() ?? (s === "publicado" && input.end ? input.end.getTime() : null);
    if (at !== null && prev !== null) {
      out.push({ stop: s, ms: Math.max(0, at - prev), open: false });
      prev = at;
    } else if (at === null && prev !== null && !current) {
      // The first stop not reached yet is where it sits: it runs to now (or to the end).
      const later = order.slice(order.indexOf(s) + 1).some((x) => input.marks[x as ReportStop]);
      if (later) out.push({ stop: s, ms: null, open: false });
      else {
        out.push({ stop: s, ms: Math.max(0, stopAt - prev), open: !input.end });
        current = true;
      }
    } else out.push({ stop: s, ms: null, open: false });
  }
  return out;
}

export function runReport(input: ReportInput): RunReport {
  const keys = new Set(input.keys);
  const mine = (e: { taskKey: string | null; payload?: Record<string, unknown> }) => (e.taskKey !== null && keys.has(e.taskKey)) || (typeof e.payload?.key === "string" && keys.has(e.payload.key));
  const from = input.start.getTime();
  const to = (input.end ?? input.now).getTime();
  const inWindow = (t: number) => t >= from && t <= to;
  const evs = input.events.filter((e) => mine(e) && inWindow(e.at.getTime())).sort((a, b) => a.at.getTime() - b.at.getTime());

  // Fixes: the home project's tickets made while it ran, or marked with its key; never its own steps.
  const own = new Set(input.steps);
  const fixes = input.fixes.filter((f) => !own.has(f.key) && !keys.has(f.key) && (f.marked || inWindow(f.createdAt.getTime())));

  // Somebody's turn: runs and Plania's own passes working on it, and the owner's open cards.
  const busy: Span[] = [];
  for (const r of input.runs) if (r.taskKey && keys.has(r.taskKey) && r.startedAt) busy.push({ from: r.startedAt.getTime(), to: (r.endedAt ?? input.now).getTime() });
  const pairs = (start: string, ends: string[]) => {
    const open = new Map<string, number>();
    for (const e of evs) {
      const k = e.taskKey ?? "";
      if (e.type === start) open.set(k, e.at.getTime());
      else if (ends.includes(e.type) && open.has(k)) {
        busy.push({ from: open.get(k)!, to: e.at.getTime() });
        open.delete(k);
      }
    }
    for (const at of open.values()) busy.push({ from: at, to });
  };
  pairs("probador.started", ["probador.pass", "probador.returned"]);
  pairs("verify.started", ["verify.done"]);
  // A step In review waits on the owner's Aceptar or Pedir ajuste.
  const review = new Map<string, number>();
  for (const e of evs) {
    if (e.type !== "task.status" || !e.taskKey) continue;
    if (e.payload.to === ST.inReview) review.set(e.taskKey, e.at.getTime());
    else if (review.has(e.taskKey)) {
      busy.push({ from: review.get(e.taskKey)!, to: e.at.getTime() });
      review.delete(e.taskKey);
    }
  }
  for (const at of review.values()) busy.push({ from: at, to });
  for (const q of input.questions) if (q.taskKey && keys.has(q.taskKey)) busy.push({ from: q.askedAt.getTime(), to: (q.answeredAt ?? input.now).getTime() });
  // The idea ready, waiting for «Constrúyelo».
  const ready = input.marks.plan?.getTime() ?? null;
  if (ready !== null) busy.push({ from: ready, to: input.marks.lista?.getTime() ?? to });
  const gap = longestUncovered(busy, from, to);

  const tokens = new Map<string, { tokens: number; runs: number }>();
  for (const r of input.runs) {
    if (!r.taskKey || !keys.has(r.taskKey)) continue;
    const t = tokens.get(r.role) ?? { tokens: 0, runs: 0 };
    t.tokens += r.tokens;
    t.runs += 1;
    tokens.set(r.role, t);
  }

  return {
    start: input.start.toISOString(),
    end: input.end ? input.end.toISOString() : null,
    open: !input.end,
    fixes: { count: fixes.length, items: fixes.slice(0, 12).map((f) => ({ key: f.key, title: f.title, status: f.status })) },
    clicks: clicksOf(evs),
    heals: evs.filter((e) => e.type === HEALED).length,
    stops: stopsOf(input),
    gap: gap ? { ms: gap.to - gap.from, from: new Date(gap.from).toISOString(), to: new Date(gap.to).toISOString() } : null,
    tokens: [...tokens].map(([agent, t]) => ({ agent, ...t })).sort((a, b) => b.tokens - a.tokens || a.agent.localeCompare(b.agent)),
  };
}

const REPORT_TYPES = [OWNER_CLICK, HEALED, "task.status", "task.created", "probador.started", "probador.pass", "probador.returned", "verify.started", "verify.done", "idea.respuesta", "pedido.construir", "question.answered", "release.shipped"];
const homeSlug = () => process.env.PLANIA_HOME_PROJECT?.trim() || "plania";

export type ReportMarks = ReportInput["marks"];

/** Reads one initiative's records and returns its report. idea: the idea it was born from, when there is one. */
export async function runReportFor(db: Db, init: Task, kids: Task[], idea: Task | null, marks: ReportMarks, end: Date | null, now = new Date()): Promise<RunReport> {
  const keys = [init.key, ...(idea ? [idea.key] : []), ...kids.map((k) => k.key)];
  const start = idea?.createdAt ?? init.createdAt;
  const [evRows, runRows, qRows, home] = await Promise.all([
    db
      .select({ type: events.type, at: events.createdAt, taskKey: events.taskKey, payload: events.payload, actor: events.actor })
      .from(events)
      .where(and(eq(events.projectId, init.projectId), inArray(events.type, REPORT_TYPES), gte(events.createdAt, start), or(inArray(events.taskKey, keys), inArray(sql`${events.payload}->>'key'`, keys))))
      .orderBy(events.id),
    db
      .select({ taskKey: agentRuns.taskKey, role: agentRuns.role, startedAt: agentRuns.startedAt, endedAt: agentRuns.endedAt, total: agentRuns.tokensTotal, input: agentRuns.inputTokens, output: agentRuns.outputTokens })
      .from(agentRuns)
      .where(and(eq(agentRuns.projectId, init.projectId), inArray(agentRuns.taskKey, keys))),
    db
      .select({ taskId: questions.taskId, askedAt: questions.askedAt, answeredAt: questions.answeredAt })
      .from(questions)
      .where(inArray(questions.taskId, [init.id, ...(idea ? [idea.id] : []), ...kids.map((k) => k.id)])),
    db.select({ id: projects.id }).from(projects).where(eq(projects.slug, homeSlug())).limit(1),
  ]);
  const until = end ?? now;
  const fixRows = home[0]
    ? await db
        .select({ key: tasks.key, title: tasks.title, status: tasks.status, createdAt: tasks.createdAt, scope: tasks.scope, parentId: tasks.parentId })
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, home[0].id),
            eq(tasks.kind, "ticket"),
            or(and(gte(tasks.createdAt, start), lte(tasks.createdAt, until)), ...keys.map((k) => sql`(${tasks.title} || ' ' || coalesce(${tasks.scope}, '')) ~ ${`(^|[^A-Z0-9-])${k.replace(/[-]/g, "\\-")}([^A-Z0-9-]|$)`}`)),
          ),
        )
    : [];
  const keyOfId = new Map([[init.id, init.key], ...(idea ? ([[idea.id, idea.key]] as [string, string][]) : []), ...kids.map((k) => [k.id, k.key] as [string, string])]);
  const marked = (r: { title: string; scope: string | null }) => keys.some((k) => new RegExp(`(^|[^A-Z0-9-])${k.replace(/[-]/g, "\\-")}([^A-Z0-9-]|$)`).test(`${r.title} ${r.scope ?? ""}`));
  return runReport({
    keys,
    steps: kids.map((k) => k.key),
    start,
    end,
    now,
    marks,
    events: evRows.map((e) => ({ type: e.type, at: e.at, taskKey: e.taskKey, payload: (e.payload ?? {}) as Record<string, unknown>, screen: isScreenActor(e.actor) })),
    runs: runRows.map((r) => ({ taskKey: r.taskKey, role: r.role, startedAt: r.startedAt, endedAt: r.endedAt, tokens: r.total || r.input + r.output })),
    fixes: fixRows.filter((r) => r.parentId !== init.id).map((r) => ({ key: r.key, title: r.title, status: r.status, createdAt: r.createdAt, marked: marked(r) })),
    questions: qRows.map((q) => ({ taskKey: keyOfId.get(q.taskId) ?? null, askedAt: q.askedAt, answeredAt: q.answeredAt })),
  });
}
