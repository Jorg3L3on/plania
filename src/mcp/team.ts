import { asc, eq, isNull, sql } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { AGENT_KINDS, AGENT_STATUSES, agentTokens, agents, projects, tasks, type Agent, type ProjectSettings, type Task } from "../db/schema.js";
import { ToolError } from "./errors.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";
export { workingOnBySlug, type WorkingOn } from "./working-on.js";

// PLA-I21: the company roster. Slugs only on the wire. Claims stay on tasks.owner;
// owner_agent is informational. Tokens link by agent name or slug, never by a foreign key.

const SLUG = /^[a-z][a-z0-9-]{0,58}$/;

// A check-in older than this, with a live claim, is stuck. Projects override it with settings.team.idle_minutes.
export const DEFAULT_IDLE_MINUTES = 120;
export const WAKE_INTERVAL_MS = 60 * 60 * 1000;
const MINUTE = 60_000;

export function idleMinutesOf(settings: ProjectSettings | null | undefined): number {
  const raw = settings?.team?.idle_minutes;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 24 * 60) return raw;
  return DEFAULT_IDLE_MINUTES;
}

// No claim: alive while the last check-in is inside the default window, otherwise idle.
// A live claim past its project's window: stuck. One fresh claim keeps the agent alive.
export function presenceOf(lastCheckIn: Date | null, claimIdleMinutes: number[], now: Date): (typeof AGENT_STATUSES)[number] {
  const fresh = (minutes: number) => !!lastCheckIn && now.getTime() - new Date(lastCheckIn).getTime() <= minutes * MINUTE;
  if (claimIdleMinutes.length === 0) return fresh(DEFAULT_IDLE_MINUTES) ? "alive" : "idle";
  return claimIdleMinutes.some((minutes) => !fresh(minutes)) ? "stuck" : "alive";
}

type LiveClaim = { agent: string; idleMinutes: number };

export async function liveClaims(db: Q, now: Date): Promise<LiveClaim[]> {
  const rows = await db.execute<{ agent: string | null; settings: ProjectSettings }>(sql`
    select t.owner->>'agent' as agent, p.settings
    from tasks t
    join projects p on p.id = t.project_id
    where t.owner is not null and t.lease_until > ${now.toISOString()}::timestamptz`);
  return rows.rows.filter((r): r is { agent: string; settings: ProjectSettings } => !!r.agent).map((r) => ({ agent: r.agent, idleMinutes: idleMinutesOf(r.settings) }));
}

export function claimsFor(agent: { slug: string; name: string }, claims: LiveClaim[]): number[] {
  const keys = new Set([agent.slug.trim().toLowerCase(), agent.name.trim().toLowerCase()]);
  return claims.filter((c) => keys.has(c.agent.trim().toLowerCase())).map((c) => c.idleMinutes);
}

export async function statusByAgentId(
  db: Q,
  rows: { id: string; slug: string; name: string; lastCheckInAt: Date | null }[],
  now = new Date(),
): Promise<Map<string, (typeof AGENT_STATUSES)[number]>> {
  const claims = await liveClaims(db, now);
  return new Map(rows.map((r) => [r.id, presenceOf(r.lastCheckInAt, claimsFor(r, claims), now)]));
}

export type AgentRef = { slug: string; name: string; role: string; title: string; status: string };

export type AgentView = AgentRef & {
  reports_to: string | null;
  capabilities: string[];
  kind: string;
  wake_url: string | null;
  last_check_in_at: string | null;
  note: string;
  tokens: { name: string; prefix: string; machine: string | null }[];
};

type TokenRow = { name: string; agent: string; prefix: string; machine: string | null };

function checkSlug(slug: string): string {
  const trimmed = slug.trim().toLowerCase();
  if (!SLUG.test(trimmed)) throw new ToolError("INVALID_FILTER", { field: "slug", hint: "lowercase letters, digits and dashes" });
  return trimmed;
}

function checkKind(kind: string): string {
  if (!(AGENT_KINDS as readonly string[]).includes(kind)) throw new ToolError("INVALID_FILTER", { field: "kind", allowed: AGENT_KINDS });
  return kind;
}

function checkStatus(status: string): string {
  if (!(AGENT_STATUSES as readonly string[]).includes(status)) throw new ToolError("INVALID_FILTER", { field: "status", allowed: AGENT_STATUSES });
  return status;
}

// A wake target is an http(s) URL with no userinfo. Local hosts are allowed: the sweep posts there.
export function checkWakeUrl(url: string | null | undefined): string | null | undefined {
  if (url === undefined) return undefined;
  if (url === null || url.trim() === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ToolError("INVALID_FILTER", { field: "wake_url", hint: "http or https URL" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new ToolError("INVALID_FILTER", { field: "wake_url", hint: "http or https URL" });
  if (parsed.username || parsed.password) throw new ToolError("INVALID_FILTER", { field: "wake_url", hint: "no userinfo" });
  if (url.trim().length > 500) throw new ToolError("TOO_LARGE", { field: "wake_url", max: 500 });
  return url.trim();
}

function checkCapabilities(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  if (values.length > 20) throw new ToolError("TOO_LARGE", { field: "capabilities", max: 20 });
  const out: string[] = [];
  for (const raw of values) {
    const item = raw.trim().toLowerCase();
    if (!item) continue;
    if (item.length > 40 || !/^[a-z0-9][a-z0-9._-]*$/.test(item)) throw new ToolError("INVALID_FILTER", { field: "capabilities" });
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

export async function agentRefOf(db: Q, id: string | null, now = new Date()): Promise<AgentRef | null> {
  if (!id) return null;
  const [row] = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      role: agents.role,
      title: agents.title,
      lastCheckInAt: agents.lastCheckInAt,
    })
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1);
  if (!row) return null;
  const status = (await statusByAgentId(db, [row], now)).get(row.id) ?? "idle";
  return { slug: row.slug, name: row.name, role: row.role, title: row.title, status };
}

export async function requireAgentId(db: Q, slug: string): Promise<string> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, checkSlug(slug))).limit(1);
  if (!row) throw new ToolError("AGENT_NOT_FOUND", { slug: checkSlug(slug) });
  return row.id;
}

async function loadTokens(db: Q): Promise<TokenRow[]> {
  return db
    .select({ name: agentTokens.name, agent: agentTokens.agent, prefix: agentTokens.prefix, machine: agentTokens.machine })
    .from(agentTokens)
    .where(isNull(agentTokens.revokedAt));
}

function tokensFor(row: Agent, tokens: TokenRow[]): AgentView["tokens"] {
  const name = row.name.trim().toLowerCase();
  const slug = row.slug.toLowerCase();
  return tokens
    .filter((t) => {
      const agent = t.agent.trim().toLowerCase();
      return agent === name || agent === slug;
    })
    .map((t) => ({ name: t.name, prefix: t.prefix, machine: t.machine }));
}

function viewOf(row: Agent, byId: Map<string, Agent>, tokens: TokenRow[], status: AgentView["status"]): AgentView {
  const parent = row.reportsTo ? byId.get(row.reportsTo) : undefined;
  return {
    slug: row.slug,
    name: row.name,
    role: row.role,
    title: row.title,
    reports_to: parent?.slug ?? null,
    capabilities: row.capabilities,
    kind: row.kind,
    wake_url: row.wakeUrl,
    last_check_in_at: iso(row.lastCheckInAt),
    status,
    note: row.note,
    tokens: tokensFor(row, tokens),
  };
}

async function shapeRows(db: Q, rows: Agent[], now = new Date()): Promise<AgentView[]> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tokens = await loadTokens(db);
  const claims = await liveClaims(db, now);
  return rows.map((r) => viewOf(r, byId, tokens, presenceOf(r.lastCheckInAt, claimsFor(r, claims), now)));
}

export async function listAgents(db: Q, now = new Date()): Promise<{ agents: AgentView[] }> {
  const rows = await db.select().from(agents).orderBy(asc(agents.slug));
  return { agents: await shapeRows(db, rows, now) };
}

async function wouldCycle(db: Q, selfId: string, parentId: string): Promise<boolean> {
  let current: string | null = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === selfId || seen.has(current)) return true;
    seen.add(current);
    const [row] = await db.select({ reportsTo: agents.reportsTo }).from(agents).where(eq(agents.id, current)).limit(1);
    current = row?.reportsTo ?? null;
  }
  return false;
}

export type SetAgentInput = {
  slug: string;
  name?: string;
  role?: string;
  title?: string;
  reports_to?: string | null;
  capabilities?: string[];
  kind?: string;
  wake_url?: string | null;
  status?: string;
  note?: string;
};

export async function setAgent(db: Db, input: SetAgentInput): Promise<AgentView> {
  const slug = checkSlug(input.slug);
  const kind = input.kind !== undefined ? checkKind(input.kind) : undefined;
  const status = input.status !== undefined ? checkStatus(input.status) : undefined;
  const wakeUrl = checkWakeUrl(input.wake_url);
  const capabilities = checkCapabilities(input.capabilities);
  const name = input.name?.trim();
  const role = input.role?.trim();
  if (input.name !== undefined && !name) throw new ToolError("INVALID_FILTER", { field: "name" });
  if (input.role !== undefined && !role) throw new ToolError("INVALID_FILTER", { field: "role" });

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(agents).where(eq(agents.slug, slug)).limit(1);
    let reportsTo: string | null | undefined;
    if (input.reports_to !== undefined) {
      if (input.reports_to === null || input.reports_to.trim() === "") reportsTo = null;
      else {
        const parentId = await requireAgentId(tx, input.reports_to);
        if (existing && (existing.id === parentId || (await wouldCycle(tx, existing.id, parentId)))) {
          throw new ToolError("INVALID_FILTER", { field: "reports_to", hint: "reports_to would loop" });
        }
        reportsTo = parentId;
      }
    }
    let row: Agent;
    if (!existing) {
      if (!name || !role || !kind) throw new ToolError("INVALID_FILTER", { field: !name ? "name" : !role ? "role" : "kind", hint: "required when the slug is new" });
      const [inserted] = await tx
        .insert(agents)
        .values({
          slug,
          name,
          role,
          title: input.title?.trim() ?? "",
          reportsTo: reportsTo ?? null,
          capabilities: capabilities ?? [],
          kind,
          wakeUrl: wakeUrl ?? null,
          status: status ?? "idle",
          note: input.note ?? "",
        })
        .returning();
      row = inserted!;
    } else {
      const [updated] = await tx
        .update(agents)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(role !== undefined ? { role } : {}),
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(reportsTo !== undefined ? { reportsTo } : {}),
          ...(capabilities !== undefined ? { capabilities } : {}),
          ...(kind !== undefined ? { kind } : {}),
          ...(wakeUrl !== undefined ? { wakeUrl } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(agents.id, existing.id))
        .returning();
      row = updated!;
    }
    const rows = await tx.select().from(agents);
    return (await shapeRows(tx, rows)).find((a) => a.slug === row.slug)!;
  });
}

export type CheckInInput = { agent: string; working_on?: string; note?: string };

// Heartbeat. Sets last check-in and alive. working_on, when it is a task key, sets owner_agent
// and leaves the lease alone. note replaces the roster note.
export async function checkIn(db: Db, input: CheckInInput, ctx: Ctx): Promise<AgentView & { working_on: string | null }> {
  const slug = checkSlug(input.agent);
  const [agent] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  if (!agent) throw new ToolError("AGENT_NOT_FOUND", { slug });

  let working: { projectId: string; slug: string; task: Task } | null = null;
  if (input.working_on !== undefined && input.working_on.trim() !== "") {
    const key = input.working_on.trim();
    const found = await db
      .select({ task: tasks, projectId: projects.id, slug: projects.slug })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(tasks.key, key));
    if (found.length === 0) throw new ToolError("TASK_NOT_FOUND", { key });
    if (found.length > 1) throw new ToolError("INVALID_FILTER", { field: "working_on", hint: "key is in more than one project" });
    working = { projectId: found[0]!.projectId, slug: found[0]!.slug, task: found[0]!.task };
  }

  await db
    .update(agents)
    .set({
      lastCheckInAt: sql`now()`,
      status: "alive",
      ...(input.note !== undefined ? { note: input.note } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(agents.id, agent.id));

  if (working && working.task.ownerAgent !== agent.id) {
    const before = await agentRefOf(db, working.task.ownerAgent);
    await writeTx(db, { id: working.projectId, slug: working.slug }, { ...ctx, tool: "check_in" }, async (tx, emit) => {
      const [updated] = await tx
        .update(tasks)
        .set({ ownerAgent: agent.id, version: sql`${tasks.version} + 1`, updatedAt: sql`now()` })
        .where(eq(tasks.id, working!.task.id))
        .returning();
      await emit("task.updated", updated!, { changes: { owner_agent: [before?.slug ?? null, agent.slug] } });
    });
  }

  const view = (await listAgents(db)).agents.find((a) => a.slug === slug)!;
  return { ...view, working_on: working ? working.task.key : null };
}

type WriteCtx = (
  tool: string,
  input: { actor: { agent?: string; session_id: string; machine?: string; model?: string }; request_id?: string; verbose?: boolean },
  identity: Identity | undefined,
) => Ctx;

// One registration point. register.ts calls this; the tools themselves stay here.
export function registerTeamTools(
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

  server.registerTool(
    "list_agents",
    {
      description: [
        "The company roster: every bot, coder and human, with role, title, who they report to, capabilities, kind, status, last check-in and note.",
        "Tokens issued on the screen are linked by agent name or slug (prefix and machine only). Slugs, never ids.",
      ].join(" "),
      inputSchema: {},
      annotations: readOnly,
    },
    () => run(() => listAgents(db)),
  );

  server.registerTool(
    "set_agent",
    {
      description: [
        "Create or update one roster row by slug. A new slug needs name, role and kind (bot, coder or human). A known slug changes only the fields you pass.",
        "reports_to is a slug, or null to clear it. wake_url is an optional http(s) address the hourly sweep may POST when the agent is stuck. The row stays editable.",
      ].join(" "),
      inputSchema: {
        actor,
        request_id,
        slug: z.string().min(1),
        name: z.string().min(1).optional(),
        role: z.string().min(1).optional(),
        title: z.string().optional(),
        reports_to: z.string().nullable().optional().describe("Slug of the agent this one reports to; null clears it"),
        capabilities: z.array(z.string()).optional().describe("Replaces the list"),
        kind: z.enum(AGENT_KINDS).optional(),
        wake_url: z.string().nullable().optional().describe("http(s) URL the sweep may POST; null clears it"),
        status: z.enum(AGENT_STATUSES).optional(),
        note: z.string().optional(),
      },
      annotations: write,
    },
    (input) =>
      run(() => {
        const body = input as SetAgentInput & {
          actor: { agent?: string; session_id: string; machine?: string; model?: string };
          request_id?: string;
        };
        writeCtx("set_agent", body, identity);
        return setAgent(db, body);
      }),
  );

  server.registerTool(
    "check_in",
    {
      description: [
        "Say an agent is here. Sets last check-in to now and status to alive.",
        "working_on is a task key: it sets that task's owner_agent and does not touch the lease. note replaces the roster note.",
      ].join(" "),
      inputSchema: {
        actor,
        request_id,
        agent: z.string().min(1).describe("Roster slug"),
        working_on: z.string().optional().describe("Task key this agent is on. Sets owner_agent; the claim stays as it is"),
        note: z.string().optional(),
      },
      annotations: write,
    },
    (input) =>
      run(() => {
        const body = input as CheckInInput & {
          actor: { agent?: string; session_id: string; machine?: string; model?: string };
          request_id?: string;
        };
        const ctx = writeCtx("check_in", body, identity);
        return checkIn(db, { agent: body.agent, working_on: body.working_on, note: body.note }, ctx);
      }),
  );
}
