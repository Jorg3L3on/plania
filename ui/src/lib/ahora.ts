// Ahora's model, apart from the markup. Pure functions over the /api shapes (projects, inbox,
// machine), so test/ahora.test.ts can load this file with node:test. The page does not poll:
// LiveProvider already invalidates these queries.
import type { InboxGroup, Readiness, ReadinessReason, ReadinessState } from "./types.js";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type { Readiness, ReadinessReason, ReadinessState };

export const TE_TOCA_LIMIT = 3;

// PLA-I2-10: the model's words, in both languages (the move button's are in lib/ahora-words.ts). The functions that
// return words take the language last, the screen's by default; the exported constants keep their Spanish.
type CourseWord = Record<Exclude<ReadinessState, "no_context">, string>;
export const AHORA_MODEL_WORDS = defineWords({
  es: {
    /** Words on the En curso badge. Color never stands alone. */
    badge: { ready: "Listo", caution: "Con cuidado", blocked: "Bloqueado" } as CourseWord,
    summaryButton: "Ver resumen",
    summaryOnly: "Solo muestra un resumen.",
    summaryAnyway: "Ver resumen de todos modos",
    summaryCancel: "Cancelar",
    readOnly: "Solo lectura. No cambia nada del proyecto.",
    quietPrefix: "Sin trabajo en curso",
    summaryLabel: (button: string, title: string, badge: string, only: string) => `${button} de ${title}, ${badge}. ${only}`,
    urgency: { now: "ahora", soon: "pronto", whenever: "cuando se pueda" } as Record<string, string>,
    staleLease: "arrendamiento vencido",
    goneLease: "ya no está en la máquina",
    noOwner: "sin dueño",
    see: (key: string) => `Ver ${key}`,
    seeQuestion: (key: string) => `Ver la pregunta de ${key}`,
    seeDecision: (key: string) => `Ver la decisión de ${key}`,
    ideaStage: { idea: "Idea", research: "Investigación", design: "Diseño", planning: "Planeación", ready: "Lista" } as Record<"idea" | "research" | "design" | "planning" | "ready", string>,
    becameKey: (key: string) => `Pasó a ${key}`,
    noDestination: "Sin destino",
    momentAgo: "hace un momento",
    minutesAgo: (n: number) => `hace ${n} ${n === 1 ? "minuto" : "minutos"}`,
    hoursAgo: (n: number) => `hace ${n} ${n === 1 ? "hora" : "horas"}`,
    daysAgo: (n: number) => `hace ${n} ${n === 1 ? "día" : "días"}`,
    lastMovement: (ago: string, what: string) => `Último movimiento ${ago}: ${what}`,
  },
  en: {
    badge: { ready: "Ready", caution: "Careful", blocked: "Blocked" },
    summaryButton: "See summary",
    summaryOnly: "It only shows a summary.",
    summaryAnyway: "See summary anyway",
    summaryCancel: "Cancel",
    readOnly: "Read only. It changes nothing in the project.",
    quietPrefix: "No work in progress",
    summaryLabel: (button: string, title: string, badge: string, only: string) => `${button} of ${title}, ${badge}. ${only}`,
    urgency: { now: "now", soon: "soon", whenever: "whenever" },
    staleLease: "lease expired",
    goneLease: "no longer on the machine",
    noOwner: "no owner",
    see: (key: string) => `See ${key}`,
    seeQuestion: (key: string) => `See the question on ${key}`,
    seeDecision: (key: string) => `See the decision on ${key}`,
    ideaStage: { idea: "Idea", research: "Research", design: "Design", planning: "Planning", ready: "Ready" },
    becameKey: (key: string) => `Became ${key}`,
    noDestination: "No destination",
    momentAgo: "a moment ago",
    minutesAgo: (n: number) => `${n} ${n === 1 ? "minute" : "minutes"} ago`,
    hoursAgo: (n: number) => `${n} ${n === 1 ? "hour" : "hours"} ago`,
    daysAgo: (n: number) => `${n} ${n === 1 ? "day" : "days"} ago`,
    lastMovement: (ago: string, what: string) => `Last movement ${ago}: ${what}`,
  },
});
const W = (language: Language) => words(AHORA_MODEL_WORDS, language);
const ES = AHORA_MODEL_WORDS.es;

/** Words on the En curso badge, in Spanish (kept for the tests); W(language).badge is the screen's. */
export const READINESS_BADGE: Record<Exclude<ReadinessState, "no_context">, string> = ES.badge;

export const SUMMARY_BUTTON = ES.summaryButton;
export const SUMMARY_ONLY = ES.summaryOnly;
export const SUMMARY_ANYWAY = ES.summaryAnyway;
export const SUMMARY_CANCEL = ES.summaryCancel;
export const READ_ONLY_LINE = ES.readOnly;
export const QUIET_PREFIX = ES.quietPrefix;

/** Questions carry this; decisions and steps do not, and sort with "now". */
export const URGENCY_WORD: Record<string, string> = ES.urgency;

export const STALE_LEASE = ES.staleLease;
export const GONE_LEASE = ES.goneLease;
/** In progress, and nobody ever held it. Not a lease that ran out. */
export const NO_OWNER = ES.noOwner;

const URGENCY_RANK: Record<string, number> = { now: 0, soon: 1, whenever: 2 };

export type AhoraTask = {
  key: string;
  kind: "initiative" | "ticket" | "idea";
  title: string;
  status: string;
  claimed_by?: { agent: string } | null;
  lease_until?: string | null;
  claimed_at?: string | null;
  last_seen_at?: string | null;
};

export type AhoraProject = {
  slug: string;
  title: string;
  /** The generated line (list_projects / GET /api/projects `line`). */
  line: string;
  /** Server readiness. The screen shows it and does not recompute it. */
  readiness: Readiness;
  tasks: AhoraTask[];
  next_claimable: { key: string; title: string; kind?: string } | null;
  initiatives?: { key: string; waiting_on?: { key: string; on: string }[] }[];
};

export type AhoraFootprint = { project: string | null; task_key: string | null; state: string };

export type AhoraInboxItem = {
  id: string;
  group: InboxGroup;
  project: string;
  key: string | null;
  title: string | null;
  why: string;
  urgency?: string | null;
  waiting_since: string;
  wait_s: number;
};

/** now, then soon, then whenever. No urgency (a step) sorts as now. Age is older first. */
export function urgencyRank(urgency: string | null | undefined): number {
  if (urgency && Object.hasOwn(URGENCY_RANK, urgency)) return URGENCY_RANK[urgency]!;
  return 0;
}

function byUrgencyThenAge(a: AhoraInboxItem, b: AhoraInboxItem): number {
  return urgencyRank(a.urgency) - urgencyRank(b.urgency) || a.waiting_since.localeCompare(b.waiting_since) || a.id.localeCompare(b.id);
}

/** Decisiones and pasos only (limpieza is a chore). `count` is get_inbox's count; the list is at most three. */
export function teTocaOf<T extends AhoraInboxItem>(inbox: { items: T[]; count: number }): { count: number; items: T[] } {
  const items = inbox.items.filter((i) => i.group !== "limpieza").sort(byUrgencyThenAge);
  return { count: inbox.count, items: items.slice(0, TE_TOCA_LIMIT) };
}

export type CourseState = Exclude<ReadinessState, "no_context">;

export type CourseRow = {
  slug: string;
  title: string;
  state: CourseState;
  reasons: ReadinessReason[];
  line: string;
};

export type QuietProject = { slug: string; title: string };

export type SummaryAction = "open" | "confirm" | "none";

export type UnblockLink = { href: string; label: string };

const CLOSED = new Set(["Done", "Won't do"]);

function at(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? null : n;
}

function goneOnMachine(machine: AhoraFootprint[], slug: string, key: string): boolean {
  return machine.some((it) => it.project === slug && it.task_key === key && (it.state === "stale" || it.state === "gone"));
}

function leaseLive(task: AhoraTask, nowMs: number): boolean {
  const until = at(task.lease_until);
  return !!task.claimed_by && until !== null && until > nowMs;
}

/** A lease_until in the past means one existed and ran out. Missing means it never had one. */
function leaseExpired(task: AhoraTask, nowMs: number): boolean {
  const until = at(task.lease_until);
  return until !== null && until <= nowMs;
}

/**
 * Live work is a claim the server still shows (live or quiet: the lease is on the row),
 * a claim it marks expired, or a ticket In review. no_context never qualifies.
 * The screen's task list hides an expired lease, so that case is the server's LEASE_EXPIRED.
 */
export function hasLiveWork(project: AhoraProject): boolean {
  if (project.readiness.state === "no_context") return false;
  if (project.readiness.reasons.some((reason) => reason.code === "LEASE_EXPIRED")) return true;
  return project.tasks.some(
    (task) => task.kind === "ticket" && !CLOSED.has(task.status) && (task.status === "In review" || (!!task.claimed_by && !!task.lease_until)),
  );
}

/** Rows for projects with live work, in the order given. State, reasons and line are the server's. */
export function enCursoOf(projects: AhoraProject[]): CourseRow[] {
  const rows: CourseRow[] = [];
  for (const project of projects) {
    if (!hasLiveWork(project) || project.readiness.state === "no_context") continue;
    rows.push({
      slug: project.slug,
      title: project.title,
      state: project.readiness.state,
      reasons: project.readiness.reasons,
      line: project.readiness.line,
    });
  }
  return rows;
}

/** Projects with no live work, including no_context. The quiet line names them and has no buttons. */
export function sinTrabajoOf(projects: AhoraProject[]): QuietProject[] {
  return projects.filter((project) => !hasLiveWork(project)).map((project) => ({ slug: project.slug, title: project.title }));
}

export function quietLine(quiet: { title: string }[], language: Language = getLanguage()): string {
  const prefix = W(language).quietPrefix;
  if (!quiet.length) return `${prefix}.`;
  return `${prefix}: ${quiet.map((project) => project.title).join(", ")}`;
}

/** ready opens the sheet. caution confirms first. blocked and no_context have no button. */
export function summaryAction(state: ReadinessState): SummaryAction {
  if (state === "ready") return "open";
  if (state === "caution") return "confirm";
  return "none";
}

export function summaryLabel(title: string, state: CourseState, language: Language = getLanguage()): string {
  const w = W(language);
  return w.summaryLabel(w.summaryButton, title, w.badge[state], w.summaryOnly);
}

/** The blocked row links to the ticket, or to the question that holds it. */
export function unblockOf(row: Pick<CourseRow, "slug" | "state" | "reasons">, inbox: { project: string; key: string | null; kind: string }[] = [], language: Language = getLanguage()): UnblockLink | null {
  const w = W(language);
  if (row.state !== "blocked") return null;
  const reason = row.reasons.find((item) => item.severity === "blocked");
  const key = reason?.task_key;
  if (!reason || !key) return null;
  const href = `/p/${row.slug}?task=${encodeURIComponent(key)}`;
  if (reason.code !== "DECISION_PENDING") return { href, label: w.see(key) };
  const kinds = new Set(inbox.filter((item) => item.project === row.slug && item.key === key).map((item) => item.kind));
  if (kinds.has("question")) return { href, label: w.seeQuestion(key) };
  return { href, label: w.seeDecision(key) };
}

export type BlockRow = { slug: string; title: string; key: string; on: string; kind: "wait" | "lease" };

function ideaKey(project: AhoraProject, key: string): boolean {
  return project.tasks.some((t) => t.key === key && t.kind === "idea");
}

/** Waits that are not on the owner, then a lease that ran out, a claim the machine dropped, or work with no owner. Ideas never land here. */
export function bloqueadoOf(projects: AhoraProject[], machine: AhoraFootprint[], nowMs: number, language: Language = getLanguage()): BlockRow[] {
  const w = W(language);
  const rows: BlockRow[] = [];
  for (const p of projects) {
    for (const i of p.initiatives ?? []) {
      for (const w of i.waiting_on ?? []) {
        if (w.on.startsWith("Owner:") || w.on.startsWith("Jorge")) continue; // PLA-I2-14: "Jorge" from servers before protocol 2.24
        if (ideaKey(p, w.key)) continue;
        rows.push({ slug: p.slug, title: p.title, key: w.key, on: w.on, kind: "wait" });
      }
    }
    for (const t of p.tasks) {
      if (t.kind !== "ticket" || t.status !== "In progress") continue;
      const gone = goneOnMachine(machine, p.slug, t.key);
      if (gone) {
        rows.push({ slug: p.slug, title: p.title, key: t.key, on: w.goneLease, kind: "lease" });
        continue;
      }
      if (leaseLive(t, nowMs)) continue;
      const on = leaseExpired(t, nowMs) ? w.staleLease : t.claimed_by ? null : w.noOwner;
      if (on) rows.push({ slug: p.slug, title: p.title, key: t.key, on, kind: "lease" });
    }
  }
  return rows;
}

export type NextRow = { slug: string; title: string; key: string; taskTitle: string };

/** The next claimable ticket of each project that has one, in project order. An idea is never one of these lines. */
export function siguienteOf(projects: AhoraProject[]): NextRow[] {
  const rows: NextRow[] = [];
  for (const p of projects) {
    const next = p.next_claimable;
    if (!next || next.kind === "idea" || ideaKey(p, next.key)) continue;
    rows.push({ slug: p.slug, title: p.title, key: next.key, taskTitle: next.title });
  }
  return rows;
}

// The five stages an idea walks, in order. Labels match StageChip (ui/src/components/task-row.tsx).
export const IDEA_STAGES = ["idea", "research", "design", "planning", "ready"] as const;
export type IdeaStage = (typeof IDEA_STAGES)[number];

/** The stages' labels in Spanish (kept for the tests); ideaStageLabel reads them in the screen's language. */
export const IDEA_STAGE_LABEL: Record<IdeaStage, string> = ES.ideaStage;

// ideaWaitText (src/mcp/ideas.ts) says these when nothing is holding the idea. They are not a wait.
const NOT_WAITING = new Set(["Puede avanzar", "Lista para promover"]);

export function isIdeaStage(stage: string): stage is IdeaStage {
  return (IDEA_STAGES as readonly string[]).includes(stage);
}

export function ideaStageLabel(stage: string, language: Language = getLanguage()): string {
  return isIdeaStage(stage) ? W(language).ideaStage[stage] : stage;
}

export type IdeaTask = {
  key: string;
  kind: string;
  title: string;
  summary: string;
  status: string;
  stage?: string | null;
  promoted_to?: string | null;
  waits?: string | null;
  created_at?: string | null;
  updated_at: string;
};

export type AhoraIdea = {
  slug: string;
  projectTitle: string;
  key: string;
  line: string;
  stage: IdeaStage;
  status: string;
  waits: string;
  promotedTo: string | null;
  createdAt: string;
};

export function ideaClosed(status: string): boolean {
  return status === "Done" || status === "Won't do";
}

export type FinishedProbe = { status: string; stage?: string | null; promoted_to?: string | null; promotedTo?: string | null };

/** Done for the idea lists (PLA-I18-6): closed, or it already became something (promoted_to), or it
 * reached ready. Lists hide these by default. A closed idea uses ideaClosed for its outcome line. */
export function ideaFinished(idea: FinishedProbe): boolean {
  if (ideaClosed(idea.status)) return true;
  if ((idea.promoted_to ?? idea.promotedTo ?? "").trim()) return true;
  return idea.stage === "ready";
}

/** Open, and held by a doc, a heading or a question. "Puede avanzar" and "Lista para promover" are free. */
export function ideaIsWaiting(idea: Pick<AhoraIdea, "status" | "stage" | "promotedTo" | "waits">): boolean {
  if (ideaFinished(idea)) return false;
  const waits = idea.waits.trim();
  return waits.length > 0 && !NOT_WAITING.has(waits);
}

/** What a closed idea became. Null while it is still open. */
export function ideaOutcome(idea: Pick<AhoraIdea, "status" | "promotedTo">, language: Language = getLanguage()): string | null {
  if (!ideaClosed(idea.status)) return null;
  return idea.promotedTo ? W(language).becameKey(idea.promotedTo) : W(language).noDestination;
}

/** Ideas on one project, from the per-project read. */
export function ideasFromProject(project: { slug: string; title: string }, tasks: IdeaTask[]): AhoraIdea[] {
  const ideas: AhoraIdea[] = [];
  for (const task of tasks) {
    if (task.kind !== "idea" || !task.stage || !isIdeaStage(task.stage)) continue;
    ideas.push({
      slug: project.slug,
      projectTitle: project.title,
      key: task.key,
      line: task.summary.trim() || task.title,
      stage: task.stage,
      status: task.status,
      waits: (task.waits ?? "").trim(),
      promotedTo: task.promoted_to?.trim() || null,
      createdAt: task.created_at || task.updated_at,
    });
  }
  return ideas;
}

export type IdeaColumn = { stage: IdeaStage; label: string; ideas: AhoraIdea[] };

function byAge(a: AhoraIdea, b: AhoraIdea): number {
  return a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key, undefined, { numeric: true }) || a.slug.localeCompare(b.slug);
}

/** The stages an unfinished idea can be in: ready counts as finished (ideaFinished). */
export const OPEN_IDEA_STAGES = IDEA_STAGES.filter((stage) => stage !== "ready");

/** One column per open stage, in stage order, oldest first. Finished ideas are left out. */
export function ideasByStage(ideas: AhoraIdea[], language: Language = getLanguage()): IdeaColumn[] {
  const open = ideas.filter((idea) => !ideaFinished(idea));
  return OPEN_IDEA_STAGES.map((stage) => ({
    stage,
    label: W(language).ideaStage[stage],
    ideas: open.filter((idea) => idea.stage === stage).sort(byAge),
  }));
}

/** The single Siguiente line: the oldest idea that is still waiting. Null when none is. */
export function oldestWaitingIdea(ideas: AhoraIdea[]): AhoraIdea | null {
  const waiting = ideas.filter(ideaIsWaiting).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key, undefined, { numeric: true }) || a.slug.localeCompare(b.slug));
  return waiting[0] ?? null;
}

export type RetomarClaim = { key: string; title: string; agent: string | null };
export type Retomar = {
  headline: string;
  note: string;
  noteStale: boolean;
  claims: RetomarClaim[];
  next: { key: string; title: string } | null;
};

function movementAgo(atMs: number, nowMs: number, language: Language): string {
  const w = W(language);
  const seconds = Math.max(0, Math.round((nowMs - atMs) / 1000));
  if (seconds < 90) return w.momentAgo;
  if (seconds < 3600) return w.minutesAgo(Math.max(1, Math.round(seconds / 60)));
  if (seconds < 86400) return w.hoursAgo(Math.max(1, Math.round(seconds / 3600)));
  return w.daysAgo(Math.max(1, Math.round(seconds / 86400)));
}

/** The last event, when the generated headline is empty. Empty when there is no event. */
export function lastMovementLine(
  event: { at: string; type?: string | null; task_key?: string | null; agent?: string | null } | null | undefined,
  nowMs = Date.now(),
  language: Language = getLanguage(),
): string {
  if (!event?.at) return "";
  const at = Date.parse(event.at);
  if (Number.isNaN(at)) return "";
  const what = [event.task_key, event.type].filter((part): part is string => !!part).join(" · ");
  if (!what) return "";
  const who = event.agent ? ` (${event.agent})` : "";
  return W(language).lastMovement(movementAgo(at, nowMs, language), `${what}${who}`);
}

/** The four lines Retomar shows from get_resume, before the full ResumeView. */
export function retomarOf(resume: {
  headline: { generated: string; note: { text: string; stale: boolean } };
  claims: { key: string; title: string; owner: { agent?: string } | null }[];
  next_claimable: { key: string; title: string } | null;
}): Retomar {
  return {
    headline: resume.headline.generated,
    note: resume.headline.note.text,
    noteStale: resume.headline.note.stale,
    claims: resume.claims.map((c) => ({ key: c.key, title: c.title, agent: c.owner?.agent ?? null })),
    next: resume.next_claimable,
  };
}
