// One-time rekey to the 2.1 scheme (R-33): initiatives PREFIX-I<n>, phases <initiative>-<n>,
// standalone tickets unchanged. Old keys become aliases, every rename is a task.rekeyed event.
//   pnpm rekey --project filmia            # dry run: prints the plan
//   pnpm rekey --project filmia --apply    # writes it, in one transaction
// Counters are reseeded from the new keys and the aliases, so no number is handed out twice.
import { parseArgs } from "node:util";
import { asc, eq, sql } from "drizzle-orm";
import { withDb, type Db } from "../src/db/client.js";
import { keyCounters, tasks, type Task } from "../src/db/schema.js";
import { addAlias, prefixOf } from "../src/mcp/keys.js";
import { findProject } from "../src/mcp/queries.js";
import { writeTx, type Ctx } from "../src/mcp/tx.js";

export const REKEY_ACTOR = { agent: "plania", session_id: "rekey" };

export type Rename = { from: string; to: string; kind: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The plan: which keys change. Initiatives in key order get I1, I2…; each one's children in
// (phase, key) order get <I>-1, <I>-2…; a key that already fits stays as it is.
export function planRekey(prefix: string, all: Task[]): Rename[] {
  const renames: Rename[] = [];
  const initiativePattern = new RegExp(`^${esc(prefix)}-I(\\d+)$`);
  const initiatives = all.filter((t) => t.kind === "initiative").sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
  let nextI = Math.max(0, ...initiatives.map((t) => Number(initiativePattern.exec(t.key)?.[1] ?? 0))) + 1;
  const newKeyOf = new Map<string, string>();
  for (const i of initiatives) {
    const key = initiativePattern.test(i.key) ? i.key : `${prefix}-I${nextI++}`;
    newKeyOf.set(i.id, key);
    if (key !== i.key) renames.push({ from: i.key, to: key, kind: "initiative" });
  }
  for (const i of initiatives) {
    const parentKey = newKeyOf.get(i.id)!;
    const childPattern = new RegExp(`^${esc(parentKey)}-(\\d+)$`);
    const children = all
      .filter((t) => t.parentId === i.id)
      .sort((a, b) => (a.phase ?? 1e9) - (b.phase ?? 1e9) || a.key.localeCompare(b.key, "en", { numeric: true }));
    let next = Math.max(0, ...children.map((t) => Number(childPattern.exec(t.key)?.[1] ?? 0))) + 1;
    for (const c of children) {
      if (childPattern.test(c.key)) continue;
      renames.push({ from: c.key, to: `${parentKey}-${next++}`, kind: "ticket" });
    }
  }
  return renames;
}

export async function rekeyProject(db: Db, slug: string, apply: boolean): Promise<Rename[]> {
  const p = await findProject(db, slug);
  const all = await db.select().from(tasks).where(eq(tasks.projectId, p.id)).orderBy(asc(tasks.key));
  const renames = planRekey(prefixOf(p), all);
  if (!apply || !renames.length) return renames;
  const ctx: Ctx = { actor: REKEY_ACTOR, tool: "rekey", requestId: `rekey-v3:${slug}` };
  await writeTx(db, p, ctx, async (tx, emit) => {
    const byKey = new Map(all.map((t) => [t.key, t]));
    for (const r of renames) {
      const t = byKey.get(r.from)!;
      const [u] = (await tx
        .update(tasks)
        .set({ key: r.to, version: sql`${tasks.version} + 1`, updatedAt: sql`now()` })
        .where(eq(tasks.id, t.id))
        .returning()) as [Task];
      await addAlias(tx, p.id, t.id, r.from);
      await emit("task.rekeyed", u, { from: r.from, to: r.to, reason: "migration" });
    }
    // Counters reseed lazily from the keys and aliases now in place.
    await tx.delete(keyCounters).where(eq(keyCounters.projectId, p.id));
    return renames;
  });
  return renames;
}

const isMain = process.argv[1]?.endsWith("rekey-v3.ts");
if (isMain) {
  const { values } = parseArgs({ options: { project: { type: "string" }, apply: { type: "boolean", default: false } } });
  if (!values.project) {
    console.error("usage: pnpm rekey --project <slug> [--apply]");
    process.exit(2);
  }
  const renames = await withDb((db) => rekeyProject(db, values.project!, values.apply));
  if (!renames.length) console.log(`${values.project}: every key already fits the scheme`);
  for (const r of renames) console.log(`${values.apply ? "renamed" : "would rename"} ${r.from} → ${r.to} (${r.kind})`);
  if (!values.apply && renames.length) console.log("dry run; pass --apply to write");
}
