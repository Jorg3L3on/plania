// PLA-I75 (Conexiones, pass 1): a seat's connections in the database (agent_connections, connection_requests), what
// its sheet reads, the owner's changes, an agent's request, and what one run gets. The catalog and its rules are in
// src/runner/conexiones.ts. Every change here is the owner's (the screen's session); a run only asks
// (request_connection), and nothing on MCP connects, accepts or turns on a tool.
import { and, asc, desc, eq, gte, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentConnections, agentRuns, connectionRequests, projects, type Agent, type AgentConnection, type ConnectionRequest } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { appEnvOf, projectOf } from "../maquinas/machines.js";
import {
  CATALOG,
  addTally,
  catalogEntry,
  connectionDenyRules,
  customProblem,
  databaseProblem,
  isKeyName,
  isPinned,
  keyNamesOf,
  serverConfig,
  snapshotOf,
  versionChange,
  type CatalogEntry,
  type ConnectionRow,
  type CustomSpec,
  type McpServerConfig,
  type McpTally,
  type VersionChange,
} from "./conexiones.js";
import { seatOf } from "./skills.js";

const DAY = 24 * 60 * 60 * 1000;

const rowOf = (c: AgentConnection): ConnectionRow => ({ server: c.server, version: c.version, keys: c.keys ?? {}, writesOn: c.writesOn ?? [], custom: c.custom ?? null, reviewed: c.reviewed });

// ---- the sheet's read

export type CatalogView = {
  id: string;
  group: CatalogEntry["group"];
  recommended: boolean;
  price: CatalogEntry["price"];
  version: string;
  keys: { env: string; name: string; optional: boolean }[];
  reads: number;
  writes: string[];
  never: string[];
  unattended: boolean;
  needs: string | null;
  connected: boolean;
};

export type KeyView = { env: string; name: string; optional: boolean; set: boolean };

export type ConnectionView = {
  server: string;
  version: string;
  custom: { package: string; version: string; args: string[] } | null;
  reviewed: boolean;
  paid: boolean;
  price: CatalogEntry["price"] | null;
  keys: KeyView[];
  reads: string[];
  writes: { tool: string; on: boolean }[];
  never: string[];
  change: VersionChange | null;
  // The last 7 days, from the runs' own logs.
  usage: { calls: number; failed: number; blocked: number; runs: number; tools: { tool: string; ok: number; failed: number; blocked: number }[] };
  problem: "needs-key" | "not-a-copy" | "needs-review" | null;
};

export type RequestView = { id: string; server: string; reason: string; at: string };
export type BlockView = { run: string; at: string; server: string; tool: string; n: number; task: string | null };

export type ConexionesRead = {
  agent: string;
  role: string | null;
  catalog: CatalogView[];
  connections: ConnectionView[];
  requests: RequestView[];
  blocked: BlockView[];
  /** Key names Llaves knows for this project (the app's env file), offered when a key is named. */
  llaves: string[];
};

const roleOf = (a: Agent): string | null => a.roleTemplate ?? null;

/** Whether a key has a value where a run would get it: the server's environment, then the project's app env file. */
type KeySource = { has: (name: string) => boolean; value: (name: string) => string | undefined; names: string[] };
function keySource(p: Awaited<ReturnType<typeof projectOf>>, env: NodeJS.ProcessEnv): KeySource {
  let app: Map<string, string> = new Map();
  try {
    app = appEnvOf(p).env.values;
  } catch {
    // no app folder on this machine
  }
  const value = (name: string) => (env[name]?.trim() ? env[name] : app.get(name)?.trim() ? app.get(name) : undefined);
  return { has: (n) => value(n) !== undefined, value, names: [...app.keys()].filter(isKeyName).sort() };
}

async function usageOf(db: Db, agentId: string, since: Date): Promise<{ tally: Record<string, McpTally>; blocked: BlockView[] }> {
  const runs = await db
    .select({ id: agentRuns.id, at: agentRuns.queuedAt, calls: agentRuns.mcpCalls, task: agentRuns.taskKey })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, agentId), gte(agentRuns.queuedAt, since), isNotNull(agentRuns.mcpCalls)))
    .orderBy(desc(agentRuns.queuedAt))
    .limit(500);
  const tally: Record<string, McpTally> = {};
  const blocked: BlockView[] = [];
  for (const r of runs) {
    for (const [server, tools] of Object.entries(r.calls ?? {})) {
      for (const [tool, n] of Object.entries(tools)) {
        const t = (tally[r.id] ??= {});
        for (let i = 0; i < n.ok; i++) addTally(t, server, tool, "ok");
        for (let i = 0; i < n.failed; i++) addTally(t, server, tool, "failed");
        for (let i = 0; i < n.blocked; i++) addTally(t, server, tool, "blocked");
        if (n.blocked > 0 && blocked.length < 30) blocked.push({ run: r.id, at: r.at.toISOString(), server, tool, n: n.blocked, task: r.task });
      }
    }
  }
  return { tally, blocked };
}

function viewOf(c: AgentConnection, keys: KeySource, perRun: Record<string, McpTally>): ConnectionView {
  const row = rowOf(c);
  const e = c.custom ? null : catalogEntry(c.server);
  const tools = new Map<string, { ok: number; failed: number; blocked: number }>();
  let runs = 0;
  for (const t of Object.values(perRun)) {
    const s = t[c.server];
    if (!s) continue;
    runs++;
    for (const [tool, n] of Object.entries(s)) {
      const was = tools.get(tool) ?? { ok: 0, failed: 0, blocked: 0 };
      tools.set(tool, { ok: was.ok + n.ok, failed: was.failed + n.failed, blocked: was.blocked + n.blocked });
    }
  }
  const list = [...tools].map(([tool, n]) => ({ tool, ...n })).sort((a, b) => b.ok + b.failed + b.blocked - (a.ok + a.failed + a.blocked) || a.tool.localeCompare(b.tool));
  const keyViews: KeyView[] = (e?.keys ?? []).map((k) => {
    const name = row.keys[k.env] ?? k.name;
    return { env: k.env, name, optional: k.optional, set: keys.has(name) };
  });
  let problem: ConnectionView["problem"] = null;
  if (c.custom && !c.reviewed) problem = "needs-review";
  else if (keyViews.some((k) => !k.optional && !k.set)) problem = "needs-key";
  else if (e?.database) {
    const k = keyViews[0];
    if (k && databaseProblem(keys.value(k.name), null)) problem = "not-a-copy";
  }
  return {
    server: c.server,
    version: c.version,
    custom: c.custom ? { package: c.custom.package, version: c.custom.version, args: c.custom.args } : null,
    reviewed: c.reviewed,
    paid: e?.price === "pago" || e?.price === "por-confirmar",
    price: e?.price ?? null,
    keys: keyViews,
    reads: [...(e?.reads ?? [])],
    writes: (e?.writes ?? []).map((tool) => ({ tool, on: row.writesOn.includes(tool) })),
    never: [...(e?.never ?? [])],
    change: versionChange(row, c.toolsSeen ?? null),
    usage: { calls: list.reduce((n, t) => n + t.ok + t.failed + t.blocked, 0), failed: list.reduce((n, t) => n + t.failed, 0), blocked: list.reduce((n, t) => n + t.blocked, 0), runs, tools: list },
    problem,
  };
}

export async function conexionesRead(db: Db, project: string, agent: string, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<ConexionesRead> {
  const a = await seatOf(db, project, agent);
  const p = await projectOf(db, project);
  const keys = keySource(p, env);
  const rows = await db.select().from(agentConnections).where(eq(agentConnections.agentId, a.id)).orderBy(asc(agentConnections.createdAt));
  const { tally, blocked } = await usageOf(db, a.id, new Date(now.getTime() - 7 * DAY));
  const role = roleOf(a);
  const connected = new Set(rows.map((r) => r.server));
  const catalog: CatalogView[] = CATALOG.map((e) => ({
    id: e.id,
    group: e.group,
    recommended: !!role && e.roles.includes(role),
    price: e.price,
    version: e.version,
    keys: e.keys.map((k) => ({ env: k.env, name: k.name, optional: k.optional })),
    reads: e.reads.length,
    writes: [...e.writes],
    never: [...e.never],
    unattended: e.unattended,
    needs: e.needs ?? null,
    connected: connected.has(e.id),
  }));
  const requests = await db
    .select()
    .from(connectionRequests)
    .where(and(eq(connectionRequests.agentId, a.id), eq(connectionRequests.state, "proposed")))
    .orderBy(asc(connectionRequests.createdAt));
  return {
    agent: a.slug,
    role,
    catalog,
    connections: rows.map((r) => viewOf(r, keys, tally)),
    requests: requests.map((r) => ({ id: r.id, server: r.server, reason: r.reason, at: r.createdAt.toISOString() })),
    blocked,
    llaves: keys.names,
  };
}

// ---- the owner's changes

const keysFor = (e: CatalogEntry, given: Record<string, string> | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const k of e.keys) {
    const name = (given?.[k.env] ?? k.name).trim();
    if (!isKeyName(name)) throw new ToolError("CONNECTION_INVALID", { field: `keys.${k.env}` });
    out[k.env] = name;
  }
  for (const env of Object.keys(given ?? {})) if (!e.keys.some((k) => k.env === env)) throw new ToolError("CONNECTION_INVALID", { field: `keys.${env}` });
  return out;
};

async function connectionOf(db: Db, agentId: string, server: string): Promise<AgentConnection> {
  const [c] = await db.select().from(agentConnections).where(and(eq(agentConnections.agentId, agentId), eq(agentConnections.server, server))).limit(1);
  if (!c) throw new ToolError("CONNECTION_NOT_FOUND", { server });
  return c;
}

/** Connects a catalog entry to a seat at the catalog's pinned version, reading only. Connecting again names its keys. */
export async function connect(db: Db, project: string, agent: string, server: string, keys?: Record<string, string>): Promise<void> {
  const a = await seatOf(db, project, agent);
  const e = catalogEntry(server);
  if (!e) throw new ToolError("CONNECTION_UNKNOWN", { server, known: CATALOG.map((x) => x.id) });
  if (!e.unattended) throw new ToolError("CONNECTION_NEEDS_LOGIN", { server });
  if (!isPinned(e.version, e.transport.kind === "http")) throw new ToolError("CONNECTION_INVALID", { field: "version" });
  const named = keysFor(e, keys);
  await db
    .insert(agentConnections)
    .values({ agentId: a.id, server, version: e.version, keys: named, writesOn: [], toolsSeen: snapshotOf(e) })
    .onConflictDoUpdate({ target: [agentConnections.agentId, agentConnections.server], set: { keys: named, updatedAt: new Date() } });
  // A request for this entry is answered by connecting it.
  await db
    .update(connectionRequests)
    .set({ state: "accepted", decidedAt: new Date() })
    .where(and(eq(connectionRequests.agentId, a.id), eq(connectionRequests.server, server), eq(connectionRequests.state, "proposed")));
}

/** One write tool on or off. A tool the entry never allows is refused. */
export async function setWrite(db: Db, project: string, agent: string, server: string, tool: string, on: boolean): Promise<void> {
  const a = await seatOf(db, project, agent);
  const c = await connectionOf(db, a.id, server);
  const e = catalogEntry(c.server);
  if (!e || c.custom) throw new ToolError("CONNECTION_INVALID", { field: "tool" });
  if (e.never.includes(tool)) throw new ToolError("CONNECTION_TOOL_NEVER", { server, tool });
  if (!e.writes.includes(tool)) throw new ToolError("CONNECTION_INVALID", { field: "tool", known: [...e.writes] });
  const next = on ? [...new Set([...c.writesOn, tool])].sort() : c.writesOn.filter((t) => t !== tool);
  await db.update(agentConnections).set({ writesOn: next, updatedAt: new Date() }).where(eq(agentConnections.id, c.id));
}

/** The owner read what the catalog's new version changes and accepts it; turned-on writes it no longer has go. */
export async function acceptVersion(db: Db, project: string, agent: string, server: string): Promise<void> {
  const a = await seatOf(db, project, agent);
  const c = await connectionOf(db, a.id, server);
  const e = catalogEntry(c.server);
  if (!e || c.custom) throw new ToolError("CONNECTION_INVALID", { field: "server" });
  await db
    .update(agentConnections)
    .set({ version: e.version, toolsSeen: snapshotOf(e), writesOn: c.writesOn.filter((t) => e.writes.includes(t)), updatedAt: new Date() })
    .where(eq(agentConnections.id, c.id));
}

export async function disconnect(db: Db, project: string, agent: string, server: string): Promise<void> {
  const a = await seatOf(db, project, agent);
  const c = await connectionOf(db, a.id, server);
  await db.delete(agentConnections).where(eq(agentConnections.id, c.id));
}

/** Expert mode: an npm package of the owner's choosing, pinned, unreviewed: no run gets it until the owner accepts it. */
export async function addCustom(db: Db, project: string, agent: string, server: string, spec: CustomSpec): Promise<void> {
  const a = await seatOf(db, project, agent);
  const clean: CustomSpec = { package: spec.package.trim(), version: spec.version.trim(), args: spec.args.map((x) => x.trim()).filter(Boolean) };
  const bad = customProblem(server, clean);
  if (bad) throw new ToolError("CONNECTION_INVALID", { field: bad });
  const [taken] = await db.select({ id: agentConnections.id }).from(agentConnections).where(and(eq(agentConnections.agentId, a.id), eq(agentConnections.server, server))).limit(1);
  if (taken) throw new ToolError("CONNECTION_EXISTS", { server });
  await db.insert(agentConnections).values({ agentId: a.id, server, version: clean.version, custom: clean, reviewed: false });
}

export async function reviewCustom(db: Db, project: string, agent: string, server: string): Promise<void> {
  const a = await seatOf(db, project, agent);
  const c = await connectionOf(db, a.id, server);
  if (!c.custom) throw new ToolError("CONNECTION_INVALID", { field: "server" });
  await db.update(agentConnections).set({ reviewed: true, updatedAt: new Date() }).where(eq(agentConnections.id, c.id));
}

// ---- an agent's request, the owner's answer

/** request_connection: a run of a seat on this project asks for a catalog entry, with its reason. One open per entry. */
export async function requestConnection(db: Db, input: { project: string; server: string; reason: string }, by: Agent | null): Promise<RequestView & { state: string }> {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, input.project)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: input.project });
  if (!by || by.projectId !== p.id || by.status === "retired") throw new ToolError("CONNECTION_REQUEST_NO_SEAT", { project: input.project });
  const e = catalogEntry(input.server.trim());
  if (!e) throw new ToolError("CONNECTION_UNKNOWN", { server: input.server, known: CATALOG.map((x) => x.id) });
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 600) throw new ToolError("CONNECTION_INVALID", { field: "reason" });
  const [has] = await db.select({ id: agentConnections.id }).from(agentConnections).where(and(eq(agentConnections.agentId, by.id), eq(agentConnections.server, e.id))).limit(1);
  if (has) throw new ToolError("CONNECTION_EXISTS", { server: e.id });
  const [open] = await db
    .select()
    .from(connectionRequests)
    .where(and(eq(connectionRequests.agentId, by.id), eq(connectionRequests.server, e.id), eq(connectionRequests.state, "proposed")))
    .limit(1);
  const r: ConnectionRequest = open ?? (await db.insert(connectionRequests).values({ projectId: p.id, agentId: by.id, server: e.id, reason }).returning())[0]!;
  return { id: r.id, server: r.server, reason: r.reason, at: r.createdAt.toISOString(), state: r.state };
}

/** The owner's yes (connected, reading only) or no. */
export async function decideRequest(db: Db, project: string, agent: string, id: string, accept: boolean): Promise<{ state: "accepted" | "declined" }> {
  const a = await seatOf(db, project, agent);
  const [r] = await db.select().from(connectionRequests).where(and(eq(connectionRequests.id, id), eq(connectionRequests.agentId, a.id))).limit(1);
  if (!r) throw new ToolError("CONNECTION_REQUEST_NOT_FOUND", { id });
  if (r.state !== "proposed") throw new ToolError("CONNECTION_REQUEST_DECIDED", { state: r.state });
  if (accept) {
    await connect(db, project, agent, r.server);
    return { state: "accepted" };
  }
  const [claimed] = await db
    .update(connectionRequests)
    .set({ state: "declined", decidedAt: new Date() })
    .where(and(eq(connectionRequests.id, id), eq(connectionRequests.state, "proposed")))
    .returning();
  if (!claimed) throw new ToolError("CONNECTION_REQUEST_DECIDED", { state: "accepted" });
  return { state: "declined" };
}

// ---- one run

export type RunConnections = {
  servers: Record<string, McpServerConfig>;
  deny: string[];
  /** Key values for the child env only (never logged, never in a file). */
  env: Record<string, string>;
  skipped: { server: string; why: "needs-key" | "not-a-copy" | "needs-review" | "needs-login" | "unknown" | "qa-browser" }[];
};

/**
 * What one run of this seat gets: each connection's server block (keys as ${NAME}), the deny rules for every write tool
 * not turned on (all of them on a read-only run) and every never tool, and the key values for the child env. A
 * connection with a missing key, a database that is not a throwaway copy, or an unreviewed custom server is left out.
 */
export async function runConnections(
  db: Db,
  agent: Pick<Agent, "id">,
  opts: { project: Awaited<ReturnType<typeof projectOf>>; env: NodeJS.ProcessEnv; readOnly: boolean; planiaDb: string | null; qaBrowser: boolean },
): Promise<RunConnections> {
  const rows = await db.select().from(agentConnections).where(eq(agentConnections.agentId, agent.id)).orderBy(asc(agentConnections.createdAt));
  const out: RunConnections = { servers: {}, deny: [], env: {}, skipped: [] };
  if (!rows.length) return out;
  const keys = keySource(opts.project, opts.env);
  for (const c of rows) {
    const row = rowOf(c);
    const e = c.custom ? null : catalogEntry(c.server);
    if (!c.custom && !e) {
      out.skipped.push({ server: c.server, why: "unknown" });
      continue;
    }
    if (e && !e.unattended) {
      out.skipped.push({ server: c.server, why: "needs-login" });
      continue;
    }
    if (c.custom && !c.reviewed) {
      out.skipped.push({ server: c.server, why: "needs-review" });
      continue;
    }
    // The QA walk-through already carries its own browser.
    if (opts.qaBrowser && c.server === "playwright") {
      out.skipped.push({ server: c.server, why: "qa-browser" });
      continue;
    }
    const names = keyNamesOf(row);
    if (names.some((n) => !keys.has(n))) {
      out.skipped.push({ server: c.server, why: "needs-key" });
      continue;
    }
    if (e?.database && databaseProblem(keys.value(names[0]!), opts.planiaDb)) {
      out.skipped.push({ server: c.server, why: "not-a-copy" });
      continue;
    }
    // A read-only run (QA, a question, Preguntar) gets no write tool even when the owner turned one on.
    const config = serverConfig(opts.readOnly ? { ...row, writesOn: [] } : row);
    if (!config) {
      out.skipped.push({ server: c.server, why: "unknown" });
      continue;
    }
    out.servers[c.server] = config;
    out.deny.push(...connectionDenyRules(row, opts.readOnly));
    for (const n of names) out.env[n] = keys.value(n)!;
  }
  return out;
}
