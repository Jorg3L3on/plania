// PLA-I74-4: "can this step be worked on?" has one answer. Before, five readers each wrote their own (get_next's
// nextTask, the board's readyOf, the heartbeat's loadReady behind «Que empiece ya», and the idle sweeps in
// runner/events.ts), and PLA-161, 163, 164 and 165 were the same gap found four times: one reader learned about an
// On hold initiative, a blocker or a person's own step, the others did not.
//
// A step is workable when it is a Ready ticket, every blocker holds, its initiative is not On hold, no person owns it
// (a human agent or the ceo seat: the owner's own steps) and no live lease holds it. Unowned work stays workable:
// who takes it is pickReady's and the wake rules' business, not this predicate's.
import { and, eq, sql, type SQL } from "drizzle-orm";
import { tasks } from "../db/schema.js";
import { hasUnsatisfiedBlocker } from "../mcp/blockers.js";
import { ST } from "./status.js";

// The ticket's initiative (if any) is not On hold (PLA-161, PLA-163).
export const parentNotOnHold: SQL = sql`not exists (select 1 from tasks par where par.id = ${tasks.parentId} and par.status = ${ST.onHold})`;
// No person owns it: a human agent or the ceo seat (PLA-165).
export const notPersonOwned: SQL = sql`not exists (select 1 from agents own where own.id = ${tasks.ownerAgent} and (own.kind = 'human' or own.slug = 'ceo'))`;
// Every blocker holds (R-15).
export const unblocked: SQL = sql`not ${hasUnsatisfiedBlocker(tasks.id)}`;
// No lease that is still running.
export const noLiveLease: SQL = sql`(${tasks.leaseUntil} is null or ${tasks.leaseUntil} <= now())`;

// What every reader shares, whatever statuses it starts from.
export const workableCore: SQL = and(eq(tasks.kind, "ticket"), unblocked, parentNotOnHold, notPersonOwned)!;

// The one predicate: a Ready ticket an agent may start now.
export const workable: SQL = and(eq(tasks.status, ST.ready), noLiveLease, workableCore)!;

// The board's queues (readyOf) also show a Ready step that still waits on a blocker, so the teammate's card can say
// «Espera a un paso» (PLA-I40-1): queueable is workable without the blocker and lease parts. Once its blockers hold it is
// workable, and nothing else about it changed.
export const queueable: SQL = and(eq(tasks.kind, "ticket"), eq(tasks.status, ST.ready), parentNotOnHold, notPersonOwned)!;

// get_next (nextTask) also offers Backlog unless the project says claim_from ready, and an In progress ticket whose
// lease is gone (stale_claim: whoever held it hands it back). The rest of the rule is workable's.
export function claimable(opts: { backlog: boolean }): SQL {
  const from = opts.backlog ? [ST.backlog, ST.ready, ST.inProgress] : [ST.ready, ST.inProgress];
  return and(sql`${tasks.status} in (${sql.join(from.map((s) => sql`${s}`), sql`, `)})`, noLiveLease, workableCore)!;
}
