import type { Task } from "../db/schema.js";
import { readerOf } from "../store/port.js";
import { blockerList, type BlockerView } from "./blockers.js";
import { liveOwner, prOf, type PrShape } from "./queries.js";
import type { Q } from "./tx.js";

// 2.11 (item 3): where an initiative stands, derived from its tickets, their claims and their
// blockers, so nobody has to write it. state_note stays beside it as commentary.

export type InitiativeState = {
  /** The lowest phase with a ticket not yet in review; null when every phase is in review or closed. */
  phase_now: number | null;
  done: number;
  /** Tickets that count: every child but Won't do. */
  total: number;
  in_progress: { key: string; agent: string | null }[];
  in_review: { key: string; pr: PrShape | null }[];
  /** Merged, waiting for the release target to run them. */
  to_release: string[];
  /** PLA-I56-1: Released, not yet Done (an open check or question holds them, or the rule is off). */
  to_close: string[];
  /** PLA-I56-1: every ticket is Done (Won't do aside): the owner can close the initiative. */
  ready_to_close: boolean;
  /** What the initiative itself and its open tickets wait on: another ticket, Jorge (a step, a question), an env, a flag, a time, a metric. */
  waiting_on: { key: string; on: string }[];
  /** The same in one Spanish line, for the screen and the resume. */
  line: string;
};

const ADVANCED = ["In review", "Merged", "Released", "Done", "Won't do"];
const OPEN = (s: string) => !["Done", "Won't do", "Merged", "Released"].includes(s);

function waitText(b: BlockerView): string {
  switch (b.type) {
    case "task":
      return `${b.task} (${b.status})`;
    case "human_action":
      return `Jorge: ${b.text}`;
    case "env":
      return `${b.env} ${b.condition} ${b.value}`;
    case "env_flag":
      return `${b.env}.${b.flag} = ${String(b.equals)}`;
    case "time_after":
      return `después de ${b.at}`;
    case "metric_gte":
      return `${b.name} ≥ ${b.value}`;
  }
}

export function stateLine(s: Omit<InitiativeState, "line">): string {
  if (s.total === 0) return "Sin tickets todavía";
  if (s.ready_to_close) return `${s.done}/${s.total} hechos · lista para cerrar`;
  const parts = [s.phase_now !== null ? `Fase ${s.phase_now}` : null, `${s.done}/${s.total} hechos`];
  if (s.in_progress.length) parts.push(`en curso ${s.in_progress.map((c) => c.key).join(", ")}`);
  if (s.in_review.length) {
    const prs = [...new Set(s.in_review.map((r) => (r.pr?.number ? `#${r.pr.number}` : null)).filter(Boolean))];
    parts.push(`en revisión ${s.in_review.length}${prs.length ? ` (${prs.join(", ")})` : ""}`);
  }
  if (s.to_release.length) parts.push(`${s.to_release.length} por lanzar`);
  if (s.to_close?.length) parts.push(`${s.to_close.length} por cerrar`);
  if (s.waiting_on.length) {
    const jorge = s.waiting_on.filter((w) => w.on.startsWith("Jorge"));
    parts.push(jorge.length ? `espera a Jorge (${jorge.length})` : `espera ${s.waiting_on[0]!.on}`);
  }
  return parts.filter(Boolean).join(" · ");
}

export async function initiativeState(db: Q, i: Pick<Task, "id" | "key" | "projectId">, children?: Task[]): Promise<InitiativeState> {
  const r = readerOf(db);
  // Children in key order, sorted by the store so text order stays the database's.
  const kids = (children ?? (await r.find("tasks", { parentId: i.id }, { orderBy: [{ column: "key" }] }))).filter((c) => c.status !== "Won't do");
  const open = kids.filter((c) => OPEN(c.status));
  const ids = open.map((c) => c.id);
  const asked = ids.length ? await r.find("questions", { taskId: ids, answeredAt: null }) : [];
  const waiting_on: InitiativeState["waiting_on"] = [];
  for (const b of await blockerList(db, i)) if (!b.satisfied) waiting_on.push({ key: i.key, on: waitText(b) });
  for (const c of open) {
    if (c.status === "In review") continue;
    for (const b of await blockerList(db, c)) if (!b.satisfied) waiting_on.push({ key: c.key, on: waitText(b) });
    if (asked.some((q) => q.taskId === c.id)) waiting_on.push({ key: c.key, on: "Jorge: una pregunta" });
  }
  const phases = kids.filter((c) => !ADVANCED.includes(c.status) && c.phase !== null).map((c) => c.phase!);
  const base = {
    phase_now: phases.length ? Math.min(...phases) : null,
    done: kids.filter((c) => c.status === "Done").length,
    total: kids.length,
    in_progress: kids.filter((c) => liveOwner(c)).map((c) => ({ key: c.key, agent: liveOwner(c)?.agent ?? null })),
    in_review: await Promise.all(kids.filter((c) => c.status === "In review").map(async (c) => ({ key: c.key, pr: await prOf(db, c) }))),
    to_release: kids.filter((c) => c.status === "Merged").map((c) => c.key),
    to_close: kids.filter((c) => c.status === "Released").map((c) => c.key),
    ready_to_close: kids.length > 0 && kids.every((c) => c.status === "Done"),
    waiting_on,
  };
  return { ...base, line: stateLine(base) };
}
