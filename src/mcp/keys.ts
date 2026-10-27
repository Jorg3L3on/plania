import { and, eq, sql } from "drizzle-orm";
import { keyCounters, taskAliases, tasks, type Project, type Task } from "../db/schema.js";
import { ToolError } from "./errors.js";
import type { Q } from "./tx.js";

// Server-assigned keys that show what a task is and where it hangs (2.1, requests R-08 and R-33):
//   initiatives          PREFIX-I<n>            FIL-I1, FIL-I2
//   ideas                PREFIX-IDEA<n>         WRK-IDEA3
//   standalone tickets   PREFIX-<nn>            FIL-09 (two digits, like the keys filmia already has)
//   phases / children    <initiative key>-<n>   FIL-I2-3 (phase stays a separate field; no F)
// One counter per scope, read and bumped under the project's write lock (writeTx), so concurrent
// creates never collide and a number is never reissued after a rename, move or delete.
// An explicit key is still accepted (imports, tests). When it fits its scope's pattern it must be
// at or above the counter (KEY_BELOW_COUNTER) and moves it; when it fits another scope's pattern it
// only warns, but still moves that counter so the number is not handed out again.

export type KeyScope = "initiative" | "standalone" | string; // or a parent initiative's id

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function prefixOf(p: Pick<Project, "slug" | "keyPrefix">): string {
  return p.keyPrefix || p.slug.slice(0, 3).toUpperCase();
}

type Scheme = { scope: KeyScope; pattern: RegExp; sqlPattern: string; format: (n: number) => string };

export function scheme(p: Pick<Project, "slug" | "keyPrefix">, kind: string, parent?: Pick<Task, "id" | "key">): Scheme {
  const prefix = prefixOf(p);
  if (kind === "initiative") {
    return { scope: "initiative", pattern: new RegExp(`^${esc(prefix)}-I(\\d+)$`), sqlPattern: `^${esc(prefix)}-I(\\d+)$`, format: (n) => `${prefix}-I${n}` };
  }
  if (kind === "idea") {
    return { scope: "idea", pattern: new RegExp(`^${esc(prefix)}-IDEA(\\d+)$`), sqlPattern: `^${esc(prefix)}-IDEA(\\d+)$`, format: (n) => `${prefix}-IDEA${n}` };
  }
  if (parent) {
    // Legacy phase keys (FIL-01-F2) count too, so a rekeyed initiative never reuses a number.
    return {
      scope: parent.id,
      pattern: new RegExp(`^${esc(parent.key)}-F?(\\d+)$`),
      sqlPattern: `^${esc(parent.key)}-F?(\\d+)$`,
      format: (n) => `${parent.key}-${n}`,
    };
  }
  return {
    scope: "standalone",
    pattern: new RegExp(`^${esc(prefix)}-(\\d+)$`),
    sqlPattern: `^${esc(prefix)}-(\\d+)$`,
    format: (n) => `${prefix}-${String(n).padStart(2, "0")}`,
  };
}

// The counter for a scope; seeded from the keys and aliases that already fit its pattern.
// A child scope only counts that initiative's children (a standalone "WRK-V-01" is not a phase of
// "WRK-V"); the project-level scopes count every key of their shape, whatever the kind, so a number
// is never handed out twice.
async function counter(tx: Q, projectId: string, s: Scheme): Promise<number> {
  const [row] = await tx
    .select({ next: keyCounters.next })
    .from(keyCounters)
    .where(and(eq(keyCounters.projectId, projectId), eq(keyCounters.scope, s.scope)));
  if (row) return row.next;
  const ofScope =
    s.scope === "initiative" || s.scope === "standalone" || s.scope === "idea" ? sql`true` : sql`t.parent_id = ${s.scope}::uuid`;
  const [seed] = await tx.execute<{ next: number }>(sql`
    select coalesce(max(n), 0) + 1 as next from (
      select (regexp_match(t.key, ${s.sqlPattern}))[1]::int as n from ${tasks} t
      where t.project_id = ${projectId} and t.key ~ ${s.sqlPattern} and ${ofScope}
      union all
      select (regexp_match(a.alias, ${s.sqlPattern}))[1]::int from ${taskAliases} a join ${tasks} t on t.id = a.task_id
      where a.project_id = ${projectId} and a.alias ~ ${s.sqlPattern} and ${ofScope}
    ) x`).then((r) => r.rows);
  const next = Number(seed?.next ?? 1);
  await tx.insert(keyCounters).values({ projectId, scope: s.scope, next }).onConflictDoNothing();
  return next;
}

async function setCounter(tx: Q, projectId: string, scope: KeyScope, next: number): Promise<void> {
  await tx
    .insert(keyCounters)
    .values({ projectId, scope, next })
    .onConflictDoUpdate({ target: [keyCounters.projectId, keyCounters.scope], set: { next: sql`greatest(${keyCounters.next}, ${next})` } });
}

async function keyTaken(tx: Q, projectId: string, key: string): Promise<boolean> {
  const [t] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.key, key))).limit(1);
  if (t) return true;
  const [a] = await tx.select({ id: taskAliases.taskId }).from(taskAliases).where(and(eq(taskAliases.projectId, projectId), eq(taskAliases.alias, key))).limit(1);
  return !!a;
}

// Picks (or validates) the key for a new task, or for a ticket moved under another parent.
export async function assignKey(
  tx: Q,
  p: Project,
  kind: string,
  parent: Task | undefined,
  explicit: string | undefined,
): Promise<{ key: string; assigned: boolean; warnings: string[] }> {
  const s = scheme(p, kind, parent);
  if (explicit !== undefined) {
    const m = s.pattern.exec(explicit);
    if (m) {
      const n = Number(m[1]);
      const next = await counter(tx, p.id, s);
      if (n < next) throw new ToolError("KEY_BELOW_COUNTER", { key: explicit, next: s.format(next) });
      await setCounter(tx, p.id, s.scope, n + 1);
      return { key: explicit, assigned: false, warnings: [] };
    }
    const warnings = [`key does not follow the scheme ${s.format(0).replace(/0+$/, "<n>")}: omit key to get the next one`];
    // A number taken from another scope is still spent there.
    for (const other of [scheme(p, "initiative"), scheme(p, "ticket"), scheme(p, "idea")]) {
      const om = other.pattern.exec(explicit);
      if (om) await setCounter(tx, p.id, other.scope, Number(om[1]) + 1);
    }
    return { key: explicit, assigned: false, warnings };
  }
  let next = await counter(tx, p.id, s);
  while (await keyTaken(tx, p.id, s.format(next))) next++;
  await setCounter(tx, p.id, s.scope, next + 1);
  return { key: s.format(next), assigned: true, warnings: [] };
}

// For get_project: what the next assigned keys would be.
export async function nextKeys(tx: Q, p: Project) {
  const peek = async (s: Scheme) => {
    const [row] = await tx
      .select({ next: keyCounters.next })
      .from(keyCounters)
      .where(and(eq(keyCounters.projectId, p.id), eq(keyCounters.scope, s.scope)));
    return row ? s.format(row.next) : null;
  };
  return { initiative: await peek(scheme(p, "initiative")), standalone: await peek(scheme(p, "ticket")), idea: await peek(scheme(p, "idea")) };
}

// Remembers an old key so it keeps resolving.
export async function addAlias(tx: Q, projectId: string, taskId: string, alias: string): Promise<void> {
  await tx.insert(taskAliases).values({ projectId, taskId, alias }).onConflictDoNothing();
}
