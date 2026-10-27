import { ToolError } from "./errors.js";

// The status machine, enforced on every write. Three vocabularies:
//
// Idea:       Open → Done. Won't do and reopening are Jorge's. The stage is a separate machine (ideas.ts).
// Ticket:     Backlog ⇄ Ready → (claim) In progress → In review → Merged → Released → Done
//             Blocked from Backlog, Ready, In progress or In review; back to Backlog or Ready.
//             Needs Jorge only through ask; it leaves only through answer.
//             In review goes back to In progress through claim (rework).
//             Merged and Released are the server's (the GitHub and Vercel pollers, via "system");
//             an agent sets them only with a ci result that names the merge commit (writes.ts).
// Initiative: Planning ⇄ Active ⇄ Shipping, any of them ⇄ On hold.
//
// Done is the agents' once the work is finished (DONE_FROM, by work type); the gates still apply
// (checks closed, an initiative's tickets closed). Won't do and reopening are Jorge's: on screen,
// or by an agent holding an approval he granted (request_approval → approval_id), spent on that one move.

export const TERMINAL = ["Done", "Won't do"] as const;

// Entering any of these needs every check done or waived (CHECKS_OPEN).
export const GATED_STATUSES = ["In review", "Merged", "Released", "Done"] as const;

const TICKET_MOVES: Record<string, string[]> = {
  Backlog: ["Ready", "Blocked"],
  Ready: ["Backlog", "Blocked"],
  "In progress": ["In review", "Blocked", "Ready", "Backlog"],
  "In review": ["Ready", "Backlog", "Blocked", "Merged"],
  Merged: ["Released", "In review"],
  Released: [],
  Blocked: ["Backlog", "Ready"],
  "Needs Jorge": [],
};

// What the pollers may do on their own, from GitHub and deploy data.
const SYSTEM_MOVES: Record<string, string[]> = {
  "In review": ["Merged", "Ready"],
  Merged: ["Released"],
  Released: ["Merged"],
};

const INITIATIVE_MOVES: Record<string, string[]> = {
  Planning: ["Active", "On hold"],
  Active: ["Planning", "Shipping", "On hold"],
  Shipping: ["Active", "On hold"],
  "On hold": ["Planning", "Active", "Shipping"],
};

const IDEA_MOVES: Record<string, string[]> = {
  Open: ["Done"],
};

// Where an agent may close a ticket: code-like work once it merged, ops and research once in
// review, a decision once answered (it leaves Needs Jorge first). An initiative from any open status.
const DONE_FROM: Record<string, string[]> = {
  code: ["Merged", "Released"],
  bug: ["Merged", "Released"],
  debt: ["Merged", "Released"],
  ops: ["In review", "Merged", "Released"],
  research: ["In review", "Merged", "Released"],
  "decision-needed": ["Backlog", "Ready", "In progress"],
};
const INITIATIVE_DONE_FROM = ["Planning", "Active", "Shipping", "On hold"];

export function doneFrom(kind: string, workType?: string | null): string[] {
  if (kind === "initiative") return INITIATIVE_DONE_FROM;
  if (kind === "idea") return ["Open"];
  return DONE_FROM[workType ?? "code"] ?? DONE_FROM.code!;
}

// Moves that only one tool makes.
const VIA_TOOL: Record<string, string> = { "In progress": "claim", "Needs Jorge": "ask" };

export type ApprovalAction = "done" | "wont_do" | "reopen" | "waive_check" | "runbook_step" | "lease_resource";

export type TransitionCtx = {
  human?: boolean; // Jorge's screen
  via?: "set_task" | "claim" | "ask" | "answer" | "system";
  approval?: { action: string } | null; // an approval the caller holds
  workType?: string | null; // the ticket's, for where Done may come from
};

const isTerminal = (s: string) => (TERMINAL as readonly string[]).includes(s);

// The approval action a move needs, or null when it needs none.
export function actionForMove(from: string, to: string): ApprovalAction | null {
  if (to === "Won't do") return "wont_do";
  if (isTerminal(from)) return "reopen";
  return null;
}

// Throws if the move is not allowed. Returns true when it went through an approval.
export function assertTransition(kind: string, from: string, to: string, ctx: TransitionCtx): boolean {
  if (from === to) return false;
  if (ctx.human) return false;
  if (ctx.via === "system") {
    if (!(SYSTEM_MOVES[from] ?? []).includes(to)) throw new ToolError("INVALID_TRANSITION", { from, to, hint: "not a system move" });
    return false;
  }
  const needed = actionForMove(from, to);
  if (to === "Done" && !needed) {
    const allowed = doneFrom(kind, ctx.workType);
    if (!allowed.includes(from)) {
      const hint = kind === "initiative" ? "an initiative closes from an open status" : kind === "idea" ? "an idea closes from Open" : `a ${ctx.workType ?? "code"} ticket is Done from ${allowed.join(", ")}`;
      throw new ToolError("INVALID_TRANSITION", { from, to, allowed_from: allowed, hint });
    }
    return false;
  }
  if (needed) {
    if (ctx.approval?.action === needed) return true;
    throw new ToolError("HUMAN_ONLY", {
      from,
      to,
      needs: needed,
      hint: "Won't do and reopening are Jorge's. Ask him with request_approval and pass the granted approval_id.",
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
  const allowed = (kind === "initiative" ? INITIATIVE_MOVES : kind === "idea" ? IDEA_MOVES : TICKET_MOVES)[from] ?? [];
  if (!allowed.includes(to) && ctx.via !== "claim") {
    throw new ToolError("INVALID_TRANSITION", { from, to, allowed });
  }
  return false;
}

export const WORK_TYPES = ["code", "ops", "research", "decision-needed", "bug", "debt"] as const;
export const SEVERITIES = ["S1", "S2", "S3", "S4"] as const;
export type WorkType = (typeof WORK_TYPES)[number];
