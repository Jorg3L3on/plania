// Do acknowledged UPDATES of one record survive an engine kill -9? (The evaluation measured inserts.)
//   pnpm exec tsx spike/devva-commit-log/src/probe-update-durability.ts [upsert|set] [kill|restart]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { type Client, connect } from "../vendor/xyzdb/dist/src/index.js";

const CONTAINER = process.env.SPIKE_CONTAINER ?? "plania-devva-spike-engine-1";
const PORT = Number(process.env.SPIKE_PORT ?? 2511);
const how = process.argv[2] ?? "upsert";
const stop = process.argv[3] ?? "kill";
process.env.DEVVA_TOKEN = process.env.XYZDB_TOKEN = readFileSync(path.resolve(import.meta.dirname, "..", ".token"), "utf8").trim();
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function open(): Promise<Client> {
  for (let i = 0; ; i++) {
    try {
      const db = await connect("127.0.0.1", PORT, 15_000);
      await db.listLobes();
      return db;
    } catch (e) {
      if (i > 40) throw e;
      await sleep(500);
    }
  }
}

const lobe = `dur_${how}_${Date.now().toString(36)}`;
let db = await open();
await db.createLobe(lobe);
if (process.env.SPIKE_GRAVITY) await db.gravityBy("g", lobe);
await db.createAnchor("id", lobe);
await db.execute(`PUT {id: $id, g: $g, seq: $seq} IN "${lobe}"`, { id: "mark", g: "bucket-1", seq: 0 });

let acked = 0;
let running = true;
const writer = (async () => {
  for (let n = 1; running; n++) {
    try {
      if (how === "set") await db.execute(`SET "${lobe}" seq = $seq WHERE id = $id`, { id: "mark", seq: n });
      else await db.execute(`PUT {id: $id, seq: $seq} IN "${lobe}" ON CONFLICT UPDATE`, { id: "mark", seq: n });
      acked = n;
    } catch {
      return;
    }
  }
})();

await sleep(Number(process.argv[4] ?? 4000));
if (stop === "kill") docker("kill", "-s", "KILL", CONTAINER);
else {
  running = false;
  await writer;
  console.log(`read before stop: ${(await db.find(lobe, { id: "mark" }).one())?.getNumber("seq")} (acknowledged ${acked})`);
  docker("stop", CONTAINER);
}
await writer;
running = false;
docker("start", CONTAINER);
db = await open();
const stored = (await db.find(lobe, { id: "mark" }).one())?.getNumber("seq");
const copies = (await db.scan(lobe).records()).length;
console.log(`${process.env.SPIKE_GRAVITY ? "gravity lobe" : "plain lobe"} / ${how} / ${stop}: last acknowledged ${acked}, stored after restart ${stored}, copies ${copies}  ->  ${stored !== undefined && stored >= acked ? "OK" : `LOST ${acked - (stored ?? 0)} acknowledged updates`}`);
await db.purge(lobe);
db.close();
