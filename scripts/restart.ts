// PLA-53: pnpm server:restart — restarts the Plania server (launchd, com.plania.server) only when nothing it would kill is
// in flight. --check lists and exits (1 when something is in flight); --force restarts anyway.
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { parseArgs } from "node:util";
import { closeStore, withDb } from "../src/db/client.js";
import { inFlight } from "../src/ops/in-flight.js";

const { values } = parseArgs({ options: { check: { type: "boolean", default: false }, force: { type: "boolean", default: false } }, strict: true });
// The store replays the commit log when it opens, so it sees what the running server committed.
const found = await withDb((db) => inFlight(db));
await closeStore().catch(() => undefined);
if (found.length) {
  console.log(`En curso (${found.length}):`);
  for (const f of found) console.log(`  - ${f.text}`);
} else console.log("Nada en curso.");
if (values.check) process.exit(found.length ? 1 : 0);
if (found.length && !values.force) {
  console.log("No se reinició: un reinicio corta ese trabajo. Espera a que termine, o usa --force.");
  process.exit(1);
}
execFileSync("launchctl", ["kickstart", "-k", `gui/${userInfo().uid}/com.plania.server`], { stdio: "inherit" });
console.log("Plania reiniciado.");
