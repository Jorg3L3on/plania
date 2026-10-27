// Ahora's model, apart from the markup. Pure functions over the /api shapes (projects, inbox,
// machine), so test/ahora.test.ts can load this file with node:test. The page does not poll:
// LiveProvider already invalidates these queries.
import type { InboxGroup } from "./types.js";

/** Same window get_running uses when PLANIA_QUIET_MIN is unset (src/mcp/watch.ts). */
export const QUIET_MS = 20 * 60_000;

export const TE_TOCA_LIMIT = 3;

export type Liveness = "live" | "quiet" | "stale";

export const LIVENESS_WORD: Record<Liveness, string> = {
  live: "en vivo",
  quiet: "quieto",
  stale: "vencido",
};

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
  tasks: AhoraTask[];
  next_claimable: { key: string; title: string } | null;
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

export type CourseRow = { slug: string; title: string; line: string; liveness: Liveness | null };

function at(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? null : n;
}

function latest(a: string | null | undefined, b: string | null | undefined): number | null {
  const times = [at(a), at(b)].filter((n): n is number => n !== null);
  return times.length ? Math.max(...times) : null;
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

/** One signal per ticket that is claimed or was left In progress. Null when the ticket says nothing about liveness. */
function ticketLiveness(task: AhoraTask, gone: boolean, nowMs: number): Liveness | null {
  if (task.kind !== "ticket") return null;
  if (!leaseLive(task, nowMs)) return task.status === "In progress" ? "stale" : null;
  if (gone) return "stale";
  const last = latest(task.claimed_at, task.last_seen_at);
  if (last === null || nowMs - last > QUIET_MS) return "quiet";
  return "live";
}

const LIVENESS_RANK: Record<Liveness, number> = { live: 0, quiet: 1, stale: 2 };

/** One row per project, in the order given (list_projects is slug order). The line is the server's, untouched. */
export function enCursoOf(projects: AhoraProject[], machine: AhoraFootprint[], nowMs: number): CourseRow[] {
  return projects.map((p) => {
    const signals = p.tasks
      .map((t) => ticketLiveness(t, goneOnMachine(machine, p.slug, t.key), nowMs))
      .filter((s): s is Liveness => s !== null);
    signals.sort((a, b) => LIVENESS_RANK[a] - LIVENESS_RANK[b]);
    return { slug: p.slug, title: p.title, line: p.line, liveness: signals[0] ?? null };
  });
}

export type BlockRow = { slug: string; title: string; key: string; on: string; kind: "wait" | "lease" };

/** Waits that are not on Jorge, then a lease that ran out, a claim the machine dropped, or work with no owner. */
export function bloqueadoOf(projects: AhoraProject[], machine: AhoraFootprint[], nowMs: number): BlockRow[] {
  const rows: BlockRow[] = [];
  for (const p of projects) {
    for (const i of p.initiatives ?? []) {
      for (const w of i.waiting_on ?? []) {
        if (w.on.startsWith("Jorge")) continue;
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

/** The next claimable ticket of each project that has one, in project order. */
export function siguienteOf(projects: AhoraProject[]): NextRow[] {
  const rows: NextRow[] = [];
  for (const p of projects) {
    if (!p.next_claimable) continue;
    rows.push({ slug: p.slug, title: p.title, key: p.next_claimable.key, taskTitle: p.next_claimable.title });
  }
  return rows;
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
