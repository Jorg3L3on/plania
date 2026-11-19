// PLA-53: pnpm server:restart — restarts the Plania server only when nothing it would kill is in flight. --check lists
// and exits (1 when something is in flight); --force restarts anyway.
// PLA-I2-17: the service is launchd's com.plania.server on macOS or the systemd user unit plania.service on Linux
// (src/packaging/service.ts restartCommand). PLA-I2-19: on Windows, the Scheduled Task «Plania»'s supervisor.
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { parseArgs } from "node:util";
import { makeDb, resetPool } from "../src/db/client.js";
import { inFlight } from "../src/ops/in-flight.js";
import { detectSystem, restartCommand } from "../src/packaging/service.js";
import { lastGoodFile, readLastGood, restartWithFallback } from "../src/ops/last-good.js";
import { isPackage, readRelease, ROOT_DIR } from "../src/release.js";

const { values } = parseArgs({ options: { check: { type: "boolean", default: false }, force: { type: "boolean", default: false } }, strict: true });
const found = await inFlight(makeDb().db);
await resetPool().catch(() => undefined);
if (found.length) {
  console.log(`En curso (${found.length}):`);
  for (const f of found) console.log(`  - ${f.text}`);
} else console.log("Nada en curso.");
if (values.check) process.exit(found.length ? 1 : 0);
if (found.length && !values.force) {
  console.log("No se reinició: un reinicio corta ese trabajo. Espera a que termine, o usa --force.");
  process.exit(1);
}
// PLA-I2-19: on Windows the supervisor's restart request runs with this Node and package.
const restart = restartCommand({ platform: process.platform, uid: userInfo().uid, ...detectSystem(), node: process.execPath, root: ROOT_DIR });
if (!restart) {
  console.log("Plania no corre como servicio en esta máquina: deténla y vuelve a encenderla con pnpm start.");
  process.exit(1);
}
// PLA-I2-9: wait for the server to report what the folder holds; a commit that does not come up goes back to the
// last one that did (recorded by scripts/dev.ts after a good start).
const port = Number(process.env.PLANIA_PORT) || 3737;
const git = (args: string[]) => execFileSync("git", args, { cwd: ROOT_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const out = await restartWithFallback({
  restart: () => execFileSync(restart.cmd, restart.args, { stdio: "inherit", cwd: ROOT_DIR }),
  health: async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health/ui`, { signal: AbortSignal.timeout(3_000) }).catch(() => null);
    if (!r?.ok) return null;
    const b = (await r.json().catch(() => null)) as { version?: { version?: string; commit?: string | null } } | null;
    return b ? { commit: b.version?.commit ?? null, version: b.version?.version ?? null } : null;
  },
  head: () => readRelease(ROOT_DIR).commit,
  version: () => readRelease(ROOT_DIR).version,
  packaged: isPackage(ROOT_DIR),
  lastGood: () => readLastGood(lastGoodFile()),
  checkout: (commit) => {
    try {
      git(["checkout", "--detach", commit]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.split("\n")[0]! : String(e) };
    }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});
for (const line of out.lines) console.log(line);
process.exit(out.status === "up" ? 0 : 1);
