// Shared setup: points the app at a throwaway plania_test_<hash> database and rebuilds it from the migrations.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { after } from "node:test";
import pg from "pg";
import { resetPool } from "../src/db/client.js";
import type { Reader, UnitOfWork } from "../src/store/types.js";

// Where the test databases live. PLANIA_TEST_PG names the server and role, without a database:
// postgres://postgres@127.0.0.1:5432. The default is Homebrew's: the OS user on localhost, no password.
const PG_BASE = (process.env.PLANIA_TEST_PG || `postgres://${encodeURIComponent(userInfo().username)}@localhost:5432`).replace(/\/+$/, "");
export const pgUrl = (database: string): string => `${PG_BASE}/${database}`;

const ADMIN_URL = pgUrl("postgres");

// One database per checkout: the suffix is a stable hash of this repo's absolute root,
// so worktrees running `pnpm test` at the same time never drop each other's database.
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const TEST_DB = `plania_test_${createHash("sha256").update(REPO_ROOT).digest("hex").slice(0, 6)}`;

// Guard: resetTestDb drops TEST_DB, so it must never be anything but a plania_test database.
if (!/^plania_test_[0-9a-f]{6}$/.test(TEST_DB)) throw new Error(`refusing to use test database ${TEST_DB}`);

export const TEST_DATABASE_URL = pgUrl(TEST_DB);
export const TEST_BEARER = "test-token";
export const TEST_READ_TOKEN = "test-read-token";
export const TEST_CI_TOKEN = "test-ci-token";

// Which store the tests run on. PLANIA_TEST_STORE=devva runs them on the devva store with no Postgres; it needs
// the engine of spike/devva-commit-log (see its README). The default is Postgres.
export const onDevva = process.env.PLANIA_TEST_STORE === "devva";

// For a test (or describe) that only makes sense on Postgres: `test("…", pgOnly("replays a migration"), …)`.
export const pgOnly = (why: string): { skip: string | false } => ({ skip: onDevva ? `needs Postgres: ${why}` : false });

// For a test that should pass on devva and does not yet, because of plania's code or the devva adapter, not
// because of the test. It still runs on Postgres. Say what fails; these are a to-do list, not exemptions.
export const devvaGap = (what: string): { skip: string | false } => ({ skip: onDevva ? `fails on devva: ${what}` : false });

// For a whole file that only makes sense on Postgres. Call it first, before importing anything from src/.
export function pgOnlyFile(why: string): void {
  if (!onDevva) return;
  console.log(`# skipped on devva, needs Postgres: ${why}`);
  process.exit(0);
}

// Must run before the app reads its env, so call it at module top level before importing src/.
export function useTestEnv(): void {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  // On devva nothing may reach for Postgres: without a URL, anything that does fails loudly.
  if (onDevva) delete process.env.DATABASE_URL;
  process.env.MCP_BEARER_TOKEN = TEST_BEARER;
  process.env.MCP_READ_TOKEN = TEST_READ_TOKEN;
  process.env.PLANIA_CI_TOKEN = TEST_CI_TOKEN;
  process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes";
  process.env.PLANIA_JOBS = "0";
}

// A fresh, seeded store for a test file, whichever store the tests run on, and the way a test looks at it:
// reads (get, find, count) for assertions, and fix() for arranging rows no tool would write (a backdated
// lease, a row in a past state). Both go through the store port, so the same test runs on Postgres and devva.
export type TestStore = Reader & {
  fix<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
  // The id of one of the four seeded projects (micasa, workia, filmia, zigzag), or of any project by slug.
  projectId(slug: string): Promise<string>;
  end(): Promise<void>;
};

const SEED = [
  ["micasa", "MiCasa", "MIC"],
  ["workia", "Workia", "WRK"],
  ["filmia", "Filmia", "FIL"],
  ["zigzag", "Zigzag", "ZIG"],
] as const;

type DevvaT = Awaited<ReturnType<typeof import("../src/store/devva.js").DevvaStore.open>>;
let devva: DevvaT | null = null;
async function endDevva(): Promise<void> {
  const old = devva;
  devva = null;
  if (!old) return;
  const { useDb } = await import("../src/db/client.js");
  useDb(null);
  await old.purge();
  old.close();
}
if (onDevva) after(endDevva);

export async function resetTestStore(): Promise<TestStore> {
  const { pgStore } = await import("../src/store/pg.js");
  const { makeDb, useDb } = await import("../src/db/client.js");
  let end: () => Promise<void>;
  if (onDevva) {
    await endDevva();
    const { DevvaStore } = await import("../src/store/devva.js");
    devva = await DevvaStore.open({ prefix: `t_${process.pid}_${Date.now().toString(36)}` });
    useDb(devva.handle);
    await devva.write("", {}, async (uow) => {
      for (const [slug, title, keyPrefix] of SEED) await uow.insert("projects", { slug, title, keyPrefix });
    });
    end = endDevva;
  } else {
    const raw = await resetTestDb();
    end = () => raw.end();
  }
  // Resolved on every call: the handle changes when the store is rebuilt.
  const store = () => pgStore(makeDb().db);
  return {
    get: (table, key) => store().read((r) => r.get(table, key)),
    find: (table, where, options) => store().read((r) => r.find(table, where, options)),
    count: (table, where) => store().read((r) => r.count(table, where)),
    fix: (fn) => store().write("", {}, fn),
    projectId: async (slug) => {
      const p = await store().read((r) => r.get("projects", { slug }));
      if (!p) throw new Error(`no project ${slug}`);
      return p.id;
    },
    end,
  };
}

// Drops and recreates this checkout's test database, applies every migration, inserts the four projects.
// Returns a raw client for assertions; the caller ends it. Postgres only: a test that should also run on
// devva uses resetTestStore.
export async function resetTestDb(): Promise<pg.Client> {
  if (onDevva) throw new Error("resetTestDb needs Postgres: use resetTestStore, or mark the test pgOnly");
  await parityReport();
  // The shared pool holds connections to the database about to be dropped; the next query opens a fresh one.
  await resetPool();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const raw = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await raw.connect();
  const dir = new URL("../drizzle/migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await raw.query(readFileSync(new URL(f, dir), "utf8"));
  }
  await raw.query(
    "insert into projects (slug, title, key_prefix) values ('micasa','MiCasa','MIC'), ('workia','Workia','WRK'), ('filmia','Filmia','FIL'), ('zigzag','Zigzag','ZIG')",
  );
  await parityStart(raw);
  return raw;
}

// PLANIA_PARITY=1 (with the devva engine of spike/devva-commit-log running): every test database gets a devva
// shadow, and when the database is dropped or the file ends, the two stores are compared. A table the test
// itself changed with raw SQL is expected to differ and is marked; any other difference is a write the store
// port did not carry. One line per database goes to PLANIA_PARITY_LOG.
type ShadowT = Awaited<ReturnType<typeof import("../src/store/shadow.js").Shadow.start>>;
let shadow: ShadowT | null = null;
const rawTouched = new Set<string>();
async function parityStart(raw: pg.Client): Promise<void> {
  if (process.env.PLANIA_PARITY !== "1") return;
  const { Shadow } = await import("../src/store/shadow.js");
  const { makeDb } = await import("../src/db/client.js");
  rawTouched.clear();
  const query = raw.query.bind(raw) as (...args: unknown[]) => unknown;
  (raw as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    const text = typeof args[0] === "string" ? args[0] : ((args[0] as { text?: string })?.text ?? "");
    for (const m of text.matchAll(/\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+"?([a-z_]+)"?/gi)) rawTouched.add(m[1]!.toLowerCase());
    return query(...args);
  };
  shadow = await Shadow.start(makeDb().db, { prefix: `par_${process.pid}_${Date.now().toString(36)}` }, () => {});
  await shadow.settled();
}
async function parityReport(): Promise<void> {
  const s = shadow;
  shadow = null;
  if (!s) return;
  const { tableOf } = await import("../src/store/meta.js");
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const { appendFileSync } = await import("node:fs");
  await s.settled();
  const drift = (await s.parity()).drift.map((d) => ({ ...d, raw: rawTouched.has(getTableConfig(tableOf(d.table)).name) }));
  const unexplained = drift.filter((d) => !d.raw);
  const line = JSON.stringify({ file: path.basename(process.argv.find((a) => a.endsWith(".test.ts")) ?? ""), commits: s.devva.commits, errors: s.errors.length, unexplained, expected: drift.filter((d) => d.raw).map((d) => d.table) });
  if (process.env.PLANIA_PARITY_LOG) appendFileSync(process.env.PLANIA_PARITY_LOG, `${line}\n`);
  if (unexplained.length || s.errors.length) console.log(`PARITY ${line}`);
  await s.devva.purge();
  s.close();
}
if (process.env.PLANIA_PARITY === "1") after(parityReport);

// PLA-I36-11: the owner's code in tests. A fixed secret in a memory store (never the keychain); each call moves
// the TOTP clock one step, so two codes in the same test never share a time step.
const OWNER_SECRET = Buffer.alloc(20, 7);
let ownerTick = 0;
export async function useOwnerCode(enrolled = true): Promise<void> {
  const { MemoryOwnerSecretStore, useOwnerStore } = await import("../src/auth/owner-store.js");
  const store = new MemoryOwnerSecretStore();
  if (enrolled) await store.set(OWNER_SECRET);
  useOwnerStore(store);
}
export async function ownerCode(): Promise<string> {
  const { ownerClock, totp } = await import("../src/auth/owner-totp.js");
  const base = Date.now();
  ownerTick += 1;
  const at = base + ownerTick * 30_000;
  ownerClock.now = () => at;
  return totp(OWNER_SECRET, at);
}
