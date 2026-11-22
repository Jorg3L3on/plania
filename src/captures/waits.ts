// PLA-I74-7: waits from measured times. El Probador's login and form waits, a copy's start wait and the QA lane's were
// constants; a cold dev copy compiled slower than them and the QA lane's start timed out on every pass. Each is now
// twice the cold start the project's last check-up measured («Revisar proyecto», src/captures/revision.ts), held between
// a floor and a ceiling. A project with no check-up yet (or one whose start step never answered) keeps today's constants.
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { events, projects } from "../db/schema.js";

export const REVISION_EVENT = "revision.pass";

// Today's constants: what a project with no measurement gets.
export const DEFAULT_WAITS = { ready_ms: 180_000, login_ms: 30_000, form_ms: 10_000, qa_start_ms: 180_000 } as const;
const FLOOR = { ready_ms: 60_000, login_ms: 15_000, form_ms: 5_000, qa_start_ms: 60_000 } as const;
const CEILING = { ready_ms: 900_000, login_ms: 180_000, form_ms: 60_000, qa_start_ms: 900_000 } as const;

export type Waits = { cold_start_ms: number | null; ready_ms: number; login_ms: number; form_ms: number; qa_start_ms: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The waits for a measured cold start (ms), or today's constants when there is none. */
export function waitsFrom(coldMs: number | null | undefined): Waits {
  if (coldMs == null || !Number.isFinite(coldMs) || coldMs <= 0) return { cold_start_ms: null, ...DEFAULT_WAITS };
  const twice = 2 * coldMs;
  return {
    cold_start_ms: coldMs,
    ready_ms: clamp(twice, FLOOR.ready_ms, CEILING.ready_ms),
    login_ms: clamp(twice, FLOOR.login_ms, CEILING.login_ms),
    form_ms: clamp(twice, FLOOR.form_ms, CEILING.form_ms),
    qa_start_ms: clamp(twice, FLOOR.qa_start_ms, CEILING.qa_start_ms),
  };
}

/** The cold start the project's newest check-up measured, or null. */
export async function lastColdStart(db: Db, slug: string): Promise<number | null> {
  const [row] = await db
    .select({ cold: sql<number | null>`(${events.payload} ->> 'cold_start_ms')::bigint` })
    .from(events)
    .innerJoin(projects, eq(projects.id, events.projectId))
    .where(and(eq(projects.slug, slug), eq(events.type, REVISION_EVENT), sql`${events.payload} ->> 'cold_start_ms' is not null`))
    .orderBy(desc(events.id))
    .limit(1);
  return row?.cold == null ? null : Number(row.cold);
}

/** The project's waits; never throws (a failed read is no measurement). */
export async function measuredWaits(db: Db, slug: string): Promise<Waits> {
  return waitsFrom(await lastColdStart(db, slug).catch(() => null));
}
