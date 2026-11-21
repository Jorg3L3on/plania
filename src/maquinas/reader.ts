// PLA-I48-2: the read-only base reader. Tables, row counts, columns, keys, relations, indexes, paged rows and the
// migrations of a project's local development base, and the one guarded write (Vaciar y sembrar de nuevo).
// Rules (Plan, decisions 1 and 5): only a loopback host is ever connected to; a database registered in any
// env_states row, or Plania's own, is refused before any query; the reader's session is read-only
// (default_transaction_read_only); secret-looking columns come back as (oculto); the address and its password
// never leave this module (not in a response, a log line or an event).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import type { Db } from "../db/client.js";
import { envStates, machineState } from "../db/schema.js";
import { MaquinaError } from "./errors.js";
import { checkoutEnv, shellExec } from "../captures/run.js";
import { LOOPBACK, scrub, secretValues, type BaseAddress } from "./env.js";
import { findScripts, migrationsDir, sqlFiles } from "./detect.js";
import { appEnvOf, maquinasSettingsOf, mdeps, planiaPorts, projectOf, type ProjectRow } from "./machines.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: why a base is not read, in the install's language; the Spanish is unchanged.
export const READER_WORDS = defineWords({
  es: {
    notFound: "el env de la app no nombra una base de Postgres",
    notLocal: "solo leo bases en esta máquina (127.0.0.1, localhost, ::1)",
    planias: "es la base de Plania",
    aPlania: "es una base de Plania",
    registered: "esa base está registrada en un entorno; no la leo",
  },
  en: {
    notFound: "the app's env does not name a Postgres database",
    notLocal: "I only read databases on this machine (127.0.0.1, localhost, ::1)",
    planias: "it is Plania's database",
    aPlania: "it is a Plania database",
    registered: "that database is registered in an environment; I don't read it",
  },
});

export const PAGE = 50;
export const HIDDEN = "(oculto)";
const SECRET_COLUMN = /password|passwd|hash|token|secret|api_?key|private_?key|otp|salt/i;
export const isSecretColumn = (name: string) => SECRET_COLUMN.test(name);

// ---- the guard

function planiaDatabase(): { name: string; port: number } | null {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return { name: decodeURIComponent(u.pathname.slice(1)), port: Number(u.port) || 5432 };
  } catch {
    return null;
  }
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

// Refuses, with a named error and before any connection: a host that is not loopback, Plania's own database, and a
// database whose name any environment (env_states: flags, deploy source) has registered.
export async function guard(db: Db, a: BaseAddress | null): Promise<BaseAddress> {
  if (!a) throw new MaquinaError("BASE_NOT_FOUND", say(READER_WORDS).notFound);
  if (!LOOPBACK.has(a.host)) throw new MaquinaError("BASE_NOT_LOCAL", say(READER_WORDS).notLocal);
  const own = planiaDatabase();
  if (own && own.name.toLowerCase() === a.database.toLowerCase() && planiaPorts().has(a.port)) throw new MaquinaError("BASE_REGISTERED", say(READER_WORDS).planias);
  if (/^plania(_|$)/i.test(a.database)) throw new MaquinaError("BASE_REGISTERED", say(READER_WORDS).aPlania);
  const rows = await db.select({ flags: envStates.flags, source: envStates.deploySource }).from(envStates);
  const name = a.database.toLowerCase();
  for (const r of rows) {
    for (const s of strings([r.flags, r.source])) {
      const t = s.toLowerCase();
      if (t === name || t.endsWith(`/${name}`) || t.includes(`/${name}?`)) throw new MaquinaError("BASE_REGISTERED", say(READER_WORDS).registered);
    }
  }
  return a;
}

// A connection that cannot write: every transaction is read-only, and statements stop after 5 s.
async function connect(a: BaseAddress, write = false): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: a.url,
    connectionTimeoutMillis: 2_000,
    statement_timeout: write ? 60_000 : 5_000,
    application_name: write ? "plania-maquinas-reset" : "plania-maquinas",
    ...(write ? {} : { options: "-c default_transaction_read_only=on" }),
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch {
    // The driver's message may carry the address: never pass it on.
    throw new MaquinaError("BASE_UNREACHABLE", "la base no responde");
  }
  return client;
}

// Tests: the reader's own session, to prove it cannot write.
export const openReader = (a: BaseAddress) => connect(a);

// PLA-I72-5: which base a call reads or writes. No copia: the app's own (as before). A copia id ("inicio" or an
// initiative key): that copy's own base when it has one (the same host, port and user, its own name), its folder for
// the commands, and the variable that points the app at it.
export type Target = { address: BaseAddress | null; dir: string | null; env: Record<string, string>; tag: string; root: string | null };
export async function targetOf(db: Db, p: ProjectRow, copia?: string | null): Promise<Target> {
  const { dirs, env, address } = appEnvOf(p);
  const base: Target = { address, dir: env.dir ?? dirs.prueba ?? dirs.repo, env: {}, tag: p.slug, root: null };
  if (!copia) return base;
  const { copiasRead } = await import("./copias.js");
  const c = (await copiasRead(db, p.slug, false)).copias.find((x) => x.id === copia);
  if (!c) throw new MaquinaError("COPY_NOT_FOUND", "No encuentro esa copia");
  const dir = c.worktree && existsSync(c.worktree) ? c.worktree : base.dir;
  if (!c.database || !address) return { ...base, dir, tag: `${p.slug}:${copia}`, root: c.worktree && existsSync(c.worktree) ? c.worktree : null };
  const u = new URL(address.url);
  u.pathname = `/${c.database}`;
  const a: BaseAddress = { ...address, url: u.toString(), database: c.database, safe: { ...address.safe, database: c.database } };
  const name = p.settings.capture?.database?.env_var ?? "DATABASE_URL";
  return { address: a, dir, env: { [name]: a.url }, tag: `${p.slug}:${copia}`, root: c.worktree && existsSync(c.worktree) ? c.worktree : null };
}

async function withReader<T>(db: Db, slug: string, fn: (c: pg.Client, a: BaseAddress, p: ProjectRow, t: Target) => Promise<T>, copia?: string | null): Promise<T> {
  const p = await projectOf(db, slug);
  const t = await targetOf(db, p, copia);
  const a = await guard(db, t.address);
  const c = await connect(a);
  try {
    return await fn(c, a, p, t);
  } catch (e) {
    if (e instanceof MaquinaError) throw e;
    throw new MaquinaError("BASE_READ_FAILED", scrub(e instanceof Error ? e.message.split("\n")[0]!.slice(0, 200) : "error", secretValues(new Map([["DATABASE_URL", a.url]]))));
  } finally {
    await c.end().catch(() => undefined);
  }
}

// ---- tables

export type Column = { name: string; type: string; not_null: boolean; key: boolean; unique: boolean; default: string | null; references: { table: string; column: string } | null; hidden: boolean };
export type Table = { name: string; rows: number; size_bytes?: number | null; columns: Column[]; indexes: { name: string; definition: string }[]; relations: { column: string; table: string; foreign: string }[] };
export type TablesRead = { connection: { host: string; port: number; database: string }; tables: Table[]; total_rows: number; sample: boolean; migrations: MigrationsRead };

const MIGRATION_TABLES = new Set(["__drizzle_migrations", "_prisma_migrations", "schema_migrations", "knex_migrations", "kysely_migration"]);

async function tableNames(c: pg.Client): Promise<string[]> {
  const r = await c.query<{ name: string }>(
    "select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') order by c.relname",
  );
  return r.rows.map((x) => x.name).filter((n) => !MIGRATION_TABLES.has(n));
}

const qi = (n: string) => `"${n.replace(/"/g, '""')}"`;

async function counts(c: pg.Client, names: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const n of names) {
    const r = await c.query<{ n: string }>(`select count(*)::text as n from public.${qi(n)}`);
    out.set(n, Number(r.rows[0]?.n ?? 0));
  }
  return out;
}

async function describe(c: pg.Client, names: string[]): Promise<Table[]> {
  if (!names.length) return [];
  const cols = await c.query<{ table: string; name: string; type: string; not_null: boolean; default: string | null; pos: number }>(
    `select c.relname as table, a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as not_null,
            pg_get_expr(d.adbin, d.adrelid) as default, a.attnum as pos
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname = 'public' and c.relname = any($1) and a.attnum > 0 and not a.attisdropped
      order by c.relname, a.attnum`,
    [names],
  );
  const cons = await c.query<{ table: string; type: string; columns: string[]; ftable: string | null; fcolumns: string[] | null }>(
    `select c.relname as table, k.contype as type,
            array(select attname from pg_attribute where attrelid = k.conrelid and attnum = any(k.conkey) order by attnum)::text[] as columns,
            fc.relname as ftable,
            case when k.confrelid = 0 then null else array(select attname from pg_attribute where attrelid = k.confrelid and attnum = any(k.confkey) order by attnum)::text[] end as fcolumns
       from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       left join pg_class fc on fc.oid = k.confrelid
      where n.nspname = 'public' and c.relname = any($1) and k.contype in ('p','u','f')`,
    [names],
  );
  const idx = await c.query<{ table: string; name: string; definition: string }>(
    "select tablename as table, indexname as name, indexdef as definition from pg_indexes where schemaname = 'public' and tablename = any($1) order by indexname",
    [names],
  );
  return names.map((t) => {
    const mine = cons.rows.filter((k) => k.table === t);
    const single = (type: string) => new Set(mine.filter((k) => k.type === type && k.columns.length === 1).map((k) => k.columns[0]!));
    const pk = new Set(mine.filter((k) => k.type === "p").flatMap((k) => k.columns));
    const uq = single("u");
    const fks = mine.filter((k) => k.type === "f" && k.ftable);
    const refOf = (col: string) => {
      const f = fks.find((k) => k.columns.length === 1 && k.columns[0] === col);
      return f ? { table: f.ftable!, column: f.fcolumns?.[0] ?? "" } : null;
    };
    return {
      name: t,
      rows: 0,
      columns: cols.rows
        .filter((x) => x.table === t)
        .map((x) => ({ name: x.name, type: x.type, not_null: x.not_null, key: pk.has(x.name), unique: uq.has(x.name), default: x.default, references: refOf(x.name), hidden: isSecretColumn(x.name) })),
      indexes: idx.rows.filter((x) => x.table === t).map((x) => ({ name: x.name, definition: x.definition })),
      relations: fks.flatMap((k) => k.columns.map((col, i) => ({ column: col, table: k.ftable!, foreign: k.fcolumns?.[i] ?? "" }))),
    };
  });
}

// ---- migrations

export type MigrationsRead = { dir: string | null; files: { name: string; applied: boolean | null }[]; applied: number; pending: number; table: string | null };

// PLA-I72-2: anything that answers query (a pg client, or a test's fake), and the folder whose migration files count
// (a copy's own worktree: its branch may carry migrations the start copy lacks).
export type Queryable = { query<R = any>(sql: string, params?: unknown[]): Promise<{ rows: R[] }> };
async function migrations(c: Queryable | pg.Client, p: ProjectRow, rootDir?: string | null): Promise<MigrationsRead> {
  const { dirs } = appEnvOf(p);
  const root = rootDir ?? dirs.prueba ?? dirs.repo;
  const dir = migrationsDir(root, maquinasSettingsOf(p));
  const files = dir ? sqlFiles(dir) : [];
  const rel = dir && root ? path.relative(root, dir) : null;
  // Drizzle keeps sha256(file) in drizzle.__drizzle_migrations (or public.__drizzle_migrations).
  let hashes: Set<string> | null = null;
  let table: string | null = null;
  for (const t of ["drizzle.__drizzle_migrations", "public.__drizzle_migrations"]) {
    const exists = await (c as Queryable).query<{ ok: boolean }>("select to_regclass($1) is not null as ok", [t]);
    if (!exists.rows[0]?.ok) continue;
    const r = await (c as Queryable).query<{ hash: string }>(`select hash from ${t}`);
    hashes = new Set(r.rows.map((x) => x.hash));
    table = t;
    break;
  }
  const list = files.map((f, i) => {
    if (!hashes) return { name: f.replace(/\.sql$/, ""), applied: null };
    const h = createHash("sha256").update(readFileSync(path.join(dir!, f), "utf8")).digest("hex");
    // A hash match, or (a migrate script that keeps its own hashes) the first N files when N rows exist.
    return { name: f.replace(/\.sql$/, ""), applied: hashes.has(h) || i < hashes.size };
  });
  return { dir: rel, files: list, applied: list.filter((x) => x.applied).length, pending: list.filter((x) => x.applied === false).length, table };
}

export const migrationsOf = migrations;

// ---- sample rows: Plania remembers the counts it seeded; the base holds only seed rows while they still match.

const seedKey = (slug: string) => `maquinas:seed:${slug}`; // slug, or slug:copia (PLA-I72-5)
async function seededCounts(db: Db, slug: string): Promise<Record<string, number> | null> {
  const { eq } = await import("drizzle-orm");
  const [r] = await db.select().from(machineState).where(eq(machineState.key, seedKey(slug)));
  return (r?.value.counts as Record<string, number> | undefined) ?? null;
}
async function rememberSeed(db: Db, slug: string, counts: Record<string, number>): Promise<void> {
  await db
    .insert(machineState)
    .values({ key: seedKey(slug), value: { counts, at: new Date().toISOString() } })
    .onConflictDoUpdate({ target: machineState.key, set: { value: { counts, at: new Date().toISOString() }, updatedAt: new Date() } });
}

export async function tablas(db: Db, slug: string, copia?: string | null): Promise<TablesRead> {
  return withReader(
    db,
    slug,
    async (c, a, p, tg) => {
      const names = await tableNames(c);
      const n = await counts(c, names);
      const sizes = await tableSizes(c, names);
      const tables = (await describe(c, names)).map((t) => ({ ...t, rows: n.get(t.name) ?? 0, size_bytes: sizes.get(t.name) ?? null }));
      const seeded = await seededCounts(db, tg.tag);
      const sample = !!seeded && tables.length > 0 && tables.every((t) => (seeded[t.name] ?? 0) === t.rows);
      return { connection: a.safe, tables, total_rows: tables.reduce((s, t) => s + t.rows, 0), sample, migrations: await migrations(c, p, tg.root) };
    },
    copia,
  );
}

// PLA-I72-5: each table's size on disk, for «Tablas que más pesan».
async function tableSizes(c: pg.Client, names: string[]): Promise<Map<string, number>> {
  if (!names.length) return new Map();
  const r = await c.query<{ name: string; size: string }>(
    "select c.relname as name, pg_total_relation_size(c.oid)::text as size from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1)",
    [names],
  );
  return new Map(r.rows.map((x) => [x.name, Number(x.size)]));
}

export type RowsRead = { table: string; columns: string[]; hidden: string[]; rows: Record<string, string | null>[]; offset: number; limit: number; total: number };

const cell = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return `(${v.length} bytes)`;
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
};

export async function filas(db: Db, slug: string, table: string, offset = 0, copia?: string | null): Promise<RowsRead> {
  return withReader(db, slug, async (c) => {
    const names = await tableNames(c);
    // Only a name the catalog listed is ever put in SQL.
    if (!names.includes(table)) throw new MaquinaError("TABLE_NOT_FOUND", `no hay una tabla ${table}`, { table });
    const [t] = await describe(c, [table]);
    const off = Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0));
    const pk = t!.columns.filter((x) => x.key).map((x) => qi(x.name));
    const order = pk.length ? pk.join(", ") : "ctid";
    const total = Number((await c.query<{ n: string }>(`select count(*)::text as n from public.${qi(table)}`)).rows[0]?.n ?? 0);
    const r = await c.query(`select * from public.${qi(table)} order by ${order} limit ${PAGE} offset ${off}`);
    const columns = t!.columns.map((x) => x.name);
    const hidden = columns.filter(isSecretColumn);
    const rows = r.rows.map((row: Record<string, unknown>) => Object.fromEntries(columns.map((col) => [col, hidden.includes(col) ? (row[col] === null ? null : HIDDEN) : cell(row[col])])));
    return { table, columns, hidden, rows, offset: off, limit: PAGE, total };
  }, copia);
}

// ---- the only writing path

function commandsOf(p: ProjectRow, t?: Target) {
  const { dirs, env } = appEnvOf(p);
  const s = maquinasSettingsOf(p);
  const dir = t?.dir ?? env.dir ?? dirs.prueba ?? dirs.repo;
  const found = findScripts(dir);
  return { dir, migrate: s?.migrate ?? found.migrate, seed: s?.seed ?? found.seed };
}

const runIn = async (command: string, dir: string, secrets: string[], extra: Record<string, string> = {}) => {
  const r = await (mdeps().exec ?? shellExec)(command, { cwd: dir, timeoutMs: 300_000, env: checkoutEnv(extra) });
  const out = scrub(`${r.stdout}\n${r.stderr}`, secrets)
    .split("\n")
    .filter(Boolean)
    .slice(-20);
  return { ok: r.code === 0, tail: out };
};

export type SeedResult = { ok: boolean; steps: { command: string; ok: boolean; tail: string[] }[]; tables: TablesRead | null };

async function afterSeed(db: Db, slug: string, steps: SeedResult["steps"], tg?: Target, copia?: string | null): Promise<SeedResult> {
  const ok = steps.every((s) => s.ok);
  const t = await tablas(db, slug, copia).catch(() => null);
  if (ok && t) await rememberSeed(db, tg?.tag ?? slug, Object.fromEntries(t.tables.map((x) => [x.name, x.rows])));
  return { ok, steps, tables: t ? { ...t, sample: ok || t.sample } : null };
}

// Sembrar: the project's migrate and seed commands, in the app's directory, with the shell basics only.
export async function sembrar(db: Db, slug: string, copia?: string | null): Promise<SeedResult> {
  const p = await projectOf(db, slug);
  const tg = await targetOf(db, p, copia);
  await guard(db, tg.address);
  const { dir, migrate, seed } = commandsOf(p, tg);
  if (!dir || (!migrate && !seed)) throw new MaquinaError("NOT_CONFIGURED", "no encuentro los comandos de migrar y sembrar");
  const secrets = secretValues(appEnvOf(p).env.values);
  const steps: SeedResult["steps"] = [];
  for (const cmd of [migrate, seed].filter((x): x is string => !!x)) {
    const r = await runIn(cmd, dir, secrets, tg.env);
    steps.push({ command: cmd, ...r });
    if (!r.ok) break;
  }
  return afterSeed(db, slug, steps, tg, copia);
}

// Aplicar (a pending migration): the project's migrate command only.
export async function migrar(db: Db, slug: string, copia?: string | null): Promise<SeedResult> {
  const p = await projectOf(db, slug);
  const tg = await targetOf(db, p, copia);
  await guard(db, tg.address);
  const { dir, migrate } = commandsOf(p, tg);
  if (!dir || !migrate) throw new MaquinaError("NOT_CONFIGURED", "no encuentro el comando de migrar");
  const r = await runIn(migrate, dir, secretValues(appEnvOf(p).env.values), tg.env);
  const t = await tablas(db, slug, copia).catch(() => null);
  return { ok: r.ok, steps: [{ command: migrate, ...r }], tables: t };
}

// Vaciar y sembrar de nuevo: needs the total row count the screen showed; a different count now is refused (someone
// changed the base since). Truncates the base's public tables (not the migrations table) in a writing session, then
// runs the seed command.
export async function vaciarYSembrar(db: Db, slug: string, shown: number, copia?: string | null): Promise<SeedResult> {
  if (!Number.isInteger(shown) || shown < 0) throw new MaquinaError("NOT_CONFIGURED", "el número de filas que viste");
  const p = await projectOf(db, slug);
  const tg = await targetOf(db, p, copia);
  const a = await guard(db, tg.address);
  const { dir, seed } = commandsOf(p, tg);
  if (!dir || !seed) throw new MaquinaError("NOT_CONFIGURED", "no encuentro el comando de sembrar");
  const now = await tablas(db, slug, copia);
  if (now.total_rows !== shown) throw new MaquinaError("ROW_COUNT_CHANGED", "la base cambió desde que la viste; vuelve a mirarla", { shown, now: now.total_rows });
  const w = await connect(a, true);
  try {
    const names = await tableNames(w);
    if (names.length) await w.query(`truncate table ${names.map((n) => `public.${qi(n)}`).join(", ")} restart identity cascade`);
  } catch {
    throw new MaquinaError("BASE_READ_FAILED", "no se pudo vaciar la base");
  } finally {
    await w.end().catch(() => undefined);
  }
  const r = await runIn(seed, dir, secretValues(appEnvOf(p).env.values), tg.env);
  return afterSeed(db, slug, [{ command: seed, ...r }], tg, copia);
}
