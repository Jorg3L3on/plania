import { ago } from "./time";
import type { FootprintItem, FootprintKind, FootprintState } from "./types";

// The Machine page's model, apart from the markup: how rows are grouped and how each one is named.

export type TicketNode = { key: string; title: string; items: FootprintItem[] };
export type InitiativeNode = { key: string; title: string; items: FootprintItem[]; tickets: TicketNode[] };
export type Group = {
  id: string;
  kind: "project" | "repo" | "orphan" | "system";
  title: string;
  /** A project's servers en uso, first on its card whatever ticket they belong to. */
  servers: FootprintItem[];
  /** Items with no ticket (a project's shared server, a repo's worktree). */
  items: FootprintItem[];
  initiatives: InitiativeNode[];
  /** Tickets with no initiative above them. */
  tickets: TicketNode[];
  count: number;
};

const KIND_ORDER: FootprintKind[] = ["worktree", "server", "db_server", "database", "container", "browser", "tunnel", "service", "cache"];
const kindRank = (k: string) => {
  const i = KIND_ORDER.indexOf(k as FootprintKind);
  return i < 0 ? KIND_ORDER.length : i;
};
const isRunningServer = (it: FootprintItem) => it.kind === "server" && it.state === "live";
// Servers en uso first, stopped things last; then by kind and locator.
export function byRow(a: FootprintItem, b: FootprintItem): number {
  return (
    Number(isRunningServer(b)) - Number(isRunningServer(a)) ||
    Number(a.state === "gone") - Number(b.state === "gone") ||
    kindRank(a.kind) - kindRank(b.kind) ||
    a.locator.localeCompare(b.locator)
  );
}

/**
 * Per project (its servers en uso, then initiative, then ticket), then each repo that is not a project, then "Sin dueño"
 * (orphan) and "Sistema" (shared servers, services, LaunchAgents). Plania's own rows (self) sit in
 * the group of their repo.
 */
export function groupItems(items: FootprintItem[]): Group[] {
  const groups = new Map<string, Group>();
  const group = (id: string, kind: Group["kind"], title: string) =>
    groups.get(id) ?? groups.set(id, { id, kind, title, servers: [], items: [], initiatives: [], tickets: [], count: 0 }).get(id)!;

  for (const it of [...items].sort(byRow)) {
    const g =
      it.state === "orphan" ? group("orphan", "orphan", "Sin dueño")
      : it.state === "system" ? group("system", "system", "Sistema")
      : it.project ? group(`p:${it.project}`, "project", it.project)
      : it.repo ? group(`r:${it.repo}`, "repo", it.repo)
      : it.state === "self" ? group("r:plania", "repo", "plania")
      : group("system", "system", "Sistema");
    g.count++;
    if (g.kind === "project" && isRunningServer(it)) {
      g.servers.push(it);
      continue;
    }
    if (g.kind !== "project" || !it.task_key) {
      g.items.push(it);
      continue;
    }
    // A footprint tied to the initiative itself has no ticket under it.
    if (it.initiative_key && it.initiative_key !== it.task_key) {
      let init = g.initiatives.find((i) => i.key === it.initiative_key);
      if (!init) g.initiatives.push((init = { key: it.initiative_key, title: it.initiative_title ?? "", items: [], tickets: [] }));
      ticketIn(init.tickets, it).items.push(it);
    } else if (it.initiative_key) {
      let init = g.initiatives.find((i) => i.key === it.initiative_key);
      if (!init) g.initiatives.push((init = { key: it.initiative_key, title: it.initiative_title ?? "", items: [], tickets: [] }));
      init.items.push(it);
    } else {
      ticketIn(g.tickets, it).items.push(it);
    }
  }
  for (const g of groups.values()) {
    g.initiatives.sort((a, b) => a.key.localeCompare(b.key));
    for (const i of g.initiatives) i.tickets.sort((a, b) => a.key.localeCompare(b.key));
    g.tickets.sort((a, b) => a.key.localeCompare(b.key));
  }
  const rank = { project: 0, repo: 1, orphan: 2, system: 3 } as const;
  return [...groups.values()].sort((a, b) => rank[a.kind] - rank[b.kind] || a.title.localeCompare(b.title));
}

function ticketIn(list: TicketNode[], it: FootprintItem): TicketNode {
  let t = list.find((x) => x.key === it.task_key);
  if (!t) list.push((t = { key: it.task_key!, title: it.task_title ?? "", items: [] }));
  return t;
}

// ---- naming

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

/** "next dev" from "node /…/node_modules/.bin/next dev --turbopack -p 3069": the program and its subcommand. */
export function shortCommand(command: string | null, fallback = ""): string {
  if (!command) return fallback;
  const words = command.split(/\s+/).filter(Boolean);
  if (/(^|\/)(node|bun|deno|python[\d.]*)$/.test(words[0] ?? "")) words.shift();
  const parts = words.filter((w) => !w.startsWith("-") && !/^\d+$/.test(w)).slice(0, 2).map(base);
  return parts.join(" ") || fallback;
}

const ENGINE: Record<string, string> = { postgres: "Postgres", redis: "Redis", mysql: "MySQL" };

/** The human form of a row: ":3069 next dev", "zigzag @ :5433", the worktree folder with its branch. */
export function nameOf(it: FootprintItem): { name: string; detail: string | null } {
  const d = it.details;
  switch (it.kind) {
    case "server": {
      const port = num(d.port) ?? it.locator.replace(/^port:/, "");
      return { name: `:${port}`, detail: shortCommand(str(d.command), str(d.process) ?? "") || null };
    }
    case "db_server": {
      const engine = ENGINE[str(d.engine) ?? ""] ?? str(d.engine) ?? "Servidor";
      const v = str(d.version);
      return { name: `${engine}${v ? ` ${v.split(".")[0]}` : ""}`, detail: `:${num(d.port) ?? it.locator.split(":")[1]}` };
    }
    case "database": {
      const name = str(d.name) ?? it.locator.split("@")[0]!;
      return { name, detail: `@ :${num(d.port) ?? it.locator.split(":").pop()}` };
    }
    case "worktree": {
      const path = str(d.path) ?? it.locator;
      const branch = str(d.branch);
      return { name: base(path), detail: branch ?? (d.detached ? "detached" : null) };
    }
    case "container":
      return { name: str(d.name) ?? it.locator.replace(/^docker:/, ""), detail: str(d.image) };
    case "browser":
      return { name: str(d.flavor) === "playwright-mcp" ? "Playwright" : "Navegador", detail: `pid ${num(d.pid) ?? it.locator.replace(/^pid:/, "")}` };
    case "tunnel":
      return { name: str(d.flavor) ?? "Túnel", detail: `pid ${num(d.pid) ?? it.locator.replace(/^pid:/, "")}` };
    case "service":
      return { name: str(d.name) ?? it.locator.replace(/^[a-z]+:/, ""), detail: d.manager === "brew" ? "brew" : "LaunchAgent" };
    default:
      return { name: it.locator, detail: null };
  }
}

/** When a process started or the work last moved, for the "uptime or age" slot. */
export function ageSource(it: FootprintItem): { label: string; iso: string } | null {
  const d = it.details;
  const started = str(d.started_at);
  if (started) return { label: "activo", iso: started };
  if (it.kind === "worktree") {
    const last = str(d.last_commit_at);
    if (last) return { label: "último commit", iso: last };
  }
  if (it.kind === "container") {
    const created = str(d.created_at);
    if (created) return { label: "creado", iso: created };
  }
  return it.first_seen_at ? { label: "desde", iso: it.first_seen_at } : null;
}

/** 7.5 GB, 310 MB: sizes are stored in KB (worktrees, du) or bytes (databases). */
export function formatKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(kb >= 10 * 1024 * 1024 ? 0 : 1)} GB`;
  if (kb >= 1024) return `${Math.round(kb / 1024)} MB`;
  return `${Math.round(kb)} KB`;
}

export function sizeOf(it: FootprintItem): string | null {
  const kb = num(it.details.size_kb);
  if (kb !== null) return formatKb(kb);
  const bytes = num(it.details.size_bytes);
  return bytes !== null ? formatKb(bytes / 1024) : null;
}

export const STATE_WORD: Record<FootprintState, string> = {
  live: "en uso",
  orphan: "sin dueño",
  stale: "obsoleto",
  ghost: "fantasma",
  gone: "detenido",
  released: "liberado",
  self: "Plania",
  system: "sistema",
};

export const SOURCE_WORD = { observed: "observado", declared: "declarado", both: "observado y declarado" } as const;

/** The thing the work stands on (the live database, Plania itself, database servers): it has no teardown. */
export const isPrimary = (it: FootprintItem): boolean => it.details.primary === true;

/**
 * The second line of a stale or ghost row: why it is stale ("ticket ZIG-I3-2 Done hace 3 h",
 * "sin claim desde hace 26 h", "rama fusionada") or what a ghost is.
 */
export function whyLine(it: FootprintItem, nowMs: number): string | null {
  if (it.state === "stale") {
    const reason = str(it.details.stale_reason);
    if (!reason) return "obsoleto";
    const since = str(it.details.stale_since);
    if (!since) return reason;
    return reason === "sin claim" ? `${reason} desde ${ago(since, nowMs)}` : `${reason} ${ago(since, nowMs)}`;
  }
  if (it.state === "ghost") {
    const at = str(it.details.ghost_since);
    return `declarado y no se ve en la Mac${at ? `, desde ${ago(at, nowMs)}` : ""}; se libera solo`;
  }
  return null;
}
