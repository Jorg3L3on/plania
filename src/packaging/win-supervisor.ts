// PLA-I2-19 (audit B5): the Windows service's supervisor. The Scheduled Task «Plania» (src/packaging/service.ts) runs
// scripts/service-win.ts run, which:
//   - starts the server (node --env-file=.env --import tsx scripts/dev.ts --port N) with its output appended to
//     %LOCALAPPDATA%\plania\logs\server.log and an IPC channel;
//   - starts it again 10 s after it exits on its own (launchd's KeepAlive, systemd's Restart=on-failure);
//   - does not start while service.stopped is there (a stop request wrote it; start and restart remove it);
//   - takes «restart» and «stop» on the named pipe \\.\pipe\plania-service-<port> (pnpm server:restart, the update,
//     a second install, the uninstall). Windows has no SIGTERM, so the server is asked to drain over IPC
//     (SHUTDOWN_MESSAGE, src/ops/shutdown.ts); one that has not exited after drainMs is ended (that process only:
//     the runs it started outlive it, as on macOS and Linux).
// Every outside call is injected; test/release-pack.test.ts drives it with fakes.
import { SHUTDOWN_MESSAGE } from "../ops/shutdown.js";
import type { SupervisorConfig } from "./service.js";

export const pipeName = (port: number): string => `\\\\.\\pipe\\plania-service-${port}`;
export const RESTART_DELAY_MS = 10_000;
// The server drains for up to 15 s (DRAIN_MS) after the request; a little more before it is ended.
export const DRAIN_WAIT_MS = 20_000;

export type ServerChild = {
  pid?: number;
  send?: (message: { type: string }) => boolean;
  kill: () => void;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
};

export type SupervisorDeps = {
  spawn: (command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ServerChild;
  env: NodeJS.ProcessEnv;
  // One line of the supervisor's own into the log.
  log: (line: string) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  exit: (code: number) => void;
  // A stop request leaves this mark, so the task's 5-minute check does not start the server again until a start
  // or restart removes it.
  markStopped: () => void;
  restartDelayMs?: number;
  drainWaitMs?: number;
};

export type Supervisor = {
  start: () => void;
  // «restart», «stop» or «status»; answers once done (a restart: once the new server is started).
  request: (command: string) => Promise<string>;
};

type Live = { proc: ServerChild; exited: Promise<void> };

export function createSupervisor(config: SupervisorConfig, d: SupervisorDeps): Supervisor {
  const restartDelay = d.restartDelayMs ?? RESTART_DELAY_MS;
  const drainWait = d.drainWaitMs ?? DRAIN_WAIT_MS;
  let live: Live | null = null;
  let pending: unknown = null;
  let wanted = true;
  let queue: Promise<unknown> = Promise.resolve();

  const start = () => {
    pending = null;
    if (!wanted) return;
    d.log(`[service] starting the server on port ${config.port}`);
    const proc = d.spawn(config.command, config.args, { cwd: config.root, env: { ...d.env, PATH: config.path || d.env.PATH } });
    let resolveExit!: () => void;
    const exited = new Promise<void>((r) => (resolveExit = r));
    const me: Live = { proc, exited };
    live = me;
    proc.once("exit", (code, signal) => {
      resolveExit();
      if (live !== me) return;
      live = null;
      if (!wanted) return;
      d.log(`[service] the server exited (${code ?? signal ?? "unknown"}); starting it again in ${Math.round(restartDelay / 1000)} s`);
      pending = d.setTimer(start, restartDelay);
    });
  };

  const wait = (p: Promise<void>, ms: number) =>
    new Promise<boolean>((resolve) => {
      const t = d.setTimer(() => resolve(false), ms);
      void p.then(() => {
        d.clearTimer(t);
        resolve(true);
      });
    });

  const stopServer = async () => {
    if (pending) d.clearTimer(pending);
    pending = null;
    const me = live;
    if (!me) return;
    live = null;
    try {
      me.proc.send?.({ type: SHUTDOWN_MESSAGE });
    } catch {
      // the channel is gone: the server is exiting already
    }
    if (await wait(me.exited, drainWait)) return;
    d.log(`[service] the server did not exit after ${Math.round(drainWait / 1000)} s; ending it`);
    try {
      me.proc.kill();
    } catch {
      // already gone
    }
    await wait(me.exited, 5_000);
  };

  const handle = async (command: string): Promise<string> => {
    if (command === "restart") {
      d.log("[service] restart requested");
      wanted = true;
      await stopServer();
      start();
      return "ok";
    }
    if (command === "stop") {
      d.log("[service] stop requested");
      wanted = false;
      d.markStopped();
      await stopServer();
      // After the answer is on its way.
      d.setTimer(() => d.exit(0), 200);
      return "ok";
    }
    if (command === "status") return live ? `running ${live.proc.pid ?? ""}`.trim() : "waiting";
    return "unknown";
  };

  return {
    start,
    request: (command) => {
      const next = queue.then(() => handle(command.trim()));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
