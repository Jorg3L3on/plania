import { createHash } from "node:crypto";
import type { Actor, Workspace } from "../../db/schema.js";
import { liveOwner } from "../../mcp/queries.js";
import { shq } from "./parse.js";

// Who owns what the machine job sees, worked out from the Plania data (no agent call needed):
//   process cwd → worktree (or the repo's main checkout) → branch → branches.owner_task_id → ticket → live claim → session
//   database name → project and ticket key (<project>_<ticket-key>_<purpose>) or test hash (<project>_test_<hash of repo path>)
// plus the noise rules (what is not a footprint at all) and the state rules (computeState).

export const FOOTPRINT_KINDS = ["worktree", "server", "db_server", "database", "container", "browser", "service", "tunnel", "cache"] as const;
export type FootprintKind = (typeof FOOTPRINT_KINDS)[number];
export const FOOTPRINT_STATES = ["live", "orphan", "stale", "ghost", "gone", "released", "self", "system"] as const;
export type FootprintState = (typeof FOOTPRINT_STATES)[number];

// One thing a collector saw this tick. kind + locator identify it (unique per machine while unreleased).
export type Observed = {
  kind: FootprintKind;
  locator: string;
  details: Record<string, unknown>;
  cwd?: string | null; // where a process runs: owner inference starts here
  worktree?: { path: string; repo: string; branch: string | null }; // a linked worktree: owner via its branch
  database?: { name: string; port: number };
  repoHint?: string; // a repo the item is named after (a LaunchAgent com.plania.server): groups it without an owner
  self?: boolean; // Plania's own process
  shared?: boolean; // a server or service several projects use: state system unless an owner is found
};

export type Repo = { name: string; path: string; projectId: string | null; projectSlug: string | null };
export type ProjectLite = { id: string; slug: string; keyPrefix: string };
export type TaskLite = {
  id: string;
  key: string;
  projectId: string;
  status: string;
  owner: Actor | null;
  leaseUntil: Date | null;
  workspace: Workspace | null;
  // Phase 5 (state rules). Optional so a hand-built TaskLite stays small.
  kind?: string;
  parentId?: string | null;
  statusChangedAt?: Date | null; // when the status last moved: for a closed ticket, when it closed
  lastSeenAt?: Date | null; // the last claim or heartbeat; survives the claim being released
};

export type Directory = {
  projects: ProjectLite[];
  repos: Repo[];
  // Linked worktrees by path (the main checkout is its repo's path). Built from this tick's
  // observations over what the table already knows, since worktrees are collected less often.
  worktrees: Map<string, { path: string; repo: string; branch: string | null }>;
  tasksById: Map<string, TaskLite>;
  tasksByKey: Map<string, Map<string, TaskLite>>; // projectId → key or alias → task
  branchOwner: Map<string, string>; // `${projectId}\0${branch}` → owner task id
  branchMergedAt?: Map<string, Date>; // `${projectId}\0${branch}` → branches.merged_at (squash merges git cannot see)
  claimed: TaskLite[]; // tasks with a live claim and a workspace
};

export type Owner = {
  projectId: string | null;
  taskId: string | null;
  sessionId: string | null;
  repo: string | null; // the repo directory name; set even when it is not a project yet, so the screen can group
  via: "worktree" | "checkout" | "database" | "none";
  extra?: Record<string, unknown>; // facts worth showing (worktree path, branch, test hash...)
};

const NONE: Owner = { projectId: null, taskId: null, sessionId: null, repo: null, via: "none" };

// ---- the ignore list

// Processes that count as agent footprint even when their cwd is nowhere near a repo.
const KNOWN_RUNTIME = /^(node|bun|deno|python[\d.]*|ruby|postgres|redis-server|mysqld|chrome|chromium|ngrok|cloudflared|playwright[\w-]*|next-server)$/i;
// Container engines list their own ports; the container collector covers them.
const DOCKER = /^(docker|com\.docker\.|vpnkit)/i;

export function isKnownRuntime(command: string): boolean {
  return KNOWN_RUNTIME.test(command);
}

// A listener is worth recording when it is a known runtime or runs under a repo; everything else
// (ControlCenter's AirPlay on 5000/7000, rapportd, Spotify, other apps' agent servers) is the machine's noise.
export function isRelevantListener(command: string, cwd: string | null | undefined, dir: Directory): boolean {
  if (DOCKER.test(command)) return false;
  return isKnownRuntime(command) || (!!cwd && !!locate(dir, cwd));
}

// ---- cwd → worktree → repo

// The deepest known location containing path: a linked worktree, else a repo's main checkout.
// (plania's worktrees live inside its main checkout, so the longest match wins.)
export function locate(dir: Directory, p: string): { repo: Repo; worktree?: { path: string; branch: string | null } } | null {
  let best: { len: number; repo: Repo; worktree?: { path: string; branch: string | null } } | null = null;
  const within = (root: string) => p === root || p.startsWith(root.endsWith("/") ? root : `${root}/`);
  for (const r of dir.repos) if (within(r.path) && (!best || r.path.length > best.len)) best = { len: r.path.length, repo: r };
  for (const w of dir.worktrees.values()) {
    if (!within(w.path) || (best && w.path.length <= best.len)) continue;
    const repo = dir.repos.find((r) => r.name === w.repo);
    if (repo) best = { len: w.path.length, repo, worktree: { path: w.path, branch: w.branch } };
  }
  return best ? { repo: best.repo, worktree: best.worktree } : null;
}

function claimSession(t: TaskLite | undefined, now: Date): string | null {
  return t ? (liveOwner(t, now)?.session_id ?? null) : null;
}

// A worktree's owner: a live claim whose workspace points at it (by path, then by branch), else the
// owner of its branch in `branches`; the session comes from that ticket's live claim.
function ownerOfWorktree(dir: Directory, repo: Repo, path: string, branch: string | null, now: Date): Owner {
  const base: Owner = { projectId: repo.projectId, taskId: null, sessionId: null, repo: repo.name, via: "worktree", extra: { worktree_path: path, branch } };
  if (!repo.projectId) return base;
  const mine = dir.claimed.filter((t) => t.projectId === repo.projectId && liveOwner(t, now));
  const claimed =
    mine.find((t) => t.workspace?.worktree_path === path) ?? (branch ? mine.find((t) => t.workspace?.branch === branch && !t.workspace?.worktree_path) : undefined);
  const ownerId = branch ? dir.branchOwner.get(`${repo.projectId}\0${branch}`) : undefined;
  const task = claimed ?? (ownerId ? dir.tasksById.get(ownerId) : undefined);
  return { ...base, taskId: task?.id ?? null, sessionId: claimSession(task, now) };
}

// Owner of something that lives at a path: a process's cwd or a worktree's own path.
export function ownerOfPath(dir: Directory, p: string, now: Date): Owner {
  const at = locate(dir, p);
  if (!at) return NONE;
  if (at.worktree) return ownerOfWorktree(dir, at.repo, at.worktree.path, at.worktree.branch, now);
  return { projectId: at.repo.projectId, taskId: null, sessionId: null, repo: at.repo.name, via: "checkout" };
}

// ---- database names

export const pathHash = (p: string): string => createHash("sha256").update(p).digest("hex").slice(0, 6);
const norm = (s: string) => s.toLowerCase().replace(/-/g, "_");

export type DbName = { prefix: { projectId: string | null; repo: string | null } | null; testHash: string | null; keyParts: string[] };

// `<project>_<ticket-key>_<purpose>` (zigzag_zig_i5_scratch), `<project>_test_<6 hex>` (plania_test_fadac0)
// or the bare project/repo name (zigzag). The project may be a repo that is not a project yet (plania).
export function parseDbName(name: string, dir: Directory): DbName {
  const prefixes: { token: string; projectId: string | null; repo: string | null }[] = [
    ...dir.projects.map((p) => ({ token: norm(p.slug), projectId: p.id, repo: dir.repos.find((r) => r.projectId === p.id)?.name ?? p.slug })),
    ...dir.repos.filter((r) => !r.projectId).map((r) => ({ token: norm(r.name), projectId: null, repo: r.name })),
  ].sort((a, b) => b.token.length - a.token.length);
  const n = name.toLowerCase();
  const hit = prefixes.find((p) => n === p.token || n.startsWith(`${p.token}_`));
  if (!hit) return { prefix: null, testHash: null, keyParts: [] };
  const rest = n === hit.token ? "" : n.slice(hit.token.length + 1);
  const test = /^test_([0-9a-f]{6})$/.exec(rest);
  return {
    prefix: { projectId: hit.projectId, repo: hit.repo },
    testHash: test?.[1] ?? null,
    keyParts: test || !rest ? [] : rest.split("_"),
  };
}

// The project and ticket a database belongs to, by the naming convention.
export function ownerOfDatabase(dir: Directory, name: string, now: Date): Owner {
  const parsed = parseDbName(name, dir);
  if (!parsed.prefix) return NONE;
  const { projectId, repo } = parsed.prefix;
  const base: Owner = { projectId, taskId: null, sessionId: null, repo, via: "database" };
  if (parsed.testHash) {
    // The hash is of the checkout that ran the tests: a worktree (its ticket) or a repo's main checkout.
    const paths = [...dir.repos.map((r) => r.path), ...dir.worktrees.keys()];
    const path = paths.find((p) => pathHash(p) === parsed.testHash);
    const at = path ? ownerOfPath(dir, path, now) : null;
    return { ...base, ...(at && at.via !== "none" ? { taskId: at.taskId, sessionId: at.sessionId } : {}), extra: { test_hash: parsed.testHash, repo_path: path ?? null } };
  }
  // Longest run of tokens that is a ticket key: zig_i5_scratch → ZIG-I5 + "scratch"; zig_i5_2_copy → ZIG-I5-2.
  const keys = projectId ? dir.tasksByKey.get(projectId) : undefined;
  for (let n = parsed.keyParts.length; n >= 1 && keys; n--) {
    const task = keys.get(parsed.keyParts.slice(0, n).join("-").toUpperCase());
    if (task) return { ...base, taskId: task.id, sessionId: claimSession(task, now), extra: { purpose: parsed.keyParts.slice(n).join("_") || null } };
  }
  return base;
}

// ---- primary items

// Names a project or repo calls its own database, and the Postgres defaults. Dropping any of these
// is never a cleanup, so Plania neither suggests a teardown for them nor ever calls them orphan or stale.
const PRIMARY_DATABASES = new Set(["postgres", "template0", "template1"]);

// The Postgres server the projects' own databases live on. Any other server is secondary (a scratch copy).
export const primaryPgPort = (): number => Number(process.env.PLANIA_PRIMARY_PG_PORT) || 5432;

// Primary = the thing the work itself stands on, not something an agent left behind:
//   - Plania's own process (self)
//   - a database server (db_server) or a brew service: shared by every project
//   - a LaunchAgent whose label names a repo (com.plania.server)
//   - postgres / template0 / template1 anywhere, and a database named exactly like a project slug or a repo
//     (plania, micasa, zigzag) on the main Postgres server only (PLANIA_PRIMARY_PG_PORT, default 5432)
// `<project>_test_<hash>` and `<project>_<ticket>_<purpose>` copies are not primary: they are what agents make.
export function isPrimary(item: Observed, dir: Directory): boolean {
  if (item.self) return true;
  switch (item.kind) {
    case "db_server":
      return true;
    case "service":
      return item.details.manager === "brew" || !!item.repoHint;
    case "database": {
      const name = (item.database?.name ?? String(item.details.name ?? "")).toLowerCase();
      if (!name) return false;
      // postgres and the templates exist on every server; a database named after a project or repo is
      // the project's main one only on the main server. On a scratch server (Postgres 17 on :5433) it
      // is a copy someone made, an ordinary row with its dropdb.
      if (PRIMARY_DATABASES.has(name)) return true;
      if ((item.database?.port ?? primaryPgPort()) !== primaryPgPort()) return false;
      const own = new Set([...dir.projects.map((p) => p.slug), ...dir.repos.map((r) => r.name)].flatMap((n) => [n.toLowerCase(), norm(n)]));
      return own.has(name) || own.has(norm(name));
    }
    default:
      return false;
  }
}

// ---- state

// Phase 1 decisions (2026-10-09). Plania never stops anything: these only say when a row stops being "live".
export const STALE_SHORT_MS = 2 * 3600_000; // servers, browsers, tunnels
export const STALE_LONG_MS = 24 * 3600_000; // databases, containers (and declared caches)
export const GHOST_DECLARED_MS = 5 * 60_000; // declared, never observed: ghost this long after declared_at
export const GHOST_MISSES = 2; // declared and observed before: ghost after this many ticks of its collector without it
export const GHOST_RELEASE_MS = 3600_000; // a ghost row is released (bookkeeping only) an hour after it turned ghost
export const CLOSED_STATUSES = ["Done", "Merged", "Won't do", "Released"];
const MERGED_STATUSES = ["Done", "Merged", "Released"];

// null = never stale from ticket rules. A worktree goes by its branch, not by a clock; database
// servers and services are the machine's, shared, and never stale.
export function staleAfterMs(kind: FootprintKind): number | null {
  switch (kind) {
    case "server":
    case "browser":
    case "tunnel":
      return STALE_SHORT_MS;
    case "database":
    case "container":
    case "cache":
      return STALE_LONG_MS;
    default:
      return null;
  }
}

// What the owner ticket says about a footprint row, worked out from the directory (no query).
export type OwnerFacts = {
  key: string;
  kind?: string; // "initiative" reads "iniciativa" in the reason
  status: string;
  closedAt: Date | null; // when its status last moved (meaningful when the status is closed)
  claimLive: boolean; // a live claim: on the ticket, or on any ticket of the initiative
  lapsedAt: Date | null; // when the last claim ended (lease end or last heartbeat); null = never claimed
};

const childCache = new WeakMap<Directory, Map<string, TaskLite[]>>();
function childrenOf(dir: Directory, id: string): TaskLite[] {
  let m = childCache.get(dir);
  if (!m) {
    m = new Map();
    for (const t of dir.tasksById.values()) if (t.parentId) (m.get(t.parentId) ?? m.set(t.parentId, []).get(t.parentId)!).push(t);
    childCache.set(dir, m);
  }
  return m.get(id) ?? [];
}

export function ownerFacts(dir: Directory, taskId: string | null, now: Date): OwnerFacts | null {
  const t = taskId ? dir.tasksById.get(taskId) : undefined;
  if (!t) return null;
  // Claims are on tickets; an initiative counts as claimed while any ticket under it is.
  const claimers = t.kind === "initiative" ? childrenOf(dir, t.id) : [t];
  let lapsed: number | null = null;
  for (const c of claimers) {
    const at = (c.owner ? c.leaseUntil : null) ?? c.lastSeenAt ?? null;
    if (at && (lapsed === null || at.getTime() > lapsed)) lapsed = at.getTime();
  }
  return { key: t.key, kind: t.kind, status: t.status, closedAt: t.statusChangedAt ?? null, claimLive: claimers.some((c) => liveOwner(c, now)), lapsedAt: lapsed === null ? null : new Date(lapsed) };
}

export type WorktreeFacts = {
  merged: boolean | null; // git: the head is an ancestor of the base
  ownCommits: number | null; // commits made in this worktree or on its branch (reflog): a fresh worktree has none and counts as "merged"
  dirty: boolean | null; // null = git could not tell
  branchMergedAt: Date | null; // branches.merged_at: how a squash merge shows up
};

export type StateInput = {
  source: "observed" | "declared" | "both";
  self: boolean;
  shared: boolean; // a server or service shared across projects
  projectId: string | null;
  taskId: string | null;
  repo: string | null;
  // ---- phase 5. All optional: without them a row is judged on ownership alone.
  kind?: FootprintKind;
  primary?: boolean; // never orphan, stale or ghost-released from ticket rules
  now?: Date;
  seen?: boolean; // the collector saw it this tick (default true). false: only the ghost rule applies
  collectorRan?: boolean; // the collector for this kind ran this tick (a cache has none, Docker may be missing)
  misses?: number; // consecutive ticks of its collector without seeing it, this one included
  current?: FootprintState; // an unseen row that is not a ghost keeps this
  startedAt?: Date | null; // first_seen_at, else declared_at
  declaredAt?: Date | null;
  task?: OwnerFacts | null;
  worktree?: WorktreeFacts | null;
};

export type Verdict = {
  state: FootprintState;
  reason?: string; // stale: why, e.g. "ticket ZIG-I3-2 Done", "rama fusionada", "sin claim"
  since?: Date | null; // stale: since when the reason holds (the ticket closed, the claim lapsed, the branch merged)
};

// Order: self → ghost (unseen declared rows) → stale (ticket and branch rules) → live (any owner or
// declaration) → system (shared) → orphan. `gone` is set by the reconciler, not here: it needs the
// misses counter of an observed row. Stale and ghost need the extra fields; without them a row is live/system/orphan as before.
export function computeVerdict(i: StateInput): Verdict {
  if (i.self) return { state: "self" };
  const now = i.now ?? new Date();

  if (i.seen === false) {
    if (i.source !== "observed" && i.collectorRan) {
      const ghost =
        i.source === "declared"
          ? !!i.declaredAt && now.getTime() - i.declaredAt.getTime() >= GHOST_DECLARED_MS
          : (i.misses ?? 0) >= GHOST_MISSES;
      if (ghost) return { state: "ghost" };
    }
    return { state: i.current ?? "live" };
  }

  const owned = !!(i.projectId || i.taskId || i.repo || i.source !== "observed");
  if (!i.primary) {
    const stale = staleVerdict(i, now);
    if (stale) return stale;
  }
  if (owned) return { state: "live" };
  // A primary row is never an orphan: its shared server or database is the machine's.
  return { state: i.shared || i.primary ? "system" : "orphan" };
}

export function computeState(i: StateInput): FootprintState {
  return computeVerdict(i).state;
}

const noun = (t: OwnerFacts) => (t.kind === "initiative" ? "iniciativa" : "ticket");

function staleVerdict(i: StateInput, now: Date): Verdict | null {
  const t = i.task;
  const age = (at: Date) => now.getTime() - at.getTime();
  if (i.kind === "worktree") {
    const w = i.worktree;
    if (!w || w.dirty !== false) return null; // uncommitted changes, or unknown: never stale
    if (t?.claimLive) return null; // someone is working in it
    // Squash merges are not ancestors, so the poller's branches.merged_at counts; git's own answer
    // counts only when work was committed here (a new worktree on a merged commit is not "merged work").
    if (w.branchMergedAt) return { state: "stale", reason: "rama fusionada", since: w.branchMergedAt };
    if (w.merged === true && (w.ownCommits ?? 0) > 0) return { state: "stale", reason: "rama fusionada", since: null };
    if (t && (MERGED_STATUSES.includes(t.status) || t.status === "Won't do")) {
      return { state: "stale", reason: `${noun(t)} ${t.key} ${t.status}`, since: t.closedAt };
    }
    return null;
  }
  const limit = i.kind ? staleAfterMs(i.kind) : null;
  if (!t || limit === null) return null; // no ticket: never stale from ticket rules
  // Closed: counted from when it closed. Not closed, or closed too recently: a claim that lapsed
  // counts as well (a ticket closed ten minutes ago whose claim ended three days ago has been unclaimed for three days).
  if (CLOSED_STATUSES.includes(t.status)) {
    const since = t.closedAt ?? i.startedAt ?? null;
    if (since && age(since) >= limit) return { state: "stale", reason: `${noun(t)} ${t.key} ${t.status}`, since };
  }
  if (!t.claimLive) {
    // Without a claim for the limit, counted from the later of the lapse and the first sighting
    // (a server started after the claim ended has not been unclaimed for longer than it has existed).
    const times = [t.lapsedAt, i.startedAt].filter((d): d is Date => !!d).map((d) => d.getTime());
    const since = times.length ? new Date(Math.max(...times)) : null;
    if (since && age(since) >= limit) return { state: "stale", reason: "sin claim", since };
  }
  return null;
}

// "ticket ZIG-I3-2 Done hace 3 h", "rama fusionada", "sin claim desde hace 26 h": the stored reason with its age.
export function describeStale(details: Record<string, unknown>, now: Date): string | null {
  const reason = typeof details.stale_reason === "string" ? details.stale_reason : null;
  if (!reason) return null;
  const since = typeof details.stale_since === "string" ? new Date(details.stale_since) : null;
  if (!since || Number.isNaN(since.getTime())) return reason;
  return `${reason} ${reason === "sin claim" ? "desde hace" : "hace"} ${spanAgo(now.getTime() - since.getTime())}`;
}

export function spanAgo(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${Math.max(1, min)} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

// ---- suggested teardown (shown to Jorge, never run by Plania)

export function suggestTeardown(o: Observed, repoPath: string | null): string {
  const d = o.details;
  const pid = typeof d.pid === "number" ? d.pid : null;
  switch (o.kind) {
    case "worktree":
      return repoPath ? `git -C ${shq(repoPath)} worktree remove ${shq(String(d.path))}` : "";
    case "server":
    case "browser":
    case "tunnel":
      return pid ? `kill ${pid}` : "";
    case "db_server":
      if (typeof d.brew_service === "string") return `brew services stop ${d.brew_service}`;
      if (d.engine === "postgres" && typeof d.data_dir === "string") return `pg_ctl -D ${shq(d.data_dir)} stop`;
      return pid ? `kill ${pid}` : "";
    case "database":
      return o.database ? `dropdb -h 127.0.0.1 -p ${o.database.port} ${shq(o.database.name)}` : "";
    case "container":
      return `docker rm -f ${shq(String(d.name))}`;
    case "service":
      if (d.manager === "brew") return `brew services stop ${d.name}`;
      return typeof d.file === "string" ? `launchctl unload ${shq(String(d.file))}` : "";
    default:
      return "";
  }
}
