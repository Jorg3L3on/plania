// PLA-I66-4: the icon files made from the original, the plan of what changes per framework, the request to Taller and
// the rows on their way, the .zip, and the repo changing the logo on its own.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i66g-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const gen = await import("../src/brand/generate.js");
const { checkRepo, icoSizes, reach, opaque } = await import("../src/brand/check.js");
const pedido = await import("../src/brand/pedido.js");
const marca = await import("../src/brand/marca.js");
const logos = await import("../src/brand/logos.js");
const up = await import("../src/brand/upload.js");
const { makeDb } = await import("../src/db/client.js");
const ui = await import("../ui/src/lib/marca.js");

const tileSvg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${color}"/><path d="M28 72V28h44" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round"/></svg>`;
const markSvg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M20 80V20h60" stroke="${color}" stroke-width="16" fill="none" stroke-linecap="round"/></svg>`;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const view = (files: Record<string, Buffer | string>) => {
  const m = new Map(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? Buffer.from(v) : v] as const));
  return { paths: new Map([...m].map(([k, v]) => [k, v.length])), read: async (p: string) => m.get(p) ?? null };
};
const NEXT = { "package.json": "{}", "src/app/layout.tsx": "export const metadata = {};", "src/app/opengraph-image.tsx": "export default () => null;" };

describe("making the files", () => {
  test("every file at its exact size; the iPhone and adaptive icons opaque; the ICO with 48, 32 and 16", async () => {
    const o = { bytes: Buffer.from(tileSvg("#7c3aed")), mime: "image/svg+xml" as const, variant: "icon" as const, colors: ["#7c3aed"] };
    const rows = (await checkRepo(view({ "package.json": "{}", "src/app/layout.tsx": "" }), { hasOriginal: true, slug: "tienda" })).rows;
    const plan = gen.planFor(rows, { framework: "next-app", root: "" }, "todo", true);
    const files = await gen.generate(o, plan, { name: "Tienda", theme: "#111827", rows, root: "" });
    const by = Object.fromEntries(files.map((f) => [f.key, f])) as Record<string, { bytes: Buffer; path: string }>;
    assert.deepEqual(icoSizes(by.ico!.bytes), [16, 32, 48]);
    assert.equal(by.ico!.bytes[6], 48, "48 first");
    const dims = async (k: string) => { const m = await sharp(by[k]!.bytes).metadata(); return `${m.width}x${m.height}`; };
    assert.equal(await dims("apple"), "180x180");
    assert.equal(await dims("a192"), "192x192");
    assert.equal(await dims("a512"), "512x512");
    assert.equal(await dims("mask"), "512x512");
    assert.equal(await dims("og"), "1200x630");
    assert.equal(opaque(by.apple!.bytes), true);
    assert.equal(opaque(by.mask!.bytes), true);
    assert.ok(reach(by.mask!.bytes)! <= 0.4);
    const mono = await sharp(by.mono!.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let ink = 0, see = 0;
    for (let i = 0; i < mono.data.length; i += 4) mono.data[i + 3]! > 128 ? ink++ : see++;
    assert.ok(ink > 0 && see > ink, "a silhouette on nothing");
    assert.equal(by.svg!.bytes.toString(), tileSvg("#7c3aed"));
    assert.match(by.manifest!.bytes.toString(), /purpose": "maskable"/);
    assert.equal(by.manifest!.path, "src/app/manifest.ts");
  });

  test("a bare mark is set on a plate it shows on; a raster original gives no SVG", async () => {
    const o = { bytes: Buffer.from(markSvg("#ffffff")), mime: "image/svg+xml" as const, variant: "mark" as const, colors: ["#ffffff"] };
    const rows = (await checkRepo(view(NEXT), { hasOriginal: true, slug: "tienda" })).rows;
    const files = await gen.generate(o, gen.planFor(rows, { framework: "next-app", root: "" }, "todo", true), { name: "T", theme: null, rows, root: "" });
    const apple = await sharp(files.find((f) => f.key === "apple")!.bytes).raw().toBuffer();
    assert.ok(apple[0]! < 60, "a white mark gets a dark plate");
    const png = await sharp(Buffer.from(tileSvg("#0ea5e9"))).resize(1024, 1024).png().toBuffer();
    const plan = gen.planFor(rows, { framework: "next-app", root: "" }, "todo", false);
    assert.ok(!plan.items.some((i) => i.key === "svg"));
  });

  test("the same original gives the same bytes twice, and the same .zip", async () => {
    const o = { bytes: Buffer.from(tileSvg("#16a34a")), mime: "image/svg+xml" as const, variant: "icon" as const, colors: ["#16a34a"] };
    const rows = (await checkRepo(view(NEXT), { hasOriginal: true, slug: "tienda" })).rows;
    const plan = gen.planFor(rows, { framework: "next-app", root: "" }, "todo", true);
    const a = await gen.generate(o, plan, { name: "Tienda", theme: null, rows, root: "" });
    const b = await gen.generate(o, plan, { name: "Tienda", theme: null, rows, root: "" });
    assert.deepEqual(a.map((f) => sha(f.bytes)), b.map((f) => sha(f.bytes)));
    const z1 = gen.zip(a), z2 = gen.zip(b);
    assert.equal(sha(z1), sha(z2));
    assert.equal(z1.readUInt32LE(z1.length - 22), 0x06054b50);
    assert.equal(z1.readUInt16LE(z1.length - 22 + 10), a.length);
    assert.equal(gen.crc32(Buffer.from("123456789")), 0xcbf43926);
  });
});

describe("the plan per framework", () => {
  test("Next.js: missing files where the framework expects them, a file the repo has keeps its path, the share image drawn in code is left alone", async () => {
    const r = await checkRepo(view({ ...NEXT, "src/app/favicon.ico": Buffer.from([0, 0, 1, 0, 0, 0]), "public/apple-touch-icon.png": await sharp({ create: { width: 180, height: 180, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0 } } }).png().toBuffer() }), { hasOriginal: true, slug: "tienda" });
    const plan = gen.planFor(r.rows, { framework: r.framework, root: r.root }, "faltan", true);
    const at = Object.fromEntries(plan.items.map((i) => [i.key, `${i.op} ${i.path}`]));
    assert.equal(at.ico, "~ src/app/favicon.ico");
    assert.equal(at.apple, "~ public/apple-touch-icon.png");
    assert.equal(at.svg, "+ src/app/icon.svg");
    assert.equal(at.a512, "+ public/icons/icon-512.png");
    assert.equal(at.manifest, "+ src/app/manifest.ts");
    assert.equal(at.og, undefined);
    assert.ok(plan.kept >= 1);
    assert.ok(plan.edits.some((e) => e.what === "layout_theme"));
  });

  test("Vite: public/ and the links in index.html; «todo» redoes what «faltan» leaves", async () => {
    const r = await checkRepo(view({ "package.json": "{}", "vite.config.ts": "", "index.html": "<html></html>", "public/favicon.ico": Buffer.from([0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }), { hasOriginal: true, slug: "tienda" });
    const faltan = gen.planFor(r.rows, { framework: r.framework, root: r.root }, "faltan", true);
    assert.equal(r.framework, "vite");
    assert.deepEqual(faltan.items.find((i) => i.key === "svg"), { key: "svg", path: "public/icon.svg", op: "+" });
    assert.deepEqual(faltan.items.find((i) => i.key === "og"), { key: "og", path: "public/og.png", op: "+" });
    assert.ok(faltan.edits.some((e) => e.path === "index.html" && e.what === "html_links"));
    assert.ok(faltan.edits.some((e) => e.what === "html_manifest"));
    const todo = gen.planFor(r.rows, { framework: r.framework, root: r.root }, "todo", true);
    assert.ok(todo.items.length >= faltan.items.length);
  });
});

// ---------- against the test database ----------
type Repo = { refs: Record<string, string>; commits: Record<string, Record<string, Buffer>> };
function fakeGit(repo: Repo): import("../src/brand/logos.js").Git {
  return async (_cwd, args) => {
    const no = { code: 1, stdout: Buffer.alloc(0) };
    if (args[0] === "rev-parse") {
      const s = repo.refs[args[3]!.replace("^{commit}", "")];
      return s ? { code: 0, stdout: Buffer.from(s) } : no;
    }
    if (args[0] === "ls-tree") {
      const files = repo.commits[args[4]!];
      return files ? { code: 0, stdout: Buffer.from(Object.entries(files).map(([p, b]) => `100644 blob ${"a".repeat(40)} ${b.length}\t${p}`).join("\0") + "\0") } : no;
    }
    if (args[0] === "cat-file") {
      const [c, p] = args[2]!.split(/:(.+)/);
      const b = repo.commits[c!]?.[p!];
      return b ? { code: 0, stdout: b } : no;
    }
    return no;
  };
}

describe("asking Taller, and the repo changing the logo", () => {
  let raw: Awaited<ReturnType<typeof resetTestDb>>;
  let db: ReturnType<typeof makeDb>["db"];
  let project: import("../src/db/schema.js").Project;
  const C1 = "1".repeat(40), C2 = "2".repeat(40);
  let repo: Repo;
  const owner = { agent: "screen", session_id: "web" };
  before(async () => {
    raw = await resetTestDb();
    db = makeDb().db;
  });
  after(async () => {
    await raw.end();
    rmSync(STORE, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await raw.query("delete from project_logos");
    await raw.query("delete from tasks where project_id in (select id from projects where slug = 'tienda')");
    await raw.query("delete from projects where slug = 'tienda'");
    await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
    project = (await raw.query("select * from projects where slug = 'tienda'")).rows[0];
    project.settings ??= {};
    repo = { refs: { sandbox: C1 }, commits: { [C1]: { "package.json": Buffer.from("{}"), "src/app/layout.tsx": Buffer.from(""), "public/brand/icon.svg": Buffer.from(tileSvg("#2563eb")) } } };
    marca.forgetMarca();
    logos.forgetLogoLooks();
  });

  test("«Pedírselo a Taller» opens a Ready ticket in the project with the set's folder, and its rows show as on their way", async () => {
    const deps = { git: fakeGit(repo) };
    await marca.marcaRead(db, "tienda", deps);
    const r = await pedido.requestIcons(db, project, "faltan");
    const t = (await raw.query("select status, work_type, scope from tasks where key = $1", [r.key])).rows[0];
    assert.equal(t.status, "Ready");
    assert.equal(t.work_type, "code");
    assert.match(t.scope, /<!-- plania:marca set=[0-9a-f]{16} rows=[a-z0-9,]+ -->/);
    assert.ok(t.scope.includes(r.set.dir));
    assert.ok(t.scope.includes("`src/app/apple-icon.png`"));
    assert.ok((await raw.query("select count(*)::int as n from checks c join tasks t on t.id = c.task_id where t.key = $1", [r.key])).rows[0].n >= 2);
    const onDisk = readFileSync(path.join(r.set.dir, "src/app/apple-icon.png"));
    assert.equal((await sharp(onDisk).metadata()).width, 180);
    const read = (await marca.marcaRead(db, "tienda", deps))!;
    assert.equal(read.pedido?.key, r.key);
    const apple = read.rows.find((x) => x.id === "apple")!;
    assert.equal(ui.onItsWay(read, apple), true);
    assert.equal(ui.onItsWay(read, read.rows.find((x) => x.id === "pl")!), false);
  });

  test("with no original there is nothing to make; with nothing missing there is nothing to ask", async () => {
    await assert.rejects(pedido.requestIcons(db, project, "faltan"), { code: "LOGO_NONE" });
  });

  test("the repo's other logo while the owner's choice leads is a question; keeping mine answers it; the same logo regenerated is not one", async () => {
    let deps = { git: fakeGit(repo) };
    await marca.marcaRead(db, "tienda", deps);
    const s = await up.stageUpload("tienda", Buffer.from(markSvg("#c026d3")), "mio.svg");
    await up.useUpload(db, project, { up: s.up, name: "mio.svg", scale: 70, bg: "#111827" }, owner);
    marca.forgetMarca();
    const r1 = (await marca.marcaRead(db, "tienda", deps))!;
    assert.equal(r1.drift?.path, "public/brand/icon.svg");
    assert.equal(r1.logo?.source, "upload", "never replaced by itself");
    await pedido.keepOver(db, project, r1.drift!.sha);
    assert.equal((await marca.marcaRead(db, "tienda", deps))!.drift, null);
    // The repo now carries our own logo, regenerated as a PNG icon: the same picture, no question.
    const mine = readFileSync(path.join(STORE, "_marca", "tienda", r1.logo!.file));
    repo.refs.sandbox = C2;
    repo.commits[C2] = { ...repo.commits[C1]!, "public/brand/icon.svg": Buffer.from(tileSvg("#2563eb")), "src/app/icon.png": await sharp(mine).resize(512, 512).png().toBuffer() };
    delete repo.commits[C2]!["public/brand/icon.svg"];
    deps = { git: fakeGit(repo) };
    marca.forgetMarca();
    assert.equal((await marca.marcaRead(db, "tienda", { ...deps, fresh: true }))!.drift, null);
  });
});
