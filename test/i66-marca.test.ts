// PLA-I66-2: the Marca door. The checklist of icon files on fake Next.js and Vite repos (no git), the read that looks
// again when the start branch moves, and the screen's words and counts.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i66m-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const { checkRepo, icoSizes, reach, parseManifest, TEMPLATE_ICO } = await import("../src/brand/check.js");
const marca = await import("../src/brand/marca.js");
const logos = await import("../src/brand/logos.js");
const { makeDb } = await import("../src/db/client.js");
const ui = await import("../ui/src/lib/marca.js");
const { setLanguageForTests: setLanguage } = await import("../ui/src/lib/i18n.js");

// ---------- fixtures ----------
function png(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) Buffer.from(paint(x, y)).copy(raw, y * (w * 4 + 1) + 1 + x * 4);
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255]! ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
/** A gradient tile with a white square in the middle reaching r of the width from the centre. */
const tile = (n: number, r: number, alpha = 255) =>
  png(n, n, (x, y) => (Math.abs(x + 0.5 - n / 2) < r * n * 0.7 && Math.abs(y + 0.5 - n / 2) < r * n * 0.7 ? [255, 255, 255, 255] : [200 - Math.round((x + y) / (2 * n) * 120), 60, 140, alpha]));
function ico(...sizes: number[]): Buffer {
  const b = Buffer.alloc(6 + 16 * sizes.length);
  b.writeUInt16LE(0, 0); b.writeUInt16LE(1, 2); b.writeUInt16LE(sizes.length, 4);
  sizes.forEach((s, i) => { b[6 + 16 * i] = s === 256 ? 0 : s; b[7 + 16 * i] = s === 256 ? 0 : s; });
  return b;
}
const view = (files: Record<string, Buffer | string>) => {
  const m = new Map(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? Buffer.from(v) : v] as const));
  return { paths: new Map([...m].map(([k, v]) => [k, v.length])), read: async (p: string) => m.get(p) ?? null };
};
const row = (rows: { id: string }[], id: string) => rows.find((r) => r.id === id) as import("../src/brand/check.js").Row;

const MANIFEST_TS = `import type { MetadataRoute } from "next";
const CANVAS = "#0e1114";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "Tienda", short_name: "Tienda", start_url: "/", display: "standalone", background_color: CANVAS, theme_color: CANVAS,
    icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
    shortcuts: [{ name: "Nuevo", url: "/n", icons: [{ src: "/icons/short.png", sizes: "96x96" }] }] };
}`;
const nextRepo = (over: Record<string, Buffer | string | null> = {}) => {
  const base: Record<string, Buffer | string> = {
    "package.json": `{"dependencies":{"next":"16"}}`,
    "src/app/layout.tsx": `export const metadata = { icons: { icon: [{ url: "/brand/mark.svg", type: "image/svg+xml" }], apple: [{ url: "/apple-touch-icon.png" }] } };`,
    "src/app/favicon.ico": ico(48, 32, 16),
    "src/app/manifest.ts": MANIFEST_TS,
    "src/app/opengraph-image.tsx": "export default function Og() { return null; }",
    "public/brand/mark.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>`,
    "public/apple-touch-icon.png": tile(180, 0.3),
    "public/icons/icon-192.png": tile(192, 0.3),
    "public/icons/icon-512.png": tile(512, 0.3),
    "public/icons/icon-512-maskable.png": tile(512, 0.3),
  };
  for (const [k, v] of Object.entries(over)) if (v === null) delete base[k]; else base[k] = v;
  return view(base);
};

describe("the checklist of icon files", () => {
  test("a complete Next.js App Router repo: every row in the repo, the optional ones missing quietly", async () => {
    const r = await checkRepo(nextRepo(), { hasOriginal: true, slug: "tienda" });
    assert.equal(r.framework, "next-app");
    const states = Object.fromEntries(r.rows.map((x) => [x.id, x.state]));
    assert.deepEqual(states, { ico: "ok", svg: "ok", apple: "ok", splash: "falta", man: "ok", a192: "ok", a512: "ok", mask: "ok", mono: "falta", og: "ok", pl: "ok" });
    assert.ok(row(r.rows, "splash").optional && row(r.rows, "mono").optional);
    assert.equal(row(r.rows, "og").note?.k, "og_code");
    assert.equal(row(r.rows, "ico").size, "16 · 32 · 48");
  });

  test("a transparent apple-touch-icon is wrong; a maskable reaching past 40 % is wrong; three equal favicons warn", async () => {
    const r = await checkRepo(nextRepo({ "public/apple-touch-icon.png": tile(180, 0.3, 0), "public/icons/icon-512-maskable.png": tile(512, 0.47), "public/favicon.ico": ico(48, 32, 16), "public/icons/favicon.ico": ico(48, 32, 16) }), { hasOriginal: true, slug: "tienda" });
    const apple = row(r.rows, "apple");
    assert.equal(apple.state, "mal");
    assert.ok(apple.checks.some((c) => c.k === "opaque_ios" && !c.ok));
    const mask = row(r.rows, "mask");
    assert.equal(mask.state, "mal");
    assert.ok(mask.checks.some((c) => c.k === "safe_zone" && !c.ok));
    assert.equal(row(r.rows, "ico").note?.k, "copies");
    assert.equal(row(r.rows, "ico").note?.v?.n, 3);
  });

  test("the framework's template favicon is wrong; a wrong size is said with both sizes; an «any maskable» entry is wrong", async () => {
    const template = ico(48, 32, 16);
    TEMPLATE_ICO.add(createHashOf(template));
    const r = await checkRepo(
      nextRepo({ "public/apple-touch-icon.png": tile(152, 0.3), "src/app/manifest.ts": MANIFEST_TS.replace('purpose: "maskable"', 'purpose: "any maskable"') }),
      { hasOriginal: true, slug: "tienda" },
    );
    TEMPLATE_ICO.delete(createHashOf(template));
    assert.equal(row(r.rows, "ico").state, "mal");
    assert.ok(row(r.rows, "ico").checks.some((c) => c.k === "template"));
    assert.deepEqual(row(r.rows, "apple").checks.find((c) => c.k === "size")?.v, { want: "180 × 180", got: "152 × 152" });
    assert.ok(row(r.rows, "mask").checks.some((c) => c.k === "mask_own" && !c.ok));
  });

  test("an SVG logo nothing links is missing with the reason; a bare repo has everything missing", async () => {
    const r = await checkRepo(nextRepo({ "src/app/layout.tsx": "export const metadata = {};" }), { hasOriginal: false, slug: "tienda" });
    assert.equal(row(r.rows, "svg").state, "falta");
    assert.deepEqual(row(r.rows, "svg").note, { k: "svg_unlinked", v: { path: "public/brand/mark.svg" } });
    assert.equal(row(r.rows, "pl").state, "falta");
    const bare = await checkRepo(view({ "package.json": "{}", "app/layout.tsx": "" }), { hasOriginal: false, slug: "tienda" });
    assert.ok(bare.rows.every((x) => x.state === "falta"));
    assert.equal(row(bare.rows, "ico").path, "app/favicon.ico");
  });

  test("a Vite app in a sub-folder: the links in index.html", async () => {
    const r = await checkRepo(
      view({
        "package.json": "{}",
        "vite.config.ts": "",
        "ui/index.html": `<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest"><meta property="og:image" content="/og.png">`,
        "ui/public/favicon.svg": "<svg/>",
        "ui/public/apple-touch-icon.png": tile(180, 0.3),
        "ui/public/manifest.webmanifest": JSON.stringify({ name: "T", short_name: "T", display: "standalone", theme_color: "#000000", background_color: "#000000", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }, { src: "/icons/icon-512.png", sizes: "512x512", purpose: "monochrome" }] }),
        "ui/public/icons/icon-192.png": tile(192, 0.3),
        "ui/public/icons/icon-512.png": tile(512, 0.3),
      }),
      { hasOriginal: true, slug: "tienda" },
    );
    assert.equal(r.framework, "vite");
    assert.equal(r.root, "ui/");
    const states = Object.fromEntries(r.rows.map((x) => [x.id, x.state]));
    assert.deepEqual(states, { ico: "falta", svg: "ok", apple: "ok", splash: "falta", man: "ok", a192: "ok", a512: "falta", mask: "falta", mono: "ok", og: "ok", pl: "ok" });
  });

  test("the pieces: ico sizes, the reach over a gradient, a manifest with constants and shortcut icons", () => {
    assert.deepEqual(icoSizes(ico(48, 16, 32, 256)), [16, 32, 48, 256]);
    assert.ok(Math.abs(reach(tile(256, 0.3))! - 0.3) < 0.02);
    const m = parseManifest("src/app/manifest.ts", MANIFEST_TS);
    assert.equal(m.theme, "CANVAS");
    assert.equal(m.icons.length, 3);
  });
});

import { createHash } from "node:crypto";
function createHashOf(b: Buffer) {
  return createHash("sha256").update(b).digest("hex");
}

// ---------- the read, with a fake git ----------
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

describe("the Marca read", () => {
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
    await raw.query("delete from project_logos");
    await raw.query("delete from projects where slug = 'tienda'");
    await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
    marca.forgetMarca();
    logos.forgetLogoLooks();
  });


  test("after a merge that adds a file, the next look turns its row green on its own", async () => {
    const base: Record<string, Buffer> = {
      "package.json": Buffer.from("{}"),
      "src/app/layout.tsx": Buffer.from(""),
      "public/brand/icon.svg": Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#2563eb"/><path d="M20 20h60" stroke="#fff"/></svg>`),
    };
    const repo: Repo = { refs: { sandbox: "1".repeat(40) }, commits: { ["1".repeat(40)]: base } };
    let now = 5_000_000;
    const deps = { git: fakeGit(repo), now: () => now };
    const first = (await marca.marcaRead(db, "tienda", deps))!;
    assert.equal(first.framework, "next-app");
    assert.equal(first.rows.find((r) => r.id === "apple")?.state, "falta");
    assert.equal(first.logo?.path, "public/brand/icon.svg");
    assert.equal(first.rows.find((r) => r.id === "pl")?.state, "ok");
    // The merge lands.
    repo.refs.sandbox = "2".repeat(40);
    repo.commits["2".repeat(40)] = { ...base, "src/app/apple-icon.png": tile(180, 0.3) };
    const cached = (await marca.marcaRead(db, "tienda", { ...deps, now: () => now + 1000 }))!;
    assert.equal(cached.rows.find((r) => r.id === "apple")?.state, "falta", "within the minute it answers from the last look");
    now += logos.RECHECK_MS + 1;
    const after = (await marca.marcaRead(db, "tienda", deps))!;
    assert.equal(after.commit, "2".repeat(40));
    assert.equal(after.rows.find((r) => r.id === "apple")?.state, "ok");
    // Its file is served for the card; a path the read did not show is not.
    assert.equal((await marca.marcaFile(db, "tienda", "src/app/apple-icon.png", deps))?.mime, "image/png");
    assert.equal(await marca.marcaFile(db, "tienda", "package.json", deps), null);
  });

  test("a project with no repo says so and keeps the list waiting", async () => {
    const r = (await marca.marcaRead(db, "tienda", { git: async () => ({ code: 1, stdout: Buffer.alloc(0) }) }))!;
    assert.equal(r.repo, "none");
    assert.equal(r.framework, null);
    assert.equal(await marca.marcaRead(db, "nadie", {}), null);
  });
});

describe("the screen's Marca words and counts", () => {
  const rows = (s: Record<string, "ok" | "falta" | "mal">) =>
    Object.entries(s).map(([id, state]) => ({ id, face: id === "ico" ? "nav" : id === "mono" ? "and" : "ios", state, path: null, optional: id === "mono", checks: [] })) as import("../ui/src/lib/marca.js").MarcaRow[];
  test("an absent optional file is not counted as missing, nor does it dim its card", () => {
    const r = rows({ ico: "ok", apple: "falta", mono: "falta" });
    assert.deepEqual(ui.counts(r), { ok: 1, missing: 1, wrong: 0 });
    assert.equal(ui.faceState(r, "and").worst, "ok");
    assert.equal(ui.faceState(r, "ios").worst, "falta");
    assert.equal(ui.doorCount(r), "1 FALTA");
    assert.equal(ui.doorCount(rows({ ico: "ok" })), "COMPLETA");
  });
  test("checks and notes are worded in each language; an unknown code shows as itself", () => {
    const w = ui.marcaWords();
    assert.equal(ui.sentence(w.check, { k: "safe_zone", v: { pct: "35.3 %" } }), "Zona segura: el dibujo llega al 35.3 % del ancho (máx. 40 %)");
    assert.equal(ui.sentence(w.check, { k: "nuevo" }), "nuevo");
    setLanguage("en");
    try {
      assert.equal(ui.sentence(ui.marcaWords().note, { k: "copies", v: { n: 3, list: "a, b, c" } }), "There are 3 identical copies (a, b, c). It works; one is enough.");
      assert.equal(ui.doorCount(rows({ ico: "mal" })), "1 MISSING");
    } finally {
      setLanguage("es");
    }
  });
  test("rows go in card order and a file's address is encoded", () => {
    assert.deepEqual(ui.sortedRows(rows({ mono: "ok", ico: "ok" })).map((r) => r.id), ["ico", "mono"]);
    assert.equal(ui.fileUrl("tienda", "public/a b.png"), "/api/company/projects/tienda/marca/file?path=public%2Fa%20b.png");
  });
});
