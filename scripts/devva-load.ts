// Loads one of the engine's own exports into an EMPTY engine: the restore of last resort.
//   pnpm devva:load plania_20261113
// The file is <engine data dir>/meta/dumps/<name>.jsonl on the engine named by DEVVA_HOST / DEVVA_PORT.
// The engine refuses when it holds any lobe or record, checks the whole file first, and applies all of it or
// nothing. Start plania afterwards; it replays its log and finds its projection where the export left it.
import { loadClient } from "../src/store/devva.js";

const name = process.argv[2];
if (!name || !/^[A-Za-z0-9_.]+$/.test(name)) {
  console.error("usage: pnpm devva:load <name>   (letters, digits, _ and .; no path, no .jsonl)");
  process.exit(2);
}
// A load declares every lobe and writes every record durably; give it ten minutes, not the usual 15 s.
const db = await (await loadClient({ prefix: "", timeoutMs: 600_000 }))();
try {
  const lobes = await db.listLobes();
  if (lobes.length > 0) {
    console.error(`this engine already declares ${lobes.length} lobes; a load needs an empty one`);
    process.exit(1);
  }
  const res = (await db.execute(`LOAD FROM "${name}"`)) as { info?: unknown };
  for (const line of Array.isArray(res.info) ? res.info : []) console.log(String(line));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  db.close();
}
