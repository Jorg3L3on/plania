// PLA-I69-3: «Más caras» (notifications, shortcuts, install screenshots, a test-environment icon, each behind a
// switch) and Artist for one surface (three proposals; one becomes that surface's own picture, the original stays).
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i69m-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const gen = await import("../src/brand/generate.js");
const { checkRepo } = await import("../src/brand/check.js");
const marks = await import("../src/brand/marks.js");
const marca = await import("../src/brand/marca.js");
const { stageUpload, useUpload } = await import("../src/brand/upload.js");
const { makeDb } = await import("../src/db/client.js");

const view = (files: Record<string, Buffer | string>) => {
  const m = new Map(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? Buffer.from(v) : v] as const));
  return { paths: new Map([...m].map(([k, v]) => [k, v.length])), read: async (p: string) => m.get(p) ?? null };
};
const MAN = `export default function manifest() { return { name: "Tienda", theme_color: "#111111", background_color: "#111111", display: "standalone", icons: [],
  shortcuts: [{ name: "Nuevo", url: "/n" }, { name: "Citas", url: "/c", icons: [{ src: "/i.png", sizes: "96x96" }] }] }; }`;
const repo = { "package.json": "{}", "src/app/layout.tsx": "export const metadata = {};", "src/app/manifest.ts": MAN };
const tile = async (fill: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${fill}"/><circle cx="50" cy="50" r="22" fill="#ffffff"/></svg>`), { density: 600 }).resize(1024, 1024).png().toBuffer();

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
  await raw.query("delete from agents where project_id in (select id from projects where slug = 'tienda')");
  await raw.query("delete from projects where slug = 'tienda'");
  await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
  project = (await raw.query("select * from projects where slug = 'tienda'")).rows[0];
});

test("#1 a switch adds its surface's row; off, nothing is asked", async () => {
  const off = await checkRepo(view(repo), { hasOriginal: true, slug: "tienda" });
  assert.ok(!off.rows.some((r) => ["badge", "short", "shots", "test"].includes(r.id)));
  const on = await checkRepo(view(repo), { hasOriginal: true, slug: "tienda", extras: { avisos: true, atajos: true, capturas: true, prueba: true } });
  const st = (id: string) => on.rows.find((r) => r.id === id)?.state;
  assert.equal(st("badge"), "falta");
  assert.equal(st("short"), "falta", "one of the two shortcuts has no icon");
  assert.deepEqual(on.rows.find((r) => r.id === "short")?.checks, [{ k: "short_icons", ok: false, v: { n: 1 } }]);
  assert.equal(st("shots"), "falta");
  assert.equal(st("test"), "falta");
  const plan = gen.planFor(on.rows, { framework: on.framework, root: on.root }, "faltan", true);
  for (const k of ["badge", "short", "shots", "test"]) assert.ok(plan.items.some((i) => i.key === k), k);
  assert.deepEqual(plan.edits.map((e) => e.what).filter((w) => ["push_badge", "manifest_shortcuts", "manifest_screenshots", "layout_test_icon"].includes(w)).sort(), ["layout_test_icon", "manifest_screenshots", "manifest_shortcuts", "push_badge"]);
});

test("#2 the files: a white 96 px badge on nothing, the logo at 192 for shortcuts, the icon with an amber corner", async () => {
  const o = { bytes: await tile("#1f2b5c"), mime: "image/png" as const, variant: "icon" as const, colors: ["#1f2b5c"], bg: "#1f2b5c" };
  const rows = [{ id: "badge", face: "more", state: "falta", path: "public/icons/badge-96.png", checks: [] }, { id: "short", face: "more", state: "falta", path: "public/icons/shortcut-192.png", checks: [] }, { id: "test", face: "more", state: "falta", path: "public/icons/icon-prueba.png", checks: [] }] as never;
  const plan = gen.planFor(rows, { framework: "next-app", root: "" }, "faltan", false);
  const files = Object.fromEntries((await gen.generate(o, plan, { name: "Tienda", theme: null, rows, root: "" })).map((f) => [f.key, f.bytes]));
  const meta = async (b: Buffer) => sharp(b).metadata();
  assert.equal((await meta(files.badge!)).width, 96);
  const corner = async (b: Buffer, x: number, y: number) => { const { data } = await sharp(b).ensureAlpha().extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true }); return [...data]; };
  assert.equal((await corner(files.badge!, 1, 1))[3], 0, "the badge's background is transparent");
  assert.equal((await meta(files.short!)).width, 192);
  assert.deepEqual((await corner(files.test!, 508, 508)).slice(0, 3), [255, 180, 84], "amber corner");
  assert.deepEqual((await corner(files.test!, 4, 4)).slice(0, 3), [31, 43, 92], "the rest is the icon");
});

test("#3 install screenshots: a tall phone page is cut from its top; a desktop still becomes 16:10", async () => {
  const phone = await sharp({ create: { width: 390, height: 2400, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const desk = await sharp({ create: { width: 1440, height: 2000, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const n = await sharp(await gen.screenshotOf(phone, "narrow")).metadata();
  const w = await sharp(await gen.screenshotOf(desk, "wide")).metadata();
  assert.ok(n.height! / n.width! <= 2.3 && Math.min(n.width!, n.height!) >= 320, `${n.width}×${n.height}`);
  assert.equal(Math.round((w.width! / w.height!) * 10) / 10, 1.6);
});

test("#4 project settings take the switches and refuse anything else", async () => {
  const { setProject } = await import("../src/mcp/project.js");
  const ctx = { actor: { agent: "test", session_id: "s-i69m" } } as never;
  const p = (await raw.query("select version from projects where slug = 'tienda'")).rows[0];
  await setProject(db, { project: "tienda", version: p.version, settings: { marca: { native: false, extras: { avisos: true } } } } as never, ctx);
  const s = (await raw.query("select settings from projects where slug = 'tienda'")).rows[0].settings;
  assert.deepEqual(s.marca, { native: false, extras: { avisos: true } });
  const v = (await raw.query("select version from projects where slug = 'tienda'")).rows[0].version;
  await assert.rejects(setProject(db, { project: "tienda", version: v, settings: { marca: { extras: { colores: true } } } } as never, ctx), /INVALID_FILTER/);
});

test("#5 Artist for one surface: the prompt names the surface and the logo; using a mark gives that surface its own picture", async () => {
  const s = await stageUpload("tienda", await tile("#8c2f39"), "logo.png");
  const logo = await useUpload(db, project, { up: s.up, name: s.name, scale: 100, bg: null }, { agent: "test", session_id: "s" } as never);
  const r = await marks.requestMarks(db, project, { change: "más simple", surface: "android" }, { wake: async () => ({ runId: null, why: "test" }) });
  assert.equal(r.hints.surface, "android");
  assert.equal(r.hints.base, logo.file);
  const prompt = marks.marksPrompt({ agent: "Artist", project: { slug: "tienda", title: "Tienda" }, request: { ...r, status: "drawing" }, sessionId: "run-x", imageDir: "/tmp" });
  assert.match(prompt, /one surface only: the Android home screen/);
  assert.match(prompt, /Draw 3 icons/);
  assert.match(prompt, new RegExp(logo.file));
  // Artist answers (as the run): the request is ready; one mark becomes Android's own picture.
  await raw.query("insert into agents (slug, name, role, kind, capabilities, project_id, role_template, adapter) select 'artist-tienda', 'Artist', 'artist', 'bot', '{design}', id, 'artist', 'claude_code' from projects where slug = 'tienda'");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#0f766e"/><circle cx="50" cy="50" r="20" fill="#ffffff"/></svg>`;
  const back = await marks.deliverMarks(db, { project: "tienda", id: r.id, marks: [{ name: "Torre", idea: "una torre", svg }] }, { agent: "artist-tienda" });
  assert.equal(back.kept, 1);
  const ready = marks.loadRequest("tienda", r.id)!;
  await marks.useMarkFor(db, project, r.id, ready.marks[0]!.id, "android");
  const read = (await marca.marcaRead(db, "tienda"))!;
  assert.equal(read.surfaces.android?.mode, "propia");
  assert.equal(read.surfaces.android?.logoV, logo.version);
  assert.equal(read.logo?.v, logo.version, "the original did not change");
});
