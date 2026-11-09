// PLA-I31-2: Asistente, the chief of staff. PLA-I32-5: Asistente is a runner role now.
// - At 07:00 the job queues an Asistente run that writes the brief in the company thread. Only when it cannot
//   run (wakes off, no runner agent, company paused, its budget stopped) or its run ends without success is
//   the server summary below written instead, marked as such, in the thread and as asistente.brief.
// - Every 2 hours: routine acceptance (a PO's ticket In review that Jorge asked for, ops or research, with
//   every check done → Done, with a line in the project thread), the weekly proposal wake of an idle PO with
//   a goal (2-3 ideas, at most once a week), and the findings below; when they change an Asistente run is
//   queued to write them up, or the server posts them when it cannot run.
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
import { agentRuns, agents, events, projects, questions, tasks, threadMessages, type Actor, type Project } from "../db/schema.js";
import { ask } from "../mcp/questions.js";
import { writeTx } from "../mcp/tx.js";
import { budgetView, lastReading, loadSettings, planView, roleOf, screenTz, weekBounds } from "./limits.js";
import { asistenteAgent, enqueueWake, eventWakesEnabled } from "./events.js";
import { projectGoal } from "./runner.js";
import { asistenteHome, companyThread, postMessage, projectThread } from "./threads.js";
import { setTask } from "../mcp/writes.js";

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
  // PLA-I32-5: role budgets are retired; Asistente has its own.
  const own = await budgetView(db, { kind: "asistente" }, startsAt);
  if (own.limit != null && !own.reason) {
    if (own.state === "stopped") out.push("Asistente llegó al 100 % de su presupuesto semanal: escribo con el resumen del servidor hasta el lunes.");
    else if (own.state === "warn") out.push(`Asistente va al ${own.pct} % de su presupuesto semanal.`);
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

  const accepted = await db
    .select({ key: events.taskKey })
    .from(events)
    .where(and(eq(events.type, "asistente.accepted"), gte(events.createdAt, new Date(now.getTime() - 24 * HOUR))))
    .orderBy(asc(events.id));
  if (accepted.length > 0) lines.push(`Acepté ${plural(accepted.length, "entregable de rutina", "entregables de rutina")}: ${accepted.map((a) => a.key).join(", ")}.`);

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

export type AsistenteTick = {
  brief: number;
  brief_run: number;
  check: number;
  check_run: number;
  asks: number;
  accepted: number;
  proposals: number;
  no_home: number;
};

const ENDED_BADLY = new Set(["fail", "skipped", "stopped"]);
// A brief run still queued this long after 07:00 gives way to the server summary.
const BRIEF_WAIT_MS = 3 * HOUR;
const WEEK_MS = 7 * 24 * HOUR;

// One Asistente run, queued in its home project, or null when it cannot run now: wakes off, no runner
// agent, company paused, its budget stopped, or a run already going. A queued run takes the new reason too.
export async function queueAsistente(db: Db, home: Project, reason: string, env: NodeJS.ProcessEnv, now: Date): Promise<string | null> {
  if (!eventWakesEnabled(env)) return null;
  const agent = await asistenteAgent(db);
  if (!agent) return null;
  const { startsAt } = await weekBounds(db, now);
  if ((await budgetView(db, { kind: "asistente" }, startsAt)).state === "stopped") return null;
  return writeTx(db, home, { actor: { ...ASISTENTE_ACTOR, machine: hostname() }, tool: "jobs.asistente.queue" }, async (tx, emit) => {
    const out = await enqueueWake(tx, { agent, project: home, taskKey: null, reason, now });
    if (out.kind === "queued") {
      await emit("wake.queued", null, { agent: out.agent, role: out.role, reason, run_id: out.runId, from_event: "asistente.job" });
      return out.runId;
    }
    if (out.reason !== "coalesced") return null;
    const [queued] = await tx
      .select({ id: agentRuns.id, summary: agentRuns.summary })
      .from(agentRuns)
      .where(and(eq(agentRuns.agentId, agent.id), eq(agentRuns.status, "queued")))
      .limit(1);
    if (!queued) return null;
    await tx.update(agentRuns).set({ summary: `${queued.summary}; ${reason}`.slice(0, 500) }).where(eq(agentRuns.id, queued.id));
    return queued.id;
  });
}

const actorCtx = (tool: string) => ({ actor: { ...ASISTENTE_ACTOR, machine: hostname() }, tool });

async function serverBrief(db: Db, home: Project, date: string, now: Date, why: string): Promise<void> {
  const lines = await buildBrief(db, now);
  await writeTx(db, home, { ...actorCtx("jobs.asistente"), requestId: `asistente:brief:${date}` }, async (_tx, emit) => {
    await emit("asistente.brief", null, { date, lines, generated_at: now.toISOString(), source: "summary", why });
  });
  const body = [`Resumen del servidor (${why}):`, ...lines.map((l) => `- ${l}`)].join("\n").slice(0, 4000);
  await postMessage(db, { thread: await companyThread(db), project: null }, { author: { agent: "asistente", role: "asistente" }, body }, actorCtx("jobs.asistente.brief"));
}

async function briefEvents(db: Db, date: string): Promise<{ done: boolean; runId: string | null }> {
  const rows = await db
    .select({ type: events.type, payload: events.payload })
    .from(events)
    .where(and(inArray(events.type, ["asistente.brief", "asistente.brief_run"]), sql`${events.payload}->>'date' = ${date}`));
  const run = rows.find((r) => r.type === "asistente.brief_run");
  return { done: rows.some((r) => r.type === "asistente.brief"), runId: (run?.payload as { run_id?: string } | undefined)?.run_id ?? null };
}

async function brief(db: Db, home: Project, date: string, now: Date, env: NodeJS.ProcessEnv, out: AsistenteTick): Promise<void> {
  const state = await briefEvents(db, date);
  if (state.done) return;
  if (!state.runId) {
    const runId = await queueAsistente(db, home, `brief ${date}: write the morning brief in the company thread`, env, now);
    if (runId) {
      await writeTx(db, home, { ...actorCtx("jobs.asistente"), requestId: `asistente:brief_run:${date}` }, async (_tx, emit) => {
        await emit("asistente.brief_run", null, { date, run_id: runId, at: now.toISOString() });
      });
      out.brief_run = 1;
      return;
    }
    await serverBrief(db, home, date, now, "Asistente no pudo correr");
    out.brief = 1;
    return;
  }
  const [run] = await db.select({ status: agentRuns.status, queuedAt: agentRuns.queuedAt }).from(agentRuns).where(eq(agentRuns.id, state.runId)).limit(1);
  if (run?.status === "ok") {
    await writeTx(db, home, { ...actorCtx("jobs.asistente"), requestId: `asistente:brief:${date}` }, async (_tx, emit) => {
      await emit("asistente.brief", null, { date, lines: [], generated_at: now.toISOString(), source: "run", run_id: state.runId });
    });
    out.brief = 1;
    return;
  }
  const late = run?.status === "queued" && now.getTime() - run.queuedAt.getTime() > BRIEF_WAIT_MS;
  if (!run || ENDED_BADLY.has(run.status) || late) {
    await serverBrief(db, home, date, now, "la corrida de Asistente no terminó bien");
    out.brief = 1;
  }
}

// A PO's ticket that Jorge asked for (origin jorge), ops or research, In review with every check done or
// waived: Asistente accepts it (Done), says so in the project thread and lists it in the next brief.
export async function routineAccept(db: Db, now: Date): Promise<number> {
  const rows = await db.execute<{ id: string; key: string; title: string; version: number; project: string; project_id: string; owner: string }>(sql`
    select t.id, t.key, t.title, t.version, p.slug as project, p.id as project_id, t.owner_agent as owner
    from tasks t join projects p on p.id = t.project_id
    where t.kind = 'ticket' and t.status = 'In review' and t.origin = 'jorge' and t.work_type in ('ops', 'research') and t.owner_agent is not null
      and not exists (select 1 from checks c where c.task_id = t.id and not c.done and c.waived_at is null)
    order by t.key`);
  let n = 0;
  for (const r of rows.rows) {
    const [owner] = await db.select().from(agents).where(eq(agents.id, r.owner)).limit(1);
    if (!owner || roleOf(owner) !== "product-owner") continue;
    try {
      await setTask(db, { project: r.project, key: r.key, status: "Done", version: r.version, note: "Aceptado por Asistente: lo pidió Jorge y sus checks están hechos." } as never, actorCtx("jobs.asistente.accept"));
    } catch {
      continue;
    }
    const [project] = await db.select().from(projects).where(eq(projects.id, r.project_id)).limit(1);
    const thread = await projectThread(db, r.project_id);
    const at = now.toISOString();
    await db
      .update(threadMessages)
      .set({ actionState: { action: "aceptar", at, result: { ticket: r.key, status: "Done", by: "asistente" } } })
      .where(and(eq(threadMessages.threadId, thread.id), sql`${threadMessages.actionState} is null`, sql`${threadMessages.links} @> ${JSON.stringify([{ kind: "ticket", ref: r.key }])}::jsonb`));
    await postMessage(
      db,
      { thread, project: project! },
      { author: { agent: "asistente", role: "asistente" }, body: `Acepté ${r.key}: ${r.title}. Lo pediste tú y sus checks están hechos.`, links: [{ kind: "ticket", ref: r.key, title: r.title.slice(0, 200) }] },
      actorCtx("jobs.asistente.accept"),
    );
    await writeTx(db, project!, actorCtx("jobs.asistente.accept"), async (_tx, emit) => {
      await emit("asistente.accepted", { id: r.id, key: r.key }, { owner: owner.slug });
    });
    n += 1;
  }
  return n;
}

const OPEN_FOR_PO = ["Ready", "In progress", "Needs Jorge"];

// A PO with a goal and nothing to do (no Ready, In progress or Needs Jorge ticket of its own, no run going)
// is woken once a week at most to put 2-3 ideas in its project thread and ask Jorge which one.
export async function idleProposals(db: Db, env: NodeJS.ProcessEnv, now: Date): Promise<number> {
  if (!eventWakesEnabled(env)) return 0;
  let n = 0;
  for (const p of await db.select().from(projects).where(eq(projects.runsPaused, false)).orderBy(asc(projects.slug))) {
    if (!(await projectGoal(db, p.id))) continue;
    const pos = (await db.select().from(agents).where(and(eq(agents.adapter, "claude_code"), sql`${agents.status} <> 'retired'`))).filter((a) => roleOf(a) === "product-owner");
    const po = pos.find((a) => a.projectId === p.id) ?? pos.find((a) => !a.projectId && (a.slug === `po-${p.slug}` || a.capabilities.includes(p.slug)));
    if (!po) continue;
    const [work] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.projectId, p.id), eq(tasks.ownerAgent, po.id), eq(tasks.kind, "ticket"), inArray(tasks.status, OPEN_FOR_PO)))
      .limit(1);
    if (work) continue;
    const [recent] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.projectId, p.id), eq(events.type, "po.propose_queued"), gte(events.createdAt, new Date(now.getTime() - WEEK_MS))))
      .limit(1);
    if (recent) continue;
    const queued = await writeTx(db, p, actorCtx("jobs.asistente.propose"), async (tx, emit) => {
      const out = await enqueueWake(tx, { agent: po, project: p, taskKey: null, reason: "idle with a goal: propose 2-3 ideas in the project thread and ask Jorge to pick one", now });
      if (out.kind !== "queued") return false;
      await emit("po.propose_queued", null, { agent: po.slug, run_id: out.runId });
      return true;
    });
    if (queued) n += 1;
  }
  return n;
}

export async function runAsistente(db: Db, now = new Date(), deps: AsistenteDeps = {}): Promise<AsistenteTick> {
  const tz = deps.tz ?? screenTz();
  const env = deps.env ?? process.env;
  const out: AsistenteTick = { brief: 0, brief_run: 0, check: 0, check_run: 0, asks: 0, accepted: 0, proposals: 0, no_home: 0 };
  const home = await asistenteHome(db, env);

  const { date, hour } = localParts(now, tz);
  if (hour >= BRIEF_HOUR) {
    if (!home) out.no_home = 1;
    else await brief(db, home, date, now, env, out);
  }

  const slot = checkSlot(now, tz);
  if (slot !== lastCheck) {
    lastCheck = slot;
    out.check = 1;
    out.accepted = await routineAccept(db, now);
    out.proposals = await idleProposals(db, env, now);
    const f = await findings(db, now);
    for (const r of f.repeated) if (r.ask && (await askOnce(db, r.ask))) out.asks += 1;
    const lines = findingLines(f);
    if (home && lines.length > 0) {
      const [prev] = await db.select({ payload: events.payload }).from(events).where(eq(events.type, "asistente.check")).orderBy(desc(events.id)).limit(1);
      const prevLines = (prev?.payload as { lines?: unknown } | undefined)?.lines;
      if (JSON.stringify(prevLines) !== JSON.stringify(lines)) {
        await writeTx(db, home, { ...actorCtx("jobs.asistente"), requestId: `asistente:check:${slot}` }, async (_tx, emit) => {
          await emit("asistente.check", null, { slot, lines, at: now.toISOString() });
        });
        const runId = await queueAsistente(db, home, `2-hour check: ${lines.length} finding(s) (stuck, quiet, repeated failures); post them in the right threads`, env, now);
        if (runId) out.check_run = 1;
        else {
          const body = ["Revisión del servidor:", ...lines.map((l) => `- ${l}`)].join("\n").slice(0, 4000);
          await postMessage(db, { thread: await companyThread(db), project: null }, { author: { agent: "asistente", role: "asistente" }, body }, actorCtx("jobs.asistente.check"));
        }
      }
    }
  }
  return out;
}
