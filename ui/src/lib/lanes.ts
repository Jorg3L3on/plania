// Turns a project's flat task list into lanes: one per open initiative, plus "Sueltos" for
// tickets without one. Several lanes move at once; an initiative is a lane, never a step.
// No imports on purpose, so test/lanes.test.ts can load this file with node:test.

export type LaneTask = {
  key: string;
  kind: "initiative" | "ticket" | "idea";
  title: string;
  summary: string;
  status: string;
  priority: string | null;
  parent_key: string | null;
  blocked_note: string | null;
  pr_url: string | null;
  updated_at: string;
  branch?: string | null;
  base_branch?: string | null;
  /** Live lease holder, if any (v2). */
  claimed_by?: { agent: string } | null;
  /** Keys of tasks it still waits on. */
  waits_on?: string[];
  /** Held by a blocker other than a task. */
  held?: boolean;
  /** 2.10: the due day, YYYY-MM-DD. */
  due_on?: string | null;
};

/**
 * moving: someone is working. jorge: the lane waits on an answer from Jorge (Needs Jorge).
 * blocked: only blocked work. waiting: nobody on it. paused: initiative On hold.
 */
export type LaneState = "moving" | "jorge" | "blocked" | "waiting" | "paused";

export type StationTone = "done" | "now" | "review" | "jorge" | "blocked" | "ready" | "pending";

export type Station = { task: LaneTask; tone: StationTone; here: boolean };

export type Lane = {
  id: string;
  initiative: LaneTask | null;
  state: LaneState;
  /** Done tickets, most recent first. */
  done: LaneTask[];
  /** Finished, waiting on review or release: In review, Merged, Released. */
  review: LaneTask[];
  /** In progress, Needs Jorge, and Blocked by something other than tickets. */
  now: LaneTask[];
  /** Ready by priority, then tickets queued behind other tickets; if none, the single best Backlog ticket. */
  next: LaneTask[];
  /** The rest of the Backlog. */
  later: LaneTask[];
  /** The initiative's line, in work order: done, now, next, later. */
  stations: Station[];
  closed: number;
  total: number;
  lastMovedAt: string;
};

export const LOOSE_LANE_ID = "__loose";

const CLOSED = new Set(["Done", "Won't do"]);
const REVIEW = new Set(["In review", "Merged", "Released"]);
const ACTIVE_WORK = new Set(["In progress", ...REVIEW]);
const NOW_ORDER: Record<string, number> = { "In progress": 0, "Needs Jorge": 1, Blocked: 2 };
const REVIEW_ORDER: Record<string, number> = { "In review": 0, Merged: 1, Released: 2 };
const INITIATIVE_ORDER: Record<string, number> = { Active: 0, Shipping: 0, Planning: 1, "On hold": 2 };
const STATE_ORDER: Record<LaneState, number> = { moving: 0, jorge: 1, blocked: 2, waiting: 3, paused: 4 };

const priorityRank = (p: string | null) => (p && /^P[0-3]$/.test(p) ? Number(p[1]) : 4);
const byKey = (a: LaneTask, b: LaneTask) => a.key.localeCompare(b.key, undefined, { numeric: true });
const byPriorityThenKey = (a: LaneTask, b: LaneTask) => priorityRank(a.priority) - priorityRank(b.priority) || byKey(a, b);
const newestFirst = (a: LaneTask, b: LaneTask) => b.updated_at.localeCompare(a.updated_at);
const latest = (ts: LaneTask[]) => ts.reduce((m, t) => (t.updated_at > m ? t.updated_at : m), "");

/**
 * Blocked only by unfinished tickets (this lane's or another's): it waits its turn, it is not stuck.
 * A typed blocker (env, flag, metric, time, human action) or only a note keeps it in En curso as blocked.
 */
export function isQueued(t: LaneTask): boolean {
  return t.status === "Blocked" && !t.held && (t.waits_on ?? []).length > 0;
}

function stationTone(t: LaneTask, queued: boolean): StationTone {
  if (queued) return "pending";
  if (t.status === "Done") return "done";
  if (t.status === "In progress") return "now";
  if (t.status === "In review" || t.status === "Merged" || t.status === "Released") return "review";
  if (t.status === "Needs Jorge") return "jorge";
  if (t.status === "Blocked") return "blocked";
  if (t.status === "Ready") return "ready";
  return "pending";
}

function buildLane(id: string, initiative: LaneTask | null, tickets: LaneTask[]): Lane {
  const live = tickets.filter((t) => t.status !== "Won't do");
  const queued = new Set(live.filter(isQueued));
  const done = live.filter((t) => t.status === "Done").sort(newestFirst);
  const review = live
    .filter((t) => REVIEW.has(t.status))
    .sort((a, b) => REVIEW_ORDER[a.status]! - REVIEW_ORDER[b.status]! || byKey(a, b));
  const now = live
    .filter((t) => t.status in NOW_ORDER && !queued.has(t))
    .sort((a, b) => NOW_ORDER[a.status]! - NOW_ORDER[b.status]! || byPriorityThenKey(a, b));
  const ready = live.filter((t) => t.status === "Ready").sort(byPriorityThenKey);
  // Queued tickets follow work order (key), so F4 shows before F5.
  const lined = [...ready, ...[...queued].sort(byKey)];
  const backlog = live.filter((t) => t.status === "Backlog").sort(byPriorityThenKey);
  const next = lined.length > 0 ? lined : backlog.slice(0, 1);
  const later = lined.length > 0 ? backlog : backlog.slice(1);

  let state: LaneState;
  if (initiative?.status === "On hold") state = "paused";
  else if (review.length > 0 || now.some((t) => ACTIVE_WORK.has(t.status))) state = "moving";
  else if (now.some(waitsOnJorge)) state = "jorge";
  else if (now.length > 0) state = "blocked";
  else state = "waiting";

  const here = now.find((t) => t.status === "In progress") ?? review[0] ?? now[0];
  const stations: Station[] = [...[...done].reverse(), ...review, ...now, ...next, ...later].map((task) => ({
    task,
    tone: stationTone(task, queued.has(task)),
    here: task === here,
  }));

  return {
    id,
    initiative,
    state,
    done,
    review,
    now,
    next,
    later,
    stations,
    closed: done.length,
    total: live.length,
    lastMovedAt: latest(initiative ? [initiative, ...live] : live),
  };
}

/**
 * Lanes in display order: Active and Shipping initiatives, then Planning, then On hold. Within each,
 * lanes with work in motion come first, then by best open priority, then by key so rows stay put. Sueltos last.
 */
export function buildLanes(tasks: LaneTask[]): Lane[] {
  const initiatives = tasks.filter((t) => t.kind === "initiative" && !CLOSED.has(t.status));
  const shown = new Set(initiatives.map((i) => i.key));
  const tickets = tasks.filter((t) => t.kind === "ticket");

  const lanes = initiatives.map((i) => buildLane(i.key, i, tickets.filter((t) => t.parent_key === i.key)));
  const bestPriority = (l: Lane) => Math.min(4, ...[...l.review, ...l.now, ...l.next, ...l.later].map((t) => priorityRank(t.priority)));
  lanes.sort(
    (a, b) =>
      (INITIATIVE_ORDER[a.initiative!.status] ?? 1) - (INITIATIVE_ORDER[b.initiative!.status] ?? 1) ||
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      bestPriority(a) - bestPriority(b) ||
      // Stable last: recency would swap rows on every agent write.
      byKey(a.initiative!, b.initiative!),
  );

  const loose = buildLane(
    LOOSE_LANE_ID,
    null,
    tickets.filter((t) => !t.parent_key || !shown.has(t.parent_key)),
  );
  if (loose.review.length + loose.now.length + loose.next.length + loose.later.length > 0) lanes.push(loose);
  return lanes;
}

/** Closed and total tickets across the project; Won't do counts as neither. */
export function projectProgress(tasks: LaneTask[]) {
  const tickets = tasks.filter((t) => t.kind === "ticket" && t.status !== "Won't do");
  return { closed: tickets.filter((t) => t.status === "Done").length, total: tickets.length };
}

/** Tickets per status bucket, for the legend next to the progress ring. */
export function statusCounts(tasks: LaneTask[]) {
  const tickets = tasks.filter((t) => t.kind === "ticket");
  const count = (s: string) => tickets.filter((t) => t.status === s).length;
  return {
    inProgress: count("In progress"),
    inReview: count("In review") + count("Merged") + count("Released"),
    ready: count("Ready"),
    needsJorge: count("Needs Jorge"),
    blocked: count("Blocked"),
  };
}

// "Te toca a ti": tickets an agent moved to Needs Jorge with a question (the ask tool).
export type YourTurnItem = { task: LaneTask; ask: string };

export const waitsOnJorge = (t: LaneTask) => t.kind === "ticket" && t.status === "Needs Jorge";

export function yourTurn(tasks: LaneTask[]): YourTurnItem[] {
  return tasks.filter(waitsOnJorge).sort(byPriorityThenKey).map((task) => ({ task, ask: task.title }));
}

export const LANE_COLUMNS = ["done", "review", "now", "next", "later"] as const;
export type LaneColumn = (typeof LANE_COLUMNS)[number];

/** Columns with nothing in any lane: the grid narrows them to a strip so busy columns get the room. */
export function emptyColumns(lanes: Lane[]): Set<LaneColumn> {
  return new Set(LANE_COLUMNS.filter((c) => lanes.every((l) => l[c].length === 0)));
}

/** Short name for a ticket: the "F2" a phase title starts with, else its key. */
export function shortName(t: Pick<LaneTask, "key" | "title">): string {
  return t.title.match(/^(F\d+)\s*·/)?.[1] ?? t.key;
}

/** "F1 · F3" for the tickets a queued one waits on; another lane's ticket shows its key. */
export function waitsLabel(t: LaneTask, lane: Lane): string {
  const all = [...lane.done, ...lane.review, ...lane.now, ...lane.next, ...lane.later];
  return (t.waits_on ?? []).map((k) => shortName(all.find((x) => x.key === k) ?? { key: k, title: "" })).join(" · ");
}

export type BranchEdge = { branch: string; base: string; lanes: string[] };

/** Branch → base edges from initiatives (and their tickets' branches), for the "Rama y prod" graph. */
export function branchEdges(tasks: LaneTask[]): BranchEdge[] {
  const initiatives = tasks.filter((t) => t.kind === "initiative" && !CLOSED.has(t.status));
  const edges = new Map<string, BranchEdge>();
  for (const i of initiatives) {
    const base = i.base_branch?.trim();
    if (!base) continue;
    const branches = new Set<string>();
    if (i.branch?.trim()) branches.add(i.branch.trim());
    for (const t of tasks) {
      if (t.parent_key === i.key && t.branch?.trim() && !CLOSED.has(t.status)) branches.add(t.branch.trim());
    }
    for (const branch of branches) {
      if (branch === base) continue;
      const id = `${base}→${branch}`;
      const edge = edges.get(id) ?? { branch, base, lanes: [] };
      if (!edge.lanes.includes(i.title)) edge.lanes.push(i.title);
      edges.set(id, edge);
    }
  }
  return [...edges.values()].sort((a, b) => a.base.localeCompare(b.base) || a.branch.localeCompare(b.branch));
}

/** First sentence or line of a resume field, for places with room for one line. */
export function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  const sentence = line.match(/^.+?[.;](?=\s|$)/)?.[0] ?? line;
  return sentence.replace(/[.;]$/, "").trim();
}

/** Splits a resume field into short statements: one per line, or per sentence when it is one paragraph. */
export function statements(text: string): string[] {
  const lines = text.split("\n").map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return (lines[0] ?? "")
    .split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ«"0-9])/)
    .map((s) => s.replace(/[.;]$/, "").trim())
    .filter(Boolean);
}
