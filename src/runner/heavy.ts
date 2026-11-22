// PLA-I73-5: the heavy-work queue's PATH entries for a Taller run (src/runner/heavy-shim.mjs does the waiting).
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HEAVY_TOOLS = ["npm", "npx", "pnpm", "yarn"];
const SHIM = fileURLToPath(new URL("./heavy-shim.mjs", import.meta.url));

/** Heavy jobs at once on this machine: one per 3 GB above the 4 GB the system, Plania and the agents need. */
export const heavySlots = (memBytes: number = totalmem(), env: NodeJS.ProcessEnv = process.env): number =>
  Math.max(1, Number(env.PLANIA_HEAVY_SLOTS) || Math.floor((memBytes / 1024 ** 3 - 4) / 3));

/** Writes the wrappers (once) and returns the variables the run needs: its PATH first, the slots folder and count. */
export function heavyEnv(root: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Record<string, string> {
  if (platform === "win32" || env.PLANIA_HEAVY_QUEUE === "0") return {};
  const base = path.join(root, ".plania-heavy");
  const bin = path.join(base, "bin");
  mkdirSync(bin, { recursive: true });
  for (const t of HEAVY_TOOLS) {
    const file = path.join(bin, t);
    const body = `#!/bin/sh\nexec node "${SHIM}" ${t} "$@"\n`;
    if (!existsSync(file) || readFileSync(file, "utf8") !== body) {
      writeFileSync(file, body);
      chmodSync(file, 0o755);
    }
  }
  return { PATH: `${bin}${path.delimiter}${env.PATH ?? ""}`, PLANIA_HEAVY_DIR: path.join(base, "slots"), PLANIA_HEAVY_SLOTS: String(heavySlots(totalmem(), env)), PLANIA_HEAVY_BIN: bin };
}
