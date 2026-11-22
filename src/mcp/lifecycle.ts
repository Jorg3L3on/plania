import { ToolError } from "./errors.js";
import { SETTLED, ST } from "../state/status.js";
import { DONE_FROM, IDEA_MOVES, INITIATIVE_DONE_FROM, INITIATIVE_MOVES, SYSTEM_MOVES, TICKET_MOVES, VIA_TOOL, isTerminal } from "../state/transitions.js";

// The status machine, enforced on every write. Three vocabularies:
//
// Idea:       Open → Done. Won't do and reopening are the owner's. The stage is a separate machine (ideas.ts).
// Ticket:     Backlog ⇄ Ready → (claim) In progress → In review → Merged → Released → Done
//             Blocked from Backlog, Ready, In progress or In review; back to Backlog or Ready.
//             Needs owner only through ask; it leaves only through answer.
//             In review goes back to In progress through claim (rework).
//             Merged and Released are the server's (the GitHub and Vercel pollers, via "system");
//             an agent sets them only with a ci result that names the merge commit (writes.ts).
// Initiative: Planning ⇄ Active ⇄ Shipping, any of them ⇄ On hold.
//
// Done is the agents' once the work is finished (DONE_FROM, by work type); the checks still apply
// (checks closed, an initiative's tickets closed). Won't do and reopening are the owner's: on screen
// with a reason, or by an agent who also sends delegated_by_owner {message_id, quote}. The move
// is logged. Nothing is spent and nothing waits on a screen step.

export { TERMINAL } from "../state/status.js";

// Entering any of these needs every check done or waived (CHECKS_OPEN).
export const GATED_STATUSES = SETTLED;

export function doneFrom(kind: string, workType?: string | null): string[] {
  if (kind === "initiative") return INITIATIVE_DONE_FROM;
  if (kind === "idea") return [ST.open];
  return DONE_FROM[workType ?? "code"] ?? DONE_FROM.code!;
}

export type ApprovalAction = "done" | "wont_do" | "reopen" | "waive_check" | "runbook_step" | "lease_resource";

export type TransitionCtx = {
  human?: boolean; // the owner's screen
  via?: "set_task" | "claim" | "ask" | "answer" | "system";
  workType?: string | null; // the ticket's, for where Done may come from
  reason?: string; // required for Won't do and for reopening
  delegated?: boolean; // an agent presented delegated_by_owner evidence
};

// The special action a move needs, or null when it needs none.
export function actionForMove(from: string, to: string): ApprovalAction | null {
  if (to === ST.wontDo) return "wont_do";
  if (isTerminal(from)) return "reopen";
  return null;
}

const SPECIAL_HINT =
  "Won't do and reopening need a reason. On screen that is enough. An agent also sends delegated_by_owner {message_id, quote}.";

// Throws if the move is not allowed. Returns true when the move is a logged Won't do or reopen.
export function assertTransition(kind: string, from: string, to: string, ctx: TransitionCtx): boolean {
  if (from === to) return false;
  const needed = actionForMove(from, to);
  if (needed) {
    if (!ctx.reason?.trim() || (!ctx.human && !ctx.delegated)) {
      throw new ToolError("HUMAN_ONLY", { from, to, needs: needed, hint: SPECIAL_HINT });
    }
    return true;
  }
  if (ctx.human) return false;
  if (ctx.via === "system") {
    // PLA-82 (F-34): the release rule closes an initiative whose steps are all closed (the children check holds).
    if (kind === "initiative" && to === ST.done && INITIATIVE_DONE_FROM.includes(from)) return false;
    if (!(SYSTEM_MOVES[from] ?? []).includes(to)) throw new ToolError("INVALID_TRANSITION", { from, to, hint: "not a system move" });
    return false;
  }
  if (to === ST.done && !needed) {
    const allowed = doneFrom(kind, ctx.workType);
    if (!allowed.includes(from)) {
      const hint = kind === "initiative" ? "an initiative closes from an open status" : kind === "idea" ? "an idea closes from Open" : `a ${ctx.workType ?? "code"} ticket is Done from ${allowed.join(", ")}`;
      throw new ToolError("INVALID_TRANSITION", { from, to, allowed_from: allowed, hint });
    }
    return false;
  }
  // answer puts a ticket back where it was before the question, whatever that was.
  if (kind === "ticket" && from === ST.needsOwner && ctx.via === "answer") return false;
  const tool = kind === "ticket" ? VIA_TOOL[to] : undefined;
  if (tool && ctx.via !== tool) throw new ToolError("INVALID_TRANSITION", { from, to, hint: `use ${tool}` });
  if (tool && ctx.via === tool) return false;
  if (kind === "ticket" && from === ST.needsOwner) {
    throw new ToolError("INVALID_TRANSITION", { from, to, hint: "Needs owner leaves through answer" });
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
