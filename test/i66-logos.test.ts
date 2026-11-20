// PLA-I66-1: a project's real logo. The detector's rules on fake repos (no git), the refresh against the test database
// with an injected git, and the screen's colour helpers.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i66-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const { detectLogo, looksLikeLogo, inspect } = await import("../src/brand/detect.js");
const { readPng } = await import("../src/brand/png.js");
const logos = await import("../src/brand/logos.js");
const { makeDb } = await import("../src/db/client.js");
const { bus } = await import("../src/events.js");
const ui = await import("../ui/src/lib/logos.js");

// ---------- fixtures ----------
const tile = (from: string, to: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><path d="M30 70V30h40" stroke="#fff" stroke-width="12" fill="none"/></svg>`;
const bare = (from: string, to: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient><mask id="m"><rect width="100" height="100" fill="#fff"/></mask></defs><path d="M30 70V30h40" stroke="url(#g)" stroke-width="12" fill="none" mask="url(#m)"/></svg>`;

/** An 8-bit RGBA PNG painted by a function of (x, y). */
function png(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = y % 2 ? 1 : 0; // mix filters: none and sub
    for (let x = 0; x < w; x++) {
      const px = paint(x, y);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 4; k++) {
        const left = x ? paint(x - 1, y)[k]! : 0;
        raw[o + k] = y % 2 ? (px[k]! - left + 256) & 255 : px[k]!;
      }
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255]! ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const fullTile = (n: number) => png(n, n, (x, y) => (x + y < n ? [230, 80, 60, 255] : [120, 40, 160, 255]));
const bareMark = (n: number) => png(n, n, (x, y) => (Math.abs(x - n / 2) < n / 6 && Math.abs(y - n / 2) < n / 3 ? [40, 120, 230, 255] : [0, 0, 0, 0]));
const svg = (p: string, s: string) => ({ path: p, bytes: Buffer.from(s) });

describe("the detector picks the logo", () => {
  test("reads the PNGs it makes, including the sub filter", () => {
    const p = readPng(fullTile(130))!;
    assert.equal(p.width, 130);
    assert.deepEqual([...p.rgba!.subarray(0, 4)], [230, 80, 60, 255]);
    assert.deepEqual([...p.rgba!.subarray((130 * 129 + 129) * 4, (130 * 129 + 129) * 4 + 4)], [120, 40, 160, 255]);
  });

  test("an SVG icon beats a big PNG, and its colours and variant are kept", () => {
    const { best } = detectLogo([{ path: "public/icon-512.png", bytes: fullTile(512) }, svg("public/brand/icon.svg", tile("#FF6A3D", "#C4237F"))], "tienda");
    assert.equal(best?.path, "public/brand/icon.svg");
    assert.equal(best?.variant, "icon");
    assert.deepEqual(best?.colors, ["#ff6a3d", "#c4237f"]);
  });

  test("among several, the icon on its own background beats the bare mark", () => {
    const { best, candidates } = detectLogo(
      [svg("public/brand/mark.svg", bare("#2563EB", "#8B3FD9")), svg("public/brand/icon-square.svg", tile("#2563EB", "#8B3FD9")), svg("public/brand/icon-rounded.svg", tile("#2563EB", "#8B3FD9"))],
      "tienda",
    );
    assert.equal(best?.path, "public/brand/icon-square.svg");
    assert.equal(candidates.find((c) => c.path.endsWith("mark.svg"))?.variant, "mark");
  });

  test("a file named after the project counts; the framework's own icon file too", () => {
    assert.equal(detectLogo([svg("public/tienda-icon.svg", tile("#112233", "#aa3344"))], "tienda").best?.path, "public/tienda-icon.svg");
    assert.equal(detectLogo([{ path: "src/app/icon.png", bytes: bareMark(256) }], "tienda").best?.variant, "mark");
  });

  test("template files, favicons and interface icons are never the logo", () => {
    const files = [
      svg("public/next.svg", tile("#000000", "#111111")),
      svg("public/vercel.svg", tile("#000000", "#111111")),
      svg("public/file.svg", tile("#000000", "#111111")),
      svg("public/icons/arrow-left.svg", tile("#000000", "#111111")),
      svg("src/components/icons/logo.svg", tile("#ff0000", "#00ff00")),
      svg("node_modules/pkg/public/logo.svg", tile("#ff0000", "#00ff00")),
      svg("public/splash/logo.svg", tile("#ff0000", "#00ff00")),
      svg("public/icon-512-maskable.svg", tile("#ff0000", "#00ff00")),
      { path: "src/app/favicon.ico", bytes: Buffer.from([0, 0, 1, 0]) },
    ];
    assert.equal(detectLogo(files, "tienda").best, null);
  });

  test("unsafe, tiny or wide files are left out", () => {
    assert.equal(inspect(svg("public/logo.svg", tile("#ff0000", "#00ff00").replace("<defs>", "<script>alert(1)</script><defs>")), "tienda"), null);
    assert.equal(inspect(svg("public/logo.svg", tile("#ff0000", "#00ff00").replace("<rect", '<rect onload="x()"')), "tienda"), null);
    assert.equal(inspect(svg("public/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80"><path d="M0 0h10"/></svg>'), "tienda"), null);
    assert.equal(inspect({ path: "public/logo.png", bytes: fullTile(64) }, "tienda"), null);
    assert.equal(inspect({ path: "public/logo.png", bytes: png(512, 200, () => [200, 50, 50, 255]) }, "tienda"), null);
  });

  test("a PNG is an icon when its edges are solid, a mark when they are see-through; colours from its corners", () => {
    const icon = inspect({ path: "public/logo.png", bytes: fullTile(256) }, "tienda")!;
    assert.equal(icon.variant, "icon");
    assert.deepEqual(icon.colors, ["#e6503c", "#7828a0"]);
    assert.equal(inspect({ path: "public/logo.png", bytes: bareMark(256) }, "tienda")!.variant, "mark");
  });

  test("where it looks: roots near the top, monorepo apps included", () => {
    assert.equal(looksLikeLogo("apps/web/public/logo.svg", "tienda"), true);
    assert.equal(looksLikeLogo("ui/public/favicon.svg", "tienda"), true);
    assert.equal(looksLikeLogo("assets/icon.png", "tienda"), true);
    assert.equal(looksLikeLogo("a/b/c/public/logo.svg", "tienda"), false);
    assert.equal(looksLikeLogo("public/a/b/c/logo.svg", "tienda"), false);
    assert.equal(looksLikeLogo("public/logo.jpg", "tienda"), false);
  });
});

// ---------- a fake git: branches point at commits, commits hold files ----------
type Repo = { refs: Record<string, string>; commits: Record<string, Record<string, Buffer>> };
function fakeGit(repo: Repo | null): import("../src/brand/logos.js").Git & { calls: string[][] } {
  const calls: string[][] = [];
  const git = (async (_cwd: string, args: string[]) => {
    calls.push(args);
    const no = { code: 1, stdout: Buffer.alloc(0) };
    if (!repo) return no;
    if (args[0] === "rev-parse") {
      const ref = args[3]!.replace("^{commit}", "");
      const sha = repo.refs[ref];
      return sha ? { code: 0, stdout: Buffer.from(`${sha}\n`) } : no;
    }
    if (args[0] === "ls-tree") {
      const files = repo.commits[args[4]!];
      if (!files) return no;
      return { code: 0, stdout: Buffer.from(Object.entries(files).map(([p, b]) => `100644 blob ${"a".repeat(40)} ${String(b.length).padStart(7)}\t${p}`).join("\0") + "\0") };
    }
    if (args[0] === "cat-file") {
      const [commit, p] = args[2]!.split(/:(.+)/);
      const b = repo.commits[commit!]?.[p!];
      return b ? { code: 0, stdout: b } : no;
    }
    return no;
  }) as import("../src/brand/logos.js").Git & { calls: string[][] };
  git.calls = calls;
  return git;
}
const C1 = "1".repeat(40), C2 = "2".repeat(40), C3 = "3".repeat(40);

describe("the refresh keeps the original in Plania", () => {
  let raw: Awaited<ReturnType<typeof resetTestDb>>;
  let db: ReturnType<typeof makeDb>["db"];
  let project: import("../src/db/schema.js").Project;
  const events: string[] = [];
  let off: () => void;

  before(async () => {
    raw = await resetTestDb();
    db = makeDb().db;
    off = bus.subscribe((e) => events.push(`${e.type}:${e.project}`));
  });
  after(async () => {
    off();
    await raw.end();
    rmSync(STORE, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await raw.query("delete from project_logos");
    await raw.query("delete from projects where slug = 'tienda'");
    await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
    const r = await raw.query("select * from projects where slug = 'tienda'");
    project = { ...r.rows[0], settings: r.rows[0].settings ?? {} } as never;
    events.length = 0;
    logos.forgetLogoLooks();
  });

  const repo = (): Repo => ({
    refs: { sandbox: C1 },
    commits: {
      [C1]: { "public/brand/mark.svg": Buffer.from(bare("#2563EB", "#8B3FD9")), "public/brand/icon.svg": Buffer.from(tile("#2563EB", "#8B3FD9")), "src/app/favicon.ico": Buffer.from([0, 0, 1, 0]) },
    },
  });

  test("a logo on the start branch becomes version 1, with its file, origin and commit", async () => {
    const r = await logos.scanProjectLogo(db, project, { git: fakeGit(repo()) });
    assert.equal(r.status, "found");
    assert.equal(r.logo?.version, 1);
    assert.equal(r.logo?.sourcePath, "public/brand/icon.svg");
    assert.equal(r.logo?.sourceCommit, C1);
    assert.equal(r.logo?.variant, "icon");
    assert.equal(r.logo?.source, "repo");
    assert.match(r.logo!.file, /^[0-9a-f]{64}\.svg$/);
    assert.ok(existsSync(path.join(STORE, "_marca", "tienda", r.logo!.file)));
    const read = await logos.logosRead(db);
    assert.deepEqual(read.tienda?.colors, ["#2563eb", "#8b3fd9"]);
    assert.equal((await logos.logoBytes(db, "tienda"))?.mime, "image/svg+xml");
    assert.ok(events.includes("project:tienda"));
  });

  test("the same commit is not read again; a newer commit with the same logo keeps the version", async () => {
    const rp = repo();
    await logos.scanProjectLogo(db, project, { git: fakeGit(rp) });
    const g = fakeGit(rp);
    assert.equal((await logos.scanProjectLogo(db, project, { git: g })).status, "same");
    assert.equal(g.calls.filter((c) => c[0] === "ls-tree").length, 0);
    rp.refs.sandbox = C2;
    rp.commits[C2] = rp.commits[C1]!;
    const r = await logos.scanProjectLogo(db, project, { git: fakeGit(rp) });
    assert.equal(r.status, "same");
    assert.equal(r.logo?.version, 1);
    assert.equal(r.logo?.sourceCommit, C2);
  });

  test("a changed logo in the repo becomes version 2 and the old one stays as history", async () => {
    const rp = repo();
    await logos.scanProjectLogo(db, project, { git: fakeGit(rp) });
    rp.refs.sandbox = C3;
    rp.commits[C3] = { "public/brand/icon.svg": Buffer.from(tile("#10B981", "#065F46")) };
    const r = await logos.scanProjectLogo(db, project, { git: fakeGit(rp) });
    assert.equal(r.status, "found");
    assert.equal(r.logo?.version, 2);
    const rows = (await raw.query("select version, active from project_logos order by version")).rows;
    assert.deepEqual(rows, [{ version: 1, active: false }, { version: 2, active: true }]);
  });

  test("a repo with only the framework's favicon gives no logo: the project keeps its letter", async () => {
    const r = await logos.scanProjectLogo(db, project, { git: fakeGit({ refs: { sandbox: C1 }, commits: { [C1]: { "src/app/favicon.ico": Buffer.from([0, 0, 1, 0]), "public/next.svg": Buffer.from(tile("#000000", "#111111")) } } }) });
    assert.equal(r.status, "none");
    assert.equal((await raw.query("select count(*)::int as n from project_logos")).rows[0].n, 0);
    assert.equal((await logos.logosRead(db)).tienda, undefined);
  });

  test("no repo, or a project that says it has no code, changes nothing", async () => {
    assert.equal((await logos.scanProjectLogo(db, project, { git: fakeGit(null) })).status, "no_repo");
    assert.equal((await logos.scanProjectLogo(db, { ...project, settings: { local: { no_code: true } } }, { git: fakeGit(repo()) })).status, "no_repo");
  });

  test("without the start branch it reads the remote one, then HEAD", async () => {
    const rp = repo();
    rp.refs = { HEAD: C1 };
    assert.equal((await logos.scanProjectLogo(db, project, { git: fakeGit(rp) })).status, "found");
  });

  test("a logo the owner chose is never replaced by the repo", async () => {
    await logos.addLogoVersion(db, project, { file: `${"b".repeat(64)}.png`, mime: "image/png", bytes: 10, variant: "icon", source: "upload", sourcePath: "mio.png", colors: [], chosen: true, actor: { agent: "owner", session_id: "s" } });
    const r = await logos.scanProjectLogo(db, project, { git: fakeGit(repo()) });
    assert.equal(r.status, "kept");
    assert.equal(r.logo?.source, "upload");
  });

  test("refreshLogos looks at a project at most once a minute", async () => {
    let now = 1_000_000;
    const g = fakeGit(repo());
    await logos.refreshLogos(db, { git: g, now: () => now });
    const first = g.calls.length;
    assert.ok(first > 0);
    await logos.refreshLogos(db, { git: g, now: () => now + 1000 });
    assert.equal(g.calls.length, first);
    now += logos.RECHECK_MS + 1;
    await logos.refreshLogos(db, { git: g, now: () => now });
    assert.ok(g.calls.length > first);
  });
});

describe("the screen's logo helpers", () => {
  const ref = { v: 3, file: "x.svg", mime: "image/svg+xml" as const, variant: "icon" as const, colors: ["#1e3a8a", "#8b3fd9"], source: "repo" as const, path: "public/logo.svg" };
  test("the URL carries the version", () => {
    assert.equal(ui.logoUrl("tienda", ref), "/api/company/projects/tienda/logo?v=3");
  });
  test("the gradient comes from the logo; one colour is used twice; none gives null", () => {
    assert.deepEqual(ui.logoGradient(ref), ["#1e3a8a", "#8b3fd9"]);
    assert.deepEqual(ui.logoGradient({ ...ref, colors: ["#ff6a3d"] }), ["#ff6a3d", "#ff6a3d"]);
    assert.equal(ui.logoGradient({ ...ref, colors: [] }), null);
    assert.equal(ui.logoGradient(undefined), null);
  });
  test("a dark logo colour is lightened to read on the dark surfaces; a light one stays", () => {
    assert.notEqual(ui.readableOnDark("#1e3a8a"), "#1e3a8a");
    assert.equal(ui.readableOnDark("#ff6a3d"), "#ff6a3d");
  });
  test("the store answers per project", () => {
    ui.setLogos({ tienda: ref });
    assert.equal(ui.logoOf("tienda")?.v, 3);
    assert.equal(ui.logoOf("otra"), undefined);
  });
});
