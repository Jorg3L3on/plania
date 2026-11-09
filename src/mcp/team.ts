import { asc, eq, isNull, sql } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { ADAPTERS, AGENT_KINDS, AGENT_STATUSES, agentTokens, agents, projects, tasks, type AdapterConfig, type Agent, type ProjectSettings, type Task } from "../db/schema.js";
import { ToolError } from "./errors.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";
export { workingOnBySlug, type WorkingOn } from "./working-on.js";

// PLA-I21: the company roster. Slugs only on the wire. Claims stay on tasks.owner;
// owner_agent is informational. Tokens link by agent name or slug, never by a foreign key.

const SLUG = /^[a-z][a-z0-9-]{0,58}$/;

// A live claim with neither a check-in nor a heartbeat inside this window is stuck. Projects override it with settings.team.idle_minutes.
export const DEFAULT_IDLE_MINUTES = 120;
export const WAKE_INTERVAL_MS = 60 * 60 * 1000;
const MINUTE = 60_000;

export function idleMinutesOf(settings: ProjectSettings | null | undefined): number {
  const raw = settings?.team?.idle_minutes;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 24 * 60) return raw;
  return DEFAULT_IDLE_MINUTES;
}

// No claim: alive while the last check-in is inside the default window, otherwise idle.
// A live claim is fresh while the newest of the agent's check-in and that claim's last heartbeat (or claim time)
// is inside its project's window. Any stale claim: stuck. PLA-11: taking or renewing a claim is a sign of life.
export type ClaimPresence = { idleMinutes: number; seenAt: Date | null };

// PLA-I32: presence is alive, idle or stuck; retired is a roster state the sweep never writes.
export type Presence = "alive" | "idle" | "stuck";

export function presenceOf(lastCheckIn: Date | null, claims: ClaimPresence[], now: Date): Presence {
  const within = (at: Date | null, minutes: number) => !!at && now.getTime() - new Date(at).getTime() <= minutes * MINUTE;
  if (claims.length === 0) return within(lastCheckIn, DEFAULT_IDLE_MINUTES) ? "alive" : "idle";
  return claims.some((claim) => !within(lastCheckIn, claim.idleMinutes) && !within(claim.seenAt, claim.idleMinutes)) ? "stuck" : "alive";
}

type LiveClaim = { agent: string; idleMinutes: number; seenAt: Date | null };

export async function liveClaims(db: Q, now: Date): Promise<LiveClaim[]> {
  const rows = await db.execute<{ agent: string | null; settings: ProjectSettings; seen_at: string | Date | null }>(sql`
    select t.owner->>'agent' as agent, p.settings, coalesce(t.last_seen_at, t.claimed_at) as seen_at
    from tasks t
    join projects p on p.id = t.project_id
    where t.owner is not null and t.lease_until > ${now.toISOString()}::timestamptz`);
  return rows.rows
    .filter((r) => !!r.agent)
    .map((r) => ({ agent: r.agent!, idleMinutes: idleMinutesOf(r.settings), seenAt: r.seen_at ? new Date(r.seen_at) : null }));
}

export function claimsFor(agent: { slug: string; name: string }, claims: LiveClaim[]): ClaimPresence[] {
  const keys = new Set([agent.slug.trim().toLowerCase(), agent.name.trim().toLowerCase()]);
  return claims.filter((c) => keys.has(c.agent.trim().toLowerCase())).map((c) => ({ idleMinutes: c.idleMinutes, seenAt: c.seenAt }));
}

export async function statusByAgentId(
  db: Q,
  rows: { id: string; slug: string; name: string; lastCheckInAt: Date | null }[],
  now = new Date(),
): Promise<Map<string, Presence>> {
  const claims = await liveClaims(db, now);
  return new Map(rows.map((r) => [r.id, presenceOf(r.lastCheckInAt, claimsFor(r, claims), now)]));
}

export type AgentRef = { slug: string; name: string; role: string; title: string; status: string };

export type AgentView = AgentRef & {
  reports_to: string | null;
  capabilities: string[];
  kind: string;
  wake_url: string | null;
  adapter: string;
  adapter_config: AdapterConfig;
  heartbeat_minutes: number | null;
  last_heartbeat_at: string | null;
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

const checkAdapter = (adapter: string): string => {
  if (!(ADAPTERS as readonly string[]).includes(adapter)) throw new ToolError("INVALID_FILTER", { field: "adapter", allowed: ADAPTERS });
  return adapter;
};

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

const CONFIG_KEYS = ["command_env", "args_env", "url_env"] as const;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

// Names of environment variables only. Anything else is dropped on read and refused on write.
export const publicAdapterConfig = (value: unknown): AdapterConfig => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: AdapterConfig = {};
  for (const key of CONFIG_KEYS) {
    const item = (value as Record<string, unknown>)[key];
    if (typeof item === "string" && ENV_NAME.test(item)) out[key] = item;
  }
  return out;
};

const checkAdapterConfig = (value: Record<string, string> | null | undefined): AdapterConfig | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return {};
  const keys = Object.keys(value);
  if (keys.some((key) => !(CONFIG_KEYS as readonly string[]).includes(key))) {
    throw new ToolError("INVALID_FILTER", { field: "adapter_config", hint: "command_env, args_env or url_env" });
  }
  const clean = publicAdapterConfig(value);
  if (Object.keys(clean).length !== keys.length) throw new ToolError("INVALID_FILTER", { field: "adapter_config", hint: "environment variable name" });
  return clean;
};

const checkHeartbeatMinutes = (value: number | null | undefined): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 1440) throw new ToolError("INVALID_FILTER", { field: "heartbeat_minutes", hint: "1 to 1440, or null" });
  return value;
};

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
    adapter: row.adapter,
    adapter_config: publicAdapterConfig(row.adapterConfig),
    heartbeat_minutes: row.heartbeatMinutes,
    last_heartbeat_at: iso(row.lastHeartbeatAt),
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
  adapter?: string;
  adapter_config?: Record<string, string> | null;
  heartbeat_minutes?: number | null;
  status?: string;
  note?: string;
};

export async function setAgent(db: Db, input: SetAgentInput): Promise<AgentView> {
  const slug = checkSlug(input.slug);
  const kind = input.kind !== undefined ? checkKind(input.kind) : undefined;
  const status = input.status !== undefined ? checkStatus(input.status) : undefined;
  const wakeUrl = checkWakeUrl(input.wake_url);
  const capabilities = checkCapabilities(input.capabilities);
  const adapter = input.adapter === undefined ? undefined : checkAdapter(input.adapter);
  const adapterConfig = checkAdapterConfig(input.adapter_config);
  const heartbeatMinutes = checkHeartbeatMinutes(input.heartbeat_minutes);
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
          adapter: adapter ?? "none",
          adapterConfig: adapterConfig ?? {},
          heartbeatMinutes: heartbeatMinutes ?? null,
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
          ...(adapter !== undefined ? { adapter } : {}),
          ...(adapterConfig !== undefined ? { adapterConfig } : {}),
          ...(heartbeatMinutes !== undefined ? { heartbeatMinutes } : {}),
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
        "The company roster: every bot, coder and human, with role, title, adapter, heartbeat, who they report to, capabilities, kind, status, last check-in and note.",
        "adapter_config lists environment variable names only. Tokens issued on the screen are linked by agent name or slug (prefix and machine only). Slugs, never ids.",
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
        adapter: z.enum(ADAPTERS).optional().describe("http, claude_code, grok_webhook or none"),
        adapter_config: z.record(z.string(), z.string()).nullable().optional().describe("Environment variable names only: command_env, args_env, url_env. Null clears it"),
        heartbeat_minutes: z.number().int().nullable().optional().describe("Minutes between wakes. Null skips the job"),
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
