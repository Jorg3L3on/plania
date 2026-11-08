import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { tokenUsage } from "../db/schema.js";
import { ToolError } from "./errors.js";
import { findProject, requireTask } from "./queries.js";
import { iso, writeTx, type Ctx } from "./tx.js";

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
};

export type UsageSummary = {
  label: typeof USAGE_LABEL;
  totals: UsageTotal[];
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
    const [row] = await tx
      .insert(tokenUsage)
      .values({
        projectId: project.id,
        agent,
        taskKey,
        runId,
        model,
        input: inputCount,
        output: outputCount,
        cacheRead,
        cacheCreate,
        at,
      })
      .onConflictDoUpdate({
        target: [tokenUsage.projectId, tokenUsage.agent, tokenUsage.taskKey, tokenUsage.runId],
        set: { model, input: inputCount, output: outputCount, cacheRead, cacheCreate, at },
      })
      .returning();
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
  const filters = [sql`true`];
  if (project) filters.push(sql`u.project_id = ${project.id}`);
  if (agent) filters.push(sql`u.agent = ${agent}`);
  if (week) filters.push(sql`to_char(u.at at time zone ${tz}, 'IYYY-"W"IW') = ${week}`);
  const result = await db.execute<{ agent: string; project: string; week: string; input: number; output: number }>(sql`
    select u.agent as agent,
           p.slug as project,
           to_char(u.at at time zone ${tz}, 'IYYY-"W"IW') as week,
           sum(u.input)::int as input,
           sum(u.output)::int as output
    from token_usage u
    join projects p on p.id = u.project_id
    where ${sql.join(filters, sql` and `)}
    group by u.agent, p.slug, 3
    order by 3 desc, p.slug asc, u.agent asc`);
  return {
    label: USAGE_LABEL,
    totals: result.rows.map((row) => ({
      agent: row.agent,
      project: row.project,
      week: row.week,
      input: Number(row.input),
      output: Number(row.output),
    })),
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
        "Totals of reported tokens per agent, project and week. label is reportado.",
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
