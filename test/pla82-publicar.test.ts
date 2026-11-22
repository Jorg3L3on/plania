// PLA-82 (F-32, F-33, F-34): Publicar closes the loop. The release's migration files are read from GitHub's compare
// and said on the sheet; after the release Plania backs up and migrates the app's own local database (faked git and
// shell here: nothing real runs); an initiative whose steps are all published closes itself. Test DB only.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { findProject } = await import("../src/mcp/queries.js");
const { migrationFiles } = await import("../src/mcp/release-plan.js");
const { migrateMode } = await import("../src/mcp/release-ship.js");
const { settleInitiatives, ONLY_PUBLISH_LEFT, CLOSED_BY_RELEASE } = await import("../src/jobs/github.js");
const { migrarBaseDeLaApp } = await import("../src/captures/publicado.js");
const hojas = (await import(new URL("../ui/src/lib/publicar.ts", import.meta.url).href)) as Record<string, any>;

test("PLA-158 (F-25): «Decir quién migra» lands on production's missing field in Despliegue", () => {
  assert.deepEqual(hojas.prodFixLink({ prod_fix: { env: "produccion", name: "Producción", missing: "provider" } }, "es"), {
    label: "Elige la base de datos de Producción",
    why: "Falta un dato: la base de datos de Producción. Con ella, Plania sabe quién migra.",
    env: "produccion",
    focus: "env-produccion-base",
  });
  assert.deepEqual(hojas.prodFixLink({ prod_fix: { env: "produccion", name: "Producción", missing: null } }, "es"), { label: "Decir quién migra", why: null, env: "produccion", focus: "env-produccion-cuando" });
  assert.deepEqual(hojas.prodFixLink({}, "es"), { label: "Decir quién migra", why: null, env: null, focus: null });
});

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
const ctx = { actor: { agent: "t", session_id: "s-pla82", machine: "ci" } };
const TMP = mkdtempSync(path.join(tmpdir(), "plania-pla82-"));

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
});
after(async () => {
  await raw.end();
  rmSync(TMP, { recursive: true, force: true });
});

describe("F-32: the release's migrations", () => {
  test("migration files are the ones the compare adds under a migrations folder; meta, changes and other files are not", () => {
    const files = [
      { filename: "drizzle/0003_seguimiento.sql", status: "added" },
      { filename: "drizzle/meta/0003_snapshot.json", status: "added" },
      { filename: "drizzle/meta/_journal.json", status: "modified" },
      { filename: "prisma/migrations/20261118_cita/migration.sql", status: "added" },
      { filename: "drizzle/0002_old.sql", status: "modified" },
      { filename: "src/app/page.tsx", status: "added" },
    ];
    assert.deepEqual(migrationFiles(files), ["drizzle/0003_seguimiento.sql", "prisma/migrations/20261118_cita/migration.sql"]);
  });

  test("who migrates: auto with settings.capture.database, manual without, nobody when the release adds none", () => {
    const withDb = { settings: { capture: { database: { env_var: "DATABASE_URL", migrate_command: "npm run db:migrate" } } } };
    assert.equal(migrateMode(withDb, { migrations: [], migration_files: ["drizzle/0003_x.sql"] }), "auto");
    assert.equal(migrateMode({ settings: {} }, { migrations: ["0003"], migration_files: [] }), "manual");
    assert.equal(migrateMode(withDb, { migrations: [], migration_files: [] }), null);
  });

  test("the Publicar sheet says the release changes the database and who migrates it", () => {
    // PLA-I68-1: the copy Plania migrates is the local test copy; production is said apart.
    assert.equal(hojas.migrationLine(["0003_seguimiento.sql"], "auto", "Mianovia", "es", "deploy"), "Lleva un cambio a la base de datos (0003_seguimiento.sql). Al publicar, Plania respalda la copia de prueba de Mianovia en esta computadora y la migra. En producción, el despliegue corre las migraciones.");
    assert.match(hojas.migrationLine(["a.sql", "b.sql", "c.sql", "d.sql"], "manual", "Mianovia"), /^Lleva 4 cambios a la base de datos \(a\.sql, b\.sql, c\.sql y 1 más\)\. Nadie dijo quién migra la base de producción de Mianovia/);
  });
});

describe("F-32: migrating the app's own database after a release", () => {
  const REPO = path.join(TMP, "repo");
  const WT = path.join(TMP, "worktrees");
  const BACKUPS = path.join(TMP, "backups");
  let execs: { command: string; env?: NodeJS.ProcessEnv; cwd: string }[] = [];
  let gitCalls: string[][] = [];
  let failMigrate = false;
  const git = async (args: string[]) => {
    gitCalls.push(args);
    if (args[0] === "worktree" && args[1] === "add") mkdirSync(args[3]!, { recursive: true });
    return { code: 0, stdout: "", stderr: "" };
  };
  const exec = async (command: string, opts: { cwd: string; env?: NodeJS.ProcessEnv }) => {
    execs.push({ command, env: opts.env, cwd: opts.cwd });
    if (failMigrate && command === "npm run db:migrate") return { code: 1, stdout: "", stderr: "Error: relation \"cita\" already exists\n" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const deps = () => ({ git, exec, env: { ...process.env, PLANIA_WORKTREES_ROOT: WT }, backups: BACKUPS, now: () => new Date("2026-11-18T09:50:10Z") });
  const project = async (url: string) => {
    writeFileSync(path.join(REPO, ".env.local"), `DATABASE_URL=${url}\n`);
    await raw.query(`update projects set settings = settings || $1::jsonb where slug = 'zigzag'`, [
      JSON.stringify({ local: { repo_path: REPO }, capture: { start_command: "npm run dev -- -p {port}", port: 3000, pages: [{ key: "home", path: "/", label: "Inicio" }], database: { env_var: "DATABASE_URL", migrate_command: "npm run db:migrate" } } }),
    ]);
    return findProject(db, "zigzag");
  };
  before(() => mkdirSync(REPO, { recursive: true }));

  test("backs up, then runs the migrate command in Plania's own checkout of main, against the app's local database", async () => {
    execs = [];
    gitCalls = [];
    const p = await project("postgres://localhost:5432/zigzag_dev");
    const out = await migrarBaseDeLaApp(db, p, "main", ["drizzle/0003_x.sql"], deps());
    assert.deepEqual(out, { ok: true, db: "zigzag_dev", backup: path.join(BACKUPS, "zigzag_dev-pre-release-20261118T095010Z.sql.gz"), migrations: [] });
    assert.deepEqual(gitCalls.slice(0, 2), [["fetch", "origin", "main"], ["worktree", "add", "--detach", path.join(WT, "zigzag", "_publicado"), "origin/main"]]);
    const [dump, migrate] = execs;
    assert.match(dump!.command, /pg_dump .*\| gzip/);
    assert.equal(dump!.env!.PLANIA_APP_URL, "postgres://localhost:5432/zigzag_dev", "the URL goes in the environment, never the command line");
    assert.equal(migrate!.command, "npm run db:migrate");
    assert.equal(migrate!.env!.DATABASE_URL, "postgres://localhost:5432/zigzag_dev");
    assert.equal(migrate!.cwd, path.join(WT, "zigzag", "_publicado"));
    assert.equal(migrate!.env!.PLANIA_APP_URL, undefined, "Plania's own variables stay out");
    const ev = (await raw.query(`select payload from events where type = 'release.migrated' order by created_at desc limit 1`)).rows[0].payload;
    assert.equal(ev.ok, true);
  });

  test("a remote database is never touched; a failed migration is said in the project's thread with the backup", async () => {
    execs = [];
    const remote = await project("postgres://u@db.example.com:5432/zigzag");
    const r = await migrarBaseDeLaApp(db, remote, "main", ["0003"], deps());
    assert.equal(r.ok, false);
    assert.equal(execs.length, 0, "nothing ran");
    failMigrate = true;
    const p = await project("postgres://localhost:5432/zigzag_dev");
    const f = (await migrarBaseDeLaApp(db, p, "main", ["0003"], deps())) as Json;
    failMigrate = false;
    assert.equal(f.ok, false);
    assert.match(f.error, /npm run db:migrate falló: Error: relation "cita" already exists/);
    const msg = (await raw.query(`select m.body from thread_messages m join threads t on t.id = m.thread_id join projects p on p.id = t.project_id where p.slug = 'zigzag' order by m.at desc limit 1`)).rows[0].body;
    assert.match(msg, /no pude migrar la base de la app/);
    assert.match(msg, /zigzag_dev-pre-release-20261118T095010Z\.sql\.gz/);
  });
});

describe("F-33, F-34: an initiative whose steps are all published closes itself", () => {
  const ini = async (title: string, statuses: string[]) => {
    const i = (await createTask(db, { project: "micasa", kind: "initiative", title, scope: "s", next_action: "MIC-3 en revisión… sigue MIC-4" } as never, ctx)) as { key: string };
    const keys: string[] = [];
    for (const [n, st] of statuses.entries()) {
      const t = (await createTask(db, { project: "micasa", parent_key: i.key, phase: n + 1, title: `Paso ${n + 1}`, scope: "s", checks: ["c"] } as never, ctx)) as { key: string };
      await raw.query(`update tasks set status = $1 where key = $2`, [st, t.key]);
      keys.push(t.key);
    }
    return i.key;
  };
  const row = async (key: string) => (await raw.query(`select status, next_action from tasks where key = $1`, [key])).rows[0];

  test("all Done closes it with the reason; all merged or released says only publishing is left; work left changes nothing", async () => {
    const done = await ini("Seguimiento", ["Done", "Done", "Won't do"]);
    const left = await ini("Citas", ["Done", "Merged", "Released"]);
    const busy = await ini("Agenda", ["Done", "In review"]);
    const p = await findProject(db, "micasa");
    assert.equal(await settleInitiatives(db, p), 1);
    assert.deepEqual(await row(done), { status: "Done", next_action: CLOSED_BY_RELEASE });
    assert.deepEqual(await row(left), { status: "Planning", next_action: ONLY_PUBLISH_LEFT });
    assert.deepEqual(await row(busy), { status: "Planning", next_action: "MIC-3 en revisión… sigue MIC-4" });
    assert.equal(await settleInitiatives(db, p), 0, "nothing twice");
  });

  test("settings.auto_done false keeps the owner's «Cerrar iniciativa»", async () => {
    const k = await ini("Manual", ["Done"]);
    await raw.query(`update projects set settings = settings || '{"auto_done": false}'::jsonb where slug = 'micasa'`);
    assert.equal(await settleInitiatives(db, await findProject(db, "micasa")), 0);
    assert.equal((await row(k)).status, "Planning");
    await raw.query(`update projects set settings = settings - 'auto_done' where slug = 'micasa'`);
  });
});
