// PLA-I29-6/7/8: the limits a run must pass before it starts.
// - Weekly token budgets, from Monday 00:00 in Jorge's time zone. PLA-I32-5: one per project, shared by its
//   team, and one for Asistente (runner_settings.asistente_weekly_limit; its runs are role asistente and do
//   not count against the project they are recorded in). Role budgets are retired: never read for a run.
//   80% warns, 100% stops that scope only. A running run counts its reserve until it ends.
//   No limit set, or a run whose usage is unknown, stops the scope (unknown = stop).
// - The plan guard: no new run when the last reading is allowed_warning/rejected, or the 5-hour
//   window is at or over the guard (default 70%). No reading, or a stale one, is unknown = stop.
// - Company and project switches (runs_paused). Only Jorge's screen session writes any of these.
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { planReadings, runnerSettings, tokenBudgets, type PlanReading, type RunnerSettings } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";

export const WARN_PCT = 80;
export const STOP_PCT = 100;
// A reading older than this, or past its 5-hour reset, says nothing about now.
export const READING_TTL_MS = 30 * 60_000;

// PLA-I32-2: the specialists (qa, copy, marketing, data) are runner roles too, once a team has one.
export const RUNNER_ROLES = ["product-owner", "taller", "research", "artist", "asistente", "qa", "copy", "marketing", "data"] as const;
export type RunnerRole = (typeof RUNNER_ROLES)[number];

export const PROMPT_DOCS: Record<RunnerRole, string> = {
  "product-owner": "Prompt: Product owner",
  taller: "Prompt: Taller",
  research: "Prompt: Research",
  artist: "Prompt: Artist",
  asistente: "Prompt: Asistente",
  qa: "Prompt: QA",
  copy: "Prompt: Copy",
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

// ---- Budgets

export type BudgetState = "ok" | "warn" | "stopped";
export type BudgetView = {
  used: number;
  limit: number | null;
  pct: number | null;
  state: BudgetState;
  // Why it stopped below 100%: no limit set, or a run whose usage is unknown.
  reason: "unset" | "usage_unknown" | null;
};

// role: retired (PLA-I32-5); kept so old rows can still be shown, never checked before a run.
export type BudgetScope = { kind: "role"; role: string } | { kind: "project"; projectId: string } | { kind: "asistente" };

export function budgetState(used: number, limit: number | null, unknownRuns: number): BudgetView {
  if (limit == null || limit <= 0) return { used, limit: null, pct: null, state: "stopped", reason: "unset" };
  const pct = Math.floor((used / limit) * 1000) / 10;
  if (unknownRuns > 0) return { used, limit, pct, state: "stopped", reason: "usage_unknown" };
  if (pct >= STOP_PCT) return { used, limit, pct, state: "stopped", reason: null };
  if (pct >= WARN_PCT) return { used, limit, pct, state: "warn", reason: null };
  return { used, limit, pct, state: "ok", reason: null };
}

export async function budgetLimit(db: Q, scope: BudgetScope): Promise<number | null> {
  if (scope.kind === "asistente") {
    const v = (await loadSettings(db)).asistenteWeeklyLimit;
    return v == null ? null : Number(v);
  }
  const [row] = await db
    .select({ limit: tokenBudgets.weeklyLimit })
    .from(tokenBudgets)
    .where(
      scope.kind === "role"
        ? sql`${tokenBudgets.scope} = 'role' and ${tokenBudgets.role} = ${scope.role}`
        : sql`${tokenBudgets.scope} = 'project' and ${tokenBudgets.projectId} = ${scope.projectId}`,
    )
    .limit(1);
  return row ? Number(row.limit) : null;
}

// Which runs a scope counts. A project's budget is its team's: Asistente's runs (role asistente) are its own.
export function scopeWhere(scope: BudgetScope) {
  if (scope.kind === "role") return sql`r.role = ${scope.role}`;
  if (scope.kind === "asistente") return sql`r.role = 'asistente'`;
  return sql`r.project_id = ${scope.projectId} and r.role <> 'asistente'`;
}

// Used this week: ended runs count their tokens; running runs count the larger of tokens so far and their reserve.
export async function budgetUsage(db: Q, scope: BudgetScope, weekStart: Date): Promise<{ used: number; unknown: number }> {
  const where = scopeWhere(scope);
  const rows = await db.execute<{ used: string | null; unknown: number }>(sql`
    select coalesce(sum(case when r.status = 'running' then greatest(r.tokens_total, r.reserve_tokens) else r.tokens_total end), 0)::bigint as used,
           count(*) filter (where r.usage_known = false and r.usage_ack_at is null)::int as unknown
    from agent_runs r
    where ${where}
      and r.status in ('running', 'ok', 'fail', 'stopped')
      and coalesce(r.started_at, r.queued_at) >= ${weekStart.toISOString()}::timestamptz`);
  return { used: Number(rows.rows[0]?.used ?? 0), unknown: Number(rows.rows[0]?.unknown ?? 0) };
}

export async function budgetView(db: Q, scope: BudgetScope, weekStart: Date): Promise<BudgetView> {
  const [limit, usage] = await Promise.all([budgetLimit(db, scope), budgetUsage(db, scope, weekStart)]);
  return budgetState(usage.used, limit, usage.unknown);
}

export type BudgetGate =
  | { ok: true; warn: { scope: string; pct: number }[] }
  | { ok: false; summary: string; scope: string };

// Both scopes must have room for the new run's reserve.
export function budgetGate(views: { label: string; view: BudgetView }[], reserve: number): BudgetGate {
  const warn: { scope: string; pct: number }[] = [];
  for (const { label, view } of views) {
    if (view.reason === "unset") return { ok: false, scope: label, summary: `skipped: BUDGET_STOPPED ${label} (no limit set)` };
    if (view.reason === "usage_unknown") return { ok: false, scope: label, summary: `skipped: BUDGET_STOPPED ${label} (usage unknown)` };
    if (view.state === "stopped") return { ok: false, scope: label, summary: `skipped: BUDGET_STOPPED ${label} at ${view.pct}%` };
    if (view.limit != null && view.used + reserve > view.limit) {
      return { ok: false, scope: label, summary: `skipped: BUDGET_STOPPED ${label} (reserve does not fit)` };
    }
    if (view.state === "warn") warn.push({ scope: label, pct: view.pct ?? 0 });
  }
  return { ok: true, warn };
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
};

export async function lastReading(db: Q): Promise<PlanReading | null> {
  const [row] = await db.select().from(planReadings).orderBy(desc(planReadings.at)).limit(1);
  return row ?? null;
}

export function planView(reading: PlanReading | null, guardPct: number, now: Date): PlanView {
  const base = {
    five_hour_pct: reading?.fiveHourPct ?? null,
    seven_day_pct: reading?.sevenDayPct ?? null,
    resets_at: reading?.fiveHourResetsAt?.toISOString() ?? null,
    seven_day_resets_at: reading?.sevenDayResetsAt?.toISOString() ?? null,
    guard_pct: guardPct,
    status: reading?.status ?? null,
    read_at: reading?.at.toISOString() ?? null,
    source: reading?.source ?? null,
  };
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
