// Probe: confirm the statement shapes the store relies on, against the live spike engine.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "../vendor/xyzdb/dist/src/index.js";

const here = path.resolve(import.meta.dirname, "..");
process.env.DEVVA_TOKEN = process.env.XYZDB_TOKEN = readFileSync(path.join(here, ".token"), "utf8").trim();

const db = await connect("127.0.0.1", 2511, 15_000);
const show = (label: string, v: unknown) => console.log(label, JSON.stringify(v)?.slice(0, 400));
const tryIt = async (label: string, fn: () => Promise<unknown>) => {
  try {
    show(`${label} ->`, await fn());
  } catch (e: any) {
    console.log(`${label} !! ${e?.code}: ${String(e?.message).slice(0, 300)}`);
  }
};

const L = `probe_${Date.now().toString(36)}`;
await tryIt("createLobe", () => db.createLobe(L));
await tryIt("gravityBy", () => db.gravityBy("project", L));
await tryIt("anchor", () => db.createAnchor("pk", L));
await tryIt("put params", () => db.execute(`PUT {pk: $pk, project: $p, n: $n, body: $b} IN "${L}"`, { pk: "t:1", p: "p1", n: 1, b: JSON.stringify({ a: 'x "q" \\ ; y', z: [1, 2] }) }));
await tryIt("put dup", () => db.execute(`PUT {pk: $pk, project: $p, n: $n} IN "${L}"`, { pk: "t:1", p: "p1", n: 2 }));
await tryIt("upsert", () => db.execute(`PUT {pk: $pk, project: $p, n: $n, extra: $x} IN "${L}" ON CONFLICT UPDATE`, { pk: "t:1", p: "p1", n: 3, x: null }));
await tryIt("upsert new", () => db.execute(`PUT {pk: $pk, project: $p, n: $n} IN "${L}" ON CONFLICT UPDATE`, { pk: "t:2", p: "p1", n: 7 }));
await tryIt("find", async () => (await db.find(L, { pk: "t:1" }).one())?.data);
await tryIt("find missing", async () => (await db.find(L, { pk: "nope" }).one())?.data ?? null);
await tryIt("scan bucket", async () => (await db.scan(L, { project: "p1" }).records()).map((r) => r.data));
await tryIt("delete", () => db.execute(`DELETE "${L}" WHERE pk = $pk`, { pk: "t:2" }));
await tryIt("delete again", () => db.execute(`DELETE "${L}" WHERE pk = $pk`, { pk: "t:2" }));
await tryIt("scan order", async () => (await db.scan(L, "n > 0").orderBy("n").limit(5).records()).map((r) => r.get("n")));
await tryIt("scan page", async () => {
  const rs = await db.scan(L).limit(1).records();
  return { n: rs.length, hasMore: rs.hasMore, cursor: Boolean(rs.cursor) };
});
await tryIt("purge", () => db.purge(L));
db.close();
