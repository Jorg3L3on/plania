import type { Project, Task } from "../db/schema.js";
import { readerOf, uowOf } from "../store/pg.js";
import { ToolError } from "./errors.js";
import type { Q } from "./tx.js";

// Server-assigned keys that show what a task is and where it hangs (2.1, requests R-08 and R-33):
//   initiatives          PREFIX-I<n>            FIL-I1, FIL-I2
//   ideas                PREFIX-IDEA<n>         WRK-IDEA3
//   standalone tickets   PREFIX-<nn>            FIL-09 (two digits, like the keys filmia already has)
//   phases / children    <initiative key>-<n>   FIL-I2-3 (phase stays a separate field; no F)
// One counter per scope, read and bumped inside the serialized write (writeTx), so concurrent
// creates never collide and a number is never reissued after a rename, move or delete.
// An explicit key is still accepted (imports, tests). When it fits its scope's pattern it must be
// at or above the counter (KEY_BELOW_COUNTER) and moves it; when it fits another scope's pattern it
// only warns, but still moves that counter so the number is not handed out again.

export type KeyScope = "initiative" | "standalone" | string; // or a parent initiative's id

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function prefixOf(p: Pick<Project, "slug" | "keyPrefix">): string {
  return p.keyPrefix || p.slug.slice(0, 3).toUpperCase();
}

type Scheme = { scope: KeyScope; pattern: RegExp; format: (n: number) => string };

export function scheme(p: Pick<Project, "slug" | "keyPrefix">, kind: string, parent?: Pick<Task, "id" | "key">): Scheme {
  const prefix = prefixOf(p);
  if (kind === "initiative") {
    return { scope: "initiative", pattern: new RegExp(`^${esc(prefix)}-I(\\d+)$`), format: (n) => `${prefix}-I${n}` };
  }
  if (kind === "idea") {
    return { scope: "idea", pattern: new RegExp(`^${esc(prefix)}-IDEA(\\d+)$`), format: (n) => `${prefix}-IDEA${n}` };
  }
  if (parent) {
    // Legacy phase keys (FIL-01-F2) count too, so a rekeyed initiative never reuses a number.
    return { scope: parent.id, pattern: new RegExp(`^${esc(parent.key)}-F?(\\d+)$`), format: (n) => `${parent.key}-${n}` };
  }
  return { scope: "standalone", pattern: new RegExp(`^${esc(prefix)}-(\\d+)$`), format: (n) => `${prefix}-${String(n).padStart(2, "0")}` };
}

// The counter for a scope; seeded from the keys and aliases that already fit its pattern.
// A child scope only counts that initiative's children (a standalone "WRK-V-01" is not a phase of
// "WRK-V"); the project-level scopes count every key of their shape, whatever the kind, so a number
// is never handed out twice.
async function counter(tx: Q, projectId: string, s: Scheme): Promise<number> {
  const uow = uowOf(tx);
  const row = await uow.get("keyCounters", { projectId, scope: s.scope });
  if (row) return row.next;
  const projectWide = s.scope === "initiative" || s.scope === "standalone" || s.scope === "idea";
  const inScope = new Map((await uow.find("tasks", { projectId })).filter((t) => projectWide || t.parentId === s.scope).map((t) => [t.id, t.key]));
  const aliases = (await uow.find("taskAliases", { projectId })).filter((a) => inScope.has(a.taskId)).map((a) => a.alias);
  let max = 0;
  for (const text of [...inScope.values(), ...aliases]) {
    const m = s.pattern.exec(text);
    if (m) max = Math.max(max, Number(m[1]));
  }
  await uow.insert("keyCounters", { projectId, scope: s.scope, next: max + 1 });
  return max + 1;
}

// A counter only moves forward.
async function setCounter(tx: Q, projectId: string, scope: KeyScope, next: number): Promise<void> {
  const uow = uowOf(tx);
  const row = await uow.get("keyCounters", { projectId, scope });
  if (!row) await uow.insert("keyCounters", { projectId, scope, next });
  else if (next > row.next) await uow.update("keyCounters", { projectId, scope }, { next });
}

async function keyTaken(tx: Q, projectId: string, key: string): Promise<boolean> {
  const r = readerOf(tx);
  return !!(await r.get("tasks", { projectId, key })) || !!(await r.get("taskAliases", { projectId, alias: key }));
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
    const row = await readerOf(tx).get("keyCounters", { projectId: p.id, scope: s.scope });
    return row ? s.format(row.next) : null;
  };
  return { initiative: await peek(scheme(p, "initiative")), standalone: await peek(scheme(p, "ticket")), idea: await peek(scheme(p, "idea")) };
}

// Remembers an old key so it keeps resolving.
export async function addAlias(tx: Q, projectId: string, taskId: string, alias: string): Promise<void> {
  const uow = uowOf(tx);
  if (!(await uow.get("taskAliases", { projectId, alias }))) await uow.insert("taskAliases", { projectId, taskId, alias });
}
