import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Scope } from "../auth/bearer.js";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { KINDS, ORIGINS } from "../db/schema.js";
import { FOOTPRINT_KINDS } from "../jobs/machine/infer.js";
import { APPROVAL_ACTIONS, requestApproval } from "./approvals.js";
import { inbox } from "./inbox.js";
import { waiveCheck } from "./checks.js";
import { addDecision, retireDecision } from "./decisions.js";
import { headlineShape, setProject } from "./project.js";
import {
  ToolError,
  findProject,
  findTask,
  getMemory,
  listEvents,
  listTasks,
  nextTask,
  pickFields,
  projectCounts,
  taskFull,
  taskSummary,
  taskWithChildren,
} from "./queries.js";
import { resumeDigest } from "./resume.js";
import { projectSequences, reserveSequence } from "./sequences.js";
import { nextKeys } from "./keys.js";
import { runBatch } from "./batch.js";
import { WORK_TYPES } from "./lifecycle.js";
import { setCheck } from "./checks.js";
import { attachDoc, getDoc } from "./docs.js";
import { REVIEW_EVIDENCE, RESULT_KINDS, VERDICTS, addResult, validateEvidence } from "./evidence.js";
import { checkSizes } from "./limits.js";
import type { Ctx } from "./tx.js";
import { ENV_CONDITIONS, projectMetricsOf, setMetricInTx } from "./blockers.js";
import { projectBranches } from "./branches.js";
import { projectEnv, setEnv } from "./env.js";
import { registerFootprint, releaseFootprint } from "./footprint.js";
import { consume, leaseResource, projectResources, releaseResource } from "./resources.js";
import { SEVERITIES } from "./lifecycle.js";
import { writeTx } from "./tx.js";
import { PROTOCOL_VERSION, instructions } from "./protocol.js";
import { releasePlan } from "./release-plan.js";
import { URGENCIES, answer, ask } from "./questions.js";
import { TTL, claim, createTask, handoff, setTask } from "./writes.js";
import { runAudit } from "./audit.js";
import { getContext } from "./context.js";
import { projectReleases } from "./releases.js";
import { DIGEST_PER_PROJECT_DEFAULT, QUIET_MIN, getDigest, getRunning, listProjects, readerOf } from "./watch.js";

// v2 contract (approved 2026-10-06; supersedes the v1 handoff's 12-tool ceiling).
// Agents see slugs and human keys only, never uuids. Every write takes an actor.

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function fail(e: unknown): CallToolResult {
  if (e instanceof ToolError) {
    const payload = { error: e.code, status: e.status, ...e.detail };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
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

const blockedBy = z
  .array(
    z.union([
      z.string().describe("Task key"),
      z.object({ task: z.string() }),
      z.object({
        env: z.string().describe("e.g. prod"),
        condition: z.string().describe(ENV_CONDITIONS.join(" | ")),
        value: z.union([z.string(), z.number()]).optional().describe("sha | migration number | ISO time (omit for the next deploy)"),
      }),
      z.object({ human_action: z.object({ assignee: z.string().optional(), text: z.string(), before_release: z.boolean().optional() }) }).describe("Something Jorge has to do; shows in his inbox. before_release: true lists it as a step of the project's release"),
      z.object({ env_flag: z.object({ env: z.string(), flag: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) }) }).describe("A flag set with set_env"),
      z.object({ time_after: z.string() }).describe("Not before this ISO-8601 time"),
      z.object({ metric_gte: z.object({ name: z.string(), value: z.number() }) }).describe("A metric reported with set_metric or on a result"),
    ]),
  )
  .describe(
    "What must happen first: a task key (it must reach In review or later), an environment condition {env, condition, value}, a human action, an env flag, a time, or a metric. Replaces the whole list. Once every blocker holds, a Blocked ticket goes back to Ready on its own",
  );

const actor = z
  .object({
    agent: z.string().min(1).max(60).optional().describe("Your client, e.g. Claude Code, Codex, Cursor. Filled from your agent token when it has one"),
    session_id: z.string().min(1).max(120).describe("Stable id of this session. It owns your claims; reuse it on every call"),
    machine: z.string().max(120).optional().describe("Host name of the machine you run on. Filled from your agent token when it has one"),
    model: z.string().max(120).optional(),
  })
  .describe("Who is writing. Required on every write; recorded in the event log");

const request_id = z
  .string()
  .min(1)
  .optional()
  .describe("Optional idempotency key. Retrying a write with the same request_id returns the first response instead of writing again");

const verbose = z
  .boolean()
  .optional()
  .describe("Writes answer {key, status, version, changed} by default; true adds task, the full get_task shape (without log)");

type WriteInput = { actor: z.infer<typeof actor>; request_id?: string; verbose?: boolean } & Record<string, unknown>;

// Every write: size limits, the actor ("jorge" is reserved for the screen; an agent token fills
// agent and machine and refuses values that disagree) and the idempotency key.
function writeCtx(tool: string, input: WriteInput, identity: Identity | undefined): Ctx {
  checkSizes(input);
  let { agent, machine } = input.actor;
  if (identity) {
    if (agent !== undefined && agent !== identity.agent) throw new ToolError("ACTOR_MISMATCH", { field: "agent", expected: identity.agent });
    if (machine !== undefined && identity.machine && machine !== identity.machine) {
      throw new ToolError("ACTOR_MISMATCH", { field: "machine", expected: identity.machine });
    }
    agent = identity.agent;
    machine = identity.machine ?? machine;
  }
  if (!agent?.trim()) throw new ToolError("ACTOR_REQUIRED");
  if (agent.trim().toLowerCase() === "jorge") throw new ToolError("RESERVED_ACTOR");
  const actorOut = { ...input.actor, agent, ...(machine !== undefined ? { machine } : {}) };
  return { actor: actorOut, requestId: input.request_id, tool, verbose: input.verbose, tokenId: identity?.tokenId };
}

// Field schemas shared by a tool and its batch op (keys.ts assigns keys; see create_task).
const createFields = {
  key: key.optional().describe("Omit it: the server assigns PREFIX-I<n> (initiative), PREFIX-<nn> (standalone ticket) or <initiative>-<n> (phase)"),
  kind: z.enum(KINDS).optional().describe("ticket (default) | initiative"),
  title: z.string().min(1),
  scope: z.string().optional().describe("What it is: PRD and plan (initiative) or the phase's scope (ticket). Markdown"),
  checks: z.array(z.string()).optional().describe("Done when, one item per string"),
  phase: z.number().int().optional().describe("Tickets: Phase N within the initiative"),
  body: z.string().optional().describe("Removed in v2 (BODY_REMOVED): use scope and checks"),
  summary: z.string().optional().describe("The one line shown in lists"),
  parent_key: z.string().nullable().optional().describe("Tickets: initiative key; omit or null for a standalone spec"),
  priority: z.string().optional().describe("Tickets: P0 | P1 | P2 | P3"),
  origin: z.enum(ORIGINS).optional().describe("Tickets only"),
  blocked_by: blockedBy.optional(),
  status: z.string().optional().describe("Tickets: Backlog | Ready. Initiatives always start in Planning"),
  work_type: z.string().optional().describe(`Tickets: ${WORK_TYPES.join(" | ")}; default code`),
  base_branch: z.string().min(1).optional().describe("Initiatives only; defaults to main"),
  next_action: z.string().optional().describe("Initiatives only: what comes next, shown in get_resume"),
  state_note: z.string().optional().describe("Initiatives only: where it stands, apart from the scope"),
  integration_branch: z.string().min(1).optional().describe("Initiatives only: the branch its phases build on (one PR per initiative). Registered to it: BRANCH_IN_USE for another live initiative unless share_branch"),
  share_branch: z.boolean().optional().describe("Initiatives: build on a branch another initiative owns, with share_reason"),
  share_reason: z.string().optional(),
  areas: z.array(z.string()).optional().describe("Path globs the work touches (e.g. drizzle/**); claim warns when another live claim overlaps"),
  severity: z.enum(SEVERITIES).optional().describe("Bugs only (required for work_type bug)"),
  found_in: z.string().optional().describe("Bugs: the environment it showed up in"),
  introduced_by: z.string().optional().describe("Bugs: the key or sha that caused it"),
  regression: z.boolean().optional().describe("Bugs: it used to work"),
  cost_note: z.string().optional().describe("Debt: what it costs while it stays"),
  due_on: z.string().optional().describe("When it should be done, YYYY-MM-DD (audit OVERDUE once past)"),
};

const setTaskFields = {
  key,
  status: z.string().optional(),
  priority: z.string().optional().describe("P0 | P1 | P2 | P3, tickets only"),
  parent_key: z.string().nullable().optional().describe("Tickets: move under another initiative (null makes it standalone). The ticket gets a key under its new parent; the old one stays as an alias"),
  blocked_by: blockedBy.optional(),
  branch: z.string().optional(),
  pr_url: z.string().optional(),
  summary: z.string().optional(),
  scope: z.string().optional().describe("Replaces the scope whole; the old text stays in the log"),
  checks: z
    .array(z.object({ n: z.number().int().optional(), text: z.string(), derived_from: z.string().nullable().optional() }))
    .optional()
    .describe("Replaces the Done when list. Keep n to keep an item (and its done state); omit n for a new one. derived_from: a child ticket's key; the check ticks itself when that ticket is Done"),
  phase: z.number().int().nullable().optional().describe("Tickets only"),
  body: z.string().optional().describe("Removed in v2 (BODY_REMOVED): use scope, checks and note"),
  base_branch: z.string().min(1).optional().describe("Initiatives only"),
  next_action: z.string().optional().describe("Initiatives only"),
  in_progress_note: z.string().optional().describe("Initiatives only"),
  state_note: z.string().optional().describe("Initiatives only: where it stands, apart from the scope (the spec). The server flags it stale once a ticket moves after it"),
  work_type: z.string().optional().describe(`Tickets only: ${WORK_TYPES.join(" | ")}`),
  integration_branch: z.string().min(1).optional().describe("Initiatives only: the branch its phases build on; BRANCH_IN_USE when another live initiative owns it unless share_branch"),
  share_branch: z.boolean().optional(),
  share_reason: z.string().optional(),
  areas: z.array(z.string()).optional().describe("Path globs the work touches; replaces the list"),
  severity: z.enum(SEVERITIES).optional().describe("Bugs only"),
  found_in: z.string().optional(),
  introduced_by: z.string().optional(),
  regression: z.boolean().optional(),
  due_on: z.string().nullable().optional().describe("When it should be done, YYYY-MM-DD; null clears it"),
  cost_note: z.string().optional().describe("Debt only"),
  approval_id: z.string().optional().describe("For Won't do or reopening: the id of an approval Jorge granted (request_approval). Spent on this move"),
  withdraw_blocker: z.string().optional().describe("Id of a human_action your own note created (JORGE_LINE_PARSED) that asks nothing of Jorge: it is removed. Same session or token only; needs no version"),
  note: z.string().optional(),
  version: z.number().int().optional().describe("The version you read. Required unless note or withdraw_blocker is the only field"),
};

const setCheckFields = {
  key,
  n: z.number().int(),
  done: z.boolean().optional(),
  evidence_id: z.string().nullable().optional(),
  text: z.string().optional().describe("Amend the check's text; the old text stays in the log"),
  waived: z.boolean().optional().describe("false lifts a waiver (waive_check sets one)"),
};

const addResultFields = {
  key,
  kind: z.string().describe(RESULT_KINDS.join(" | ")),
  verdict: z.string().describe(VERDICTS.join(" | ")),
  cite: z.string().describe("e.g. 'pnpm test: 84 pass' or 'Playwright at 375px, sheet opens'"),
  url: z.string().optional(),
  check_ns: z.array(z.number().int()).optional().describe("Done when items this result proves (pass only)"),
  commit: z.string().optional().describe("The commit the run was against (7-40 hex). With branch, the server marks the result stale_for_head once the branch moves on"),
  branch: z.string().optional(),
  env: z.string().optional().describe("The environment it ran against, e.g. prod"),
  command: z.string().optional().describe("What ran, e.g. pnpm test"),
  exit_code: z.number().int().optional(),
  counts: z.object({ pass: z.number().int().optional(), fail: z.number().int().optional(), skip: z.number().int().optional() }).optional(),
  duration_s: z.number().int().optional(),
  attachments: z.array(z.string()).optional().describe("Links to screenshots, logs or traces (Plania stores no files)"),
  viewport: z.string().optional().describe("UI checks: e.g. 375x812"),
  device: z.string().optional(),
  metrics: z.record(z.string(), z.number()).optional().describe("Values this run measured, for metric_gte blockers, e.g. {pickevent_nights: 31}"),
};

const addDecisionFields = {
  text: z.string().min(1),
  task_key: z.string().optional(),
  tags: z.array(z.string()).optional(),
  supersedes: z.union([z.string(), z.array(z.string())]).optional().describe("id, or ids, of the decisions this one reverses"),
  adr_body: z.string().optional().describe("Full ADR in markdown"),
  adr_url: z.string().optional(),
  pin: z.boolean().optional(),
};

// batch ops: the same fields as the tool, plus op; project, actor and request_id come from the batch.
const batchOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create_task"), ...createFields }),
  z.object({ op: z.literal("set_task"), ...setTaskFields }),
  z.object({ op: z.literal("set_check"), ...setCheckFields }),
  z.object({ op: z.literal("add_result"), ...addResultFields }),
  z.object({ op: z.literal("add_decision"), ...addDecisionFields }),
  z.object({ op: z.literal("note"), key, text: z.string().min(1) }),
]);

// scopes: what the token may do (read tools; writes; ops tools). identity: the agent token behind
// the connection, when there is one. Without options the server is wide open (tests, local tools).
export type ServerOptions = { scopes?: Scope[]; identity?: Identity; readOnly?: boolean };

// Writes that touch what runs where or shared numbers: ops scope only.
export const OPS_TOOLS = new Set(["set_env", "set_metric", "reserve_sequence", "lease_resource", "release_resource", "consume"]);

export function createMcpServer(db: Db, opts: ServerOptions = {}): McpServer {
  const scopes = opts.readOnly ? ["read"] : (opts.scopes ?? ["read", "write", "ops"]);
  const canWrite = scopes.includes("write");
  const canOps = scopes.includes("ops");
  const identity = opts.identity;
  const server = new McpServer(
    { name: "plania", version: `${PROTOCOL_VERSION}.0` },
    { instructions: instructions(!canWrite) },
  );

  // Tools the token may not use are dropped as soon as they are registered, so they never show
  // in tools/list: writes without the write scope, ops tools without the ops scope.
  if (!canWrite || !canOps) {
    const register = server.registerTool.bind(server);
    server.registerTool = ((name: string, config: { annotations?: { readOnlyHint?: boolean } }, cb: never) => {
      const tool = register(name, config as never, cb);
      const isRead = !!config.annotations?.readOnlyHint;
      if ((!isRead && !canWrite) || (OPS_TOOLS.has(name) && !canOps)) tool.remove();
      return tool;
    }) as typeof server.registerTool;
  }

  // Registers a write tool: adds actor, request_id and verbose to its schema and builds its Ctx.
  function writeHandler<I extends WriteInput>(tool: string, fn: (input: Omit<I, "actor" | "request_id" | "verbose">, ctx: Ctx) => Promise<unknown>) {
    return (input: I) =>
      run(() => {
        const ctx = writeCtx(tool, input, identity);
        const { actor: _a, request_id: _r, verbose: _v, ...rest } = input;
        return fn(rest, ctx);
      });
  }

  server.registerTool(
    "get_resume",
    {
      description: [
        "Where the project stands, generated from data: live claims (who, until when, where), the next claimable ticket,",
        "and per open initiative its in_progress note and claims, next_action note and next_claimable, must_keep (pinned decisions) and status counts.",
        "Also the headline (one line Jorge or an agent wrote with set_project; stale: true once an env, an initiative or a Done moved after it),",
        "project-wide pinned decisions and the latest events.",
        "Nobody writes the rest directly: update an initiative's next_action / in_progress_note with set_task, pin decisions with add_decision.",
      ].join(" "),
      inputSchema: { project },
      annotations: readOnly,
    },
    ({ project }) => run(async () => resumeDigest(db, await findProject(db, project))),
  );

  server.registerTool(
    "get_project",
    {
      description: [
        "Project title, long body (stack, repo, prod, constraints), rules (project-specific additions to the protocol in the server instructions) with rules_version, protocol_version, headline, settings (release_target, branch_pattern, claim_from, resources, quotas, github, vercel, release),",
        "ticket counts, env (per environment: commit, branch, migrations, flags, deployed_at and its source), branches (each with its owner, head and merge state), resources (live leases, today's quotas), metrics, reserved sequence numbers with the ticket holding each,",
        "and release: the step settings.release names (from → into), with how far from is ahead, the merged tickets it ships, their migrations, the before-steps, open checks and the command Jorge runs (null without settings.release).",
      ].join(" "),
      inputSchema: { project },
      annotations: readOnly,
    },
    ({ project }) =>
      run(async () => {
        const p = await findProject(db, project);
        return {
          project: p.slug,
          title: p.title,
          body: p.body,
          rules: p.rulesText,
          rules_version: p.rulesVersion,
          headline: headlineShape(p),
          settings: p.settings,
          protocol_version: PROTOCOL_VERSION,
          version: p.version,
          key_prefix: p.keyPrefix || p.slug.slice(0, 3).toUpperCase(),
          next_keys: await nextKeys(db, p),
          counts: await projectCounts(db, p.id),
          env: await projectEnv(db, p.id),
          branches: await projectBranches(db, p.id),
          resources: await projectResources(db, p),
          metrics: await projectMetricsOf(db, p.id),
          releases: await projectReleases(db, p.id),
          release: await releasePlan(db, p),
          ...(await projectSequences(db, p.id)),
        };
      }),
  );

  server.registerTool(
    "list_tasks",
    {
      description: [
        "Initiatives and tickets without scope, with version, claimed_by (live lease owner or null) and updated_at. Ordered P0 to P3 (null last), then most recently updated.",
        "Filters combine: parent_key, status, kind, work_type, owner (a session_id or agent holding a live lease, or none), unblocked (every blocker satisfied, or not),",
        "updated_since (ISO time), search (key, title, summary, scope and checks, case-insensitive). limit default 200, max 1000.",
      ].join(" "),
      inputSchema: {
        project,
        parent_key: z.string().optional().describe("Only children of this initiative"),
        status: z.string().optional(),
        kind: z.enum(KINDS).optional(),
        work_type: z.string().optional(),
        severity: z.array(z.enum(SEVERITIES)).optional().describe("Bugs of these severities"),
        owner: z.string().optional(),
        unblocked: z.boolean().optional(),
        updated_since: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
      annotations: readOnly,
    },
    ({ project, parent_key, work_type, updated_since, severity, ...f }) =>
      run(async () => {
        const p = await findProject(db, project);
        return {
          tasks: await listTasks(db, p.id, { ...f, parentKey: parent_key, workType: work_type, severity, updatedSince: updated_since }),
        };
      }),
  );

  server.registerTool(
    "get_task",
    {
      description: [
        "One initiative or ticket, by its key or any former key (aliases). view full (default): scope, checks (Done when, with n), results, docs, questions, blocked_by with satisfied per blocker, children, claim and workspace, version.",
        "view summary (under 2 KB): the same without scope, results, docs and questions, with counts instead. fields picks top-level keys.",
        "The log is not included: read it with list_events {key, since}; include_log: true adds the last 50 events (log_total counts all).",
      ].join(" "),
      inputSchema: {
        project,
        key,
        view: z.enum(["summary", "full"]).optional(),
        fields: z.array(z.string()).optional().describe("Only these top-level keys"),
        include_log: z.boolean().optional(),
        include_children: z.boolean().optional().describe("Also return every child's full shape (one call for an initiative and its phases)"),
      },
      annotations: readOnly,
    },
    ({ project, key, view, fields, include_log, include_children }) =>
      run(async () => {
        const p = await findProject(db, project).catch(() => {
          throw new ToolError("TASK_NOT_FOUND");
        });
        const t = await findTask(db, p.id, key);
        if (!t) throw new ToolError("TASK_NOT_FOUND");
        const opts = { log: !!include_log };
        const shape = include_children ? await taskWithChildren(db, t, opts) : view === "summary" ? await taskSummary(db, t) : await taskFull(db, t, opts);
        return pickFields(shape, fields);
      }),
  );

  server.registerTool(
    "get_memory",
    {
      description: [
        "Fixed memory: rules, design_docs (project docs, with markdown; view summary lists them without it), and the decision log, newest first (limit default 100, max 500).",
        "Filter decisions by task_key, initiative_key (the initiative and its tickets) or tag.",
        "Reversed (superseded_by) and retired decisions are left out unless include_superseded / include_retired is true.",
      ].join(" "),
      inputSchema: {
        project,
        task_key: z.string().optional(),
        initiative_key: z.string().optional(),
        tag: z.string().optional(),
        include_superseded: z.boolean().optional(),
        include_retired: z.boolean().optional(),
        view: z.enum(["summary", "full"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: readOnly,
    },
    ({ project, task_key, initiative_key, tag, include_superseded, include_retired, view, limit }) =>
      run(async () => {
        const memory = await getMemory(db, await findProject(db, project), {
          taskKey: task_key,
          initiativeKey: initiative_key,
          tag,
          includeSuperseded: include_superseded,
          includeRetired: include_retired,
          limit,
        });
        if (view !== "summary") return memory;
        return { ...memory, design_docs: memory.design_docs.map(({ markdown: _m, ...d }) => ({ ...d, chars: _m.length })) };
      }),
  );

  server.registerTool(
    "get_doc",
    {
      description: "One doc by id (from get_task docs, get_memory design_docs, or a decision's adr_doc_id), with its markdown and version.",
      inputSchema: { project, doc_id: z.string().min(1) },
      annotations: readOnly,
    },
    ({ project, doc_id }) => run(async () => getDoc(db, (await findProject(db, project)).id, doc_id)),
  );

  server.registerTool(
    "get_next",
    {
      description:
        "Next claimable ticket: Backlog or Ready, or In progress with an expired lease (stale_claim: true), with every blocker satisfied (tasks In review or Done, env conditions holding). P0 first, then key. Read-only: does not claim; call claim next.",
      inputSchema: { project, initiative_key: z.string().optional() },
      annotations: readOnly,
    },
    ({ project, initiative_key }) =>
      run(async () => nextTask(db, (await findProject(db, project)).id, initiative_key)),
  );

  server.registerTool(
    "list_events",
    {
      description: [
        "What changed, oldest first: every write is an event with its actor, server time, project and a one-line summary (Spanish).",
        "project: a slug, or all for every project in one feed (ids commit in order across projects, so one cursor is safe).",
        "Pass since = the next_cursor you got last time to see only what is new (e.g. a ticket re-scoped or claimed under you). more: true means call again.",
        "Filter by key (one project only), or by types (a prefix like claim matches claim.acquired, claim.released, claim.expired; pr matches pr.opened, pr.merged, pr.closed, pr.ci_failed). limit default 200, max 1000.",
      ].join(" "),
      inputSchema: {
        project: z.string().min(1).describe("Project slug, or all"),
        since: z.number().int().min(0).optional(),
        key: z.string().optional(),
        types: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
      annotations: readOnly,
    },
    ({ project, ...f }) => run(async () => listEvents(db, project === "all" ? null : (await findProject(db, project)).id, f)),
  );

  server.registerTool(
    "list_projects",
    {
      description: [
        "Every project in one line each: slug, title, key_prefix, headline, line (what is claimed, else the next step, else what is next to claim),",
        "ticket counts (open, in_progress, in_review, needs_jorge, blocked, done), open_questions, claims, last_event_id and last_event_at. Sorted by slug.",
      ].join(" "),
      inputSchema: {},
      annotations: readOnly,
    },
    () => run(() => listProjects(db)),
  );

  server.registerTool(
    "get_running",
    {
      description: [
        "Every ticket with an owner, across projects, with a derived liveness: live (lease valid, activity in the last",
        `${QUIET_MIN} min), quiet (lease valid, no heartbeat or event for longer), stale (lease ran out, not yet cleared). last_activity_at = the newest of last_seen_at, claimed_at and an event by the same session on the ticket.`,
        "Includes the owner, workspace (branch, worktree) and what the ticket has running on the Mac (footprint). Use it to tell a working session from a dead one.",
      ].join(" "),
      inputSchema: {},
      annotations: readOnly,
    },
    () => run(() => getRunning(db)),
  );

  server.registerTool(
    "get_digest",
    {
      description: [
        "One call for an assistant that keeps Jorge updated: what changed since a cursor, grouped by project with Spanish summaries and highlights",
        "(done, to_review, blocked, needs_jorge, prs_opened, prs_merged, claims), what runs now (get_running) and what waits on Jorge (get_inbox all), plus unchanged_projects.",
        "Without since, resumes from the cursor this token was last given (since_from: memory); the first time, the last 24 h. Pass since to override. Only an unscoped call (project all) moves that memory; a slug-scoped one reads from since or the last 24 h.",
        `project: all (default) or a slug. max_events_per_project default ${DIGEST_PER_PROJECT_DEFAULT} (the newest; changes_total counts all). truncated: true means more than 2000 events moved: call again.`,
      ].join(" "),
      inputSchema: {
        since: z.number().int().min(0).optional(),
        project: z.string().min(1).optional().describe("all (default) or a project slug"),
        max_events_per_project: z.number().int().min(1).max(200).optional(),
      },
      annotations: readOnly,
    },
    (input) => run(() => getDigest(db, { ...input, reader: readerOf(identity, scopes) })),
  );

  server.registerTool(
    "create_task",
    {
      description: [
        "Create a ticket (default) or, with kind initiative, a parent initiative.",
        "Initiative: starts in Planning; scope holds the PRD and the phased plan; base_branch defaults to main; next_action optional. Then create one ticket per phase.",
        "Ticket with parent_key: a phase of that initiative, with phase N, its scope (without copying the PRD) and checks (the Done when list, one string each). Without parent_key: a standalone spec.",
        "Tickets: priority defaults to P2, status to Backlog (or Ready), work_type to code. origin defaults to discovered when the parent is Active or Shipping, otherwise chartered.",
        "Every ticket needs a scope; code and ops tickets need at least one check (TEMPLATE_INVALID lists what is missing). Convention slips come back as warnings.",
        "Keys are the server's: omit key and the reply carries the one assigned (PREFIX-I<n> for an initiative, PREFIX-<nn> for a standalone ticket, <initiative>-<n> under a parent).",
        "An explicit key is accepted for imports; one that fits the scheme must be at or above the counter (KEY_BELOW_COUNTER). A key that exists is KEY_EXISTS (409); pass request_id to retry safely.",
        "A field of the other kind is FIELD_NOT_ALLOWED.",
      ].join(" "),
      inputSchema: { project, actor, request_id, verbose, ...createFields },
      annotations: write,
    },
    writeHandler("create_task", (input, ctx) => createTask(db, input, ctx)),
  );

  server.registerTool(
    "set_task",
    {
      description: [
        "Update a ticket or an initiative. Only the fields you pass change; blocked_by replaces the whole list.",
        "Pass the version you read (get_task); if anyone wrote since, you get STALE_VERSION with current_version: re-read and retry. A note alone needs no version.",
        "Do not set In progress here: use claim. While another session holds a live lease, only it can change the task (NOT_OWNER); notes are always allowed.",
        "A note goes to the task's log with your actor and a server timestamp; it is the only way to add text without a version. Blocked requires a note, stored as blocked_note.",
        "To tick one Done when item use set_check, not checks.",
        "Ticket moves: Backlog ⇄ Ready; Backlog, Ready, In progress or In review → Blocked (note required) → Backlog or Ready; In progress → In review, Ready or Backlog (each releases the lease). In progress only through claim.",
        "Initiative moves: Planning ⇄ Active ⇄ Shipping, any ⇄ On hold; next_action and in_progress_note feed get_resume.",
        "Anything else is INVALID_TRANSITION with the allowed moves.",
        "Finishing a phase: add_result first, then status 'In review' (committed, not merged) with branch and pr_url; without fitting evidence it is EVIDENCE_REQUIRED.",
        "Merged and Released are the pollers' (GitHub merge, deploy); by hand they need a ci pass result naming the merge commit (and, for Released, the release target env containing it).",
        "Done is yours once the work is finished: code, bug and debt tickets from Merged or Released; ops and research from In review on; decision-needed once answered (Backlog, Ready or In progress); an initiative from any open status. Elsewhere it is INVALID_TRANSITION with allowed_from.",
        "Won't do and reopening a closed task are Jorge's: HUMAN_ONLY. Ask with request_approval; once he grants it on screen, pass approval_id here (it is spent on this move).",
        "In review (and later Done) needs every check done or waived: CHECKS_OPEN lists the open numbers. An initiative needs every ticket closed: INITIATIVE_CHILDREN_OPEN.",
        "A line that starts with 'Jorge:' in summary, next_action, in_progress_note, state_note, blocked_note or a note becomes a human_action blocker (warning JORGE_LINE_PARSED); it reaches his inbox without moving the task, and only one from blocked_note holds it Blocked. In the fields (not notes) a sentence naming Jorge with a waiting cue counts too. A blocker your note created by mistake: withdraw_blocker with its id.",
        "The reply is {key, status, version, changed}; verbose: true adds the full task.",
      ].join(" "),
      inputSchema: { project, actor, request_id, verbose, ...setTaskFields },
      annotations: write,
    },
    writeHandler("set_task", (input, ctx) => setTask(db, input, ctx)),
  );

  server.registerTool(
    "set_check",
    {
      description:
        "Tick (or untick) one Done when item by its n, amend its text, or lift a waiver. Needs no version and does not bump it. While another session holds the lease, only it can tick (NOT_OWNER). evidence_id links the add_result that proves it (any result of the project; the reply says its source task).",
      inputSchema: { project, actor, request_id, verbose, ...setCheckFields },
      annotations: { ...write, idempotentHint: true },
    },
    writeHandler("set_check", (input, ctx) => setCheck(db, input, ctx, validateEvidence)),
  );

  server.registerTool(
    "add_result",
    {
      description: [
        "Record evidence on a task: kind, verdict pass|warn|fail, cite (what ran and what it showed), url (CI run, screenshot, recording), and the structured fields: commit, branch, env, command, exit_code, counts, duration_s, attachments, viewport, device, metrics.",
        "A result that names a commit on a branch the poller tracks is marked stale_for_head once the branch moves; In review then needs a fresh pass (EVIDENCE_STALE).",
        "Anyone may add results: the owner, a QA session, CI. A pass with check_ns also ticks those Done when items, linked to this result.",
        `In review needs a pass recorded during the current claim: code ${REVIEW_EVIDENCE.code!.join("|")}; ops ${REVIEW_EVIDENCE.ops!.join("|")}; research any result or a doc; decision-needed never (it is answered).`,
      ].join(" "),
      inputSchema: { project, actor, request_id, verbose, ...addResultFields },
      annotations: write,
    },
    writeHandler("add_result", (input, ctx) => addResult(db, input, ctx)),
  );

  server.registerTool(
    "attach_doc",
    {
      description: [
        "Store a markdown doc in Plania so every machine can read it: a spec or plan on a task (key), or a project doc such as a design page (no key).",
        "A new title creates it (DOC_EXISTS if the title exists). Pass the version you read to replace it (STALE_VERSION if it moved).",
        "Use this instead of plan files that live on one machine.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        key: key.optional().describe("Task the doc belongs to; omit for a project doc"),
        title: z.string().min(1),
        markdown: z.string(),
        version: z.number().int().optional(),
      },
      annotations: write,
    },
    writeHandler("attach_doc", (input, ctx) => attachDoc(db, input, ctx)),
  );

  server.registerTool(
    "claim",
    {
      description: [
        `Lease a ticket so no other session works on it. action claim (default): status becomes In progress, owned by your session_id for ttl_minutes (default ${TTL.default}, ${TTL.min}-${TTL.max}).`,
        "Claiming a ticket you already hold extends it. heartbeat: extend your lease while you work; send it before it runs out. heartbeat with key \"*\" extends every lease your session holds in the project in one call (reply: extended keys), and logs nothing.",
        "release: give it back; In progress goes to release_to (default Ready). Moving the ticket to any other status also releases it.",
        "Errors: CLAIM_HELD (someone else holds a live lease; owner and workspace say who and where), NOT_CLAIMABLE (status, or unsatisfied blocked_by), LEASE_EXPIRED (heartbeat after your lease ran out: claim again).",
        "An expired lease is free: anyone may claim it. Pass workspace so others know where the code is checked out.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        verbose,
        key,
        action: z.enum(["claim", "heartbeat", "release"]).optional(),
        ttl_minutes: z.number().int().optional(),
        workspace: z
          .object({
            worktree_path: z.string().max(500).optional(),
            branch: z.string().max(200).optional(),
            machine: z.string().max(120).optional().describe("Defaults to actor.machine"),
          })
          .optional(),
        release_to: z.enum(["Ready", "Backlog"]).optional(),
      },
      annotations: write,
    },
    writeHandler("claim", (input, ctx) => claim(db, input, ctx)),
  );

  server.registerTool(
    "add_decision",
    {
      description: [
        "Append one decision to the log. Do not type a date: the server stamps it (TEXT_HAS_DATE).",
        "task_key ties it to a ticket or initiative; tags group it. pin makes it a must_keep in get_resume, under its initiative or project-wide.",
        "When it reverses earlier decisions, pass their ids as supersedes (one or several): each old one is marked superseded (the new one inherits task and pin from the first unless you say otherwise).",
        "A decision that no longer holds and has no replacement is retired with retire_decision.",
        "adr_body stores the full ADR as a project doc (adr_doc_id, read with get_doc); adr_url links one kept elsewhere.",
      ].join(" "),
      inputSchema: { project, actor, request_id, ...addDecisionFields },
      annotations: write,
    },
    writeHandler("add_decision", (input, ctx) => addDecision(db, input, ctx)),
  );

  server.registerTool(
    "reserve_sequence",
    {
      description: [
        "Reserve the next number of a per-project sequence (e.g. name 'migration' gives '0009') for a ticket, so two initiatives never take the same one.",
        "Retrying for the same ticket returns the number it already holds (existing: true); pass additional to get another.",
        "value takes a specific number: SEQUENCE_TAKEN if another ticket holds it, unless that ticket is Won't do. at_least skips ahead.",
        "width (digits, default 4) is fixed by the first reservation of a name. get_project lists every reservation.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        name: z.string().describe("Lowercase, e.g. migration"),
        task_key: key.describe("Ticket that will use the number"),
        at_least: z.number().int().optional(),
        value: z.number().int().optional(),
        width: z.number().int().optional(),
        additional: z.boolean().optional(),
      },
      annotations: write,
    },
    writeHandler("reserve_sequence", (input, ctx) => reserveSequence(db, input, ctx)),
  );

  server.registerTool(
    "ask",
    {
      description: [
        "Ask Jorge a question about a task, in Plania rather than only in your chat, so any session can see it and its answer.",
        "A ticket moves to Needs Jorge (your lease stays; heartbeat to keep it) until every open question on it is answered.",
        "options are suggested answers; he may answer freely. blocks names other tickets waiting on the answer; urgency says how soon. get_resume lists open_questions.",
        "Never only write 'waiting on Jorge' in next_action or blocked_note: a line that starts with 'Jorge:' becomes a human_action blocker on its own (JORGE_LINE_PARSED), and the audit flags the rest (WAITING_ON_JORGE_FREE_TEXT); ask here, request_approval or blocked_by human_action instead.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        verbose,
        key,
        question: z.string(),
        options: z.array(z.string()).optional(),
        blocks: z.array(z.string()).optional().describe("Other task keys this answer holds up (shown in the inbox and the digest)"),
        urgency: z.enum(URGENCIES).optional().describe("How soon Jorge is needed: now | soon | whenever"),
      },
      annotations: write,
    },
    writeHandler("ask", (input, ctx) => ask(db, input, ctx)),
  );

  server.registerTool(
    "answer",
    {
      description: [
        "Record Jorge's answer to a question (he answers on screen, or tells you in chat and you record it here, quoting him).",
        "Pass decision_text when the answer settles something worth keeping: that line goes to the decision log (tag answer). Without it no decision is written.",
        "When no question is left open the ticket returns to its previous status (In progress without a live lease returns to Ready).",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        verbose,
        question_id: z.string().min(1),
        answer: z.string(),
        decision_text: z.string().optional().describe("One line for the decision log, if the answer decided something"),
      },
      annotations: write,
    },
    writeHandler("answer", (input, ctx) => answer(db, input, ctx)),
  );

  server.registerTool(
    "set_project",
    {
      description: [
        "Edit the project's title, body (stack, repo, prod, constraints), rules (project-specific additions to the protocol) or headline.",
        "headline: one line (≤ 280 chars) on where the project stands, shown first in get_resume; the server marks it stale when an env, an initiative or a Done moves after it.",
        "settings merge key by key (null removes one): release_target (env a Released ticket reached, default prod), branch_pattern (regex), claim_from (backlog | ready, what get_next offers),",
        "resources ({'port:*': {needs_approval, ttl_max}}), quotas ({'quota:omdb': {daily}}), github ({repo, token_env}), vercel ({project_id, team_id, token_env, targets}), release ({from, into, env}: the branch Jorge fast-forwards into another to ship, e.g. sandbox → main for prod). Never a secret: integrations name env vars.",
        "Pass the version from get_project; STALE_VERSION if it moved. The old text stays in the log.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        version: z.number().int().optional(),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        rules: z.string().optional(),
        headline: z.string().optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: write,
    },
    writeHandler("set_project", (input, ctx) => setProject(db, input, ctx)),
  );

  server.registerTool(
    "set_env",
    {
      description: [
        "Record what an environment runs, as data other sessions can check: commit and branch deployed, migrations (the tags applied, e.g. ['0009_x']; migrations_applied is derived), flags (configuration state, never secret values: {google_oauth: false, omdb_key: 'valid'}; null removes one).",
        "deployed takes {provider, deployment_id, url}: the server stamps deployed_at and keeps where it came from (DEPLOY_SOURCE_REQUIRED otherwise).",
        "commits adds shas known to be in that environment (for contains_commit blockers). Only the fields you pass change; get_project shows env. Blocked tickets whose env_flag or env blockers now hold move to Ready.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        env: z.string().describe("e.g. prod, sandbox, preview, local-db"),
        commit: z.string().optional(),
        branch: z.string().optional(),
        migrations_applied: z.number().int().optional().describe("Deprecated: pass migrations"),
        migrations: z.array(z.string()).optional().describe("Every migration tag applied, replaces the list"),
        flags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
        commits: z.array(z.string()).optional(),
        deployed: z.union([z.boolean(), z.object({ provider: z.string(), deployment_id: z.string(), url: z.string().optional() })]).optional(),
      },
      annotations: write,
    },
    writeHandler("set_env", (input, ctx) => setEnv(db, input, ctx)),
  );

  server.registerTool(
    "request_approval",
    {
      description: [
        "Ask Jorge to approve one move you cannot make yourself: action wont_do | reopen (a status change), waive_check (target {n}, once In review or later), runbook_step, lease_resource. Done needs no approval: set it yourself.",
        "It shows in his inbox; he grants or rejects it on screen. Then pass the approval_id to set_task / waive_check: it unlocks that one move and is spent.",
        "Asking again for the same task, action and target while one is pending returns it (existing: true).",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        key,
        action: z.enum(APPROVAL_ACTIONS),
        reason: z.string().min(1).describe("Why: what is done, what the evidence shows"),
        target: z.record(z.string(), z.unknown()).optional().describe("e.g. {n: 3} for waive_check"),
      },
      annotations: write,
    },
    writeHandler("request_approval", (input, ctx) => requestApproval(db, input, ctx)),
  );

  server.registerTool(
    "waive_check",
    {
      description: [
        "Mark one Done when item as not going to be done, with the reason (it then counts as closed for In review and Done).",
        "Free while the ticket is still being worked; once it is In review or later it needs an approval Jorge granted (request_approval action waive_check, target {n}) as approval_id: APPROVAL_REQUIRED otherwise.",
      ].join(" "),
      inputSchema: { project, actor, request_id, verbose, key, n: z.number().int(), reason: z.string().min(1), approval_id: z.string().optional() },
      annotations: write,
    },
    writeHandler("waive_check", (input, ctx) => waiveCheck(db, input, ctx)),
  );

  server.registerTool(
    "retire_decision",
    {
      description: "Retire a decision that no longer holds and has no replacement (to replace one, add_decision with supersedes). Hidden from get_memory and must_keep from then on; the text stays in the log.",
      inputSchema: { project, actor, request_id, decision_id: z.string().min(1), reason: z.string().min(1) },
      annotations: write,
    },
    writeHandler("retire_decision", (input, ctx) => retireDecision(db, input, ctx)),
  );

  server.registerTool(
    "get_inbox",
    {
      description: [
        "Everything waiting on Jorge, oldest first per kind, each item with its group: decisiones (pending approvals, open questions), pasos (human actions a task waits on, the project's release) and limpieza (what agents left on the Mac).",
        "count and by_project count decisiones and pasos; chores counts limpieza. Each item says why it waits, how long (wait_s), the latest passing evidence and the PR. project: a slug, or 'all'. count 0 means nothing needs him.",
      ].join(" "),
      inputSchema: { project: z.string().min(1).describe("Project slug, or all") },
      annotations: readOnly,
    },
    ({ project }) => run(async () => inbox(db, project === "all" ? "all" : await findProject(db, project))),
  );

  server.registerTool(
    "audit",
    {
      description: [
        "What the server can see is wrong, from data it has: REVIEW_PR_MERGED, DONE_CHECKS_OPEN, MERGED_CHECKS_OPEN, INITIATIVE_CHILDREN_DONE, INITIATIVE_STATE_NOTE_STALE, DECISION_STALE_REF, DECISION_CONTRADICTS_DONE,",
        "ENV_DEPLOYED_AT_MISSING, ENV_DRIFT, BLOCKED_BUT_SATISFIED, CLAIMABLE_BUT_GATED, CLAIM_EXPIRED_WITH_COMMITS, BRANCH_MERGED_NOT_DELETED, BRANCH_WITHOUT_TICKET, TASK_MISSING_PR_URL, WAITING_ON_JORGE_FREE_TEXT, OVERDUE, and the footprint codes.",
        "Each finding has key, detail and fix_hint. It also runs every ten minutes; get_resume.status.audit_findings is the last count.",
      ].join(" "),
      inputSchema: { project },
      annotations: readOnly,
    },
    ({ project }) => run(async () => runAudit(db, await findProject(db, project))),
  );

  server.registerTool(
    "get_context",
    {
      description: [
        "One call for a session opening a worktree: from workspace {branch, worktree_path, machine} (and your session_id) it returns the initiative on that branch, the tickets on it, your live claims (with any handoff note),",
        "the pinned decisions that apply, open questions and pending approvals on those tickets, the footprint they have on the Mac (footprint) and what your session registered (my_footprint), and the events since since_cursor that touch them. UNKNOWN_BRANCH when nothing is on the branch.",
      ].join(" "),
      inputSchema: {
        project,
        workspace: z.object({ branch: z.string().optional(), worktree_path: z.string().optional(), machine: z.string().optional() }),
        session_id: z.string().optional(),
        since_cursor: z.number().int().min(0).optional(),
      },
      annotations: readOnly,
    },
    ({ project, workspace, session_id, since_cursor }) => run(async () => getContext(db, await findProject(db, project), { workspace, session_id, since_cursor })),
  );

  server.registerTool(
    "handoff",
    {
      description: [
        "Hand your claim to another session (its session_id) or to anyone ('open'), with a note: what is done, what is next, the branch head (head_sha). Your lease ends; In progress goes to Ready.",
        "The receiver claims and gets the note back; for ten minutes nobody else may (HANDOFF_HELD). get_task shows every workspace the ticket has used.",
      ].join(" "),
      inputSchema: { project, actor, request_id, verbose, key, to: z.string().min(1).describe("A session_id, or open"), note: z.string().min(1), head_sha: z.string().optional() },
      annotations: write,
    },
    writeHandler("handoff", (input, ctx) => handoff(db, input, ctx)),
  );

  server.registerTool(
    "set_metric",
    {
      description: "Report a measured value (e.g. pickevent_nights 31) for metric_gte blockers; a result's metrics field does the same. Blocked tickets whose blockers now hold move to Ready.",
      inputSchema: { project, actor, request_id, name: z.string().min(1), value: z.number().int() },
      annotations: write,
    },
    writeHandler("set_metric", async (input, ctx) => {
      const p = await findProject(db, input.project);
      return writeTx(db, p, ctx, (tx, emit) => setMetricInTx(tx, emit, p.id, input.name, input.value, ctx.actor));
    }),
  );

  server.registerTool(
    "lease_resource",
    {
      description: [
        "Hold a shared thing for a while so no other session uses it: a dev port (port:3001, scoped to your machine automatically), the production migrate step (neon-prod:migrate), anything by name.",
        "RESOURCE_HELD says who has it and until when. Leasing again extends it. Names matching a settings.resources policy with needs_approval need an approval_id (request_approval, action lease_resource, target {name}) on a key-less approval: ask on the initiative.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        name: z.string().min(1),
        ttl_minutes: z.number().int().optional().describe("Default 30, max 1440"),
        purpose: z.string().optional(),
        approval_id: z.string().optional(),
      },
      annotations: write,
    },
    writeHandler("lease_resource", (input, ctx) => leaseResource(db, input, ctx)),
  );

  server.registerTool(
    "release_resource",
    {
      description: "Give a leased resource back. Releasing what you do not hold is a no-op.",
      inputSchema: { project, actor, request_id, name: z.string().min(1) },
      annotations: write,
    },
    writeHandler("release_resource", (input, ctx) => releaseResource(db, input, ctx)),
  );

  server.registerTool(
    "register_footprint",
    {
      description: [
        "Declare something you started that outlives the command: a dev server, a database or a copy of one, a container, a service, a tunnel, a worktree. Plania also watches the Mac itself;",
        "a declaration for something it already sees merges into that row (source both) and adds who, why and how to remove it. Needs actor.machine (or an agent token with a machine).",
        "locator by kind: server port:3069 (3069 and :3069 work); db_server postgres:5433; database name@host:port (name alone means @127.0.0.1:5432);",
        "worktree an absolute path; browser and tunnel pid:N; service brew:<formula> or launchagent:<label>; container docker:<name>; cache free text.",
        "teardown is the command that removes it (Plania never runs it). task_key defaults to your only live claim in the project (none or several: no ticket; pass task_key).",
        "Name databases <project>_<ticket key lowercased, - to _>_<purpose>, e.g. zigzag_zig_i5_scratch. FOOTPRINT_HELD when another live session declared it. Registering again updates your own.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        kind: z.enum(FOOTPRINT_KINDS),
        locator: z.string().min(1),
        purpose: z.string().min(1).describe("What it is for, in a line"),
        teardown: z.string().min(1).describe("The command that removes it, e.g. kill 41152 or dropdb zigzag_zig_i5_scratch"),
        task_key: key.optional(),
        details: z.record(z.string(), z.unknown()).optional().describe("Anything worth showing: port, path, branch, size"),
      },
      annotations: write,
    },
    writeHandler("register_footprint", (input, ctx) => registerFootprint(db, input as never, ctx)),
  );

  server.registerTool(
    "release_footprint",
    {
      description: [
        "Say a registered footprint is torn down; it leaves the Machine inventory. Only the session that declared it (or Jorge) may: FOOTPRINT_HELD otherwise. A row the job only observed has no holder and anyone in the project may release it.",
        "Unknown locator: {released: false}. Release it after you ran its teardown; if Plania still sees it running on its next look, it comes back as a new observed row. kind is only needed when the locator fits several.",
      ].join(" "),
      inputSchema: { project, actor, request_id, locator: z.string().min(1), kind: z.enum(FOOTPRINT_KINDS).optional() },
      annotations: write,
    },
    writeHandler("release_footprint", (input, ctx) => releaseFootprint(db, input, ctx)),
  );

  server.registerTool(
    "consume",
    {
      description: "Count n (default 1) against a daily quota from settings.quotas (e.g. quota:omdb with daily 1000). QUOTA_EXCEEDED says what is left; the day is UTC.",
      inputSchema: { project, actor, request_id, name: z.string().min(1), n: z.number().int().optional() },
      annotations: write,
    },
    writeHandler("consume", (input, ctx) => consume(db, input, ctx)),
  );

  server.registerTool(
    "batch",
    {
      description: [
        "Several writes in one call: ops of create_task, set_task, set_check, add_result, add_decision or note ({op: 'note', key, text}), each with the fields of its tool (project, actor and request_id come from the batch).",
        "atomic (default true): one transaction; the first failing op rolls everything back and the error is BATCH_FAILED {index, op, failed: {error, ...}}.",
        "atomic false: each op commits on its own and a failed one shows inline as {error, status} in results; a retry with the same request_id replays the ops that went through.",
        "Versions chain: an op on a key an earlier op in the batch already changed may omit version. Reply: {applied, results[]} in op order.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        verbose,
        atomic: z.boolean().optional(),
        ops: z.array(batchOp).min(1).max(50),
      },
      annotations: write,
    },
    writeHandler("batch", (input, ctx) => runBatch(db, input, ctx)),
  );

  return server;
}
