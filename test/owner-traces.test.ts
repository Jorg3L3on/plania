// PLA-I2-3: nothing of the first owner inside the product. A word scan with an allow-list for history, a fresh
// install that shows only what it was given, projects with made-up slugs that get an order, a colour and a mark,
// and one place for the time zone and the locale.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
for (const k of ["PLANIA_PASSWORD_HASH", "PLANIA_TZ", "PLANIA_LOCALE", "PLANIA_CEO_NAME", "PLANIA_PROJECTS_ROOT", "PLANIA_WORKTREES_ROOT"]) delete process.env[k];
const { makeDb } = await import("../src/db/client.js");
const { firstStart } = await import("../src/auth/first-start.js");
const { issueSetupCode } = await import("../src/db/install.js");
const state = await import("../src/install-state.js");
const { resetOwnerName } = await import("../src/owner.js");
const { screenTz, screenLocale, FALLBACK_TZ } = await import("../src/locale.js");
const { defaultFolders } = await import("../src/folders.js");
const { projectsRoot, worktreeRoot } = await import("../src/runner/worktree.js");
const { progressSummary, clearProgressCache, dayInTz } = await import("../src/mcp/progress.js");
const { projectName } = await import("../src/mcp/ceo-signals.js");
const { instructions } = await import("../src/mcp/protocol.js");
const { projectColor } = await import("../ui/src/lib/progress.js");
const { pickLocale, FALLBACK_LOCALE } = await import("../ui/src/lib/locale.js");

const ROOT = path.resolve(import.meta.dirname, "..");

// The first owner: first name, family name in his home folder, GitHub user, machine name, his projects and the
// first install's agent and project slugs.
const WORDS = /jorge|jorg3l3on|\/users\/jorge|macbook-air|\bmicasa\b|\bworkia\b|\bfilmia\b|\bzigzag\b|\bhousi\b|\bmianovia\b|\bviajia\b/i;
const SCANNED = ["src", "ui/src", "scripts", "kit", "prompts", "docs", "README.md"];
// History and the compatibility path, each with why it may keep a word.
const ALLOW: { path: string; why: string }[] = [
  { path: "docs/adr/", why: "decision records are history, kept as written" },
  { path: "docs/plan-2026-10-improvements.md", why: "the October 2026 plan, history as written" },
  { path: "docs/company-mockups/", why: "design mockups drawn with the first install's data, history" },
  { path: "docs/progress-mockups/", why: "design mockups drawn with the first install's data, history" },
  { path: "src/owner.ts", why: "PLA-I2-14: the old spellings, read on input until protocol 2.25" },
  { path: "ui/src/lib/city.ts", why: "PLA-I2-14: a next step written with the old name still counts until protocol 2.25" },
  { path: "ui/src/lib/ahora.ts", why: "PLA-I2-14: waits from a server before protocol 2.24 still read" },
];
const TEXT = /\.(ts|tsx|js|mjs|md|css|html|json|sql|py|sh|toml|txt|ya?ml)$/;
// The product's own home: releases are published from this GitHub repository, so its address may appear (the
// installers' default download address, the README's one-liners). Only the full repository address is let through.
const RELEASE_HOME = /github\.com\/jorg3l3on\/plania\b/gi;

function walk(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (!statSync(abs, { throwIfNoEntry: false })) return [];
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs).flatMap((f) => (f === "node_modules" ? [] : walk(path.posix.join(rel, f))));
}

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
before(async () => {
  raw = await resetTestDb(); // check 3: every migration ran on a database with no projects before the helper adds its four
  db = makeDb().db;
});
after(async () => {
  resetOwnerName(null);
  state.resetInstallState();
  await raw.end();
});

test("check 1: the scan finds none of the first owner's words outside the allow-list", () => {
  const hits: string[] = [];
  for (const file of SCANNED.flatMap(walk).filter((f) => TEXT.test(f))) {
    if (ALLOW.some((a) => file === a.path || file.startsWith(a.path))) continue;
    readFileSync(path.join(ROOT, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (WORDS.test(line.replace(RELEASE_HOME, ""))) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
  }
  assert.deepEqual(hits, []);
  for (const a of ALLOW) assert.ok(a.why.length > 10, a.path);
  // Each allow-listed product file still has a reason to be there: it does hold the old spelling.
  for (const a of ALLOW.filter((x) => x.path.startsWith("src/") || x.path.startsWith("ui/"))) assert.match(readFileSync(path.join(ROOT, a.path), "utf8"), WORDS, a.path);
  assert.equal(JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts.seed, undefined, "pnpm seed is gone");
});

describe("a fresh install", () => {
  test("check 2: first start shows no project and no person's name it was not given", async () => {
    await raw.query("delete from projects");
    await raw.query("delete from agents");
    const envFile = path.join(mkdtempSync(path.join(tmpdir(), "plania-i2-3-")), ".env");
    const code = await issueSetupCode(raw, envFile, () => "ABCD-EFGH-JKMN");
    const env: NodeJS.ProcessEnv = { ...process.env };
    const out = await firstStart(db, { code: code!, name: "Ana", password: "una contraseña larga", time_zone: "Asia/Tokyo", projects_root: "~/codigo", worktrees_root: "" }, { loopback: true, env });
    assert.deepEqual(out, { ok: true, home: "plania" });
    const projects = (await raw.query("select slug, title from projects")).rows;
    assert.deepEqual(projects, [{ slug: "plania", title: "Plania" }]);
    const agents = (await raw.query("select slug, name from agents order by slug")).rows;
    for (const a of agents) assert.doesNotMatch(`${a.slug} ${a.name}`, WORDS);
    assert.equal((await raw.query("select display_name from owner_profile")).rows[0].display_name, "Ana");
    assert.doesNotMatch(instructions(false), WORDS);
    assert.match(instructions(false), /Need Ana to decide/);

    // Check 5: the zone first start was given is the one every reader gets, through one place.
    assert.equal(env.PLANIA_TZ, "Asia/Tokyo");
    assert.equal(screenTz(env), "Asia/Tokyo");
    assert.equal(dayInTz(new Date("2026-11-18T20:00:00Z"), screenTz(env)), "2026-11-19", "a Tokyo evening is the next day there");
    // The folders asked at first start: the answer, else the neutral default under the home.
    assert.equal(env.PLANIA_PROJECTS_ROOT, "~/codigo");
    assert.equal(projectsRoot(env), path.resolve(path.join(process.env.HOME || process.env.USERPROFILE || "", "codigo")));
    assert.equal(env.PLANIA_WORKTREES_ROOT, undefined);
    assert.equal(worktreeRoot({}), path.resolve(defaultFolders().worktrees));
    assert.doesNotMatch(defaultFolders("/home/ana").projects, /Developer/);
  });
});

test("check 4: two projects with made-up slugs get an order, a colour and a mark without a code change", async () => {
  await raw.query(`insert into projects (slug, title, key_prefix, settings) values
    ('quokka', 'Quokka', 'QKK', '{"identity":{"order":1}}'), ('arbol-azul', 'Árbol azul', 'ARB', '{}')`);
  for (const [slug, key] of [["quokka", "QKK-1"], ["arbol-azul", "ARB-1"]]) {
    await raw.query(`insert into tasks (project_id, key, title, kind, status, resolved_at) select id, $2, 'Hecho', 'ticket', 'Done', now() from projects where slug = $1`, [slug, key]);
  }
  clearProgressCache();
  const day = await progressSummary(db, { range: "day" });
  const order = (day as unknown as { by_project: { slug: string }[] }).by_project.map((p) => p.slug).filter((s) => s !== "plania");
  assert.deepEqual(order, ["quokka", "arbol-azul"], "the row's order first, then the slug");
  for (const slug of ["quokka", "arbol-azul"]) {
    assert.match(projectColor(slug), /^#[0-9a-f]{6}$/);
    assert.equal(projectColor(slug), projectColor(slug), "stable");
  }
  assert.equal(projectName("arbol-azul"), "Arbol-azul");
  const mark = readFileSync(path.join(ROOT, "ui/src/components/plania-mark.tsx"), "utf8");
  assert.match(mark, /const brand = PROJECTS\[slug\] \?\? monogram\(slug, name\);/, "every project gets a mark: its monogram");
  assert.deepEqual([...mark.matchAll(/^ {2}([a-z-]+): \{/gm)].map((m) => m[1]), ["plania"], "no project's logo is built in but Plania's");
});

test("check 5: time zone and locale are read from one place", () => {
  assert.equal(screenTz({}), FALLBACK_TZ);
  assert.equal(screenTz({ PLANIA_TZ: "Europe/Madrid" }), "Europe/Madrid");
  assert.equal(screenLocale({ PLANIA_LOCALE: "es-AR" }), "es-AR");
  assert.equal(pickLocale("es-ES"), "es-ES");
  assert.equal(pickLocale("en-US"), FALLBACK_LOCALE);
  const strays: string[] = [];
  for (const file of [...walk("src"), ...walk("ui/src")].filter((f) => /\.(ts|tsx)$/.test(f))) {
    if (file === "src/locale.ts" || file === "ui/src/lib/locale.ts") continue;
    const text = readFileSync(path.join(ROOT, file), "utf8");
    if (/"es-MX"|America\/Mexico_City|PLANIA_TZ \|\||PLANIA_TZ\?\.trim\(\) \|\|/.test(text)) strays.push(file);
  }
  assert.deepEqual(strays, []);
});
