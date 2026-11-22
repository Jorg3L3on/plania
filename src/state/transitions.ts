// PLA-I74-4: the transitions table. Each status change, who may make it, and which wake follows. The status machine
// (src/mcp/lifecycle.ts) enforces the moves from these maps; the wake rules (src/runner/events.ts) read wakeOf.
//
// Idea:       Open → Done. Won't do and reopening are the owner's.
// Ticket:     Backlog ⇄ Ready → (claim) In progress → In review → Merged → Released → Done
//             Blocked from Backlog, Ready, In progress or In review; back to Backlog or Ready.
//             Needs owner only through ask; it leaves only through answer.
// Initiative: Planning ⇄ Active ⇄ Shipping, any of them ⇄ On hold.
import { DONE_LIKE, LANDED, ST, TERMINAL, type Status } from "./status.js";

export type Kind = "ticket" | "initiative" | "idea";
// Who makes a move: an agent through set_task, the owner on the screen, the server (pollers, the lease reaper, a
// blocker that holds), or one tool only (claim, ask, answer).
export type Mover = "agent" | "owner" | "system" | "claim" | "ask" | "answer";
// The wake that follows a move (events.ts targetOf):
//   ready               the ticket became Ready: its PO owner, else Taller on it (PLA-I31-1, PLA-I30-6, PLA-16)
//   landed              the ticket's work landed: Taller on the first Ready step it was blocking (PLA-15)
//   initiative-started  the initiative turned Active: Taller on its first Ready step (PLA-151)
export type Wake = "ready" | "landed" | "initiative-started";

// Agent moves (set_task), per kind. The owner may make any of these too.
export const TICKET_MOVES: Record<string, string[]> = {
  [ST.backlog]: [ST.ready, ST.blocked],
  [ST.ready]: [ST.backlog, ST.blocked],
  [ST.inProgress]: [ST.inReview, ST.blocked, ST.ready, ST.backlog],
  [ST.inReview]: [ST.ready, ST.backlog, ST.blocked, ST.merged],
  [ST.merged]: [ST.released, ST.inReview],
  [ST.released]: [],
  [ST.blocked]: [ST.backlog, ST.ready],
  [ST.needsOwner]: [],
};
// What the pollers may do on their own, from GitHub and deploy data.
export const SYSTEM_MOVES: Record<string, string[]> = {
  [ST.inReview]: [ST.merged, ST.ready],
  [ST.merged]: [ST.released],
  // PLA-I56-1: a released code ticket with nothing left open closes by the rule (jobs/github.ts closeReleased).
  [ST.released]: [ST.merged, ST.done],
};
export const INITIATIVE_MOVES: Record<string, string[]> = {
  [ST.planning]: [ST.active, ST.onHold],
  [ST.active]: [ST.planning, ST.shipping, ST.onHold],
  [ST.shipping]: [ST.active, ST.onHold],
  [ST.onHold]: [ST.planning, ST.active, ST.shipping],
};
export const IDEA_MOVES: Record<string, string[]> = { [ST.open]: [ST.done] };
// Where an agent may close a ticket, by work type: code-like work once it merged, ops and research once in review, a
// decision once answered. An initiative from any open status, an idea from Open.
export const DONE_FROM: Record<string, string[]> = {
  code: [ST.merged, ST.released],
  bug: [ST.merged, ST.released],
  debt: [ST.merged, ST.released],
  ops: [ST.inReview, ST.merged, ST.released],
  research: [ST.inReview, ST.merged, ST.released],
  "decision-needed": [ST.backlog, ST.ready, ST.inProgress],
};
export const INITIATIVE_DONE_FROM: string[] = [ST.planning, ST.active, ST.shipping, ST.onHold];
// Moves that only one tool makes.
export const VIA_TOOL: Record<string, Mover> = { [ST.inProgress]: "claim", [ST.needsOwner]: "ask" };
// A ticket claim may start from (an In progress one only when its lease is gone, or for rework).
export const CLAIM_FROM: Status[] = [ST.backlog, ST.ready, ST.inProgress, ST.inReview];

// The wake rules, as data: a move into `to` from a status outside `from_not` wakes `wake`. A creation is a move from null.
const WAKE_RULES: { kinds: Kind[]; to: readonly Status[]; fromNot: readonly Status[]; wake: Wake }[] = [
  { kinds: ["ticket"], to: [ST.ready], fromNot: [ST.ready], wake: "ready" },
  { kinds: ["ticket"], to: LANDED, fromNot: LANDED, wake: "landed" },
  { kinds: ["initiative"], to: [ST.active], fromNot: [ST.active], wake: "initiative-started" },
];

// The wake a move earns, or null. kind may be unknown (an event that does not carry it): then the move's statuses decide.
export function wakeOf(from: string | null | undefined, to: string, kind?: Kind | null): Wake | null {
  for (const r of WAKE_RULES) {
    if (kind && !r.kinds.includes(kind)) continue;
    if ((r.to as readonly string[]).includes(to) && !(from && (r.fromNot as readonly string[]).includes(from))) return r.wake;
  }
  return null;
}

export type Transition = { kind: Kind; from: string | null; to: string; by: Mover[]; wake: Wake | null };

// Every status change, flat: the table the screen, the tests and the watchdog read.
export const TRANSITIONS: Transition[] = (() => {
  const out: Transition[] = [];
  const add = (kind: Kind, from: string | null, to: string, by: Mover[]) => {
    const row = out.find((t) => t.kind === kind && t.from === from && t.to === to);
    if (row) row.by = [...new Set([...row.by, ...by])];
    else out.push({ kind, from, to, by, wake: wakeOf(from, to, kind) });
  };
  // Creation: tickets are born Backlog or Ready, initiatives Planning or Active, ideas Open.
  for (const to of [ST.backlog, ST.ready] as Status[]) add("ticket", null, to, ["agent", "owner"]);
  for (const to of [ST.planning, ST.active] as Status[]) add("initiative", null, to, ["agent", "owner"]);
  add("idea", null, ST.open, ["agent", "owner"]);
  for (const [from, tos] of Object.entries(TICKET_MOVES)) for (const to of tos) add("ticket", from, to, ["agent", "owner"]);
  for (const [from, tos] of Object.entries(SYSTEM_MOVES)) for (const to of tos) add("ticket", from, to, ["system"]);
  for (const from of CLAIM_FROM) add("ticket", from, ST.inProgress, ["claim"]);
  // The lease reaper puts an expired In progress back in Ready (claim.expired), and a blocker that holds frees a step.
  add("ticket", ST.inProgress, ST.ready, ["system"]);
  add("ticket", ST.blocked, ST.ready, ["system"]);
  for (const from of [ST.backlog, ST.ready, ST.inProgress, ST.inReview] as Status[]) add("ticket", from, ST.needsOwner, ["ask"]);
  for (const to of [ST.backlog, ST.ready, ST.inProgress, ST.inReview, ST.blocked] as Status[]) add("ticket", ST.needsOwner, to, ["answer"]);
  for (const [, froms] of Object.entries(DONE_FROM)) for (const from of froms) add("ticket", from, ST.done, ["agent", "owner"]);
  for (const [from, tos] of Object.entries(INITIATIVE_MOVES)) for (const to of tos) add("initiative", from, to, ["agent", "owner"]);
  for (const from of INITIATIVE_DONE_FROM) add("initiative", from, ST.done, ["agent", "owner", "system"]);
  for (const [from, tos] of Object.entries(IDEA_MOVES)) for (const to of tos) add("idea", from, to, ["agent", "owner"]);
  // Won't do and reopening are the owner's (or an agent with delegated_by_owner evidence).
  return out;
})();

export const isTerminal = (s: string): boolean => (TERMINAL as readonly string[]).includes(s);
export const isDoneLike = (s: string): boolean => (DONE_LIKE as readonly string[]).includes(s);
