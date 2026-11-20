// PLA-122: one surface's own icon. Throwaway DB and store, fake git, sharp on this machine, no runner.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-pla122-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const gen = await import("../src/brand/generate.js");
const pedido = await import("../src/brand/pedido.js");
const marca = await import("../src/brand/marca.js");
const surfaces = await import("../src/brand/surfaces.js");
const { stageUpload } = await import("../src/brand/upload.js");
const { makeDb } = await import("../src/db/client.js");

const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#4a1f3d"/><path d="M28 72V28h44" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round"/></svg>`;
const C1 = "1".repeat(40);
const files: Record<string, Buffer> = { "package.json": Buffer.from("{}"), "src/app/layout.tsx": Buffer.from(""), "public/brand/icon.svg": Buffer.from(tile) };
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
const corner = async (png: Buffer) => {
  const { data } = await sharp(png).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return `#${[data[0]!, data[1]!, data[2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};
// A light mark on nothing, 1024 px: what an owner drops for «Solo este».
const markPng = () => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="#4a1f3d"/></svg>`), { density: 900 }).resize(1024, 1024).png().toBuffer();

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
  marca.forgetMarca();
  rmSync(path.join(STORE, "_marca", "tienda"), { recursive: true, force: true });
  await raw.query("delete from project_logos");
  await raw.query("delete from tasks where project_id in (select id from projects where slug = 'tienda')");
  await raw.query("delete from projects where slug = 'tienda'");
  await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
  project = (await raw.query("select * from projects where slug = 'tienda'")).rows[0];
  project.settings ??= {};
  await marca.marcaRead(db, "tienda", { git }); // finds the repo's icon: the original
});

const ownAndroid = async () => {
  const s = await stageUpload("tienda", await markPng(), "solo-android.png");
  return surfaces.setSurface(project, "android", { up: s.up, name: s.name, scale: 70, bg: "#f4ede4" });
};

test("#1 Android's own icon makes every Android file and only those; the rest still come from the original", async () => {
  await ownAndroid();
  marca.forgetMarca();
  const set = (await pedido.buildSet(db, project, "todo"))!;
  const by = Object.fromEntries(set.files.map((f) => [f.key, f.bytes]));
  assert.equal(await corner(by.a192!), "#f4ede4", "Android from its own icon (ivory)");
  assert.equal(await corner(by.mask!), "#f4ede4");
  assert.equal(await corner(by.apple!), "#4a1f3d", "iPhone keeps the original (plum)");
  const read = (await marca.marcaRead(db, "tienda", { git }))!;
  assert.equal(read.surfaces.android?.bg, "#f4ede4");
  assert.equal(read.surfaces.iphone, undefined);
});

test("#2 a raster icon for the browser gives an icon.svg that wraps it", async () => {
  const s = await stageUpload("tienda", await markPng(), "solo-navegador.png");
  await surfaces.setSurface(project, "navegador", { up: s.up, name: s.name, scale: 80, bg: "#ffffff" });
  marca.forgetMarca();
  const set = (await pedido.buildSet(db, project, "todo", "navegador"))!;
  const svg = set.files.find((f) => f.key === "svg")!.bytes.toString("utf8");
  assert.match(svg, /^<svg [^>]*><image [^>]*href="data:image\/png;base64,/);
  assert.equal(await corner(await sharp(Buffer.from(svg)).png().toBuffer()), "#ffffff");
});

test("#3 the plan, the zip and Taller's ticket for one surface carry only its files and say which", async () => {
  await ownAndroid();
  marca.forgetMarca();
  const set = (await pedido.buildSet(db, project, "faltan", "android"))!;
  const keys = new Set(set.plan.items.map((i) => i.key));
  for (const k of keys) assert.ok(gen.SURFACE_KEYS.android.includes(k), `only Android keys, got ${k}`);
  assert.ok(keys.has("a192") && keys.has("mask") && keys.has("mono"));
  const zipped = await pedido.zipOf(db, project, "faltan", "android");
  assert.ok(zipped && zipped.includes(Buffer.from("public/icons/icon-192.png")) && !zipped.includes(Buffer.from("apple-icon.png")));
  const r = await pedido.requestIcons(db, project, "faltan", "android");
  const t = (await raw.query("select title, scope from tasks where key = $1", [r.key])).rows[0];
  assert.match(t.title, /solo Android/);
  assert.match(t.scope, /Solo cambian los archivos de Android/);
  assert.ok(!t.scope.includes("apple-icon.png"));
});

test("#4 «Solo este» starts from the original; «Volver al original» removes the surface's icon", async () => {
  const start = (await surfaces.startSurface(db, project, "iphone"))!;
  assert.match(start.name, /^original\./);
  await ownAndroid();
  assert.ok(surfaces.surfacesOf("tienda").android);
  surfaces.clearSurface(project, "android");
  assert.equal(surfaces.surfacesOf("tienda").android, undefined);
  marca.forgetMarca();
  const set = (await pedido.buildSet(db, project, "todo"))!;
  assert.equal(await corner(set.files.find((f) => f.key === "a192")!.bytes), "#4a1f3d", "back on the original");
});

test("PLA-124 #1 a surface plan carries only its own edits (no layout theme for Android)", async () => {
  await ownAndroid();
  marca.forgetMarca();
  const set = (await pedido.buildSet(db, project, "faltan", "android"))!;
  assert.ok(!set.plan.edits.some((e) => e.what === "layout_theme"), JSON.stringify(set.plan.edits));
  // The pure plan, for a Next.js repo with no manifest: the whole set sets the theme, Android alone does not.
  const rows = [{ id: "man", state: "falta", path: null, checks: [] }, { id: "ico", state: "ok", path: "src/app/favicon.ico", checks: [] }, { id: "a192", state: "falta", path: null, checks: [] }] as never;
  assert.ok(gen.planFor(rows, { framework: "next-app", root: "" }, "faltan", true).edits.some((e) => e.what === "layout_theme"));
  assert.ok(!gen.planFor(rows, { framework: "next-app", root: "" }, "faltan", true, false, gen.SURFACE_KEYS.android).edits.some((e) => e.what === "layout_theme"));
});

test("PLA-124 #2 a second icons request while one is open is refused with its key", async () => {
  const first = await pedido.requestIcons(db, project, "faltan");
  await ownAndroid();
  marca.forgetMarca();
  await assert.rejects(pedido.requestIcons(db, project, "faltan", "android"), (e: { code?: string; message?: string }) => e.code === "LOGO_PEDIDO_OPEN" && String(e.message).includes(first.key));
  await raw.query("update tasks set status = 'Done' where key = $1", [first.key]);
  const second = await pedido.requestIcons(db, project, "faltan", "android");
  assert.notEqual(second.key, first.key, "once the first is closed the next one goes");
});

test("PLA-125 #1 a fresh read fetches the start branch; otherwise at most once a minute", async () => {
  const logos = await import("../src/brand/logos.js");
  logos.forgetLogoLooks();
  const calls: string[][] = [];
  const spy: import("../src/brand/logos.js").Git = async (cwd, args) => (calls.push(args), git(cwd, args));
  await logos.scanProjectLogo(db, project, { git: spy, now: () => 1_000 });
  await logos.scanProjectLogo(db, project, { git: spy, now: () => 2_000 });
  const fetches = () => calls.filter((c) => c[0] === "fetch");
  assert.equal(fetches().length, 1);
  assert.deepEqual(fetches()[0], ["fetch", "--quiet", "--no-tags", "origin", "+refs/heads/sandbox:refs/remotes/origin/sandbox"]);
  await logos.scanProjectLogo(db, project, { git: spy, now: () => 3_000, fresh: true });
  assert.equal(fetches().length, 2, "«Revisar el repo ahora» fetches right away");
});

test("PLA-125 #2 an accepted (Merged) icons ticket is delivered: the door drops it and the next request goes", async () => {
  const first = await pedido.requestIcons(db, project, "faltan");
  marca.forgetMarca();
  assert.equal((await marca.marcaRead(db, "tienda", { git }))!.pedido?.key, first.key);
  await raw.query("update tasks set status = 'Merged' where key = $1", [first.key]);
  marca.forgetMarca();
  assert.equal((await marca.marcaRead(db, "tienda", { git }))!.pedido, null);
  await ownAndroid();
  const next = await pedido.requestIcons(db, project, "faltan", "android");
  assert.notEqual(next.key, first.key);
});

test("PLA-124 #3 files replaced where they are need no manifest edit; a new one still does", () => {
  const ok = (id: string, path: string) => ({ id, state: "ok", path, checks: [] });
  const rows = [ok("man", "src/app/manifest.ts"), ok("ico", "src/app/favicon.ico"), ok("a192", "public/icons/icon-192.png"), ok("a512", "public/icons/icon-512.png"), ok("mask", "public/icons/icon-512-maskable.png"), ok("mono", "public/icons/icon-monochrome.png")] as never;
  const same = gen.planFor(rows, { framework: "next-app", root: "" }, "faltan", true, false, gen.SURFACE_KEYS.android);
  assert.deepEqual(same.items.map((i) => i.op), ["~", "~", "~", "~"]);
  // PLA-I69-1: no new link, only the version on the icons' URLs so installed apps pick the new ones up.
  assert.deepEqual(same.edits.map((e) => e.what), ["manifest_version"]);
  const missing = gen.planFor([...(rows as unknown as object[]).filter((r) => (r as { id: string }).id !== "mono"), { id: "mono", state: "falta", path: null, checks: [] }] as never, { framework: "next-app", root: "" }, "faltan", true);
  assert.ok(missing.edits.some((e) => e.what === "manifest_mono"));
});
