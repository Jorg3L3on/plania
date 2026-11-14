// PLA-I29-6/7/8: the limits a run must pass before it starts.
// - No token budgets (PLA-21): the week's usage is shown, never checked.
// - PLA-25: guard_override (a screen switch) lets runs go on past the guard; only status "rejected" still stops.
// - The plan guard: no new run when the last reading is allowed_warning/rejected, or the 5-hour
//   window is at or over the guard (default 70%). No reading, or a stale one, is unknown = stop.
// - Company and project switches (runs_paused). Only Jorge's screen session writes any of these.
import type { Db } from "../db/client.js";
import type { AgentRun, PlanReading, RunnerSettings } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";
import { storeOf, readerOf, uowOf } from "../store/port.js";
import type { UnitOfWork } from "../store/types.js";

// ---- Writes from a handle

// Company rows (the roster, runner settings, runs, plan readings) belong to no project. A write of them
// that no project's write carries goes to the store under this id, the empty slug the bus uses for the company.
export const COMPANY = "";

// A store write from a handle: the write the handle is already in, else a new serialized write on the
// plain Db. Never call it with the plain Db from inside another write: it would wait on the lock that write holds.
export async function writeVia<T>(q: Q, fn: (uow: UnitOfWork) => Promise<T>, projectId = COMPANY): Promise<T> {
  let uow: UnitOfWork | null;
  try {
    uow = uowOf(q);
  } catch {
    uow = null;
  }
  return uow ? fn(uow) : storeOf(q as Db).write(projectId, {}, fn);
}

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

// The one settings row; made when missing (the migration seeds it, so that is a fresh database only).
export async function loadSettings(db: Q): Promise<RunnerSettings> {
  const row = await readerOf(db).get("runnerSettings", { id: 1 });
  if (row) return row;
  return writeVia(db, async (uow) => (await uow.get("runnerSettings", { id: 1 })) ?? uow.insert("runnerSettings", { id: 1 }));
}

// ---- Week

// The wall clock of an instant in a time zone, as the UTC instant with the same digits.
function wallClock(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")) + (at.getTime() % 1000);
}

// The instant a wall clock time (given as UTC digits) has in a time zone. Two passes settle the offset across a
// daylight-saving change.
function fromWallClock(wall: number, tz: string): Date {
  let at = wall - (wallClock(new Date(wall), tz) - wall);
  at = wall - (wallClock(new Date(at), tz) - at);
  return new Date(at);
}

// Monday 00:00 of now's week in the time zone, and the Monday after (what date_trunc('week') did in SQL).
export async function weekBounds(_db: Q, now: Date, tz = screenTz()): Promise<{ startsAt: Date; resetsAt: Date }> {
  const wall = new Date(wallClock(now, tz));
  const day = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  const monday = day - ((wall.getUTCDay() + 6) % 7) * 86_400_000;
  return { startsAt: fromWallClock(monday, tz), resetsAt: fromWallClock(monday + 7 * 86_400_000, tz) };
}

// ---- Usage this week
// PLA-21: weekly token budgets are gone (Jorge, 2026-11-12). The week's tokens are only shown, never checked.

// A project's usage is its team's; Asistente's runs (role asistente) count apart.
export type UsageScope = { kind: "project"; projectId: string } | { kind: "asistente" };
export type WeekUsage = { used: number };
// PLA-23: a card shows last week next to this week, so the number has something to compare with.
export type CardUsage = WeekUsage & { last_week: number };

export function inScope(scope: UsageScope, run: Pick<AgentRun, "role" | "projectId">): boolean {
  if (scope.kind === "asistente") return run.role === "asistente";
  return run.projectId === scope.projectId && run.role !== "asistente";
}

const COUNTED = ["running", "ok", "fail", "stopped"];

// Tokens from weekStart (to weekEnd when given), ended and running runs alike.
export async function weekUsage(db: Q, scope: UsageScope, weekStart: Date, weekEnd?: Date): Promise<WeekUsage> {
  const runs = await readerOf(db).find("agentRuns", scope.kind === "asistente" ? { role: "asistente", status: COUNTED } : { projectId: scope.projectId, status: COUNTED });
  let used = 0;
  for (const r of runs) {
    const at = (r.startedAt ?? r.queuedAt).getTime();
    if (inScope(scope, r) && at >= weekStart.getTime() && (!weekEnd || at < weekEnd.getTime())) used += Number(r.tokensTotal);
  }
  return { used };
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
  const [row] = await readerOf(db).find("planReadings", {}, { orderBy: [{ column: "at", desc: true }], limit: 1 });
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
  await writeVia(db, (uow) =>
    uow.insert("planReadings", {
      at: reading.at ?? uow.now,
      source: reading.source,
      status: reading.status,
      fiveHourPct: reading.fiveHourPct,
      sevenDayPct: reading.sevenDayPct,
      fiveHourResetsAt: reading.fiveHourResetsAt,
      sevenDayResetsAt: reading.sevenDayResetsAt,
      overageStatus: reading.overageStatus,
      runId: reading.runId ?? null,
    }),
  );
}
