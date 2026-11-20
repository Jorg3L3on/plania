// PLA-I2-12: «La máquina dice qué le falta». One check of what a machine needs to run Plania: Node, Postgres and
// its version, git, gh signed in with write access, Claude Code, its version and its session (the brief doctor's
// short dry run), pg_dump matching the server, free disk and memory, and Chrome (optional, for stills). F2: gh is
// optional at install: it is needed only before the first project with code.
//
// Three readers, one list: the install command (machineCheck + blocking, its injected hook), `pnpm machine:check`
// (scripts/machine-check.ts) and the screen (GET /api/machine-check, page /machine/falta). The words come from
// ui/src/lib/falta.ts. Every outside call is injected: running a program, the Postgres probe, the Claude dry run,
// the disk and memory readings, the Chrome lookup.
import { statfs } from "node:fs/promises";
import { totalmem } from "node:os";
import { claudeDryRun, claudeVersion, defaultExec, type ClaudeSignIn, type ExecFn } from "../brief/doctor.js";
import { commandOf } from "../brief/claude.js";
import { findChrome } from "../captures/chrome.js";
import { pgDumpFor } from "../jobs/backup.js";
import { pgToolFor } from "../lib/pg-bin.js";
import { readPg, userOf, type PgReading } from "../lib/pg-connect.js";
import { installLanguage, type Language } from "../language.js";
import {
  MACHINE_ITEMS,
  MIN_FREE_DISK_GB,
  MIN_MEMORY_GB,
  MIN_NODE_MAJOR,
  MIN_POSTGRES_MAJOR,
  FALTA,
  machineItem as itemIn,
  type MachineDetail,
  type MachineReason,
  type MachineItem,
  type MachineItemId,
} from "../../ui/src/lib/falta.js";

export type { MachineItem, MachineItemId } from "../../ui/src/lib/falta.js";

/** B3: the version, or why the address said no (a reading without a reason counts as not answering). */
export type PgProbe = (url: string) => Promise<PgReading>;

export type MachineCheckDeps = {
  env?: NodeJS.ProcessEnv;
  exec?: ExecFn;
  /** process.versions.node by default. */
  nodeVersion?: string;
  pgProbe?: PgProbe;
  claudeDryRun?: (cmd: string, env: NodeJS.ProcessEnv, exec: ExecFn) => Promise<ClaudeSignIn>;
  /** Free bytes where Plania keeps its work (the home folder); null when unreadable. */
  freeDisk?: (dir: string) => Promise<number | null>;
  totalMemory?: () => number;
  findChrome?: () => string | null;
  /** PLA-I2-10: the words' language; the install's (src/language.ts) by default. */
  language?: Language;
};

const GB = 1024 ** 3;
const gb = (bytes: number) => Math.floor((bytes / GB) * 10) / 10;
const versionIn = (text: string): string | null => text.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? null;
const majorOf = (version: string | null | undefined): number => Number(version?.split(".")[0] ?? 0) || 0;

export const defaultPgProbe: PgProbe = readPg;

const defaultFreeDisk = async (dir: string): Promise<number | null> => {
  try {
    const s = await statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
};

// server_version_num 160004 → "16.4".
const pgVersionOf = (num: number): string => `${Math.floor(num / 10000)}.${num % 10000}`;

/** A program's version line, or null when it is not on this machine. */
async function programVersion(exec: ExecFn, cmd: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const r = await exec(cmd, ["--version"], { env, cwd: env.HOME ?? process.cwd(), timeoutMs: 20_000 });
    return r.code === 0 ? versionIn(`${r.stdout} ${r.stderr}`) : null;
  } catch {
    return null;
  }
}

/**
 * gh: not installed, signed out, signed in without write access, or ready. `gh auth status` exits non-zero when no
 * account is signed in. A classic token lists its scopes; without `repo` (or `public_repo`) it cannot push or create a
 * repository. A fine-grained token or GH_TOKEN shows no scope line, and is taken as able to write.
 */
export type GhState = { state: "ok" | "absent" | "signed_out" | "no_write"; version: string | null };

/** PLA-I2-5: gh's state alone, shared with the readiness list's GitHub item (src/runner/readiness.ts). */
export async function ghState(exec: ExecFn = defaultExec, env: NodeJS.ProcessEnv = process.env): Promise<GhState> {
  const version = await programVersion(exec, "gh", env);
  if (!version) return { state: "absent", version: null };
  let r: Awaited<ReturnType<ExecFn>>;
  try {
    r = await exec("gh", ["auth", "status", "--hostname", "github.com"], { env, cwd: env.HOME ?? process.cwd(), timeoutMs: 20_000 });
  } catch {
    return { state: "signed_out", version };
  }
  const text = `${r.stdout}\n${r.stderr}`;
  if (r.code !== 0 || /not logged in|gh auth login/i.test(text)) return { state: "signed_out", version };
  const scopes = /token scopes:\s*(.*)/i.exec(text)?.[1];
  if (scopes !== undefined) {
    const list = scopes.split(",").map((s) => s.replace(/['"\s]/g, ""));
    if (!list.includes("repo") && !list.includes("public_repo")) return { state: "no_write", version };
  }
  return { state: "ok", version };
}

async function ghItem(exec: ExecFn, env: NodeJS.ProcessEnv, machineItem: (id: MachineItemId, reason: MachineReason, d?: MachineDetail) => MachineItem): Promise<MachineItem> {
  const g = await ghState(exec, env);
  return machineItem("gh", g.state, g.version ? { version: g.version } : {});
}

export async function machineCheck(deps: MachineCheckDeps = {}): Promise<MachineItem[]> {
  const env = deps.env ?? process.env;
  const exec = deps.exec ?? defaultExec;
  // PLA-I2-10: every item in the install's language.
  const language = deps.language ?? installLanguage(env);
  const machineItem = (id: MachineItemId, reason: MachineReason, d: MachineDetail = {}) => itemIn(id, reason, d, language);
  const items = new Map<MachineItemId, MachineItem>();
  const put = (item: MachineItem) => items.set(item.id, item);

  // Node
  const node = deps.nodeVersion ?? process.versions.node;
  put(machineItem("node", majorOf(node) >= MIN_NODE_MAJOR ? "ok" : "old", { version: node }));

  // Postgres, then pg_dump against its major
  const url = env.DATABASE_URL?.trim();
  let serverMajor = 0;
  let serverVersion: string | null = null;
  let serverBinDir: string | null = null;
  if (!url) put(machineItem("postgres", "no_url"));
  else {
    const p = await (deps.pgProbe ?? defaultPgProbe)(url);
    if (!p.ok) put(machineItem("postgres", p.reason ?? "unreachable", { user: userOf(url) }));
    else {
      serverBinDir = p.binDir ?? null;
      serverVersion = pgVersionOf(p.versionNum);
      serverMajor = Math.floor(p.versionNum / 10000);
      put(machineItem("postgres", serverMajor >= MIN_POSTGRES_MAJOR ? "ok" : "old", { version: serverVersion }));
    }
  }
  // B4: the server's own folder first, when it told us (a local server read by a superuser).
  const dumpCmd = serverBinDir && !env.PLANIA_PG_BIN?.trim() ? pgToolFor("pg_dump", serverMajor, { env, serverBinDir }) : pgDumpFor(serverMajor, env);
  const dump = await programVersion(exec, dumpCmd, env);
  if (!dump) put(machineItem("pg_dump", "absent"));
  else put(machineItem("pg_dump", serverMajor && majorOf(dump) < serverMajor ? "mismatch" : "ok", { version: dump, server: serverVersion }));

  // git, gh
  const git = await programVersion(exec, "git", env);
  put(machineItem("git", git ? "ok" : "absent", { version: git }));
  put(await ghItem(exec, env, machineItem));

  // Claude Code and its session: the brief doctor's version reading and dry run.
  const cmd = commandOf(env);
  const claude = await claudeVersion(cmd, env, exec);
  put(machineItem("claude", claude ? "ok" : "absent", { version: claude }));
  if (!claude) put(machineItem("claude_session", "not_checked"));
  else {
    const s = await (deps.claudeDryRun ?? claudeDryRun)(cmd, env, exec);
    if (s.state === "signed_in") put(machineItem("claude_session", "ok"));
    else if (s.state === "failed") put(machineItem("claude_session", "failed", { subtype: s.subtype }));
    // No result, or a run that could not start, is what a signed-out Claude looks like from here.
    else put(machineItem("claude_session", "signed_out"));
  }

  // Disk and memory
  const free = await (deps.freeDisk ?? defaultFreeDisk)(env.HOME ?? process.cwd());
  put(machineItem("disk", free !== null && free >= MIN_FREE_DISK_GB * GB ? "ok" : "low", { gb: free === null ? undefined : gb(free) }));
  const mem = (deps.totalMemory ?? totalmem)();
  // A machine sold as 8 GB reports a little less.
  put(machineItem("memory", mem >= (MIN_MEMORY_GB - 0.5) * GB ? "ok" : "low", { gb: Math.round(gb(mem)) }));

  // Chrome (optional)
  put(machineItem("chrome", (deps.findChrome ?? findChrome)() ? "ok" : "absent"));

  return MACHINE_ITEMS.map((id) => items.get(id)!);
}

/** The required items that are not ready: the install command stops when this is not empty. */
export const blocking = (items: MachineItem[]): MachineItem[] => items.filter((i) => i.state === "missing");

/**
 * The install command's check: it calls this before it changes anything and stops when proceed is false, printing
 * text. The installer (PLA-I2-1) injects it as its machine-check hook, so its own tests can pass a fake.
 */
export async function installGate(
  deps: MachineCheckDeps = {},
  o: { skip?: MachineItemId[] } = {},
): Promise<{ proceed: boolean; items: MachineItem[]; text: string; later: MachineItem[] }> {
  const items = await machineCheck(deps);
  const notNow = new Set<MachineItemId>([...AFTER_INSTALL, ...(o.skip ?? [])]);
  return {
    proceed: blocking(items).every((i) => notNow.has(i.id)),
    items,
    text: formatMachineCheck(items, deps.language ?? installLanguage(deps.env)),
    later: blocking(items).filter((i) => AFTER_INSTALL.includes(i.id)),
  };
}

/**
 * PLA-I2-4 (from zero): what the install goes on without. Claude Code and its session stay the owner's to install and
 * sign in; the install names them again at the end, and the screen's list keeps them required.
 */
export const AFTER_INSTALL: MachineItemId[] = ["claude", "claude_session"];

/**
 * Items the install's machine check ignores, from PLANIA_UNSUPPORTED_SKIP_CHECK (comma-separated ids). Only the clean-machine
 * CI job sets it (a macOS runner has 7 GB of memory); unsupported for users.
 */
export function skippedChecks(env: NodeJS.ProcessEnv = process.env): MachineItemId[] {
  const ids = (env.PLANIA_UNSUPPORTED_SKIP_CHECK ?? "").split(",").map((s) => s.trim());
  return MACHINE_ITEMS.filter((id) => ids.includes(id));
}

/** One line per item, the fix under each one that has one. The text the install command and the CLI print. */
export function formatMachineCheck(items: MachineItem[], language: Language = installLanguage()): string {
  const mark = { ready: "✓", missing: "✗", optional: "·" } as const;
  return items
    .map((i) => {
      const head = `${mark[i.state]} ${i.name}: ${i.sentence}${i.state === "optional" ? FALTA[language].optionalMark : ""}`;
      return i.fix ? `${head}\n    ${i.fix}` : head;
    })
    .join("\n");
}
