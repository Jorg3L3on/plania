// PLA-I2-4: a test that cannot run on this system skips with a sentence that says why, so the run's own output
// lists every skip and its reason (node:test prints `# SKIP <reason>`). Use it as the test's `skip` option:
//   test("…", { skip: needs({ posix: true, tools: ["lsof"] }) }, async () => { … })
import { existsSync } from "node:fs";
import { findOnPath } from "../src/lib/claude-bin.js";

export type Needs = {
  // File modes, process groups, /bin/sh: macOS and Linux (and WSL), never native Windows.
  posix?: boolean;
  // Programs that must be on PATH (lsof, ps, security, gitleaks…).
  tools?: string[];
  // Only on these systems (for example ["darwin"] for the keychain).
  platforms?: NodeJS.Platform[];
};

// false when the test can run, else the reason, one sentence.
export function needs(n: Needs, o: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; exists?: (p: string) => boolean } = {}): string | false {
  const platform = o.platform ?? process.platform;
  if (n.platforms && !n.platforms.includes(platform)) return `runs only on ${n.platforms.join(", ")}; this is ${platform}`;
  if (n.posix && platform === "win32") return "needs POSIX file modes, process groups and /bin/sh, which native Windows lacks";
  const missing = (n.tools ?? []).filter((t) => !findOnPath(t, o.env ?? process.env, o.exists ?? existsSync, platform));
  if (missing.length) return `needs ${missing.join(", ")} on PATH, not found on this system`;
  return false;
}
