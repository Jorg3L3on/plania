import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  blockers,
  branches,
  envStates,
  events,
  footprints,
  pollState,
  pullRequests,
  questions,
  tasks,
  type Project,
  type Task,
} from "../db/schema.js";
import { blockerList, hasUnsatisfiedBlocker } from "./blockers.js";
import { liveOwner, nextTask } from "./queries.js";
import type { Q } from "./tx.js";
import { QUIET_MIN } from "./watch.js";
import { areasOverlap } from "./writes.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: the reasons the screen shows, in the install's language; the Spanish is unchanged.
export const READY_WORDS = defineWords({
  es: {
    ownerAbsent: (k: string) => `${k}: el dueño ya no está en la máquina.`,
    dirty: (k: string) => `${k}: el worktree tiene cambios sin guardar.`,
    dirtyUnknown: (k: string) => `${k}: no se sabe si el worktree está limpio.`,
    resume: (k: string) => `${k}: se puede retomar.`,
    reviewing: (k: string) => `${k}: en revisión con los checks en verde.`,
    next: (k: string) => `Siguiente: ${k}.`,
    noted: (k: string) => `${k}: hay un siguiente paso.`,
    resumeAny: "Se puede retomar.",
    noContext: "No hay contexto reciente para retomar.",
    blocker: (k: string) => `${k}: tiene un blocker sin cumplir.`,
    blocked: (k: string) => `${k}: está bloqueado.`,
    ciFailed: (k: string) => `${k}: el PR falló los checks.`,
    prPending: (k: string) => `${k}: un check del PR sigue pendiente.`,
    prUnreadable: (k: string) => `${k}: no se puede leer el estado del PR.`,
    deployAndBehind: (k: string) => `${k}: el deploy falló y el entorno va detrás de la rama.`,
    deployFailed: (k: string) => `${k}: el deploy falló.`,
    envBehind: (k: string) => `${k}: el entorno va detrás de la rama de integración.`,
    envUnknown: (k: string) => `${k}: no se sabe si el entorno está al día.`,
    overlap: (a: string, b: string) => `${a} y ${b} trabajan en las mismas áreas.`,
    decision: (k: string) => `${k}: espera una decisión humana.`,
    decisionElsewhere: (k: string) => `${k}: hay una decisión pendiente en otro ticket.`,
    decisionInProject: "Hay una decisión pendiente en otro lugar del proyecto.",
    leaseExpired: (k: string) => `${k}: la reserva de trabajo ya venció.`,
    quiet: (k: string) => `${k}: el claim lleva callado.`,
    headlineStale: "La nota del proyecto está vieja.",
    noteStale: (k: string) => `${k}: la nota de estado está vieja.`,
    noNext: "Hay movimiento reciente y ningún paso claro.",
  },
  en: {
    ownerAbsent: (k: string) => `${k}: whoever holds it is no longer on the machine.`,
    dirty: (k: string) => `${k}: the worktree has unsaved changes.`,
    dirtyUnknown: (k: string) => `${k}: it is not known whether the worktree is clean.`,
    resume: (k: string) => `${k}: can be picked up again.`,
    reviewing: (k: string) => `${k}: in review with the checks green.`,
    next: (k: string) => `Next: ${k}.`,
    noted: (k: string) => `${k}: there is a next step.`,
    resumeAny: "Can be picked up again.",
    noContext: "No recent context to pick up.",
    blocker: (k: string) => `${k}: has a blocker not yet met.`,
    blocked: (k: string) => `${k}: is blocked.`,
    ciFailed: (k: string) => `${k}: the PR failed its checks.`,
    prPending: (k: string) => `${k}: a check on the PR is still pending.`,
    prUnreadable: (k: string) => `${k}: the PR's state cannot be read.`,
    deployAndBehind: (k: string) => `${k}: the deploy failed and the environment is behind the branch.`,
    deployFailed: (k: string) => `${k}: the deploy failed.`,
    envBehind: (k: string) => `${k}: the environment is behind the integration branch.`,
    envUnknown: (k: string) => `${k}: it is not known whether the environment is up to date.`,
    overlap: (a: string, b: string) => `${a} and ${b} work in the same areas.`,
    decision: (k: string) => `${k}: waits on a human decision.`,
    decisionElsewhere: (k: string) => `${k}: a decision is pending on another ticket.`,
    decisionInProject: "A decision is pending elsewhere in the project.",
    leaseExpired: (k: string) => `${k}: the work reservation has run out.`,
    quiet: (k: string) => `${k}: the claim has gone quiet.`,
    headlineStale: "The project's note is old.",
    noteStale: (k: string) => `${k}: the state note is old.`,
    noNext: "There is recent movement and no clear next step.",
  },
});

// PLA-I17-1: whether it is safe to resume a project (Retomar), from rows the digest already reads.
// Pure `readinessOf` decides; `loadReadiness` gathers one project's input. Read-only: no writes,
// no schema. Unknown or missing data is caution, never ready.

/** No claim, review, next step or event inside this many days, and the project has no context. */
export const CONTEXT_WINDOW_DAYS = 14;
const CONTEXT_WINDOW_MS = CONTEXT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * A claimed ticket's footprint older than this counts as the owner gone from the machine.
 * Three cycles of the worktree collector (every 5 minutes).
 */
export const FOOTPRINT_FRESH_MS = 15 * 60_000;

export type ReadinessState = "ready" | "caution" | "blocked" | "no_context";
export type ReasonSeverity = "blocked" | "caution" | "no_context";

export type ReasonCode =
  | "NO_CONTEXT"
  | "BLOCKER_OPEN"
  | "CI_FAILURE"
  | "DEPLOY_BLOCKED"
  | "AREAS_OVERLAP"
  | "DECISION_PENDING"
  | "LEASE_EXPIRED"
  | "OWNER_ABSENT"
  | "CLAIM_QUIET"
  | "WORKTREE_DIRTY"
  | "DIRTY_UNKNOWN"
  | "ENV_UNKNOWN"
  | "NOTE_STALE"
  | "PR_PENDING"
  | "PR_UNREADABLE"
  | "DECISION_ELSEWHERE"
  | "NO_NEXT";

export type ReadinessReason = {
  code: ReasonCode;
  severity: ReasonSeverity;
  text: string;
  task_key: string | null;
};

export type Readiness = {
  state: ReadinessState;
  reasons: ReadinessReason[];
  line: string;
};

export type FootprintFact = {
  state: string;
  kind: string;
  /** null when git could not tell, or the row has no dirty flag. */
  dirty: boolean | null;
  lastSeenAt: Date | null;
};

export type ReadinessTicket = {
  key: string;
  status: string;
  /** Set while someone still holds the row, whether or not the lease has expired. */
  leaseUntil: Date | null;
  /** Newest of last_seen_at, claimed_at and an event by the holding session. */
  lastActivityAt: Date | null;
  areas: string[];
  /** null when the ticket has no pull request. `unknown` when the PR cannot be read. */
  pr: { ci: "success" | "failure" | "pending" | "none" | "unknown" } | null;
  /** A non-human blocker does not hold yet (another ticket, env, flag, time, metric). */
  unsatisfiedBlocker: boolean;
  /** null when the ticket is not claimed. An empty list is a claim with no footprint row. */
  footprint: FootprintFact[] | null;
};

export type ReadinessInput = {
  now?: Date;
  lastEventAt: Date | null;
  headlineStale: boolean;
  nextClaimableKey: string | null;
  /** The Vercel poller stored an error for this project. */
  deployFailed: boolean;
  /** Some environment is behind an open initiative's integration branch (status drift). */
  envBehind: boolean;
  /**
   * An open initiative's integration branch has no head, or an environment has no commit,
   * so drift cannot be judged. Never treat that as up to date.
   */
  envUnknown: boolean;
  initiatives: { key: string; nextAction: string; stateNoteStale: boolean }[];
  tickets: ReadinessTicket[];
  /** Open question or unsatisfied human_action, one entry per task. */
  decisions: { task_key: string | null }[];
};

const CLOSED = ["Done", "Won't do"];

function asDate(at: Date | string | null | undefined): Date | null {
  if (!at) return null;
  return at instanceof Date ? at : new Date(at);
}
const CODE_ORDER: ReasonCode[] = [
  "NO_CONTEXT",
  "BLOCKER_OPEN",
  "CI_FAILURE",
  "DEPLOY_BLOCKED",
  "AREAS_OVERLAP",
  "DECISION_PENDING",
  "LEASE_EXPIRED",
  "OWNER_ABSENT",
  "CLAIM_QUIET",
  "WORKTREE_DIRTY",
  "DIRTY_UNKNOWN",
  "ENV_UNKNOWN",
  "NOTE_STALE",
  "PR_PENDING",
  "PR_UNREADABLE",
  "DECISION_ELSEWHERE",
  "NO_NEXT",
];
const SEVERITY_RANK: Record<ReasonSeverity, number> = { blocked: 0, caution: 1, no_context: 2 };

const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key, "en");

function reason(code: ReasonCode, severity: ReasonSeverity, task_key: string | null, text: string): ReadinessReason {
  return { code, severity, text, task_key };
}

function present(row: FootprintFact): boolean {
  return row.state === "live" || row.state === "self";
}

function fresh(row: FootprintFact, now: Date): boolean {
  if (!row.lastSeenAt) return false;
  return now.getTime() - row.lastSeenAt.getTime() <= FOOTPRINT_FRESH_MS;
}

function quiet(t: ReadinessTicket, now: Date): boolean {
  if (!t.lastActivityAt) return true;
  return now.getTime() - t.lastActivityAt.getTime() > QUIET_MIN * 60_000;
}

/** Footprint of a claim: missing, old or gone is the owner absent; dirty is read only on a fresh worktree. */
function footprintReasons(t: ReadinessTicket, now: Date): ReadinessReason[] {
  const w = say(READY_WORDS);
  const gone = reason("OWNER_ABSENT", "caution", t.key, w.ownerAbsent(t.key));
  const rows = t.footprint ?? [];
  const here = rows.filter((row) => present(row) && fresh(row, now));
  if (!here.length) return [gone];
  const trees = here.filter((row) => row.kind === "worktree");
  if (trees.some((row) => row.dirty === true)) {
    return [reason("WORKTREE_DIRTY", "caution", t.key, w.dirty(t.key))];
  }
  if (!trees.length || trees.some((row) => row.dirty !== false)) {
    return [reason("DIRTY_UNKNOWN", "caution", t.key, w.dirtyUnknown(t.key))];
  }
  return [];
}

function sortReasons(list: ReadinessReason[]): ReadinessReason[] {
  return [...list].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code) ||
      (a.task_key ?? "").localeCompare(b.task_key ?? "", "en"),
  );
}

function readyLine(live: ReadinessTicket[], review: ReadinessTicket[], input: ReadinessInput): string {
  const w = say(READY_WORDS);
  const claim = [...live].sort(byKey)[0];
  if (claim) return w.resume(claim.key);
  const reviewing = [...review].sort(byKey)[0];
  if (reviewing) return w.reviewing(reviewing.key);
  if (input.nextClaimableKey) return w.next(input.nextClaimableKey);
  const noted = input.initiatives.find((i) => i.nextAction.trim());
  if (noted) return w.noted(noted.key);
  return w.resumeAny;
}

/**
 * Precedence: no_context, then blocked, then caution, otherwise ready.
 * A live claim without a footprint, dirty === null, an unreadable PR, or an unknown environment
 * (missing commit or integration head) is caution, never ready.
 */
export function readinessOf(input: ReadinessInput): Readiness {
  const w = say(READY_WORDS);
  const now = input.now ?? new Date();
  const tickets = input.tickets.filter((t) => !CLOSED.includes(t.status));
  const live = tickets.filter((t) => t.leaseUntil !== null && t.leaseUntil > now);
  const expired = tickets.filter((t) => t.leaseUntil !== null && t.leaseUntil <= now);
  const review = tickets.filter((t) => t.status === "In review");
  const nextAction = input.initiatives.some((i) => i.nextAction.trim());
  const recent = !!input.lastEventAt && now.getTime() - input.lastEventAt.getTime() < CONTEXT_WINDOW_MS;
  const hasTarget = live.length > 0 || expired.length > 0 || review.length > 0 || nextAction || !!input.nextClaimableKey;

  if (!hasTarget && !recent) {
    const only = reason("NO_CONTEXT", "no_context", null, w.noContext);
    return { state: "no_context", reasons: [only], line: only.text };
  }

  const focus = live.length ? live : expired.length ? expired : review.length ? review : input.nextClaimableKey ? tickets.filter((t) => t.key === input.nextClaimableKey) : [];
  const focusKeys = new Set(focus.map((t) => t.key));
  const blocked: ReadinessReason[] = [];
  const caution: ReadinessReason[] = [];

  for (const t of [...focus].sort(byKey)) {
    if (t.status === "Blocked" || t.unsatisfiedBlocker) {
      const text = t.unsatisfiedBlocker ? w.blocker(t.key) : w.blocked(t.key);
      blocked.push(reason("BLOCKER_OPEN", "blocked", t.key, text));
    }
  }

  const prTargets = [...new Map([...focus, ...review].map((t) => [t.key, t])).values()].sort(byKey);
  for (const t of prTargets) {
    if (t.pr?.ci === "failure") blocked.push(reason("CI_FAILURE", "blocked", t.key, w.ciFailed(t.key)));
    else if (t.pr?.ci === "pending") caution.push(reason("PR_PENDING", "caution", t.key, w.prPending(t.key)));
    else if (t.pr?.ci === "unknown" || (t.status === "In review" && !t.pr)) {
      caution.push(reason("PR_UNREADABLE", "caution", t.key, w.prUnreadable(t.key)));
    }
  }

  if (review.length && (input.deployFailed || input.envBehind)) {
    const text = (key: string) =>
      input.deployFailed && input.envBehind
        ? w.deployAndBehind(key)
        : input.deployFailed
          ? w.deployFailed(key)
          : w.envBehind(key);
    for (const t of [...review].sort(byKey)) blocked.push(reason("DEPLOY_BLOCKED", "blocked", t.key, text(t.key)));
  }

  if (review.length && input.envUnknown) {
    for (const t of [...review].sort(byKey)) {
      caution.push(reason("ENV_UNKNOWN", "caution", t.key, w.envUnknown(t.key)));
    }
  }

  const claimed = [...live].sort(byKey);
  let overlapped = false;
  for (let i = 0; i < claimed.length && !overlapped; i++) {
    for (let j = i + 1; j < claimed.length; j++) {
      const a = claimed[i]!;
      const b = claimed[j]!;
      const hit = a.areas.some((area) => b.areas.some((other) => areasOverlap(area, other)));
      if (!hit) continue;
      blocked.push(reason("AREAS_OVERLAP", "blocked", a.key, w.overlap(a.key, b.key)));
      overlapped = true;
      break;
    }
  }

  const seenDecisions = new Set<string>();
  for (const d of input.decisions) {
    const id = d.task_key ?? "";
    if (seenDecisions.has(id)) continue;
    seenDecisions.add(id);
    if (d.task_key && focusKeys.has(d.task_key)) {
      blocked.push(reason("DECISION_PENDING", "blocked", d.task_key, w.decision(d.task_key)));
    } else if (d.task_key) {
      caution.push(reason("DECISION_ELSEWHERE", "caution", d.task_key, w.decisionElsewhere(d.task_key)));
    } else {
      caution.push(reason("DECISION_ELSEWHERE", "caution", null, w.decisionInProject));
    }
  }

  for (const t of [...expired].sort(byKey)) {
    caution.push(reason("LEASE_EXPIRED", "caution", t.key, w.leaseExpired(t.key)));
  }
  for (const t of [...live, ...expired].sort(byKey)) caution.push(...footprintReasons(t, now));
  for (const t of [...live].sort(byKey)) {
    if (quiet(t, now)) caution.push(reason("CLAIM_QUIET", "caution", t.key, w.quiet(t.key)));
  }

  if (input.headlineStale) caution.push(reason("NOTE_STALE", "caution", null, w.headlineStale));
  for (const i of input.initiatives.filter((row) => row.stateNoteStale).sort(byKey)) {
    caution.push(reason("NOTE_STALE", "caution", i.key, w.noteStale(i.key)));
  }

  if (!hasTarget && recent) {
    caution.push(reason("NO_NEXT", "caution", null, w.noNext));
  }

  const reasons = sortReasons([...blocked, ...caution]);
  if (blocked.length) return { state: "blocked", reasons, line: sortReasons(blocked)[0]!.text };
  if (caution.length) return { state: "caution", reasons, line: sortReasons(caution)[0]!.text };
  return { state: "ready", reasons: [], line: readyLine(live, review, input) };
}

function ciOf(state: string | null | undefined): "success" | "failure" | "pending" | "none" | "unknown" {
  if (state === "success" || state === "failure" || state === "pending" || state === "none") return state;
  return "unknown";
}

function dirtyOf(details: Record<string, unknown>): boolean | null {
  return typeof details.dirty === "boolean" ? details.dirty : null;
}

export type EnvDrift = { behind: boolean; unknown: boolean };

/**
 * Drift of open integration branches against environments.
 * A known mismatch is behind. A missing head or a missing commit is unknown, never current.
 * No environment rows and a known head is not unknown: there is nothing to compare.
 */
export function envDriftOf(
  envs: { commit: string | null }[],
  initiatives: { branch: string | null }[],
  heads: { name: string; headSha: string | null }[],
): EnvDrift {
  const open = initiatives.filter((i): i is { branch: string } => !!i.branch);
  if (!open.length) return { behind: false, unknown: false };
  let behind = false;
  let unknown = false;
  for (const initiative of open) {
    const head = heads.find((b) => b.name === initiative.branch)?.headSha ?? null;
    if (!head) {
      unknown = true;
      continue;
    }
    for (const env of envs) {
      if (!env.commit) {
        unknown = true;
        continue;
      }
      if (!head.startsWith(env.commit) && !env.commit.startsWith(head)) behind = true;
    }
  }
  return { behind, unknown };
}

/**
 * PLA-115: drift only means something where Plania follows what an environment runs. A project that
 * releases by branch (settings.release_on "branch": merged into the release branch is Released, no
 * deploy feed) keeps its env row for migrations, but a stale commit there blocks nothing.
 */
export function envDriftFor(
  settings: { release_on?: string },
  envs: { commit: string | null }[],
  initiatives: { branch: string | null }[],
  heads: { name: string; headSha: string | null }[],
): EnvDrift {
  if (settings.release_on === "branch") return { behind: false, unknown: false };
  return envDriftOf(envs, initiatives, heads);
}

async function projectEnvDrift(db: Q, p: Project, all: Task[]): Promise<EnvDrift> {
  const open = all.filter((t) => t.kind === "initiative" && !CLOSED.includes(t.status));
  const [envs, heads] = await Promise.all([
    db.select().from(envStates).where(eq(envStates.projectId, p.id)),
    db.select().from(branches).where(and(eq(branches.projectId, p.id), isNull(branches.deletedAt))),
  ]);
  return envDriftFor(
    p.settings,
    envs.map((env) => ({ commit: env.commit })),
    open.map((initiative) => ({ branch: initiative.branch })),
    heads.map((branch) => ({ name: branch.name, headSha: branch.headSha })),
  );
}

export type ReadinessCache = {
  tasks?: Task[];
  lastEventAt?: Date | null;
  nextClaimableKey?: string | null;
  envBehind?: boolean;
  /** Set with envBehind. A cache that only knows "not behind" is not enough: unknown is recomputed. */
  envUnknown?: boolean;
};

// One project. Reuses the digest's rows: tasks and leases, pull requests, blockers, questions,
// footprints, env drift, areas, notes and the latest event. A few queries, no per-ticket loop
// except blockerList on tickets that already have an unsatisfied blocker.
export async function loadReadiness(db: Q, p: Project, cache: ReadinessCache = {}): Promise<Readiness> {
  const now = new Date();
  const all = cache.tasks ?? (await db.select().from(tasks).where(eq(tasks.projectId, p.id)).orderBy(tasks.key));
  const byId = new Map(all.map((t) => [t.id, t]));
  // liveOwner is the unexpired half. An expired owner stays on the row until the reaper, and still counts.
  const owned = all.filter((t) => t.kind === "ticket" && t.leaseUntil && (liveOwner(t, now) !== null || t.owner !== null));
  const ownedIds = owned.map((t) => t.id);

  const [prs, openQ, humanRows, polls, footRows, activity, heldRows, lastEvent, nextKey, behind] = await Promise.all([
    db.select().from(pullRequests).where(eq(pullRequests.projectId, p.id)),
    db.select({ taskId: questions.taskId }).from(questions).where(and(eq(questions.projectId, p.id), isNull(questions.answeredAt))),
    db
      .select({ taskId: blockers.taskId })
      .from(blockers)
      .innerJoin(tasks, eq(tasks.id, blockers.taskId))
      .where(and(eq(tasks.projectId, p.id), eq(blockers.type, "human_action"), isNull(blockers.satisfiedAt))),
    db.select({ source: pollState.source, error: pollState.error }).from(pollState).where(eq(pollState.projectId, p.id)),
    ownedIds.length
      ? db.select().from(footprints).where(and(inArray(footprints.taskId, ownedIds), isNull(footprints.releasedAt)))
      : Promise.resolve([]),
    lastSessionActivity(db, owned.map((t) => ({ id: t.id, sessionId: t.owner!.session_id }))),
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "ticket"), sql`${hasUnsatisfiedBlocker(tasks.id)}`)),
    "lastEventAt" in cache
      ? Promise.resolve(cache.lastEventAt ?? null)
      : db
          .select({ at: sql<Date | null>`max(${events.createdAt})` })
          .from(events)
          .where(eq(events.projectId, p.id))
          .then((rows) => {
            const at = rows[0]?.at;
            return at ? (at instanceof Date ? at : new Date(at)) : null;
          }),
    "nextClaimableKey" in cache ? Promise.resolve(cache.nextClaimableKey ?? null) : nextTask(db, p.id).then((r) => r.task?.key ?? null),
    cache.envBehind !== undefined && cache.envUnknown !== undefined
      ? Promise.resolve({ behind: cache.envBehind, unknown: cache.envUnknown })
      : projectEnvDrift(db, p, all),
  ]);

  const flags = new Map<string, { other: boolean }>();
  await Promise.all(
    heldRows.map(async (row) => {
      const list = await blockerList(db, { id: row.id, projectId: p.id });
      const open = list.filter((b) => !b.satisfied && !(b.type === "human_action" && b.gating === false));
      flags.set(row.id, { other: open.some((b) => b.type !== "human_action") });
    }),
  );

  const prFor = (t: Task): ReadinessTicket["pr"] => {
    const rows = prs.filter((pr) => pr.taskId === t.id || (t.prUrl !== null && pr.url === t.prUrl));
    const pr = rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    if (pr) return { ci: ciOf(pr.ciState) };
    if (t.prUrl) return { ci: "unknown" };
    return null;
  };

  const decisionKeys = new Set<string>();
  const decisions: { task_key: string | null }[] = [];
  const addDecision = (taskId: string | null) => {
    if (!taskId) {
      decisions.push({ task_key: null });
      return;
    }
    const key = byId.get(taskId)?.key;
    if (!key || decisionKeys.has(key)) return;
    decisionKeys.add(key);
    decisions.push({ task_key: key });
  };
  for (const row of openQ) addDecision(row.taskId);
  for (const row of humanRows) addDecision(row.taskId);

  const initiatives = all
    .filter((t) => t.kind === "initiative" && !CLOSED.includes(t.status))
    .map((i) => ({
      key: i.key,
      nextAction: i.nextAction,
      stateNoteStale: stateNoteIsStale(i, all),
    }));

  const ticketInputs: ReadinessTicket[] = all
    .filter((t) => t.kind === "ticket")
    .map((t) => {
      const holding = t.owner !== null && t.leaseUntil !== null;
      const candidates = [t.lastSeenAt, t.claimedAt, activity.get(t.id) ?? null].filter((d): d is Date => d instanceof Date);
      return {
        key: t.key,
        status: t.status,
        leaseUntil: holding ? asDate(t.leaseUntil) : null,
        lastActivityAt: candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null,
        areas: t.areas,
        pr: prFor(t),
        unsatisfiedBlocker: flags.get(t.id)?.other ?? false,
        footprint: holding
          ? footRows
              .filter((f) => f.taskId === t.id)
              .map((f) => ({
                state: f.state,
                kind: f.kind,
                dirty: dirtyOf(f.details),
                lastSeenAt: asDate(f.lastSeenAt),
              }))
          : null,
      };
    });

  return readinessOf({
    now,
    lastEventAt: asDate(lastEvent),
    headlineStale: p.headlineNoteStale,
    nextClaimableKey: nextKey,
    // PLA-I74-8: a failed production build (the deploy row src/jobs/deploy-truth.ts keeps) counts too.
    deployFailed: polls.some((row) => (row.source === "vercel" || row.source === "deploy") && !!row.error),
    envBehind: behind.behind,
    envUnknown: behind.unknown,
    initiatives,
    tickets: ticketInputs,
    decisions,
  });
}

function stateNoteIsStale(i: Task, all: Task[]): boolean {
  if (!i.stateNote || !i.stateNoteAt) return false;
  const times = [i, ...all.filter((t) => t.parentId === i.id)].map((t) => t.statusChangedAt).filter((d): d is Date => d instanceof Date);
  if (!times.length) return false;
  const last = new Date(Math.max(...times.map((d) => d.getTime())));
  return last > i.stateNoteAt;
}

async function lastSessionActivity(db: Q, rows: { id: string; sessionId: string }[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (!rows.length) return out;
  const found = await db
    .select({
      taskId: events.taskId,
      session: sql<string>`${events.actor}->>'session_id'`,
      at: sql<Date>`max(${events.createdAt})`,
    })
    .from(events)
    .where(
      and(
        inArray(events.taskId, rows.map((r) => r.id)),
        sql`${events.actor}->>'session_id' in (${sql.join(rows.map((r) => sql`${r.sessionId}`), sql`, `)})`,
      ),
    )
    .groupBy(events.taskId, sql`${events.actor}->>'session_id'`);
  for (const f of found) {
    const row = rows.find((r) => r.id === f.taskId && r.sessionId === f.session);
    if (!row || !f.taskId) continue;
    out.set(f.taskId, f.at instanceof Date ? f.at : new Date(f.at));
  }
  return out;
}
