import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { branchRoles } from "../camino/roles.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Scope } from "../auth/bearer.js";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { AGENT_ORIGINS, KINDS } from "../db/schema.js";
import { FOOTPRINT_KINDS } from "../jobs/machine/infer.js";
import { inbox } from "./inbox.js";
import { waiveCheck } from "./checks.js";
import { addDecision, retireDecision } from "./decisions.js";
import { choreFor } from "./orden.js";
import { openRequests } from "./requests.js";
import { headlineNoteShape, setProject } from "./project.js";
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
import { MAX_FRAMES, attachFrames } from "../pedidos/frames.js";
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
import { LEGACY, isOwnerAgent, personalize, readOldSpellings } from "../owner.js";
import { releasePlan } from "./release-plan.js";
import { answerDelegated } from "./delegate.js";
import { URGENCIES, answer, ask } from "./questions.js";
import { registerTeamTools } from "./team.js";
import { TTL, claim, createTask, handoff, setTask } from "./writes.js";
import { runAudit } from "./audit.js";
import { getContext } from "./context.js";
import { registerGoalTools } from "./goals.js";
import { registerDelegationTools } from "./delegation.js";
import { registerDashboardTools } from "./dashboard.js";
import { registerUsageTools } from "./usage.js";
import { registerTemplateTools } from "./templates.js";
import { registerHeartbeatTools } from "./heartbeat.js";
import { closingLine, questionLine, registerThreadTools } from "./threads.js";
import { registerConsultaTools } from "./consultas.js";
import { registerSeatTools } from "./seats.js";
import { registerConnectionTools } from "./connections.js";
import { registerMarksTools } from "./marks.js";
import { registerProposalTools } from "./proposals.js";
import { registerStageTools } from "./stage-docs.js";
import { finish, start } from "./agent-surface.js";
import { muestraSchema } from "../captures/muestra.js";
import { afterFinish, warmOn } from "../captures/entrega.js";
import { projectReleases } from "./releases.js";
import { runnerOfProject } from "../api/company-runner.js";
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

const project = z.string().min(1).describe("Project slug, e.g. tienda");
const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const key = z.string().min(1).describe("Human key, e.g. TND-01-F2");

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
      z.object({
        human_action: z.object({
          assignee: z.string().optional(),
          text: z.string(),
          before_release: z.boolean().optional(),
          file: z
            .object({ path: z.string().describe("Path inside the repo, e.g. .env.example"), append: z.string().describe("The exact lines to add, newline-separated") })
            .optional()
            .describe("Lines your session may not write into a file (e.g. .env.example): the owner reviews them and Plania commits them to this ticket's PR in one click. Never real secrets: .env and .env.local are refused."),
        }),
      }).describe("Something the owner has to do; shows in their inbox. before_release: true lists it as a step of the project's release. A file you may not write: add file {path, append}"),
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

// Every write: size limits, the actor ("owner" is reserved for the screen; an agent token fills
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
  if (isOwnerAgent(agent)) throw new ToolError("RESERVED_ACTOR");
  const actorOut = { ...input.actor, agent, ...(machine !== undefined ? { machine } : {}) };
  return { actor: actorOut, requestId: input.request_id, tool, verbose: input.verbose, tokenId: identity?.tokenId, ...(identity?.runSession ? { runSession: identity.runSession } : {}) };
}

// Field schemas shared by a tool and its batch op (keys.ts assigns keys; see create_task).
const createFields = {
  key: key.optional().describe("Omit it: the server assigns PREFIX-I<n> (initiative), PREFIX-IDEA<n> (idea), PREFIX-<nn> (standalone ticket) or <initiative>-<n> (phase)"),
  kind: z.enum(KINDS).optional().describe("ticket (default) | initiative | idea"),
  title: z.string().min(1),
  scope: z.string().optional().describe("What it is: PRD and plan (initiative) or the phase's scope (ticket). Markdown"),
  checks: z.array(z.string()).optional().describe("Done when, one item per string"),
  phase: z.number().int().optional().describe("Tickets: Phase N within the initiative"),
  body: z.string().optional().describe("Removed in v2 (BODY_REMOVED): use scope and checks"),
  summary: z.string().optional().describe("The one line shown in lists"),
  parent_key: z.string().nullable().optional().describe("Tickets: initiative key; omit or null for a standalone spec"),
  priority: z.string().optional().describe("Tickets: P0 | P1 | P2 | P3"),
  origin: z.enum(AGENT_ORIGINS).optional().describe("Tickets only. owner is the screen's: the owner's own requests"),
  blocked_by: blockedBy.optional(),
  status: z.string().optional().describe("Tickets: Backlog | Ready. Initiatives always start in Planning. Ideas always start in Open"),
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
  owner_agent: z.string().nullable().optional().describe("Roster slug of the agent who owns this task. Informational: it does not take the lease. Null clears it"),
  goal_id: z.string().uuid().nullable().optional().describe("Initiatives only: the goal this initiative serves (list_goals id). Null clears it. A ticket or idea is FIELD_NOT_ALLOWED"),
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
  reason: z.string().optional().describe("Required for Won't do and for reopening a closed task. On screen that is enough"),
  delegated_by_owner: z
    .object({
      message_id: z.string().optional().describe("Id of the owner's chat message, 8 to 200 characters"),
      quote: z.string().optional().describe("8 to 280 characters of their instruction"),
    })
    .optional()
    .describe("Required for an agent Won't do or reopen. The screen does not send it"),
  // PLA-I2-14: the old spelling of delegated_by_owner, read until protocol 2.25 with an OLD_SPELLING warning.
  [LEGACY.field]: z.object({ message_id: z.string().optional(), quote: z.string().optional() }).optional().describe("Old spelling of delegated_by_owner, still read for one protocol version"),
  withdraw_blocker: z.string().optional().describe("Id of a human_action your own note created (OWNER_LINE_PARSED) that asks nothing of the owner: it is removed. Same session or token only; needs no version"),
  no_pr_reason: z.string().optional().describe("Done, Merged or Released on a code ticket without pr_url: why the work had no PR (otherwise TASK_MISSING_PR_URL). Logged as task.no_pr"),
  stage: z.string().optional().describe("Ideas only. One step along idea → research → design → planning → ready. A step back needs a note. Skipping a stage is INVALID_STAGE_MOVE; a move without that stage's doc or headings is STAGE_REQUIREMENTS_MISSING. Nothing else holds a forward move"),
  promoted_to: z.string().nullable().optional().describe("Ideas only: key of the initiative or standalone ticket this idea became. A phase or another idea is PROMOTED_TO_INVALID"),
  note: z.string().optional(),
  version: z.number().int().optional().describe("The version you read. Required unless note or withdraw_blocker is the only field"),
  owner_agent: z.string().nullable().optional().describe("Roster slug of the agent who owns this task. Informational: it does not take the lease. Null clears it"),
  goal_id: z.string().uuid().nullable().optional().describe("Initiatives only: the goal this initiative serves (list_goals id). Null clears it"),
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

const workspace = z
  .object({
    worktree_path: z.string().max(500).optional(),
    branch: z.string().max(200).optional(),
    machine: z.string().max(120).optional().describe("Defaults to actor.machine"),
  })
  .describe("Where the code is checked out. A phase defaults to its initiative's integration branch");

// batch ops: the same fields as the tool, plus op; project, actor and request_id come from the batch.
const batchOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create_task"), ...createFields }),
  z.object({ op: z.literal("set_task"), ...setTaskFields }).loose(),
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

  // PLA-I2-14: descriptions say "the owner"; they read as the owner's display name when one was given.
  {
    const register = server.registerTool.bind(server);
    server.registerTool = ((name: string, config: { description?: string }, cb: never) =>
      register(name, (config.description ? { ...config, description: personalize(config.description) } : config) as never, cb)) as typeof server.registerTool;
  }

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
        "Where the project stands, generated from data: live claims (who, until when, where), requests (the owner's open asks from the screen, newest first: read them first), the next claimable ticket,",
        "and per open initiative its derived state {phase_now, done, total, in_progress, in_review, waiting_on, line}, the notes (state_note, in_progress, next_action with next_claimable), must_keep (pinned decisions) and status counts, plus readiness.",
        "readiness is read-only {state, reasons, line}. state is ready, caution, blocked or no_context: no_context wins, then blocked, then caution, else ready.",
        "no_context: no live or expired claim, no ticket In review, no initiative next_action, no next claimable ticket, and no event in 14 days.",
        "blocked: BLOCKER_OPEN (unsatisfied blocker or Blocked), CI_FAILURE, DEPLOY_BLOCKED (failed deploy or env behind the integration branch, on a ticket In review), AREAS_OVERLAP, DECISION_PENDING (open question or human_action on the ticket to resume).",
        "caution: LEASE_EXPIRED, OWNER_ABSENT (footprint old or missing), CLAIM_QUIET (past PLANIA_QUIET_MIN), WORKTREE_DIRTY, DIRTY_UNKNOWN, ENV_UNKNOWN (missing environment commit or integration head, on a ticket In review), NOTE_STALE, PR_PENDING, PR_UNREADABLE, DECISION_ELSEWHERE, NO_NEXT.",
        "ready: a healthy live claim, a ticket In review with checks passing, or a clear next step, and none of the above. Unknown or missing data (dirty null, a live claim with no footprint, an unreadable PR, a missing environment commit or integration head) is caution, never ready.",
        "Each reason is {code, severity, text, task_key}; text is one short sentence in the owner's language naming the ticket. line is one sentence.",
        "Also the headline {generated, note}: generated from the data (what the release target runs, the release step, claims, what waits on the owner, what is next), and the note set_project wrote (stale: true once an env, an initiative or a Done moved after it),",
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
        "Project title, long body (stack, repo, prod, constraints), rules (project-specific additions to the protocol in the server instructions) with rules_version, protocol_version, headline (the note set_project writes; get_resume has the generated line), settings (release_target, branch_pattern, claim_from, resources, quotas, github, vercel, release),",
        "ticket counts, env (per environment: commit, branch, migrations, flags, deployed_at and its source), branches (each with its owner, head and merge state), resources (live leases, today's quotas), metrics, reserved sequence numbers with the ticket holding each,",
        "and release: the step settings.release names (from → into), with how far from is ahead, the merged tickets it ships, their migrations, the before-steps, open checks, the command the owner runs, its mode (command, or merge: the owner ships it from the screen) and merged once they did (null without settings.release). Agents never merge it.",
        "branch_roles: how the project publishes (trunk, integ, tags), its published and integration branches and the work-branch pattern, as the owner set them in Camino; read them instead of assuming branch names.",
        "runner: the project's run limits set in Motores (max_concurrent, consulta_slots, max_per_agent, serialize_areas) and what is live now (work, consulta). Read-only: no tool changes them.",
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
          headline: headlineNoteShape(p),
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
          // PLA-I68-3: the branch roles set in Camino (or read from older settings): never assume branch names.
          branch_roles: await branchRoles(db, p),
          // PLA-I60-5: «a la vez», read-only (set in Motores by the owner).
          runner: await runnerOfProject(db, p),
          ...(await projectSequences(db, p.id)),
        };
      }),
  );

  server.registerTool(
    "list_tasks",
    {
      description: [
        "Initiatives, tickets and ideas without scope, with version, claimed_by (live lease owner or null) and updated_at. Ordered P0 to P3 (null last), then most recently updated.",
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
    ({ project, parent_key, work_type, updated_since, severity, ...raw }) =>
      run(async () => {
        const p = await findProject(db, project);
        const { input: f, warnings } = readOldSpellings(raw); // PLA-I2-14: the old status spelling still reads
        return {
          tasks: await listTasks(db, p.id, { ...f, parentKey: parent_key, workType: work_type, severity, updatedSince: updated_since }),
          ...(warnings.length ? { warnings } : {}),
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
        "Next claimable ticket: Backlog or Ready, or In progress with an expired lease (stale_claim: true), with every blocker satisfied (tasks In review or Done, env conditions holding). P0 first; within a priority, the owner's requests (origin owner) first, then key. requests (present when there are any) lists every open one, newest first: read them first. Read-only: does not claim; call claim next. When nothing is claimable (task null) it offers chore: one audit finding an agent can fix (its fix_hint names the tool), or a state_note older than the initiative's last move; do it.",
      inputSchema: { project, initiative_key: z.string().optional() },
      annotations: readOnly,
    },
    ({ project, initiative_key }) =>
      run(async () => {
        const p = await findProject(db, project);
        // 2.12: the owner's open requests ride on top (when there are any), newest first; the offer itself
        // prefers one at equal priority.
        const requests = await openRequests(db, p.id);
        const next = { ...(requests.length ? { requests } : {}), ...(await nextTask(db, p.id, initiative_key)) };
        // 2.11: a quiet project still has housekeeping; get_next hands one piece of it out.
        if (next.task || initiative_key) return next;
        const chore = await choreFor(db, p);
        return chore ? { ...next, chore } : next;
      }),
  );

  server.registerTool(
    "list_events",
    {
      description: [
        "What changed, oldest first: every write is an event with its actor, server time, project and a one-line summary (in the owner's language).",
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
        "Every project in one line each: slug, title, key_prefix, headline, line (what is claimed, else the next step, else what is next to claim, else the last event, else empty),",
        "ticket counts (open, in_progress, in_review, needs_owner, blocked, done), open_questions, claims, last_event_id and last_event_at, and readiness (state, reasons, line; same object as get_resume), sorted by slug.",
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
        "Includes the owner, workspace (branch, worktree) and what the ticket has running on the machine (footprint). Use it to tell a working session from a dead one.",
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
        "One call for an assistant that keeps the owner updated: what changed since a cursor, grouped by project with summaries in the owner's language and highlights",
        "(done, to_review, blocked, needs_owner, prs_opened, prs_merged, claims), what runs now (get_running) and what waits on the owner (get_inbox all), plus unchanged_projects and readiness (state, reasons, line) on each changed project.",
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
    "start",
    {
      description: [
        "Open a ticket in one call: claim on key (In progress, your lease) plus get_context for the workspace. The reply is get_context's shape (initiative, tickets, my_claims, pinned_decisions, open_questions, approvals, footprint, audit findings on your tickets, requests) with key, status, version, claim, workspace and, when the ticket was handed to you, handoff (the previous session's note and head_sha).",
        "workspace {worktree_path, branch}: a phase defaults to its initiative's integration branch (one PR per initiative); a branch another live initiative owns is BRANCH_IN_USE; names follow the project's branch_pattern.",
        "Errors are claim's: CLAIM_HELD (pick another), NOT_CLAIMABLE (status or an unsatisfied blocker), HANDOFF_HELD. warnings name other live claims on overlapping areas.",
        `The lease lasts ttl_minutes (default ${TTL.default}): send claim action heartbeat (key "*" for all yours) before it runs out. Calling start again on a ticket you hold extends it.`,
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        verbose,
        key,
        workspace: workspace.optional(),
        ttl_minutes: z.number().int().optional(),
        since_cursor: z.number().int().min(0).optional().describe("Events after this cursor that touch these tickets"),
      },
      annotations: write,
    },
    writeHandler("start", (input, ctx) => start(db, input, ctx)),
  );

  server.registerTool(
    "finish",
    {
      description: [
        "Close your part of a ticket in one transaction: add_result (result: kind, verdict, cite, commit, command, counts, check_ns...) then set_task status In review with branch and pr_url. If either step fails nothing is written.",
        "Code tickets need pr_url (TASK_MISSING_PR_URL), or no_pr_reason when the work had no PR. Put \"Plania: <KEY>\" in the PR body so the poller links it. Commit and push first: In review means committed, not merged.",
        "Every check must be done or waived: CHECKS_OPEN lists each open one with its n and text (tick them with result.check_ns, set_check, or waive_check with a reason).",
        "The result must be a pass of a kind the work_type accepts, at the branch head: EVIDENCE_STALE says the head the poller sees and the commit your pass named.",
        "version: the one you read (STALE_VERSION if it moved); omit it to take the current one. note: the initiative's new next_action, when it changed.",
        "muestra: a delivery whose diff touches the screen, on a project Plania photographs (settings.capture), needs one: MUESTRA_REQUIRED lists the screen files. Plania shows the owner those views before asking; nobody approves what they cannot see.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        verbose,
        key,
        result: z.object((({ key: _k, ...rest }) => rest)(addResultFields)).describe("The evidence, as add_result takes it (without key)"),
        pr_url: z.string().optional(),
        branch: z.string().optional(),
        version: z.number().int().optional(),
        note: z.string().optional().describe("The initiative's next_action, replaced"),
        no_pr_reason: z.string().optional().describe("Why a code ticket has no PR"),
        muestra: muestraSchema
          .optional()
          .describe(
            "What the owner will be shown (El Probador): frase (one sentence on what changes for the app's users), vistas (the views it touched: key, label, path, estado?, session?, follow?, acciones? [{click: a button's visible text or a CSS selector} | {fill: a CSS selector, value}]; plain CSS only: Playwright forms such as :has-text( or >> are MUESTRA_SELECTOR, PLA-158), pasos (three ways to try it). Each view must land on the screen that changed: a record page reached from a list (one client, one ticket) needs follow: the href prefix of the link to open (e.g. /panel/novias/) or a CSS selector of that link; a view whose before and after are the same shows the owner nothing (PLA-70); a page that shows the framework's error overlay or a 5xx is marked error and holds Aceptar back (PLA-76). url: the path the photo must land on (default: path; with a follow path, anything under it; :name matches one segment, a final * the rest); a photo taken on another URL is marked wrong and holds Aceptar back (PLA-I74-10). Empty-state frames Artist put on the idea become extra views, photographed before datos loads. datos: when a view needs rows the app's dev data lacks (an appointment today, a client at some stage), the SQL that inserts fake ones (example.com, times from now()); Plania runs it on both throwaway copies' databases, never the app's own, in one transaction before the pictures (PLA-78). The views run in order on that one database, every view on desktop and then every view on phone, so acciones may open, pick and fill but never press a button that saves, cancels or sends: a later view would find the data changed. Show a state after a save (a moved appointment, its history) by seeding it in datos and opening it with path or follow (PLA-107). The rows of the initiative's earlier accepted steps are loaded after yours, statement by statement, skipping what your datos already made (PLA-97): seed only what this step needs. Derive every fake id, link token and other unique value in datos from the ticket key (e.g. the key in lowercase as a prefix), never a fixed one another step could reuse: steps that shared a token showed impossible states (PLA-158). Required when the diff touches the screen on a project with settings.capture (MUESTRA_REQUIRED)",
          ),
      },
      annotations: write,
    },
    writeHandler("finish", async (input, ctx) => {
      const out = await finish(db, input as never, ctx);
      // PLA-I32-3: a runner's finish leaves its line in the project thread (best effort, after the commit).
      const i = input as { project: string; key: string; result?: { cite?: string; verdict?: string }; pr_url?: string };
      await closingLine(db, ctx, { project: i.project, key: i.key, via: "finish", cite: i.result?.cite, verdict: i.result?.verdict, prUrl: i.pr_url }).catch((e) => (console.log(`[thread] closing line of ${i.project}/${i.key} failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`), null));
      // PLA-I52-2/3: a delivery with a muestra warms its own copy and gets its pairs for El Probador (background).
      if (warmOn()) afterFinish(db, i.project, i.key);
      return out;
    }),
  );

  server.registerTool(
    "create_task",
    {
      description: [
        "Create a ticket (default), an initiative, or an idea.",
        "Idea: kind idea, key PREFIX-IDEA<n> (TND-IDEA3), status Open, stage idea. It is not claimed, not offered by get_next, and not counted in the release plan.",
        "Initiative: starts in Planning; scope holds the PRD and the phased plan; base_branch defaults to main; next_action optional. Then create one ticket per phase.",
        "Ticket with parent_key: a phase of that initiative, with phase N, its scope (without copying the PRD) and checks (the Done when list, one string each). Without parent_key: a standalone spec.",
        "Tickets: priority defaults to P2, status to Backlog (or Ready), work_type to code. origin defaults to discovered when the parent is Active or Shipping, otherwise chartered.",
        "Every ticket needs a scope; code and ops tickets need at least one check (TEMPLATE_INVALID lists what is missing). Convention slips come back as warnings.",
        "Keys are the server's: omit key and the reply carries the one assigned (PREFIX-I<n> for an initiative, PREFIX-IDEA<n> for an idea, PREFIX-<nn> for a standalone ticket, <initiative>-<n> under a parent).",
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
        "Update a ticket, an initiative or an idea. Only the fields you pass change; blocked_by replaces the whole list.",
        "Pass the version you read (get_task); if anyone wrote since, you get STALE_VERSION with current_version: re-read and retry. A note alone needs no version.",
        "Do not set In progress here: use claim. While another session holds a live lease, only it can change the task (NOT_OWNER); notes are always allowed.",
        "A note goes to the task's log with your actor and a server timestamp; it is the only way to add text without a version. Blocked requires a note, stored as blocked_note.",
        "To tick one Done when item use set_check, not checks.",
        "Ticket moves: Backlog ⇄ Ready; Backlog, Ready, In progress or In review → Blocked (note required) → Backlog or Ready; In progress → In review, Ready or Backlog (each releases the lease). In progress only through claim.",
        "Initiative moves: Planning ⇄ Active ⇄ Shipping, any ⇄ On hold; next_action and in_progress_note feed get_resume. An initiative an idea was promoted to moves like any other.",
        "Idea status is Open, Done or Won't do. stage moves one step along idea → research → design → planning → ready; a step back needs a note (INVALID_STAGE_MOVE when it skips or the note is missing). Moving forward needs that stage's doc and headings (STAGE_REQUIREMENTS_MISSING), and nothing else. A Done or Won't do idea refuses stage and promoted_to (IDEA_CLOSED). promoted_to records the initiative or standalone ticket it became.",
        "Anything else is INVALID_TRANSITION with the allowed moves.",
        "Finishing a phase: finish does add_result and In review in one call. By hand: add_result first, then status 'In review' (committed, not merged) with branch and pr_url; without fitting evidence it is EVIDENCE_REQUIRED.",
        "Merged and Released are the pollers' (GitHub merge; deploy, or with no deploy the release branch containing the merge, settings.release_on); by hand they need a ci pass result naming the merge commit (and, for Released, the release target env containing it).",
        "Done is yours once the work is finished: code, bug and debt tickets from Merged or Released; ops and research from In review on; decision-needed once answered (Backlog, Ready or In progress); an initiative from any open status. Elsewhere it is INVALID_TRANSITION with allowed_from. A released code, bug or debt ticket with every check closed and no open question moves to Done by itself (settings.auto_done, on unless false); get_resume status.released_waiting_done lists the Released tickets something still holds. Under the same setting an initiative whose tickets are all closed closes itself, and one whose tickets are all merged or released gets the next_action that only publishing is left (PLA-82).",
        "Done, Merged or Released on a code ticket needs pr_url (on the ticket or in this call): TASK_MISSING_PR_URL, unless no_pr_reason says why there is none.",
        "Won't do and reopening a closed task are the owner's: HUMAN_ONLY unless this call has a reason. On screen the reason is enough. An agent also sends delegated_by_owner {message_id, quote}. The move is logged. An approval_id is ignored.",
        "In review (and later Done) needs every check done or waived: CHECKS_OPEN lists the open numbers. An initiative needs every ticket closed: INITIATIVE_CHILDREN_OPEN.",
        "A line that starts with 'Owner:' (or the owner's name and a colon) in summary, next_action, in_progress_note, state_note, blocked_note or a note becomes a human_action blocker (warning OWNER_LINE_PARSED); it reaches their inbox without moving the task, and only one from blocked_note holds it Blocked. In the fields (not notes) a sentence naming the owner with a waiting cue counts too. A blocker your note created by mistake: withdraw_blocker with its id.",
        "The reply is {key, status, version, changed}; verbose: true adds the full task.",
      ].join(" "),
      inputSchema: z.object({ project, actor, request_id, verbose, ...setTaskFields }).loose(),
      annotations: write,
    },
    writeHandler("set_task", (input, ctx) => setTask(db, input as Parameters<typeof setTask>[1], ctx)),
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
    writeHandler("add_result", async (input, ctx) => {
      const out = await addResult(db, input, ctx);
      const i = input as { project: string; key: string; cite?: string; verdict?: string };
      await closingLine(db, ctx, { project: i.project, key: i.key, via: "add_result", cite: i.cite, verdict: i.verdict }).catch((e) => (console.log(`[thread] closing line of ${i.project}/${i.key} failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`), null));
      return out;
    }),
  );

  server.registerTool(
    "attach_doc",
    {
      description: [
        "Store a markdown doc in Plania so every machine can read it: a spec or plan on a task (key), or a project doc such as a design page (no key).",
        "A new title creates it (DOC_EXISTS if the title exists). Pass the version you read to replace it (STALE_VERSION if it moved).",
        "Use this instead of plan files that live on one machine.",
        "An idea's stage doc (Idea, Research, Design, Plan) is written for you by deliver_stage: deliver the stage as data instead of attaching that doc.",
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

  // PLA-I61-2 (La idea abierta): Artist's frames, so the owner sees the design on the screen.
  server.registerTool(
    "attach_frames",
    {
      description: [
        "Artist: put the design's frames on an idea so the owner sees them on the screen (the idea's Diseño stop and its review table).",
        "One image per frame (PNG, JPEG or WebP, 5 MB each, up to 40), each with a short id (T, A1, B3), a name, an optional group, what it does (hace) and why (porque), in the order to show them.",
        "path is a file inside the canvases folder on this machine (PLANIA_CANVASES_ROOT, by default ~/plania/canvases); anything else is FRAME_INVALID.",
        "A new call replaces the idea's whole set. Deliver the design stage itself with deliver_stage (approach, scope, out_of_scope), which writes the Design doc.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        key,
        frames: z
          .array(
            z.object({
              id: z.string().min(1).max(16),
              name: z.string().min(1).max(120),
              group: z.string().max(80).optional(),
              hace: z.string().max(400).optional(),
              porque: z.string().max(400).optional(),
              path: z.string().min(1).max(500),
            }),
          )
          .min(1)
          .max(MAX_FRAMES),
      },
      annotations: write,
    },
    writeHandler("attach_frames", (input, ctx) => attachFrames(db, input, ctx)),
  );

  server.registerTool(
    "claim",
    {
      description: [
        `Lease a ticket so no other session works on it. action claim (default): status becomes In progress, owned by your session_id for ttl_minutes (default ${TTL.default}, ${TTL.min}-${TTL.max}).`,
        "Claiming a ticket you already hold extends it. heartbeat: extend your lease while you work; send it before it runs out. heartbeat with key \"*\" extends every lease your session holds in the project in one call (reply: extended keys), and logs nothing.",
        "release: give it back; In progress goes to release_to (default Ready). Moving the ticket to any other status also releases it.",
        "Errors: CLAIM_HELD (someone else holds a live lease; owner and workspace say who and where), NOT_CLAIMABLE (status, or unsatisfied blocked_by), LEASE_EXPIRED (heartbeat after your lease ran out: claim again).",
        "An expired lease is free: anyone may claim it. Pass workspace so others know where the code is checked out: a phase defaults to its initiative's integration branch (one PR per initiative), a branch another live initiative owns is BRANCH_IN_USE, names follow the project's branch_pattern.",
        "warnings name other live claims on overlapping areas, and the handoff note when the ticket was handed to you. start does claim and get_context in one call.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        verbose,
        key,
        action: z.enum(["claim", "heartbeat", "release"]).optional(),
        ttl_minutes: z.number().int().optional(),
        workspace: workspace.optional(),
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
        "Ask the owner a question about a task, in Plania rather than only in your chat, so any session can see it and its answer.",
        "human_only: true means only the owner's screen may answer it; bots are refused.",
        "A ticket moves to Needs owner (your lease stays; heartbeat to keep it) until every open question on it is answered.",
        "options are suggested answers; they may answer freely. blocks names other tickets waiting on the answer; urgency says how soon. get_resume lists open_questions.",
        "The reply carries question_id and waits (\"the ticket waits in Needs owner\"): nothing else to write.",
        "Never only write 'waiting on the owner' in next_action or blocked_note: a line that starts with 'Owner:' becomes a human_action blocker on its own (OWNER_LINE_PARSED), and the audit flags the rest (WAITING_ON_OWNER_FREE_TEXT); ask here or blocked_by human_action instead.",
      ].join(" "),
      inputSchema: z
        .object({
          project,
          actor,
          request_id,
          verbose,
          key,
          question: z.string(),
          options: z.array(z.string()).optional().describe("Suggested answers"),
          human_only: z.boolean().optional().describe("Only the screen may answer"),
          blocks: z.array(z.string()).optional().describe("Other task keys this answer holds up (shown in the inbox and the digest)"),
          urgency: z.enum(URGENCIES).optional().describe("How soon the owner is needed: now | soon | whenever"),
        })
        .loose(),
      annotations: write,
    },
    writeHandler("ask", async (input, ctx) => {
      const out = (await ask(db, input as Parameters<typeof ask>[1], ctx)) as { question_id?: string };
      // PLA-I32-4: a runner's question also lands in its project thread, where the owner can answer it in line.
      const i = input as { project: string; key: string; question: string };
      if (out.question_id) await questionLine(db, ctx, { project: i.project, key: i.key, question: i.question, questionId: out.question_id }).catch(() => null);
      return out;
    }),
  );

  server.registerTool(
    "answer",
    {
      description: [
        "Record the owner's answer to a question that is not human_only (they answer those on the screen; otherwise they may tell you in chat and you record it here, quoting them).",
        "A human_only question is HUMAN_ONLY from here, including for actor agent plania-bot: it is answered on the owner's screen. The only bot path is answer_delegated, and only that agent may call it. Never forward an answer.",
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
    "answer_delegated",
    {
      description: [
        "Record one answer the owner gave actor agent plania-bot in their own chat. Any other agent is HUMAN_ONLY, including a spoofed screen session.",
        "One human_only question that has named options: pass question_id and option, one of the stored options. The question closes as theirs.",
        "An approval_id is ignored and the reply says so. Won't do and reopening go through set_task, with reason and delegated_by_owner.",
        "delegated_by_owner is required: message_id (8 to 200 characters) and quote (8 to 280 characters) of their instruction. Empty or short evidence is DELEGATION_EVIDENCE.",
        "The server cannot prove this caller is the Plania bot or that the message exists: every bot shares the write token and the actor is declared on the request. The controls are the quote, the DELEGATED_ANSWER audit finding, the Delegada badge, 10 answers an hour, one per question, and the screen kill switch (default on). DELEGATION_OFF when that switch is off. DELEGATION_LIMIT when the hour or the question is already used.",
        "This tool cannot raise the limit or flip the switch. The answer tool stays HUMAN_ONLY. The screen click is unchanged. Not available on /api, /hooks or /bot/v1.",
      ].join(" "),
      inputSchema: z
        .object({
          project,
          actor,
          request_id,
          verbose,
          question_id: z.string().optional().describe("A human_only question with named options"),
          option: z.string().optional().describe("One of the question's stored options"),
          delegated_by_owner: z
            .object({
              message_id: z.string().optional().describe("Id of the owner's chat message"),
              quote: z.string().optional().describe("8 to 280 characters of their instruction"),
            })
            .optional(),
        })
        .loose(),
      annotations: write,
    },
    writeHandler("answer_delegated", (input, ctx) => answerDelegated(db, input as Parameters<typeof answerDelegated>[1], ctx)),
  );

  server.registerTool(
    "set_project",
    {
      description: [
        "Edit the project's title, body (stack, repo, prod, constraints), rules (project-specific additions to the protocol) or headline.",
        "headline: the note (≤ 280 chars) beside the generated headline in get_resume, only for what the data cannot say; the server marks it stale when an env, an initiative or a Done moves after it.",
        "settings merge key by key (null removes one): release_target (env a Released ticket reached, default prod), release_on (env | branch: what Released means; unset, branch when the project has no Vercel and no commit for release_target), auto_done (false keeps released tickets from closing themselves), branch_pattern (regex), claim_from (backlog | ready, what get_next offers),",
        "resources ({'port:*': {ttl_max}}), quotas ({'quota:omdb': {daily}}), github ({repo, token_env}), vercel ({project_id, team_id, token_env, targets}), release ({from, into, env, mode}: the branch the owner ships into another, e.g. sandbox → main for prod; mode command (default: they run the command) or merge (they press Lanzar on screen)). capture ({start_command, port, ready_path, pages [{key, path, label, session, follow, full_page}], session {login_path, user (a test address on a reserved domain), user_field, password_field, password_command, after_login_prefix}}: how Plania takes stills of the running app). local ({repo_path, no_code}: the repo folder on the machine, an absolute path, or no_code true for a project with no code yet; never both). Also team ({idle_minutes}), qa, maquinas. Only the owner's screen sets plan_approval, preview_url, auto_accept, auto_accept_invisible, runner and next_first: from an agent they are INVALID_FILTER. start_branch (the branch every worktree is cut from and the only one Aceptar merges into; default sandbox; never main, master, production or prod). A needs_approval flag on an old settings row is ignored. Never a secret: integrations name env vars, and token_env must be a variable's name.",
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
    "waive_check",
    {
      description: [
        "Mark one Done when item as not going to be done, with the reason (it then counts as closed for In review and Done).",
        "The reason is the record at every status, including once the ticket is In review or later. An approval_id is ignored.",
        "A visual check (how the screen looks, a still, a viewport) is waived only by the QA lane or the owner: anyone else gets WAIVE_VISUAL_FORBIDDEN and proves it with a visual result.",
      ].join(" "),
      inputSchema: z.object({ project, actor, request_id, verbose, key, n: z.number().int(), reason: z.string().min(1) }).loose(),
      annotations: write,
    },
    writeHandler("waive_check", (input, ctx) => waiveCheck(db, input as Parameters<typeof waiveCheck>[1], ctx)),
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
        "Everything waiting on the owner, oldest first per kind, each item with its group: decisiones (open questions), pasos (human actions a task waits on, the project's release) and limpieza (what agents left on the machine).",
        "count and by_project count decisiones and pasos; chores counts limpieza. Each item says why it waits, how long (wait_s), the latest passing evidence and the PR. project: a slug, or 'all'. count 0 means nothing needs them.",
        "delegated lists answers plania-bot recorded and Won't do or reopen moves an agent logged (quote, message id, time), so they can review them.",
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
        "What the server can see is wrong, from data it has: REVIEW_PR_MERGED, REVIEW_NOBODYS_TURN, DONE_CHECKS_OPEN, MERGED_CHECKS_OPEN, INITIATIVE_CHILDREN_DONE, INITIATIVE_SCOPE_HAS_STATUS, DECISION_STALE_REF, DECISION_CONTRADICTS_DONE,",
        "ENV_DEPLOYED_AT_MISSING, ENV_DRIFT, BLOCKED_BUT_SATISFIED, CLAIMABLE_BUT_WAITING, CLAIM_EXPIRED_WITH_COMMITS, BRANCH_MERGED_NOT_DELETED, BRANCH_WITHOUT_TICKET, TASK_MISSING_PR_URL, WAITING_ON_OWNER_FREE_TEXT, OVERDUE, PR_WITHOUT_PLANIA_KEY, PR_MERGED_TICKET_OPEN, DELEGATED_ANSWER, WONT_DO_WITHOUT_EVIDENCE, and the footprint codes.",
        "CLAIMABLE_BUT_GATED is the previous name of CLAIMABLE_BUT_WAITING, kept as an alias for one release.",
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
        "the pinned decisions that apply, open questions on those tickets, the footprint they have on the machine (footprint) and what your session registered (my_footprint), the events since since_cursor that touch them, and requests (the owner's open asks from the screen, newest first, read them first). approvals is always an empty list. UNKNOWN_BRANCH when nothing is on the branch.",
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
        "RESOURCE_HELD says who has it and until when. Leasing again extends it. ttl_max on a settings.resources policy still caps the lease. A needs_approval flag is ignored, and so is approval_id.",
      ].join(" "),
      inputSchema: z
        .object({
          project,
          actor,
          request_id,
          name: z.string().min(1),
          ttl_minutes: z.number().int().optional().describe("Default 30, max 1440"),
          purpose: z.string().optional(),
        })
        .loose(),
      annotations: write,
    },
    writeHandler("lease_resource", (input, ctx) => leaseResource(db, input as Parameters<typeof leaseResource>[1], ctx)),
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
        "Declare something you started that outlives the command: a dev server, a database or a copy of one, a container, a service, a tunnel, a worktree. Plania also watches the machine itself;",
        "a declaration for something it already sees merges into that row (source both) and adds who, why and how to remove it. Needs actor.machine (or an agent token with a machine).",
        "locator by kind: server port:3069 (3069 and :3069 work); db_server postgres:5433; database name@host:port (name alone means @127.0.0.1:5432);",
        "worktree an absolute path; browser and tunnel pid:N; service brew:<formula> or launchagent:<label>; container docker:<name>; cache free text.",
        "teardown is the command that removes it (Plania never runs it). task_key defaults to your only live claim in the project (none or several: no ticket; pass task_key).",
        "Name databases <project>_<ticket key lowercased, - to _>_<purpose>, e.g. tienda_tnd_i5_scratch. FOOTPRINT_HELD when another live session declared it. Registering again updates your own.",
        "Short commands (tests, builds) are not registered. What nobody registered and no claim explains shows as orphan, and what outlives its ticket as stale, in the audit. Closing a ticket with footprint still registered warns FOOTPRINT_LIVE per item with its teardown; handoff carries the list to the next session.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        kind: z.enum(FOOTPRINT_KINDS),
        locator: z.string().min(1),
        purpose: z.string().min(1).describe("What it is for, in a line"),
        teardown: z.string().min(1).describe("The command that removes it, e.g. kill 41152 or dropdb tienda_tnd_i5_scratch"),
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
        "Say a registered footprint is torn down; it leaves the Machine inventory. Only the session that declared it (or the owner) may: FOOTPRINT_HELD otherwise. A row the job only observed has no holder and anyone in the project may release it.",
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

  registerTeamTools(server, { db, identity, writeCtx, actor, request_id, run, readOnly, write });
  registerGoalTools(server, db, { run, writeHandler: writeHandler as never });
  registerDelegationTools(server, { db, identity, writeCtx, actor, request_id, run, readOnly, write });
  registerDashboardTools();
  registerUsageTools(server, { db, identity, writeCtx, actor, request_id, run, readOnly, write });
  registerTemplateTools(server, { db, identity, writeCtx, actor, request_id, run, write });
  registerHeartbeatTools(server, { db, identity, writeCtx, actor, request_id, run, readOnly, write });
  registerThreadTools(server, { db, identity, writeCtx, actor, request_id, run, readOnly, write });
  registerConsultaTools(server, { db, identity, actor, request_id, run, write });
  // PLA-I71-3: the PO proposes a seat; the owner decides it on the screen.
  registerSeatTools(server, { db, identity, actor, request_id, run, write });
  registerConnectionTools(server, { db, identity, actor, request_id, run, write });
  registerMarksTools(server, { db, identity, actor, request_id, run, write });
  registerProposalTools(server, { db, identity, writeCtx, actor, request_id, run, write });
  // AUDIT-8: deliver_stage, an idea stage as data with content checks (src/mcp/stage-docs.ts).
  registerStageTools(server, { db, identity, writeCtx, actor, request_id, run, write });

  return server;
}
