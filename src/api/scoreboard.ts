// AUDIT-5: the quality scoreboard. One read over what Plania already stores (agent_runs, qa_lanes, tasks, events,
// thread_messages): no new table, no write. GET /api/scoreboard?days=28&project=<slug>&by=role|model|prompt_version|
// skills|resumed, session cookie only (mounted after the session check in routes.ts).
//
// What each number means:
//   runs                 finished runs of the group in the period (ok, fail or stopped; queued and skipped never ran)
//   tickets_landed       tickets that entered Merged, Released or Done in the period and have a run of the group
//   runs_per_ticket      the group's runs on those tickets over the tickets (runs up to LOOKBACK_DAYS before the
//   tokens_per_ticket    period count: a ticket's cost includes the work that started earlier); input + output tokens
//   qa_first             attempt-1 QA lanes that passed over attempt-1 lanes concluded (pass or fail) in the period
//   sent_back            QA-passed deliveries the owner sent back with «Pedir cambios», over QA-passed deliveries
//   failures             failed runs by the reason in the run summary; max-turn failures are also counted apart
//   blocked_after_two    tickets Plania moved to Blocked after the same agent failed twice in a row (runner/failed.ts)
//   resumed              share of resumed runs among ok + fail runs, and the ok rate of resumed against fresh runs
//   context_tokens_median  the median context the last turn carried, over runs that recorded it
// A rate is null, never zero, when its denominator is empty.
//
// Group keys come from the run row. A QA lane, an owner's send-back and a Blocked ticket have no group of their
// own: each is attributed to a run. A delivery belongs to the newest Taller run on the ticket that started before
// the lane opened; a Blocked ticket to the failed run that caused it. Outcomes with no such run count in `total` only.
//
// to_read is the weekly reading: the newest failed runs, QA returns and owner send-backs with the run summary and
// the QA notes. No file path, token or env value leaves here: the run's cwd, worktree and log columns are never
// selected, and free text passes through scrub().
import { Hono, type Context } from "hono";
import { sql, type SQL } from "drizzle-orm";
import { withDb, type Db } from "../db/client.js";
import { ToolError, findProject } from "../mcp/queries.js";
import { SYSTEM_ACTOR } from "../mcp/tx.js";

export const SCOREBOARD_GROUPS = ["role", "model", "prompt_version", "skills", "resumed"] as const;
export type ScoreboardBy = (typeof SCOREBOARD_GROUPS)[number];

const LANDED = ["Merged", "Released", "Done"];
const LOOKBACK_DAYS = 90;
const TO_READ = 30;
const BUILDER = "taller";

type Rate = number | null;
export type ScoreGroup = {
  key: string | null;
  runs: number;
  tickets_landed: number;
  runs_per_ticket: Rate;
  tokens_per_ticket: Rate;
  qa_first: { passed: number; concluded: number; rate: Rate };
  sent_back: { count: number; passed: number; rate: Rate };
  failures: { total: number; max_turns: number; other: number; by_reason: { reason: string; count: number }[] };
  blocked_after_two: number;
  resumed: { runs: number; fresh_runs: number; share: Rate; ok_rate_resumed: Rate; ok_rate_fresh: Rate };
  context_tokens_median: number | null;
};
export type ReadItem = {
  kind: "failed" | "returned" | "sent_back";
  project: string;
  key: string | null;
  // The ticket's title, so the screen can name the work in the owner's words.
  title: string | null;
  role: string | null;
  at: string;
  summary: string | null;
  qa_notes: string | null;
  attempt: number | null;
  owner_text: string | null;
};
export type Scoreboard = {
  days: number;
  since: string;
  until: string;
  project: string | null;
  by: ScoreboardBy;
  empty: boolean;
  total: ScoreGroup;
  groups: ScoreGroup[];
  to_read: ReadItem[];
};

type RunRow = {
  id: string;
  agent_id: string;
  project_id: string;
  project: string;
  task_key: string | null;
  role: string;
  status: string;
  summary: string;
  resumed: boolean;
  requested_model: string | null;
  prompt_version: string | null;
  skills: string[];
  tokens: number;
  context_tokens: number | null;
  at: Date;
  started: Date;
} & Record<string, unknown>;
type LaneRow = { id: string; project_id: string; project: string; task_key: string; attempt: number; status: string; returned: boolean; notes: string | null; created_at: Date; ended_at: Date } & Record<string, unknown>;
type LandedRow = { project_id: string; key: string } & Record<string, unknown>;
type ChangeRow = { project_id: string; project: string; ticket: string | null; text: string | null; at: Date } & Record<string, unknown>;
type BlockedRow = { project_id: string; task_key: string | null; at: Date } & Record<string, unknown>;

// "fail: error_max_turns (41 turns, session 491bc14d)" → "error_max_turns". A run the timeout ended is "timeout",
// whatever the CLI said last. Only the words before the first parenthesis are kept, so a message never leaks.
export function failureReason(summary: string): string {
  if (/after timeout\s*$/i.test(summary)) return "timeout";
  const words = summary.replace(/^fail:\s*/i, "").split("(")[0]!.trim().slice(0, 60);
  return words || "unknown";
}
export const isMaxTurns = (reason: string): boolean => /max_turns/i.test(reason);

// Free text for the reading list: absolute paths, secret-looking strings and NAME=value pairs are replaced.
export function scrub(text: string | null | undefined, max = 1200): string | null {
  if (!text?.trim()) return null;
  return text
    .replace(/\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|plania)[-_][A-Za-z0-9_-]{16,}/g, "[oculto]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [oculto]")
    .replace(/\b([A-Z][A-Z0-9_]{2,})=("[^"]*"|'[^']*'|\S+)/g, "$1=[oculto]")
    .replace(/(?<![\w.:/-])(?:~|\/(?:Users|home|private|var|tmp|opt|etc|root|Volumes))\/[^\s"'`)\]]*/g, "[ruta]")
    .replace(/\b[A-Za-z]:\\[^\s"'`)\]]*/g, "[ruta]")
    .trim()
    .slice(0, max);
}

const rate = (n: number, d: number): Rate => (d > 0 ? n / d : null);

// db.execute returns timestamps as text; the arithmetic below wants Dates.
function dated<T extends Record<string, unknown>>(rows: T[], ...columns: (keyof T)[]): T[] {
  for (const row of rows) for (const c of columns) row[c] = new Date(row[c] as unknown as string) as T[keyof T];
  return rows;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export function groupKey(by: ScoreboardBy, r: Pick<RunRow, "role" | "requested_model" | "prompt_version" | "skills" | "resumed">): string | null {
  if (by === "role") return r.role;
  if (by === "model") return r.requested_model;
  if (by === "prompt_version") return r.prompt_version;
  if (by === "skills") return r.skills.length ? [...r.skills].sort().join(", ") : null;
  return r.resumed ? "resumed" : "fresh";
}

// One bucket of raw counts; ALL is the same bucket over everything (the `total` row).
class Bucket {
  runs: RunRow[] = [];
  landed = new Set<string>();
  ticketRuns = 0;
  ticketTokens = 0;
  qaPassed = 0;
  qaConcluded = 0;
  passed = 0;
  sentBack = 0;
  blocked = new Set<string>();
  constructor(readonly key: string | null) {}

  out(): ScoreGroup {
    const fails = this.runs.filter((r) => r.status === "fail");
    const reasons = new Map<string, number>();
    for (const r of fails) reasons.set(failureReason(r.summary), (reasons.get(failureReason(r.summary)) ?? 0) + 1);
    const maxTurns = [...reasons].filter(([reason]) => isMaxTurns(reason)).reduce((n, [, c]) => n + c, 0);
    // Stopped runs are nobody's failure (the owner or a switch stopped them): the resumed numbers read ok and fail only.
    const judged = this.runs.filter((r) => r.status === "ok" || r.status === "fail");
    const resumed = judged.filter((r) => r.resumed);
    const fresh = judged.filter((r) => !r.resumed);
    const ok = (rows: RunRow[]) => rows.filter((r) => r.status === "ok").length;
    return {
      key: this.key,
      runs: this.runs.length,
      tickets_landed: this.landed.size,
      runs_per_ticket: rate(this.ticketRuns, this.landed.size),
      tokens_per_ticket: this.landed.size ? Math.round(this.ticketTokens / this.landed.size) : null,
      qa_first: { passed: this.qaPassed, concluded: this.qaConcluded, rate: rate(this.qaPassed, this.qaConcluded) },
      sent_back: { count: this.sentBack, passed: this.passed, rate: rate(this.sentBack, this.passed) },
      failures: {
        total: fails.length,
        max_turns: maxTurns,
        other: fails.length - maxTurns,
        by_reason: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
      },
      blocked_after_two: this.blocked.size,
      resumed: { runs: resumed.length, fresh_runs: fresh.length, share: rate(resumed.length, judged.length), ok_rate_resumed: rate(ok(resumed), resumed.length), ok_rate_fresh: rate(ok(fresh), fresh.length) },
      context_tokens_median: median(this.runs.flatMap((r) => (r.context_tokens === null ? [] : [r.context_tokens]))),
    };
  }
}

export async function scoreboard(db: Db, input: { days?: number; project?: string; by?: ScoreboardBy; now?: Date } = {}): Promise<Scoreboard> {
  const days = input.days ?? 28;
  const by = input.by ?? "role";
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const lookback = new Date(since.getTime() - LOOKBACK_DAYS * 86_400_000);
  const project = input.project ? await findProject(db, input.project) : null;
  const inProject = (column: SQL): SQL => (project ? sql`and ${column} = ${project.id}` : sql``);
  const landedList = sql.join(LANDED.map((s) => sql`${s}`), sql`, `);

  // Finished runs, with the lookback: older runs are a landed ticket's cost and can own a delivery.
  const runs = dated(
    (await db.execute<RunRow>(sql`
      select r.id, r.agent_id, r.project_id, p.slug as project, r.task_key, r.role, r.status, r.summary, r.resumed,
             r.requested_model, r.prompt_version, r.skills,
             (r.input_tokens + r.output_tokens)::float8 as tokens, r.context_tokens::float8 as context_tokens,
             coalesce(r.ended_at, r.started_at, r.queued_at) as at, coalesce(r.started_at, r.queued_at) as started
      from agent_runs r join projects p on p.id = r.project_id
      where r.status in ('ok', 'fail', 'stopped')
        and coalesce(r.ended_at, r.started_at, r.queued_at) >= ${lookback.toISOString()}::timestamptz
        and coalesce(r.ended_at, r.started_at, r.queued_at) <= ${now.toISOString()}::timestamptz
        ${inProject(sql`r.project_id`)}
      order by coalesce(r.ended_at, r.started_at, r.queued_at), r.id`)).rows,
    "at",
    "started",
  );

  // A ticket landed when it last entered Merged, Released or Done from outside them (Merged → Released is one landing).
  const landed = (
    await db.execute<LandedRow>(sql`
      select t.project_id, t.key
      from tasks t
      left join lateral (
        select max(e.created_at) as at from events e
        where e.task_id = t.id and e.type = 'task.status' and e.payload->>'to' in (${landedList})
          and coalesce(e.payload->>'from', '') not in (${landedList})
      ) entered on true
      where t.kind = 'ticket' and t.status in (${landedList})
        and coalesce(entered.at, t.resolved_at, t.status_changed_at, t.updated_at) >= ${since.toISOString()}::timestamptz
        and coalesce(entered.at, t.resolved_at, t.status_changed_at, t.updated_at) <= ${now.toISOString()}::timestamptz
        ${inProject(sql`t.project_id`)}`)
  ).rows;

  // Lanes QA concluded. The lookback ones only tell what a send-back was answering; the period's ones are counted.
  const lanes = dated(
    (await db.execute<LaneRow>(sql`
      select l.id, l.project_id, p.slug as project, l.task_key, l.attempt, l.status, l.returned, l.notes, l.created_at, l.ended_at
      from qa_lanes l join projects p on p.id = l.project_id
      where l.status in ('pass', 'fail') and l.ended_at >= ${lookback.toISOString()}::timestamptz and l.ended_at <= ${now.toISOString()}::timestamptz
        ${inProject(sql`l.project_id`)}
      order by l.ended_at, l.id`)).rows,
    "created_at",
    "ended_at",
  );

  // «Pedir cambios»: action_state {action: "cambios", at, result: {ticket, text}} on the message the owner acted on.
  const changes = dated(
    (await db.execute<ChangeRow>(sql`
      select th.project_id, p.slug as project, m.action_state->'result'->>'ticket' as ticket, m.action_state->'result'->>'text' as text,
             (m.action_state->>'at')::timestamptz as at
      from thread_messages m join threads th on th.id = m.thread_id join projects p on p.id = th.project_id
      where m.action_state->>'action' = 'cambios'
        and (m.action_state->>'at')::timestamptz >= ${since.toISOString()}::timestamptz
        and (m.action_state->>'at')::timestamptz <= ${now.toISOString()}::timestamptz
        ${inProject(sql`th.project_id`)}
      order by (m.action_state->>'at')::timestamptz, m.id`)).rows,
    "at",
  );

  // Plania's own moves to Blocked; which of them followed two failures in a row is decided below, from the runs.
  const blockedMoves = dated(
    (await db.execute<BlockedRow>(sql`
      select e.project_id, e.task_key, e.created_at as at
      from events e
      where e.type = 'task.status' and e.payload->>'to' = 'Blocked' and e.actor->>'agent' = ${SYSTEM_ACTOR.agent}
        and e.created_at >= ${since.toISOString()}::timestamptz and e.created_at <= ${now.toISOString()}::timestamptz
        ${inProject(sql`e.project_id`)}
      order by e.created_at, e.id`)).rows,
    "at",
  );

  const ticketId = (projectId: string, key: string) => `${projectId}/${key}`;
  const runsByTicket = new Map<string, RunRow[]>();
  for (const r of runs) {
    if (!r.task_key) continue;
    const id = ticketId(r.project_id, r.task_key);
    (runsByTicket.get(id) ?? runsByTicket.set(id, []).get(id)!).push(r);
  }
  // The newest builder run on the ticket that started before `at`: the run that made that delivery.
  const deliveryRun = (projectId: string, key: string, at: Date): RunRow | null => {
    const mine = (runsByTicket.get(ticketId(projectId, key)) ?? []).filter((r) => r.role === BUILDER && r.started.getTime() <= at.getTime());
    return mine.length ? mine.reduce((a, b) => (b.started.getTime() >= a.started.getTime() ? b : a)) : null;
  };

  const all = new Bucket(null);
  const buckets = new Map<string | null, Bucket>();
  const bucketOf = (r: RunRow): Bucket => {
    const key = groupKey(by, r);
    return buckets.get(key) ?? buckets.set(key, new Bucket(key)).get(key)!;
  };
  // Every outcome lands in `total`, and in its run's group when it has a run.
  const both = (r: RunRow | null): Bucket[] => (r ? [all, bucketOf(r)] : [all]);

  for (const r of runs) if (r.at.getTime() >= since.getTime()) for (const b of both(r)) b.runs.push(r);

  for (const t of landed) {
    const id = ticketId(t.project_id, t.key);
    const mine = runsByTicket.get(id) ?? [];
    all.landed.add(id);
    all.ticketRuns += mine.length;
    all.ticketTokens += mine.reduce((n, r) => n + r.tokens, 0);
    for (const r of mine) {
      const b = bucketOf(r);
      b.landed.add(id);
      b.ticketRuns += 1;
      b.ticketTokens += r.tokens;
    }
  }

  // The owner's send-backs, each matched to the last lane QA concluded on that ticket before it.
  const sentBack = new Set<string>();
  const changeLane = new Map<ChangeRow, LaneRow | null>();
  for (const c of changes) {
    const before = c.ticket ? lanes.filter((l) => l.project_id === c.project_id && l.task_key === c.ticket && l.ended_at.getTime() <= c.at.getTime()) : [];
    const last = before.at(-1) ?? null;
    changeLane.set(c, last);
    if (last?.status === "pass") sentBack.add(last.id);
  }

  const periodLanes = lanes.filter((l) => l.ended_at.getTime() >= since.getTime());
  for (const l of periodLanes) {
    for (const b of both(deliveryRun(l.project_id, l.task_key, l.created_at))) {
      if (l.attempt === 1) {
        b.qaConcluded += 1;
        if (l.status === "pass") b.qaPassed += 1;
      }
      if (l.status === "pass") {
        b.passed += 1;
        if (sentBack.has(l.id)) b.sentBack += 1;
      }
    }
  }

  // runner/failed.ts: the second failure in a row of the same agent on the ticket moves it to Blocked.
  for (const e of blockedMoves) {
    if (!e.task_key) continue;
    const prior = (runsByTicket.get(ticketId(e.project_id, e.task_key)) ?? []).filter((r) => r.at.getTime() <= e.at.getTime());
    const last = prior.at(-1);
    if (!last || last.status !== "fail") continue;
    const sameAgent = prior.filter((r) => r.agent_id === last.agent_id);
    if (sameAgent.length < 2 || sameAgent.at(-2)!.status !== "fail") continue;
    for (const b of both(last)) b.blocked.add(ticketId(e.project_id, e.task_key));
  }

  const iso = (d: Date) => d.toISOString();
  const toRead: ReadItem[] = [
    ...runs
      .filter((r) => r.status === "fail" && r.at.getTime() >= since.getTime())
      .map((r): ReadItem => ({ kind: "failed", project: r.project, key: r.task_key, title: null, role: r.role, at: iso(r.at), summary: scrub(r.summary, 500), qa_notes: null, attempt: null, owner_text: null })),
    ...periodLanes
      .filter((l) => l.status === "fail")
      .map((l): ReadItem => {
        const r = deliveryRun(l.project_id, l.task_key, l.created_at);
        return { kind: "returned", project: l.project, key: l.task_key, title: null, role: r?.role ?? null, at: iso(l.ended_at), summary: scrub(r?.summary, 500), qa_notes: scrub(l.notes), attempt: l.attempt, owner_text: null };
      }),
    ...changes.map((c): ReadItem => {
      const lane = changeLane.get(c) ?? null;
      const r = c.ticket ? deliveryRun(c.project_id, c.ticket, lane?.created_at ?? c.at) : null;
      return { kind: "sent_back", project: c.project, key: c.ticket, title: null, role: r?.role ?? null, at: iso(c.at), summary: scrub(r?.summary, 500), qa_notes: scrub(lane?.notes), attempt: lane?.attempt ?? null, owner_text: scrub(c.text) };
    }),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, TO_READ);

  // Titles for the few items kept, in one read.
  const keys = [...new Set(toRead.flatMap((i) => (i.key ? [i.key] : [])))];
  if (keys.length) {
    const titles = (
      await db.execute<{ project: string; key: string; title: string }>(sql`
        select p.slug as project, t.key, t.title from tasks t join projects p on p.id = t.project_id
        where t.key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)}) ${inProject(sql`t.project_id`)}`)
    ).rows;
    const titleOf = new Map(titles.map((t) => [`${t.project}/${t.key}`, t.title]));
    for (const i of toRead) i.title = scrub(titleOf.get(`${i.project}/${i.key}`), 200);
  }

  const groups = [...buckets.values()].map((b) => b.out()).sort((a, b) => b.runs - a.runs || b.tickets_landed - a.tickets_landed || String(a.key).localeCompare(String(b.key)));
  const total = all.out();
  return {
    days,
    since: iso(since),
    until: iso(now),
    project: project?.slug ?? null,
    by,
    empty: total.runs === 0 && total.tickets_landed === 0 && total.qa_first.concluded === 0 && total.sent_back.passed === 0 && toRead.length === 0,
    total,
    groups,
    to_read: toRead,
  };
}

export const scoreboardRoutes = new Hono();

function fail(c: Context, e: unknown): Response {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
}

scoreboardRoutes.get("/", async (c) => {
  const rawDays = c.req.query("days")?.trim();
  const days = rawDays ? Number(rawDays) : 28;
  if (!Number.isInteger(days) || days < 1 || days > 365) return c.json({ error: "INVALID_FILTER", field: "days" }, 400);
  const by = (c.req.query("by")?.trim() || "role") as ScoreboardBy;
  if (!SCOREBOARD_GROUPS.includes(by)) return c.json({ error: "INVALID_FILTER", field: "by" }, 400);
  const project = c.req.query("project")?.trim() || undefined;
  try {
    return c.json(await withDb((db) => scoreboard(db, { days, project, by })));
  } catch (e) {
    return fail(c, e);
  }
});
