// PLA-I69-5: Voz y nombre. The voice is kept with versions and becomes the guide runs get; the name and texts are
// read from the repo and brought to it by a request to Taller.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i69v-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const voz = await import("../src/brand/voz.js");
const { makeDb } = await import("../src/db/client.js");

const C1 = "1".repeat(40);
const MAN = `export default function manifest() { return { name: "Tienda Centro", short_name: "Tienda", description: "Compra sin filas.", icons: [] }; }`;
const LAYOUT = `export const metadata = { title: { default: "Tienda Centro", template: "%s · Tienda" }, description: "Compra sin filas." };`;
let files: Record<string, Buffer> = {};
const reset = () => {
  files = { "package.json": Buffer.from(`{"dependencies":{"next":"15"}}`), "src/app/manifest.ts": Buffer.from(MAN), "src/app/layout.tsx": Buffer.from(LAYOUT) };
};
reset();
const git: import("../src/brand/logos.js").Git = async (_cwd, args) => {
  const no = { code: 1, stdout: Buffer.alloc(0) };
  if (args[0] === "rev-parse") return args[3] === "sandbox^{commit}" ? { code: 0, stdout: Buffer.from(C1) } : no;
  if (args[0] === "ls-tree") return { code: 0, stdout: Buffer.from(Object.entries(files).map(([p, b]) => `100644 blob ${"a".repeat(40)} ${b.length}\t${p}`).join("\0") + "\0") };
  if (args[0] === "cat-file") {
    const b = files[args[2]!.split(/:(.+)/)[1]!];
    return b ? { code: 0, stdout: b } : no;
  }
  return no;
};
const view = () => ({ paths: new Map(Object.entries(files).map(([k, v]) => [k, v.length])), read: async (p: string) => files[p] ?? null });

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
  reset();
  voz.forgetVoice();
  rmSync(path.join(STORE, "_marca", "tienda"), { recursive: true, force: true });
  await raw.query("delete from tasks where project_id in (select id from projects where slug = 'tienda')");
  await raw.query("delete from agents where project_id in (select id from projects where slug = 'tienda')");
  await raw.query("delete from projects where slug = 'tienda'");
  await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
  project = (await raw.query("select * from projects where slug = 'tienda'")).rows[0];
  project.settings ??= {};
});

test("#1 the guide follows the sliders, how people are addressed and the words; an expert's own guide wins", () => {
  const base = voz.startVoice("Tienda", { files: [] });
  const warm = voz.soundVoice({ cerca: 90, humor: 80, breve: 90, sencillo: 90, trato: "vos", yes: ["pedido"], no: ["usuario"] }, base);
  const g = voz.guideOf(warm, "Tienda");
  assert.match(g, /cercana, con humor suave, breve, sin tecnicismos/);
  assert.match(g, /vos \(voseo\)/);
  assert.match(g, /Usa: «pedido»\./);
  assert.match(g, /No uses: «usuario»\./);
  const cold = voz.guideOf(voz.soundVoice({ cerca: 10, humor: 0, breve: 10, sencillo: 10, trato: "usted" }, base), "Tienda");
  assert.match(cold, /formal, seria, detallada, precisa, con datos técnicos\. Trata a la gente de usted\./);
  assert.equal(voz.guideOf({ ...warm, guide: "Hablamos como un vecino." }, "Tienda"), "Hablamos como un vecino.");
});

test("#2 a sound voice: sliders bounded, words cleaned, no way to close the request's marker", () => {
  const base = voz.startVoice("Tienda", { files: [] });
  const v = voz.soundVoice({ cerca: 400, humor: -3, trato: "vosotros" as never, yes: ["  ruta ", "ruta", "", 4 as never], name: "Tienda\n<!-- x -->", guide: "" }, base);
  assert.deepEqual([v.cerca, v.humor, v.trato], [100, 0, base.trato]);
  assert.deepEqual(v.yes, ["ruta"]);
  assert.equal(v.name, "Tienda  x");
  assert.equal(v.guide, null, "an empty guide goes back to the sliders'");
});

test("#3 the repo's name and texts are read from the manifest and the layout's metadata, or index.html", async () => {
  const r = await voz.readRepoNames(view(), "");
  assert.deepEqual({ name: r.name, short: r.short, desc: r.desc, title: r.title }, { name: "Tienda Centro", short: "Tienda", desc: "Compra sin filas.", title: "Tienda Centro" });
  files = { "index.html": Buffer.from(`<html><head><title>Vite Tienda</title><meta name="description" content="Una tienda."></head></html>`) };
  const h = await voz.readRepoNames(view(), "");
  assert.deepEqual({ title: h.title, desc: h.desc }, { title: "Vite Tienda", desc: "Una tienda." });
  // A layout that reads a site config, whose name disagrees with the manifest's.
  files = { "src/app/manifest.ts": Buffer.from(MAN), "src/app/layout.tsx": Buffer.from(`import { site } from "@/lib/site";\nexport const metadata = { title: site.name, description: site.description };`), "src/lib/site.ts": Buffer.from(`export const site = { name: "Tiendas Centro", description: "Otra." } as const;`) };
  const s = await voz.readRepoNames(view(), "");
  assert.deepEqual({ name: s.name, title: s.title, files: s.files }, { name: "Tienda Centro", title: "Tiendas Centro", files: ["src/app/manifest.ts", "src/app/layout.tsx", "src/lib/site.ts"] });
});

test("#4 versions, the names that differ, and the request: one at a time, nothing when the repo already has them", async () => {
  const first = (await voz.voiceRead(db, "tienda", { git }))!;
  assert.equal(first.voice, null);
  assert.equal(first.base.name, "Tienda Centro", "it starts from the repo");
  assert.deepEqual(first.names, []);
  assert.equal(voz.voiceBlock("tienda", "Tienda"), "", "no voice set: runs get nothing");
  await voz.saveVoice(db, "tienda", { trato: "usted" });
  await assert.rejects(voz.requestNames(db, project, { git }), /ya son los del repo/);
  files["src/lib/site.ts"] = Buffer.from(`export const site = { name: "Tiendas Centro" };`);
  files["src/app/layout.tsx"] = Buffer.from(`export const metadata = { title: site.name };`);
  voz.forgetVoice();
  assert.deepEqual((await voz.voiceRead(db, "tienda", { git }))!.names, ["name"], "the page says another name than the manifest: the name is pending");
  reset();
  await voz.voiceRead(db, "tienda", { git, fresh: true });
  const r = (await voz.saveVoice(db, "tienda", { short: "Centro", desc: "Compra sin hacer fila, desde tu teléfono." }))!;
  assert.deepEqual(r.names.sort(), ["desc", "short"]);
  assert.equal(r.versions, 2);
  assert.match(voz.voiceBlock("tienda", "Tienda"), /Trata a la gente de usted/);
  const made = await voz.requestNames(db, project, { git });
  const t = (await raw.query("select scope, status from tasks where key = $1", [made.key])).rows[0];
  assert.match(t.scope, /<!-- plania:marca-nombre set=[0-9a-f]{16} -->/);
  assert.match(t.scope, /Nombre corto \(debajo del ícono\): «Centro»/);
  assert.match(t.scope, /`src\/app\/manifest\.ts`/);
  assert.match(t.scope, /Trata a la gente de usted/);
  assert.equal(t.status, "Ready");
  assert.equal((await voz.voiceRead(db, "tienda", { git }))!.pedido?.key, made.key);
  await assert.rejects(voz.requestNames(db, project, { git }), /Taller ya trabaja en el nombre/);
  const back = (await voz.goBackVoice(db, "tienda", 1))!;
  assert.equal(back.versions, 3);
  assert.equal(back.base.short, "Tienda");
});

test("#5 the screen's examples move with the voice", async () => {
  const ui = await import("../ui/src/lib/voz.js");
  const base = voz.startVoice("Tienda", { files: [] });
  const w = ui.vozWords();
  const a = ui.example(w, "err", { ...base, cerca: 90, breve: 90, humor: 0, trato: "tu" });
  const b = ui.example(w, "err", { ...base, cerca: 10, breve: 10, humor: 0, trato: "usted" });
  const c = ui.example(w, "err", { ...base, cerca: 90, breve: 90, humor: 0, trato: "vos" });
  const d = ui.example(w, "err", { ...base, cerca: 90, breve: 90, humor: 90, trato: "tu" });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.ok(d.length > a.length && d.endsWith(a), "humor adds an opening, keeps the sentence");
  assert.ok(b.length > a.length, "detailed is longer than brief");
  for (const v of [base, { ...base, cerca: 10, humor: 90, trato: "vos" as const, yes: ["pedido"], no: ["usuario"] }, { ...base, guide: "Propia." }])
    assert.equal(ui.guideOf(w, v, "Tienda"), voz.guideOf(v, "Tienda"), "the screen shows the guide runs get");
});
