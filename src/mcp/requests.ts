import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { tasks } from "../db/schema.js";
import { iso, type Q } from "./tx.js";

// 2.12 Pedir: what Jorge asked for from the screen (origin "jorge"). get_resume, get_context and
// get_next list the open ones, newest first, above the backlog; get_next offers one before any
// other ticket of the same priority. Open means not closed and not yet merged.
const SETTLED = ["Done", "Won't do", "Merged", "Released"];
const REQUESTS_LIMIT = 20;

export async function openRequests(db: Q, projectId: string, limit = REQUESTS_LIMIT) {
  const parent = alias(tasks, "parent");
  const rows = await db
    .select({ t: tasks, parent_key: parent.key })
    .from(tasks)
    .leftJoin(parent, eq(parent.id, tasks.parentId))
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.kind, "ticket"),
        eq(tasks.origin, "jorge"),
        sql`${tasks.status} not in (${sql.join(SETTLED.map((s) => sql`${s}`), sql`, `)})`,
      ),
    )
    .orderBy(desc(tasks.createdAt), desc(tasks.key))
    .limit(limit);
  return rows.map(({ t, parent_key }) => ({
    key: t.key,
    kind: t.kind,
    parent_key,
    title: t.title,
    summary: t.summary,
    status: t.status,
    priority: t.priority,
    asked_at: iso(t.createdAt),
    claimed: !!(t.leaseUntil && t.leaseUntil > new Date()),
  }));
}

export type Request = Awaited<ReturnType<typeof openRequests>>[number];
