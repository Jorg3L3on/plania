// PLA-I29-2: one supervised claude process. Detached in its own process group, stdout teed to a
// per-run log file outside every repo, stopped with SIGINT, then SIGTERM, then SIGKILL.
import { spawn as nodeSpawn, execFile } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";

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
// Signals the whole process group of pid (negative pid), so subagents and tools stop too.
export type KillFn = (pid: number, signal: NodeJS.Signals) => void;

export const defaultSpawn: SpawnFn = (command, args, options) => nodeSpawn(command, args, options);

export const defaultKill: KillFn = (pid, signal) => {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
};

// True when pid is alive and its command line looks like claude (guards against a reused pid).
export type ProbePid = (pid: number) => Promise<boolean>;

export const defaultProbePid: ProbePid = (pid) =>
  new Promise((resolve) => {
    execFile("ps", ["-o", "command=", "-p", String(pid)], { timeout: 5_000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(/\bclaude\b/.test(stdout));
    });
  });

// The child env: the parent's, minus every ANTHROPIC_* key (a stray API key would bill the API,
// not the plan), plus the few values the run needs.
export function childEnv(base: NodeJS.ProcessEnv, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (/^ANTHROPIC_/i.test(key)) continue;
    if (value !== undefined) out[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (/^ANTHROPIC_/i.test(key)) continue;
    out[key] = value;
  }
  return out;
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
