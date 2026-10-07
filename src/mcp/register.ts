import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { KINDS } from "../db/schema.js";
import {
  ToolError,
  findProject,
  findTask,
  getMemory,
  listTasks,
  nextTask,
  projectCounts,
  resumeShape,
  taskShape,
} from "./queries.js";

// Handoff §3. Ceiling: 12 tools total. Slice 3 registers the 6 read tools.
// Agents see slugs and human keys only, never uuids.

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function fail(e: unknown): CallToolResult {
  if (e instanceof ToolError) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: e.code, status: e.status }) }] };
  }
  throw e;
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

const project = z.string().min(1).describe("Project slug, e.g. micasa");
const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

export function createMcpServer(db: Db): McpServer {
  const server = new McpServer({ name: "plania", version: "0.1.0" });

  server.registerTool(
    "get_resume",
    {
      description: "Resume card of a project: in_progress, next_action, branch_or_prod, must_keep_decision.",
      inputSchema: { project },
      annotations: readOnly,
    },
    ({ project }) => run(async () => resumeShape(await findProject(db, project))),
  );

  server.registerTool(
    "get_project",
    {
      description: "Project title, long body (stack, repo, prod, constraints) and ticket counts.",
      inputSchema: { project },
      annotations: readOnly,
    },
    ({ project }) =>
      run(async () => {
        const p = await findProject(db, project);
        return { project: p.slug, title: p.title, body: p.body, counts: await projectCounts(db, p.id) };
      }),
  );

  server.registerTool(
    "list_tasks",
    {
      description: "Initiatives and tickets without bodies. Ordered P0 to P3 (null last), then most recently updated.",
      inputSchema: {
        project,
        parent_key: z.string().optional().describe("Only children of this initiative"),
        status: z.string().optional(),
        kind: z.enum(KINDS).optional(),
      },
      annotations: readOnly,
    },
    ({ project, parent_key, status, kind }) =>
      run(async () => {
        const p = await findProject(db, project);
        return { tasks: await listTasks(db, p.id, { parentKey: parent_key, status, kind }) };
      }),
  );

  server.registerTool(
    "get_task",
    {
      description: "Full initiative or ticket, including body, children and blockers.",
      inputSchema: { project, key: z.string().min(1).describe("Human key, e.g. MIC-01-F2") },
      annotations: readOnly,
    },
    ({ project, key }) =>
      run(async () => {
        const p = await findProject(db, project).catch(() => {
          throw new ToolError("TASK_NOT_FOUND", 404);
        });
        const t = await findTask(db, p.id, key);
        if (!t) throw new ToolError("TASK_NOT_FOUND", 404);
        return taskShape(db, t);
      }),
  );

  server.registerTool(
    "get_memory",
    {
      description: "Fixed memory: rules, design pages, and the decision log (newest first, up to 100).",
      inputSchema: { project },
      annotations: readOnly,
    },
    ({ project }) => run(async () => getMemory(db, await findProject(db, project))),
  );

  server.registerTool(
    "get_next",
    {
      description:
        "Next claimable ticket (Backlog or Ready, all blockers In review or Done). P0 first, then key. Read-only: does not claim. To claim, call set_task with status In progress and note 'claimed by <agent>'.",
      inputSchema: { project, initiative_key: z.string().optional() },
      annotations: readOnly,
    },
    ({ project, initiative_key }) =>
      run(async () => nextTask(db, (await findProject(db, project)).id, initiative_key)),
  );

  return server;
}
