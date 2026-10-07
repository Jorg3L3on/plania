import { ToolError } from "./errors.js";

// The status machine, enforced on every write. Two vocabularies:
//
// Ticket:     Backlog ⇄ Ready → (claim) In progress → In review → Done (Jorge)
//             Blocked from Backlog, Ready, In progress or In review; back to Backlog or Ready.
//             Needs Jorge only through ask; it leaves only through answer.
//             In review goes back to In progress through claim (rework).
// Initiative: Planning ⇄ Active ⇄ Shipping, any of them ⇄ On hold.
//
// Done and Won't do, and reopening either, are Jorge's: on screen, or by an agent holding an
// approval he granted (request_approval → approval_id), which is spent on that one move.

export const TERMINAL = ["Done", "Won't do"] as const;

// Entering any of these needs every check done or waived (CHECKS_OPEN).
export const GATED_STATUSES = ["In review", "Merged", "Released", "Done"] as const;

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

export type ApprovalAction = "done" | "wont_do" | "reopen" | "waive_check" | "runbook_step" | "lease_resource";

export type TransitionCtx = {
  human?: boolean; // Jorge's screen
  via?: "set_task" | "claim" | "ask" | "answer";
  approval?: { action: string } | null; // an approval the caller holds
};

const isTerminal = (s: string) => (TERMINAL as readonly string[]).includes(s);

// The approval action a move needs, or null when it needs none.
export function actionForMove(from: string, to: string): ApprovalAction | null {
  if (to === "Done") return "done";
  if (to === "Won't do") return "wont_do";
  if (isTerminal(from)) return "reopen";
  return null;
}

// Throws if the move is not allowed. Returns true when it went through an approval.
export function assertTransition(kind: string, from: string, to: string, ctx: TransitionCtx): boolean {
  if (from === to) return false;
  if (ctx.human) return false;
  const needed = actionForMove(from, to);
  if (needed) {
    if (ctx.approval?.action === needed) return true;
    throw new ToolError("HUMAN_ONLY", {
      from,
      to,
      needs: needed,
      hint: "Jorge marks Done and Won't do on screen. Ask him with request_approval and pass the granted approval_id.",
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
