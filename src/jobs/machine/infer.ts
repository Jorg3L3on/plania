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
export type TaskLite = { id: string; key: string; projectId: string; status: string; owner: Actor | null; leaseUntil: Date | null; workspace: Workspace | null };

export type Directory = {
  projects: ProjectLite[];
  repos: Repo[];
  // Linked worktrees by path (the main checkout is its repo's path). Built from this tick's
  // observations over what the table already knows, since worktrees are collected less often.
  worktrees: Map<string, { path: string; repo: string; branch: string | null }>;
  tasksById: Map<string, TaskLite>;
  tasksByKey: Map<string, Map<string, TaskLite>>; // projectId → key or alias → task
  branchOwner: Map<string, string>; // `${projectId}\0${branch}` → owner task id
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

// ---- state

export type StateInput = {
  source: "observed" | "declared" | "both";
  self: boolean;
  shared: boolean; // a server or service shared across projects
  projectId: string | null;
  taskId: string | null;
  repo: string | null;
};

// PHASE 5 extends this: it already receives everything the job knows about a row, so add the
// owner task's status, the claim's age and the worktree's merged/dirty flags to StateInput and branch
// before `live`, returning "stale" (owner Done/Merged/Won't do, claim lapsed past the threshold,
// branch merged and clean) and "ghost" (declared, not observed). `gone` is set by the reconciler,
// not here: it needs the misses counter.
export function computeState(i: StateInput): FootprintState {
  if (i.self) return "self";
  if (i.projectId || i.taskId || i.repo || i.source !== "observed") return "live";
  return i.shared ? "system" : "orphan";
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
