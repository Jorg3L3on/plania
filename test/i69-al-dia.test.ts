// PLA-I69-1: Marca says what is pending and why, follows a request to the repo station by station, and the app's
// colour follows the logo the owner chose (the manifest on another colour reads old and gets an edit, never a rewrite).
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i69a-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const gen = await import("../src/brand/generate.js");
const pedido = await import("../src/brand/pedido.js");
const marca = await import("../src/brand/marca.js");
const { logoTheme } = await import("../src/brand/theme.js");
const { stageUpload, useUpload } = await import("../src/brand/upload.js");
const { makeDb } = await import("../src/db/client.js");
const ui = await import("../ui/src/lib/marca.js");
const { setLanguageForTests: setLanguage } = await import("../ui/src/lib/i18n.js");

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#4a1f3d"/><path d="M28 72V28h44" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round"/></svg>`;
const MANIFEST = `import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "Tienda", short_name: "Tienda", start_url: "/", display: "standalone", background_color: "#f2c14e", theme_color: "#f2c14e", icons: [] };
}`;
const C1 = "1".repeat(40);
const files: Record<string, Buffer> = { "package.json": Buffer.from("{}"), "src/app/layout.tsx": Buffer.from(""), "public/brand/icon.svg": Buffer.from(icon), "src/app/manifest.ts": Buffer.from(MANIFEST) };
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
const ACTOR = { agent: "test", session_id: "s-i69" } as never;
const newLogo = async (bg: string) => {
  const mark = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="#ffffff"/></svg>`), { density: 900 }).resize(1024, 1024).png().toBuffer();
  const s = await stageUpload("tienda", mark, "nuevo.png");
  await useUpload(db, project, { up: s.up, name: s.name, scale: 70, bg }, ACTOR);
  marca.forgetMarca();
};

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
  await marca.marcaRead(db, "tienda", { git });
});

test("#1 the app's colour is the chosen logo's: its background, else its main colour; a repo logo leaves the repo's", () => {
  assert.equal(logoTheme({ chosen: true, colors: ["#aaaaaa"], adjust: { bg: "#1F2B5C" } }), "#1f2b5c");
  assert.equal(logoTheme({ chosen: true, colors: ["#334455", "#ffffff"], adjust: null }), "#334455");
  assert.equal(logoTheme({ chosen: false, colors: ["#334455"] }), null, "a logo Plania only found keeps the repo's colour");
});

test("#2 a repo logo keeps the manifest's colour; a chosen one on another colour reads «color del logo anterior»", async () => {
  const before_ = (await marca.marcaRead(db, "tienda", { git }))!;
  assert.equal(before_.rows.find((r) => r.id === "man")!.state, "ok", "the found logo does not judge the repo's colour");
  await newLogo("#1f2b5c");
  const read = (await marca.marcaRead(db, "tienda", { git }))!;
  assert.equal(read.logo?.theme, "#1f2b5c");
  const man = read.rows.find((r) => r.id === "man")!;
  assert.equal(man.state, "viejo");
  assert.deepEqual(man.checks.find((c) => c.k === "old_color")?.v, { have: "#f2c14e", want: "#1f2b5c" });
});

test("#3 the request edits the manifest's colour (never rewrites it) and the share image is on the logo's colour", async () => {
  await newLogo("#1f2b5c");
  await marca.marcaRead(db, "tienda", { git }); // the request reads through the cache this fills
  const set = (await pedido.buildSet(db, project, "faltan"))!;
  assert.equal(set.theme, "#1f2b5c");
  assert.ok(!set.plan.items.some((i) => i.key === "manifest"), "the owner's manifest is not replaced");
  assert.ok(set.plan.edits.some((e) => e.what === "manifest_theme" && e.path === "src/app/manifest.ts"));
  const og = set.files.find((f) => f.key === "og")!;
  const { data } = await sharp(og.bytes).extract({ left: 4, top: 4, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  assert.equal(`#${[data[0]!, data[1]!, data[2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`, "#1f2b5c");
  const req = await pedido.requestIcons(db, project, "faltan");
  const [t] = (await raw.query("select scope from tasks where key = $1", [req.key])).rows;
  assert.match(t.scope, /theme_color y background_color con el color de la app \(#1f2b5c\); también viewport\.themeColor/);
  assert.match(t.scope, /rows=[a-z0-9_,]*\bman\b/, "the manifest is on its way with the request");
});

test("#4 a colour-only change is enough for a request (no files, one edit)", async () => {
  // A repo whose every file is fine except the manifest's colour: nothing to make, one line to change.
  const rows = [
    { id: "man", face: "pwa", state: "viejo", path: "src/app/manifest.ts", checks: [{ k: "man_colors", ok: true, v: { theme: "#f2c14e", background: "#f2c14e" } }, { k: "old_color", ok: false }] },
  ] as import("../src/brand/check.js").Row[];
  const plan = gen.planFor(rows, { framework: "next-app", root: "" }, "faltan", true);
  assert.deepEqual(plan.items, []);
  assert.deepEqual(plan.edits.map((e) => e.what), ["manifest_theme"]);
});

test("#5 replacing an Android icon bumps ?v= in the manifest; a manifest Plania writes carries the version", () => {
  const rows = [
    { id: "man", face: "pwa", state: "ok", path: "src/app/manifest.ts", checks: [] },
    { id: "a192", face: "and", state: "viejo", path: "public/icons/icon-192.png", checks: [] },
  ] as import("../src/brand/check.js").Row[];
  const plan = gen.planFor(rows, { framework: "next-app", root: "" }, "faltan", true);
  assert.deepEqual(plan.items.map((i) => [i.key, i.op]), [["a192", "~"]]);
  assert.ok(plan.edits.some((e) => e.what === "manifest_version"));
  const text = gen.manifestText("next-app", "Tienda", "#1f2b5c", (k) => `public/icons/${k}.png`, "public", "ab12cd34");
  assert.match(text, /"\/icons\/a192\.png\?v=ab12cd34"/);
  assert.match(text, /"\/icons\/mask\.png\?v=ab12cd34"/);
});

test("#6 the trip: built, PR, QA, your acceptance, start branch, seen; a cancelled request says so", async () => {
  await newLogo("#1f2b5c");
  await marca.marcaRead(db, "tienda", { git });
  const req = await pedido.requestIcons(db, project, "faltan");
  const step = async () => { marca.forgetMarca(); return (await marca.marcaRead(db, "tienda", { git }))!.trip; };
  assert.equal((await step())!.step, 1, "built; Taller has not opened the PR");
  await raw.query("update tasks set status = 'In progress', pr_url = 'https://github.com/o/r/pull/7' where key = $1", [req.key]);
  assert.equal((await step())!.step, 2);
  assert.equal((await step())!.pr, "https://github.com/o/r/pull/7");
  await raw.query("update tasks set status = 'In review' where key = $1", [req.key]);
  assert.equal((await step())!.step, 3, "waits for the owner");
  await raw.query("update tasks set status = 'Merged' where key = $1", [req.key]);
  assert.equal((await step())!.step, 5, "merged; the repo Plania reads does not have the files yet");
  assert.equal(marca.tripStep({ pr: "x", merged: true, review: false }, [{ id: "a192", state: "ok" }] as never, ["a192"]), 6, "seen once every carried row reads ok");
  await raw.query("update tasks set status = 'Won''t do' where key = $1", [req.key]);
  assert.equal((await step())!.cancelled, true);
});

test("#7 the bar names what is pending and why, in the owner's words", async () => {
  setLanguage("es");
  const row = (id: string, face: string, state: string, checks: { k: string; ok: boolean }[] = []) => ({ id, face, state, path: `p/${id}`, checks }) as never;
  const r = {
    rows: [row("ico", "nav", "ok"), row("a192", "and", "viejo", [{ k: "old_logo", ok: false }]), row("a512", "and", "viejo", [{ k: "old_logo", ok: false }]), row("man", "pwa", "viejo", [{ k: "old_color", ok: false }])],
    pedido: null,
    trip: { key: "T-1", status: "Merged", step: 6, cancelled: false, pr: null, rows: ["ico"], at: "2026-11-20T00:00:00Z", movedAt: null },
    surfaces: {},
    logo: null,
  };
  const p = ui.pending(r as never);
  assert.deepEqual(p.faces, ["and", "pwa"]);
  assert.equal(p.files, 3);
  assert.equal(ui.pendingSay(p), "Android no iba en el último pedido. El manifiesto no tiene el color de la app.");
  const own = { ...r, trip: null, surfaces: { android: { file: "x", bg: null, scale: 70, at: "2026-11-19T00:00:00Z" } }, logo: { at: "2026-11-20T00:00:00Z" } };
  assert.match(ui.pendingSay(ui.pending(own as never)), /^Android tiene su propio ícono, hecho con el logo anterior\./);
  assert.equal(ui.rowWhy(r as never, r.rows[3] as never), "old_color");
});
