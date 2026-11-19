// PLA-I2-4: where run logs and a run's temporary files go, in the system's own places. One helper for the runner
// and the brief.
//   macOS:  logs ~/Library/Logs/plania-runs (as before), temp <os tmpdir>/plania-runs
//   Linux:  logs $XDG_STATE_HOME/plania/runs (default ~/.local/state), temp $XDG_CACHE_HOME/plania/runs
//           (default ~/.cache)
//   other:  logs and temp under the OS temp folder
// The brief keeps its temp files beside the runs' (plania-brief), never inside them.
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const home = (env: NodeJS.ProcessEnv) => env.HOME || homedir();

// An XDG variable counts only when it is an absolute path (the spec says to ignore a relative one).
const xdg = (env: NodeJS.ProcessEnv, name: string, fallback: string[]) => {
  const v = env[name]?.trim();
  return v && path.isAbsolute(v) ? v : path.join(home(env), ...fallback);
};

export function defaultRunLogDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return path.join(home(env), "Library", "Logs", "plania-runs");
  if (platform === "linux") return path.join(xdg(env, "XDG_STATE_HOME", [".local", "state"]), "plania", "runs");
  return path.join(tmpdir(), "plania-run-logs");
}

export function defaultRunTmpDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "linux") return path.join(xdg(env, "XDG_CACHE_HOME", [".cache"]), "plania", "runs");
  return path.join(tmpdir(), "plania-runs");
}

export function defaultBriefTmpDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "linux") return path.join(xdg(env, "XDG_CACHE_HOME", [".cache"]), "plania", "brief");
  return path.join(tmpdir(), "plania-brief");
}
