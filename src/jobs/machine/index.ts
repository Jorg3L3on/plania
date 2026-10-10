import { and, eq, isNull } from "drizzle-orm";
import { homedir, hostname, userInfo } from "node:os";
import path from "node:path";
import type { Db } from "../../db/client.js";
import { branches, footprints, projects, taskAliases, tasks } from "../../db/schema.js";
import { liveOwner } from "../../mcp/queries.js";
import { iso } from "../../mcp/tx.js";
import type { Job, JobSummary } from "../index.js";
import {
  collectBrew,
  collectDatabases,
  collectDocker,
  collectProcesses,
  collectWorktrees,
  discoverRepos,
  pgListDatabases,
  readLaunchAgents,
  serviceItems,
  type Collected,
  type ListDatabases,
} from "./collect.js";
import { ownerOfDatabase, ownerOfPath, type Directory, type Observed, type Owner, type TaskLite } from "./infer.js";
import { reconcile, type Inferred } from "./reconcile.js";
import { execRun, type Run } from "./run.js";

// PLA-I1-2: the machine job. Every minute it reads the Mac (listening ports, helper processes,
// containers), every 5 minutes the slow things (databases, brew services, LaunchAgents, worktrees)
// and every 30 minutes the disk size of each worktree, then reconciles the result with the
// `footprints` table. Read-only on the Mac: lsof, ps, git, du, brew, docker and SELECTs on Postgres.

export const SLOW_MS = 5 * 60_000;
export const DU_MS = 30 * 60_000;

// Last run of each slow collector. Module state: a restart simply collects everything again.
export type MachineState = { lastRun: Record<string, number>; brewNames: string[] };
const defaultState: MachineState = { lastRun: {}, brewNames: [] };

export type MachineDeps = {
  run: Run;
  listDatabases: ListDatabases;
  machine: string;
  projectsRoot: string;
  launchAgentsDir: string;
  selfPid: number;
  selfPorts: number[]; // Plania's own port(s): 3737 is the launchd service
  state: MachineState;
};

function defaultDeps(): MachineDeps {
  const home = homedir();
  const root = process.env.PLANIA_PROJECTS_ROOT?.replace(/^~(?=$|\/)/, home) ?? path.join(home, "Developer", "Projects");
  return {
    run: execRun,
    listDatabases: pgListDatabases(userInfo().username),
    machine: hostname(),
    projectsRoot: root,
    launchAgentsDir: path.join(home, "Library", "LaunchAgents"),
    selfPid: process.pid,
    selfPorts: [Number(process.env.PLANIA_PORT) || 3737],
    state: defaultState,
  };
}

const due = (s: MachineState, name: string, every: number, now: Date) => now.getTime() - (s.lastRun[name] ?? -Infinity) >= every;

// Everything the inference needs, loaded once per tick.
export async function loadDirectory(db: Db, deps: Pick<MachineDeps, "projectsRoot" | "machine">): Promise<Directory> {
  const projs = await db.select({ id: projects.id, slug: projects.slug, keyPrefix: projects.keyPrefix, settings: projects.settings }).from(projects);
  const taskRows = await db
    .select({ id: tasks.id, key: tasks.key, projectId: tasks.projectId, status: tasks.status, owner: tasks.owner, leaseUntil: tasks.leaseUntil, workspace: tasks.workspace })
    .from(tasks);
  const aliasRows = await db.select({ projectId: taskAliases.projectId, alias: taskAliases.alias, taskId: taskAliases.taskId }).from(taskAliases);
  const branchRows = await db.select({ projectId: branches.projectId, name: branches.name, ownerTaskId: branches.ownerTaskId }).from(branches);
  const known = await db
    .select({ details: footprints.details })
    .from(footprints)
    .where(and(eq(footprints.machine, deps.machine), eq(footprints.kind, "worktree"), isNull(footprints.releasedAt)));

  const tasksById = new Map<string, TaskLite>(taskRows.map((t) => [t.id, t]));
  const tasksByKey = new Map<string, Map<string, TaskLite>>();
  const keys = (projectId: string) => tasksByKey.get(projectId) ?? tasksByKey.set(projectId, new Map()).get(projectId)!;
  for (const t of taskRows) keys(t.projectId).set(t.key.toUpperCase(), t);
  for (const a of aliasRows) {
    const t = tasksById.get(a.taskId);
    if (t) keys(a.projectId).set(a.alias.toUpperCase(), t);
  }
  const now = new Date();
  const worktrees = new Map<string, { path: string; repo: string; branch: string | null }>();
  for (const k of known) {
    const d = k.details as { path?: string; repo?: string; branch?: string | null };
    if (d.path && d.repo) worktrees.set(d.path, { path: d.path, repo: d.repo, branch: d.branch ?? null });
  }
  return {
    projects: projs.map((p) => ({ id: p.id, slug: p.slug, keyPrefix: p.keyPrefix })),
    repos: discoverRepos(deps.projectsRoot, projs),
    worktrees,
    tasksById,
    tasksByKey,
    branchOwner: new Map(branchRows.filter((b) => b.ownerTaskId).map((b) => [`${b.projectId}\0${b.name}`, b.ownerTaskId!])),
    claimed: taskRows.filter((t) => t.workspace && liveOwner(t, now)),
  };
}

// brew-started servers: the data dir or binary path names the formula (…/postgresql@17/…).
function linkBrew(items: Observed[], brewNames: string[]): void {
  for (const it of items) {
    if (it.kind !== "db_server") continue;
    const hay = `${it.details.command ?? ""} ${it.details.data_dir ?? ""}`;
    const name = brewNames.find((n) => hay.includes(`/${n}/`) || hay.includes(`/${n} `) || hay.trimEnd().endsWith(`/${n}`));
    if (name) it.details.brew_service = name;
  }
}

function infer(dir: Directory, item: Observed, now: Date): Inferred {
  let owner: Owner = { projectId: null, taskId: null, sessionId: null, repo: null, via: "none" };
  if (item.worktree) owner = ownerOfPath(dir, item.worktree.path, now);
  else if (item.database) owner = ownerOfDatabase(dir, item.database.name, now);
  else if (item.cwd) owner = ownerOfPath(dir, item.cwd, now);
  const repo = owner.repo ?? item.repoHint ?? (item.worktree?.repo ?? null);
  const repoPath = dir.repos.find((r) => r.name === repo)?.path ?? null;
  return { item, owner, repoPath };
}

export async function runMachineTick(db: Db, now: Date, over: Partial<MachineDeps> = {}): Promise<JobSummary> {
  const deps = { ...defaultDeps(), ...over };
  const { run, state } = deps;
  const dir = await loadDirectory(db, deps);

  const collected: Collected[] = [];
  const slow = due(state, "slow", SLOW_MS, now);
  const sizes = due(state, "du", DU_MS, now);

  // Worktrees first: processes and databases are matched to them.
  let wt: Collected = { ran: [], items: [] };
  if (slow || sizes) {
    const previous = new Map(
      (await db.select({ details: footprints.details }).from(footprints).where(and(eq(footprints.machine, deps.machine), eq(footprints.kind, "worktree"), isNull(footprints.releasedAt)))).map(
        (r) => [String((r.details as { path?: string }).path), r.details as { size_kb?: number; size_at?: string }],
      ),
    );
    wt = await collectWorktrees(run, dir.repos, { sizes, previous, now });
    state.lastRun.slow = now.getTime();
    if (sizes) state.lastRun.du = now.getTime();
    // Fresh worktrees replace what the table knew for the repos that answered.
    const answered = new Set(wt.ran.map((g) => g.slice("worktrees:".length)));
    for (const [p, w] of dir.worktrees) if (answered.has(w.repo)) dir.worktrees.delete(p);
    for (const it of wt.items) dir.worktrees.set(it.worktree!.path, it.worktree!);
    collected.push(wt);
  }

  const procs = await collectProcesses(run, dir, { selfPid: deps.selfPid, selfPorts: deps.selfPorts });
  collected.push(procs, await collectDocker(run));

  if (slow) {
    const dbs = await collectDatabases(deps.listDatabases, procs.items);
    for (const it of procs.items) {
      const v = it.kind === "db_server" ? dbs.versions.get(Number(it.details.port)) : undefined;
      if (v) it.details.version = v;
    }
    collected.push(dbs);
    const brew = await collectBrew(run);
    if (brew.ran) state.brewNames = brew.services.map((s) => s.name);
    collected.push(serviceItems(brew, readLaunchAgents(deps.launchAgentsDir), deps.launchAgentsDir, dir.repos.map((r) => r.name)));
  }

  const items = collected.flatMap((c) => c.items);
  linkBrew(items, state.brewNames);
  return reconcile(db, {
    machine: deps.machine,
    now,
    dir,
    inferred: items.map((i) => infer(dir, i, now)),
    ran: new Set(collected.flatMap((c) => c.ran)),
  });
}

export const machineJob: Job = {
  name: "machine",
  intervalMs: 60 * 1000,
  runOnce: (db, now) => runMachineTick(db, now),
};

// What is on the Mac now: every unreleased row (gone ones for a day, so a stopped server is still
// visible) with its project slug and ticket key. For the Machine page and `GET /api/machine`.
export async function machineInventory(db: Db, machine?: string) {
  const rows = await db
    .select({ f: footprints, projectSlug: projects.slug, taskKey: tasks.key, taskTitle: tasks.title })
    .from(footprints)
    .leftJoin(projects, eq(projects.id, footprints.projectId))
    .leftJoin(tasks, eq(tasks.id, footprints.taskId))
    .where(machine ? and(isNull(footprints.releasedAt), eq(footprints.machine, machine)) : isNull(footprints.releasedAt))
    .orderBy(footprints.kind, footprints.locator);
  return rows.map(({ f, projectSlug, taskKey, taskTitle }) => ({
    id: f.id,
    machine: f.machine,
    kind: f.kind,
    locator: f.locator,
    project: projectSlug,
    repo: (f.details.repo as string | undefined) ?? null,
    task_key: taskKey,
    task_title: taskTitle,
    session_id: f.sessionId,
    holder: f.holder,
    source: f.source,
    purpose: f.purpose,
    teardown: f.teardown,
    details: f.details,
    state: f.state,
    first_seen_at: iso(f.firstSeenAt as Date),
    last_seen_at: iso(f.lastSeenAt as Date),
    declared_at: iso(f.declaredAt),
    released_at: iso(f.releasedAt),
  }));
}
