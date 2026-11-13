import type { Db } from "../db/client.js";
import type { resources, Project } from "../db/schema.js";
import { readerOf, uowOf } from "../store/pg.js";
import { LEGACY_APPROVAL_HINT } from "./delegate.js";
import { ToolError } from "./errors.js";
import { findProject } from "./queries.js";
import { iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// Shared resources (R-10): a lease on a name (port:3001@MacBook-Air, neon-prod:migrate) that one
// session holds at a time, and daily quotas (quota:omdb) counted with consume. Policies live in
// projects.settings.resources (ttl_max) and settings.quotas ({daily}). A needs_approval flag is ignored.

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
  const uow = uowOf(tx);
  for (const r of await uow.find("resources", { projectId })) {
    if (r.leaseUntil >= uow.now) continue;
    await uow.delete("resources", { projectId, name: r.name });
    await emit("resource.expired", null, { name: r.name, holder: r.holder });
  }
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
    const uow = uowOf(tx);
    const held = await uow.get("resources", { projectId: p.id, name });
    if (held && held.holder.session_id !== ctx.actor.session_id) {
      throw new ToolError("RESOURCE_HELD", { name, holder: held.holder, lease_until: iso(held.leaseUntil), purpose: held.purpose });
    }
    const leaseUntil = new Date(uow.now.getTime() + minutes * 60_000);
    const r = held
      ? (await uow.update("resources", { projectId: p.id, name }, { leaseUntil, purpose: input.purpose?.trim() ?? held.purpose, holder: ctx.actor }))[0]
      : await uow.insert("resources", { projectId: p.id, name, holder: ctx.actor, purpose: input.purpose?.trim() ?? "", leaseUntil, approvalId: null });
    await emit(held ? "resource.extended" : "resource.leased", null, { name, purpose: r!.purpose, lease_until: iso(r!.leaseUntil), minutes });
    const hint = typeof input.approval_id === "string" && input.approval_id.trim() ? LEGACY_APPROVAL_HINT : undefined;
    return { resource: resourceShape(r!), extended: !!held, ...(hint ? { hint } : {}) };
  });
}

export async function releaseResource(db: Db, input: { project: string; name: string }, ctx: Ctx) {
  const p = await findProject(db, input.project);
  const name = fullName(input.name, ctx);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const uow = uowOf(tx);
    const held = await uow.get("resources", { projectId: p.id, name });
    if (!held) return { name, released: false };
    if (held.holder.session_id !== ctx.actor.session_id && !ctx.human) {
      throw new ToolError("RESOURCE_HELD", { name, holder: held.holder, lease_until: iso(held.leaseUntil), purpose: held.purpose });
    }
    await uow.delete("resources", { projectId: p.id, name });
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
    const uow = uowOf(tx);
    const day = uow.now.toISOString().slice(0, 10);
    const row = await uow.get("quotaUsage", { projectId: p.id, name, day });
    const used = row?.used ?? 0;
    if (used + n > quota.daily) throw new ToolError("QUOTA_EXCEEDED", { name, limit: quota.daily, used, remaining: Math.max(0, quota.daily - used), day });
    if (row) await uow.update("quotaUsage", { projectId: p.id, name, day }, { used: used + n });
    else await uow.insert("quotaUsage", { projectId: p.id, name, day, used: n });
    await emit("quota.consumed", null, { name, n, used: used + n, limit: quota.daily, day });
    return { name, used: used + n, limit: quota.daily, remaining: quota.daily - used - n, day };
  });
}

// get_project.resources: live leases and today's quota usage.
export async function projectResources(db: Q, p: Project) {
  const r = readerOf(db);
  const now = new Date();
  const leases = (await r.find("resources", { projectId: p.id }, { orderBy: [{ column: "name" }] })).filter((l) => l.leaseUntil > now);
  const day = now.toISOString().slice(0, 10);
  const usage = await r.find("quotaUsage", { projectId: p.id, day });
  const quotas = Object.fromEntries(
    Object.entries(p.settings.quotas ?? {}).map(([name, q]) => {
      const used = usage.find((u) => u.name === name)?.used ?? 0;
      return [name, { limit: q.daily, used, remaining: Math.max(0, q.daily - used), day }];
    }),
  );
  return { leases: leases.map(resourceShape), quotas };
}
