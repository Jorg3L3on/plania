// PLA-I29-6/7/8: the limits a run must pass before it starts.
// - No token budgets (PLA-21): the week's usage is shown, never checked.
// - PLA-25: guard_override (a screen switch) lets runs go on past the guard; only status "rejected" still stops.
// - The plan guard: no new run when the last reading is allowed_warning/rejected, or the 5-hour
//   window is at or over the guard (default 70%). No reading, or a stale one, is unknown = stop.
// - Company and project switches (runs_paused). Only Jorge's screen session writes any of these.
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { planReadings, runnerSettings, type PlanReading, type RunnerSettings } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";

// A reading older than this, or past its 5-hour reset, says nothing about now.
export const READING_TTL_MS = 30 * 60_000;

// PLA-I32-2: the specialists (qa, copy, seguridad, marketing, data) are runner roles too, once a team has one.
export const RUNNER_ROLES = ["product-owner", "taller", "research", "artist", "asistente", "qa", "copy", "seguridad", "marketing", "data"] as const;
export type RunnerRole = (typeof RUNNER_ROLES)[number];

export const PROMPT_DOCS: Record<RunnerRole, string> = {
  "product-owner": "Prompt: Product owner",
  taller: "Prompt: Taller",
  research: "Prompt: Research",
  artist: "Prompt: Artist",
  asistente: "Prompt: Asistente",
  qa: "Prompt: QA",
  copy: "Prompt: Copy",
  seguridad: "Prompt: Seguridad",
  marketing: "Prompt: Marketing",
  data: "Prompt: Data",
};

const ROLE_SET = new Set<string>(RUNNER_ROLES);
export const isRunnerRole = (v: string | null | undefined): v is RunnerRole => !!v && ROLE_SET.has(v);

// PLA-I32-2: role_template first (every team member has one); the older slug and capability rules
// stay for rows made before 0041.
export function roleOf(agent: { slug: string; role: string; capabilities: string[]; roleTemplate?: string | null; role_template?: string | null }): RunnerRole | null {
  const template = agent.roleTemplate ?? agent.role_template ?? null;
  if (isRunnerRole(template)) return template;
  const caps = new Set(agent.capabilities);
  if (agent.role === "product-owner" || agent.slug.startsWith("po-")) return "product-owner";
  if (agent.slug === "asistente" || agent.role === "chief-of-staff") return "asistente";
  if (agent.slug === "research" || caps.has("research")) return "research";
  if (agent.slug === "artist" || caps.has("design")) return "artist";
  if (agent.slug === "taller" || agent.slug === "claude-code" || agent.role === "cto" || agent.role === "engineer" || caps.has("engineering")) return "taller";
  return null;
}

export const screenTz = (): string => process.env.PLANIA_TZ || "America/Mexico_City";

export async function loadSettings(db: Q): Promise<RunnerSettings> {
  const [row] = await db.select().from(runnerSettings).where(eq(runnerSettings.id, 1)).limit(1);
  if (row) return row;
  const [made] = await db.insert(runnerSettings).values({ id: 1 }).onConflictDoNothing().returning();
  if (made) return made;
  const [again] = await db.select().from(runnerSettings).where(eq(runnerSettings.id, 1)).limit(1);
  return again!;
}

// ---- Week

export async function weekBounds(db: Q, now: Date, tz = screenTz()): Promise<{ startsAt: Date; resetsAt: Date }> {
  const rows = await db.execute<{ s: string; e: string }>(sql`
    select (date_trunc('week', ${now.toISOString()}::timestamptz at time zone ${tz}) at time zone ${tz}) as s,
           ((date_trunc('week', ${now.toISOString()}::timestamptz at time zone ${tz}) + interval '7 days') at time zone ${tz}) as e`);
  return { startsAt: new Date(rows.rows[0]!.s), resetsAt: new Date(rows.rows[0]!.e) };
}

// ---- Usage this week
// PLA-21: weekly token budgets are gone (Jorge, 2026-11-12). The week's tokens are only shown, never checked.

// A project's usage is its team's; Asistente's runs (role asistente) count apart.
export type UsageScope = { kind: "project"; projectId: string } | { kind: "asistente" } | { kind: "all" };
// PLA-I46-5: used is input + output, the work the models did. Cache reads and cache writes are counted apart: a
// resumed session re-reads its whole context each turn, so they can be 99% of the total and say little.
export type WeekUsage = { used: number; input: number; output: number; cache_read: number; cache_create: number };
// PLA-23: a card shows last week next to this week, so the number has something to compare with.
export type CardUsage = { used: number; last_week: number };

export function scopeWhere(scope: UsageScope) {
  if (scope.kind === "asistente") return sql`r.role = 'asistente'`;
  if (scope.kind === "all") return sql`true`;
  return sql`r.project_id = ${scope.projectId} and r.role <> 'asistente'`;
}

// Tokens from weekStart (to weekEnd when given), ended and running runs alike.
export async function weekUsage(db: Q, scope: UsageScope, weekStart: Date, weekEnd?: Date): Promise<WeekUsage> {
  const rows = await db.execute<{ input: string | null; output: string | null; cache_read: string | null; cache_create: string | null }>(sql`
    select coalesce(sum(r.input_tokens), 0)::bigint as input, coalesce(sum(r.output_tokens), 0)::bigint as output,
           coalesce(sum(r.cache_read_tokens), 0)::bigint as cache_read, coalesce(sum(r.cache_create_tokens), 0)::bigint as cache_create
    from agent_runs r
    where ${scopeWhere(scope)}
      and r.status in ('running', 'ok', 'fail', 'stopped')
      and coalesce(r.started_at, r.queued_at) >= ${weekStart.toISOString()}::timestamptz
      and (${weekEnd?.toISOString() ?? null}::timestamptz is null or coalesce(r.started_at, r.queued_at) < ${weekEnd?.toISOString() ?? null}::timestamptz)`);
  const r = rows.rows[0];
  const input = Number(r?.input ?? 0);
  const output = Number(r?.output ?? 0);
  return { used: input + output, input, output, cache_read: Number(r?.cache_read ?? 0), cache_create: Number(r?.cache_create ?? 0) };
}

// ---- Plan guard

export type PlanState = "ok" | "warn" | "stopped" | "unknown";
export type PlanView = {
  five_hour_pct: number | null;
  seven_day_pct: number | null;
  resets_at: string | null;
  seven_day_resets_at: string | null;
  guard_pct: number;
  status: string | null;
  state: PlanState;
  read_at: string | null;
  source: string | null;
  // PLA-25: Jorge's screen switch. While on, the percentage, a warning and an unknown reading do not stop a wake.
  override: boolean;
};

export async function lastReading(db: Q): Promise<PlanReading | null> {
  const [row] = await db.select().from(planReadings).orderBy(desc(planReadings.at)).limit(1);
  return row ?? null;
}

export function planView(reading: PlanReading | null, guardPct: number, now: Date, override = false): PlanView {
  const base = {
    five_hour_pct: reading?.fiveHourPct ?? null,
    seven_day_pct: reading?.sevenDayPct ?? null,
    resets_at: reading?.fiveHourResetsAt?.toISOString() ?? null,
    seven_day_resets_at: reading?.sevenDayResetsAt?.toISOString() ?? null,
    guard_pct: guardPct,
    status: reading?.status ?? null,
    read_at: reading?.at.toISOString() ?? null,
    source: reading?.source ?? null,
    override,
  };
  // PLA-25: with the switch on only a real "rejected" stops (the run would fail anyway).
  if (override) return { ...base, state: reading?.status === "rejected" ? "stopped" : "ok" };
  if (!reading) return { ...base, state: "unknown" };
  const stale =
    now.getTime() - reading.at.getTime() > READING_TTL_MS ||
    (reading.fiveHourResetsAt != null && reading.fiveHourResetsAt.getTime() <= now.getTime());
  if (stale) return { ...base, state: "unknown" };
  if (reading.status === "allowed_warning" || reading.status === "rejected") return { ...base, state: "stopped" };
  if (reading.fiveHourPct == null) return { ...base, state: "unknown" };
  if (reading.fiveHourPct >= guardPct) return { ...base, state: "stopped" };
  if (reading.fiveHourPct >= guardPct - 10) return { ...base, state: "warn" };
  return { ...base, state: "ok" };
}

export function planGuardSummary(view: PlanView): string {
  const resets = view.resets_at ? `, resetsAt ${view.resets_at}` : "";
  if (view.state === "unknown") return "skipped: plan guard (usage unknown)";
  if (view.status === "allowed_warning" || view.status === "rejected") return `skipped: plan guard (status ${view.status}${resets})`;
  return `skipped: plan guard (five_hour ${view.five_hour_pct}% >= ${view.guard_pct}%${resets})`;
}

export async function recordReading(
  db: Db | Q,
  reading: {
    source: "stream" | "usage_probe";
    status: string | null;
    fiveHourPct: number | null;
    sevenDayPct: number | null;
    fiveHourResetsAt: Date | null;
    sevenDayResetsAt: Date | null;
    overageStatus: string | null;
    runId?: string | null;
    at?: Date;
  },
): Promise<void> {
  await db.insert(planReadings).values({
    at: reading.at ?? new Date(),
    source: reading.source,
    status: reading.status,
    fiveHourPct: reading.fiveHourPct,
    sevenDayPct: reading.sevenDayPct,
    fiveHourResetsAt: reading.fiveHourResetsAt,
    sevenDayResetsAt: reading.sevenDayResetsAt,
    overageStatus: reading.overageStatus,
    runId: reading.runId ?? null,
  });
}
