// PLA-I69-5, PLA-130: how the project addresses people (Estilo → Trato). It is kept with versions and becomes the
// one-line guide every run gets. Voz y nombre left Marca: tone, word lists, the expert's guide, the names and their
// request are gone; an older file that still holds them is read past.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i69v-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const voz = await import("../src/brand/voz.js");
const { makeDb } = await import("../src/db/client.js");

let raw: Awaited<ReturnType<typeof resetTestDb>>;
let db: ReturnType<typeof makeDb>["db"];
before(async () => {
  raw = await resetTestDb();
  db = makeDb().db;
});
after(async () => {
  await raw.end();
  rmSync(STORE, { recursive: true, force: true });
});
beforeEach(async () => {
  rmSync(path.join(STORE, "_marca", "tienda"), { recursive: true, force: true });
  await raw.query("delete from projects where slug = 'tienda'");
  await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
});

// PLA-130: these tests save one change at a time, as if minutes apart (merging is tested in pla-130-versions).
{ let t = Date.parse("2026-11-20T09:00:00Z"); (await import("../src/brand/versions.js")).setVersionClock(() => (t += 3 * 60_000)); }

test("#1 the guide is one line on how to address people, in each of the three ways", () => {
  assert.match(voz.guideOf({ trato: "tu" }), /tratándola de tú\./);
  assert.match(voz.guideOf({ trato: "usted" }), /tratándola de usted\./);
  assert.match(voz.guideOf({ trato: "vos" }), /tratándola de vos \(voseo\)\./);
  assert.equal(voz.guideOf({ trato: "usted" }).split("\n").length, 1);
});

test("#2 a sound voice keeps only the form of address; anything else, or a bad value, is dropped", () => {
  assert.deepEqual(voz.soundVoice({ trato: "vos" }, voz.START_VOICE), { trato: "vos" });
  assert.deepEqual(voz.soundVoice({ trato: "ustedes" as never }, { trato: "usted" }), { trato: "usted" });
  assert.deepEqual(voz.soundVoice({ trato: "usted", cerca: 90, name: "x", guide: "y" } as never, voz.START_VOICE), { trato: "usted" });
  assert.deepEqual(voz.soundVoice(null, voz.START_VOICE), { trato: "tu" });
});

test("#3 versions: saving, the same value is not a new one, going back is kept; the read and the run block", async () => {
  const first = (await voz.voiceRead(db, "tienda"))!;
  assert.deepEqual([first.voice, first.base, first.versions], [null, { trato: "tu" }, 0], "nothing chosen yet");
  assert.equal(voz.voiceBlock("tienda"), "", "no block while nothing is chosen");
  assert.equal((await voz.saveVoice(db, "tienda", { trato: "usted" }))!.versions, 1);
  assert.equal((await voz.saveVoice(db, "tienda", { trato: "usted" }))!.versions, 1, "the same value is not a new version");
  assert.equal((await voz.saveVoice(db, "tienda", { trato: "vos" }))!.versions, 2);
  const back = (await voz.goBackVoice(db, "tienda", 1))!;
  assert.deepEqual([back.versions, back.base.trato], [3, "usted"]);
  assert.ok(voz.voiceHistory("tienda")[0]!.current);
  assert.match(voz.voiceBlock("tienda"), /^## Cómo trata la app a la gente[^\n]*\n.*de usted\.$/);
  await assert.rejects(voz.goBackVoice(db, "tienda", 99), /version not found/);
  assert.equal(await voz.voiceRead(db, "nadie"), null);
});

test("#4 an older file with the removed fields still reads: the form of address is kept, the rest is dropped", async () => {
  const dir = path.join(STORE, "_marca", "tienda");
  mkdirSync(dir, { recursive: true });
  const old = { trato: "vos", cerca: 90, humor: 10, breve: 60, sencillo: 80, yes: ["pedido"], no: ["usuario"], guide: null, name: "Tienda", short: "Tienda", desc: "", tag: "" };
  writeFileSync(path.join(dir, "voice.json"), JSON.stringify({ current: 1, versions: [{ v: 1, at: "2026-11-19T10:00:00Z", voice: old }] }));
  assert.deepEqual(voz.voiceOf("tienda"), { trato: "vos" });
  assert.deepEqual(voz.voiceHistory("tienda")[0]!.voice, { trato: "vos" });
  assert.match(voz.voiceBlock("tienda"), /vos \(voseo\)/);
  assert.doesNotMatch(voz.voiceBlock("tienda"), /usuario|pedido/, "the removed word lists no longer reach runs");
  assert.deepEqual((await voz.saveVoice(db, "tienda", { trato: "usted" }))!.voice, { trato: "usted" });
});

test("#5 the screen's guide matches the server's", async () => {
  const ui = await import("../ui/src/lib/voz.js");
  const w = ui.vozWords();
  for (const trato of ["tu", "usted", "vos"] as const) assert.equal(ui.guideOf(w, { trato }), voz.guideOf({ trato }));
});
