// PLA-I66-3: the owner's own logo: what an upload is checked for, how it is fitted, the pixel tests, and the versions
// (an upload, a repo candidate, going back, letting the repo lead again).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i66u-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const up = await import("../src/brand/upload.js");
const logos = await import("../src/brand/logos.js");
const marca = await import("../src/brand/marca.js");
const { makeDb } = await import("../src/db/client.js");
const ui = await import("../ui/src/lib/marca.js");

const svgMark = (stroke = 14, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${extra}<path d="M25 75V25h50" stroke="#2563eb" stroke-width="${stroke}" fill="none" stroke-linecap="round"/></svg>`;
const pngOf = (svg: string, size: number, bg?: string) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).flatten(bg ? { background: bg } : undefined).png().toBuffer();
const wide = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: "#f3e6e0" } }).png().toBuffer();

describe("checking an upload", () => {
  test("the kind comes from the first bytes, not the name", async () => {
    assert.equal(up.sniff(await wide(10, 10)), "png");
    assert.equal(up.sniff(Buffer.from(svgMark())), "svg");
    assert.equal(up.sniff(Buffer.from(`<?xml version="1.0"?>\n${svgMark()}`)), "svg");
    assert.equal(up.sniff(Buffer.from("<html><svg></svg></html>")), null);
    assert.equal(up.sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])), "jpeg");
  });

  test("an SVG loses its scripts, events and outside links and stays a drawing", () => {
    const dirty = svgMark(14, `<script>alert(1)</script><a xlink:href="https://x.example/p"><rect onload="steal()" width="1" height="1"/></a><use href="#p"/>`);
    const { svg, changed } = up.cleanSvg(dirty);
    assert.ok(changed);
    assert.doesNotMatch(svg, /<script|onload|https:/);
    assert.match(svg, /href="#p"/);
    assert.match(svg, /<path/);
    assert.equal(up.cleanSvg(svgMark()).changed, false);
  });

  test("a picture under 512 px is held back with the reason; under 1024 it warns; a wide one is centred", async () => {
    const tiny = await up.stageUpload("tienda", await wide(360, 300), "viejo.png");
    assert.ok(tiny.block);
    assert.ok(tiny.checks.some((c) => c.k === "too_small" && c.ok === false));
    assert.ok(tiny.checks.some((c) => c.k === "not_square" && c.ok === "warn"));
    const mid = await up.stageUpload("tienda", await pngOf(svgMark(), 600, "#ffffff"), "medio.png");
    assert.equal(mid.block, null);
    assert.ok(mid.checks.some((c) => c.k === "small" && c.ok === "warn"));
    assert.equal(mid.hasAlpha, false);
  });

  test("a transparent SVG is staged clean, with a palette and no block", async () => {
    const s = await up.stageUpload("tienda", Buffer.from(svgMark(14, "<script>x()</script>")), "marca.svg");
    assert.equal(s.kind, "svg");
    assert.equal(s.block, null);
    assert.ok(s.hasAlpha);
    assert.ok(s.checks.some((c) => c.k === "svg_cleaned"));
    assert.ok(s.palette[0]?.startsWith("#2"));
    // A blue mark starts on white (its best plate), never on its own colour.
    assert.deepEqual(ui.startAdjust(s), { scale: 70, bg: "#ffffff" });
    assert.deepEqual(ui.startAdjust({ ...s, palette: ["#fde68a"] }), { scale: 70, bg: ui.DARK_PLATE });
  });

  test("refusals carry a code: empty, too big, not an image, nothing left after cleaning", async () => {
    await assert.rejects(up.stageUpload("tienda", Buffer.alloc(0), "x"), { code: "LOGO_EMPTY" });
    await assert.rejects(up.stageUpload("tienda", Buffer.alloc(up.MAX_UPLOAD_BYTES + 1, 1), "x"), { code: "LOGO_TOO_BIG" });
    await assert.rejects(up.stageUpload("tienda", Buffer.from("hola"), "x.png"), { code: "LOGO_TYPE" });
    await assert.rejects(up.stageUpload("tienda", Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div onclick="x"/></foreignObject><image href="http://a.example/i.png"/></svg>`.replace("<image href", "<image xlink:href")), "x.svg"), (e: { code?: string }) => e.code === "LOGO_UNSAFE" || e.code === "LOGO_UNREADABLE");
  });
});

describe("fitting and the pixel tests", () => {
  test("a solid mark on a dark background passes all three", async () => {
    const s = await up.stageUpload("tienda", Buffer.from(svgMark(14)), "m.svg");
    const p = await up.previewUpload("tienda", s.up, 70, "#111827");
    const meta = await sharp(p.png).metadata();
    assert.equal(meta.width, 512);
    assert.deepEqual([p.tests.small.ok, p.tests.circle.ok, p.tests.contrast.ok], [true, true, true]);
  });

  test("hairlines vanish at 16 px; a full-size drawing leaves the circle; a pale one on white lacks contrast", async () => {
    const thin = await up.stageUpload("tienda", Buffer.from(svgMark(2)), "fino.svg");
    assert.equal((await up.previewUpload("tienda", thin.up, 70, "#111827")).tests.small.ok, false);
    const big = await up.stageUpload("tienda", Buffer.from(svgMark(14)), "m.svg");
    assert.equal((await up.previewUpload("tienda", big.up, 100, "#111827")).tests.circle.ok, false);
    const pale = await up.stageUpload("tienda", Buffer.from(svgMark(14).replace("#2563eb", "#e5e7eb")), "p.svg");
    assert.equal((await up.previewUpload("tienda", pale.up, 70, "#ffffff")).tests.contrast.ok, false);
  });

  test("the screen words the tests", () => {
    const lines = ui.testLines({ small: { ok: false, v: 0.26 }, circle: { ok: true, v: 0.33 }, contrast: { ok: true, v: 6.2 } });
    assert.deepEqual(lines.map((l) => l.text), ["A 16 px se pierde el 26 % del dibujo", "Cabe en el círculo de Android (llega al 33 %)", "Contraste 6.2 : 1"]);
  });

  test("a size or a background out of range is refused", async () => {
    const s = await up.stageUpload("tienda", Buffer.from(svgMark()), "m.svg");
    await assert.rejects(up.previewUpload("tienda", s.up, 20, null), { code: "LOGO_ADJUST" });
    await assert.rejects(up.previewUpload("tienda", s.up, 70, "red"), { code: "LOGO_ADJUST" });
    await assert.rejects(up.previewUpload("tienda", `${"0".repeat(64)}.png`, 70, null), { code: "LOGO_UPLOAD_GONE" });
  });
});

// ---------- versions against the test database ----------
type Repo = { refs: Record<string, string>; commits: Record<string, Record<string, Buffer>> };
function fakeGit(repo: Repo): import("../src/brand/logos.js").Git {
  return async (_cwd, args) => {
    const no = { code: 1, stdout: Buffer.alloc(0) };
    if (args[0] === "rev-parse") {
      const sha = repo.refs[args[3]!.replace("^{commit}", "")];
      return sha ? { code: 0, stdout: Buffer.from(sha) } : no;
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
const tile = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${color}"/><path d="M30 70V30h40" stroke="#fff" stroke-width="12" fill="none"/></svg>`;

describe("choosing the original", () => {
  let raw: Awaited<ReturnType<typeof resetTestDb>>;
  let db: ReturnType<typeof makeDb>["db"];
  let project: import("../src/db/schema.js").Project;
  const C1 = "1".repeat(40);
  const repo: Repo = { refs: { sandbox: C1 }, commits: { [C1]: { "package.json": Buffer.from("{}"), "src/app/layout.tsx": Buffer.from(""), "public/brand/icon.svg": Buffer.from(tile("#2563eb")), "public/icon.svg": Buffer.from(tile("#10b981")) } } };
  const deps = { git: fakeGit(repo) };
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
    await raw.query("delete from projects where slug = 'tienda'");
    await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
    project = (await raw.query("select * from projects where slug = 'tienda'")).rows[0];
    project.settings ??= {};
    marca.forgetMarca();
    logos.forgetLogoLooks();
  });

  test("an upload becomes a chosen version that the repo never replaces; a vector kept as it is stays SVG", async () => {
    await marca.marcaRead(db, "tienda", deps);
    const s = await up.stageUpload("tienda", Buffer.from(svgMark(14)), "nuevo.svg");
    const fitted = await up.useUpload(db, project, { up: s.up, name: "nuevo.svg", scale: 70, bg: "#111827" }, owner);
    assert.deepEqual([fitted.version, fitted.source, fitted.chosen, fitted.mime, fitted.variant], [2, "upload", true, "image/png", "icon"]);
    assert.deepEqual(fitted.adjust, { raw: s.up, name: "nuevo.svg", scale: 70, bg: "#111827" });
    assert.equal(fitted.colors[0], "#111827");
    assert.equal((await logos.scanProjectLogo(db, project, deps)).status, "kept");
    const asIs = await up.useUpload(db, project, { up: s.up, name: "nuevo.svg", scale: 100, bg: null }, owner);
    assert.equal(asIs.mime, "image/svg+xml");
    assert.equal(asIs.variant, "mark");
  });

  test("another candidate of the repo becomes the original; a path that is not one is refused", async () => {
    const r = (await marca.marcaRead(db, "tienda", deps))!;
    assert.equal(r.logo?.path, "public/brand/icon.svg");
    assert.ok(r.candidates.some((c) => c.path === "public/icon.svg"));
    const picked = await up.useCandidate(db, project, "public/icon.svg", owner, deps);
    assert.deepEqual([picked.sourcePath, picked.chosen, picked.version], ["public/icon.svg", true, 2]);
    await assert.rejects(up.useCandidate(db, project, "package.json", owner, deps), { code: "LOGO_NOT_CANDIDATE" });
  });

  test("going back to a version makes it the owner's choice; letting the repo lead hands it back", async () => {
    await marca.marcaRead(db, "tienda", deps);
    await up.useCandidate(db, project, "public/icon.svg", owner, deps);
    const back = await up.activateVersion(db, project, 1);
    assert.deepEqual([back.version, back.active, back.chosen], [1, true, true]);
    const vs = await up.listVersions(db, project.id);
    assert.deepEqual(vs.map((v) => [v.v, v.active]), [[2, false], [1, true]]);
    assert.equal((await up.versionBytes(db, "tienda", 2))?.mime, "image/svg+xml");
    await assert.rejects(up.activateVersion(db, project, 9), { code: "LOGO_VERSION_NOT_FOUND" });
    // The repo leads again: version 1 is the repo's own best, so nothing new is made.
    await up.releaseChoice(db, project);
    logos.forgetLogoLooks();
    const r = await logos.scanProjectLogo(db, project, deps);
    assert.notEqual(r.status, "kept");
    assert.equal((await logos.activeLogo(db, project.id))?.chosen, false);
  });
});
