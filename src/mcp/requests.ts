import { readerOf } from "../store/port.js";
import { iso, type Q } from "./tx.js";

// 2.12 Pedir: what Jorge asked for from the screen (origin "jorge"). get_resume, get_context and
// get_next list the open ones, newest first, above the backlog; get_next offers one before any
// other ticket of the same priority. Open means not closed and not yet merged.
const SETTLED = ["Done", "Won't do", "Merged", "Released"];
const REQUESTS_LIMIT = 20;

export async function openRequests(db: Q, projectId: string, limit = REQUESTS_LIMIT) {
  const r = readerOf(db);
  // Newest first, the key breaking ties, sorted by the store so text order stays the database's.
  const asked = await r.find("tasks", { projectId, kind: "ticket", origin: "jorge" }, { orderBy: [{ column: "createdAt", desc: true }, { column: "key", desc: true }] });
  const rows = asked.filter((t) => !SETTLED.includes(t.status)).slice(0, limit);
  const parentIds = [...new Set(rows.flatMap((t) => (t.parentId ? [t.parentId] : [])))];
  const parentKey = new Map(parentIds.length ? (await r.find("tasks", { id: parentIds })).map((p) => [p.id, p.key]) : []);
  return rows.map((t) => ({
    key: t.key,
    kind: t.kind,
    parent_key: t.parentId ? (parentKey.get(t.parentId) ?? null) : null,
    title: t.title,
    summary: t.summary,
    status: t.status,
    priority: t.priority,
    asked_at: iso(t.createdAt),
    claimed: !!(t.leaseUntil && t.leaseUntil > new Date()),
  }));
}

export type Request = Awaited<ReturnType<typeof openRequests>>[number];
