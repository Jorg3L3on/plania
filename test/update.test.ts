// PLA-I2-8: updating an installed package and restoring a backup. The update runs on temp folders against its own
// plania_test_* database, with the outside calls injected (unpacking, dependencies, pg_dump, the service, the kit's
// database side). The restore test uses the real pg_dump and psql of the test server when they can be found
// (PLANIA_PG_BIN, then the usual places) and is skipped otherwise.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { ADMIN_URL, PG_USER, TEST_DB } from "./helpers.js";
import { migrate, readMigrations, startupProblem } from "../src/db/migrate.js";
import { dumpTo } from "../src/jobs/backup.js";
import { pgToolFor } from "../src/lib/pg-bin.js";
import { kitHashes } from "../src/release.js";
import { freshBackup, update, UpdateError, type UpdateDeps } from "../src/update/index.js";
import { keepKitEdits } from "../src/update/kit-merge.js";
import { psqlRestore, restore, RestoreError } from "../src/update/restore.js";
import { pendingKit, reportLines, type UpdateReport } from "../ui/src/lib/actualizar.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const UPD_DB = `${TEST_DB}_upd`;
const SRC_DB = `${TEST_DB}_rsrc`;
const RST_DB = `${TEST_DB}_rst`;
const urlOf = (db: string) => `postgres://${PG_USER}@localhost:5432/${db}`;
const tmp = (p: string) => mkdtempSync(path.join(tmpdir(), `plania-upd-${p}-`));

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
const dropDb = (db: string) => admin((c) => c.query(`drop database if exists ${db} with (force)`));
async function query<T = Record<string, unknown>>(db: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: urlOf(db) });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

const ALL = readMigrations(path.join(ROOT, "drizzle/migrations"));
const N_MIGRATIONS = ALL.slice(0, -1); // version N lacks the newest migration; N+1 brings it

// A release folder: the given migrations (plus extra .sql files), a built screen, a kit, its manifest.
function release(dir: string, version: string, opts: { migrations: typeof ALL; extra?: Record<string, string>; kit: Record<string, string> }): string {
  mkdirSync(path.join(dir, "drizzle/migrations"), { recursive: true });
  for (const m of opts.migrations) writeFileSync(path.join(dir, "drizzle/migrations", m.name), m.sql);
  for (const [name, sql] of Object.entries(opts.extra ?? {})) writeFileSync(path.join(dir, "drizzle/migrations", name), sql);
  mkdirSync(path.join(dir, "dist/ui"), { recursive: true });
  writeFileSync(path.join(dir, "dist/ui/index.html"), `<title>Plania ${version}</title>`);
  for (const [rel, text] of Object.entries(opts.kit)) {
    mkdirSync(path.dirname(path.join(dir, "kit", rel)), { recursive: true });
    writeFileSync(path.join(dir, "kit", rel), text);
  }
  writeFileSync(path.join(dir, "VERSION"), `${version}\n`);
  writeFileSync(
    path.join(dir, "release.json"),
    JSON.stringify({ format: 1, name: "plania", version, commit: null, built_at: "2026-11-19T00:00:00Z", node: ">=22", migrations: null, kit: kitHashes(path.join(dir, "kit")) }),
  );
  return dir;
}

const KIT_N = { "roles/po.md": "po v1\n", "roles/qa.md": "qa v1\n", "skills/x/SKILL.md": "skill v1\n" };
const KIT_N1 = { "roles/po.md": "po v2 from the release\n", "roles/qa.md": "qa v1\n", "skills/x/SKILL.md": "skill v2\n" };

// The installed N with the buyer's own changes: .env, an edited po (the release changes it too), an edited qa (the
// release does not), an added role; the skill is untouched.
function installedN(): string {
  const root = path.join(tmp("inst"), "plania");
  release(root, "1.0.0", { migrations: N_MIGRATIONS, kit: KIT_N });
  writeFileSync(path.join(root, ".env"), `DATABASE_URL=${urlOf(UPD_DB)}\nSESSION_SECRET=mine\n`);
  writeFileSync(path.join(root, "kit/roles/po.md"), "po edited by the buyer\n");
  writeFileSync(path.join(root, "kit/roles/qa.md"), "qa edited by the buyer\n");
  writeFileSync(path.join(root, "kit/roles/mine.md"), "a role of my own\n");
  return root;
}

type Calls = string[];
function deps(root: string, nextDir: string, calls: Calls, over: Partial<UpdateDeps> = {}): UpdateDeps & { lines: string[]; reports: UpdateReport[] } {
  const lines: string[] = [];
  const reports: UpdateReport[] = [];
  const backupDir = path.join(path.dirname(root), "backups");
  const pkg = path.join(path.dirname(root), "plania-next.tar.gz");
  writeFileSync(pkg, "stand-in archive");
  return {
    lines,
    reports,
    root,
    packageFile: pkg,
    now: () => new Date(),
    log: (l) => lines.push(l),
    inFlight: async () => [],
    extract: async (_file, dir) => {
      calls.push("extract");
      cpSync(nextDir, path.join(dir, "plania-next"), { recursive: true });
    },
    installDeps: async () => void calls.push("deps"),
    backupDir,
    dump: async (file) => {
      calls.push("dump");
      writeFileSync(file, gzipSync("-- dump"));
    },
    service: { stop: async () => void calls.push("stop"), start: async () => void calls.push("start") },
    migrate: async (dir) => {
      calls.push("migrate");
      const c = new pg.Client({ connectionString: urlOf(UPD_DB) });
      await c.connect();
      try {
        return (await migrate(c, { files: readMigrations(dir), atomic: true })).applied;
      } finally {
        await c.end();
      }
    },
    kitRoles: async () => [{ role: "asistente", title: "Prompt: asistente", state: "doc_newer" }],
    record: async (r) => void reports.push(r),
    ...over,
  };
}

// Version N's database with data in it.
async function databaseAtN(): Promise<void> {
  await dropDb(UPD_DB);
  await admin((c) => c.query(`create database ${UPD_DB}`));
  const c = new pg.Client({ connectionString: urlOf(UPD_DB) });
  await c.connect();
  try {
    await migrate(c, { files: N_MIGRATIONS, named: true });
    await c.query(`insert into machine_state (key, value) values ('test.data', '{"n": 42}')`);
  } finally {
    await c.end();
  }
}

const tableCounts = async (db: string) => {
  const tables = await query<{ t: string }>(db, `select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const out: Record<string, number> = {};
  for (const { t } of tables) out[t] = Number((await query<{ n: number }>(db, `select count(*)::int as n from "${t}"`))[0]!.n);
  return out;
};

describe("update", () => {
  before(async () => databaseAtN());
  after(async () => dropDb(UPD_DB));

  test("from N with data to N+1: data intact, migrations applied, settings and kit edits kept, report recorded", async () => {
    await databaseAtN();
    const root = installedN();
    const next = release(path.join(tmp("next"), "plania-1.1.0"), "1.1.0", {
      migrations: ALL,
      extra: { "9000_update_marker.sql": "create table update_marker (id int primary key);" },
      kit: KIT_N1,
    });
    const before = await tableCounts(UPD_DB);
    const calls: Calls = [];
    const d = deps(root, next, calls);
    const report = await update(d);

    assert.deepEqual(calls, ["extract", "deps", "dump", "stop", "migrate", "start"]);
    // The new program files, the buyer's own files.
    assert.equal(readFileSync(path.join(root, "VERSION"), "utf8"), "1.1.0\n");
    assert.match(readFileSync(path.join(root, ".env"), "utf8"), /SESSION_SECRET=mine/);
    assert.equal(readFileSync(path.join(root, "kit/roles/po.md"), "utf8"), "po edited by the buyer\n");
    assert.equal(readFileSync(path.join(root, "kit.new/roles/po.md"), "utf8"), "po v2 from the release\n");
    assert.equal(readFileSync(path.join(root, "kit/roles/qa.md"), "utf8"), "qa edited by the buyer\n");
    assert.equal(readFileSync(path.join(root, "kit/roles/mine.md"), "utf8"), "a role of my own\n");
    assert.equal(readFileSync(path.join(root, "kit/skills/x/SKILL.md"), "utf8"), "skill v2\n", "an untouched file takes the release's version");
    assert.ok(existsSync(`${root}.previous-1.0.0/VERSION`), "the previous version is kept for going back");
    assert.ok(!readdirSync(path.dirname(root)).some((n) => n.startsWith(".plania-incoming-")), "the unpacked package is cleaned up");
    // The database: every row that was there is still there; the new migrations are recorded.
    const afterCounts = await tableCounts(UPD_DB);
    for (const [t, n] of Object.entries(before)) if (t !== "plania_migrations") assert.equal(afterCounts[t], n, `${t} rows`);
    assert.deepEqual(await query(UPD_DB, `select value from machine_state where key = 'test.data'`), [{ value: { n: 42 } }]);
    assert.equal(afterCounts.update_marker, 0);
    assert.deepEqual(
      (await query<{ name: string }>(UPD_DB, `select name from plania_migrations where name >= $1 order by name`, [ALL.at(-1)!.name])).map((r) => r.name),
      [ALL.at(-1)!.name, "9000_update_marker.sql"],
    );
    assert.equal(await startupProblem(urlOf(UPD_DB), readMigrations(path.join(root, "drizzle/migrations"))), null, "the new version starts");
    // The report: kit files and roles, on the screen and printed.
    assert.deepEqual(d.reports, [report]);
    assert.equal(report.from, "1.0.0");
    assert.equal(report.to, "1.1.0");
    assert.match(report.backup, /plania-pre-update-1\.0\.0-to-1\.1\.0-.*\.sql\.gz$/);
    assert.deepEqual(
      report.kit_files.map((k) => `${k.file} ${k.kind}`).sort(),
      ["kit/roles/mine.md added", "kit/roles/po.md both", "kit/roles/qa.md edited"],
    );
    assert.equal(pendingKit(report), 2);
    for (const line of reportLines(report)) assert.ok(d.lines.includes(line), line);
    assert.ok(d.lines.some((l) => /kit\.new\/roles\/po\.md/.test(l)));
    assert.ok(d.lines.some((l) => /Prompt: asistente.*kit:sync --force/.test(l)));
    assert.match(d.lines.at(-1)!, /versión 1\.1\.0.*\/novedades/);
  });

  test("a failing migration keeps the backup, says how to go back, and leaves the old version startable", async () => {
    await databaseAtN();
    const root = installedN();
    const next = release(path.join(tmp("bad"), "plania-1.1.0"), "1.1.0", {
      migrations: ALL,
      extra: { "9000_update_marker.sql": "create table update_marker (id int primary key);", "9001_broken.sql": "select * from no_such_table;" },
      kit: KIT_N1,
    });
    const before = await tableCounts(UPD_DB);
    const calls: Calls = [];
    const d = deps(root, next, calls);
    await assert.rejects(update(d), (e: unknown) => {
      assert.ok(e instanceof UpdateError);
      assert.equal(e.code, "MIGRATION_FAILED");
      assert.match(e.message, /9001_broken\.sql/);
      assert.match(e.message, /sigue en la versión 1\.0\.0/);
      assert.match(e.message, /pnpm restore:plania .*plania-pre-update-1\.0\.0-to-1\.1\.0-.*\.sql\.gz/);
      return true;
    });
    assert.deepEqual(calls, ["extract", "deps", "dump", "stop", "migrate", "start"]);
    // The old program files are back, untouched.
    assert.equal(readFileSync(path.join(root, "VERSION"), "utf8"), "1.0.0\n");
    assert.equal(readFileSync(path.join(root, "kit/roles/po.md"), "utf8"), "po edited by the buyer\n");
    assert.ok(!existsSync(path.join(root, "kit.new")));
    // The backup is there; the database is exactly as it was (all or nothing), so the old version passes its start-up check.
    const backups = readdirSync(path.join(path.dirname(root), "backups"));
    assert.equal(backups.length, 1);
    assert.deepEqual(await tableCounts(UPD_DB), before);
    assert.equal(await startupProblem(urlOf(UPD_DB), readMigrations(path.join(root, "drizzle/migrations"))), null);
  });

  test("an update with a run in flight is refused with one sentence, and nothing is touched", async () => {
    const root = installedN();
    const calls: Calls = [];
    const d = deps(root, root, calls, { inFlight: async () => [{ kind: "run", text: "po trabaja en PLA-1" }] });
    await assert.rejects(update(d), (e: unknown) => {
      assert.ok(e instanceof UpdateError);
      assert.equal(e.code, "IN_FLIGHT");
      assert.equal(e.message, "No se actualizó: hay trabajo en curso (po trabaja en PLA-1). Espera a que termine y vuelve a correr la actualización.");
      return true;
    });
    assert.deepEqual(calls, []);
    assert.equal(readFileSync(path.join(root, "VERSION"), "utf8"), "1.0.0\n");
  });

  test("the same or an older version is refused before anything stops", async () => {
    const root = installedN();
    const calls: Calls = [];
    const same = release(path.join(tmp("same"), "plania-1.0.0"), "1.0.0", { migrations: N_MIGRATIONS, kit: KIT_N });
    await assert.rejects(update(deps(root, same, calls)), (e: unknown) => e instanceof UpdateError && e.code === "NOT_NEWER");
    assert.deepEqual(calls, ["extract"]);
  });

  test("no backup from today, no migration: the old version is put back", async () => {
    await databaseAtN();
    const root = installedN();
    const next = release(path.join(tmp("nob"), "plania-1.1.0"), "1.1.0", { migrations: ALL, kit: KIT_N1 });
    const calls: Calls = [];
    const yesterday = new Date(Date.now() - 36 * 3600_000);
    const d = deps(root, next, calls, {
      dump: async (file) => {
        calls.push("dump");
        writeFileSync(file, gzipSync("-- dump"));
        utimesSync(file, yesterday, yesterday);
      },
    });
    await assert.rejects(update(d), (e: unknown) => e instanceof UpdateError && e.code === "NO_FRESH_BACKUP");
    assert.ok(!calls.includes("migrate"));
    assert.equal(readFileSync(path.join(root, "VERSION"), "utf8"), "1.0.0\n");
    assert.equal(calls.at(-1), "start");
  });

  test("freshBackup finds today's non-empty dump only", () => {
    const dir = tmp("fresh");
    const now = new Date();
    assert.equal(freshBackup(dir, now), null);
    writeFileSync(path.join(dir, "plania-20200101.sql.gz"), "x");
    const old = new Date(now.getTime() - 48 * 3600_000);
    utimesSync(path.join(dir, "plania-20200101.sql.gz"), old, old);
    writeFileSync(path.join(dir, "plania-empty.sql.gz"), "");
    assert.equal(freshBackup(dir, now), null);
    writeFileSync(path.join(dir, "plania-pre-update-x.sql.gz"), "x");
    assert.equal(freshBackup(dir, now), path.join(dir, "plania-pre-update-x.sql.gz"));
  });

  test("without the shipped hashes (an older package) every differing kit file is kept, the release's beside it", () => {
    const prev = tmp("prev");
    const nextRoot = tmp("nextroot");
    for (const [d, files] of [[prev, { "roles/po.md": "mine" }], [nextRoot, { "roles/po.md": "theirs", "roles/qa.md": "new" }]] as const) {
      for (const [rel, t] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(d, "kit", rel)), { recursive: true });
        writeFileSync(path.join(d, "kit", rel), t);
      }
    }
    assert.deepEqual(keepKitEdits(prev, nextRoot, null), [{ file: "kit/roles/po.md", kind: "both" }]);
    assert.equal(readFileSync(path.join(nextRoot, "kit/roles/po.md"), "utf8"), "mine");
    assert.equal(readFileSync(path.join(nextRoot, "kit.new/roles/po.md"), "utf8"), "theirs");
  });
});

describe("restore", () => {
  // The test server's own client tools, as the restore command finds them.
  let pgDump = "";
  let psql = "";
  before(async () => {
    const major = await admin(async (c) => Math.floor(Number((await c.query("show server_version_num")).rows[0].server_version_num) / 10000));
    pgDump = pgToolFor("pg_dump", major);
    psql = pgToolFor("psql", major);
  });
  after(async () => {
    await dropDb(SRC_DB);
    await dropDb(RST_DB);
  });

  test("brings a database back from a backup file, and refuses to replace one with data unless asked twice", async (t) => {
    const found = (p: string) => path.isAbsolute(p) && (existsSync(p) || existsSync(`${p}.exe`));
    if (!found(pgDump) || !found(psql)) {
      t.skip(`pg_dump/psql not found (${pgDump}); set PLANIA_PG_BIN`);
      return;
    }
    await dropDb(SRC_DB);
    await dropDb(RST_DB);
    await admin((c) => c.query(`create database ${SRC_DB}`));
    const c = new pg.Client({ connectionString: urlOf(SRC_DB) });
    await c.connect();
    await migrate(c, { files: ALL, named: true });
    await c.query(`insert into machine_state (key, value) values ('test.data', '{"n": 7}')`);
    await c.end();
    const file = path.join(tmp("bk"), "plania-20261119.sql.gz");
    await dumpTo(pgDump, urlOf(SRC_DB), file);

    const lines: string[] = [];
    const r = await restore({ file, url: urlOf(RST_DB), psql: psqlRestore(psql), log: (l) => lines.push(l) });
    assert.equal(r.created, true);
    assert.equal(r.migrations, ALL.length);
    assert.deepEqual(await tableCounts(RST_DB), await tableCounts(SRC_DB));
    assert.deepEqual(await query(RST_DB, `select value from machine_state where key = 'test.data'`), [{ value: { n: 7 } }]);
    assert.match(lines.at(-1)!, /volvió del respaldo/);

    // A database with data: refused, then refused with a wrong confirmation, then replaced when asked twice.
    await assert.rejects(restore({ file, url: urlOf(RST_DB), psql: psqlRestore(psql) }), (e: unknown) => e instanceof RestoreError && e.code === "HAS_DATA" && e.message.includes(`--overwrite --confirm ${RST_DB}`));
    await assert.rejects(restore({ file, url: urlOf(RST_DB), overwrite: true, confirm: "plania", psql: psqlRestore(psql) }), (e: unknown) => e instanceof RestoreError && e.code === "HAS_DATA");
    await query(RST_DB, `update machine_state set value = '{"n": 0}' where key = 'test.data'`);
    const again = await restore({ file, url: urlOf(RST_DB), overwrite: true, confirm: RST_DB, psql: psqlRestore(psql) });
    assert.equal(again.replaced, true);
    assert.deepEqual(await query(RST_DB, `select value from machine_state where key = 'test.data'`), [{ value: { n: 7 } }]);
  });

  test("a missing backup file is one sentence", async () => {
    await assert.rejects(restore({ file: path.join(tmpdir(), "no-such-backup.sql.gz"), url: urlOf(RST_DB), psql: async () => {} }), (e: unknown) => e instanceof RestoreError && e.code === "NO_FILE");
  });
});

describe("screen", () => {
  test("Novedades shows the last update's kept kit edits with what to do", async () => {
    const React = await import("react");
    (globalThis as { React?: unknown }).React = React;
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { MemoryRouter } = await import("react-router");
    const page = (await import(new URL("../ui/src/pages/novedades.tsx", import.meta.url).href)) as Record<string, any>;
    const last: UpdateReport = {
      from: "1.0.0",
      to: "1.1.0",
      at: "2026-11-19T12:00:00Z",
      backup: "/home/ana/plania-backups/plania-pre-update-1.0.0-to-1.1.0.sql.gz",
      kit_files: [{ file: "kit/roles/po.md", kind: "both" }],
      kit_roles: [{ role: "qa", title: "Prompt: qa", state: "both_changed" }],
    };
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(page.NovedadesView, { release: { version: "1.1.0", commit: null, built_at: null, packaged: true, notes: "", last_update: last } })),
    );
    assert.match(html, /data-last-update="1\.1\.0"/);
    assert.match(html, /De la versión 1\.0\.0 a la 1\.1\.0, el 19 de noviembre\./);
    assert.match(html, /kit\.new\/roles\/po\.md/);
    assert.match(html, /Prompt: qa/);
    assert.equal((html.match(/data-kit-todo="1"/g) ?? []).length, 2);
  });
});
