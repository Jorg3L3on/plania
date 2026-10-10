import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { footprints } from "../db/schema.js";
import { iso, type Q } from "./tx.js";

// Reads of the `footprints` table for the MCP tools (get_task, get_context). The Machine page's
// inventory lives with the job (src/jobs/machine/index.ts); register/release are in footprint.ts.

type Row = typeof footprints.$inferSelect;

// What a ticket's session needs to see about each thing: enough to tear it down or keep it.
export function footprintShape(r: Row) {
  return {
    kind: r.kind,
    locator: r.locator,
    machine: r.machine,
    state: r.state,
    source: r.source,
    purpose: r.purpose,
    teardown: r.teardown,
    last_seen_at: iso(r.lastSeenAt),
  };
}

// Unreleased rows of these tasks (gone ones too: the process stopped but nobody released the row),
// each with its task id so the caller can name the ticket.
export async function footprintsOf(db: Q, taskIds: string[]) {
  if (!taskIds.length) return [];
  const rows = await db
    .select()
    .from(footprints)
    .where(and(inArray(footprints.taskId, taskIds), isNull(footprints.releasedAt)))
    .orderBy(asc(footprints.kind), asc(footprints.locator));
  return rows.map((r) => ({ taskId: r.taskId, ...footprintShape(r) }));
}

// One ticket's live footprint, as get_task shows it.
export async function taskFootprint(db: Q, taskId: string) {
  return (await footprintsOf(db, [taskId])).map(({ taskId: _, ...f }) => f);
}

// Unreleased rows a session declared (or was inferred to own) in one project, on one machine when given.
export async function sessionFootprint(db: Q, projectId: string, sessionId: string, machine?: string) {
  const rows = await db
    .select()
    .from(footprints)
    .where(and(eq(footprints.projectId, projectId), eq(footprints.sessionId, sessionId), isNull(footprints.releasedAt)))
    .orderBy(asc(footprints.kind), asc(footprints.locator));
  return rows.filter((r) => !machine || sameMachine(r.machine, machine)).map(footprintShape);
}

// Host names differ by spelling: the job reads os.hostname() ("MacBook-Air-de-Jorge.local"), an agent
// token may say "MacBook-Air-de-Jorge" or "macbook-air". Equal ignoring case and a ".local" suffix.
export const normMachine = (m: string) => m.trim().toLowerCase().replace(/\.local$/, "").replace(/\s+/g, "-");
export const sameMachine = (a: string, b: string) => normMachine(a) === normMachine(b);

// The unreleased rows of a ticket that are still around (not gone): what a handoff, a Done or an
// expiring claim should tell the next session to tear down or keep.
export async function liveTaskFootprint(db: Q, taskId: string) {
  return (await taskFootprint(db, taskId)).filter((f) => f.state !== "gone");
}

const gb = (kb: number) => (kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`);

// get_resume's one line about the Mac, over the project's rows: "3 servidores, 1 obsoleto, 9.8 GB de
// worktrees". null when the project has nothing on the machine. Gone rows (stopped) and ghosts (never
// seen) are not running.
export async function machineLine(db: Q, projectId: string): Promise<string | null> {
  const [r] = (
    await db.execute<{ n: number; servers: number; stale: number; kb: string }>(sql`
      select count(*)::int as n,
             (count(*) filter (where kind = 'server'))::int as servers,
             (count(*) filter (where state = 'stale'))::int as stale,
             coalesce(sum((details->>'size_kb')::numeric) filter (where kind = 'worktree'), 0)::text as kb
      from footprints
      where project_id = ${projectId} and released_at is null and state not in ('gone', 'ghost')`)
  ).rows;
  if (!r || r.n === 0) return null;
  return `${r.servers} ${r.servers === 1 ? "servidor" : "servidores"}, ${r.stale} ${r.stale === 1 ? "obsoleto" : "obsoletos"}, ${gb(Number(r.kb))} de worktrees`;
}
