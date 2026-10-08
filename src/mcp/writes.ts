import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  INITIATIVE_STATUSES,
  PRIORITIES,
  TICKET_STATUSES,
  envCommits,
  envStates,
  pullRequests,
  results,
  tasks,
  type Task,
  type Workspace,
} from "../db/schema.js";
import type { Project } from "../db/schema.js";
import {
  ToolError,
  claimShape,
  findProject,
  findTask,
  liveOwner,
  requireTask,
  writeReply,
} from "./queries.js";
import { loadApproval, useApproval } from "./approvals.js";
import { parseBlockers, promoteUnblocked, replaceBlockers, resolveTaskBlockers, unsatisfiedBlockers, type BlockerInput } from "./blockers.js";
import { assertBranchName, assertTicketBranch, registerIntegrationBranch } from "./branches.js";
import { assertChecksClosed, replaceChecks, tickDerived, type CheckInput } from "./checks.js";
import { hasDoc } from "./docs.js";
import { assertReviewEvidence } from "./evidence.js";
import { addAlias, assignKey } from "./keys.js";
import { GATED_STATUSES, SEVERITIES, TERMINAL, WORK_TYPES, actionForMove, assertTransition } from "./lifecycle.js";
import { markHeadlineStale } from "./project.js";
import { iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// Write side. Every write runs in writeTx and records what it changed as events.
// Each write has an *InTx body (so batch can run several in one transaction) and a thin wrapper.
// Writes return the compact reply from writeReply: {key, status, version, changed}, plus the full
// task when the caller asked for verbose.

// Children created while the parent is in flight were found along the way.
const IN_FLIGHT_PARENT = ["Active", "Shipping"];

function isUniqueViolation(e: unknown): boolean {
  const code = (x: unknown) => (x as { code?: string } | undefined)?.code;
  return code(e) === "23505" || code((e as { cause?: unknown } | undefined)?.cause) === "23505";
}

function checkStatus(kind: string, status: string): void {
  const allowed: readonly string[] = kind === "initiative" ? INITIATIVE_STATUSES : TICKET_STATUSES;
  if (!allowed.includes(status)) throw new ToolError("INVALID_STATUS");
}

function checkWorkType(workType: string): void {
  if (!(WORK_TYPES as readonly string[]).includes(workType)) throw new ToolError("INVALID_WORK_TYPE");
}

function checkPriority(priority: string): void {
  if (!(PRIORITIES as readonly string[]).includes(priority)) throw new ToolError("INVALID_PRIORITY");
}

async function resolveParent(db: Q, projectId: string, parentKey: string): Promise<Task> {
  const parent = await requireTask(db, projectId, parentKey);
  if (parent.kind !== "initiative") throw new ToolError("PARENT_MUST_BE_INITIATIVE");
  return parent;
}

// Optimistic concurrency. The caller read version v; anything else means someone wrote in between.
function checkVersion(current: number, expected: number | undefined, required: boolean): void {
  if (expected === undefined) {
    if (required) throw new ToolError("VERSION_REQUIRED");
    return;
  }
  if (expected !== current) throw new ToolError("STALE_VERSION", { current_version: current });
}

type TaskInsert = typeof tasks.$inferInsert;
type TaskPatch = { [K in keyof TaskInsert]?: TaskInsert[K] | SQL };

// Conditional UPDATE: zero rows means the version moved since it was read.
async function updateTask(tx: Q, t: Task, patch: TaskPatch, bump: boolean): Promise<Task> {
  const moved = patch.status !== undefined && patch.status !== t.status;
  const [u] = await tx
    .update(tasks)
    .set({
      ...patch,
      ...(moved ? { statusChangedAt: sql`now()` } : {}),
      ...(bump ? { version: sql`${tasks.version} + 1` } : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(tasks.id, t.id), eq(tasks.version, t.version)))
    .returning();
  if (!u) throw new ToolError("STALE_VERSION", { current_version: (await findTaskById(tx, t.id)).version });
  return u;
}

async function findTaskById(tx: Q, id: string): Promise<Task> {
  const [row] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return row!;
}

// Fields that end a lease. Clearing them is part of any move out of In progress.
const NO_LEASE = { owner: null, claimedAt: null, leaseUntil: null } as const;

// While another session holds a live lease, only its owner (or Jorge on screen) changes the task.
function checkOwner(t: Task, ctx: Ctx): void {
  const owner = liveOwner(t);
  if (owner && owner.session_id !== ctx.actor.session_id && !ctx.human) {
    throw new ToolError("NOT_OWNER", { owner, lease_until: iso(t.leaseUntil) });
  }
}

async function addNote(emit: Emit, t: Task, note: string | undefined): Promise<void> {
  if (note?.trim()) await emit("note", t, { text: note });
}

// A field that belongs to the other kind (priority on an initiative, next_action on a ticket...).
function rejectFields(kind: string, input: Record<string, unknown>, fields: string[]): void {
  for (const field of fields) {
    if (input[field] !== undefined) throw new ToolError("FIELD_NOT_ALLOWED", { field, kind });
  }
}

const TICKET_ONLY = ["parent_key", "priority", "origin", "work_type", "phase", "severity", "found_in", "introduced_by", "regression", "cost_note"];
// A ticket is born Backlog or Ready; anything else is reached through the state machine.
const CREATE_STATUSES = ["Backlog", "Ready"];
const INITIATIVE_ONLY = ["base_branch", "next_action", "in_progress_note", "integration_branch", "share_branch", "share_reason", "state_note"];

// v2 dropped the markdown body; a caller still sending it would lose notes silently, so it is an error.
function rejectBody(input: { body?: unknown }): void {
  if (input.body !== undefined) throw new ToolError("BODY_REMOVED");
}

function checkPhase(phase: number | null | undefined): void {
  if (phase !== undefined && phase !== null && (!Number.isInteger(phase) || phase < 0 || phase > 999)) {
    throw new ToolError("INVALID_PHASE");
  }
}

export type CreateInput = {
  project: string;
  key?: string;
  title: string;
  body?: string;
  scope?: string;
  checks?: string[];
  phase?: number;
  kind?: "ticket" | "initiative";
  summary?: string;
  parent_key?: string | null;
  priority?: string;
  origin?: "chartered" | "discovered";
  blocked_by?: BlockerInput[];
  status?: string;
  work_type?: string;
  base_branch?: string;
  next_action?: string;
  integration_branch?: string;
  share_branch?: boolean;
  share_reason?: string;
  areas?: string[];
  severity?: string;
  found_in?: string;
  introduced_by?: string;
  regression?: boolean;
  cost_note?: string;
  state_note?: string;
};

// A scope is the spec; status lines belong in state_note (R-16). Only a warning.
const STATUS_HEADING = /^#{1,3}\s*(estado|status)\b/im;

// Bug tickets carry a severity; debt tickets a cost note; neither field fits the other types.
function checkTyped(input: { work_type?: string; severity?: string; found_in?: string; introduced_by?: string; regression?: boolean; cost_note?: string }, workType: string) {
  const bugOnly = ["severity", "found_in", "introduced_by", "regression"] as const;
  if (workType === "bug") {
    if (!input.severity || !(SEVERITIES as readonly string[]).includes(input.severity)) throw new ToolError("INVALID_SEVERITY", { allowed: SEVERITIES });
  } else {
    for (const f of bugOnly) if (input[f] !== undefined) throw new ToolError("INVALID_SEVERITY", { field: f, hint: "bugs only" });
  }
  if (workType !== "debt" && input.cost_note !== undefined) throw new ToolError("INVALID_SEVERITY", { field: "cost_note", hint: "debt only" });
}

const normalizeAreas = (areas: string[] | undefined) => (areas ? [...new Set(areas.map((a) => a.trim()).filter(Boolean))] : undefined);

// The ticket template. Hard rules: a scope, and for code and ops at least one Done when check.
// Conventions only warn: a child without phase may be a phase that forgot to say so (bucket
// initiatives like "post-QA" have children without phases). Keys are the server's (keys.ts).
const NEEDS_CHECKS = ["code", "ops"];

function templateWarnings(input: CreateInput, kind: string): string[] {
  const missing: string[] = [];
  const warnings: string[] = [];
  if (kind === "initiative") {
    if (!input.scope?.trim()) warnings.push("no scope: an initiative's scope holds its PRD and phased plan");
    return warnings;
  }
  const workType = input.work_type ?? "code";
  if (!input.scope?.trim()) missing.push("scope");
  if (NEEDS_CHECKS.includes(workType) && !input.checks?.some((c) => c.trim())) missing.push("checks");
  if (missing.length) throw new ToolError("TEMPLATE_INVALID", { missing, work_type: workType });
  if (input.parent_key && input.phase === undefined) warnings.push("no phase: pass phase if this ticket is a phase of its initiative");
  return warnings;
}

// One create for both kinds. Initiatives start in Planning; tickets in Backlog unless told Ready.
// The key is assigned here unless the caller passed one (keys.ts).
export async function createTaskInTx(tx: Q, emit: Emit, p: Project, input: CreateInput, ctx: Ctx) {
  rejectBody(input);
  checkPhase(input.phase);
  const blockedBy = parseBlockers(input.blocked_by ?? []);
  const kind = input.kind ?? "ticket";
  const warnings = templateWarnings(input, kind);
  const status = input.status ?? (kind === "initiative" ? "Planning" : "Backlog");
  checkStatus(kind, status);
  if (kind === "initiative") {
    rejectFields(kind, input, TICKET_ONLY);
    if (status !== "Planning") throw new ToolError("INVALID_STATUS");
  } else {
    rejectFields(kind, input, INITIATIVE_ONLY);
    checkPriority(input.priority ?? "P2");
    checkWorkType(input.work_type ?? "code");
    checkTyped(input, input.work_type ?? "code");
    // create_task has no note, so it cannot satisfy "Blocked requires a note".
    if (status === "Blocked") throw new ToolError("BLOCKED_REQUIRES_NOTE");
    if (!CREATE_STATUSES.includes(status)) throw new ToolError("INVALID_STATUS");
  }
  const integrationBranch = input.integration_branch?.trim();
  if (integrationBranch) assertBranchName(p, integrationBranch);
  if (input.scope && STATUS_HEADING.test(input.scope)) warnings.push("scope has a status section: keep scope as the spec and put where things stand in state_note");

  if (input.key !== undefined && (await findTask(tx, p.id, input.key))) throw new ToolError("KEY_EXISTS");
  const parent = input.parent_key ? await resolveParent(tx, p.id, input.parent_key) : undefined;
  const assigned = await assignKey(tx, p, kind, parent, input.key);
  warnings.push(...assigned.warnings);
  const blockerIds = await resolveTaskBlockers(tx, p.id, blockedBy.keys, assigned.key);
  const common = {
    projectId: p.id,
    kind,
    key: assigned.key,
    title: input.title,
    summary: input.summary ?? "",
    scope: input.scope ?? "",
    status,
    areas: normalizeAreas(input.areas) ?? [],
  };
  const values: TaskInsert =
    kind === "initiative"
      ? {
          ...common,
          baseBranch: input.base_branch ?? "main",
          nextAction: input.next_action ?? "",
          branch: integrationBranch ?? null,
          stateNote: input.state_note ?? "",
          stateNoteAt: input.state_note ? new Date() : null,
        }
      : {
          ...common,
          parentId: parent?.id ?? null,
          priority: input.priority ?? "P2",
          workType: input.work_type ?? "code",
          phase: input.phase ?? null,
          origin: input.origin ?? (parent && IN_FLIGHT_PARENT.includes(parent.status) ? "discovered" : "chartered"),
          severity: input.severity ?? null,
          foundIn: input.found_in ?? null,
          introducedBy: input.introduced_by ?? null,
          regression: input.regression ?? null,
          costNote: input.cost_note ?? null,
        };
  let t: Task;
  try {
    [t] = (await tx.insert(tasks).values(values).returning()) as [Task];
  } catch (e) {
    if (isUniqueViolation(e)) throw new ToolError("KEY_EXISTS");
    throw e;
  }
  await replaceBlockers(tx, t.id, blockerIds, blockedBy.typed);
  await replaceChecks(tx, t.id, (input.checks ?? []).map((text) => ({ text })));
  if (integrationBranch) await registerIntegrationBranch(tx, emit, p, t, integrationBranch, input);
  await emit("task.created", t, { kind, status, parent_key: parent?.key ?? null, key_assigned: assigned.assigned });
  return writeReply(tx, t, ctx, ["created"], { kind, parent_key: parent?.key ?? null }, warnings);
}

export async function createTask(db: Db, input: CreateInput, ctx: Ctx) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, (tx, emit) => createTaskInTx(tx, emit, p, input, ctx));
}

// Field names as agents see them, for task.updated payloads.
const FIELD_NAMES: Partial<Record<keyof Task, string>> = {
  priority: "priority",
  workType: "work_type",
  parentId: "parent_key",
  branch: "branch",
  prUrl: "pr_url",
  summary: "summary",
  scope: "scope",
  phase: "phase",
  baseBranch: "base_branch",
  nextAction: "next_action",
  inProgressNote: "in_progress_note",
  stateNote: "state_note",
  areas: "areas",
  severity: "severity",
  foundIn: "found_in",
  introducedBy: "introduced_by",
  regression: "regression",
  costNote: "cost_note",
};

// Merged and Released by hand (R-12): only with proof. Merged needs a ci pass naming the merge
// commit (the PR's merge_sha when the poller knows the PR); Released needs the release target
// environment to contain that commit.
async function assertMergeEvidence(tx: Q, p: Project, t: Task, to: string): Promise<void> {
  const [pr] = await tx.select().from(pullRequests).where(eq(pullRequests.taskId, t.id)).orderBy(sql`${pullRequests.updatedAt} desc`).limit(1);
  const passes = await tx
    .select({ commit: results.commit })
    .from(results)
    .where(and(eq(results.taskId, t.id), eq(results.kind, "ci"), eq(results.verdict, "pass"), sql`${results.commit} is not null`));
  const commits = passes.map((r) => r.commit!);
  const mergeSha = pr?.mergeSha ?? null;
  const cited = mergeSha ? commits.find((c) => mergeSha.startsWith(c) || c.startsWith(mergeSha)) : commits[0];
  if (!cited) {
    throw new ToolError("EVIDENCE_REQUIRED", {
      work_type: t.workType,
      hint: mergeSha ? `a ci pass result with commit ${mergeSha.slice(0, 7)} (the PR's merge commit)` : "a ci pass result that names the merge commit",
      accepts: ["ci pass with commit"],
    });
  }
  if (to === "Released") {
    const env = p.settings.release_target ?? "prod";
    const [state] = await tx.select().from(envStates).where(and(eq(envStates.projectId, p.id), eq(envStates.env, env))).limit(1);
    const [known] = await tx
      .select({ sha: envCommits.sha })
      .from(envCommits)
      .where(and(eq(envCommits.projectId, p.id), eq(envCommits.env, env), sql`${envCommits.sha} like ${cited} || '%' or ${cited} like ${envCommits.sha} || '%'`))
      .limit(1);
    const deployed = state?.commit && (state.commit.startsWith(cited) || cited.startsWith(state.commit));
    if (!known && !deployed) throw new ToolError("EVIDENCE_REQUIRED", { hint: `${env} does not contain ${cited.slice(0, 7)} yet (set_env commits, or the deploy poller)`, env });
  }
}

export type SetTaskInput = {
  project: string;
  key: string;
  status?: string;
  priority?: string;
  parent_key?: string | null;
  blocked_by?: BlockerInput[];
  branch?: string;
  pr_url?: string;
  summary?: string;
  body?: string;
  scope?: string;
  checks?: CheckInput[];
  phase?: number | null;
  base_branch?: string;
  next_action?: string;
  in_progress_note?: string;
  work_type?: string;
  note?: string;
  version?: number;
  approval_id?: string;
  integration_branch?: string;
  share_branch?: boolean;
  share_reason?: string;
  areas?: string[];
  severity?: string;
  found_in?: string;
  introduced_by?: string;
  regression?: boolean;
  cost_note?: string;
  state_note?: string;
};

// An initiative closes only once every ticket of it is Done or Won't do (Jorge included).
async function assertChildrenClosed(tx: Q, t: Task): Promise<void> {
  const open = await tx
    .select({ key: tasks.key })
    .from(tasks)
    .where(and(eq(tasks.parentId, t.id), sql`${tasks.status} not in ('Done', 'Won''t do')`))
    .orderBy(tasks.key);
  if (open.length) throw new ToolError("INITIATIVE_CHILDREN_OPEN", { open: open.map((c) => c.key) });
}

export async function setTaskInTx(tx: Q, emit: Emit, p: Project, input: SetTaskInput, ctx: Ctx) {
  rejectBody(input);
  checkPhase(input.phase);
  const blockedBy = input.blocked_by !== undefined ? parseBlockers(input.blocked_by) : undefined;
  const { project: _p, key: _k, note: _n, version: _v, approval_id: _a, ...fields } = input;
  // A note alone is an append and needs no version; any field change does.
  const noteOnly = Object.values(fields).every((v) => v === undefined);
  const t = await requireTask(tx, p.id, input.key);
  rejectFields(t.kind, input, t.kind === "initiative" ? TICKET_ONLY : INITIATIVE_ONLY);
  // The pollers write what GitHub and the deploys say: no version to carry, no lease to respect.
  checkVersion(t.version, input.version, !noteOnly && !ctx.system);
  if (!noteOnly && !ctx.system) checkOwner(t, ctx);
  const patch: TaskPatch = {};
  let approved = false;
  const approval = input.approval_id ? await loadApproval(tx, p.id, input.approval_id) : undefined;
  const needed = input.status !== undefined ? actionForMove(t.status, input.status) : null;
  const changes: Record<string, [unknown, unknown]> = {};

  if (input.status !== undefined) {
    checkStatus(t.kind, input.status);
    if (approval && needed && approval.action !== needed) {
      throw new ToolError("APPROVAL_MISMATCH", { approval_id: approval.id, expected: { key: approval.taskKey, action: approval.action, target: approval.target } });
    }
    approved = assertTransition(t.kind, t.status, input.status, {
      human: ctx.human,
      via: ctx.system ? "system" : "set_task",
      approval: approval ? { action: approval.action } : null,
    });
    // The approval is checked (and spent) before the gates: a wrong or used one is refused first.
    if (approved && approval && needed) await useApproval(tx, emit, approval, t, needed, {}, ctx);
    if (input.status === "In review" && t.kind === "ticket" && t.status !== "In review" && !ctx.human && !ctx.system) {
      await assertReviewEvidence(tx, t, hasDoc);
    }
    // The pollers move on what GitHub and the deploys say (reality wins); the audit flags open checks.
    if ((GATED_STATUSES as readonly string[]).includes(input.status) && input.status !== t.status && !ctx.system) await assertChecksClosed(tx, t);
    if ((input.status === "Merged" || input.status === "Released") && input.status !== t.status && !ctx.human && !ctx.system) await assertMergeEvidence(tx, p, t, input.status);
    if (t.kind === "initiative" && (TERMINAL as readonly string[]).includes(input.status) && input.status !== t.status) {
      await assertChildrenClosed(tx, t);
    }
    if (input.status === "Blocked") {
      if (!input.note?.trim()) throw new ToolError("BLOCKED_REQUIRES_NOTE");
      patch.blockedNote = input.note;
    } else {
      // The note only means something while the task is Blocked.
      patch.blockedNote = null;
    }
    // Re-marking Done keeps the first timestamp.
    patch.resolvedAt = input.status === "Done" ? (t.resolvedAt ?? new Date()) : null;
    patch.status = input.status;
    if (t.owner && input.status !== t.status) Object.assign(patch, NO_LEASE);
  }

  if (input.priority !== undefined) {
    checkPriority(input.priority);
    patch.priority = input.priority;
  }
  if (input.work_type !== undefined) {
    checkWorkType(input.work_type);
    patch.workType = input.work_type;
  }
  if (t.kind === "ticket") {
    const workType = input.work_type ?? t.workType ?? "code";
    const typed = { severity: input.severity, found_in: input.found_in, introduced_by: input.introduced_by, regression: input.regression, cost_note: input.cost_note };
    if (Object.values(typed).some((v) => v !== undefined) || (input.work_type !== undefined && input.work_type !== t.workType)) {
      checkTyped({ ...typed, severity: input.severity ?? (workType === "bug" ? (t.severity ?? undefined) : undefined) }, workType);
    }
    if (input.severity !== undefined) patch.severity = input.severity;
    if (input.found_in !== undefined) patch.foundIn = input.found_in;
    if (input.introduced_by !== undefined) patch.introducedBy = input.introduced_by;
    if (input.regression !== undefined) patch.regression = input.regression;
    if (input.cost_note !== undefined) patch.costNote = input.cost_note;
  }
  const areas = normalizeAreas(input.areas);
  if (areas !== undefined) patch.areas = areas;
  // An initiative's integration branch is its `branch`; registering it enforces the naming rule and ownership.
  const integrationBranch = t.kind === "initiative" ? (input.integration_branch ?? input.branch)?.trim() : undefined;
  if (integrationBranch !== undefined) {
    await registerIntegrationBranch(tx, emit, p, t, integrationBranch, input);
    patch.branch = integrationBranch;
  }
  if (t.kind === "ticket" && input.branch !== undefined && input.branch.trim()) await assertTicketBranch(tx, p, t, input.branch.trim());

  // Moving under another initiative (or out to standalone) gives the ticket a key under its new
  // parent; the old key stays as an alias so every reference keeps resolving.
  let parentKeys: [string | null, string | null] | undefined;
  let rekey: [string, string] | undefined;
  if (input.parent_key !== undefined) {
    const [old] = t.parentId ? await tx.select({ key: tasks.key }).from(tasks).where(eq(tasks.id, t.parentId)) : [];
    const newParent = input.parent_key === null ? undefined : await resolveParent(tx, p.id, input.parent_key);
    const newParentId = newParent?.id ?? null;
    if (newParentId !== t.parentId) {
      patch.parentId = newParentId;
      parentKeys = [old?.key ?? null, newParent?.key ?? null];
      const assigned = await assignKey(tx, p, "ticket", newParent, undefined);
      patch.key = assigned.key;
      rekey = [t.key, assigned.key];
    }
  }

  const blockerIds = blockedBy ? await resolveTaskBlockers(tx, p.id, blockedBy.keys, t.key) : undefined;

  if (input.branch !== undefined && t.kind === "ticket") patch.branch = input.branch;
  if (input.pr_url !== undefined) patch.prUrl = input.pr_url;
  if (input.summary !== undefined) patch.summary = input.summary;
  if (input.scope !== undefined) patch.scope = input.scope;
  if (input.phase !== undefined) patch.phase = input.phase;
  if (input.base_branch !== undefined) patch.baseBranch = input.base_branch;
  if (input.next_action !== undefined) patch.nextAction = input.next_action;
  if (input.in_progress_note !== undefined) patch.inProgressNote = input.in_progress_note;
  if (input.state_note !== undefined) {
    patch.stateNote = input.state_note;
    patch.stateNoteAt = input.state_note.trim() ? new Date() : null;
  }
  const warnings: string[] = [];
  if (input.scope && STATUS_HEADING.test(input.scope)) warnings.push("scope has a status section: keep scope as the spec and put where things stand in state_note");

  for (const [field, name] of Object.entries(FIELD_NAMES) as [keyof Task, string][]) {
    const before = t[field];
    const after = patch[field as keyof TaskPatch];
    if (!(field in patch)) continue;
    if (Array.isArray(before) && Array.isArray(after) ? JSON.stringify(before) === JSON.stringify(after) : after === before) continue;
    changes[name] = field === "parentId" ? parentKeys! : [before, after];
  }

  const u = await updateTask(tx, t, patch, !noteOnly);
  if (rekey) await addAlias(tx, p.id, t.id, rekey[0]);
  if (blockedBy && blockerIds) {
    await replaceBlockers(tx, t.id, blockerIds, blockedBy.typed);
    changes.blocked_by = [null, [...blockedBy.keys.sort(), ...blockedBy.typed]];
  }
  if (input.checks !== undefined) {
    const changed = await replaceChecks(tx, t.id, input.checks);
    if (changed) changes.checks = changed;
  }

  const changedNames: string[] = [];
  if (patch.status !== undefined && patch.status !== t.status) {
    changedNames.push("status");
    await emit("task.status", u, { from: t.status, to: patch.status, ...(patch.blockedNote ? { note: patch.blockedNote } : {}) });
    if (approved && approval) await emit("task.approved_move", u, { from: t.status, to: patch.status, approval_id: approval.id });
    if (t.owner) {
      changedNames.push("claim");
      await emit("claim.released", u, { owner: t.owner, reason: "status" });
    }
    // The headline talks about where things stand; an initiative moving or a ticket closing dates it.
    if (t.kind === "initiative" || patch.status === "Done") await markHeadlineStale(tx, p.id);
    // An initiative check derived from this ticket ticks itself when the ticket is Done.
    if (patch.status === "Done" && t.kind === "ticket") await tickDerived(tx, emit, u, ctx.actor);
    // A ticket reaching In review or later may be what a Blocked ticket waited for.
    await promoteUnblocked(tx, emit, p.id);
  }
  if (rekey) {
    changedNames.push("key");
    await emit("task.rekeyed", u, { from: rekey[0], to: rekey[1], reason: "moved" });
  }
  if (Object.keys(changes).length) {
    changedNames.push(...Object.keys(changes));
    await emit("task.updated", u, { changes });
  }
  if (input.status !== "Blocked" && input.note?.trim()) {
    changedNames.push("note");
    await addNote(emit, u, input.note);
  }
  // Blocked with blockers that already hold goes straight back to Ready.
  if (patch.status === "Blocked") await promoteUnblocked(tx, emit, p.id);
  return writeReply(tx, u, ctx, changedNames, rekey ? { previous_key: rekey[0] } : {}, warnings);
}

// R-06: hand a claim to another session (or "open" to anyone) with what is done, what is next and the
// branch head. The receiver claims within ten minutes; meanwhile nobody else may. After that, open to all.
export const HANDOFF_HOLD_MIN = 10;

export async function handoff(
  db: Db,
  input: { project: string; key: string; to: string; note: string; head_sha?: string },
  ctx: Ctx,
) {
  if (!input.note.trim()) throw new ToolError("INVALID_QUESTION", { field: "note", hint: "say what is done, what is next and the branch head" });
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const t = await requireTask(tx, p.id, input.key);
    const owner = liveOwner(t);
    if (owner && owner.session_id !== ctx.actor.session_id && !ctx.human) throw new ToolError("NOT_OWNER", { owner, lease_until: iso(t.leaseUntil) });
    const until = new Date(Date.now() + HANDOFF_HOLD_MIN * 60_000);
    const record = { to: input.to.trim() || "open", note: input.note.trim(), ...(input.head_sha ? { head_sha: input.head_sha } : {}), from: ctx.actor, at: new Date().toISOString(), until: until.toISOString() };
    const to = t.status === "In progress" ? "Ready" : t.status;
    const u = await updateTask(tx, t, { ...NO_LEASE, status: to, handoff: record }, true);
    await emit("claim.handoff", u, { ...record, from_status: t.status });
    return writeReply(tx, u, ctx, ["claim", "handoff", ...(to !== t.status ? ["status"] : [])], { handoff: record });
  });
}

export async function setTask(db: Db, input: SetTaskInput, ctx: Ctx) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, (tx, emit) => setTaskInTx(tx, emit, p, input, ctx));
}

// CI reports where a ticket's code is: pr_url and branch. Trusted and commutative with agent edits,
// so it needs no version and no lease; it bumps the version so readers notice.
export async function setTaskLinks(
  db: Db,
  input: { project: string; key: string; pr_url?: string; branch?: string },
  ctx: Ctx,
) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const t = await requireTask(tx, p.id, input.key);
    const patch: TaskPatch = {};
    const changes: Record<string, [unknown, unknown]> = {};
    if (input.pr_url !== undefined && input.pr_url !== t.prUrl) {
      patch.prUrl = input.pr_url;
      changes.pr_url = [t.prUrl, input.pr_url];
    }
    if (input.branch !== undefined && input.branch !== t.branch) {
      patch.branch = input.branch;
      changes.branch = [t.branch, input.branch];
    }
    if (!Object.keys(changes).length) return writeReply(tx, t, ctx, []);
    const u = await updateTask(tx, t, patch, true);
    await emit("task.updated", u, { changes });
    return writeReply(tx, u, ctx, Object.keys(changes));
  });
}

const CLAIMABLE_FROM = ["Backlog", "Ready", "In progress", "In review", "Blocked"];

// Two path globs overlap when one's fixed prefix (up to its first wildcard) starts the other's.
export function areasOverlap(a: string, b: string): boolean {
  const prefix = (g: string) => g.split(/[*?[{]/)[0]!.replace(/\/+$/, "");
  const pa = prefix(a);
  const pb = prefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}
export const TTL = { default: 30, min: 5, max: 240 } as const;

function ttlMinutes(ttl: number | undefined): number {
  const m = ttl ?? TTL.default;
  if (!Number.isInteger(m) || m < TTL.min || m > TTL.max) throw new ToolError("INVALID_TTL", { min: TTL.min, max: TTL.max });
  return m;
}

const leaseEnd = (minutes: number) => sql`now() + make_interval(mins => ${minutes})`;

export type ClaimInput = {
  project: string;
  key: string;
  action?: "claim" | "heartbeat" | "release";
  ttl_minutes?: number;
  workspace?: Workspace;
  release_to?: "Ready" | "Backlog";
};

// claim: take the ticket (In progress) for ttl minutes; claiming it again from the same session extends it.
// heartbeat: extend your lease. release: give it back (In progress goes to release_to, default Ready).
export async function claimInTx(tx: Q, emit: Emit, p: Project, input: ClaimInput, ctx: Ctx) {
  const action = input.action ?? "claim";
  const minutes = ttlMinutes(input.ttl_minutes);
  const t = await requireTask(tx, p.id, input.key);
  if (t.kind !== "ticket") throw new ToolError("NOT_CLAIMABLE", { reason: "initiatives are not claimed" });
  const owner = liveOwner(t);
  const mine = owner?.session_id === ctx.actor.session_id;
  const held = () => new ToolError("CLAIM_HELD", { owner, lease_until: iso(t.leaseUntil), workspace: t.workspace });
  let workspace = input.workspace ? { machine: ctx.actor.machine, ...input.workspace } : undefined;
  const warnings: string[] = [];
  const reply = (u: Task, changed: string[]) => writeReply(tx, u, ctx, changed, { claim: claimShape(u), workspace: u.workspace }, warnings);

  if (action === "release") {
    if (!t.owner) return reply(t, []); // nothing held: releasing again is a no-op
    if (!mine && !ctx.human) throw new ToolError("NOT_OWNER", { owner, lease_until: iso(t.leaseUntil) });
    const to = t.status === "In progress" ? (input.release_to ?? "Ready") : t.status;
    const u = await updateTask(tx, t, { ...NO_LEASE, status: to }, true);
    await emit("claim.released", u, { owner: t.owner, from: t.status, to });
    return reply(u, to !== t.status ? ["claim", "status"] : ["claim"]);
  }

  if (owner && !mine) throw held();

  if (mine) {
    // Heartbeat, or a repeated claim: extend the lease without bumping the version.
    const [u] = await tx
      .update(tasks)
      .set({ leaseUntil: leaseEnd(minutes), lastSeenAt: sql`now()`, expiringWarnedAt: null, ...(workspace ? { workspace } : {}) })
      .where(eq(tasks.id, t.id))
      .returning();
    if (workspace) await emit("claim.workspace", u!, { workspace });
    return reply(u!, workspace ? ["claim", "workspace"] : ["claim"]);
  }

  if (action === "heartbeat") throw new ToolError("LEASE_EXPIRED", { hint: "claim again" });
  if (!CLAIMABLE_FROM.includes(t.status)) throw new ToolError("NOT_CLAIMABLE", { status: t.status });
  // A handoff holds the ticket for its receiver for a while; the receiver gets the note back.
  const hold = t.handoff && new Date(t.handoff.until) > new Date() ? t.handoff : null;
  if (hold && hold.to !== "open" && hold.to !== ctx.actor.session_id && !ctx.human) {
    throw new ToolError("HANDOFF_HELD", { to: hold.to, until: hold.until, note: hold.note });
  }
  if (t.handoff) warnings.push(`handoff from ${t.handoff.from.agent} (${t.handoff.from.session_id}): ${t.handoff.note}`);
  const blockers = await unsatisfiedBlockers(tx, t);
  if (blockers.length) throw new ToolError("NOT_CLAIMABLE", { blocked_by: blockers });
  // A phase works on its initiative's integration branch unless told otherwise (R-09).
  const parent = t.parentId ? (await tx.select().from(tasks).where(eq(tasks.id, t.parentId)).limit(1))[0] : undefined;
  if (workspace && !workspace.branch && parent?.branch) workspace = { ...workspace, branch: parent.branch };
  if (!workspace && parent?.branch) workspace = { machine: ctx.actor.machine, branch: parent.branch };
  if (workspace?.branch) await assertTicketBranch(tx, p, t, workspace.branch);
  // Other live claims on overlapping code areas are a warning, never a block (R-11).
  if (t.areas.length) {
    const live = await tx
      .select({ key: tasks.key, areas: tasks.areas, owner: tasks.owner })
      .from(tasks)
      .where(and(eq(tasks.projectId, p.id), sql`${tasks.leaseUntil} > now()`, sql`${tasks.id} <> ${t.id}`));
    for (const other of live) {
      const overlap = other.areas.filter((a) => t.areas.some((b) => areasOverlap(a, b)));
      if (overlap.length) warnings.push(`${other.key} (${other.owner?.agent ?? "?"}) also works on ${overlap.join(", ")}`);
    }
  }

  const u = await updateTask(
    tx,
    t,
    {
      owner: ctx.actor,
      claimedAt: sql`now()`,
      leaseUntil: leaseEnd(minutes),
      lastSeenAt: sql`now()`,
      status: "In progress",
      blockedNote: null,
      expiringWarnedAt: null,
      handoff: null,
      ...(workspace ? { workspace } : {}),
    },
    true,
  );
  await emit("claim.acquired", u, { from: t.status, ttl_minutes: minutes, lease_until: iso(u.leaseUntil), workspace: u.workspace, ...(t.handoff ? { handoff: t.handoff } : {}) });
  return writeReply(tx, u, ctx, ["claim", "status"], { claim: claimShape(u), workspace: u.workspace, ...(t.handoff ? { handoff: t.handoff } : {}) }, warnings);
}

export async function claim(db: Db, input: ClaimInput, ctx: Ctx) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, (tx, emit) => claimInTx(tx, emit, p, input, ctx));
}
