// PLA-I48-2: the read-only base reader against a throwaway local database (zigzag_test_i48r_<pid>) with four fake
// tables: tables, counts, columns, keys, relations, paging and the total; a remote host and a database registered
// in env_states refused before any query; a password_hash column hidden; the reader's session read-only; the guarded
// Vaciar y sembrar; and the fake password searched for in every response, log line and event.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { createHash } from "node:crypto";
import { resetTestDb, useTestEnv, PG_USER } from "./helpers.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i48-reader-"));
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const maquinas = await import("../src/maquinas/machines.js");
const reader = await import("../src/maquinas/reader.js");
type Json = Record<string, any>;

const USER = PG_USER;
const DB = `zigzag_test_i48r_${process.pid}`;
const FAKE_PASSWORD = "fake-pw-Zx81-no-real";
const URL_OK = `postgres://${USER}:${FAKE_PASSWORD}@127.0.0.1:5432/${DB}`;
const REPO = path.join(TMP, "zigzag");
const ADMIN = `postgres://${USER}@localhost:5432/postgres`;

// Everything that leaves the process during the test: responses, console and stdout/stderr.
const seen: string[] = [];
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const call = async (method: string, url: string, body?: Json): Promise<{ status: number; body: Json; ms: number }> => {
  const t0 = Date.now();
  const r = await app.request(url, { method, headers: jorge(), ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  seen.push(text);
  return { status: r.status, body: JSON.parse(text) as Json, ms: Date.now() - t0 };
};
const writeEnv = (url: string) => writeFileSync(path.join(REPO, ".env.local"), `# local\nDATABASE_URL="${url}"\nNEXT_PUBLIC_SITE=x\n`);

const SCHEMA = `
create table autores (id serial primary key, nombre text not null unique, nacido date);
create table usuarios (id serial primary key, email text not null unique, password_hash text not null, creado timestamptz not null default now());
create table libros (id serial primary key, autor_id integer not null references autores(id), titulo_de_un_libro_con_un_nombre_muy_largo_para_la_columna text not null, paginas integer);
create table prestamos (id serial primary key, libro_id integer not null references libros(id), usuario_id integer not null references usuarios(id), devuelto boolean not null default false);
create index libros_autor_idx on libros (autor_id);
create schema drizzle;
create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint);
`;
const SEED = `
insert into autores (nombre) values ('Autora Uno'), ('Autor Dos'), ('Autora Tres');
insert into usuarios (email, password_hash) values ('ana@example.com', 'argon2-hash-de-mentira'), ('luis@example.com', 'otro-hash');
insert into libros (autor_id, titulo_de_un_libro_con_un_nombre_muy_largo_para_la_columna, paginas) select 1 + (g % 3), 'Libro ' || g, 100 + g from generate_series(1, 120) g;
insert into prestamos (libro_id, usuario_id) values (1, 1), (2, 2);
`;
const MIGRATION_0 = "create table autores (id serial primary key);\n";
const MIGRATION_1 = "alter table autores add column nacido date;\n";

let raw: pg.Client;
let logs: { restore: () => void } | null = null;

before(async () => {
  raw = await resetTestDb();
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB}`);
  await admin.end();
  const t = new pg.Client({ connectionString: `postgres://${USER}@127.0.0.1:5432/${DB}` });
  await t.connect();
  await t.query(SCHEMA);
  await t.query(SEED);
  await t.query(`insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, 1)`, [createHash("sha256").update(MIGRATION_0).digest("hex")]);
  await t.end();
  mkdirSync(path.join(REPO, "drizzle"), { recursive: true });
  writeFileSync(path.join(REPO, "drizzle", "0000_init.sql"), MIGRATION_0);
  writeFileSync(path.join(REPO, "drizzle", "0001_nacido.sql"), MIGRATION_1);
  writeFileSync(path.join(REPO, "seed.sql"), SEED);
  writeFileSync(path.join(REPO, "seed.sh"), `psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U ${USER} -d ${DB} -f seed.sql\n`);
  writeFileSync(path.join(REPO, "migrate.sh"), "echo migrated\n");
  writeEnv(URL_OK);
  await raw.query(`update projects set settings = settings || $1::jsonb where slug = 'zigzag'`, [
    JSON.stringify({ local: { repo_path: REPO }, maquinas: { migrate: "sh migrate.sh", seed: "sh seed.sh" } }),
  ]);
  maquinas.setMaquinasDeps({ env: { ...process.env, PLANIA_WORKTREES_ROOT: path.join(TMP, "wt") } });
  // Capture every log line from here on.
  const orig = { log: console.log, error: console.error, warn: console.warn, out: process.stdout.write.bind(process.stdout), err: process.stderr.write.bind(process.stderr) };
  const grab = (...a: unknown[]) => void seen.push(a.map(String).join(" "));
  console.log = grab;
  console.error = grab;
  console.warn = grab;
  process.stderr.write = ((chunk: unknown, ...rest: any[]) => {
    seen.push(String(chunk));
    return orig.err(chunk as string, ...rest);
  }) as typeof process.stderr.write;
  logs = {
    restore: () => {
      console.log = orig.log;
      console.error = orig.error;
      console.warn = orig.warn;
      process.stderr.write = orig.err as typeof process.stderr.write;
    },
  };
});

// PLA-65: each step on its own, so a failed setup (no admin connection) still closes raw and the process exits.
after(async () => {
  logs?.restore();
  rmSync(TMP, { recursive: true, force: true });
  await raw?.end().catch(() => undefined);
  const admin = new pg.Client({ connectionString: ADMIN });
  try {
    await admin.connect();
    await admin.query(`drop database if exists ${DB} with (force)`);
  } finally {
    await admin.end().catch(() => undefined);
  }
});

describe("tables", () => {
  test("each table with its row count, columns, keys, relations and indexes; the migrations; the connection without password", async () => {
    const r = await call("GET", "/api/projects/zigzag/maquinas/tablas");
    assert.equal(r.status, 200);
    const t = r.body;
    assert.deepEqual(t.connection, { host: "127.0.0.1", port: 5432, database: DB });
    assert.deepEqual(
      t.tables.map((x: Json) => [x.name, x.rows]),
      [
        ["autores", 3],
        ["libros", 120],
        ["prestamos", 2],
        ["usuarios", 2],
      ],
    );
    assert.equal(t.total_rows, 127);
    const autores = t.tables.find((x: Json) => x.name === "autores");
    const nombre = autores.columns.find((c: Json) => c.name === "nombre");
    assert.deepEqual([nombre.type, nombre.not_null, nombre.unique, nombre.key], ["text", true, true, false]);
    assert.equal(autores.columns.find((c: Json) => c.name === "id").key, true);
    assert.equal(autores.columns.find((c: Json) => c.name === "nacido").not_null, false);
    const prestamos = t.tables.find((x: Json) => x.name === "prestamos");
    assert.deepEqual(prestamos.relations, [
      { column: "libro_id", table: "libros", foreign: "id" },
      { column: "usuario_id", table: "usuarios", foreign: "id" },
    ].sort((a, b) => a.column.localeCompare(b.column)));
    assert.deepEqual(prestamos.columns.find((c: Json) => c.name === "libro_id").references, { table: "libros", column: "id" });
    const libros = t.tables.find((x: Json) => x.name === "libros");
    assert.ok(libros.indexes.some((i: Json) => i.name === "libros_autor_idx"));
    assert.equal(t.tables.find((x: Json) => x.name === "usuarios").columns.find((c: Json) => c.name === "password_hash").hidden, true);
    assert.ok(!t.tables.some((x: Json) => x.name === "__drizzle_migrations"), "the migrations table is not a drawer");
    assert.equal(t.migrations.dir, "drizzle");
    assert.deepEqual(t.migrations.files, [
      { name: "0000_init", applied: true },
      { name: "0001_nacido", applied: false },
    ]);
    assert.deepEqual([t.migrations.applied, t.migrations.pending], [1, 1]);
    assert.equal(t.sample, false);
  });

  test("rows: 50 a page with the total, ordered by the key; the next page; a password_hash column comes back (oculto)", async () => {
    const p1 = await call("GET", "/api/projects/zigzag/maquinas/tablas/libros/filas");
    assert.equal(p1.status, 200);
    assert.equal(p1.body.total, 120);
    assert.equal(p1.body.rows.length, 50);
    assert.equal(p1.body.limit, 50);
    assert.equal(p1.body.rows[0].id, "1");
    const p3 = await call("GET", "/api/projects/zigzag/maquinas/tablas/libros/filas?offset=100");
    assert.equal(p3.body.rows.length, 20);
    assert.equal(p3.body.offset, 100);
    assert.equal(p3.body.rows[0].id, "101");
    const u = await call("GET", "/api/projects/zigzag/maquinas/tablas/usuarios/filas");
    assert.deepEqual(u.body.hidden, ["password_hash"]);
    assert.deepEqual(u.body.rows.map((r: Json) => r.password_hash), ["(oculto)", "(oculto)"]);
    assert.ok(!JSON.stringify(u.body).includes("argon2-hash-de-mentira"));
    assert.equal(u.body.rows[0].email, "ana@example.com");
    // Only a name the catalog lists reaches SQL.
    const bad = await call("GET", `/api/projects/zigzag/maquinas/tablas/${encodeURIComponent('libros"; drop table autores; --')}/filas`);
    assert.equal(bad.status, 404);
    assert.equal(bad.body.error, "TABLE_NOT_FOUND");
  });

  test("the reader's session is read-only: a write through it fails", async () => {
    const a = maquinas.appEnvOf(await maquinas.projectOf((await import("../src/db/client.js")).makeDb().db, "zigzag")).address!;
    const c = await reader.openReader(a);
    try {
      await assert.rejects(c.query("insert into autores (nombre) values ('no')"), /read-only transaction/);
      await assert.rejects(c.query("truncate autores cascade"), /read-only transaction/);
    } finally {
      await c.end();
    }
  });
});

describe("refusals before any query", () => {
  test("a remote host is refused at once with BASE_NOT_LOCAL", async () => {
    writeEnv(`postgres://${USER}:${FAKE_PASSWORD}@10.255.255.1:5432/${DB}`);
    const r = await call("GET", "/api/projects/zigzag/maquinas/tablas");
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "BASE_NOT_LOCAL");
    assert.ok(r.ms < 1000, `no connection was tried (${r.ms} ms)`);
    const rows = await call("GET", "/api/projects/zigzag/maquinas/tablas/libros/filas");
    assert.equal(rows.body.error, "BASE_NOT_LOCAL");
    const reset = await call("POST", "/api/projects/zigzag/maquinas/vaciar-y-sembrar", { rows: 127 });
    assert.equal(reset.body.error, "BASE_NOT_LOCAL");
    writeEnv(URL_OK);
  });

  test("a database registered in an env_states row is refused with BASE_REGISTERED; so is Plania's own", async () => {
    await raw.query(
      `insert into env_states (project_id, env, flags, by) values ((select id from projects where slug = 'workia'), 'staging', $1::jsonb, '{"agent":"test","session_id":"t"}'::jsonb)`,
      [JSON.stringify({ database: DB })],
    );
    const r = await call("GET", "/api/projects/zigzag/maquinas/tablas");
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "BASE_REGISTERED");
    await raw.query(`delete from env_states where env = 'staging'`);
    writeEnv(process.env.DATABASE_URL!);
    const own = await call("GET", "/api/projects/zigzag/maquinas/tablas");
    assert.equal(own.body.error, "BASE_REGISTERED");
    writeEnv(URL_OK);
    assert.equal((await call("GET", "/api/projects/zigzag/maquinas/tablas")).status, 200);
  });
});

describe("the only writing path", () => {
  test("Sembrar runs migrate then seed in the app's directory", async () => {
    // Empty the base first through the guarded route, with the count the screen showed.
    const before = await call("GET", "/api/projects/zigzag/maquinas/tablas");
    const r = await call("POST", "/api/projects/zigzag/maquinas/vaciar-y-sembrar", { rows: before.body.total_rows });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.tables.total_rows, 127);
    assert.equal(r.body.tables.sample, true, "only seed rows: datos de muestra");
    const m = await call("POST", "/api/projects/zigzag/maquinas/sembrar");
    assert.deepEqual(m.body.steps.map((s: Json) => [s.command, s.ok]), [["sh migrate.sh", true], ["sh seed.sh", false]], "seeding twice hits the unique names");
  });

  test("Vaciar y sembrar: a wrong count is refused; the right one leaves the seed rows again", async () => {
    // Reset to the seed, then change the base by hand.
    let t = await call("GET", "/api/projects/zigzag/maquinas/tablas");
    await call("POST", "/api/projects/zigzag/maquinas/vaciar-y-sembrar", { rows: t.body.total_rows });
    const w = new pg.Client({ connectionString: `postgres://${USER}@127.0.0.1:5432/${DB}` });
    await w.connect();
    await w.query("insert into autores (nombre) values ('Escrito a mano')");
    await w.end();
    t = await call("GET", "/api/projects/zigzag/maquinas/tablas");
    assert.equal(t.body.total_rows, 128);
    assert.equal(t.body.sample, false, "a hand-written row: no longer only seed rows");
    const wrong = await call("POST", "/api/projects/zigzag/maquinas/vaciar-y-sembrar", { rows: 127 });
    assert.equal(wrong.status, 409);
    assert.equal(wrong.body.error, "ROW_COUNT_CHANGED");
    assert.equal(wrong.body.now, 128);
    assert.equal((await call("GET", "/api/projects/zigzag/maquinas/tablas")).body.total_rows, 128, "nothing was touched");
    const missing = await call("POST", "/api/projects/zigzag/maquinas/vaciar-y-sembrar", {});
    assert.equal(missing.status, 400);
    const ok = await call("POST", "/api/projects/zigzag/maquinas/vaciar-y-sembrar", { rows: 128 });
    assert.equal(ok.status, 200);
    const after = await call("GET", "/api/projects/zigzag/maquinas/tablas");
    assert.deepEqual(
      after.body.tables.map((x: Json) => [x.name, x.rows]),
      [
        ["autores", 3],
        ["libros", 120],
        ["prestamos", 2],
        ["usuarios", 2],
      ],
    );
    const autores = await call("GET", "/api/projects/zigzag/maquinas/tablas/autores/filas");
    assert.deepEqual(autores.body.rows.map((r: Json) => [r.id, r.nombre]), [["1", "Autora Uno"], ["2", "Autor Dos"], ["3", "Autora Tres"]], "identities restart");
  });
});

describe("the address never leaves", () => {
  test("the fake password and the full address appear in no response, log line or event", async () => {
    const events = (await raw.query(`select payload::text as p from events`)).rows.map((r) => r.p as string);
    const all = [...seen, ...events].join("\n");
    assert.ok(seen.length > 10, "responses were captured");
    assert.ok(!all.includes(FAKE_PASSWORD), "the password never left");
    assert.ok(!all.includes(URL_OK), "the address never left");
  });
});
