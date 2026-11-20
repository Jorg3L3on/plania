// PLA-I66-6: native app icons and iPhone launch screens, off by default. The checklist with the switch off and on, for
// a web-only repo, an Expo app and a Capacitor app; the launch-screen set; the plan, the files made; the setting.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i66n-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const { checkRepo, opaque, SPLASH_SIZES } = await import("../src/brand/check.js");
const gen = await import("../src/brand/generate.js");
const { setProject } = await import("../src/mcp/project.js");
const { settingsCtx } = await import("../src/api/project-settings.js");
const { makeDb } = await import("../src/db/client.js");

const view = (files: Record<string, Buffer | string>) => {
  const m = new Map(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? Buffer.from(v) : v] as const));
  return { paths: new Map([...m].map(([k, v]) => [k, v.length])), read: async (p: string) => m.get(p) ?? null };
};
const png = (w: number, h: number, alpha = 1) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 30, g: 60, b: 200, alpha } } }).png().toBuffer();
const NEXT = { "package.json": "{}", "src/app/layout.tsx": "" };
const row = (rows: { id: string }[], id: string) => rows.find((r) => r.id === id) as import("../src/brand/check.js").Row | undefined;
const tileSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#7c3aed"/><path d="M30 70V30h40" stroke="#fff" stroke-width="12" fill="none"/></svg>`;
const original = { bytes: Buffer.from(tileSvg), mime: "image/svg+xml" as const, variant: "icon" as const, colors: ["#7c3aed"] };

describe("the checklist with the native switch", () => {
  test("off (the default): no native rows, launch screens optional", async () => {
    const r = await checkRepo(view(NEXT), { hasOriginal: true, slug: "tienda" });
    assert.equal(row(r.rows, "ios_app"), undefined);
    assert.equal(row(r.rows, "splash")?.optional, true);
  });

  test("on, a web-only repo: launch screens count, the native icons are missing and wait in assets/", async () => {
    const r = await checkRepo(view(NEXT), { hasOriginal: true, slug: "tienda", native: true });
    assert.equal(row(r.rows, "splash")?.optional, false);
    assert.equal(row(r.rows, "splash")?.state, "falta");
    assert.deepEqual([row(r.rows, "ios_app")?.state, row(r.rows, "ios_app")?.path, row(r.rows, "ios_app")?.note?.k], ["falta", "assets/icon.png", "web_only"]);
    assert.equal(row(r.rows, "and_app")?.path, "assets/adaptive-icon.png");
  });

  test("an Expo app: the 1024 icon and the adaptive layers from app.json; a missing monochrome layer is wrong", async () => {
    const app = (mono: boolean) => JSON.stringify({ expo: { icon: "./assets/icon.png", android: { adaptiveIcon: { foregroundImage: "./assets/fg.png", backgroundColor: "#ffffff", ...(mono ? { monochromeImage: "./assets/mono.png" } : {}) } } } });
    const files = { ...NEXT, "app.json": app(true), "assets/icon.png": await png(1024, 1024), "assets/fg.png": await png(1024, 1024, 0), "assets/mono.png": await png(1024, 1024, 0) };
    const ok = await checkRepo(view(files), { hasOriginal: true, slug: "tienda", native: true });
    assert.deepEqual([row(ok.rows, "ios_app")?.state, row(ok.rows, "and_app")?.state], ["ok", "ok"]);
    const noMono = await checkRepo(view({ ...files, "app.json": app(false), "assets/icon.png": await png(512, 512) }), { hasOriginal: true, slug: "tienda", native: true });
    assert.equal(row(noMono.rows, "and_app")?.state, "mal");
    assert.ok(row(noMono.rows, "and_app")!.checks.some((c) => c.k === "adaptive_mono" && !c.ok));
    assert.equal(row(noMono.rows, "ios_app")?.state, "mal");
  });

  test("a Capacitor app: the appiconset and the adaptive XML; the launch-screen set must cover every size", async () => {
    const splash: Record<string, Buffer> = {};
    for (const [w, h] of SPLASH_SIZES) splash[`public/splash/apple-splash-${w}x${h}.png`] = Buffer.from("x");
    const files = {
      ...NEXT,
      "src/app/layout.tsx": "export const metadata = { appleWebApp: { startupImage: [] } };",
      "capacitor.config.ts": "export default {};",
      "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png": await png(1024, 1024),
      "android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml": "<adaptive-icon><background/><foreground/></adaptive-icon>",
      ...splash,
    };
    const r = await checkRepo(view(files), { hasOriginal: true, slug: "tienda", native: true });
    assert.equal(row(r.rows, "ios_app")?.state, "ok");
    assert.equal(row(r.rows, "and_app")?.state, "mal");
    assert.equal(row(r.rows, "splash")?.state, "ok");
    delete files["public/splash/apple-splash-640x1136.png" as keyof typeof files];
    const short = await checkRepo(view(files), { hasOriginal: true, slug: "tienda", native: true });
    assert.equal(row(short.rows, "splash")?.state, "mal");
    assert.ok(row(short.rows, "splash")!.checks.some((c) => c.k === "splash_full" && !c.ok));
  });
});

describe("the plan and the files", () => {
  test("Expo: the icon, the adaptive layers and the launch screens, with the app.json and layout edits", async () => {
    const r = await checkRepo(view({ ...NEXT, "app.json": JSON.stringify({ expo: { name: "T" } }) }), { hasOriginal: true, slug: "tienda", native: true });
    const plan = gen.planFor(r.rows, { framework: r.framework, root: r.root }, "faltan", true, true);
    const at = Object.fromEntries(plan.items.map((i) => [i.key, i.path]));
    assert.equal(at.splash, "public/splash/");
    assert.equal(at.ios_app, "assets/icon.png");
    assert.equal(at.and_app, "assets/adaptive-icon.png");
    assert.ok(plan.edits.some((e) => e.what === "expo_icons" && e.path === "app.json"));
    assert.ok(plan.edits.some((e) => e.what === "layout_splash"));
    assert.equal(gen.planFor(r.rows, { framework: r.framework, root: r.root }, "faltan", true, false).items.some((i) => i.key === "splash"), false, "off: nothing native in the plan");
    const files = await gen.generate(original, { ...plan, items: plan.items.filter((i) => ["splash", "ios_app", "and_app"].includes(i.key)) }, { name: "T", theme: "#0e1114", rows: r.rows, root: r.root });
    const splash = files.filter((f) => f.key === "splash");
    assert.equal(splash.length, SPLASH_SIZES.length);
    const one = await sharp(splash.find((f) => f.path.endsWith("1179x2556.png"))!.bytes).metadata();
    assert.deepEqual([one.width, one.height], [1179, 2556]);
    const ios = files.find((f) => f.key === "ios_app")!;
    assert.deepEqual([(await sharp(ios.bytes).metadata()).width, opaque(ios.bytes)], [1024, true]);
    const fg = files.find((f) => f.path === "assets/adaptive-icon.png")!;
    const { data } = await sharp(fg.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0, "the foreground has no background");
    assert.ok(files.some((f) => f.path === "assets/adaptive-monochrome.png"));
  });

  test("Capacitor: the sources @capacitor/assets builds from, and the instruction to run it", async () => {
    const r = await checkRepo(view({ ...NEXT, "capacitor.config.ts": "export default {};" }), { hasOriginal: true, slug: "tienda", native: true });
    const plan = gen.planFor(r.rows, { framework: r.framework, root: r.root }, "faltan", true, true);
    const at = Object.fromEntries(plan.items.map((i) => [i.key, i.path]));
    assert.equal(at.ios_app, "assets/icon-only.png");
    assert.equal(at.and_app, "assets/icon-foreground.png");
    assert.ok(plan.edits.some((e) => e.what === "capacitor_assets"));
    const files = await gen.generate(original, { ...plan, items: plan.items.filter((i) => i.key === "and_app") }, { name: "T", theme: null, rows: r.rows, root: r.root });
    assert.deepEqual(files.map((f) => f.path).sort(), ["assets/icon-background.png", "assets/icon-foreground.png", "assets/icon-monochrome.png"]);
  });
});

describe("the setting", () => {
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
  test("settings.marca takes {native: boolean} and nothing else", async () => {
    const v = async () => (await raw.query("select version from projects where slug = 'zigzag'")).rows[0].version as number;
    const out = await setProject(db, { project: "zigzag", version: await v(), settings: { marca: { native: true } } }, settingsCtx);
    assert.deepEqual((out.settings as Record<string, unknown>).marca, { native: true });
    await assert.rejects(setProject(db, { project: "zigzag", version: await v(), settings: { marca: { native: "yes" } } }, settingsCtx), /INVALID_FILTER/);
    await assert.rejects(setProject(db, { project: "zigzag", version: await v(), settings: { marca: { colour: 1 } } }, settingsCtx), /INVALID_FILTER/);
  });
});
