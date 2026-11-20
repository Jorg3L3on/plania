// PLA-I69-2: each surface follows the logo, is a variant (a recipe re-applied to whatever the logo is), or has its own
// picture, which asks the owner when a newer logo arrives. An own icon made before this change stays the owner's.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i69c-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const pedido = await import("../src/brand/pedido.js");
const marca = await import("../src/brand/marca.js");
const surfaces = await import("../src/brand/surfaces.js");
const { stageUpload, useUpload } = await import("../src/brand/upload.js");
const { makeDb } = await import("../src/db/client.js");

const C1 = "1".repeat(40);
const files: Record<string, Buffer> = { "package.json": Buffer.from("{}"), "src/app/layout.tsx": Buffer.from("") };
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
const ACTOR = { agent: "test", session_id: "s-i69c" } as never;
const dot = (fill: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="${fill}"/></svg>`), { density: 900 }).resize(1024, 1024).png().toBuffer();
const logo = async (fill: string, bg: string) => {
  const s = await stageUpload("tienda", await dot(fill), `logo-${fill.slice(1)}.png`);
  const l = await useUpload(db, project, { up: s.up, name: s.name, scale: 70, bg }, ACTOR);
  marca.forgetMarca();
  return l;
};
const pixel = async (png: Buffer, x: number, y: number) => {
  const { data } = await sharp(png).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return `#${[data[0]!, data[1]!, data[2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};
const read = async () => { marca.forgetMarca(); return (await marca.marcaRead(db, "tienda", { git }))!; };

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
});

test("#1 a variant is a recipe: Android on teal is made from today's logo, and from the next one", async () => {
  await logo("#ff0000", "#1f2b5c");
  surfaces.setVariant(project, "android", { bg: "#0f766e", scale: 60 });
  await read();
  const a = (await pedido.madeFile(db, project, "a192"))!;
  assert.equal(await pixel(a.bytes, 2, 2), "#0f766e", "Android's background is the recipe's");
  assert.equal(await pixel(a.bytes, 96, 96), "#ff0000", "the drawing is today's logo");
  const ios = (await pedido.madeFile(db, project, "apple"))!;
  assert.equal(await pixel(ios.bytes, 2, 2), "#1f2b5c", "iPhone still follows the logo");
  await logo("#00ff00", "#1f2b5c");
  await read();
  const b = (await pedido.madeFile(db, project, "a192"))!;
  assert.equal(await pixel(b.bytes, 2, 2), "#0f766e", "the recipe stays");
  assert.equal(await pixel(b.bytes, 96, 96), "#00ff00", "the drawing follows the new logo");
  const r = await read();
  assert.deepEqual({ mode: r.surfaces.android?.mode, bg: r.surfaces.android?.bg, scale: r.surfaces.android?.scale, knot: r.surfaces.android?.knot }, { mode: "variante", bg: "#0f766e", scale: 60, knot: false });
});

test("#2 an own picture asks when a newer logo arrives; «Mantener la mía» settles it; following clears it", async () => {
  const v1 = await logo("#ff0000", "#1f2b5c");
  const s = await stageUpload("tienda", await dot("#ffffff"), "solo-iphone.png");
  await surfaces.setSurface(project, "iphone", { up: s.up, name: s.name, scale: 70, bg: "#000000" }, v1.version);
  assert.equal((await read()).surfaces.iphone?.knot, false, "made under the logo that leads");
  await logo("#00ff00", "#1f2b5c");
  const r = await read();
  assert.equal(r.surfaces.iphone?.mode, "propia");
  assert.equal(r.surfaces.iphone?.knot, true, "a newer logo: it asks");
  const v2 = (await raw.query("select version from project_logos where active")).rows[0].version;
  assert.ok(surfaces.keepSurface(project, "iphone", v2));
  assert.equal((await read()).surfaces.iphone?.knot, false);
  surfaces.clearSurface(project, "iphone");
  assert.equal((await read()).surfaces.iphone, undefined, "back to following the logo");
});

test("#3 an own icon saved before this change (no mode) stays the owner's, and asks only if it predates the logo", async () => {
  await logo("#ff0000", "#1f2b5c");
  const tile = await dot("#ffffff");
  const file = (await import("../src/brand/logos.js")).putLogoFile("tienda", tile, "image/png");
  const dir = path.join(STORE, "_marca", "tienda");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "surfaces.json"), JSON.stringify({ android: { file, scale: 70, bg: null, name: "x.png", up: "x.png", colors: [], at: "2020-01-01T00:00:00.000Z" } }));
  const r = await read();
  assert.equal(r.surfaces.android?.mode, "propia");
  assert.equal(r.surfaces.android?.knot, true, "made before the logo that leads");
  const own = await surfaces.surfaceOriginals("tienda", null);
  assert.ok(own.android, "its picture still makes Android's files");
});

test("#4 a variant needs a sound recipe", () => {
  assert.throws(() => surfaces.setVariant(project, "android", { bg: "#0f766e", scale: 20 }));
  assert.throws(() => surfaces.setVariant(project, "android", { bg: "teal", scale: 60 }));
});

test("#5 the screen: how each surface follows, and its state on the waterline", async () => {
  const ui = await import("../ui/src/lib/marca.js");
  const row = (id: string, face: string, state: string, checks: { k: string; ok: boolean }[] = []) => ({ id, face, state, path: `p/${id}`, checks });
  const r = {
    rows: [row("svg", "nav", "ok"), row("mask", "and", "viejo", [{ k: "old_logo", ok: false }]), row("og", "share", "viejo", [{ k: "old_logo", ok: false }]), row("man", "pwa", "viejo", [{ k: "old_color", ok: false }])],
    pedido: null, trip: null, logo: null,
    surfaces: { android: { mode: "variante", file: null, bg: "#0f766e", scale: 60 }, iphone: { file: "x.png", bg: null, scale: 70 } },
  } as never;
  assert.equal(ui.tieOf(r, "android"), "variante");
  assert.equal(ui.tieOf(r, "iphone"), "propia", "an own icon saved before the change reads as its own picture");
  assert.equal(ui.tieOf(r, "navegador"), "sigue");
  assert.deepEqual(ui.shoreState(r, "nav"), { st: "aldia", why: null });
  assert.deepEqual(ui.shoreState(r, "and"), { st: "llevar", why: "old_logo" });
  assert.deepEqual(ui.shoreState(r, "share"), { st: "llevar", why: "old_color" }, "the share image waits on the colour");
  const way = { ...(r as object), pedido: { key: "K", status: "In progress", rows: ["mask"] } } as never;
  assert.deepEqual(ui.shoreState(way, "and"), { st: "camino", why: "camino" });
});
