import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

// `gh auth token` on a Mac reads the login keychain through `security`. A timeout on `gh` kills
// that process and leaves `security` waiting on the dialog; the next tick then starts another.
// The child is spawned detached, with no shell, so it is its own process group. On timeout the
// group is signalled, which takes the grandchildren with it. The child is unref'd so a leftover
// process does not hold the server open.

export type GroupResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; reason: "missing" | "exit" | "timeout"; code?: number; stdout: string; stderr: string };

export type GroupRun = (
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; env?: NodeJS.ProcessEnv; maxBuffer?: number },
) => Promise<GroupResult>;

const DEFAULT_MAX_BUFFER = 1024 * 1024;

function killGroup(pid: number | undefined): void {
  if (!pid || pid <= 0) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
      try {
        process.kill(pid, "SIGKILL");
      } catch (err2) {
        if ((err2 as NodeJS.ErrnoException).code !== "ESRCH") {
          // The caller still reports timeout.
        }
      }
    }
  }
}

export function runInGroup(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; env?: NodeJS.ProcessEnv; maxBuffer?: number },
): Promise<GroupResult> {
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    // Cleared once the result is known. The child itself is unref'd below.
    const keepAlive = setInterval(() => {}, 500);
    const finish = (result: GroupResult) => {
      if (settled) return;
      settled = true;
      clearInterval(keepAlive);
      if (timer) clearTimeout(timer);
      if (grace) clearTimeout(grace);
      resolve(result);
    };

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let overflow = false;
    let timedOut = false;
    const decode = (chunks: Buffer[]) => Buffer.concat(chunks).toString("utf8");
    const push = (chunks: Buffer[], len: number, chunk: Buffer | string): number => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (len >= maxBuffer) {
        overflow = true;
        return len;
      }
      const room = maxBuffer - len;
      if (buf.length > room) {
        chunks.push(buf.subarray(0, room));
        overflow = true;
        return maxBuffer;
      }
      chunks.push(buf);
      return len + buf.length;
    };

    const spawnOpts: SpawnOptions = { detached: true, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
    if (opts.env) spawnOpts.env = opts.env;

    let child: ChildProcess;
    try {
      child = spawn(cmd, args, spawnOpts);
    } catch (err) {
      clearInterval(keepAlive);
      const code = (err as NodeJS.ErrnoException).code;
      resolve(
        code === "ENOENT"
          ? { ok: false, reason: "missing", stdout: "", stderr: "" }
          : { ok: false, reason: "exit", stdout: "", stderr: err instanceof Error ? err.message : String(err) },
      );
      return;
    }

    const stopForOverflow = () => {
      if (overflow) killGroup(child.pid);
    };
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutLen = push(stdout, stdoutLen, chunk);
      stopForOverflow();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrLen = push(stderr, stderrLen, chunk);
      stopForOverflow();
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (timedOut) return;
      if (err.code === "ENOENT") finish({ ok: false, reason: "missing", stdout: "", stderr: "" });
      else finish({ ok: false, reason: "exit", stdout: decode(stdout), stderr: err.message });
    });
    child.on("close", (code) => {
      const out = decode(stdout);
      const errText = decode(stderr);
      if (timedOut) return finish({ ok: false, reason: "timeout", stdout: out, stderr: errText });
      if (overflow) return finish({ ok: false, reason: "exit", stdout: out, stderr: errText || "maxBuffer exceeded" });
      if (code === 0) return finish({ ok: true, stdout: out, stderr: errText });
      finish({ ok: false, reason: "exit", code: typeof code === "number" ? code : undefined, stdout: out, stderr: errText });
    });

    child.unref();
    timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
      grace = setTimeout(() => finish({ ok: false, reason: "timeout", stdout: decode(stdout), stderr: decode(stderr) }), 200);
      grace.unref();
    }, opts.timeoutMs);
    timer.unref();
  });
}
