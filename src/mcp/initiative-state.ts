import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { questions, tasks, type Task } from "../db/schema.js";
import { blockerList, type BlockerView } from "./blockers.js";
import { liveOwner, prOf, type PrShape } from "./queries.js";
import type { Q } from "./tx.js";
import { OWNER_LINE_PREFIX, ownerEs, ownerName } from "../owner.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: where an initiative stands, in one line in the install's language; the Spanish is unchanged.
export const INITIATIVE_WORDS = defineWords({
  es: {
    after: (at: string) => `después de ${at}`,
    none: "Sin tickets todavía",
    readyToClose: (done: number, total: number) => `${done}/${total} hechos · lista para cerrar`,
    phase: (n: number) => `Fase ${n}`,
    done: (done: number, total: number) => `${done}/${total} hechos`,
    running: (keys: string) => `en curso ${keys}`,
    inReview: (n: number, prs: string) => `en revisión ${n}${prs}`,
    toRelease: (n: number) => `${n} por lanzar`,
    toClose: (n: number) => `${n} por cerrar`,
    waitsOwner: (n: number) => `espera ${ownerEs("a")} (${n})`,
    waits: (on: string) => `espera ${on}`,
  },
  en: {
    after: (at: string) => `after ${at}`,
    none: "No tickets yet",
    readyToClose: (done: number, total: number) => `${done}/${total} done · ready to close`,
    phase: (n: number) => `Phase ${n}`,
    done: (done: number, total: number) => `${done}/${total} done`,
    running: (keys: string) => `running ${keys}`,
    inReview: (n: number, prs: string) => `in review ${n}${prs}`,
    toRelease: (n: number) => `${n} to release`,
    toClose: (n: number) => `${n} to close`,
    waitsOwner: (n: number) => `waits on ${ownerName("en")} (${n})`,
    waits: (on: string) => `waits on ${on}`,
  },
});

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
  /** What the initiative itself and its open tickets wait on: another ticket, the owner (a step, a question), an env, a flag, a time, a metric. */
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
      return `${OWNER_LINE_PREFIX} ${b.text}`;
    case "env":
      return `${b.env} ${b.condition} ${b.value}`;
    case "env_flag":
      return `${b.env}.${b.flag} = ${String(b.equals)}`;
    case "time_after":
      return say(INITIATIVE_WORDS).after(String(b.at));
    case "metric_gte":
      return `${b.name} ≥ ${b.value}`;
  }
}

export function stateLine(s: Omit<InitiativeState, "line">): string {
  const w = say(INITIATIVE_WORDS);
  if (s.total === 0) return w.none;
  if (s.ready_to_close) return w.readyToClose(s.done, s.total);
  const parts = [s.phase_now !== null ? w.phase(s.phase_now) : null, w.done(s.done, s.total)];
  if (s.in_progress.length) parts.push(w.running(s.in_progress.map((c) => c.key).join(", ")));
  if (s.in_review.length) {
    const prs = [...new Set(s.in_review.map((r) => (r.pr?.number ? `#${r.pr.number}` : null)).filter(Boolean))];
    parts.push(w.inReview(s.in_review.length, prs.length ? ` (${prs.join(", ")})` : ""));
  }
  if (s.to_release.length) parts.push(w.toRelease(s.to_release.length));
  if (s.to_close?.length) parts.push(w.toClose(s.to_close.length));
  if (s.waiting_on.length) {
    const mine = s.waiting_on.filter((x) => x.on.startsWith(OWNER_LINE_PREFIX));
    parts.push(mine.length ? w.waitsOwner(mine.length) : w.waits(s.waiting_on[0]!.on));
  }
  return parts.filter(Boolean).join(" · ");
}

export async function initiativeState(db: Q, i: Pick<Task, "id" | "key" | "projectId">, children?: Task[]): Promise<InitiativeState> {
  const kids = (children ?? (await db.select().from(tasks).where(eq(tasks.parentId, i.id)).orderBy(asc(tasks.key)))).filter((c) => c.status !== "Won't do");
  const open = kids.filter((c) => OPEN(c.status));
  const ids = open.map((c) => c.id);
  const asked = ids.length ? await db.select({ taskId: questions.taskId }).from(questions).where(and(inArray(questions.taskId, ids), isNull(questions.answeredAt))) : [];
  const waiting_on: InitiativeState["waiting_on"] = [];
  for (const b of await blockerList(db, i)) if (!b.satisfied) waiting_on.push({ key: i.key, on: waitText(b) });
  for (const c of open) {
    if (c.status === "In review") continue;
    for (const b of await blockerList(db, c)) if (!b.satisfied) waiting_on.push({ key: c.key, on: waitText(b) });
    if (asked.some((q) => q.taskId === c.id)) waiting_on.push({ key: c.key, on: `${OWNER_LINE_PREFIX} una pregunta` });
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
