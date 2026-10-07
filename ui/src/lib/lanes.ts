// Turns a project's flat task list into lanes: one per open initiative, plus "Sueltos" for
// tickets without one. Several lanes move at once; an initiative is a lane, never a step.
// No imports on purpose, so test/lanes.test.ts can load this file with node:test.

export type LaneTask = {
  key: string;
  kind: "initiative" | "ticket";
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
};

/** moving: someone is working. blocked: only blocked work. waiting: nobody on it. paused: initiative On hold. */
export type LaneState = "moving" | "blocked" | "waiting" | "paused";

export type StationTone = "done" | "now" | "review" | "blocked" | "ready" | "pending";

export type Station = { task: LaneTask; tone: StationTone; here: boolean };

export type Lane = {
  id: string;
  initiative: LaneTask | null;
  state: LaneState;
  /** Done tickets, most recent first. */
  done: LaneTask[];
  /** In progress, In review, Blocked. */
  now: LaneTask[];
  /** Ready by priority; if none, the single best Backlog ticket. */
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
const ACTIVE_WORK = new Set(["In progress", "In review"]);
const NOW_ORDER: Record<string, number> = { "In progress": 0, "In review": 1, Blocked: 2 };
const INITIATIVE_ORDER: Record<string, number> = { Active: 0, Shipping: 0, Planning: 1, "On hold": 2 };
const STATE_ORDER: Record<LaneState, number> = { moving: 0, blocked: 1, waiting: 2, paused: 3 };

const priorityRank = (p: string | null) => (p && /^P[0-3]$/.test(p) ? Number(p[1]) : 4);
const byKey = (a: LaneTask, b: LaneTask) => a.key.localeCompare(b.key, undefined, { numeric: true });
const byPriorityThenKey = (a: LaneTask, b: LaneTask) => priorityRank(a.priority) - priorityRank(b.priority) || byKey(a, b);
const newestFirst = (a: LaneTask, b: LaneTask) => b.updated_at.localeCompare(a.updated_at);
const latest = (ts: LaneTask[]) => ts.reduce((m, t) => (t.updated_at > m ? t.updated_at : m), "");

function stationTone(t: LaneTask): StationTone {
  if (t.status === "Done") return "done";
  if (t.status === "In progress") return "now";
  if (t.status === "In review") return "review";
  if (t.status === "Blocked") return "blocked";
  if (t.status === "Ready") return "ready";
  return "pending";
}

function buildLane(id: string, initiative: LaneTask | null, tickets: LaneTask[]): Lane {
  const live = tickets.filter((t) => t.status !== "Won't do");
  const done = live.filter((t) => t.status === "Done").sort(newestFirst);
  const now = live
    .filter((t) => t.status in NOW_ORDER)
    .sort((a, b) => NOW_ORDER[a.status]! - NOW_ORDER[b.status]! || byPriorityThenKey(a, b));
  const ready = live.filter((t) => t.status === "Ready").sort(byPriorityThenKey);
  const backlog = live.filter((t) => t.status === "Backlog").sort(byPriorityThenKey);
  const next = ready.length > 0 ? ready : backlog.slice(0, 1);
  const later = ready.length > 0 ? backlog : backlog.slice(1);

  let state: LaneState;
  if (initiative?.status === "On hold") state = "paused";
  else if (now.some((t) => ACTIVE_WORK.has(t.status))) state = "moving";
  else if (now.length > 0) state = "blocked";
  else state = "waiting";

  const firstNow = now.find((t) => ACTIVE_WORK.has(t.status)) ?? now[0];
  const stations: Station[] = [...[...done].reverse(), ...now, ...next, ...later].map((task) => ({
    task,
    tone: stationTone(task),
    here: task === firstNow,
  }));

  return {
    id,
    initiative,
    state,
    done,
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
 * lanes with work in motion come first, then by best open priority, then most recently moved. Sueltos last.
 */
export function buildLanes(tasks: LaneTask[]): Lane[] {
  const initiatives = tasks.filter((t) => t.kind === "initiative" && !CLOSED.has(t.status));
  const shown = new Set(initiatives.map((i) => i.key));
  const tickets = tasks.filter((t) => t.kind === "ticket");

  const lanes = initiatives.map((i) => buildLane(i.key, i, tickets.filter((t) => t.parent_key === i.key)));
  const bestPriority = (l: Lane) => Math.min(4, ...[...l.now, ...l.next, ...l.later].map((t) => priorityRank(t.priority)));
  lanes.sort(
    (a, b) =>
      (INITIATIVE_ORDER[a.initiative!.status] ?? 1) - (INITIATIVE_ORDER[b.initiative!.status] ?? 1) ||
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      bestPriority(a) - bestPriority(b) ||
      b.lastMovedAt.localeCompare(a.lastMovedAt),
  );

  const loose = buildLane(
    LOOSE_LANE_ID,
    null,
    tickets.filter((t) => !t.parent_key || !shown.has(t.parent_key)),
  );
  if (loose.now.length + loose.next.length + loose.later.length > 0) lanes.push(loose);
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
    inReview: count("In review"),
    ready: count("Ready"),
    blocked: count("Blocked"),
  };
}

// "Te toca a ti": agents mark work that waits on Jorge as Blocked with a note starting "Jorge:".
const YOUR_TURN = /^\s*jorge\s*[:,-]\s*/i;

export type YourTurnItem = { task: LaneTask; ask: string };

export const waitsOnJorge = (t: LaneTask) => t.kind === "ticket" && t.status === "Blocked" && YOUR_TURN.test(t.blocked_note ?? "");

export function yourTurn(tasks: LaneTask[]): YourTurnItem[] {
  return tasks
    .filter(waitsOnJorge)
    .sort(byPriorityThenKey)
    .map((task) => ({ task, ask: (task.blocked_note ?? "").replace(YOUR_TURN, "").trim() || task.title }));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const FOLD_AFTER = 4;

/**
 * The index shows at most FOLD_AFTER lanes in full once a project has more: moving lanes and lanes
 * touched in the last week stay; the rest fold behind "ver todas". Sueltos never counts toward the limit.
 */
export function foldLanes(lanes: Lane[], nowMs: number) {
  const initiativeLanes = lanes.filter((l) => l.initiative);
  if (initiativeLanes.length <= FOLD_AFTER) return { visible: lanes, folded: [] as Lane[] };
  const fresh = (l: Lane) => !l.initiative || l.state === "moving" || nowMs - Date.parse(l.lastMovedAt) < WEEK_MS;
  return { visible: lanes.filter(fresh), folded: lanes.filter((l) => !fresh(l)) };
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
