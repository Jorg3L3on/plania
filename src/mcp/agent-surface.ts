import type { Db } from "../db/client.js";
import type { Workspace } from "../db/schema.js";
import { cambioOf, changedFiles, DEFAULT_UI_GLOBS, MUESTRA_HINT, parseMuestra, uiFiles, type Cambio, type Muestra } from "../captures/muestra.js";
import { defaultGit, repoPathOf, type GitFn } from "../runner/worktree.js";
import { readerOf, uowOf } from "../store/port.js";
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
  muestra?: unknown;
};

// PLA-I52-1: how finish reads a branch's changed files (tests inject it). null = it could not tell.
export type FinishDeps = { changedFiles?: (repo: string, base: string, branch: string) => Promise<string[] | null>; git?: GitFn };

// The muestra check, before the transaction (it reads git). A code delivery on a project Plania photographs
// (settings.capture) that touches the screen needs a muestra, passed now or stored by an earlier finish. When
// Plania cannot read the diff (no repo on this Mac, unknown branch) it does not refuse: the warning says so.
async function muestraCheck(
  db: Db,
  p: Awaited<ReturnType<typeof findProject>>,
  input: FinishInput,
  deps: FinishDeps,
): Promise<{ muestra: Muestra | null; cambio?: Cambio; warning?: string }> {
  let muestra: Muestra | null = null;
  if (input.muestra !== undefined && input.muestra !== null) {
    const parsed = parseMuestra(input.muestra);
    if (!parsed.ok) throw new ToolError("MUESTRA_INVALID", { field: parsed.field, hint: parsed.hint });
    muestra = parsed.muestra;
  }
  const t = await requireTask(db, p.id, input.key);
  const capture = p.settings?.capture;
  if (!capture || t.kind !== "ticket" || (t.workType ?? "code") !== "code") return { muestra };
  const branch = input.branch?.trim() || t.branch || t.workspace?.branch;
  if (!branch) return { muestra, warning: "muestra not checked: no branch on the ticket or in this call" };
  let base = p.settings?.release?.from ?? "main";
  if (t.parentId) {
    const parent = await readerOf(db).get("tasks", { id: t.parentId });
    if (parent?.baseBranch) base = parent.baseBranch;
  }
  const repo = repoPathOf(p.slug, p.settings ?? null);
  const read = deps.changedFiles ?? ((r, b, h) => changedFiles(deps.git ?? defaultGit, r, b, h));
  const files = await read(repo, base, branch).catch(() => null);
  if (!files) return { muestra, warning: `muestra not checked: could not read ${base}...${branch} in ${repo}` };
  const ui = uiFiles(files, capture.ui_globs ?? DEFAULT_UI_GLOBS);
  const cambio = cambioOf(files, capture.ui_globs ?? DEFAULT_UI_GLOBS);
  if (ui.length && !muestra && !t.muestra) throw new ToolError("MUESTRA_REQUIRED", { key: t.key, base, branch, ui_files: ui.slice(0, 12), hint: MUESTRA_HINT });
  return { muestra, cambio };
}

export async function finish(db: Db, input: FinishInput, ctx: Ctx, deps: FinishDeps = {}) {
  const p = await findProject(db, input.project);
  const sample = await muestraCheck(db, p, input, deps);
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
    if (sample.cambio) await uowOf(tx).update("tasks", { id: t.id }, { cambio: sample.cambio });
    if (sample.muestra) {
      await uowOf(tx).update("tasks", { id: t.id }, { muestra: sample.muestra });
      changed.push("muestra");
      await emit("task.muestra", { id: t.id, key: t.key }, { vistas: sample.muestra.vistas.map((v) => v.key) });
    }
    if (noPr && !prUrl) {
      changed.push("no_pr");
      await emit("task.no_pr", { id: t.id, key: t.key }, { reason: noPr, to: "In review" });
    }
    let initiative: { key: string; version: number; next_action: string } | undefined;
    if (input.note?.trim() && t.parentId) {
      const parent = await readerOf(tx).get("tasks", { id: t.parentId });
      const r = await setTaskInTx(tx, emit, p, { project: p.slug, key: parent!.key, next_action: input.note.trim(), version: parent!.version }, ctx);
      initiative = { key: r.key, version: r.version, next_action: input.note.trim() };
    }
    const { changed: _c, ...rest } = moved;
    return { ...rest, changed, result: added.result, ...(initiative ? { initiative } : {}), ...(sample.warning ? { warnings: [sample.warning] } : {}) };
  });
}
