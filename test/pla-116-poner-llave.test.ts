// PLA-116: Poner una llave. The owner's value for one variable goes into the app's env file (the one Llaves reads,
// test copy first), or a new .env.local there; only names Llaves lists, one line, never a tracked file; other lines
// stay; mode 0600; the value never comes back in an answer, a log line or a database row; screen only.
// Test DB only, fake repos in a temp dir, git faked through the Máquinas exec.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { needs } from "./platform.js";
import { resetTestDb, TEST_BEARER, useTestEnv } from "./helpers.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-116-"));
const WT = path.join(TMP, "wt");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const maquinas = await import("../src/maquinas/machines.js");
const { quoteEnvValue, withEnvValue } = await import("../src/maquinas/llaves.js");
const { parseEnv, secretValues } = await import("../src/maquinas/env.js");
type Json = Record<string, any>;

const REPO = path.join(TMP, "zigzag");
const PRUEBA = path.join(WT, "zigzag", "_prueba");
const ENV = path.join(PRUEBA, ".env.local");
const ORIGINAL = "# local values\nDATABASE_URL=postgres://a@127.0.0.1:5433/zig\n\nexport RESEND_API_KEY=\n# keep me\nNEXT_PUBLIC_SITE_URL=http://localhost:3000\n";
let raw: pg.Client;
let tracked = "";
let gitCalls: { command: string; cwd: string }[] = [];

const post = async (body: unknown, headers: Record<string, string> = { Cookie: `${SESSION_COOKIE}=${createSession()}` }) => {
  const r = await app.request("/api/projects/zigzag/maquinas/llaves", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: JSON.parse(text) as Json, text };
};

// Every row of every table, as text: the value must be in none of them.
const inDb = async (needle: string): Promise<string[]> => {
  const { rows } = await raw.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`);
  const hits: string[] = [];
  for (const { table_name } of rows) {
    const r = await raw.query(`select count(*)::int as n from "${table_name}" t where t::text like $1`, [`%${needle}%`]);
    if (r.rows[0].n) hits.push(table_name);
  }
  return hits;
};

before(async () => {
  raw = await resetTestDb();
  for (const d of [REPO, path.join(PRUEBA, "src")]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(PRUEBA, ".env.example"), "DATABASE_URL=\nSTRIPE_SECRET_KEY=\nRESEND_API_KEY=\n");
  writeFileSync(path.join(PRUEBA, "src", "mail.ts"), "export const k = process.env.RESEND_API_KEY;\nconst u = process.env.NEXT_PUBLIC_SITE_URL;\nconst d = process.env['SENTRY_DSN'];\n");
  await raw.query(`update projects set settings = settings || $1::jsonb where slug = 'zigzag'`, [JSON.stringify({ local: { repo_path: REPO } })]);
  maquinas.setMaquinasDeps({
    env: { ...process.env, PLANIA_WORKTREES_ROOT: WT },
    exec: async (command, opts) => {
      gitCalls.push({ command, cwd: opts.cwd });
      return command.startsWith("git ls-files") ? { code: 0, stdout: tracked, stderr: "" } : { code: 0, stdout: "", stderr: "" };
    },
  });
});

after(async () => {
  await raw.end();
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => {
  writeFileSync(ENV, ORIGINAL);
  tracked = "";
  gitCalls = [];
});

describe("withEnvValue and quoteEnvValue", () => {
  test("replace keeps export and every other line; append adds one line; duplicates go; CRLF stays", () => {
    assert.equal(withEnvValue("A=1\nexport B=\n# c\nB=old\n", "B", "x"), "A=1\nexport B=x\n# c\n");
    assert.equal(withEnvValue("A=1\n\n\n", "C", "y"), "A=1\nC=y\n");
    assert.equal(withEnvValue("", "C", "y"), "C=y\n");
    assert.equal(withEnvValue("A=1\r\nB=2\r\n", "B", "3"), "A=1\r\nB=3\r\n");
    assert.equal(withEnvValue("AB=1\n", "B", "2"), "AB=1\nB=2\n", "a name that only ends the same is another name");
  });

  test("every value it accepts reads back exactly", () => {
    for (const v of ["plain", "has space", "a#b c", 'say "hi"', "it's", `both " and '`, "sk_live_x=/+", "x # not a comment"]) {
      const q = quoteEnvValue(v);
      assert.ok(q !== null, v);
      assert.equal(parseEnv(`K=${q}\n`).get("K"), v, v);
    }
    assert.equal(quoteEnvValue("a\"b'c`d"), null);
  });
});

describe("POST /maquinas/llaves", () => {
  test("a missing key gets its value in the env file Llaves reads; the rest stays; 0600; the answer is names only", { skip: needs({ posix: true }) }, async () => {
    const value = "re_fake_value_8812 with space";
    const r = await post({ name: "RESEND_API_KEY", value });
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.text.includes("re_fake_value_8812"), "no value in the answer");
    const by = Object.fromEntries(r.body.llaves.map((l: Json) => [l.name, l]));
    assert.equal(by.RESEND_API_KEY.set, true);
    for (const l of r.body.llaves) assert.deepEqual(Object.keys(l).sort(), ["from", "name", "public", "set"]);
    const text = readFileSync(ENV, "utf8");
    assert.equal(text, ORIGINAL.replace("export RESEND_API_KEY=\n", `export RESEND_API_KEY="${value}"\n`));
    assert.equal(statSync(ENV).mode & 0o777, 0o600);
    assert.equal(gitCalls[0]?.cwd, PRUEBA);
    assert.match(gitCalls[0]!.command, /^git ls-files -- '\.env\.local'$/);
    // The log of the test copy masks it like any other secret of the app's env.
    assert.ok(secretValues(parseEnv(text)).includes(value));
  });

  test("a name the code reads but the file lacks is appended; changing a set one replaces it", async () => {
    assert.equal((await post({ name: "SENTRY_DSN", value: "https://k@o.example.test/1" })).status, 200);
    assert.equal((await post({ name: "NEXT_PUBLIC_SITE_URL", value: "http://localhost:4000" })).status, 200);
    const env = parseEnv(readFileSync(ENV, "utf8"));
    assert.equal(env.get("SENTRY_DSN"), "https://k@o.example.test/1");
    assert.equal(env.get("NEXT_PUBLIC_SITE_URL"), "http://localhost:4000");
    assert.match(readFileSync(ENV, "utf8"), /# keep me\nNEXT_PUBLIC_SITE_URL=http:\/\/localhost:4000\nSENTRY_DSN=/);
  });

  test("no env file yet: a new .env.local in the test copy", { skip: needs({ posix: true }) }, async () => {
    rmSync(ENV);
    const r = await post({ name: "STRIPE_SECRET_KEY", value: "sk_test_new_4410" });
    assert.equal(r.status, 200, r.text);
    assert.equal(readFileSync(ENV, "utf8"), "STRIPE_SECRET_KEY=sk_test_new_4410\n");
    assert.equal(statSync(ENV).mode & 0o777, 0o600);
    assert.equal(r.body.env_file, ".env.local");
  });

  test("refusals: a name Llaves does not list, empty, two lines, too long, a tracked file; nothing written", async () => {
    const cases: [unknown, string][] = [
      [{ name: "HOME_MADE", value: "x" }, "KEY_NOT_LISTED"],
      [{ name: "RESEND_API_KEY; rm -rf /", value: "x" }, "KEY_NOT_LISTED"],
      [{ name: "RESEND_API_KEY", value: "   " }, "VALUE_NOT_WRITABLE"],
      [{ name: "RESEND_API_KEY", value: 42 }, "VALUE_NOT_WRITABLE"],
      [{ name: "RESEND_API_KEY", value: "a\nEVIL=1" }, "VALUE_NOT_WRITABLE"],
      [{ name: "RESEND_API_KEY", value: "x".repeat(8001) }, "VALUE_NOT_WRITABLE"],
      [{ name: "RESEND_API_KEY", value: "a\"b'c`d" }, "VALUE_NOT_WRITABLE"],
    ];
    for (const [body, code] of cases) {
      const r = await post(body);
      assert.equal(r.body.error, code, JSON.stringify(body).slice(0, 60));
      assert.equal(r.status, 400);
    }
    tracked = ".env.local\n";
    const t = await post({ name: "RESEND_API_KEY", value: "would_be_committed_51" });
    assert.equal(t.status, 409);
    assert.equal(t.body.error, "ENV_FILE_TRACKED");
    assert.ok(!t.text.includes("would_be_committed_51"));
    assert.equal(readFileSync(ENV, "utf8"), ORIGINAL, "untouched");
  });

  test("the value is in no database row and no console line", async () => {
    const value = "sk_test_never_logged_6620";
    const lines: string[] = [];
    const keep = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const k of Object.keys(keep) as (keyof typeof keep)[]) console[k] = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    try {
      assert.equal((await post({ name: "STRIPE_SECRET_KEY", value })).status, 200);
      await post({ name: "STRIPE_SECRET_KEY", value: `${value}\n` });
    } finally {
      Object.assign(console, keep);
    }
    assert.ok(!lines.some((l) => l.includes(value)), "no console line");
    assert.deepEqual(await inDb(value), [], "no table holds it");
    assert.ok(existsSync(ENV));
  });

  test("screen only: no cookie, or an MCP bearer token, is refused", async () => {
    const none = await app.request("/api/projects/zigzag/maquinas/llaves", { method: "POST", body: "{}" });
    assert.equal(none.status, 401);
    const bearer = await post({ name: "RESEND_API_KEY", value: "by_an_agent" }, { Authorization: `Bearer ${TEST_BEARER}` });
    assert.equal(bearer.status, 401);
    assert.equal(readFileSync(ENV, "utf8"), ORIGINAL);
  });
});
