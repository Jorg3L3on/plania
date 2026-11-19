// PLA-I2-19 (audit B5): starting a shell command and stopping a whole process tree, on macOS, Linux and native Windows.
//   macOS, Linux: `/bin/sh -c <command>`, detached so the child leads its own process group; a stop signals the group
//                 (negative pid), which takes the grandchildren with it. Unchanged from before.
//   Windows:      `cmd.exe /d /s /c "<command>"` (what Node's own `shell: true` runs), hidden; Windows has no process
//                 groups or signals, so a stop is `taskkill /T /F /PID <pid>`: the tree, at once. Any signal but 0
//                 stops for good (Node itself turns SIGINT, SIGTERM and SIGKILL into TerminateProcess there).
import { spawn, type SpawnOptions } from "node:child_process";

export type ShellCommand = { file: string; args: string[]; options: Pick<SpawnOptions, "windowsVerbatimArguments" | "windowsHide"> };

// The program and arguments that run `command` through the system's shell.
export function shellCommand(command: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): ShellCommand {
  if (platform === "win32") {
    return { file: env.ComSpec || env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", `"${command}"`], options: { windowsVerbatimArguments: true, windowsHide: true } };
  }
  return { file: "/bin/sh", args: ["-c", command], options: {} };
}

export type KillTreeDeps = {
  platform?: NodeJS.Platform;
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
  // Windows: runs taskkill; fire and forget (a pid already gone makes it fail, which is fine).
  taskkill?: (args: string[]) => void;
};

const defaultTaskkill = (args: string[]) => {
  try {
    const child = spawn("taskkill", args, { stdio: "ignore", windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // taskkill missing: nothing else can stop the tree
  }
};

// Stops pid and everything it started. On macOS and Linux pid must lead its process group (spawned detached).
export function killTree(pid: number, signal: NodeJS.Signals, deps: KillTreeDeps = {}): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const kill = deps.kill ?? ((p: number, s: NodeJS.Signals | 0) => process.kill(p, s));
  if ((deps.platform ?? process.platform) === "win32") {
    (deps.taskkill ?? defaultTaskkill)(["/T", "/F", "/PID", String(pid)]);
    return;
  }
  try {
    kill(-pid, signal);
  } catch {
    try {
      kill(pid, signal);
    } catch {
      // already gone
    }
  }
}
