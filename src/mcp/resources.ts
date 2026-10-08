import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { quotaUsage, resources, type Project } from "../db/schema.js";
import { loadApproval, useApproval } from "./approvals.js";
import { ToolError } from "./errors.js";
import { findProject } from "./queries.js";
import { iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// Shared resources (R-10): a lease on a name (port:3001@MacBook-Air, neon-prod:migrate) that one
// session holds at a time, and daily quotas (quota:omdb) counted with consume. Policies live in
// projects.settings.resources (needs_approval, ttl_max) and settings.quotas ({daily}).

const NAME = /^[a-z][a-z0-9:_./-]{0,79}(@[A-Za-z0-9._-]{1,60})?$/;
const TTL = { default: 30, min: 1, max: 24 * 60 };

type ResourceRow = typeof resources.$inferSelect;

function resourceShape(r: ResourceRow) {
  return { name: r.name, holder: r.holder, purpose: r.purpose, lease_until: iso(r.leaseUntil), approval_id: r.approvalId, since: iso(r.createdAt) };
}

// settings.resources keys are globs: "port:*", "neon-prod:*", "quota:omdb".
function policyFor(p: Project, name: string) {
  for (const [glob, policy] of Object.entries(p.settings.resources ?? {})) {
    const re = new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    if (re.test(name)) return policy;
  }
  return undefined;
}

// The full name: a name without @machine gets the caller's machine, so ports are per machine.
function fullName(name: string, ctx: Ctx): string {
  const trimmed = name.trim();
  if (!NAME.test(trimmed)) throw new ToolError("INVALID_RESOURCE", { field: "name", hint: "e.g. port:3001 or neon-prod:migrate" });
  if (trimmed.includes("@") || !ctx.actor.machine) return trimmed;
  return `${trimmed}@${ctx.actor.machine}`;
}

export async function reapExpiredResources(tx: Q, emit: Emit, projectId: string): Promise<void> {
  const expired = await tx
    .delete(resources)
    .where(and(eq(resources.projectId, projectId), sql`${resources.leaseUntil} < now()`))
    .returning();
  for (const r of expired) await emit("resource.expired", null, { name: r.name, holder: r.holder });
}

export async function leaseResource(
  db: Db,
  input: { project: string; name: string; ttl_minutes?: number; purpose?: string; approval_id?: string },
  ctx: Ctx,
) {
  const minutes = input.ttl_minutes ?? TTL.default;
  if (!Number.isInteger(minutes) || minutes < TTL.min || minutes > TTL.max) throw new ToolError("INVALID_RESOURCE", { field: "ttl_minutes", min: TTL.min, max: TTL.max });
  const p = await findProject(db, input.project);
  const name = fullName(input.name, ctx);
  const policy = policyFor(p, name);
  if (policy?.ttl_max && minutes > policy.ttl_max) throw new ToolError("INVALID_RESOURCE", { field: "ttl_minutes", max: policy.ttl_max });
  return writeTx(db, p, ctx, async (tx, emit) => {
    await reapExpiredResources(tx, emit, p.id);
    const [held] = await tx.select().from(resources).where(and(eq(resources.projectId, p.id), eq(resources.name, name))).limit(1);
    if (held && held.holder.session_id !== ctx.actor.session_id) {
      throw new ToolError("RESOURCE_HELD", { name, holder: held.holder, lease_until: iso(held.leaseUntil), purpose: held.purpose });
    }
    let approvalId: string | null = held?.approvalId ?? null;
    if (policy?.needs_approval && !held) {
      if (!input.approval_id) throw new ToolError("APPROVAL_REQUIRED", { action: "lease_resource", target: { name } });
      const a = await loadApproval(tx, p.id, input.approval_id);
      // Resource approvals hang off the project: a task-less approval with target {name}.
      if (a.taskId || a.action !== "lease_resource" || (a.target as { name?: string }).name !== name) {
        throw new ToolError("APPROVAL_MISMATCH", { approval_id: a.id, expected: { action: "lease_resource", target: { name } } });
      }
      await useApproval(tx, emit, a, { id: a.taskId ?? "", key: a.taskKey ?? "" } as never, "lease_resource", { name }, ctx);
      approvalId = a.id;
    }
    const [r] = await tx
      .insert(resources)
      .values({ projectId: p.id, name, holder: ctx.actor, purpose: input.purpose?.trim() ?? "", leaseUntil: sql`now() + make_interval(mins => ${minutes})`, approvalId })
      .onConflictDoUpdate({
        target: [resources.projectId, resources.name],
        set: { leaseUntil: sql`now() + make_interval(mins => ${minutes})`, purpose: input.purpose?.trim() ?? held?.purpose ?? "", holder: ctx.actor },
      })
      .returning();
    await emit(held ? "resource.extended" : "resource.leased", null, { name, purpose: r!.purpose, lease_until: iso(r!.leaseUntil), minutes });
    return { resource: resourceShape(r!), extended: !!held };
  });
}

export async function releaseResource(db: Db, input: { project: string; name: string }, ctx: Ctx) {
  const p = await findProject(db, input.project);
  const name = fullName(input.name, ctx);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const [held] = await tx.select().from(resources).where(and(eq(resources.projectId, p.id), eq(resources.name, name))).limit(1);
    if (!held) return { name, released: false };
    if (held.holder.session_id !== ctx.actor.session_id && !ctx.human) {
      throw new ToolError("RESOURCE_HELD", { name, holder: held.holder, lease_until: iso(held.leaseUntil), purpose: held.purpose });
    }
    await tx.delete(resources).where(and(eq(resources.projectId, p.id), eq(resources.name, name)));
    await emit("resource.released", null, { name, holder: held.holder });
    return { name, released: true };
  });
}

// Counts n against today's (UTC) budget for a quota from settings.quotas.
export async function consume(db: Db, input: { project: string; name: string; n?: number }, ctx: Ctx) {
  const n = input.n ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) throw new ToolError("INVALID_RESOURCE", { field: "n" });
  const p = await findProject(db, input.project);
  const name = input.name.trim();
  const quota = p.settings.quotas?.[name];
  if (!quota) throw new ToolError("INVALID_RESOURCE", { field: "name", hint: "no such quota in settings.quotas", known: Object.keys(p.settings.quotas ?? {}) });
  return writeTx(db, p, ctx, async (tx, emit) => {
    const day = new Date().toISOString().slice(0, 10);
    const [row] = await tx
      .select({ used: quotaUsage.used })
      .from(quotaUsage)
      .where(and(eq(quotaUsage.projectId, p.id), eq(quotaUsage.name, name), eq(quotaUsage.day, day)));
    const used = row?.used ?? 0;
    if (used + n > quota.daily) throw new ToolError("QUOTA_EXCEEDED", { name, limit: quota.daily, used, remaining: Math.max(0, quota.daily - used), day });
    await tx
      .insert(quotaUsage)
      .values({ projectId: p.id, name, day, used: n })
      .onConflictDoUpdate({ target: [quotaUsage.projectId, quotaUsage.name, quotaUsage.day], set: { used: sql`${quotaUsage.used} + ${n}` } });
    await emit("quota.consumed", null, { name, n, used: used + n, limit: quota.daily, day });
    return { name, used: used + n, limit: quota.daily, remaining: quota.daily - used - n, day };
  });
}

// get_project.resources: live leases and today's quota usage.
export async function projectResources(db: Q, p: Project) {
  const leases = await db
    .select()
    .from(resources)
    .where(and(eq(resources.projectId, p.id), sql`${resources.leaseUntil} > now()`))
    .orderBy(asc(resources.name));
  const day = new Date().toISOString().slice(0, 10);
  const usage = await db.select().from(quotaUsage).where(and(eq(quotaUsage.projectId, p.id), eq(quotaUsage.day, day)));
  const quotas = Object.fromEntries(
    Object.entries(p.settings.quotas ?? {}).map(([name, q]) => {
      const used = usage.find((u) => u.name === name)?.used ?? 0;
      return [name, { limit: q.daily, used, remaining: Math.max(0, q.daily - used), day }];
    }),
  );
  return { leases: leases.map(resourceShape), quotas };
}
