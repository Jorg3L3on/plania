// PLA-I2-10: the screen in a second language. The install's language (stored, chosen at first start, changed in
// Plomería, followed by the brief), the wording modules in both languages, the guard against inline Spanish, and the
// locale. Throwaway database; no browser.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
for (const k of ["PLANIA_PASSWORD_HASH", "PLANIA_LANGUAGE", "PLANIA_LOCALE", "PLANIA_JOBS"]) delete process.env[k];

const ROOT = path.join(import.meta.dirname, "..");
const { findInline, isSpanish, spanishIn, scannedFiles } = await import("../scripts/inline-words.js");
const i18n = await import("../ui/src/lib/i18n.js");
const { pickLocale } = await import("../ui/src/lib/locale.js");
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const lang = await import("../src/language.js");
const { screenLocale } = await import("../src/locale.js");
const { loadBriefSettings } = await import("../src/brief/settings.js");
const { issueSetupCode } = await import("../src/db/install.js");
const state = await import("../src/install-state.js");

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i2-10-"));

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
});
after(async () => {
  await closeDb();
  await raw.end();
  rmSync(scratch, { recursive: true, force: true });
});

// ---- wording modules

const ALLOW = path.join(ROOT, "test/inline-words-allow.txt");
const allowList = () =>
  readFileSync(ALLOW, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

/** Every wording module: a ui/src/lib file that calls defineWords. */
function wordingModules(): string[] {
  const dir = path.join(ROOT, "ui/src/lib");
  return readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && f !== "i18n.ts")
    .filter((f) => readFileSync(path.join(dir, f), "utf8").includes("defineWords("))
    .map((f) => path.join(dir, f));
}

function sameShape(es: unknown, en: unknown, at: string, problems: string[]): void {
  if (typeof es === "function" || typeof en === "function") {
    if (typeof es !== typeof en) problems.push(`${at}: a function in one language only`);
    else if ((es as (...a: unknown[]) => unknown).length !== (en as (...a: unknown[]) => unknown).length) problems.push(`${at}: the two functions take different arguments`);
    return;
  }
  if (typeof es === "string" || typeof en === "string") {
    if (typeof es !== "string" || typeof en !== "string") problems.push(`${at}: a string in one language only`);
    else if (!es.trim() || !en.trim()) problems.push(`${at}: empty`);
    return;
  }
  if (Array.isArray(es) || Array.isArray(en)) {
    if (!Array.isArray(es) || !Array.isArray(en) || es.length !== en.length) problems.push(`${at}: lists of different length`);
    else es.forEach((v, i) => sameShape(v, en[i], `${at}[${i}]`, problems));
    return;
  }
  if (es && en && typeof es === "object" && typeof en === "object") {
    const a = Object.keys(es as object).sort();
    const b = Object.keys(en as object).sort();
    for (const k of a) if (!b.includes(k)) problems.push(`${at}.${k}: missing in English`);
    for (const k of b) if (!a.includes(k)) problems.push(`${at}.${k}: missing in Spanish`);
    for (const k of a) if (b.includes(k)) sameShape((es as Record<string, unknown>)[k], (en as Record<string, unknown>)[k], `${at}.${k}`, problems);
    return;
  }
  if (typeof es !== typeof en) problems.push(`${at}: different kinds`);
}

test("I2-10 #1: every key of every wording module exists in both languages", async () => {
  const files = wordingModules();
  assert.ok(files.length >= 2, "the wording modules are found");
  const problems: string[] = [];
  let modules = 0;
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      if (!i18n.isWords(value)) continue;
      modules++;
      sameShape(value.es, value.en, `${path.basename(file)} ${name}`, problems);
    }
  }
  assert.ok(modules >= files.length, "each file exports at least one wording module");
  assert.deepEqual(problems, []);
});

test("I2-10: words() follows the language, and the helper is typed by the Spanish", () => {
  const W = i18n.defineWords({ es: { hi: "Hola", n: (x: number) => `${x} cosas` }, en: { hi: "Hi", n: (x: number) => `${x} things` } });
  assert.equal(i18n.words(W, "en").hi, "Hi");
  assert.equal(i18n.words(W, "es").n(2), "2 cosas");
  assert.ok(i18n.isWords(W));
  assert.equal(i18n.isWords({ es: {}, en: {} }), false);
  assert.equal(i18n.getLanguage(), "es"); // no storage in node: Spanish
  assert.equal(i18n.adoptLanguage("fr"), false);
});

// ---- the guard against inline Spanish

test("I2-10 #4: the detector finds Spanish sentences and leaves code, comments and English alone", () => {
  for (const s of ["No se pudo guardar", "Lo que sale de esta máquina", "«Delegada»", "¿Seguro?", "Nada que decidir.", "Entra para ver tus proyectos"]) assert.ok(isSpanish(s), s);
  for (const s of ["Save", "flex items-center gap-2", "The two passwords are not the same.", "data-control", "en", "es-MX", "Sign in to see your projects"]) assert.equal(isSpanish(s), false, s);
  const src = [
    `// Una nota en español que no cuenta.`,
    `/* Otra nota: el comentario de bloque tampoco cuenta. */`,
    `const a = "flex gap-2";`,
    `const b = cond ? x : "No se pudo guardar la nota";`,
    `const c = \`Hay \${n} cosas para ti\`;`,
    `const el = <p className="x">Lo que sale de esta máquina</p>;`,
    `const ok = <p>{w.title}</p>;`,
    `const f = (x) => x > 2 && x < 5;`,
  ].join("\n");
  assert.deepEqual(
    spanishIn(src).map((f) => f.line),
    [4, 5, 6],
  );
});

test("I2-10 #4: no screen file holds an inline Spanish sentence unless it is on the allow-list, which only shrinks", () => {
  const found = findInline(ROOT);
  const allowed = allowList();
  const files = new Set(scannedFiles(ROOT));
  const unlisted = [...found.keys()].filter((f) => !allowed.includes(f)).map((f) => `${f}:${found.get(f)![0]!.line} ${found.get(f)![0]!.text.slice(0, 60)}`);
  assert.deepEqual(unlisted, [], "move these words into a wording module (docs/screen-words.md)");
  const clean = allowed.filter((f) => files.has(f) && !found.has(f));
  assert.deepEqual(clean, [], "these files hold no inline Spanish now: remove them from test/inline-words-allow.txt");
  const gone = allowed.filter((f) => !files.has(f));
  assert.deepEqual(gone, [], "these files no longer exist: remove them from test/inline-words-allow.txt");
});

// ---- the install's language

test("I2-10: the language is Spanish until chosen; saving it is the one switch, and the brief follows", async () => {
  lang.resetLanguage();
  assert.equal(lang.installLanguage(), "es");
  assert.equal(lang.languageChosen(), false);
  let res = await app.request("/api/language");
  assert.equal(res.status, 200, "readable without a session");
  assert.deepEqual(await res.json(), { language: "es", chosen: false, languages: ["es", "en"] });

  await lang.saveLanguage(db, "en");
  assert.equal(lang.installLanguage(), "en");
  assert.equal((await loadBriefSettings(db)).language, "en");
  lang.resetLanguage();
  assert.equal(await lang.loadLanguage(db), "en", "read back from the database at start");
  res = await app.request("/api/language");
  assert.deepEqual(await res.json(), { language: "en", chosen: true, languages: ["es", "en"] });

  // PUT needs a session.
  res = await app.request("/api/language", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: "es" }) });
  assert.equal(res.status, 401);

  await lang.saveLanguage(db, "es");
  assert.equal((await loadBriefSettings(db)).language, "es");
  assert.equal(lang.installLanguage({ PLANIA_LANGUAGE: "en" }), "en", "the variable wins");
  await assert.rejects(lang.saveLanguage(db, "fr" as never));
});

test("I2-10: first start stores the chosen language", async () => {
  await raw.query("delete from machine_state where key = 'language'");
  lang.resetLanguage();
  state.resetInstallState();
  const CODE = "ABCD-EFGH-JKMN";
  assert.equal(await issueSetupCode(raw, path.join(scratch, ".env"), () => CODE), CODE);
  const body = { code: CODE, name: "Ana", password: "a long enough password", time_zone: "Europe/Madrid", projects_root: "~/plania/projects", worktrees_root: "~/plania/worktrees", language: "fr" };
  const send = (b: unknown) =>
    app.request("http://localhost:3737/api/first-start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }, { incoming: { socket: { remoteAddress: "127.0.0.1" } } });
  let res = await send(body);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "INVALID_BODY", field: "language" });
  res = await send({ ...body, language: "en" });
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal(lang.installLanguage(), "en");
  assert.equal((await loadBriefSettings(db)).language, "en");
  delete process.env.PLANIA_PASSWORD_HASH;
  lang.resetLanguage();
});

// ---- dates and numbers

test("I2-10: dates and numbers follow the language", () => {
  assert.equal(pickLocale("es-ES"), "es-ES");
  assert.equal(pickLocale("en-GB"), "es-MX", "a Spanish screen in an English browser");
  assert.equal(pickLocale("en-GB", "en"), "en-GB");
  assert.equal(pickLocale("es-ES", "en"), "en-US");
  assert.equal(screenLocale({ PLANIA_LANGUAGE: "en" }), "en-US");
  assert.equal(screenLocale({ PLANIA_LANGUAGE: "es" }), "es-MX");
  assert.equal(screenLocale({ PLANIA_LANGUAGE: "en", PLANIA_LOCALE: "en-AU" }), "en-AU");
});
