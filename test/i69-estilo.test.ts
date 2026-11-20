// PLA-I69-4: Estilo. The brand's colours, type and shapes are kept in Plania with every version, read from the repo
// as it is, written as brand.css (Tailwind 4 @theme) and tokens.json (W3C), and brought to the repo by Taller.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i69e-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const color = await import("../src/brand/color.js");
const uiColor = await import("../ui/src/lib/color.js");
const style = await import("../src/brand/style.js");
const { stageUpload, useUpload } = await import("../src/brand/upload.js");
const { makeDb } = await import("../src/db/client.js");

const C1 = "1".repeat(40);
const GLOBALS = `@import "tailwindcss";\n:root { --primary: oklch(0.55 0.2 25); --radius: 0.75rem; }\n`;
const LAYOUT = `import { Inter, Fraunces } from "next/font/google";\nexport default function L() { return null; }`;
let files: Record<string, Buffer> = {};
const reset = () => {
  files = {
    "package.json": Buffer.from(`{"dependencies":{"next":"15"}}`),
    "src/app/layout.tsx": Buffer.from(LAYOUT),
    "src/app/globals.css": Buffer.from(GLOBALS),
    "src/components/boton.tsx": Buffer.from(`export const B = () => <button style={{ background: "#8C2F39" }} className="text-[#8c2f39]" />;`),
    "src/components/otro.tsx": Buffer.from(`export const O = () => <div style={{ color: "#123456" }} />;`),
  };
};
reset();
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
const view = () => ({ paths: new Map(Object.entries(files).map(([k, v]) => [k, v.length])), read: async (p: string) => files[p] ?? null });
const ACTOR = { agent: "test", session_id: "s-i69e" } as never;
const tile = (fill: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${fill}"/><circle cx="50" cy="50" r="22" fill="#ffffff"/></svg>`), { density: 600 }).resize(1024, 1024).png().toBuffer();

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
  reset();
  style.forgetStyle();
  rmSync(path.join(STORE, "_marca", "tienda"), { recursive: true, force: true });
  await raw.query("delete from project_logos");
  await raw.query("delete from tasks where project_id in (select id from projects where slug = 'tienda')");
  await raw.query("delete from agents where project_id in (select id from projects where slug = 'tienda')");
  await raw.query("delete from projects where slug = 'tienda'");
  await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
  project = (await raw.query("select * from projects where slug = 'tienda'")).rows[0];
  project.settings ??= {};
});

test("#1 the colour math: the server and the screen agree, contrast is WCAG's, scales keep their hue", () => {
  for (const c of ["#8c2f39", "#0f766e", "#4f46e5", "#ffffff", "#000000", "#e5b80b"]) {
    assert.deepEqual(uiColor.toLch(c), color.toLch(c), c);
    assert.deepEqual(uiColor.scale(c), color.scale(c), c);
    assert.equal(uiColor.onColor(c), color.onColor(c), c);
  }
  assert.equal(Math.round(color.contrast("#000000", "#ffffff") * 10) / 10, 21);
  assert.equal(color.fromLch(...color.toLch("#8c2f39")), "#8c2f39", "a round trip keeps the colour");
  const sc = color.scale("#0f766e");
  assert.equal(sc.length, 11);
  for (const s of sc.slice(2, 9)) assert.ok(Math.abs(color.toLch(s)[2] - color.toLch("#0f766e")[2]) < 6, `hue of ${s}`);
  assert.equal(color.oklchCss("oklch(0.55 0.2 25)"), color.oklchCss("oklch(55% 0.2 25)"));
});

test("#2 the repo's style is read, not guessed: oklch brand, rem radius, next/font families", async () => {
  const r = await style.readRepoStyle(view(), "");
  assert.equal(r.brand, color.oklchCss("oklch(0.55 0.2 25)"));
  assert.equal(r.radius, 12);
  assert.equal(r.body, "Inter");
  assert.equal(r.head, "Fraunces");
  files["src/app/globals.css"] = Buffer.from(`@import "tailwindcss";`);
  files["src/app/layout.tsx"] = Buffer.from("export default 1");
  const none = await style.readRepoStyle(view(), "");
  assert.deepEqual({ brand: none.brand, radius: none.radius, body: none.body }, { brand: undefined, radius: undefined, body: undefined }, "what is not found stays out");
});

test("#3 a sound style: unknown keys dropped, numbers bounded, bad colours and fonts refused", () => {
  const base = style.startStyle({ files: [] }, null);
  const s = style.sound({ brand: "#ABCDEF", radius: 400, base: 2, head: "Fraunces; } body{", lib: "Nope", evil: 1 } as never, base);
  assert.equal(s.brand, "#abcdef");
  assert.equal(s.radius, 48);
  assert.equal(s.base, 12);
  assert.equal(s.head, base.head, "a font name with code in it is refused");
  assert.equal(s.lib, base.lib);
  assert.ok(!("evil" in s));
});

test("#4 the files: brand.css has the theme, light and dark, the fonts; tokens.json is W3C; dark brand reads on dark", () => {
  const s = { ...style.startStyle({ files: [] }, null), brand: "#1f2b5c", head: "Fraunces", body: "Inter", radius: 14, pill: true };
  const css = style.brandCss(s);
  assert.match(css, /@theme \{/);
  assert.match(css, /--color-brand-500: #[0-9a-f]{6};/);
  assert.match(css, /--font-heading: "Fraunces"/);
  assert.match(css, /--font-sans: "Inter"/);
  assert.match(css, /--radius-button: 999px;/);
  assert.match(css, /\.dark \{/);
  const t = style.tokens(s);
  assert.ok(color.contrast(t.dark.brand!, t.dark.background!) >= 3, "the dark brand is visible on the dark background");
  const j = JSON.parse(style.tokensJson(s));
  assert.equal(j.color.brand.$type, "color");
  assert.equal(j.font.heading.$value[0], "Fraunces");
});

test("#5 versions: each change is one; going back makes a new one; a brand that follows takes the logo's colour", async () => {
  const s = await stageUpload("tienda", await tile("#8c2f39"), "logo.png");
  await useUpload(db, project, { up: s.up, name: s.name, scale: 100, bg: "#8c2f39" }, ACTOR);
  const first = (await style.styleRead(db, "tienda", { git }))!;
  assert.equal(first.style, null, "nothing chosen yet");
  assert.equal(first.base.body, "Inter", "it starts from the repo");
  assert.equal(first.base.brandTie, "fijo", "the repo has its own brand colour");
  const a = (await style.saveStyle(db, "tienda", { brandTie: "sigue", head: "Fraunces" }))!;
  assert.equal(a.versions, 1);
  assert.equal(a.base.brand, "#8c2f39", "follows the logo");
  await style.saveStyle(db, "tienda", { radius: 4 });
  const again = await style.saveStyle(db, "tienda", { radius: 4 });
  assert.equal(again!.versions, 2, "the same values are not a new version");
  const back = (await style.goBackStyle(db, "tienda", 1))!;
  assert.equal(back.versions, 3);
  assert.equal(back.base.radius, 12);
  assert.deepEqual(style.styleVersions("tienda").map((v) => [v.v, v.current]), [[3, true], [2, false], [1, false]]);
  await assert.rejects(style.goBackStyle(db, "tienda", 99), /version not found/);
});

test("#6 the request: files written as the repo will hold them, old colours listed, one at a time", async () => {
  const s = await stageUpload("tienda", await tile("#8c2f39"), "logo.png");
  await useUpload(db, project, { up: s.up, name: s.name, scale: 100, bg: "#8c2f39" }, ACTOR);
  const s2 = await stageUpload("tienda", await tile("#0f766e"), "logo2.png");
  await useUpload(db, project, { up: s2.up, name: s2.name, scale: 100, bg: "#0f766e" }, ACTOR);
  await assert.rejects(style.requestStyle(db, project, { git }), /Todavía no hay un estilo elegido/);
  await style.saveStyle(db, "tienda", { brandTie: "sigue", body: "DM Sans", head: "DM Sans" });
  style.forgetStyle();
  const r = (await style.styleRead(db, "tienda", { git }))!;
  assert.deepEqual(r.old.map((o) => o.path), ["src/components/boton.tsx"], "the old logo's colour, written by hand (case-blind)");
  assert.equal(r.old[0]!.n, 2);
  assert.ok(r.changes.some((c) => c.part === "letra"));
  const made = await style.requestStyle(db, project, { git });
  assert.ok(existsSync(path.join(made.dir, "src/app/brand.css")));
  assert.ok(existsSync(path.join(made.dir, "brand/tokens.json")));
  assert.match(readFileSync(path.join(made.dir, "src/app/brand.css"), "utf8"), /--font-sans: var\(--font-dm-sans\)/, "next/font hashes family names: brand.css uses its variable");
  const t = (await raw.query("select scope, status from tasks where key = $1", [made.key])).rows[0];
  assert.match(t.scope, /<!-- plania:marca-estilo set=[0-9a-f]{16} -->/);
  assert.match(t.scope, /src\/app\/globals\.css/);
  assert.match(t.scope, /«DM Sans» con variable: "--font-dm-sans"/);
  assert.match(t.scope, /src\/components\/boton\.tsx`: #8c2f39 \(2\)/);
  assert.equal(t.status, "Ready");
  assert.equal(((await style.styleRead(db, "tienda", { git }))!).pedido?.key, made.key);
  await assert.rejects(style.requestStyle(db, project, { git }), /Taller ya trabaja en el estilo/);
});

test("#7 the screen makes the same files as the server, reads an expert's code back, and knows every font", async () => {
  const ui = await import("../ui/src/lib/estilo.js");
  for (const over of [{}, { brand: "#0f766e", neutral: "calido", pill: true, motion: "vivo", head: "Fraunces" }, { brand: "#f2c14e", density: "compacto", shadow: "plana", radius: 0 }] as const) {
    const s = { ...style.startStyle({ files: [] }, null), ...over } as import("../src/brand/style.js").Style;
    assert.equal(ui.brandCss(s), style.brandCss(s));
    assert.equal(ui.tokensJson(s), style.tokensJson(s));
  }
  const s = style.startStyle({ files: [] }, null);
  const back = ui.fromCode(`:root { --primary: oklch(0.6 0.15 150); --radius: 0.75rem; }\n@theme { --font-heading: "Lora", serif; --font-sans: "Nope", serif; }`, s, style.FONTS);
  assert.equal(back.n, 3, "brand, radius and a known heading font; an unknown font is left");
  assert.equal(back.next.radius, 12);
  assert.equal(back.next.head, "Lora");
  assert.equal(back.next.brandTie, "fijo");
  assert.deepEqual(Object.keys(ui.FONT_CAT).sort(), [...style.FONTS].sort(), "the screen knows every font the server offers");
});

test("#8 a shadcn/ui repo (an alias before the value, its own --accent): read right, and brand.css writes shadcn's variables", async () => {
  const css = `@theme inline {\n  --color-primary: var(--primary);\n  --font-sans: var(--font-inter);\n}\n:root {\n  --primary: #8e1b3a;\n  --primary-foreground: #ffffff;\n  --accent: #f1d9df;\n  --radius: 0.75rem;\n}\n.dark { --primary: #c04060; }\n`;
  files["src/app/globals.css"] = Buffer.from(css);
  files["src/app/layout.tsx"] = Buffer.from(`import { Inter } from "next/font/google";\nconst inter = Inter({ variable: "--font-inter" });`);
  const r = await style.readRepoStyle(view(), "");
  assert.equal(r.brand, "#8e1b3a", "the alias is skipped for the first real colour");
  assert.equal(r.shadcn, true);
  assert.equal(r.accent, undefined, "shadcn's --accent is a surface, not the brand's accent");
  assert.equal(r.radius, 12);
  assert.equal(r.body, "Inter");
  assert.equal(r.dark, true);
  const s = { ...style.startStyle(r, null), head: "Fraunces" };
  const out = style.brandCss(s, { next: true, shadcn: true });
  const root = out.slice(out.indexOf(":root {"), out.indexOf(".dark {"));
  assert.match(root, /--primary: #8e1b3a;/);
  assert.match(root, /--primary-foreground: #ffffff;/);
  assert.doesNotMatch(root, /\n  --muted:|\n  --secondary:/, "shadcn's own --muted and --secondary are left alone");
  const t = style.tokens(s);
  assert.match(root, new RegExp(`--accent: ${t.scale[1]};`), "shadcn's accent is a tint of the brand");
  assert.match(root, /--primary-hover: #[0-9a-f]{6};/);
  assert.match(root, /--sidebar-primary: #8e1b3a;/);
  const input = root.match(/--input: (#[0-9a-f]{6});/)![1]!;
  assert.ok(color.contrast(input, "#ffffff") >= 3 && color.contrast(input, t.light.background!) >= 3, "a field's border keeps 3:1 (WCAG 1.4.11)");
  const dark = out.slice(out.indexOf(".dark {"));
  const dInput = dark.match(/--input: (#[0-9a-f]{6});/)![1]!;
  assert.ok(color.contrast(dInput, t.dark.card!) >= 3, "and on dark");
  assert.match(out, /--font-heading: var\(--font-fraunces\)/);
  assert.match(out, /h1, h2, h3, h4 \{ font-family: var\(--font-heading\)/, "headings take the heading font even where the app never used font-heading");
  assert.match(out, /--font-sans: var\(--font-inter\)/);
  const ui = await import("../ui/src/lib/estilo.js");
  for (const o of [{}, { next: true }, { shadcn: true }, { next: true, shadcn: true }]) assert.equal(ui.brandCss(s, o), style.brandCss(s, o));
});

test("#9 old colours in a real repo: one git grep over the commit, filtered like the file scan", async () => {
  const sha = "a".repeat(40);
  const seen: string[][] = [];
  const grep: import("../src/brand/logos.js").Git = async (_cwd, args) => {
    seen.push(args);
    return { code: 0, stdout: Buffer.from([`${sha}:src/a.tsx:#8C2F39`, `${sha}:src/a.tsx:#8c2f39`, `${sha}:src/b.css:#123456`, `${sha}:node_modules/x/y.js:#8c2f39`, `${sha}:public/logo.svg:#8c2f39`, `${sha}:src/app/brand.css:#8c2f39`].join("\n")) };
  };
  const out = await style.oldColorsGrep(grep, "/repo", sha, "", ["#123456", "#8c2f39"]);
  assert.deepEqual(out, [{ path: "src/a.tsx", n: 2, colors: ["#8c2f39"] }, { path: "src/b.css", n: 1, colors: ["#123456"] }]);
  assert.deepEqual(seen[0]!.slice(0, 5), ["grep", "-I", "-i", "-o", "-F"]);
  assert.deepEqual(await style.oldColorsGrep(grep, "/repo", sha, "", []), [], "nothing to look for: no git call");
  assert.equal(seen.length, 1);
});

test("#10 one app colour: the chosen logo's until a style is set, then the style's brand (or the logo's, if it follows)", async () => {
  const { appTheme } = await import("../src/brand/theme.js");
  const logo = { chosen: true, colors: ["#4a1f3d"], adjust: { bg: null } };
  assert.equal(appTheme(null, logo), "#4a1f3d");
  assert.equal(appTheme({ brand: "#5D314F", brandTie: "fijo" }, logo), "#5d314f");
  assert.equal(appTheme({ brand: "#5d314f", brandTie: "sigue" }, logo), "#4a1f3d");
  assert.equal(appTheme({ brand: "#5d314f", brandTie: "sigue" }, { ...logo, chosen: false }), "#5d314f", "a logo only found in the repo does not lead");
  assert.equal(appTheme(null, { ...logo, chosen: false }), null);
});

test("PLA-130: a repo with no dark mode gets none: no .dark block, no dark tokens, and the screen's copy agrees", async () => {
  const ui = await import("../ui/src/lib/estilo.js");
  const s = style.startStyle({ files: [] }, null);
  const css = style.brandCss(s, { dark: false });
  assert.doesNotMatch(css, /\.dark\s*\{/, "no dark block for an app with no dark mode");
  assert.match(style.brandCss(s), /\.dark\s*\{/, "the default still carries it");
  assert.match(style.brandCss(s, { dark: true }), /\.dark\s*\{/);
  const j = JSON.parse(style.tokensJson(s, { dark: false }));
  assert.equal(j.color.dark, undefined);
  assert.ok(j.color.light, "light stays");
  assert.equal(ui.brandCss(s, { dark: false }), css);
  assert.equal(ui.tokensJson(s, { dark: false }), style.tokensJson(s, { dark: false }));
});

test("PLA-130: a setting the repo cannot say (spacing, motion, stroke, greys…) counts as a change against where the style started", async () => {
  const ui = await import("../ui/src/lib/estilo.js");
  const repo = { brand: "#1f2b5c", head: "Inter", body: "Inter", radius: 8, files: [] };
  const start = style.startStyle(repo, null);
  assert.deepEqual(ui.changesOf(start, repo, start), [], "untouched: nothing to bring");
  const roomy = ui.changesOf({ ...start, density: "amplio" }, repo, start);
  assert.deepEqual(roomy.map((c) => [c.part, c.fields]), [["espacio", ["density"]]]);
  const many = ui.changesOf({ ...start, motion: "vivo", stroke: 1.5, neutral: "calido", base: 18, shadow: "marcada" }, repo, start);
  assert.deepEqual(many.map((c) => c.part).sort(), ["color", "forma", "iconos", "letra", "mov"]);
  const preview = ui.changesOf({ ...start, border: 2, fill: true, img: "linea", people: true }, repo, start);
  assert.deepEqual(preview, [], "borders, icon fill and images never reach the files");
  const both = ui.changesOf({ ...start, radius: 12, pill: true }, repo, start).find((c) => c.part === "forma")!;
  assert.equal(both.from, "8 px");
  assert.deepEqual(both.fields, ["pill"], "the repo's value and Plania's own settings in one part");
  assert.equal(ui.changesOf({ ...start, density: "amplio" }, repo).length, 0, "without a start only what the repo says is compared");
});
