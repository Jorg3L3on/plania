import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { branches, tasks, type Project, type Task } from "../db/schema.js";
import { ToolError } from "./errors.js";
import { iso, type Emit, type Q } from "./tx.js";

// Branch registry (R-09). An initiative's integration branch (its `branch` column) is registered to
// it; its phases claim on it by default. A branch owned by another live initiative is BRANCH_IN_USE
// unless shared with a reason. The project's branch_pattern (settings) is enforced on every name.
// The GitHub poller fills head_sha, merged_at and deleted_at.

const CLOSED = ["Done", "Won't do"];

export function assertBranchName(p: Pick<Project, "settings">, name: string): void {
  const pattern = p.settings.branch_pattern;
  if (!pattern) return;
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return; // a broken pattern never blocks work
  }
  if (!re.test(name)) throw new ToolError("BRANCH_NAME_INVALID", { branch: name, pattern });
}

type BranchRow = typeof branches.$inferSelect;

async function findBranch(tx: Q, projectId: string, name: string): Promise<BranchRow | undefined> {
  const [b] = await tx.select().from(branches).where(and(eq(branches.projectId, projectId), eq(branches.name, name))).limit(1);
  return b;
}

// The live initiative that owns a branch, if any.
async function liveOwner(tx: Q, b: BranchRow): Promise<Task | undefined> {
  if (!b.ownerTaskId) return undefined;
  const [t] = await tx.select().from(tasks).where(eq(tasks.id, b.ownerTaskId)).limit(1);
  return t && t.kind === "initiative" && !CLOSED.includes(t.status) ? t : undefined;
}

// Registers a branch to an initiative (its integration branch). Another live initiative owning it
// is BRANCH_IN_USE unless share_branch says so.
export async function registerIntegrationBranch(
  tx: Q,
  emit: Emit,
  p: Project,
  initiative: Task,
  name: string,
  share: { share_branch?: boolean; share_reason?: string },
): Promise<void> {
  assertBranchName(p, name);
  const existing = await findBranch(tx, p.id, name);
  const owner = existing ? await liveOwner(tx, existing) : undefined;
  if (owner && owner.id !== initiative.id) {
    const reason = share.share_reason?.trim();
    if (!share.share_branch || !reason) {
      throw new ToolError("BRANCH_IN_USE", { branch: name, owner_key: owner.key, hint: "share_branch: true with share_reason to build on it together" });
    }
    await tx
      .update(branches)
      .set({ shared: true, shareReason: reason, updatedAt: sql`now()` })
      .where(and(eq(branches.projectId, p.id), eq(branches.name, name)));
    await emit("branch.shared", initiative, { branch: name, owner_key: owner.key, reason });
    return;
  }
  await tx
    .insert(branches)
    .values({ projectId: p.id, name, ownerTaskId: initiative.id })
    .onConflictDoUpdate({ target: [branches.projectId, branches.name], set: { ownerTaskId: initiative.id, updatedAt: sql`now()` } });
  if (!existing || existing.ownerTaskId !== initiative.id) await emit("branch.registered", initiative, { branch: name });
}

// A ticket working on a branch: fine on its own initiative's branch (owned or shared into it), or on
// a branch nobody owns; BRANCH_IN_USE on another initiative's.
export async function assertTicketBranch(tx: Q, p: Project, t: Task, name: string): Promise<void> {
  assertBranchName(p, name);
  const existing = await findBranch(tx, p.id, name);
  if (!existing) {
    await tx.insert(branches).values({ projectId: p.id, name, ownerTaskId: null }).onConflictDoNothing();
    return;
  }
  const owner = await liveOwner(tx, existing);
  if (!owner || owner.id === t.parentId) return;
  const [parent] = t.parentId ? await tx.select({ branch: tasks.branch }).from(tasks).where(eq(tasks.id, t.parentId)).limit(1) : [];
  if (parent?.branch === name) return; // the initiative shares it
  throw new ToolError("BRANCH_IN_USE", { branch: name, owner_key: owner.key, hint: "work on your initiative's branch, or have it share this one" });
}

export function branchShape(b: BranchRow, ownerKey: string | null) {
  return {
    name: b.name,
    owner_key: ownerKey,
    shared: b.shared,
    share_reason: b.shareReason,
    head_sha: b.headSha,
    head_at: iso(b.headAt),
    merged_at: iso(b.mergedAt),
    deleted_at: iso(b.deletedAt),
    pr_number: b.prNumber,
  };
}

// get_project.branches: every branch with its owner and what the poller knows.
export async function projectBranches(db: Q, projectId: string) {
  const rows = await db
    .select({ b: branches, ownerKey: tasks.key })
    .from(branches)
    .leftJoin(tasks, eq(tasks.id, branches.ownerTaskId))
    .where(and(eq(branches.projectId, projectId), isNull(branches.deletedAt)))
    .orderBy(asc(branches.name));
  return rows.map((r) => branchShape(r.b, r.ownerKey));
}

// The head the poller last saw for a branch, or null.
export async function branchHead(db: Q, projectId: string, name: string): Promise<string | null> {
  const b = await findBranch(db, projectId, name);
  return b?.headSha ?? null;
}

// The poller reports a head, a merge or a deletion.
export async function touchBranch(
  tx: Q,
  projectId: string,
  name: string,
  patch: { headSha?: string; headAt?: Date; mergedAt?: Date | null; deletedAt?: Date | null; prNumber?: number },
): Promise<void> {
  await tx
    .insert(branches)
    .values({ projectId, name, ...patch })
    .onConflictDoUpdate({ target: [branches.projectId, branches.name], set: { ...patch, updatedAt: sql`now()` } });
}
