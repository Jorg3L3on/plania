import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { KINDS, ORIGINS } from "../db/schema.js";
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
import { addDecision, createInitiative, createTask, setInitiative, setTask, updateResume } from "./writes.js";

// Handoff §3. Ceiling: exactly 12 tools, 6 read and 6 write. Never add a 13th.
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
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const key = z.string().min(1).describe("Human key, e.g. MIC-01-F2");

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
      inputSchema: { project, key },
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

  server.registerTool(
    "update_resume",
    {
      description:
        "Replace the whole resume card. All four fields are required and may be empty. No history is kept. Rewrite it when you finish a phase so Jorge can pick up from one screen.",
      inputSchema: {
        project,
        in_progress: z.string(),
        next_action: z.string(),
        branch_or_prod: z.string(),
        must_keep_decision: z.string(),
      },
      annotations: { ...write, idempotentHint: true },
    },
    ({ project, ...card }) => run(() => updateResume(db, project, card)),
  );

  server.registerTool(
    "create_initiative",
    {
      description:
        "Create a parent initiative in status Planning. body holds the PRD and the phased plan. base_branch defaults to main. Then create one ticket per phase with create_task.",
      inputSchema: {
        project,
        key: key.describe("Human key, e.g. MIC-01"),
        title: z.string().min(1),
        body: z.string(),
        base_branch: z.string().min(1).optional(),
        summary: z.string().optional().describe("The one line shown in lists"),
      },
      annotations: write,
    },
    (input) => run(() => createInitiative(db, input)),
  );

  server.registerTool(
    "create_task",
    {
      description:
        "Create a ticket. With parent_key it is a phase of that initiative: body holds its scope, its Done when checklist and the line 'Phase N', without copying the PRD. Without parent_key it is a standalone spec. priority defaults to P2, status to Backlog. origin defaults to discovered when the parent is Active or Shipping, otherwise chartered.",
      inputSchema: {
        project,
        key,
        title: z.string().min(1),
        body: z.string(),
        summary: z.string().optional().describe("The one line shown in lists"),
        parent_key: z.string().nullable().optional().describe("Initiative key; omit or null for a standalone spec"),
        priority: z.string().optional().describe("P0 | P1 | P2 | P3"),
        origin: z.enum(ORIGINS).optional(),
        blocked_by: z.array(z.string()).optional().describe("Keys of tasks that must reach In review or Done first"),
        status: z.string().optional().describe("Backlog | Ready | In progress | In review | Done | Won't do"),
      },
      annotations: write,
    },
    (input) => run(() => createTask(db, input)),
  );

  server.registerTool(
    "set_task",
    {
      description: [
        "Update a ticket, or an initiative's text fields. Only the fields you pass change; blocked_by replaces the whole list.",
        "Claim: status 'In progress' with note 'claimed by <agent>'.",
        "Blocked requires a note, stored as blocked_note. Any other note is appended to body as '- YYYY-MM-DD · <note>'.",
        "Finishing a phase: status 'In review' (committed, not merged), set branch and pr_url, and append a Result line as the note.",
        "Result format: 'Result: <✓|⚠|✗> <unit|integration|test|live|grep|subagent> — <cite>'.",
        "Do not set Done unless Jorge asks: Jorge marks Done after merging.",
      ].join(" "),
      inputSchema: {
        project,
        key,
        status: z.string().optional(),
        priority: z.string().optional().describe("P0 | P1 | P2 | P3, tickets only"),
        parent_key: z.string().nullable().optional().describe("Move under another initiative; null makes it a standalone spec"),
        blocked_by: z.array(z.string()).optional(),
        branch: z.string().optional(),
        pr_url: z.string().optional(),
        summary: z.string().optional(),
        body: z.string().optional(),
        note: z.string().optional(),
      },
      annotations: write,
    },
    (input) => run(() => setTask(db, input)),
  );

  server.registerTool(
    "set_initiative",
    {
      description:
        "Set an initiative's status: Planning, Active, Shipping, Done, On hold or Won't do. Leave Done to Jorge.",
      inputSchema: { project, key, status: z.string() },
      annotations: { ...write, idempotentHint: true },
    },
    (input) => run(() => setInitiative(db, input)),
  );

  server.registerTool(
    "add_decision",
    {
      description:
        "Append one line to the decision log. The full ADR stays in the product repo under docs/adr/; pass its link as adr_url. pin_to_resume also writes the line into the resume card's must_keep_decision.",
      inputSchema: {
        project,
        line: z.string().min(1),
        adr_url: z.string().optional(),
        pin_to_resume: z.boolean().optional(),
      },
      annotations: write,
    },
    (input) => run(() => addDecision(db, input)),
  );

  return server;
}
