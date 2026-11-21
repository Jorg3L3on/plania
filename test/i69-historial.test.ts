// PLA-I69-6: Marca → Historial. The logo's, the style's and the voice's versions and Marca's requests in one list;
// going back makes a new version.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i69h-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const hist = await import("../src/brand/historial.js");
const style = await import("../src/brand/style.js");
const voz = await import("../src/brand/voz.js");
const { stageUpload, useUpload } = await import("../src/brand/upload.js");
const { makeDb } = await import("../src/db/client.js");
const ui = await import("../ui/src/lib/historial.js");

const ACTOR = { agent: "test", session_id: "s-i69h" } as never;
const tile = (fill: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${fill}"/></svg>`), { density: 600 }).resize(1024, 1024).png().toBuffer();
const git: import("../src/brand/logos.js").Git = async () => ({ code: 1, stdout: Buffer.alloc(0) });

let raw: Awaited<ReturnType<typeof resetTestDb>>;
let db: ReturnType<typeof makeDb>["db"];
let project: import("../src/db/schema.js").Project;
before(async () => {
  raw = await resetTestDb();
  db = makeDb().db;
});
after(async () => {
  await raw.end();
  rmSync(STORE, { recursive: true, force: true });
});
beforeEach(async () => {
  style.forgetStyle();
  rmSync(path.join(STORE, "_marca", "tienda"), { recursive: true, force: true });
  await raw.query("delete from project_logos");
  await raw.query("delete from tasks where project_id in (select id from projects where slug = 'tienda')");
  await raw.query("delete from projects where slug = 'tienda'");
  await raw.query("insert into projects (slug, title, key_prefix, settings) values ('tienda', 'Tienda', 'TND', '{\"local\":{\"repo_path\":\"/nowhere\"}}'::jsonb)");
  project = (await raw.query("select * from projects where slug = 'tienda'")).rows[0];
});

// PLA-130: these tests save one change at a time, as if minutes apart (merging is tested in pla-130-versions).
{ let t = Date.parse("2026-11-20T09:00:00Z"); (await import("../src/brand/versions.js")).setVersionClock(() => (t += 3 * 60_000)); }
test("#1 one history: logo, style and voice versions with their values, and the requests by kind", async () => {
  for (const c of ["#8c2f39", "#0f766e"]) {
    const s = await stageUpload("tienda", await tile(c), `${c.slice(1)}.png`);
    await useUpload(db, project, { up: s.up, name: s.name, scale: 100, bg: null }, ACTOR);
  }
  await style.saveStyle(db, "tienda", { radius: 4 });
  await style.saveStyle(db, "tienda", { radius: 16, head: "Lora" });
  await voz.saveVoice(db, "tienda", { trato: "usted" });
  const pid = project.id;
  for (const [key, scope] of [["TND-1", "<!-- plania:marca set=0123456789abcdef rows=ico -->"], ["TND-2", "<!-- plania:marca-estilo set=0123456789abcdef -->"], ["TND-3", "<!-- plania:marca-nombre set=0123456789abcdef -->"], ["TND-4", "nothing of Marca"]])
    await raw.query("insert into tasks (project_id, key, kind, title, status, scope, version) values ($1, $2, 'ticket', $2, 'Ready', $3, 1)", [pid, key, scope]);
  const h = (await hist.historialOf(db, "tienda"))!;
  assert.equal(h.logo.length, 2);
  assert.deepEqual(h.style.map((s) => [s.v, s.current, s.style.radius]), [[2, true, 16], [1, false, 4]]);
  assert.equal(h.voice[0]!.voice.trato, "usted");
  assert.deepEqual(h.requests.map((r) => [r.key, r.kind]).sort(), [["TND-1", "caras"], ["TND-2", "estilo"], ["TND-3", "nombre"]]);
  const all = ui.entries(h as never);
  assert.equal(all.length, 2 + 2 + 1 + 3);
  assert.ok(all.every((e, i) => i === 0 || all[i - 1]!.at >= e.at), "newest first");
  // PLA-130: Trato lives in Estilo, so its changes list under the Estilo filter too.
  assert.deepEqual(ui.entries(h as never, "estilo").filter((e) => e.lane === "estilo").map((e) => e.id), ["estilo-2", "estilo-1"]);
  assert.ok(ui.entries(h as never, "estilo").some((e) => e.lane === "voz"));
  const diff = ui.styleDiff(h.style[1]!.style as never, h.style[0]!.style as never);
  assert.deepEqual(diff.map((d) => d.k).sort(), ["head", "radius"]);
  assert.deepEqual(diff.find((d) => d.k === "radius"), { k: "radius", from: "16", to: "4" });
  void git;
});

test("#2 going back to a style version keeps every version and adds one", async () => {
  await style.saveStyle(db, "tienda", { radius: 4 });
  await style.saveStyle(db, "tienda", { radius: 16 });
  await style.goBackStyle(db, "tienda", 1);
  const h = (await hist.historialOf(db, "tienda"))!;
  assert.deepEqual(h.style.map((s) => [s.v, s.current, s.style.radius]), [[3, true, 4], [2, false, 16], [1, false, 4]]);
});
