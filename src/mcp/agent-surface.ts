import type { Db } from "../db/client.js";
import { tasks, type Workspace } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getContext } from "./context.js";
import { addResultInTx, type AddResultInput } from "./evidence.js";
import { ToolError, findProject, requireTask } from "./queries.js";
import { writeTx, type Ctx } from "./tx.js";
import { claim, setTaskInTx } from "./writes.js";

// 2.13 (item 7): the two composite tools an agent needs most. start = claim + get_context, so a
// session opens a ticket in one call; finish = add_result + set_task In review in one transaction, so
// a ticket never reaches review without its evidence, its branch and its PR.

export type StartInput = { project: string; key: string; workspace?: Workspace; ttl_minutes?: number; since_cursor?: number };

// The claim runs first and its errors are the caller's (CLAIM_HELD, NOT_CLAIMABLE, HANDOFF_HELD...).
// The context is then read for the workspace the claim settled on (a phase defaults to its
// initiative's integration branch), so it always finds the ticket just claimed.
export async function start(db: Db, input: StartInput, ctx: Ctx) {
  const claimed = await claim(db, { project: input.project, key: input.key, workspace: input.workspace, ttl_minutes: input.ttl_minutes }, ctx);
  const p = await findProject(db, input.project);
  const ws: Workspace = { ...(input.workspace ?? {}), ...((claimed as { workspace?: Workspace | null }).workspace ?? {}) };
  const context = await getContext(db, p, {
    workspace: { ...ws, machine: ws.machine ?? ctx.actor.machine },
    session_id: ctx.actor.session_id,
    since_cursor: input.since_cursor,
  });
  return { ...context, ...claimed };
}

export type FinishInput = {
  project: string;
  key: string;
  result: Omit<AddResultInput, "project" | "key">;
  pr_url?: string;
  branch?: string;
  version?: number;
  note?: string;
  no_pr_reason?: string;
};

export async function finish(db: Db, input: FinishInput, ctx: Ctx) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const t = await requireTask(tx, p.id, input.key);
    if (t.kind !== "ticket") throw new ToolError("INVALID_TRANSITION", { from: t.status, to: "In review", hint: "finish is for tickets; an initiative closes with set_task" });
    const prUrl = input.pr_url?.trim() || t.prUrl;
    const noPr = input.no_pr_reason?.trim();
    if ((t.workType ?? "code") === "code" && !prUrl && !noPr) {
      throw new ToolError("TASK_MISSING_PR_URL", { key: t.key, to: "In review", hint: "pass pr_url (open the PR first, with Plania: KEY in its body), or no_pr_reason when the work has none" });
    }
    const branch = input.branch?.trim() || undefined;
    const added = await addResultInTx(tx, emit, p, { ...input.result, project: p.slug, key: t.key, branch: input.result.branch ?? branch }, ctx);
    // add_result does not bump the version, so the one the caller read (or the current one) still holds.
    const moved = await setTaskInTx(
      tx,
      emit,
      p,
      { project: p.slug, key: t.key, status: "In review", version: input.version ?? t.version, ...(branch ? { branch } : {}), ...(input.pr_url?.trim() ? { pr_url: input.pr_url.trim() } : {}) },
      ctx,
    );
    const changed = [...new Set(["results", ...(added.changed.includes("checks") ? ["checks"] : []), ...moved.changed])];
    if (noPr && !prUrl) {
      changed.push("no_pr");
      await emit("task.no_pr", { id: t.id, key: t.key }, { reason: noPr, to: "In review" });
    }
    let initiative: { key: string; version: number; next_action: string } | undefined;
    if (input.note?.trim() && t.parentId) {
      const [parent] = await tx.select().from(tasks).where(eq(tasks.id, t.parentId)).limit(1);
      const r = await setTaskInTx(tx, emit, p, { project: p.slug, key: parent!.key, next_action: input.note.trim(), version: parent!.version }, ctx);
      initiative = { key: r.key, version: r.version, next_action: input.note.trim() };
    }
    const { changed: _c, ...rest } = moved;
    return { ...rest, changed, result: added.result, ...(initiative ? { initiative } : {}) };
  });
}
