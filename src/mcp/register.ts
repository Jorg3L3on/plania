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
import { ENV_CONDITIONS } from "./blockers.js";
import { addDecision } from "./decisions.js";
import { projectEnv, setEnv } from "./env.js";
import { setProject } from "./project.js";
import { PROTOCOL_VERSION, instructions } from "./protocol.js";
import { answer, ask } from "./questions.js";
import { TTL, claim, createTask, setTask } from "./writes.js";

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
    ]),
  )
  .describe(
    "What must happen first: a task key (it must reach In review or Done), or an environment condition, e.g. {env: 'prod', condition: 'migration_gte', value: 9}. Replaces the whole list",
  );

const actor = z
  .object({
    agent: z.string().min(1).max(60).describe("Your client, e.g. Claude Code, Codex, Cursor"),
    session_id: z.string().min(1).max(120).describe("Stable id of this session. It owns your claims; reuse it on every call"),
    machine: z.string().max(120).optional().describe("Host name of the machine you run on"),
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

// Every write: size limits, the actor ("jorge" is reserved for the screen) and the idempotency key.
function writeCtx(tool: string, input: WriteInput): Ctx {
  checkSizes(input);
  if (input.actor.agent.trim().toLowerCase() === "jorge") throw new ToolError("RESERVED_ACTOR");
  return { actor: input.actor, requestId: input.request_id, tool, verbose: input.verbose };
}

// Registers a write tool: adds actor, request_id and verbose to its schema and builds its Ctx.
function writeHandler<I extends WriteInput>(tool: string, fn: (input: Omit<I, "actor" | "request_id" | "verbose">, ctx: Ctx) => Promise<unknown>) {
  return (input: I) =>
    run(() => {
      const ctx = writeCtx(tool, input);
      const { actor: _a, request_id: _r, verbose: _v, ...rest } = input;
      return fn(rest, ctx);
    });
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
    .array(z.object({ n: z.number().int().optional(), text: z.string() }))
    .optional()
    .describe("Replaces the Done when list. Keep n to keep an item (and its done state); omit n for a new one"),
  phase: z.number().int().nullable().optional().describe("Tickets only"),
  body: z.string().optional().describe("Removed in v2 (BODY_REMOVED): use scope, checks and note"),
  base_branch: z.string().min(1).optional().describe("Initiatives only"),
  next_action: z.string().optional().describe("Initiatives only"),
  in_progress_note: z.string().optional().describe("Initiatives only"),
  work_type: z.string().optional().describe(`Tickets only: ${WORK_TYPES.join(" | ")}`),
  confirm_by_jorge: z.boolean().optional().describe("Only when Jorge asked you to set Done or Won't do"),
  reason: z.string().optional().describe("Required with confirm_by_jorge: what Jorge said"),
  note: z.string().optional(),
  version: z.number().int().optional().describe("The version you read. Required unless note is the only field"),
};

const setCheckFields = {
  key,
  n: z.number().int(),
  done: z.boolean(),
  evidence_id: z.string().nullable().optional(),
};

const addResultFields = {
  key,
  kind: z.string().describe(RESULT_KINDS.join(" | ")),
  verdict: z.string().describe(VERDICTS.join(" | ")),
  cite: z.string().describe("e.g. 'pnpm test: 84 pass' or 'Playwright at 375px, sheet opens'"),
  url: z.string().optional(),
  check_ns: z.array(z.number().int()).optional().describe("Done when items this result proves (pass only)"),
};

const addDecisionFields = {
  text: z.string().min(1),
  task_key: z.string().optional(),
  tags: z.array(z.string()).optional(),
  supersedes: z.string().optional().describe("id of the decision this one reverses"),
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

export type ServerOptions = { readOnly?: boolean };

export function createMcpServer(db: Db, opts: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: "plania", version: `${PROTOCOL_VERSION}.0` },
    { instructions: instructions(!!opts.readOnly) },
  );

  // A read-only token (planning sessions) gets the read tools only: every tool not marked
  // readOnlyHint is dropped as soon as it is registered, so it never shows in tools/list.
  if (opts.readOnly) {
    const register = server.registerTool.bind(server);
    server.registerTool = ((name: string, config: { annotations?: { readOnlyHint?: boolean } }, cb: never) => {
      const tool = register(name, config as never, cb);
      if (!config.annotations?.readOnlyHint) tool.remove();
      return tool;
    }) as typeof server.registerTool;
  }

  server.registerTool(
    "get_resume",
    {
      description: [
        "Where the project stands, generated from data: live claims (who, until when, where), the next claimable ticket,",
        "and per open initiative its in_progress note and claims, next_action note and next_claimable, must_keep (pinned decisions) and status counts.",
        "Also project-wide pinned decisions and the latest events. legacy_card is the old hand-written v1 card, read-only.",
        "Nobody writes this directly: update an initiative's next_action / in_progress_note with set_task, pin decisions with add_decision.",
      ].join(" "),
      inputSchema: { project },
      annotations: readOnly,
    },
    ({ project }) => run(async () => resumeDigest(db, await findProject(db, project))),
  );

  server.registerTool(
    "get_project",
    {
      description:
        "Project title, long body (stack, repo, prod, constraints), rules (project-specific additions to the protocol in the server instructions) with rules_version, protocol_version, ticket counts, env (per environment: commit, branch, migrations_applied, deployed_at), and reserved sequence numbers (e.g. migrations) with the ticket holding each.",
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
          protocol_version: PROTOCOL_VERSION,
          version: p.version,
          key_prefix: p.keyPrefix || p.slug.slice(0, 3).toUpperCase(),
          next_keys: await nextKeys(db, p),
          counts: await projectCounts(db, p.id),
          env: await projectEnv(db, p.id),
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
        owner: z.string().optional(),
        unblocked: z.boolean().optional(),
        updated_since: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
      annotations: readOnly,
    },
    ({ project, parent_key, work_type, updated_since, ...f }) =>
      run(async () => {
        const p = await findProject(db, project);
        return {
          tasks: await listTasks(db, p.id, { ...f, parentKey: parent_key, workType: work_type, updatedSince: updated_since }),
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
        "Filter decisions by task_key, initiative_key (the initiative and its tickets), tag, or include_superseded false.",
        "A reversed decision has superseded_by; read the one that replaced it.",
      ].join(" "),
      inputSchema: {
        project,
        task_key: z.string().optional(),
        initiative_key: z.string().optional(),
        tag: z.string().optional(),
        include_superseded: z.boolean().optional(),
        view: z.enum(["summary", "full"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: readOnly,
    },
    ({ project, task_key, initiative_key, tag, include_superseded, view, limit }) =>
      run(async () => {
        const memory = await getMemory(db, await findProject(db, project), {
          taskKey: task_key,
          initiativeKey: initiative_key,
          tag,
          includeSuperseded: include_superseded,
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
        "What changed in the project, oldest first: every write is an event with its actor and server time.",
        "Pass since = the next_cursor you got last time to see only what is new (e.g. a ticket re-scoped or claimed under you). more: true means call again.",
        "Filter by key, or by types (a prefix like claim matches claim.acquired, claim.released, claim.expired). limit default 200, max 1000.",
      ].join(" "),
      inputSchema: {
        project,
        since: z.number().int().min(0).optional(),
        key: z.string().optional(),
        types: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
      annotations: readOnly,
    },
    ({ project, ...f }) => run(async () => listEvents(db, (await findProject(db, project)).id, f)),
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
        "Done and Won't do (and reopening them) are Jorge's: HUMAN_ONLY. Only if he asked you, pass confirm_by_jorge: true with reason; it is logged.",
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
        "Tick (or untick) one Done when item by its n. Needs no version and does not bump it. While another session holds the lease, only it can tick (NOT_OWNER). evidence_id links the add_result that proves it.",
      inputSchema: { project, actor, request_id, verbose, ...setCheckFields },
      annotations: { ...write, idempotentHint: true },
    },
    writeHandler("set_check", (input, ctx) => setCheck(db, input, ctx, validateEvidence)),
  );

  server.registerTool(
    "add_result",
    {
      description: [
        "Record evidence on a task: kind, verdict pass|warn|fail, cite (what ran and what it showed), url (CI run, screenshot, recording).",
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
        "Claiming a ticket you already hold extends it. heartbeat: extend your lease while you work; send it before it runs out.",
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
        "When it reverses an earlier decision, pass that decision's id as supersedes: the old one is marked superseded (it inherits task and pin unless you say otherwise).",
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
        "options are suggested answers; he may answer freely. get_resume lists open_questions.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        verbose,
        key,
        question: z.string(),
        options: z.array(z.string()).optional(),
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
      description:
        "Edit the project's title, body (stack, repo, prod, constraints) or rules (project-specific additions to the protocol). Pass the version from get_project; STALE_VERSION if it moved. The old text stays in the log.",
      inputSchema: {
        project,
        actor,
        request_id,
        version: z.number().int().optional(),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        rules: z.string().optional(),
      },
      annotations: write,
    },
    writeHandler("set_project", (input, ctx) => setProject(db, input, ctx)),
  );

  server.registerTool(
    "set_env",
    {
      description: [
        "Record what an environment runs, as data other sessions can check: commit and branch deployed, migrations_applied (highest migration number applied), deployed: true stamps deployed_at now.",
        "commits adds shas known to be in that environment (for contains_commit blockers). Only the fields you pass change; get_project shows env.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        env: z.string().describe("e.g. prod"),
        commit: z.string().optional(),
        branch: z.string().optional(),
        migrations_applied: z.number().int().optional(),
        commits: z.array(z.string()).optional(),
        deployed: z.boolean().optional(),
      },
      annotations: write,
    },
    writeHandler("set_env", (input, ctx) => setEnv(db, input, ctx)),
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
