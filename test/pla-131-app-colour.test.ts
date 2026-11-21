// PLA-131: the app's colour has one rule. Once Plania keeps a style and the repo's CSS has a brand colour, that colour is
// what the manifest and the share image are judged by and what the icons request carries. A colour only tried in Estilo
// (or Estilo's «volver a lo del repo») never makes Logo's manifest and share faces read old.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-131-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const pedido = await import("../src/brand/pedido.js");
const marca = await import("../src/brand/marca.js");
const { appColor } = await import("../src/brand/theme.js");
const { stageUpload, useUpload } = await import("../src/brand/upload.js");
const { makeDb } = await import("../src/db/client.js");

const manifest = (c: string) => `import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "Tienda", short_name: "Tienda", start_url: "/", display: "standalone", background_color: "${c}", theme_color: "${c}", icons: [] };
}`;
const css = (c: string) => `:root {\n  --primary: ${c};\n  --primary-foreground: #ffffff;\n  --radius: 0.75rem;\n}\n`;
const C1 = "1".repeat(40);
let files: Record<string, Buffer> = {};
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
const repo = (opts: { manifest: string; css: string | null }) => {
  files = { "package.json": Buffer.from("{}"), "src/app/layout.tsx": Buffer.from(""), "src/app/manifest.ts": Buffer.from(manifest(opts.manifest)) };
  if (opts.css) files["src/app/globals.css"] = Buffer.from(css(opts.css));
  marca.forgetMarca();
};
// The owner's Estilo, as the screen saves it (only the colour matters here).
const estilo = (brand: string, brandTie: "sigue" | "fijo" = "fijo") => {
  const dir = path.join(STORE, "_marca", "tienda");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "style.json"), JSON.stringify({ current: 1, versions: [{ v: 1, at: new Date().toISOString(), style: { brand, brandTie, accent: "#7ee3b0" } }] }));
};
const ACTOR = { agent: "test", session_id: "s-131" } as never;
const chooseLogo = async (bg: string) => {
  const mark = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="#ffffff"/></svg>`), { density: 900 }).resize(1024, 1024).png().toBuffer();
  const s = await stageUpload("tienda", mark, "nuevo.png");
  await useUpload(db, project, { up: s.up, name: s.name, scale: 70, bg }, ACTOR);
  marca.forgetMarca();
};
const man = async () => (await marca.marcaRead(db, "tienda", { git }))!.rows.find((r) => r.id === "man")!;

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
  repo({ manifest: "#8e1b3a", css: "#8e1b3a" });
  await chooseLogo("#1f2b5c");
});

test("#1 the rule: with a style, the repo's CSS brand leads; without one, the style's or the chosen logo's as before", () => {
  const logo = { chosen: true, colors: ["#4a1f3d"], adjust: null };
  assert.equal(appColor({ brand: "#0f766e", brandTie: "fijo" }, logo, "#8E1B3A"), "#8e1b3a");
  assert.equal(appColor({ brand: "#0f766e", brandTie: "fijo" }, logo, null), "#0f766e", "no CSS brand: the style's");
  assert.equal(appColor({ brand: "#0f766e", brandTie: "sigue" }, logo, null), "#4a1f3d", "no CSS brand, following the logo");
  assert.equal(appColor(null, logo, "#8e1b3a"), "#4a1f3d", "no style yet: the chosen logo's, as before");
  assert.equal(appColor({ brand: "#0f766e", brandTie: "fijo" }, logo, "oklch(0.5 0.1 20)"), "#0f766e", "a CSS value that is not a hex colour does not lead");
});

test("#2 trying colours in Estilo (unsent) leaves the manifest face as it was", async () => {
  estilo("#8e1b3a");
  assert.equal((await man()).state, "ok");
  for (const c of ["#0f766e", "#2563eb", "#7c3aed"]) {
    estilo(c);
    const m = await man();
    assert.equal(m.state, "ok", `Estilo on ${c} without sending it`);
    assert.ok(!m.checks.some((x) => x.k === "old_color"));
  }
});

test("#3 «volver a lo del repo» in Estilo does not make the manifest old (the flip seen live)", async () => {
  // The state the owner was in: an earlier icons request wrote Estilo's draft colour into the manifest only.
  repo({ manifest: "#0f766e", css: "#8e1b3a" });
  estilo("#0f766e");
  const draft = await man();
  assert.equal(draft.state, "viejo", "the manifest and the CSS disagree: one request settles it");
  // Going back to the repo's style (its CSS colour) changes nothing on Logo: the face waits on the same one colour.
  estilo("#8e1b3a");
  const back = await man();
  assert.equal(back.state, "viejo");
  assert.deepEqual(back.checks.find((c) => c.k === "old_color")?.v, { have: "#0f766e", want: "#8e1b3a" });
  // Once the manifest has the CSS colour, Estilo can go anywhere and the face stays as it is.
  repo({ manifest: "#8e1b3a", css: "#8e1b3a" });
  for (const c of ["#0f766e", "#8e1b3a"]) {
    estilo(c);
    assert.equal((await man()).state, "ok");
  }
});

test("#4 the icons request, the stale check and the share image carry the repo's CSS colour, not Estilo's draft", async () => {
  repo({ manifest: "#0f766e", css: "#8e1b3a" });
  estilo("#2563eb");
  const read = (await marca.marcaRead(db, "tienda", { git }))!;
  assert.equal(read.appColor, "#8e1b3a");
  const set = (await pedido.buildSet(db, project, "faltan"))!;
  assert.equal(set.theme, "#8e1b3a");
  assert.ok(set.plan.edits.some((e) => e.what === "manifest_theme"));
  const og = set.files.find((f) => f.key === "og")!;
  const { data } = await sharp(og.bytes).extract({ left: 4, top: 4, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  assert.equal(`#${[data[0]!, data[1]!, data[2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`, "#8e1b3a");
});

test("#5 a repo with no CSS brand keeps the rule before: the style's colour leads the manifest", async () => {
  repo({ manifest: "#8e1b3a", css: null });
  estilo("#0f766e");
  const m = await man();
  assert.equal(m.state, "viejo");
  assert.deepEqual(m.checks.find((c) => c.k === "old_color")?.v, { have: "#8e1b3a", want: "#0f766e" });
});
