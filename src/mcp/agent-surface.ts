import type { Db } from "../db/client.js";
import { agents, events, tasks, type Workspace } from "../db/schema.js";
import { and, eq, ne, sql } from "drizzle-orm";
import { roleOf } from "../runner/limits.js";
import { cambioOf, changedFiles, DEFAULT_UI_GLOBS, MUESTRA_HINT, muestraSelectorIssue, parseMuestra, uiFiles, type Cambio, type Muestra } from "../captures/muestra.js";
import { defaultGit, repoPathOf, type GitFn } from "../runner/worktree.js";
import { runVerifyList, verifyPlan } from "../runner/verify.js";
import type { Exec } from "../captures/run.js";
import { getContext } from "./context.js";
import { addResultInTx, type AddResultInput } from "./evidence.js";
import { planStepFor } from "./plan-step.js";
import { ToolError, findProject, requireTask } from "./queries.js";
import { writeTx, type Ctx } from "./tx.js";
import { claim, setTaskInTx } from "./writes.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: the note Plania writes when a PO's ticket handed its work to Taller, in the install's language; the Spanish is unchanged.
export const SURFACE_WORDS = defineWords({
  es: { handedTo: (keys: string) => `Pasó a Taller: ${keys}. La entrega que revisas es la de ese ticket.` },
  en: { handedTo: (keys: string) => `Went to Taller: ${keys}. The delivery you review is that ticket's.` },
});

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
// AUDIT-1: exec runs the project's checks (tests inject it); exists says whether the workspace folder is here.
export type FinishDeps = { changedFiles?: (repo: string, base: string, branch: string) => Promise<string[] | null>; git?: GitFn; exec?: Exec; exists?: (path: string) => boolean };

// AUDIT-1: the project's checks, run in the ticket's workspace before the delivery is accepted. A failing one refuses
// the finish with its last lines, so the builder fixes it in the same run. Nothing is written when it refuses.
async function verifyCheck(
  db: Db,
  p: Awaited<ReturnType<typeof findProject>>,
  input: FinishInput,
  ctx: Ctx,
  deps: FinishDeps,
): Promise<{ verified?: { name: string; ok: boolean; duration_s: number }[]; warning?: string }> {
  const t = await requireTask(db, p.id, input.key);
  const plan = verifyPlan(p, t, ctx.actor.session_id, deps.exists);
  if (!plan.run) return plan.warning ? { warning: plan.warning } : {};
  const ran = await runVerifyList(plan.cwd, plan.items, deps.exec);
  const failed = ran.find((v) => !v.ok);
  if (failed) {
    throw new ToolError("VERIFY_FAILED", {
      key: t.key,
      failed: { name: failed.name, command: failed.command, exit_code: failed.exit_code, tail: failed.tail },
      passed: ran.filter((v) => v.ok).map((v) => v.name),
      hint: `\`${failed.command}\` fails in the workspace. Fix it there, run it until it passes, commit, then call finish again`,
    });
  }
  return { verified: ran.map((v) => ({ name: v.name, ok: v.ok, duration_s: v.duration_s })) };
}

// The muestra check, before the transaction (it reads git). A code delivery on a project Plania photographs
// (settings.capture) that touches the screen needs a muestra, passed now or stored by an earlier finish. When
// Plania cannot read the diff (no repo on this machine, unknown branch) it does not refuse: the warning says so.
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
    // PLA-158 (F-28): a selector the browser cannot read is refused now, not found when photographing.
    const bad = muestraSelectorIssue(parsed.muestra);
    if (bad) throw new ToolError("MUESTRA_SELECTOR", bad);
    muestra = parsed.muestra;
  }
  const t = await requireTask(db, p.id, input.key);
  // PLA-I73-3: no muestra passed and none stored: the plan's «Pruébalo» for this step is the muestra.
  if (!muestra && !t.muestra) {
    const planned = (await planStepFor(db, t))?.muestra ?? null;
    if (planned && !muestraSelectorIssue(planned)) muestra = planned;
  }
  const capture = p.settings?.capture;
  if (!capture || t.kind !== "ticket" || (t.workType ?? "code") !== "code") return { muestra };
  const branch = input.branch?.trim() || t.branch || t.workspace?.branch;
  if (!branch) return { muestra, warning: "muestra not checked: no branch on the ticket or in this call" };
  let base = p.settings?.release?.from ?? "main";
  if (t.parentId) {
    const [parent] = await db.select({ base: tasks.baseBranch }).from(tasks).where(eq(tasks.id, t.parentId)).limit(1);
    if (parent?.base) base = parent.base;
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
  const checked = await verifyCheck(db, p, input, ctx, deps);
  const warnings = [sample.warning, checked.warning].filter((w): w is string => !!w);
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
    if (sample.cambio) await tx.update(tasks).set({ cambio: sample.cambio }).where(eq(tasks.id, t.id));
    if (sample.muestra) {
      await tx.update(tasks).set({ muestra: sample.muestra }).where(eq(tasks.id, t.id));
      changed.push("muestra");
      await emit("task.muestra", { id: t.id, key: t.key }, { vistas: sample.muestra.vistas.map((v) => v.key) });
    }
    if (noPr && !prUrl) {
      changed.push("no_pr");
      await emit("task.no_pr", { id: t.id, key: t.key }, { reason: noPr, to: "In review" });
    }
    // PLA-109 (guided test PLA-86, F-27): a PO that turns one of the owner's requests into a Taller ticket has nothing to
    // show; the request went to the owner as «Aceptar» with nothing behind it. When this session made a ticket for Taller
    // and the request has no PR, the request closes Done and says where the work went; the delivery the owner sees is
    // Taller's.
    let handedTo: string[] = [];
    if (t.origin === "owner" && noPr && !prUrl && (t.workType ?? "code") !== "code" && t.ownerAgent) {
      const [owner] = await tx.select().from(agents).where(eq(agents.id, t.ownerAgent)).limit(1);
      if (owner && roleOf(owner) === "product-owner") {
        const made = await tx
          .select({ key: tasks.key, owner: agents })
          .from(events)
          .innerJoin(tasks, eq(tasks.id, events.taskId))
          .innerJoin(agents, eq(agents.id, tasks.ownerAgent))
          .where(and(eq(events.projectId, p.id), eq(events.type, "task.created"), ne(tasks.id, t.id), eq(tasks.kind, "ticket"), sql`${events.actor}->>'session_id' = ${ctx.actor.session_id}`));
        handedTo = made.filter((m) => roleOf(m.owner) === "taller").map((m) => m.key);
      }
    }
    let final = moved;
    if (handedTo.length) {
      final = await setTaskInTx(tx, emit, p, { project: p.slug, key: t.key, status: "Done", version: moved.version, note: say(SURFACE_WORDS).handedTo(handedTo.join(", ")) }, ctx);
      changed.push("status");
    }
    let initiative: { key: string; version: number; next_action: string } | undefined;
    if (input.note?.trim() && t.parentId) {
      const [parent] = await tx.select().from(tasks).where(eq(tasks.id, t.parentId)).limit(1);
      const r = await setTaskInTx(tx, emit, p, { project: p.slug, key: parent!.key, next_action: input.note.trim(), version: parent!.version }, ctx);
      initiative = { key: r.key, version: r.version, next_action: input.note.trim() };
    }
    const { changed: _c, ...rest } = final;
    return { ...rest, changed, ...(handedTo.length ? { handed_to: handedTo } : {}), result: added.result, ...(initiative ? { initiative } : {}), ...(checked.verified ? { verified: checked.verified } : {}), ...(warnings.length ? { warnings } : {}) };
  });
}
