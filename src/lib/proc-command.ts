// PLA-I2-19: the command line of a running process, on macOS and Linux alike. Used to tell a leftover of ours
// (a test copy, a run's wrapper) from an unrelated process that reused its pid.
//   Linux: /proc/<pid>/cmdline (no program needed; BusyBox's ps has no -p).
//   elsewhere: `ps -o command= -p <pid>`, which BSD ps and GNU procps both accept.
// null when the process is gone or cannot be read.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";

export type ProcCommandDeps = {
  platform?: NodeJS.Platform;
  readFile?: (file: string) => string;
  ps?: (pid: number) => Promise<string | null>;
};

const psDefault = (pid: number) =>
  new Promise<string | null>((resolve) => {
    execFile("ps", ["-o", "command=", "-p", String(pid)], { timeout: 5_000 }, (err, stdout) => resolve(err ? null : stdout.trim() || null));
  });

export async function processCommand(pid: number, deps: ProcCommandDeps = {}): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if ((deps.platform ?? process.platform) === "linux") {
    try {
      // Arguments are NUL-separated; a zombie has an empty cmdline (it is gone for our purposes).
      const raw = (deps.readFile ?? ((f) => readFileSync(f, "utf8")))(`/proc/${pid}/cmdline`);
      const text = raw.split("\0").filter(Boolean).join(" ").trim();
      return text || null;
    } catch {
      return null;
    }
  }
  return (deps.ps ?? psDefault)(pid);
}
