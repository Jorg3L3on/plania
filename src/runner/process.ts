// PLA-I29-2: one supervised claude process. Detached in its own process group, stdout teed to a
// per-run log file outside every repo, stopped with SIGINT, then SIGTERM, then SIGKILL.
import { spawn as nodeSpawn, execFile } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { processCommand } from "../lib/proc-command.js";
import { killTree } from "../lib/proc-tree.js";
import { runEnv } from "./run-env.js";

export type ChildLike = {
  pid?: number;
  stdout: Readable | null;
  stderr: Readable | null;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "error", listener: (err: Error) => void): unknown;
};

export type SpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  detached: true;
  stdio: ["ignore", "pipe", "pipe"];
};

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildLike;
// Signals the whole process group of pid (negative pid), so subagents and tools stop too. PLA-I2-19 (audit B5): on
// Windows, which has neither groups nor signals, the first signal ends the tree (taskkill /T /F): the run cannot save
// its branch there the way SIGINT lets it on macOS and Linux.
export type KillFn = (pid: number, signal: NodeJS.Signals) => void;

// windowsHide: a detached child on Windows has no console, so a console program it starts (claude, git) would open a
// window of its own.
export const defaultSpawn: SpawnFn = (command, args, options) => nodeSpawn(command, args, { ...options, windowsHide: true });

export const defaultKill: KillFn = (pid, signal) => killTree(pid, signal);

// True when pid is alive and its command line looks like claude (guards against a reused pid).
export type ProbePid = (pid: number) => Promise<boolean>;

// PLA-I2-19: /proc on Linux, portable ps elsewhere (src/lib/proc-command.ts).
export const defaultProbePid: ProbePid = async (pid) => /\bclaude\b/.test((await processCommand(pid)) ?? "");

// PLA-I2-13: the child env is an allow-list (src/runner/run-env.ts): system basics, Claude Code's own variables
// untouched, the run's own values (extra) and the names the project asks for. Nothing of Plania's own.
export function childEnv(base: NodeJS.ProcessEnv, extra: Record<string, string> = {}, names: readonly string[] = []): NodeJS.ProcessEnv {
  return runEnv(base, { extra, names });
}

export type ExitInfo = { code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; stoppedBy: string | null };

export type Supervised = {
  pid: number | null;
  done: Promise<ExitInfo>;
  // SIGINT now, SIGTERM after graceMs, SIGKILL after another graceMs, unless it exits first.
  stop(reason: string): void;
};

export type SuperviseOptions = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logPath: string | null;
  timeoutMs: number;
  graceMs: number;
  onStdout?: (chunk: string) => void;
  spawn?: SpawnFn;
  kill?: KillFn;
};

export function supervise(opts: SuperviseOptions): Supervised {
  const spawnFn = opts.spawn ?? defaultSpawn;
  const killFn = opts.kill ?? defaultKill;
  let log: ReturnType<typeof createWriteStream> | null = null;
  if (opts.logPath) {
    mkdirSync(path.dirname(opts.logPath), { recursive: true });
    log = createWriteStream(opts.logPath, { flags: "a", mode: 0o600 });
  }
  const child = spawnFn(opts.command, opts.args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const pid = typeof child.pid === "number" ? child.pid : null;
  const timers: NodeJS.Timeout[] = [];
  let exited = false;
  let stopping: string | null = null;
  let timedOut = false;

  const clear = () => timers.splice(0).forEach((t) => clearTimeout(t));

  const stop = (reason: string) => {
    if (exited || stopping || pid == null) return;
    stopping = reason;
    killFn(pid, "SIGINT");
    timers.push(
      setTimeout(() => {
        if (exited) return;
        killFn(pid, "SIGTERM");
        timers.push(
          setTimeout(() => {
            if (!exited) killFn(pid, "SIGKILL");
          }, opts.graceMs),
        );
      }, opts.graceMs),
    );
  };

  child.stdout?.setEncoding?.("utf8");
  child.stdout?.on("data", (chunk: string | Buffer) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    log?.write(text);
    opts.onStdout?.(text);
  });
  child.stderr?.on("data", (chunk: string | Buffer) => {
    log?.write(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });

  const done = new Promise<ExitInfo>((resolve) => {
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (exited) return;
      exited = true;
      clear();
      const info = { code, signal, timedOut, stoppedBy: stopping };
      if (log) log.end(() => resolve(info));
      else resolve(info);
    };
    child.once("exit", (code, signal) => finish(code, signal));
    child.once("error", () => finish(null, null));
  });

  timers.push(
    setTimeout(() => {
      timedOut = true;
      stop("timeout");
    }, opts.timeoutMs),
  );

  return { pid, done, stop };
}

// ---- PLA-I60-3: runs that outlive the server
//
// superviseDetached starts the run through wrapper.mjs (detached, stdio ignored, unref'd): the wrapper owns the
// command and writes its log and exit file. This side tails the log from a byte offset (onStdout gets the same text
// it did through the pipe) and finishes when the exit file appears, or when the wrapper is gone without one.
// attachDetached does the same for a run found live after a restart (from offset 0, so the reader sees it all).
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const WRAPPER_PATH = fileURLToPath(new URL("./wrapper.mjs", import.meta.url));
export const exitPathOf = (logPath: string): string => `${logPath}.exit.json`;

export type DetachedSpawn = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; detached: true; stdio: "ignore" }) => { pid?: number; unref?: () => void; on?: (event: "error", fn: (err: Error) => void) => unknown };
const defaultDetachedSpawn: DetachedSpawn = (command, args, options) => nodeSpawn(command, args, { ...options, windowsHide: true });

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

type Tail = { pid: number | null; logPath: string; exitPath: string; timeoutMs: number; graceMs: number; pollMs?: number; onStdout?: (chunk: string) => void; kill?: KillFn; alive?: (pid: number) => boolean };

function follow(t: Tail): Supervised {
  const killFn = t.kill ?? defaultKill;
  const alive = t.alive ?? isAlive;
  const timers: NodeJS.Timeout[] = [];
  let offset = 0;
  let exited = false;
  let stopping: string | null = null;
  let timedOut = false;
  let goneTicks = 0;
  const readNew = () => {
    if (!existsSync(t.logPath)) return;
    const size = statSync(t.logPath).size;
    if (size <= offset) return;
    const fd = openSync(t.logPath, "r");
    try {
      const buf = Buffer.alloc(size - offset);
      const n = readSync(fd, buf, 0, buf.length, offset);
      offset += n;
      // Only whole lines go to the reader; a partial line waits for the next read.
      const text = buf.subarray(0, n).toString("utf8");
      const cut = text.lastIndexOf("\n");
      if (cut < 0) {
        offset -= n;
        return;
      }
      offset -= Buffer.byteLength(text.slice(cut + 1), "utf8");
      t.onStdout?.(text.slice(0, cut + 1));
    } finally {
      closeSync(fd);
    }
  };
  const stop = (reason: string) => {
    if (exited || stopping || t.pid == null) return;
    stopping = reason;
    killFn(t.pid, "SIGINT");
    timers.push(
      setTimeout(() => {
        if (exited) return;
        killFn(t.pid!, "SIGTERM");
        timers.push(setTimeout(() => !exited && killFn(t.pid!, "SIGKILL"), t.graceMs));
      }, t.graceMs),
    );
  };
  const done = new Promise<ExitInfo>((resolve) => {
    const tick = () => {
      if (exited) return;
      readNew();
      let info: { code?: number | null; signal?: NodeJS.Signals | null } | null = null;
      if (existsSync(t.exitPath)) {
        try {
          info = JSON.parse(readFileSync(t.exitPath, "utf8"));
        } catch {
          info = null;
        }
      } else if (t.pid == null || !alive(t.pid)) {
        // Gone without an exit file (SIGKILL): give the file system two more looks, then call it.
        goneTicks += 1;
        if (goneTicks >= 3) info = { code: null, signal: null };
      }
      if (info) {
        readNew();
        exited = true;
        timers.splice(0).forEach((x) => clearTimeout(x));
        resolve({ code: info.code ?? null, signal: info.signal ?? null, timedOut, stoppedBy: stopping });
        return;
      }
      timers.push(setTimeout(tick, t.pollMs ?? 500));
    };
    tick();
  });
  if (t.timeoutMs > 0)
    timers.push(
      setTimeout(() => {
        timedOut = true;
        stop("timeout");
      }, t.timeoutMs),
    );
  return { pid: t.pid, done, stop };
}

export function superviseDetached(opts: SuperviseOptions & { runId: string; wrapperPath?: string; spawnDetached?: DetachedSpawn; pollMs?: number }): Supervised {
  if (!opts.logPath) throw new Error("a detached run needs a log path");
  mkdirSync(path.dirname(opts.logPath), { recursive: true });
  const exitPath = exitPathOf(opts.logPath);
  const spawnFn = opts.spawnDetached ?? defaultDetachedSpawn;
  const child = spawnFn(process.execPath, [opts.wrapperPath ?? WRAPPER_PATH, opts.runId, opts.logPath, exitPath, "--", opts.command, ...opts.args], {
    cwd: opts.cwd,
    env: opts.env,
    detached: true,
    stdio: "ignore",
  });
  // A spawn that fails (no such cwd or binary) has no pid: follow() ends it as gone, with no exit file.
  child.on?.("error", () => undefined);
  child.unref?.();
  return follow({ pid: typeof child.pid === "number" ? child.pid : null, logPath: opts.logPath, exitPath, timeoutMs: opts.timeoutMs, graceMs: opts.graceMs, pollMs: opts.pollMs, onStdout: opts.onStdout, kill: opts.kill });
}

export function attachDetached(input: { pid: number | null; logPath: string; timeoutMs: number; graceMs: number; pollMs?: number; onStdout?: (chunk: string) => void; kill?: KillFn; alive?: (pid: number) => boolean }): Supervised {
  return follow({ ...input, exitPath: exitPathOf(input.logPath) });
}

// True when pid is a wrapper for this run (guards against a reused pid after a reboot).
export const isWrapperOf = async (pid: number, runId: string): Promise<boolean> => {
  const cmd = (await processCommand(pid)) ?? "";
  return cmd.includes("wrapper.mjs") && cmd.includes(runId);
};
