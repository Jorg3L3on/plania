// PLA-I2-4: the one rule for which Claude Code binary Plania starts, shared by the runner (claudeCommand), the brief
// (commandOf), the readiness list and the machine check. In order: the variable an agent's adapter config names,
// CLAUDE_CODE_BIN, ~/.local/bin/claude (the native installer's place), then `claude` on PATH. Never run here.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type Exists = (p: string) => boolean;

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

const isPath = (cmd: string) => cmd.includes("/") || cmd.includes("\\");

// The first file named `name` in PATH's folders, as the shell would find it (PATHEXT on Windows). Null when none.
// PLA-I2-19 (audit B5): `runnable` on Windows skips a file without an extension (npm puts a POSIX `claude` script
// next to claude.cmd; Windows cannot start it), unless the name itself has one.
export function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  exists: Exists = existsSync,
  platform: NodeJS.Platform = process.platform,
  o: { runnable?: boolean } = {},
): string | null {
  const bare = !o.runnable || !!path.extname(name);
  const exts = platform === "win32" ? [...(bare ? [""] : []), ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)] : [""];
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (exists(p)) return p;
    }
  }
  return null;
}

export type ClaudeBinOptions = { commandEnv?: unknown; exists?: Exists; platform?: NodeJS.Platform };

// The command to spawn. A configured value is used as given (a bare name is found on PATH by spawn). With nothing
// configured: ~/.local/bin/claude when it is there, else the `claude` found on PATH, else the bare name, which the
// readiness list reports as missing.
export function resolveClaudeBin(env: NodeJS.ProcessEnv, o: ClaudeBinOptions = {}): string {
  const named = o.commandEnv;
  if (typeof named === "string" && ENV_NAME.test(named) && env[named]?.trim()) return env[named]!.trim();
  if (env.CLAUDE_CODE_BIN?.trim()) return env.CLAUDE_CODE_BIN.trim();
  const exists = o.exists ?? existsSync;
  // The native installer's claude.exe on Windows (PLA-I2-19).
  const local = path.join(env.HOME || homedir(), ".local", "bin", (o.platform ?? process.platform) === "win32" ? "claude.exe" : "claude");
  if (exists(local)) return local;
  return findOnPath("claude", env, exists, o.platform, { runnable: true }) ?? "claude";
}

// Whether the command resolves to a file: a path is looked at directly, a bare name is looked for on PATH.
export function claudeBinFound(cmd: string, env: NodeJS.ProcessEnv, exists: Exists = existsSync, platform: NodeJS.Platform = process.platform): boolean {
  return isPath(cmd) ? exists(cmd) : findOnPath(cmd, env, exists, platform, { runnable: true }) !== null;
}
