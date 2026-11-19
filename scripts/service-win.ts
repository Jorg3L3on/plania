// PLA-I2-19 (audit B5): the Windows service's supervisor and its requests (src/packaging/win-supervisor.ts).
//   node --import tsx scripts/service-win.ts run       what the Scheduled Task «Plania» runs (no window: conhost --headless)
//   node --import tsx scripts/service-win.ts start     the install and the update: clears a stop, runs the task
//   node --import tsx scripts/service-win.ts restart   pnpm server:restart; starts the task when it is not running
//   node --import tsx scripts/service-win.ts stop      the update, a second install and the uninstall
// Its settings are the service.json `pnpm service:install` wrote to ~\.config\plania.
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { WINDOWS_TASK, windowsPaths, type SupervisorConfig } from "../src/packaging/service.js";
import { createSupervisor, pipeName } from "../src/packaging/win-supervisor.js";

const action = process.argv[2];
const paths = windowsPaths({ home: homedir(), localAppData: process.env.LOCALAPPDATA });
const configFile = paths.config;
const runTask = () => execFileSync("schtasks", ["/Run", "/TN", WINDOWS_TASK], { stdio: "inherit" });
const config: SupervisorConfig | null = existsSync(configFile) ? (JSON.parse(readFileSync(configFile, "utf8")) as SupervisorConfig) : null;

// Sends one request over the pipe; null when no supervisor is listening.
function ask(port: number, command: string, timeoutMs = 60_000): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const sock = connect(pipeName(port));
    let answer = "";
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`no answer from the service after ${timeoutMs / 1000} s`));
    }, timeoutMs);
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(`${command}\n`));
    sock.on("data", (d) => (answer += d));
    sock.on("end", () => {
      clearTimeout(timer);
      resolve(answer.trim());
    });
    sock.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === "ENOENT") resolve(null);
      else reject(e);
    });
  });
}

if (action === "run") {
  if (!config) {
    console.error(`Falta ${configFile}: corre pnpm service:install.`);
    process.exit(1);
  }
  mkdirSync(path.dirname(config.log), { recursive: true });
  const log = (line: string) => appendFileSync(config.log, `${new Date().toISOString()} ${line}\n`);
  // Stopped on purpose (an update in progress): the 5-minute check leaves it so.
  if (existsSync(paths.stopped)) process.exit(0);
  const sup = createSupervisor(config, {
    spawn: (command, args, opts) => {
      const fd = openSync(config.log, "a");
      const child = spawn(command, args, { ...opts, stdio: ["ignore", fd, fd, "ipc"], windowsHide: true });
      closeSync(fd);
      child.on("error", (e) => log(`[service] the server could not start: ${e.message}`));
      return child;
    },
    env: process.env,
    log,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as NodeJS.Timeout),
    exit: (code) => process.exit(code),
    markStopped: () => writeFileSync(paths.stopped, `${new Date().toISOString()}\n`),
  });
  const server = createServer((sock) => {
    sock.setEncoding("utf8");
    let buf = "";
    sock.on("data", (d) => {
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      void sup.request(buf.slice(0, nl)).then(
        (answer) => sock.end(`${answer}\n`),
        (e) => sock.end(`error ${e instanceof Error ? e.message : String(e)}\n`),
      );
    });
    sock.on("error", () => undefined);
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    // Another supervisor for this port is running: it keeps the server; this one leaves.
    log(`[service] ${e.code === "EADDRINUSE" ? "another supervisor is running" : `pipe failed: ${e.message}`}; this one exits`);
    process.exit(e.code === "EADDRINUSE" ? 0 : 1);
  });
  server.listen(pipeName(config.port), () => {
    log(`[service] supervisor ${process.pid} listening on ${pipeName(config.port)}`);
    sup.start();
  });
} else if (action === "start" || action === "restart" || action === "stop") {
  if (!config) {
    if (action === "stop") process.exit(0);
    console.error(`Falta ${configFile}: Plania no está instalada como servicio (pnpm service:install).`);
    process.exit(1);
  }
  try {
    if (action !== "stop") rmSync(paths.stopped, { force: true });
    if (action === "start") runTask();
    else {
      const answer = await ask(config.port, action);
      if (answer === null) {
        // Nothing listening: nothing to stop, or start the task for a restart.
        if (action === "restart") runTask();
        else writeFileSync(paths.stopped, `${new Date().toISOString()}\n`);
      } else if (answer !== "ok") throw new Error(answer);
    }
  } catch (e) {
    console.error(`El servicio no respondió: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
} else {
  console.error("Uso: node --import tsx scripts/service-win.ts run | start | restart | stop");
  process.exit(2);
}
