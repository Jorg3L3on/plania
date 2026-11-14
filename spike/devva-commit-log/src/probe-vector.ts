// Probe: a vector lobe bucketed by project, written with bound params, searched with NEAREST.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "../vendor/xyzdb/dist/src/index.js";

const here = path.resolve(import.meta.dirname, "..");
process.env.DEVVA_TOKEN = process.env.XYZDB_TOKEN = readFileSync(path.join(here, ".token"), "utf8").trim();
const embed = async (texts: string[]): Promise<number[][]> => ((await (await fetch("http://127.0.0.1:8091/embed_batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texts }) })).json()) as { vecs: number[][] }).vecs;

const db = await connect("127.0.0.1", 2511, 15_000);
const L = `vec_${Date.now().toString(36)}`;
await db.createLobe(L);
await db.gravityBy("scope", L);
await db.createAnchor("pk", L);
console.log("vector:", JSON.stringify(await db.createVector("emb", L, { embedder: "potion-multilingual-128M", revision: "sextant-i8", runtime: "cpu" })));
const docs = [
  ["p1", "t1", "Migrar la base de datos de Postgres a devva"],
  ["p1", "t2", "Arreglar el boton de login en la pantalla"],
  ["p1", "t3", "Backups nocturnos y prueba de restauracion"],
  ["p2", "t4", "Mover el almacenamiento a otro motor de datos"],
] as const;
const vecs = await embed(docs.map((d) => d[2]));
for (const [i, [scope, pk, text]] of docs.entries()) {
  try {
    console.log("put", pk, JSON.stringify(await db.execute(`PUT {pk: $pk, scope: $scope, text: $text, emb: $emb} IN "${L}"`, { pk, scope, text, emb: vecs[i] })).slice(0, 90));
  } catch (e: any) {
    console.log("put FAILED", pk, e.code, String(e.message).slice(0, 200));
  }
}
const [q] = await embed(["cambiar de base de datos"]);
const hits = await db.scan(L, { scope: "p1" }).nearest("emb", q!, 3, "cosine").records();
console.log("budgetStop", hits.budgetStop, "raw keys", Object.keys(hits.raw()));
for (const h of hits) console.log(" hit", JSON.stringify({ ...h.data, emb: undefined }).slice(0, 220));
console.log("statement:", db.scan(L, { scope: "p1" }).nearest("emb", [0.5, 0.25], 3, "cosine").statement().slice(0, 120));
// replace one: delete then insert
await db.execute(`DELETE "${L}" WHERE pk = $pk`, { pk: "t2" });
const [v2] = await embed(["Cambiar el motor de base de datos por devva"]);
await db.execute(`PUT {pk: $pk, scope: $scope, text: $text, emb: $emb} IN "${L}"`, { pk: "t2", scope: "p1", text: "replaced", emb: v2 });
console.log("after replace:", (await db.scan(L, { scope: "p1" }).nearest("emb", q!, 3, "cosine").records()).map((h) => h.getString("pk")).join(","));
await db.purge(L);
db.close();
