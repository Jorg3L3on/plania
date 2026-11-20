// PLA-I2-17: Plania as a service on the buyer's machine, started at login and restarted when it crashes.
//   macOS: a launchd agent, ~/Library/LaunchAgents/com.plania.server.plist, logs in ~/Library/Logs/plania/.
//   Linux: a systemd user unit, ~/.config/systemd/user/plania.service, logs in the user journal
//          (journalctl --user -u plania) and ~/.local/state/plania/server.log. WSL counts as Linux when systemd is on there; when it is off the
//          command says how to turn it on and changes nothing.
//   Windows (PLA-I2-19, audit B5): a per-user Scheduled Task «Plania» that starts at logon, with no admin rights and
//          nothing to install. Its action is conhost --headless (no window) running the supervisor,
//          scripts/service-win.ts (src/packaging/win-supervisor.ts), which keeps the server up (starts it again 10 s
//          after a crash), appends its output to %LOCALAPPDATA%\plania\logs\server.log and takes restart and stop
//          requests on a named pipe. The task's own RestartOnFailure covers the supervisor. The task XML and the
//          supervisor's settings (service.json) live in ~\.config\plania (windowsPaths says why).
// Every outside call (the commands, the file writes, the platform) is injected; scripts/service.ts passes the real
// ones and test/release-pack.test.ts asserts the files and the commands.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineWords, say } from "../words.js";

export const LAUNCHD_LABEL = "com.plania.server";
export const SYSTEMD_UNIT = "plania.service";

export const WINDOWS_TASK = "Plania";

export type ServicePlatform = "darwin" | "linux" | "win32" | "wsl-no-systemd" | "unsupported";

export type ServiceEnv = {
  platform: NodeJS.Platform;
  home: string;
  uid: number;
  // The package or checkout the service runs.
  root: string;
  // Absolute path of the Node that runs it (the one running this command).
  node: string;
  // The PATH the service gets: the installer's own, so it finds claude, git and gh as the shell did.
  path: string;
  port: number;
  // systemd is running on this Linux (sd_booted: /run/systemd/system exists).
  systemd: boolean;
  // Running inside WSL.
  wsl: boolean;
  // Windows: %LOCALAPPDATA% (default <home>\AppData\Local), the task's user (DOMAIN\name) and %SystemRoot%.
  localAppData?: string;
  user?: string;
  systemRoot?: string;
};

export type Command = { cmd: string; args: string[]; ignoreFailure?: boolean };
// encoding: schtasks reads a task XML only as UTF-16 (the content then starts with a BOM).
export type FileWrite = { path: string; content: string; encoding?: "utf8" | "utf16le" };
export type ServicePlan = {
  platform: ServicePlatform;
  files: FileWrite[];
  dirs: string[];
  remove: string[];
  commands: Command[];
  // Run after the files in `remove` are gone (systemd must forget a unit once its file is deleted).
  after: Command[];
  // What to tell the person, in Spanish.
  lines: string[];
};

export function servicePlatform(env: Pick<ServiceEnv, "platform" | "systemd" | "wsl">): ServicePlatform {
  if (env.platform === "darwin") return "darwin";
  if (env.platform === "linux") return env.systemd ? "linux" : env.wsl ? "wsl-no-systemd" : "unsupported";
  if (env.platform === "win32") return "win32";
  return "unsupported";
}

export const launchdPaths = (home: string) => ({
  plist: path.posix.join(home, "Library/LaunchAgents", `${LAUNCHD_LABEL}.plist`),
  logDir: path.posix.join(home, "Library/Logs/plania"),
  log: path.posix.join(home, "Library/Logs/plania/server.log"),
});
export const systemdPath = (home: string) => path.posix.join(home, ".config/systemd/user", SYSTEMD_UNIT);
// PLA-I2-8 (with PLA-I2-18): the Linux service also writes a log file where the help report reads it.
export const systemdLog = (home: string) => path.posix.join(home, ".local/state/plania/server.log");

// node --env-file=<root>/.env --import tsx <root>/scripts/dev.ts --port <port>, run from <root> so `tsx` resolves
// from the package's node_modules.
export function serverArgs(env: Pick<ServiceEnv, "root" | "node" | "port"> & { platform?: NodeJS.Platform }): string[] {
  const p = env.platform === "win32" ? path.win32 : path.posix;
  return [env.node, `--env-file=${p.join(env.root, ".env")}`, "--import", "tsx", p.join(env.root, "scripts", "dev.ts"), "--port", String(env.port)];
}

// ---- Windows (PLA-I2-19)

// The task XML and service.json go in ~\.config\plania (Plania's config folder on every system), not under AppData:
// a shell inside a packaged (MSIX) app, such as a desktop app's terminal, has its AppData writes redirected to the
// package's own folder, where the task (which runs outside the package) would not find them. Seen on the trial
// install. The log is under %LOCALAPPDATA%, written by the supervisor itself, so it lands in the real one.
export const windowsPaths = (env: Pick<ServiceEnv, "home" | "localAppData">) => {
  const dir = path.win32.join(env.home, ".config", "plania");
  const logs = path.win32.join(env.localAppData || path.win32.join(env.home, "AppData", "Local"), "plania", "logs");
  return {
    dir,
    task: path.win32.join(dir, "plania-task.xml"),
    config: path.win32.join(dir, "service.json"),
    // Written by a stop request, removed by start and restart: while it is there the task's 5-minute check does not
    // start the server (an update stops it while it swaps the files).
    stopped: path.win32.join(dir, "service.stopped"),
    logDir: logs,
    log: path.win32.join(logs, "server.log"),
  };
};

// What the supervisor reads at start (service.json): how to start the server and where its output goes.
export type SupervisorConfig = { root: string; port: number; path: string; log: string; command: string; args: string[] };
export function supervisorConfig(env: ServiceEnv): SupervisorConfig {
  const [command, ...args] = serverArgs({ ...env, platform: "win32" });
  return { root: env.root, port: env.port, path: env.path, log: windowsPaths(env).log, command: command!, args };
}

export type SupervisorAction = "run" | "start" | "restart" | "stop";
// The supervisor script, run with the package's tsx: node --import tsx <root>\scripts\service-win.ts <action>.
export const supervisorArgs = (env: Pick<ServiceEnv, "root">, action: SupervisorAction): string[] => [
  "--import",
  "tsx",
  path.win32.join(env.root, "scripts", "service-win.ts"),
  action,
];

// One argument of a Windows command line, quoted when it holds a space, a tab or a quote (CommandLineToArgvW rules).
export function winQuote(arg: string): string {
  if (arg && !/[\s"]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

// The task: at this user's logon, as this user (InteractiveToken, least privilege: no admin rights to register it),
// no time limit, on battery too, one instance. A supervisor that dies is not a failure to the Task Scheduler
// (conhost exits 0), so RestartOnFailure alone would not bring it back: a second trigger fires every 5 minutes while
// the user is logged on, and does nothing while the task runs (IgnoreNew) or after a stop request (service.stopped).
export function windowsTaskXml(env: ServiceEnv): string {
  const user = env.user ?? "";
  const conhost = path.win32.join(env.systemRoot || "C:\\Windows", "System32", "conhost.exe");
  const args = ["--headless", env.node, ...supervisorArgs(env, "run")].map(winQuote).join(" ");
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Plania: starts the Plania server at logon and keeps it running.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${xml(user)}</UserId>
    </LogonTrigger>
    <TimeTrigger>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>2020-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xml(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(conhost)}</Command>
      <Arguments>${xml(args)}</Arguments>
      <WorkingDirectory>${xml(env.root)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function launchdPlist(env: ServiceEnv): string {
  const { log } = launchdPaths(env.home);
  const args = serverArgs(env).map((a) => `    <string>${xml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(env.root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(env.path)}</string>
    <key>HOME</key>
    <string>${xml(env.home)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}

// systemd splits ExecStart on spaces unless an argument is quoted; quote every one, escaping \ and ".
// PLA-I2-4 (from zero): WorkingDirectory= takes the path as written, with no quotes (systemd refuses a quoted one as
// "not absolute" and never starts the unit); only % needs escaping.
const sdPath = (s: string) => s.replace(/%/g, "%%");
const sdQuote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;

export function systemdUnit(env: ServiceEnv): string {
  return `[Unit]
Description=Plania
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${sdPath(env.root)}
ExecStart=${serverArgs(env).map(sdQuote).join(" ")}
Environment=${sdQuote(`PATH=${env.path}`)}
Restart=on-failure
RestartSec=10
StandardOutput=append:${systemdLog(env.home)}
StandardError=append:${systemdLog(env.home)}
# A restart lets the requests in flight finish (scripts/dev.ts drains on SIGTERM).
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=default.target
`;
}

// PLA-I2-10: what the service command says, in the install's language; the Spanish is unchanged.
export const SERVICE_WORDS = defineWords({
  es: {
    wsl: [
      "Esta máquina es Linux dentro de Windows (WSL) y no tiene systemd encendido, así que Plania no puede quedar como servicio.",
      "Para encenderlo: agrega estas dos líneas a /etc/wsl.conf, corre «wsl --shutdown» en Windows y abre WSL otra vez:",
      "  [boot]",
      "  systemd=true",
      "Luego vuelve a correr pnpm service:install. Mientras tanto, enciende Plania a mano con pnpm start.",
    ],
    unsupported: ["Plania se instala como servicio en macOS, Linux y Windows; este sistema no es ninguno de ellos. Enciéndela a mano con pnpm start."],
    installed: (atBoot: boolean) => `Plania quedó como servicio: arranca al entrar a tu sesión${atBoot ? " (y al encender la máquina)" : ""} y se reinicia si se cae.`,
    open: (port: number, log: string) => `Abre http://localhost:${port}. Lo que escribe queda en ${log}.`,
    removedMac: "Plania ya no es un servicio: no arranca sola. Los datos y los registros quedan donde estaban.",
    removedLinux: "Plania ya no es un servicio: no arranca sola. Los datos quedan donde estaban.",
    noUser: "No se pudo saber tu usuario de Windows (USERNAME está vacío), así que Plania no quedó como servicio.",
  },
  en: {
    wsl: [
      "This machine is Linux inside Windows (WSL) and systemd is not on, so Plania cannot run as a service.",
      "To turn it on: add these two lines to /etc/wsl.conf, run «wsl --shutdown» in Windows and open WSL again:",
      "  [boot]",
      "  systemd=true",
      "Then run pnpm service:install again. Meanwhile, start Plania by hand with pnpm start.",
    ],
    unsupported: ["Plania installs as a service on macOS, Linux and Windows; this system is none of them. Start it by hand with pnpm start."],
    installed: (atBoot: boolean) => `Plania is now a service: it starts when you log in${atBoot ? " (and when the machine starts)" : ""} and restarts if it crashes.`,
    open: (port: number, log: string) => `Open http://localhost:${port}. What it writes goes to ${log}.`,
    removedMac: "Plania is no longer a service: it does not start on its own. The data and the logs stay where they were.",
    removedLinux: "Plania is no longer a service: it does not start on its own. The data stays where it was.",
    noUser: "Your Windows user could not be read (USERNAME is empty), so Plania was not set up as a service.",
  },
});

const otherLines = (platform: ServicePlatform): string[] => {
  const w = say(SERVICE_WORDS);
  return platform === "wsl-no-systemd" ? w.wsl : w.unsupported;
};

export function installPlan(env: ServiceEnv, opts: { atBoot?: boolean } = {}): ServicePlan {
  const platform = servicePlatform(env);
  const base = { platform, files: [] as FileWrite[], dirs: [] as string[], remove: [] as string[], commands: [] as Command[], after: [] as Command[] };
  if (platform === "darwin") {
    const p = launchdPaths(env.home);
    const domain = `gui/${env.uid}`;
    return {
      ...base,
      dirs: [path.posix.dirname(p.plist), p.logDir],
      files: [{ path: p.plist, content: launchdPlist(env) }],
      commands: [
        // A second install replaces the loaded agent: unload first (fails harmlessly when none is loaded).
        { cmd: "launchctl", args: ["bootout", `${domain}/${LAUNCHD_LABEL}`], ignoreFailure: true },
        { cmd: "launchctl", args: ["bootstrap", domain, p.plist] },
      ],
      lines: [
        say(SERVICE_WORDS).installed(false),
        say(SERVICE_WORDS).open(env.port, p.log),
      ],
    };
  }
  if (platform === "linux") {
    const unit = systemdPath(env.home);
    const commands: Command[] = [
      { cmd: "systemctl", args: ["--user", "daemon-reload"] },
      { cmd: "systemctl", args: ["--user", "enable", SYSTEMD_UNIT] },
      { cmd: "systemctl", args: ["--user", "restart", SYSTEMD_UNIT] },
    ];
    // Without lingering a user unit starts at login; with it, at boot before anyone logs in.
    if (opts.atBoot) commands.push({ cmd: "loginctl", args: ["enable-linger"], ignoreFailure: true });
    return {
      ...base,
      dirs: [path.posix.dirname(unit), path.posix.dirname(systemdLog(env.home))],
      files: [{ path: unit, content: systemdUnit(env) }],
      commands,
      lines: [
        say(SERVICE_WORDS).installed(!!opts.atBoot),
        say(SERVICE_WORDS).open(env.port, systemdLog(env.home)),
      ],
    };
  }
  if (platform === "win32") {
    if (!env.user) return { ...base, platform: "unsupported", lines: [say(SERVICE_WORDS).noUser] };
    const p = windowsPaths(env);
    return {
      ...base,
      dirs: [p.dir, p.logDir],
      files: [
        { path: p.task, content: `${String.fromCharCode(0xfeff)}${windowsTaskXml(env)}`, encoding: "utf16le" },
        { path: p.config, content: `${JSON.stringify(supervisorConfig(env), null, 2)}\n` },
      ],
      commands: [
        // A second install replaces the running one: its supervisor stops the server (fails harmlessly when none runs).
        { cmd: env.node, args: supervisorArgs(env, "stop"), ignoreFailure: true },
        { cmd: "schtasks", args: ["/Create", "/TN", WINDOWS_TASK, "/XML", p.task, "/F"] },
        // start clears the stop the line above left, then runs the task.
        { cmd: env.node, args: supervisorArgs(env, "start") },
      ],
      lines: [say(SERVICE_WORDS).installed(false), say(SERVICE_WORDS).open(env.port, p.log)],
    };
  }
  return { ...base, lines: otherLines(platform) };
}

export function uninstallPlan(env: ServiceEnv): ServicePlan {
  const platform = servicePlatform(env);
  const base = { platform, files: [] as FileWrite[], dirs: [] as string[], remove: [] as string[], commands: [] as Command[], after: [] as Command[] };
  if (platform === "darwin") {
    return {
      ...base,
      commands: [{ cmd: "launchctl", args: ["bootout", `gui/${env.uid}/${LAUNCHD_LABEL}`], ignoreFailure: true }],
      remove: [launchdPaths(env.home).plist],
      lines: [say(SERVICE_WORDS).removedMac],
    };
  }
  if (platform === "linux") {
    return {
      ...base,
      commands: [{ cmd: "systemctl", args: ["--user", "disable", "--now", SYSTEMD_UNIT], ignoreFailure: true }],
      remove: [systemdPath(env.home)],
      after: [{ cmd: "systemctl", args: ["--user", "daemon-reload"] }],
      lines: [say(SERVICE_WORDS).removedLinux],
    };
  }
  if (platform === "win32") {
    const p = windowsPaths(env);
    return {
      ...base,
      commands: [
        { cmd: env.node, args: supervisorArgs(env, "stop"), ignoreFailure: true },
        { cmd: "schtasks", args: ["/Delete", "/TN", WINDOWS_TASK, "/F"], ignoreFailure: true },
      ],
      remove: [p.task, p.config, p.stopped],
      lines: [say(SERVICE_WORDS).removedMac],
    };
  }
  return { ...base, lines: otherLines(platform) };
}

// Windows needs the Node and the package that send the supervisor its restart and stop requests.
type WinRunner = Partial<Pick<ServiceEnv, "node" | "root">>;

// The restart a deploy needs: the service manager stops the server (which drains) and starts it again. On Windows
// the supervisor does both, asked over its pipe (and the task is started when it is not running).
export function restartCommand(env: Pick<ServiceEnv, "platform" | "systemd" | "wsl" | "uid"> & WinRunner): Command | null {
  const platform = servicePlatform(env);
  if (platform === "darwin") return { cmd: "launchctl", args: ["kickstart", "-k", `gui/${env.uid}/${LAUNCHD_LABEL}`] };
  if (platform === "linux") return { cmd: "systemctl", args: ["--user", "restart", SYSTEMD_UNIT] };
  if (platform === "win32" && env.node && env.root) return { cmd: env.node, args: supervisorArgs({ root: env.root }, "restart") };
  return null;
}

// PLA-I2-8: the update stops the service before it swaps the files and starts it after. Null where there is none.
export function stopCommand(env: Pick<ServiceEnv, "platform" | "systemd" | "wsl" | "uid"> & WinRunner): Command | null {
  const platform = servicePlatform(env);
  if (platform === "darwin") return { cmd: "launchctl", args: ["bootout", `gui/${env.uid}/${LAUNCHD_LABEL}`] };
  if (platform === "linux") return { cmd: "systemctl", args: ["--user", "stop", SYSTEMD_UNIT] };
  if (platform === "win32" && env.node && env.root) return { cmd: env.node, args: supervisorArgs({ root: env.root }, "stop") };
  return null;
}
// On Windows, start clears the stop request's mark and runs the task.
export function startCommand(env: Pick<ServiceEnv, "platform" | "systemd" | "wsl" | "uid" | "home"> & WinRunner): Command | null {
  const platform = servicePlatform(env);
  if (platform === "darwin") return { cmd: "launchctl", args: ["bootstrap", `gui/${env.uid}`, launchdPaths(env.home).plist] };
  if (platform === "linux") return { cmd: "systemctl", args: ["--user", "start", SYSTEMD_UNIT] };
  if (platform === "win32" && env.node && env.root) return { cmd: env.node, args: supervisorArgs({ root: env.root }, "start") };
  return null;
}
// Whether `pnpm service:install` left a service here (its plist, unit file or task XML exists).
export function serviceInstalled(env: Pick<ServiceEnv, "platform" | "systemd" | "wsl" | "home" | "localAppData">, exists: (p: string) => boolean = existsSync): boolean {
  const platform = servicePlatform(env);
  if (platform === "darwin") return exists(launchdPaths(env.home).plist);
  if (platform === "linux") return exists(systemdPath(env.home));
  if (platform === "win32") return exists(windowsPaths(env).task);
  return false;
}

export type ServiceIo = {
  mkdir: (dir: string) => void;
  write: (file: string, content: string, encoding?: "utf8" | "utf16le") => void;
  remove: (file: string) => void;
  // Runs a command; throws when it exits non-zero.
  run: (cmd: string, args: string[]) => void;
};

// Carries a plan out. A command marked ignoreFailure may fail (unloading what is not loaded); any other stops here.
export function applyPlan(plan: ServicePlan, io: ServiceIo): void {
  const run = (c: Command) => {
    try {
      io.run(c.cmd, c.args);
    } catch (e) {
      if (!c.ignoreFailure) throw e;
    }
  };
  for (const d of plan.dirs) io.mkdir(d);
  for (const f of plan.files) io.write(f.path, f.content, f.encoding);
  plan.commands.forEach(run);
  for (const f of plan.remove) io.remove(f);
  plan.after.forEach(run);
}

// The PATH a service gets: the installer's, without the node_modules/.bin folders pnpm adds while a script runs.
export function servicePath(current: string, delimiter = ":"): string {
  const parts = current.split(delimiter).filter((p) => p && !/node_modules[\\/]\.bin/.test(p));
  return [...new Set(parts)].join(delimiter);
}

// The real machine, for the scripts: systemd is running (sd_booted) and whether this Linux is WSL.
export function detectSystem(platform: NodeJS.Platform = process.platform): { systemd: boolean; wsl: boolean } {
  if (platform !== "linux") return { systemd: false, wsl: false };
  let wsl = false;
  try {
    wsl = /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    wsl = false;
  }
  return { systemd: existsSync("/run/systemd/system"), wsl };
}
