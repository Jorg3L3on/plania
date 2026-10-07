import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  INITIATIVE_STATUSES,
  PRIORITIES,
  TICKET_STATUSES,
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
import { parseBlockers, replaceBlockers, resolveTaskBlockers, unsatisfiedBlockers, type BlockerInput } from "./blockers.js";
import { replaceChecks, type CheckInput } from "./checks.js";
import { hasDoc } from "./docs.js";
import { assertReviewEvidence } from "./evidence.js";
import { addAlias, assignKey } from "./keys.js";
import { WORK_TYPES, assertTransition, type Override } from "./lifecycle.js";
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
  const [u] = await tx
    .update(tasks)
    .set({ ...patch, ...(bump ? { version: sql`${tasks.version} + 1` } : {}), updatedAt: sql`now()` })
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

const TICKET_ONLY = ["parent_key", "priority", "origin", "work_type", "phase"];
// A ticket is born Backlog or Ready; anything else is reached through the state machine.
const CREATE_STATUSES = ["Backlog", "Ready"];
const INITIATIVE_ONLY = ["base_branch", "next_action", "in_progress_note"];

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
};

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
    // create_task has no note, so it cannot satisfy "Blocked requires a note".
    if (status === "Blocked") throw new ToolError("BLOCKED_REQUIRES_NOTE");
    if (!CREATE_STATUSES.includes(status)) throw new ToolError("INVALID_STATUS");
  }

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
  };
  const values: TaskInsert =
    kind === "initiative"
      ? { ...common, baseBranch: input.base_branch ?? "main", nextAction: input.next_action ?? "" }
      : {
          ...common,
          parentId: parent?.id ?? null,
          priority: input.priority ?? "P2",
          workType: input.work_type ?? "code",
          phase: input.phase ?? null,
          origin: input.origin ?? (parent && IN_FLIGHT_PARENT.includes(parent.status) ? "discovered" : "chartered"),
        };
  let t: Task;
  try {
    [t] = (await tx.insert(tasks).values(values).returning()) as [Task];
  } catch (e) {
    if (isUniqueViolation(e)) throw new ToolError("KEY_EXISTS");
    throw e;
  }
  await replaceBlockers(tx, t.id, blockerIds, blockedBy.env);
  await replaceChecks(tx, t.id, (input.checks ?? []).map((text) => ({ text })));
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
};

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
} & Override;

export async function setTaskInTx(tx: Q, emit: Emit, p: Project, input: SetTaskInput, ctx: Ctx) {
  rejectBody(input);
  checkPhase(input.phase);
  const blockedBy = input.blocked_by !== undefined ? parseBlockers(input.blocked_by) : undefined;
  const { project: _p, key: _k, note: _n, version: _v, confirm_by_jorge: _c, reason: _r, ...fields } = input;
  // A note alone is an append and needs no version; any field change does.
  const noteOnly = Object.values(fields).every((v) => v === undefined);
  const t = await requireTask(tx, p.id, input.key);
  rejectFields(t.kind, input, t.kind === "initiative" ? TICKET_ONLY : INITIATIVE_ONLY);
  checkVersion(t.version, input.version, !noteOnly);
  if (!noteOnly) checkOwner(t, ctx);
  const patch: TaskPatch = {};
  let overridden = false;
  const changes: Record<string, [unknown, unknown]> = {};

  if (input.status !== undefined) {
    checkStatus(t.kind, input.status);
    overridden = assertTransition(t.kind, t.status, input.status, {
      human: ctx.human,
      via: "set_task",
      override: { confirm_by_jorge: input.confirm_by_jorge, reason: input.reason },
    });
    if (input.status === "In review" && t.kind === "ticket" && t.status !== "In review" && !ctx.human) {
      await assertReviewEvidence(tx, t, hasDoc);
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

  if (input.branch !== undefined) patch.branch = input.branch;
  if (input.pr_url !== undefined) patch.prUrl = input.pr_url;
  if (input.summary !== undefined) patch.summary = input.summary;
  if (input.scope !== undefined) patch.scope = input.scope;
  if (input.phase !== undefined) patch.phase = input.phase;
  if (input.base_branch !== undefined) patch.baseBranch = input.base_branch;
  if (input.next_action !== undefined) patch.nextAction = input.next_action;
  if (input.in_progress_note !== undefined) patch.inProgressNote = input.in_progress_note;

  for (const [field, name] of Object.entries(FIELD_NAMES) as [keyof Task, string][]) {
    if (!(field in patch) || patch[field as keyof TaskPatch] === t[field]) continue;
    changes[name] = field === "parentId" ? parentKeys! : [t[field], patch[field as keyof TaskPatch]];
  }

  const u = await updateTask(tx, t, patch, !noteOnly);
  if (rekey) await addAlias(tx, p.id, t.id, rekey[0]);
  if (blockedBy && blockerIds) {
    await replaceBlockers(tx, t.id, blockerIds, blockedBy.env);
    changes.blocked_by = [null, [...blockedBy.keys.sort(), ...blockedBy.env]];
  }
  if (input.checks !== undefined) {
    const changed = await replaceChecks(tx, t.id, input.checks);
    if (changed) changes.checks = changed;
  }

  const changedNames: string[] = [];
  if (patch.status !== undefined && patch.status !== t.status) {
    changedNames.push("status");
    await emit("task.status", u, { from: t.status, to: patch.status, ...(patch.blockedNote ? { note: patch.blockedNote } : {}) });
    if (overridden) await emit("task.human_override", u, { from: t.status, to: patch.status, reason: input.reason });
    if (t.owner) {
      changedNames.push("claim");
      await emit("claim.released", u, { owner: t.owner, reason: "status" });
    }
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
  return writeReply(tx, u, ctx, changedNames, rekey ? { previous_key: rekey[0] } : {});
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
  const workspace = input.workspace ? { machine: ctx.actor.machine, ...input.workspace } : undefined;
  const reply = (u: Task, changed: string[]) => writeReply(tx, u, ctx, changed, { claim: claimShape(u), workspace: u.workspace });

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
      .set({ leaseUntil: leaseEnd(minutes), lastSeenAt: sql`now()`, ...(workspace ? { workspace } : {}) })
      .where(eq(tasks.id, t.id))
      .returning();
    if (workspace) await emit("claim.workspace", u!, { workspace });
    return reply(u!, workspace ? ["claim", "workspace"] : ["claim"]);
  }

  if (action === "heartbeat") throw new ToolError("LEASE_EXPIRED", { hint: "claim again" });
  if (!CLAIMABLE_FROM.includes(t.status)) throw new ToolError("NOT_CLAIMABLE", { status: t.status });
  const blockers = await unsatisfiedBlockers(tx, t);
  if (blockers.length) throw new ToolError("NOT_CLAIMABLE", { blocked_by: blockers });

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
      ...(workspace ? { workspace } : {}),
    },
    true,
  );
  await emit("claim.acquired", u, { from: t.status, ttl_minutes: minutes, lease_until: iso(u.leaseUntil), workspace: u.workspace });
  return reply(u, ["claim", "status"]);
}

export async function claim(db: Db, input: ClaimInput, ctx: Ctx) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, (tx, emit) => claimInTx(tx, emit, p, input, ctx));
}
