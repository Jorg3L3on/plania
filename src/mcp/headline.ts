import { and, desc, eq, inArray } from "drizzle-orm";
import { releases, tasks, type Project } from "../db/schema.js";
import { inboxFor } from "./inbox.js";
import { PR_NUMBER } from "./queries.js";
import { releasePending } from "./release-plan.js";
import type { StatusBlock } from "./status.js";
import type { Q } from "./tx.js";

// 2.11 (item 3): the project headline, generated from the status block so it cannot go stale.
//   "<env> = <branch> <sha7> (<initiatives released there>). <from> = <into> + <PR numbers> (<keys>).
//    En curso: <key (agent)>. Te toca: <n pasos>. Siguiente: <next_claimable key>."
// Each clause drops when it has nothing to say; the line stops at the last clause that fits in 280
// characters. What the data cannot say goes in the note (set_project headline).

export const HEADLINE_MAX = 280;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Up to `max` items, then "y N más". */
function some(items: string[], max = 4): string {
  return items.length <= max ? items.join(", ") : `${items.slice(0, max - 1).join(", ")} y ${items.length - max + 1} más`;
}

/** Clauses joined until the next one would pass `max`; a first clause too long on its own is clipped. */
export function fitClauses(clauses: string[], max = HEADLINE_MAX): string {
  let out = "";
  for (const c of clauses.filter(Boolean)) {
    const next = out ? `${out} ${c}` : c;
    if (next.length > max) return out || `${c.slice(0, max - 1)}…`;
    out = next;
  }
  return out;
}

export type HeadlineInput = {
  status: StatusBlock;
  next_claimable: { key: string } | null;
  claims: { key: string; owner: { agent?: string } | null }[];
};

export async function generatedHeadline(db: Q, p: Project, d: HeadlineInput): Promise<string> {
  const clauses: string[] = [];

  // What the release target runs, and the initiatives whose tickets reached it with that commit.
  const envName = p.settings.release?.env ?? p.settings.release_target ?? "prod";
  const env = d.status.envs.find((e) => e.env === envName && e.commit);
  if (env?.commit) {
    const rows = await db
      .select({ taskKeys: releases.taskKeys })
      .from(releases)
      .where(and(eq(releases.projectId, p.id), eq(releases.env, envName), eq(releases.commit, env.commit)))
      .orderBy(desc(releases.createdAt));
    const keys = [...new Set(rows.flatMap((r) => r.taskKeys))];
    let shipped: string[] = [];
    if (keys.length) {
      const ts = await db.select({ key: tasks.key, parentId: tasks.parentId }).from(tasks).where(and(eq(tasks.projectId, p.id), inArray(tasks.key, keys)));
      const parentIds = [...new Set(ts.map((t) => t.parentId).filter((x): x is string => !!x))];
      const parents = parentIds.length ? await db.select({ id: tasks.id, key: tasks.key }).from(tasks).where(inArray(tasks.id, parentIds)) : [];
      shipped = [...new Set(ts.map((t) => parents.find((x) => x.id === t.parentId)?.key ?? t.key))].sort();
    }
    clauses.push(`${envName} = ${env.branch ?? "?"} ${env.commit.slice(0, 7)}${shipped.length ? ` (${some(shipped)})` : ""}.`);
  }

  // The release step, while from is ahead of into with merged tickets.
  const plan = d.status.release;
  if (releasePending(plan)) {
    const prs = [...new Set(plan.tickets.map((t) => (t.pr_url ? PR_NUMBER.exec(t.pr_url)?.[1] : undefined)).filter((n): n is string => !!n))].map((n) => `#${n}`);
    const keys = plan.tickets.map((t) => t.key);
    clauses.push(`${plan.from.branch} = ${plan.into.branch}${prs.length ? ` + ${some(prs)}` : ""} (${some(keys, 3)}).`);
  }

  if (d.claims.length) clauses.push(`En curso: ${some(d.claims.map((c) => (c.owner?.agent ? `${c.key} (${c.owner.agent})` : c.key)), 3)}.`);

  // What waits on Jorge, in the inbox's own words (decisiones and pasos; limpieza is the Mac's).
  const box = await inboxFor(db, p);
  const decisiones = box.filter((i) => i.group === "decisiones").length;
  const pasos = box.filter((i) => i.group === "pasos").length;
  const toca = [decisiones && plural(decisiones, "decisión", "decisiones"), pasos && plural(pasos, "paso", "pasos")].filter(Boolean);
  if (toca.length) clauses.push(`Te toca: ${toca.join(", ")}.`);

  if (d.next_claimable) clauses.push(`Siguiente: ${d.next_claimable.key}.`);
  return fitClauses(clauses);
}
