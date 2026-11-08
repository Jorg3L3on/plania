// PLA-I31-2: Asistente, the chief of staff.
// - The brief, daily at 07:00 in Jorge's time zone (PLANIA_TZ). It is a deterministic summary the
//   server writes from data it already has (0 tokens), whether the runner is on or off; no claude run
//   writes it. Stored as an asistente.brief event in the home project; GET /api/company reads the latest.
//   A server that was asleep at 07:00 writes it on its first tick after (once per local day).
// - The check, every 2 hours (one per local 2-hour slot): stuck or quiet projects (quiet = no event in
//   more than 48 h), budgets at 80% or more (a line, never an ask, never a proposal to raise a limit),
//   and the same failure twice in a row on a ticket, which yields exactly one ask into Solo tú.
//   The other escalations (money, production, main, unclear direction) are judgement calls the role
//   prompt gives to Asistente's own runs, which ask through MCP; the server does not guess them.
// Every line is plain Spanish for the Compañía page. No money anywhere: tokens and percents only.
import { hostname } from "node:os";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, events, projects, questions, tasks, type Actor } from "../db/schema.js";
import { ask } from "../mcp/questions.js";
import { writeTx } from "../mcp/tx.js";
import { RUNNER_ROLES, budgetView, lastReading, loadSettings, planView, screenTz, weekBounds } from "./limits.js";

export const BRIEF_HOUR = 7;
export const CHECK_EVERY_HOURS = 2;
export const QUIET_HOURS = 48;
export const STUCK_HOURS = 24;
const HOUR = 3_600_000;

export const ASISTENTE_ACTOR: Actor = { agent: "asistente", session_id: "asistente-check" };
export const homeProjectSlug = (env: NodeJS.ProcessEnv = process.env): string => env.PLANIA_HOME_PROJECT || env.PLANIA_PROMPTS_PROJECT || "plania";

export type Brief = { lines: string[]; generated_at: string };

// ---- Clock

export function localParts(now: Date, tz = screenTz()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

export const checkSlot = (now: Date, tz = screenTz()): string => {
  const { date, hour } = localParts(now, tz);
  return `${date}#${Math.floor(hour / CHECK_EVERY_HOURS)}`;
};

// ---- Findings

const n = (v: number) => v.toLocaleString("es-MX");
const nameOf = (p: { slug: string; title: string }) => p.title || p.slug;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export type Findings = {
  budgets: string[];
  quiet: string[];
  stuck: string[];
  repeated: { line: string; ask: RepeatedFailure | null }[];
};

export type RepeatedFailure = { runId: string; project: string; taskKey: string; agent: string; summary: string };

// "fail: error_max_turns (40 turns, session 1a2b3c4d)" and the same with other numbers are the same failure.
export const failureSignature = (summary: string): string =>
  summary
    .replace(/,?\s*session [0-9a-z-]+/gi, "")
    .replace(/\d+ turns?/g, "N turns")
    .replace(/\s+/g, " ")
    .trim();

async function budgetLines(db: Db, now: Date): Promise<string[]> {
  const { startsAt } = await weekBounds(db, now);
  const out: string[] = [];
  const rows = await db.select().from(projects).orderBy(asc(projects.slug));
  for (const p of rows) {
    const view = await budgetView(db, { kind: "project", projectId: p.id }, startsAt);
    if (view.limit == null || view.reason) continue;
    if (view.state === "stopped") out.push(`${nameOf(p)} llegó al 100 % de su presupuesto semanal: no arranca corridas nuevas hasta el lunes.`);
    else if (view.state === "warn") out.push(`${nameOf(p)} va al ${view.pct} % de su presupuesto semanal.`);
  }
  for (const role of RUNNER_ROLES) {
    const view = await budgetView(db, { kind: "role", role }, startsAt);
    if (view.limit == null || view.reason) continue;
    if (view.state === "stopped") out.push(`El rol ${role} llegó al 100 % de su presupuesto semanal: no arranca corridas nuevas hasta el lunes.`);
    else if (view.state === "warn") out.push(`El rol ${role} va al ${view.pct} % de su presupuesto semanal.`);
  }
  return out;
}

// Quiet and stuck look only at projects the company runs (switch on): a paused project is quiet on purpose.
async function quietAndStuck(db: Db, now: Date): Promise<{ quiet: string[]; stuck: string[] }> {
  const running = await db.select().from(projects).where(eq(projects.runsPaused, false)).orderBy(asc(projects.slug));
  const quiet: string[] = [];
  const stuck: string[] = [];
  for (const p of running) {
    const [last] = await db.select({ at: events.createdAt }).from(events).where(eq(events.projectId, p.id)).orderBy(desc(events.id)).limit(1);
    const since = last ? now.getTime() - last.at.getTime() : Infinity;
    if (since > QUIET_HOURS * HOUR) {
      quiet.push(last ? `${nameOf(p)} lleva ${Math.floor(since / (24 * HOUR))} días sin movimiento.` : `${nameOf(p)} no tiene movimiento todavía.`);
    }
    const rows = await db.execute<{ key: string; last_at: Date | null }>(sql`
      select t.key, (select max(e.created_at) from events e where e.task_id = t.id) as last_at
      from tasks t
      where t.project_id = ${p.id} and t.kind = 'ticket' and t.status = 'In progress'
      order by t.key`);
    const old = rows.rows.filter((r) => !r.last_at || now.getTime() - new Date(r.last_at).getTime() > STUCK_HOURS * HOUR);
    if (old.length > 0) {
      const first = old[0]!;
      const hours = first.last_at ? Math.floor((now.getTime() - new Date(first.last_at).getTime()) / HOUR) : null;
      const more = old.length > 1 ? ` (y ${old.length - 1} más)` : "";
      stuck.push(`${first.key} (${nameOf(p)}) está atascada: ${hours != null ? `${hours} h` : "mucho"} en curso sin movimiento${more}.`);
    }
  }
  return { quiet, stuck };
}

// The last two ended runs of one agent on one ticket both failed the same way.
async function repeatedFailures(db: Db, now: Date): Promise<{ line: string; ask: RepeatedFailure | null }[]> {
  const rows = await db
    .select({
      id: agentRuns.id,
      agentId: agentRuns.agentId,
      agent: agents.slug,
      projectId: agentRuns.projectId,
      project: projects.slug,
      projectTitle: projects.title,
      taskKey: agentRuns.taskKey,
      status: agentRuns.status,
      summary: agentRuns.summary,
      endedAt: agentRuns.endedAt,
    })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .innerJoin(projects, eq(projects.id, agentRuns.projectId))
    .where(and(inArray(agentRuns.status, ["ok", "fail", "stopped"]), gte(agentRuns.endedAt, new Date(now.getTime() - 7 * 24 * HOUR))))
    .orderBy(desc(agentRuns.endedAt));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.agentId}|${r.projectId}|${r.taskKey ?? ""}`;
    const list = groups.get(key) ?? [];
    if (list.length < 2) list.push(r);
    groups.set(key, list);
  }
  const out: { line: string; ask: RepeatedFailure | null }[] = [];
  for (const [, [a, b]] of groups) {
    if (!a || !b || a.status !== "fail" || b.status !== "fail") continue;
    const sig = failureSignature(a.summary);
    if (sig !== failureSignature(b.summary)) continue;
    const where = a.taskKey ? `${a.taskKey} (${a.projectTitle || a.project})` : a.projectTitle || a.project;
    out.push({
      line: `${a.agent} falló dos veces igual en ${where}: ${sig}.`,
      ask: a.taskKey ? { runId: a.id, project: a.project, taskKey: a.taskKey, agent: a.agent, summary: sig } : null,
    });
  }
  return out;
}

export async function findings(db: Db, now: Date): Promise<Findings> {
  const { quiet, stuck } = await quietAndStuck(db, now);
  return { budgets: await budgetLines(db, now), quiet, stuck, repeated: await repeatedFailures(db, now) };
}

export const findingLines = (f: Findings): string[] => [...f.repeated.map((r) => r.line), ...f.stuck, ...f.quiet, ...f.budgets];

// ---- Brief

export async function buildBrief(db: Db, now: Date): Promise<string[]> {
  const settings = await loadSettings(db);
  const all = await db.select().from(projects).orderBy(asc(projects.slug));
  const lines: string[] = [];
  const on = all.filter((p) => !p.runsPaused);
  if (settings.companyPaused) lines.push("La compañía está en pausa: no arranca ninguna corrida.");
  else if (on.length === 0) lines.push("Todos los proyectos están en pausa: no arranca ninguna corrida.");
  else lines.push(`Corren ${plural(on.length, "proyecto", "proyectos")}: ${on.map(nameOf).join(", ")}.`);

  const runs = await db.execute<{ total: number; ok: number; fail: number; tokens: string | null }>(sql`
    select count(*)::int as total,
           count(*) filter (where status = 'ok')::int as ok,
           count(*) filter (where status = 'fail')::int as fail,
           coalesce(sum(tokens_total), 0)::bigint as tokens
    from agent_runs
    where status in ('ok', 'fail', 'stopped') and ended_at >= ${new Date(now.getTime() - 24 * HOUR).toISOString()}::timestamptz`);
  const r = runs.rows[0];
  if (r && r.total > 0) {
    lines.push(`Últimas 24 h: ${plural(r.total, "corrida", "corridas")} (${r.ok} bien, ${r.fail} con fallo), ${n(Number(r.tokens ?? 0))} tokens.`);
  }

  lines.push(...findingLines(await findings(db, now)));

  const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(questions).where(isNull(questions.answeredAt));
  if ((open?.n ?? 0) > 0) lines.push(`${plural(open!.n, "pregunta te espera", "preguntas te esperan")} en Solo tú.`);

  const plan = planView(await lastReading(db), settings.planGuardPct, now);
  if (plan.state !== "unknown" && plan.five_hour_pct != null) lines.push(`Plan: la ventana de 5 h va al ${plan.five_hour_pct} % (guardia en ${plan.guard_pct} %).`);
  return lines;
}

export async function latestBrief(db: Db): Promise<Brief | null> {
  const [row] = await db.select({ payload: events.payload }).from(events).where(eq(events.type, "asistente.brief")).orderBy(desc(events.id)).limit(1);
  const p = row?.payload as { lines?: unknown; generated_at?: unknown } | undefined;
  if (!p || !Array.isArray(p.lines) || typeof p.generated_at !== "string") return null;
  return { lines: p.lines.filter((l): l is string => typeof l === "string"), generated_at: p.generated_at };
}

async function briefDate(db: Db): Promise<string | null> {
  const [row] = await db.select({ payload: events.payload }).from(events).where(eq(events.type, "asistente.brief")).orderBy(desc(events.id)).limit(1);
  const date = (row?.payload as { date?: unknown } | undefined)?.date;
  return typeof date === "string" ? date : null;
}

// ---- The job's tick

let lastCheck: string | null = null;
export function resetAsistenteForTests(): void {
  lastCheck = null;
}

export type AsistenteDeps = { tz?: string; env?: NodeJS.ProcessEnv };

async function askOnce(db: Db, f: RepeatedFailure): Promise<boolean> {
  const [project] = await db.select().from(projects).where(eq(projects.slug, f.project)).limit(1);
  if (!project) return false;
  const [task] = await db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(and(eq(tasks.projectId, project.id), eq(tasks.key, f.taskKey))).limit(1);
  if (!task) return false;
  // One open question from Asistente on the ticket is enough; it already sits in Solo tú.
  const [open] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.taskId, task.id), isNull(questions.answeredAt), sql`${questions.askedBy}->>'agent' = ${ASISTENTE_ACTOR.agent}`))
    .limit(1);
  if (open) return false;
  try {
    await ask(
      db,
      {
        project: f.project,
        key: f.taskKey,
        question: `${f.agent} falló dos veces seguidas igual en ${f.taskKey}: ${f.summary}. ¿Cómo sigo?`,
        urgency: "soon",
      },
      { actor: { ...ASISTENTE_ACTOR, machine: hostname() }, requestId: `asistente:fail2:${f.runId}`, tool: "ask" },
    );
    return true;
  } catch {
    // A closed ticket cannot be asked about; the line stays in the brief.
    return false;
  }
}

export type AsistenteTick = { brief: number; check: number; asks: number; no_home: number };

export async function runAsistente(db: Db, now = new Date(), deps: AsistenteDeps = {}): Promise<AsistenteTick> {
  const tz = deps.tz ?? screenTz();
  const env = deps.env ?? process.env;
  const out: AsistenteTick = { brief: 0, check: 0, asks: 0, no_home: 0 };
  const [home] = await db.select().from(projects).where(eq(projects.slug, homeProjectSlug(env))).limit(1);
  const ctx = { actor: { ...ASISTENTE_ACTOR, machine: hostname() }, tool: "jobs.asistente" };

  const { date, hour } = localParts(now, tz);
  if (hour >= BRIEF_HOUR && (await briefDate(db)) !== date) {
    if (!home) out.no_home = 1;
    else {
      const lines = await buildBrief(db, now);
      await writeTx(db, home, { ...ctx, requestId: `asistente:brief:${date}` }, async (_tx, emit) => {
        await emit("asistente.brief", null, { date, lines, generated_at: now.toISOString(), source: "summary" });
      });
      out.brief = 1;
    }
  }

  const slot = checkSlot(now, tz);
  if (slot !== lastCheck) {
    lastCheck = slot;
    out.check = 1;
    const f = await findings(db, now);
    for (const r of f.repeated) if (r.ask && (await askOnce(db, r.ask))) out.asks += 1;
    const lines = findingLines(f);
    if (home && lines.length > 0) {
      const [prev] = await db.select({ payload: events.payload }).from(events).where(eq(events.type, "asistente.check")).orderBy(desc(events.id)).limit(1);
      const prevLines = (prev?.payload as { lines?: unknown } | undefined)?.lines;
      if (JSON.stringify(prevLines) !== JSON.stringify(lines)) {
        await writeTx(db, home, { ...ctx, requestId: `asistente:check:${slot}` }, async (_tx, emit) => {
          await emit("asistente.check", null, { slot, lines, at: now.toISOString() });
        });
      }
    }
  }
  return out;
}
