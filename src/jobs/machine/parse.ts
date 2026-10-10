// Pure parsers over the output of the commands the machine job runs. No I/O here, so every one is
// tested against recorded output (test/fixtures/machine).

export type Listener = { pid: number; command: string; ports: number[] };
export type Proc = { pid: number; ppid: number; startedAt: Date | null; command: string };
export type WorktreeEntry = { path: string; head: string | null; branch: string | null; detached: boolean; bare: boolean; locked: boolean; prunable: boolean };
export type BrewService = { name: string; status: string; user: string | null; file: string | null };
export type DockerContainer = { id: string; name: string; image: string; state: string; status: string; ports: string; createdAt: string };

// `lsof -nP -iTCP -sTCP:LISTEN -F pcn`: records p<pid>, c<command>, then f<fd>/n<name> per socket.
// Names look like *:3069, 127.0.0.1:5433, [::1]:5432. One process listens on several sockets
// (IPv4 and IPv6), so ports are deduplicated per pid.
export function parseListeners(out: string): Listener[] {
  const byPid = new Map<number, Listener>();
  let cur: Listener | undefined;
  for (const line of out.split("\n")) {
    const tag = line[0];
    const rest = line.slice(1);
    if (tag === "p") {
      const pid = Number(rest);
      cur = Number.isInteger(pid) ? (byPid.get(pid) ?? { pid, command: "", ports: [] }) : undefined;
      if (cur) byPid.set(pid, cur);
    } else if (!cur) {
      continue;
    } else if (tag === "c") {
      cur.command = rest;
    } else if (tag === "n") {
      const port = Number(rest.slice(rest.lastIndexOf(":") + 1));
      if (Number.isInteger(port) && port > 0 && !cur.ports.includes(port)) cur.ports.push(port);
    }
  }
  return [...byPid.values()].filter((l) => l.ports.length > 0);
}

// `lsof -a -d cwd -p <pids> -Fn`: p<pid>, fcwd, n<path>. A pid lsof could not read has no n line.
export function parseCwds(out: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | undefined;
  for (const line of out.split("\n")) {
    if (line[0] === "p") pid = Number(line.slice(1));
    else if (line[0] === "n" && pid !== undefined && Number.isInteger(pid)) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*?)\s*$/;

// `ps -axo pid=,ppid=,lstart=,command=`. lstart is local time in a fixed 24-character shape.
export function parsePs(out: string): Proc[] {
  const procs: Proc[] = [];
  for (const line of out.split("\n")) {
    const m = PS_LINE.exec(line);
    if (!m) continue;
    const started = new Date(m[3]!.replace(/\s+/g, " "));
    procs.push({ pid: Number(m[1]), ppid: Number(m[2]), startedAt: Number.isNaN(started.getTime()) ? null : started, command: m[4]! });
  }
  return procs;
}

// `git worktree list --porcelain`: blocks of `worktree <path>`, `HEAD <sha>`, `branch refs/heads/x` or
// `detached`, optionally `bare`, `locked [reason]`, `prunable [reason]`, separated by a blank line.
// The first block is the main checkout.
export function parseWorktrees(out: string): WorktreeEntry[] {
  const list: WorktreeEntry[] = [];
  let cur: WorktreeEntry | undefined;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length), head: null, branch: null, detached: false, bare: false, locked: false, prunable: false };
      list.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "detached") cur.detached = true;
    else if (line === "bare") cur.bare = true;
    else if (line.startsWith("locked")) cur.locked = true;
    else if (line.startsWith("prunable")) cur.prunable = true;
  }
  return list;
}

// `brew services list --json`. Formulae that have a service but never ran report status "none": not a footprint.
export function parseBrewServices(out: string): BrewService[] {
  let rows: unknown;
  try {
    rows = JSON.parse(out);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as { name?: unknown }).name === "string")
    .map((r) => ({ name: String(r.name), status: String(r.status ?? "none"), user: typeof r.user === "string" ? r.user : null, file: typeof r.file === "string" ? r.file : null }))
    .filter((s) => s.status !== "none");
}

// `docker ps -a --format '{{json .}}'`: one JSON object per line.
export function parseDockerPs(out: string): DockerContainer[] {
  const list: DockerContainer[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Record<string, string>;
      if (!o.ID) continue;
      list.push({ id: o.ID, name: o.Names ?? o.ID, image: o.Image ?? "", state: o.State ?? "", status: o.Status ?? "", ports: o.Ports ?? "", createdAt: o.CreatedAt ?? "" });
    } catch {
      continue;
    }
  }
  return list;
}

// `du -sk <path>`: "<kilobytes>\t<path>".
export function parseDu(out: string): number | null {
  const n = Number(/^\s*(\d+)/.exec(out)?.[1]);
  return Number.isFinite(n) ? n : null;
}

// Connection strings in a command line carry passwords (mcp-server-postgres postgresql://u:pw@host/db).
export function redact(command: string): string {
  return command.replace(/(\w+:\/\/[^\s:@/]*):[^\s@/]+@/g, "$1:***@").slice(0, 400);
}

export type ProcKind = "playwright" | "headless_browser" | "ngrok" | "cloudflared";

// Which long-lived helper a process is, from its command line; null for everything else.
// Chromium's own children (--type=renderer, gpu, crashpad) and the npm exec wrapper in front of
// playwright-mcp are the same footprint as their parent, so they are not matched.
export function classifyProc(command: string): ProcKind | null {
  if (/(^|\s)--type=/.test(command) || /chrome_crashpad_handler/.test(command)) return null;
  if (/^npm exec\b/.test(command)) return null;
  if (/playwright[-/]mcp/.test(command)) return "playwright";
  if (/(^|\/)ngrok( |$)/.test(command)) return "ngrok";
  if (/(^|\/)cloudflared( |$)/.test(command)) return "cloudflared";
  if (/--headless\b/.test(command) && /(chrom|ms-playwright)/i.test(command)) return "headless_browser";
  return null;
}

// The Postgres data directory a server was started with (-D <dir>), when its command says.
export function postgresDataDir(command: string): string | null {
  return /(?:^|\s)-D\s+(\S+)/.exec(command)?.[1] ?? null;
}

// Single-quotes a value for the teardown commands shown to Jorge. Nothing here is ever executed.
export function shq(v: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`;
}
