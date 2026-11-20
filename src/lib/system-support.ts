// PLA-I2-4: which machine-bound parts can work on this system. Where a needed program is absent the part says
// «No disponible en este sistema» (ui/src/lib/sistema.ts) instead of failing. Porting them is PLA-I2-19.
//   test_copy   the test copy and Máquinas' test run: /bin/sh and process groups on macOS and Linux; cmd.exe and
//               taskkill on native Windows (PLA-I2-19, audit B5: src/lib/proc-tree.ts)
//   stills      the Ventana's stills, QA's captures and El Probador's pictures: Chrome or Chromium
//   base_lever  Máquinas' base lever: `brew services`, or on Linux `systemctl --user` (PLA-I2-19)
// Read once per process (the programs do not come and go while the server runs); tests replace the answer.
import { existsSync } from "node:fs";
import { findChrome } from "../captures/chrome.js";
import { commandPath } from "../jobs/machine/run.js";
import { NO_DISPONIBLE, NO_DISPONIBLE_POR, type SystemFeature } from "../../ui/src/lib/sistema.js";
import { findOnPath, type Exists } from "./claude-bin.js";

export { NO_DISPONIBLE, NO_DISPONIBLE_POR, type SystemFeature };

export type SupportDeps = { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; exists?: Exists; chrome?: () => string | null };

// null when the part can work here, else what is missing (English, for the log).
export function missingFor(feature: SystemFeature, deps: SupportDeps = {}): string | null {
  const platform = deps.platform ?? process.platform;
  const exists = deps.exists ?? existsSync;
  const env = deps.env ?? process.env;
  switch (feature) {
    case "test_copy":
      if (platform === "win32") return null;
      return exists("/bin/sh") ? null : "/bin/sh";
    case "stills":
      return (deps.chrome ? deps.chrome() : findChrome(env, exists)) ? null : "Chrome or Chromium";
    case "base_lever": {
      const has = (name: string) => !!findOnPath(name, { ...env, PATH: commandPath(env.PATH ?? "") }, exists, platform);
      if (has("brew")) return null;
      return platform === "linux" ? (has("systemctl") ? null : "brew or systemctl") : "brew";
    }
  }
}

let override: ((f: SystemFeature) => boolean) | null = null;
const cache = new Map<SystemFeature, boolean>();

export function supported(feature: SystemFeature): boolean {
  if (override) return override(feature);
  // Tests (test/helpers.ts useTestEnv) behave as on a Mac with everything installed unless a test decides otherwise.
  if (process.env.PLANIA_TEST_SYSTEM_SUPPORT === "all") return true;
  let ok = cache.get(feature);
  if (ok === undefined) {
    const missing = missingFor(feature);
    ok = missing === null;
    if (!ok) console.log(`[system] ${feature}: not available on this system (missing ${missing})`);
    cache.set(feature, ok);
  }
  return ok;
}

// Tests: decide what this system has (null goes back to looking).
export function useSystemSupport(fn: ((f: SystemFeature) => boolean) | null): void {
  override = fn;
  cache.clear();
}
