#!/usr/bin/env node
// PLA-I60-3: the process that owns one runner run, so the run outlives the Plania server (a deploy restart).
//   node wrapper.mjs <run_id> <log_path> <exit_path> -- <command> <args...>
// It starts <command> with stdout and stderr appended to <log_path> (no pipe to the server), in this process's
// group (the server signals the whole group to stop a run), and when the command exits it writes
// {run_id, code, signal, ended_at} to <exit_path> atomically. The server tails the log and reads the exit file,
// whether it started the run or found it again after a restart. Plain JS with no imports from the app: it never
// needs a build. SIGINT and SIGTERM reach the command through the group; this process only waits for it. On Windows
// the server stops the run with taskkill /T, which ends this process and the command together (no exit file: the
// server reads that as stopped).
import { spawn } from "node:child_process";
import { closeSync, openSync, renameSync, writeFileSync } from "node:fs";

const [runId, logPath, exitPath, sep, command, ...args] = process.argv.slice(2);
if (!runId || !logPath || !exitPath || sep !== "--" || !command) {
  process.stderr.write("usage: wrapper.mjs <run_id> <log_path> <exit_path> -- <command> [args...]\n");
  process.exit(2);
}

const fd = openSync(logPath, "a", 0o600);
let done = false;
const finish = (info) => {
  if (done) return;
  done = true;
  try {
    const tmp = `${exitPath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ run_id: runId, ...info, ended_at: new Date().toISOString() }), { mode: 0o600 });
    renameSync(tmp, exitPath);
  } finally {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
    process.exit(0);
  }
};

// The group's SIGINT/SIGTERM is for the command; this process stays to record how it ended.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => {});

// windowsHide: this process has no console on Windows (it was started detached), so claude would open a window.
const child = spawn(command, args, { stdio: ["ignore", fd, fd], env: process.env, cwd: process.cwd(), windowsHide: true });
child.on("exit", (code, signal) => finish({ code, signal }));
child.on("error", (err) => finish({ code: null, signal: null, error: String(err?.message ?? err).slice(0, 200) }));
