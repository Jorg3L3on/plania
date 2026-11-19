// PLA-I2-17: Plania as a service on the buyer's machine, started at login and restarted when it crashes.
//   macOS: a launchd agent, ~/Library/LaunchAgents/com.plania.server.plist, logs in ~/Library/Logs/plania/.
//   Linux: a systemd user unit, ~/.config/systemd/user/plania.service, logs in the user journal
//          (journalctl --user -u plania) and ~/.local/state/plania/server.log. WSL counts as Linux when systemd is on there; when it is off the
//          command says how to turn it on and changes nothing.
//   Windows outside WSL is not supported: the command says so and changes nothing.
// Every outside call (the commands, the file writes, the platform) is injected; scripts/service.ts passes the real
// ones and test/release-pack.test.ts asserts the files and the commands.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineWords, say } from "../words.js";

export const LAUNCHD_LABEL = "com.plania.server";
export const SYSTEMD_UNIT = "plania.service";

export type ServicePlatform = "darwin" | "linux" | "wsl-no-systemd" | "unsupported";

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
};

export type Command = { cmd: string; args: string[]; ignoreFailure?: boolean };
export type FileWrite = { path: string; content: string };
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
export function serverArgs(env: Pick<ServiceEnv, "root" | "node" | "port">): string[] {
  return [env.node, `--env-file=${path.posix.join(env.root, ".env")}`, "--import", "tsx", path.posix.join(env.root, "scripts/dev.ts"), "--port", String(env.port)];
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
const sdQuote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;

export function systemdUnit(env: ServiceEnv): string {
  return `[Unit]
Description=Plania
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${sdQuote(env.root)}
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
    unsupported: ["Plania se instala como servicio en macOS y en Linux. En Windows, úsala dentro de WSL con systemd encendido."],
    installed: (atBoot: boolean) => `Plania quedó como servicio: arranca al entrar a tu sesión${atBoot ? " (y al encender la máquina)" : ""} y se reinicia si se cae.`,
    open: (port: number, log: string) => `Abre http://localhost:${port}. Lo que escribe queda en ${log}.`,
    removedMac: "Plania ya no es un servicio: no arranca sola. Los datos y los registros quedan donde estaban.",
    removedLinux: "Plania ya no es un servicio: no arranca sola. Los datos quedan donde estaban.",
  },
  en: {
    wsl: [
      "This machine is Linux inside Windows (WSL) and systemd is not on, so Plania cannot run as a service.",
      "To turn it on: add these two lines to /etc/wsl.conf, run «wsl --shutdown» in Windows and open WSL again:",
      "  [boot]",
      "  systemd=true",
      "Then run pnpm service:install again. Meanwhile, start Plania by hand with pnpm start.",
    ],
    unsupported: ["Plania installs as a service on macOS and Linux. On Windows, use it inside WSL with systemd on."],
    installed: (atBoot: boolean) => `Plania is now a service: it starts when you log in${atBoot ? " (and when the machine starts)" : ""} and restarts if it crashes.`,
    open: (port: number, log: string) => `Open http://localhost:${port}. What it writes goes to ${log}.`,
    removedMac: "Plania is no longer a service: it does not start on its own. The data and the logs stay where they were.",
    removedLinux: "Plania is no longer a service: it does not start on its own. The data stays where it was.",
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
  return { ...base, lines: otherLines(platform) };
}

// The restart a deploy needs: the service manager stops the server (which drains) and starts it again.
export function restartCommand(env: Pick<ServiceEnv, "platform" | "systemd" | "wsl" | "uid">): Command | null {
  const platform = servicePlatform(env);
  if (platform === "darwin") return { cmd: "launchctl", args: ["kickstart", "-k", `gui/${env.uid}/${LAUNCHD_LABEL}`] };
  if (platform === "linux") return { cmd: "systemctl", args: ["--user", "restart", SYSTEMD_UNIT] };
  return null;
}

// PLA-I2-8: the update stops the service before it swaps the files and starts it after. Null where there is none.
export function stopCommand(env: Pick<ServiceEnv, "platform" | "systemd" | "wsl" | "uid">): Command | null {
  const platform = servicePlatform(env);
  if (platform === "darwin") return { cmd: "launchctl", args: ["bootout", `gui/${env.uid}/${LAUNCHD_LABEL}`] };
  if (platform === "linux") return { cmd: "systemctl", args: ["--user", "stop", SYSTEMD_UNIT] };
  return null;
}
export function startCommand(env: Pick<ServiceEnv, "platform" | "systemd" | "wsl" | "uid" | "home">): Command | null {
  const platform = servicePlatform(env);
  if (platform === "darwin") return { cmd: "launchctl", args: ["bootstrap", `gui/${env.uid}`, launchdPaths(env.home).plist] };
  if (platform === "linux") return { cmd: "systemctl", args: ["--user", "start", SYSTEMD_UNIT] };
  return null;
}
// Whether `pnpm service:install` left a service here (its plist or unit file exists).
export function serviceInstalled(env: Pick<ServiceEnv, "platform" | "systemd" | "wsl" | "home">, exists: (p: string) => boolean = existsSync): boolean {
  const platform = servicePlatform(env);
  if (platform === "darwin") return exists(launchdPaths(env.home).plist);
  if (platform === "linux") return exists(systemdPath(env.home));
  return false;
}

export type ServiceIo = {
  mkdir: (dir: string) => void;
  write: (file: string, content: string) => void;
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
  for (const f of plan.files) io.write(f.path, f.content);
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
