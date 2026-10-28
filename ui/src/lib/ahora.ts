// Ahora's model, apart from the markup. Pure functions over the /api shapes (projects, inbox,
// machine), so test/ahora.test.ts can load this file with node:test. The page does not poll:
// LiveProvider already invalidates these queries.
import type { InboxGroup, Readiness, ReadinessReason, ReadinessState } from "./types.js";

export type { Readiness, ReadinessReason, ReadinessState };

export const TE_TOCA_LIMIT = 3;

/** Words on the En curso badge. Color never stands alone. */
export const READINESS_BADGE: Record<Exclude<ReadinessState, "no_context">, string> = {
  ready: "Listo",
  caution: "Con cuidado",
  blocked: "Bloqueado",
};

export const SUMMARY_BUTTON = "Ver resumen";
export const SUMMARY_ONLY = "Solo muestra un resumen.";
export const SUMMARY_ANYWAY = "Ver resumen de todos modos";
export const SUMMARY_CANCEL = "Cancelar";
export const READ_ONLY_LINE = "Solo lectura. No cambia nada del proyecto.";
export const QUIET_PREFIX = "Sin trabajo en curso";

/** Questions carry this; decisions and steps do not, and sort with "now". */
export const URGENCY_WORD: Record<string, string> = {
  now: "ahora",
  soon: "pronto",
  whenever: "cuando se pueda",
};

export const STALE_LEASE = "arrendamiento vencido";
export const GONE_LEASE = "ya no está en la máquina";
/** In progress, and nobody ever held it. Not a lease that ran out. */
export const NO_OWNER = "sin dueño";

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

/** now, then soon, then whenever. No urgency (an approval, a step) sorts as now. Age is older first. */
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

export function quietLine(quiet: { title: string }[]): string {
  if (!quiet.length) return `${QUIET_PREFIX}.`;
  return `${QUIET_PREFIX}: ${quiet.map((project) => project.title).join(", ")}`;
}

/** ready opens the sheet. caution confirms first. blocked and no_context have no button. */
export function summaryAction(state: ReadinessState): SummaryAction {
  if (state === "ready") return "open";
  if (state === "caution") return "confirm";
  return "none";
}

export function summaryLabel(title: string, state: CourseState): string {
  return `${SUMMARY_BUTTON} de ${title}, ${READINESS_BADGE[state]}. ${SUMMARY_ONLY}`;
}

/** The blocked row links to the ticket, or to the question or approval that holds it. */
export function unblockOf(row: Pick<CourseRow, "slug" | "state" | "reasons">, inbox: { project: string; key: string | null; kind: string }[] = []): UnblockLink | null {
  if (row.state !== "blocked") return null;
  const reason = row.reasons.find((item) => item.severity === "blocked");
  const key = reason?.task_key;
  if (!reason || !key) return null;
  const href = `/p/${row.slug}?task=${encodeURIComponent(key)}`;
  if (reason.code !== "DECISION_PENDING") return { href, label: `Ver ${key}` };
  const kinds = new Set(inbox.filter((item) => item.project === row.slug && item.key === key).map((item) => item.kind));
  if (kinds.has("approval") && !kinds.has("question")) return { href, label: `Ver la aprobación de ${key}` };
  if (kinds.has("question")) return { href, label: `Ver la pregunta de ${key}` };
  return { href, label: `Ver la decisión de ${key}` };
}

export type BlockRow = { slug: string; title: string; key: string; on: string; kind: "wait" | "lease" };

function ideaKey(project: AhoraProject, key: string): boolean {
  return project.tasks.some((t) => t.key === key && t.kind === "idea");
}

/** Waits that are not on Jorge, then a lease that ran out, a claim the machine dropped, or work with no owner. Ideas never land here. */
export function bloqueadoOf(projects: AhoraProject[], machine: AhoraFootprint[], nowMs: number): BlockRow[] {
  const rows: BlockRow[] = [];
  for (const p of projects) {
    for (const i of p.initiatives ?? []) {
      for (const w of i.waiting_on ?? []) {
        if (w.on.startsWith("Jorge")) continue;
        if (ideaKey(p, w.key)) continue;
        rows.push({ slug: p.slug, title: p.title, key: w.key, on: w.on, kind: "wait" });
      }
    }
    for (const t of p.tasks) {
      if (t.kind !== "ticket" || t.status !== "In progress") continue;
      const gone = goneOnMachine(machine, p.slug, t.key);
      if (gone) {
        rows.push({ slug: p.slug, title: p.title, key: t.key, on: GONE_LEASE, kind: "lease" });
        continue;
      }
      if (leaseLive(t, nowMs)) continue;
      const on = leaseExpired(t, nowMs) ? STALE_LEASE : t.claimed_by ? null : NO_OWNER;
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

export const IDEA_STAGE_LABEL: Record<IdeaStage, string> = {
  idea: "Idea",
  research: "Investigación",
  design: "Diseño",
  planning: "Planeación",
  ready: "Lista",
};

/** Shown only when an idea has an open gate question waiting on Jorge. */
export const GATE_MARK = "◆";

const GATES = new Set(["A", "B", "C"]);

// ideaWaitText (src/mcp/ideas.ts) says these when nothing is holding the idea. They are not a wait.
const NOT_WAITING = new Set(["Puede avanzar", "Lista para promover"]);

export function isIdeaStage(stage: string): stage is IdeaStage {
  return (IDEA_STAGES as readonly string[]).includes(stage);
}

export function ideaStageLabel(stage: string): string {
  return isIdeaStage(stage) ? IDEA_STAGE_LABEL[stage] : stage;
}

export type IdeaQuestion = { task_key: string; gate?: string | null; answered_at?: string | null };

/** True exactly when this idea has an open gate question (A, B or C) still unanswered. */
export function ideaGateOpen(key: string, questions: IdeaQuestion[]): boolean {
  return questions.some((q) => q.task_key === key && !!q.gate && GATES.has(q.gate) && !q.answered_at);
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
  gateOpen: boolean;
  createdAt: string;
};

export function ideaClosed(status: string): boolean {
  return status === "Done" || status === "Won't do";
}

/** Open, and held by a doc, a heading, a question or a gate. "Puede avanzar" and "Lista para promover" are free. */
export function ideaIsWaiting(idea: Pick<AhoraIdea, "status" | "waits">): boolean {
  if (ideaClosed(idea.status)) return false;
  const waits = idea.waits.trim();
  return waits.length > 0 && !NOT_WAITING.has(waits);
}

/** What a closed idea became. Null while it is still open. */
export function ideaOutcome(idea: Pick<AhoraIdea, "status" | "promotedTo">): string | null {
  if (!ideaClosed(idea.status)) return null;
  return idea.promotedTo ? `Pasó a ${idea.promotedTo}` : "Sin destino";
}

/** Ideas on one project, from the per-project read (tasks plus its open questions). */
export function ideasFromProject(project: { slug: string; title: string }, tasks: IdeaTask[], questions: IdeaQuestion[]): AhoraIdea[] {
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
      // A closed idea keeps no mark, even if an old gate question was left unanswered.
      gateOpen: !ideaClosed(task.status) && ideaGateOpen(task.key, questions),
      createdAt: task.created_at || task.updated_at,
    });
  }
  return ideas;
}

export type IdeaColumn = { stage: IdeaStage; label: string; ideas: AhoraIdea[] };

function byAge(a: AhoraIdea, b: AhoraIdea): number {
  const rank = (idea: AhoraIdea) => (ideaClosed(idea.status) ? 1 : 0);
  return rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key, undefined, { numeric: true }) || a.slug.localeCompare(b.slug);
}

/** One column per stage, in stage order. Open ideas first, oldest first; closed ones after them. */
export function ideasByStage(ideas: AhoraIdea[]): IdeaColumn[] {
  return IDEA_STAGES.map((stage) => ({
    stage,
    label: IDEA_STAGE_LABEL[stage],
    ideas: ideas.filter((idea) => idea.stage === stage).sort(byAge),
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
