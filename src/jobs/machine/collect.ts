import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { isRelevantListener, type Directory, type Observed, type Repo } from "./infer.js";
import {
  classifyProc,
  parseBrewServices,
  parseCwds,
  parseDockerPs,
  parseDu,
  parseListeners,
  parsePs,
  parseWorktrees,
  postgresDataDir,
  redact,
  type BrewService,
  type Proc,
} from "./parse.js";
import { okOut, partialOut, type Run, type RunResult } from "./run.js";

// The collectors: a thin runner (commands through `run`) over a pure parser (parse.ts). Each returns
// the groups that ran and what they saw. A group that did not run (tool missing, command failed or
// timed out) is skipped: its existing rows are left alone and nothing throws out of the job.
// Everything here is read-only on the Mac.

export type Collected = { ran: string[]; items: Observed[] };
const none = (): Collected => ({ ran: [], items: [] });

// The group a stored row belongs to, so a tick knows whose rows a skipped collector leaves alone.
export function groupOf(kind: string, locator: string, details: Record<string, unknown>): string {
  switch (kind) {
    case "server":
    case "db_server":
      return "ports";
    case "browser":
    case "tunnel":
      return "procs";
    case "database":
      return `databases:${/:(\d+)$/.exec(locator)?.[1] ?? ""}`;
    case "worktree":
      return `worktrees:${String(details.repo ?? "")}`;
    case "service":
      return locator.startsWith("brew:") ? "brew" : "launchagents";
    case "container":
      return "docker";
    default:
      return `other:${kind}`; // declared-only kinds (cache): the job never observes them
  }
}

// ---- repos

// Each project's repo (settings.local.repo_path, else <root>/<slug> when it exists), then every other
// git checkout directly under the root, which have no project yet (plania itself): their items
// carry project_id null and details.repo = the directory name so the screen can still group them.
export function discoverRepos(root: string, projects: { id: string; slug: string; settings: { local?: { repo_path?: string } } }[]): Repo[] {
  const repos: Repo[] = [];
  const used = new Set<string>();
  for (const p of projects) {
    const repoPath = p.settings.local?.repo_path ?? path.join(root, p.slug);
    if (!existsSync(repoPath) || used.has(repoPath)) continue;
    used.add(repoPath);
    repos.push({ name: path.basename(repoPath), path: repoPath, projectId: p.id, projectSlug: p.slug });
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    // no projects root on this machine
  }
  for (const name of entries.sort()) {
    const full = path.join(root, name);
    if (name.startsWith(".") || used.has(full) || !existsSync(path.join(full, ".git"))) continue;
    repos.push({ name, path: full, projectId: null, projectSlug: null });
  }
  return repos;
}

// ---- ports and processes (every minute)

export type ProcessOpts = { selfPid: number; selfPorts: number[] };

// Listening TCP ports (server, db_server) and long-lived helpers (browser, tunnel). One lsof for the
// listeners, one ps for every process, one lsof for the cwd of the pids that matter.
export async function collectProcesses(run: Run, dir: Directory, opts: ProcessOpts): Promise<Collected> {
  const out = none();
  const [listenR, psR] = await Promise.all([
    run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]),
    run("ps", ["-axo", "pid=,ppid=,lstart=,command="]),
  ]);
  // lsof exits 1 when nothing is listening; that is an empty result, not a failure.
  const listenOut = partialOut(listenR) ?? (!listenR.ok && listenR.reason === "exit" && listenR.code === 1 ? "" : null);
  const procs = new Map<number, Proc>((okOut(psR) ? parsePs(okOut(psR)!) : []).map((p) => [p.pid, p]));
  const listeners = listenOut === null ? [] : parseListeners(listenOut);
  const helpers = [...procs.values()].flatMap((p) => {
    const kind = classifyProc(p.command);
    return kind ? [{ proc: p, kind }] : [];
  });

  const pids = [...new Set([...listeners.map((l) => l.pid), ...helpers.map((h) => h.proc.pid)])];
  const cwdOut = pids.length ? partialOut(await run("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-Fn"])) : "";
  const cwds = parseCwds(cwdOut ?? "");

  if (listenOut !== null) {
    out.ran.push("ports");
    const seenKeys = new Set<string>();
    for (const l of listeners) {
      const cwd = cwds.get(l.pid) ?? null;
      if (!isRelevantListener(l.command, cwd, dir)) continue;
      const proc = procs.get(l.pid);
      const command = redact(proc?.command ?? l.command);
      const engine = /^postgres$/.test(l.command) ? "postgres" : l.command === "redis-server" ? "redis" : l.command === "mysqld" ? "mysql" : null;
      const self = l.pid === opts.selfPid || l.ports.some((p) => opts.selfPorts.includes(p));
      for (const port of l.ports) {
        const base = { pid: l.pid, port, ports: l.ports, process: l.command, command, cwd, started_at: proc?.startedAt?.toISOString() ?? null };
        const item: Observed = engine
          ? { kind: "db_server", locator: `${engine}:${port}`, shared: true, cwd, details: { ...base, engine, data_dir: engine === "postgres" ? postgresDataDir(proc?.command ?? "") : null } }
          : { kind: "server", locator: `port:${port}`, self, cwd, details: base };
        if (seenKeys.has(`${item.kind}\0${item.locator}`)) continue; // a second worker on the same port
        seenKeys.add(`${item.kind}\0${item.locator}`);
        out.items.push(item);
      }
    }
  }

  if (procs.size > 0) {
    out.ran.push("procs");
    for (const { proc, kind } of helpers) {
      const cwd = cwds.get(proc.pid) ?? null;
      out.items.push({
        kind: kind === "ngrok" || kind === "cloudflared" ? "tunnel" : "browser",
        locator: `pid:${proc.pid}`,
        cwd,
        details: { pid: proc.pid, ppid: proc.ppid, flavor: kind, command: redact(proc.command), cwd, started_at: proc.startedAt?.toISOString() ?? null },
      });
    }
  }
  return out;
}

// ---- databases (every 5 minutes)

export type DbInfo = { name: string; sizeBytes: number };
export type ListDatabases = (port: number) => Promise<{ version: string; databases: DbInfo[] } | null>;

// Connects as the current OS user to the `postgres` database on 127.0.0.1:<port>, with a short
// timeout. A server that refuses us (other role, no trust auth) is skipped; its db_server row stays.
export function pgListDatabases(user: string): ListDatabases {
  return async (port) => {
    const client = new pg.Client({ host: "127.0.0.1", port, user, database: "postgres", connectionTimeoutMillis: 1500, statement_timeout: 3000 });
    client.on("error", () => undefined);
    try {
      await client.connect();
      const v = await client.query<{ v: string }>("show server_version");
      const r = await client.query<{ datname: string; size: string }>(
        "select datname, pg_database_size(datname)::text as size from pg_database where not datistemplate and datallowconn order by datname",
      );
      return { version: v.rows[0]?.v ?? "", databases: r.rows.map((x) => ({ name: x.datname, sizeBytes: Number(x.size) })) };
    } catch {
      return null;
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}

export async function collectDatabases(list: ListDatabases, servers: Observed[]): Promise<Collected & { versions: Map<number, string> }> {
  const out = { ...none(), versions: new Map<number, string>() };
  for (const s of servers.filter((x) => x.kind === "db_server" && x.details.engine === "postgres")) {
    const port = Number(s.details.port);
    const got = await list(port);
    if (!got) continue;
    out.ran.push(`databases:${port}`);
    out.versions.set(port, got.version);
    for (const d of got.databases) {
      out.items.push({
        kind: "database",
        locator: `${d.name}@127.0.0.1:${port}`,
        shared: d.name === "postgres",
        database: { name: d.name, port },
        details: { name: d.name, port, server: s.locator, size_bytes: d.sizeBytes, version: got.version },
      });
    }
  }
  return out;
}

// ---- services (every 5 minutes)

export async function collectBrew(run: Run): Promise<{ ran: boolean; services: BrewService[] }> {
  const out = okOut(await run("brew", ["services", "list", "--json"], { timeoutMs: 20_000 }));
  return out === null ? { ran: false, services: [] } : { ran: true, services: parseBrewServices(out) };
}

// A LaunchAgent that is just brew's plist for a service brew already lists is that service, not a second row.
const BREW_LABEL = /^(?:homebrew\.mxcl|sh\.brew)\.(.+)$/;

export function serviceItems(brew: { ran: boolean; services: BrewService[] }, agentFiles: string[] | null, agentsDir: string, repoNames: string[]): Collected {
  const out = none();
  const names = new Set(brew.services.map((s) => s.name));
  if (brew.ran) {
    out.ran.push("brew");
    for (const s of brew.services) {
      const agent = (agentFiles ?? []).map((f) => f.replace(/\.plist$/, "")).find((l) => BREW_LABEL.exec(l)?.[1] === s.name);
      out.items.push({ kind: "service", locator: `brew:${s.name}`, shared: true, details: { manager: "brew", name: s.name, status: s.status, user: s.user, file: s.file, launchagent: agent ?? null, attributed: false } });
    }
  }
  if (agentFiles) {
    out.ran.push("launchagents");
    for (const f of agentFiles.filter((f) => f.endsWith(".plist")).sort()) {
      const label = f.replace(/\.plist$/, "");
      if (brew.ran && names.has(BREW_LABEL.exec(label)?.[1] ?? "")) continue;
      const repo = repoNames.find((r) => label.toLowerCase().split(".").includes(r.toLowerCase()));
      // Not attributed = no repo in its label: the audit (phase 5) can ask who declared it.
      out.items.push({ kind: "service", locator: `launchagent:${label}`, shared: true, repoHint: repo, details: { manager: "launchd", name: label, file: path.join(agentsDir, f), attributed: !!repo } });
    }
  }
  return out;
}

export function readLaunchAgents(dir: string): string[] | null {
  try {
    return readdirSync(dir);
  } catch {
    return null;
  }
}

// ---- worktrees (every 5 minutes; disk size every 30)

export type WorktreeOpts = { sizes: boolean; previous: Map<string, { size_kb?: number; size_at?: string }>; now: Date };

async function mapLimit<T, R>(list: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        results[i] = await fn(list[i]!);
      }
    }),
  );
  return results;
}

const git = (run: Run, cwd: string, args: string[], timeoutMs = 15_000): Promise<RunResult> => run("git", ["-C", cwd, ...args], { timeoutMs });

// The ref worktrees are compared against: origin's default branch, else local main or master.
async function baseRef(run: Run, repo: string): Promise<string | null> {
  const sym = okOut(await git(run, repo, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]))?.trim();
  for (const ref of [sym, "main", "master"]) {
    if (ref && (await git(run, repo, ["rev-parse", "--verify", "--quiet", ref])).ok) return ref;
  }
  return null;
}

export async function collectWorktrees(run: Run, repos: Repo[], opts: WorktreeOpts): Promise<Collected> {
  const out = none();
  for (const repo of repos) {
    const listed = okOut(await git(run, repo.path, ["worktree", "list", "--porcelain"], 5_000));
    if (listed === null) continue; // git missing or not a repo: leave this repo's rows alone
    out.ran.push(`worktrees:${repo.name}`);
    const linked = parseWorktrees(listed).slice(1).filter((w) => !w.bare); // the first block is the main checkout
    if (!linked.length) continue;
    const base = await baseRef(run, repo.path);
    const items = await mapLimit(linked, 4, async (w): Promise<Observed> => {
      const missing = w.prunable || !existsSync(w.path);
      let dirtyCount: number | null = null;
      let merged: boolean | null = null;
      let ahead: number | null = null;
      let lastCommitAt: string | null = null;
      if (!missing) {
        const status = okOut(await git(run, w.path, ["status", "--porcelain"]));
        dirtyCount = status === null ? null : status.split("\n").filter(Boolean).length;
        lastCommitAt = okOut(await git(run, w.path, ["log", "-1", "--format=%cI"]))?.trim() || null;
        if (base && w.head) {
          // Squash merges are not ancestors; the GitHub poller's branches.merged_at covers those (phase 5).
          const anc = await git(run, w.path, ["merge-base", "--is-ancestor", w.head, base]);
          merged = anc.ok ? true : anc.reason === "exit" && anc.code === 1 ? false : null;
          const n = Number(okOut(await git(run, w.path, ["rev-list", "--count", `${base}..${w.head}`]))?.trim());
          ahead = Number.isFinite(n) ? n : null;
        }
      }
      const prev = opts.previous.get(w.path);
      let sizeKb = prev?.size_kb ?? null;
      let sizeAt = prev?.size_at ?? null;
      if (opts.sizes && !missing) {
        const kb = parseDu(okOut(await run("du", ["-sk", w.path], { timeoutMs: 120_000 })) ?? "");
        if (kb !== null) {
          sizeKb = kb;
          sizeAt = opts.now.toISOString();
        }
      }
      return {
        kind: "worktree",
        locator: w.path,
        worktree: { path: w.path, repo: repo.name, branch: w.branch },
        details: {
          path: w.path,
          repo: repo.name,
          branch: w.branch,
          head: w.head,
          detached: w.detached,
          locked: w.locked,
          missing,
          dirty: dirtyCount === null ? null : dirtyCount > 0,
          dirty_count: dirtyCount,
          base,
          merged,
          ahead,
          last_commit_at: lastCommitAt,
          size_kb: sizeKb,
          size_at: sizeAt,
        },
      };
    });
    out.items.push(...items);
  }
  return out;
}

// ---- containers (every minute, when Docker is installed and its daemon answers)

export async function collectDocker(run: Run): Promise<Collected> {
  const out = okOut(await run("docker", ["ps", "-a", "--format", "{{json .}}"], { timeoutMs: 5_000 }));
  if (out === null) return none();
  return {
    ran: ["docker"],
    items: parseDockerPs(out).map((c) => ({
      kind: "container" as const,
      locator: `docker:${c.name}`,
      details: { id: c.id, name: c.name, image: c.image, state: c.state, status: c.status, ports: c.ports, created_at: c.createdAt },
    })),
  };
}
