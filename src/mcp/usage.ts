import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { readerOf, uowOf } from "../store/port.js";
import { ToolError } from "./errors.js";
import { findProject, requireTask } from "./queries.js";
import { iso, writeTx, type Ctx } from "./tx.js";
import { weekBounds, weekUsage } from "../runner/limits.js";

// PLA-I25: agents report how many tokens a task run used. Plania sums them per agent,
// project and week and shows the word «reportado». The numbers are not a cap.

export const USAGE_LABEL = "reportado" as const;

const WEEK = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const COUNT_MAX = 2_000_000_000;

export type UsageTotal = {
  agent: string;
  project: string;
  week: string;
  input: number;
  output: number;
  // PLA-I46-5: cache tokens on their own, never inside input or output.
  cache_read: number;
  cache_create: number;
};

// PLA-I46-5: the week as Máquina shows it, from the runner's own runs: used is input + output; cache apart.
export type UsageWeek = { week: string; starts_at: string; used: number; input: number; output: number; cache_read: number; cache_create: number };

export type UsageSummary = {
  label: typeof USAGE_LABEL;
  totals: UsageTotal[];
  screen: UsageWeek;
};

export type ReportTokensInput = {
  project: string;
  agent: string;
  task_key: string;
  run_id: string;
  model: string;
  input: number;
  output: number;
  // PLA-I29: cache tokens from modelUsage. Optional; 0 when omitted.
  cache_read?: number;
  cache_create?: number;
  at?: string;
};

export type ReportTokensResult = {
  label: typeof USAGE_LABEL;
  project: string;
  agent: string;
  task_key: string;
  run_id: string;
  model: string;
  input: number;
  output: number;
  at: string;
};

function checkCount(field: "input" | "output" | "cache_read" | "cache_create", value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new ToolError("INVALID_FILTER", { field });
  if (value > COUNT_MAX) throw new ToolError("TOO_LARGE", { field, max: COUNT_MAX });
  return value;
}

function checkText(field: string, value: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new ToolError("INVALID_FILTER", { field, max });
  return trimmed;
}

function parseAt(value: string | undefined): Date {
  if (value === undefined || value.trim() === "") return new Date();
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new ToolError("INVALID_FILTER", { field: "at" });
  return at;
}

function screenTz(): string {
  return process.env.PLANIA_TZ || "America/Mexico_City";
}

// The ISO week (YYYY-Www) of an instant's date in a time zone, as Postgres' to_char(at at time zone tz, 'IYYY-"W"IW').
function isoWeekOf(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const day = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  // The Thursday of the date's Monday-to-Sunday week decides the ISO year.
  day.setUTCDate(day.getUTCDate() + 3 - ((day.getUTCDay() + 6) % 7));
  const year = day.getUTCFullYear();
  const week = Math.floor((day.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// Noon UTC on the Thursday of an ISO week (YYYY-Www): inside that Monday-to-Sunday week in any time zone, so
// weekBounds gives its Monday 00:00 there (what to_date(week, 'IYYY-"W"IW') at time zone tz did).
function isoWeekThursday(week: string): Date {
  const [year, w] = [Number(week.slice(0, 4)), Number(week.slice(6))];
  const jan4 = Date.UTC(year, 0, 4);
  const monday1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86_400_000;
  return new Date(monday1 + (w - 1) * 7 * 86_400_000 + 3.5 * 86_400_000);
}

// Same project, agent, task and run replaces the previous counts. A new run_id adds a row.
export async function reportTokens(db: Db, input: ReportTokensInput, ctx: Ctx): Promise<ReportTokensResult> {
  const project = await findProject(db, input.project);
  const agent = checkText("agent", input.agent, 60);
  const taskKey = checkText("task_key", input.task_key, 80);
  const runId = checkText("run_id", input.run_id, 120);
  const model = checkText("model", input.model, 80);
  const inputCount = checkCount("input", input.input);
  const outputCount = checkCount("output", input.output);
  const cacheRead = checkCount("cache_read", input.cache_read ?? 0);
  const cacheCreate = checkCount("cache_create", input.cache_create ?? 0);
  const at = parseAt(input.at);

  return writeTx(db, project, ctx, async (tx, emit) => {
    const task = await requireTask(tx, project.id, taskKey);
    const uow = uowOf(tx);
    const run = { projectId: project.id, agent, taskKey, runId };
    const counts = { model, input: inputCount, output: outputCount, cacheRead, cacheCreate, at };
    const [row] = (await uow.get("tokenUsage", run)) ? await uow.update("tokenUsage", run, counts) : [await uow.insert("tokenUsage", { ...run, ...counts })];
    await emit("usage.reported", task, { agent, run_id: runId, model, input: inputCount, output: outputCount });
    return {
      label: USAGE_LABEL,
      project: project.slug,
      agent: row!.agent,
      task_key: row!.taskKey,
      run_id: row!.runId,
      model: row!.model,
      input: row!.input,
      output: row!.output,
      at: iso(row!.at),
    };
  });
}

export async function usageSummary(db: Db, input: { project?: string; agent?: string; week?: string } = {}): Promise<UsageSummary> {
  const week = input.week?.trim() || undefined;
  if (week !== undefined && !WEEK.test(week)) throw new ToolError("INVALID_FILTER", { field: "week" });
  const agent = input.agent?.trim() || undefined;
  if (agent !== undefined && agent.length > 60) throw new ToolError("INVALID_FILTER", { field: "agent" });
  const project = input.project?.trim() ? await findProject(db, input.project.trim()) : undefined;
  const tz = screenTz();
  const r = readerOf(db);
  // Rows come sorted by agent and projects by slug, so the order of names below is Postgres' collation.
  const projects = await r.find("projects", {}, { orderBy: [{ column: "slug" }] });
  const projectRank = new Map(projects.map((p, i) => [p.id, i]));
  const slugOf = new Map(projects.map((p) => [p.id, p.slug]));
  const rows = await r.find("tokenUsage", { ...(project ? { projectId: project.id } : {}), ...(agent ? { agent } : {}) }, { orderBy: [{ column: "agent" }] });
  const agentRank = new Map<string, number>();
  const groups = new Map<string, UsageTotal & { rank: [number, number] }>();
  for (const u of rows) {
    if (!agentRank.has(u.agent)) agentRank.set(u.agent, agentRank.size);
    const slug = slugOf.get(u.projectId);
    if (slug === undefined) continue;
    const w = isoWeekOf(u.at, tz);
    if (week && w !== week) continue;
    const id = JSON.stringify([u.agent, slug, w]);
    const g = groups.get(id) ?? { agent: u.agent, project: slug, week: w, input: 0, output: 0, cache_read: 0, cache_create: 0, rank: [projectRank.get(u.projectId)!, agentRank.get(u.agent)!] };
    g.input += Number(u.input);
    g.output += Number(u.output);
    g.cache_read += Number(u.cacheRead);
    g.cache_create += Number(u.cacheCreate);
    groups.set(id, g);
  }
  // Newest week first, then project slug, then agent.
  const totals = [...groups.values()].sort((a, b) => (a.week === b.week ? 0 : a.week < b.week ? 1 : -1) || a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);
  // The same numbers Máquina shows for that week (this week when none is given), for the project or everything.
  const startsAt = (await weekBounds(db, week ? isoWeekThursday(week) : new Date(), tz)).startsAt;
  const endsAt = new Date(startsAt.getTime() + 7 * 86_400_000);
  const w = await weekUsage(db, project ? { kind: "project", projectId: project.id } : { kind: "all" }, startsAt, endsAt);
  return {
    label: USAGE_LABEL,
    totals: totals.map(({ rank: _rank, ...t }) => t),
    screen: { week: isoWeekOf(startsAt, tz), starts_at: startsAt.toISOString(), ...w },
  };
}

type WriteCtx = (
  tool: string,
  input: { actor: { agent?: string; session_id: string; machine?: string; model?: string }; request_id?: string; verbose?: boolean },
  identity: Identity | undefined,
) => Ctx;

export function registerUsageTools(
  server: McpServer,
  host: {
    db: Db;
    identity: Identity | undefined;
    writeCtx: WriteCtx;
    actor: z.ZodType;
    request_id: z.ZodType;
    run: (fn: () => Promise<unknown>) => Promise<CallToolResult>;
    readOnly: { readOnlyHint: true; openWorldHint: false };
    write: { readOnlyHint: false; destructiveHint: false; openWorldHint: false };
  },
): void {
  const { db, identity, writeCtx, actor, request_id, run, readOnly, write } = host;
  const project = z.string().min(1).describe("Project slug");

  server.registerTool(
    "report_tokens",
    {
      description: [
        "Record the tokens one agent reports for a task run. The same project, agent, task_key and run_id replaces the previous counts.",
        "Plania stores the numbers and shows them as reportado. It does not act on them.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        agent: z.string().min(1).max(60).describe("Who the count belongs to"),
        task_key: z.string().min(1).max(80),
        run_id: z.string().min(1).max(120).describe("Id of this run. The same id replaces the previous counts"),
        model: z.string().min(1).max(80),
        input: z.number().int().min(0).max(COUNT_MAX).describe("Input tokens reported for the run"),
        output: z.number().int().min(0).max(COUNT_MAX).describe("Output tokens reported for the run"),
        cache_read: z.number().int().min(0).max(COUNT_MAX).optional().describe("Cache-read input tokens, when known"),
        cache_create: z.number().int().min(0).max(COUNT_MAX).optional().describe("Cache-creation input tokens, when known"),
        at: z.string().optional().describe("When the run happened, ISO-8601. Omit for now"),
      },
      annotations: write,
    },
    (raw) =>
      run(() => {
        const body = raw as ReportTokensInput & {
          actor: { agent?: string; session_id: string; machine?: string; model?: string };
          request_id?: string;
        };
        const ctx = writeCtx("report_tokens", body, identity);
        return reportTokens(db, body, ctx);
      }),
  );

  server.registerTool(
    "usage_summary",
    {
      description: [
        "Totals of reported tokens per agent, project and week (input, output, cache_read, cache_create). label is reportado.",
        "screen is that week as Máquina shows it, from the runner's runs: used is input + output, cache reads and writes apart.",
        "Filter by project slug, agent, or week (YYYY-Www). The numbers are informational.",
      ].join(" "),
      inputSchema: {
        project: project.optional(),
        agent: z.string().min(1).max(60).optional(),
        week: z.string().optional().describe("ISO week, YYYY-Www"),
      },
      annotations: readOnly,
    },
    (raw) => run(() => usageSummary(db, raw as { project?: string; agent?: string; week?: string })),
  );
}
