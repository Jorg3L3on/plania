import { ToolError } from "./errors.js";

// The status machine, enforced on every write. Two vocabularies:
//
// Ticket:     Backlog ⇄ Ready → (claim) In progress → In review → Done (Jorge)
//             Blocked from Backlog, Ready, In progress or In review; back to Backlog or Ready.
//             Needs Jorge only through ask; it leaves only through answer.
//             In review goes back to In progress through claim (rework).
// Initiative: Planning ⇄ Active ⇄ Shipping, any of them ⇄ On hold.
//
// Done and Won't do, and reopening either, are Jorge's: on screen, or by an agent he asked, which
// must say so (confirm_by_jorge + reason) and is logged as task.human_override.

export const TERMINAL = ["Done", "Won't do"] as const;

const TICKET_MOVES: Record<string, string[]> = {
  Backlog: ["Ready", "Blocked"],
  Ready: ["Backlog", "Blocked"],
  "In progress": ["In review", "Blocked", "Ready", "Backlog"],
  "In review": ["Ready", "Backlog", "Blocked"],
  Blocked: ["Backlog", "Ready"],
  "Needs Jorge": [],
};

const INITIATIVE_MOVES: Record<string, string[]> = {
  Planning: ["Active", "On hold"],
  Active: ["Planning", "Shipping", "On hold"],
  Shipping: ["Active", "On hold"],
  "On hold": ["Planning", "Active", "Shipping"],
};

// Moves that only one tool makes.
const VIA_TOOL: Record<string, string> = { "In progress": "claim", "Needs Jorge": "ask" };

export type Override = { confirm_by_jorge?: boolean; reason?: string };

export type TransitionCtx = {
  human?: boolean; // Jorge's screen
  via?: "set_task" | "claim" | "ask" | "answer";
  override?: Override;
};

const isTerminal = (s: string) => (TERMINAL as readonly string[]).includes(s);

// Throws if the move is not allowed. Returns true when it went through Jorge's override.
export function assertTransition(kind: string, from: string, to: string, ctx: TransitionCtx): boolean {
  if (from === to) return false;
  if (ctx.human) return false;
  if (isTerminal(to) || isTerminal(from)) {
    if (ctx.override?.confirm_by_jorge) {
      if (!ctx.override.reason?.trim()) throw new ToolError("OVERRIDE_REQUIRES_REASON");
      return true;
    }
    throw new ToolError("HUMAN_ONLY", {
      from,
      to,
      hint: "Jorge marks Done and Won't do on screen. If he asked you to, pass confirm_by_jorge: true with a reason.",
    });
  }
  // answer puts a ticket back where it was before the question, whatever that was.
  if (kind === "ticket" && from === "Needs Jorge" && ctx.via === "answer") return false;
  const tool = kind === "ticket" ? VIA_TOOL[to] : undefined;
  if (tool && ctx.via !== tool) throw new ToolError("INVALID_TRANSITION", { from, to, hint: `use ${tool}` });
  if (tool && ctx.via === tool) return false;
  if (kind === "ticket" && from === "Needs Jorge") {
    throw new ToolError("INVALID_TRANSITION", { from, to, hint: "Needs Jorge leaves through answer" });
  }
  const allowed = (kind === "initiative" ? INITIATIVE_MOVES : TICKET_MOVES)[from] ?? [];
  if (!allowed.includes(to) && ctx.via !== "claim") {
    throw new ToolError("INVALID_TRANSITION", { from, to, allowed });
  }
  return false;
}

export const WORK_TYPES = ["code", "ops", "research", "decision-needed"] as const;
export type WorkType = (typeof WORK_TYPES)[number];
