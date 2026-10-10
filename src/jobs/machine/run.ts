import { execFile } from "node:child_process";

// The only way the machine job touches the Mac: read-only commands through execFile (no shell, so
// no quoting to get wrong), each with a timeout. Injectable so tests feed recorded output.

export type RunResult =
  | { ok: true; stdout: string }
  // missing: the binary is not installed (ENOENT); exit: it ran and failed (stdout kept: lsof exits 1
  // when some pid is gone yet still prints the rest); timeout: killed after timeoutMs.
  | { ok: false; reason: "missing" | "exit" | "timeout"; code?: number; stdout: string };

export type Run = (cmd: string, args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>;

const DEFAULT_TIMEOUT_MS = 5_000;

export const execRun: Run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: "utf8", windowsHide: true }, (err, stdout) => {
      if (!err) return resolve({ ok: true, stdout });
      const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
      if (e.code === "ENOENT") return resolve({ ok: false, reason: "missing", stdout: "" });
      if (e.killed) return resolve({ ok: false, reason: "timeout", stdout: stdout ?? "" });
      resolve({ ok: false, reason: "exit", code: typeof e.code === "number" ? e.code : undefined, stdout: stdout ?? "" });
    });
  });

// stdout of a command that succeeded; null when it is missing, timed out or failed (the collector is skipped).
export function okOut(r: RunResult): string | null {
  return r.ok ? r.stdout : null;
}

// Same, but a non-zero exit that still printed something counts (lsof: 1 = some pids not found).
export function partialOut(r: RunResult): string | null {
  if (r.ok) return r.stdout;
  return r.reason === "exit" && r.stdout.trim() ? r.stdout : null;
}
