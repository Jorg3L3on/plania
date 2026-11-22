// PLA-I68-6: environments with a server and a database from any service. Environments of every kind are added, edited
// and removed; providers list what their saved key opens (projects, branches, releases) and give variable NAMES only;
// production's migration path, SQL review, destructive-migration approval (tied to the file's sha256), backup and freeze
// window drive Publicar. A fake service API and gh; squawk runs when it is installed. Test DB only.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { TEST_DB, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const keys = await import("../src/camino/keys.js");
const { caminoDeps, caminoRead } = await import("../src/camino/store.js");
const { applyChanges } = await import("../src/camino/changes.js");
const { listFor, varsFor } = await import("../src/camino/envs.js");
const { destructive, frozen, prodEnvOf, prodMigrationsFromEnv, sha256 } = await import("../src/camino/prod.js");
const { runSquawk } = await import("../src/camino/squawk.js");
const { localMigrationCount } = await import("../src/camino/approve.js");
const { releasePlan } = await import("../src/mcp/release-plan.js");
const { releaseGh, shipDeps, shipRelease } = await import("../src/mcp/release-ship.js");
const E = (await import(new URL("../ui/src/lib/camino-entornos.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino-entornos.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "t", session_id: "s-i68-6", machine: "ci" } };
const human = { ...ctx, human: true };
const REPO = "acme/zigzag";
const KEY = "vcp_0123456789abcdefWXYZ";
const store = new keys.MemoryCaminoKeyStore();
const squawkAvailable = (await runSquawk("m.sql", "select 1;")).available;

const ok = (data: unknown, status = 200) => ({ status, headers: { get: () => null }, json: async () => data });
const fakeFetch = async (url: string, init?: { headers?: Record<string, string> }) => {
  if (init?.headers?.Authorization !== `Bearer ${KEY}` && !url.startsWith("https://api.github.com")) return ok({ error: "no" }, 403);
  if (url === "https://api.vercel.com/v9/projects?limit=50") return ok({ projects: [{ id: "prj_1", name: "tienda", targets: { production: { alias: ["tienda.example.com"] } } }] });
  if (url.startsWith("https://api.vercel.com/v9/projects/prj_1/env")) return ok({ envs: [{ key: "DATABASE_URL", value: "postgres://secret", target: ["production"] }, { key: "AUTH_SECRET", value: "shh", target: ["production", "preview"] }, { key: "PREVIEW_ONLY", value: "x", target: ["preview"] }] });
  if (url === "https://console.neon.tech/api/v2/projects?limit=50") return ok({ projects: [{ id: "np_1", name: "tienda-db", region_id: "aws-us-east-2" }] });
  if (url.startsWith("https://console.neon.tech/api/v2/projects/np_1/branches")) return ok({ branches: [{ id: "br_1", name: "main", default: true }, { id: "br_2", name: "preview" }] });
  if (url.startsWith(`https://api.github.com/repos/${REPO}/releases`)) return ok([{ id: 9, tag_name: "v1.2.0", html_url: "https://github.com/x/releases/v1.2.0", prerelease: false }]);
  if (url === "https://api.github.com/user") return ok({ login: "acme" });
  return ok({ message: "Not Found" }, 404);
};
const cookie = () => `${SESSION_COOKIE}=${createSession()}`;
const post = (p: string, body: unknown) => app.request(`/api/company${p}`, { method: "POST", headers: { Cookie: cookie(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
const version = async () => Number((await raw.query(`select coalesce((select version from camino where project_id = (select id from projects where slug = 'zigzag')), 0) as v`)).rows[0].v);
const prod = (over: Json = {}) => ({ ...E.newEnv([], "produccion", "Producción", "main"), record: "prod", server: { provider: "vercel", project: "tienda", note: null }, ...over });

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  keys.useCaminoKeyStore(store);
  await store.set("zigzag", "vercel", KEY);
  await store.set("zigzag", "neon", KEY);
  Object.assign(caminoDeps, { fetch: fakeFetch, env: { ...process.env, GITHUB_TOKEN: "ghp_test" }, now: () => new Date(), listDatabases: async () => [] });
  const p = await findProject(db, "zigzag");
  await setProject(db, { project: "zigzag", version: p.version, settings: { github: { repo: REPO }, release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } } }, ctx);
});
after(async () => {
  keys.useCaminoKeyStore(null);
  await closeDb?.();
  await raw?.end();
});

describe("environments of every kind", () => {
  test("a new environment of each kind carries sensible defaults and a unique id", () => {
    const a = E.newEnv([], "temporal", "Previas", "sandbox");
    assert.deepEqual([a.id, a.runs, a.database?.data], ["previas", { kind: "pr" }, "falsos"]);
    const p = E.newEnv([a], "produccion", "Producción", "main");
    assert.deepEqual([p.id, p.record, p.database?.migrate_when, p.database?.sql_review, p.database?.approve_destructive], ["produccion", "prod", "paso", true, true]);
    assert.equal(E.newEnv([p], "produccion", "Producción", "main").id, "produccion-2");
    assert.deepEqual(E.newEnv([], "versiones", "Versiones", "main").runs, { kind: "tags", pattern: "v*" });
    assert.equal(E.newEnv([], "versiones", "Versiones", "main").database, null);
  });

  test("they are added, edited and removed through the change set, and the read shows them", async () => {
    const envs = [prod(), E.newEnv([], "permanente", "Copia", "sandbox")];
    let out = await applyChanges(db, "zigzag", { version: await version(), changes: [{ kind: "config", label: "Entornos", patch: { envs } }] });
    assert.equal(out.applied, 1);
    assert.deepEqual((await caminoRead(db, "zigzag")).config.envs.map((e) => e.name), ["Producción", "Copia"]);
    out = await applyChanges(db, "zigzag", { version: await version(), changes: [{ kind: "config", label: "Entornos", patch: { envs: [{ ...envs[0]!, name: "Producción web" }] } }] });
    const read = await caminoRead(db, "zigzag");
    assert.deepEqual(read.config.envs.map((e) => e.name), ["Producción web"]);
    assert.equal(read.config.source.envs, "camino");
  });

  test("variables are compared by name; no value is ever kept or shown", async () => {
    assert.deepEqual(E.varsDiff(["DATABASE_URL", "AUTH_SECRET", "GOOGLE_ID"], ["DATABASE_URL", "AUTH_SECRET"]), { ok: ["DATABASE_URL", "AUTH_SECRET"], missing: ["GOOGLE_ID"] });
    const p = await findProject(db, "zigzag");
    const out = await varsFor(p, "vercel", fakeFetch, "prj_1", "production");
    assert.deepEqual(out, { names: ["DATABASE_URL", "AUTH_SECRET"], connected: true });
    assert.ok(!JSON.stringify(out).includes("secret") && !JSON.stringify(out).includes("shh"));
    const res = await post("/projects/zigzag/camino/providers/vercel/vars", { project: "prj_1", target: "production" });
    const text = await res.text();
    assert.ok(!text.includes("postgres://") && !text.includes("shh"), text);
  });
});

describe("picked from what the key opens", () => {
  test("Vercel projects with their domain, Neon projects and branches, the repo's releases; no key, nothing", async () => {
    const p = await findProject(db, "zigzag");
    assert.deepEqual((await listFor(p, "vercel", fakeFetch, {})).items, [{ id: "prj_1", name: "tienda", url: "https://tienda.example.com" }]);
    assert.deepEqual((await listFor(p, "neon", fakeFetch, {})).items.map((x) => x.name), ["tienda-db"]);
    assert.deepEqual((await listFor(p, "neon", fakeFetch, { project: "np_1" })).items.map((x) => [x.name, x.note]), [["main", "default"], ["preview", null]]);
    const { ghApi } = await import("../src/camino/github.js");
    assert.deepEqual((await listFor(p, "github_releases", fakeFetch, { gh: ghApi("x", "t", fakeFetch) })).items.map((x) => x.name), ["v1.2.0"]);
    assert.deepEqual(await listFor(p, "netlify", fakeFetch, {}), { items: [], connected: false });
    await store.delete("zigzag", "neon");
    assert.equal((await listFor(p, "neon", fakeFetch, {})).connected, false);
    await store.set("zigzag", "neon", KEY);
    const bad = await post("/projects/zigzag/camino/providers/heroku/list", {});
    assert.equal(((await bad.json()) as Json).error, "CAMINO_PROVIDER_UNKNOWN");
  });

  test("the local database's migration table is read, never a remote one", async () => {
    await raw.query(`create schema if not exists drizzle; create table if not exists drizzle.__drizzle_migrations (id serial primary key); insert into drizzle.__drizzle_migrations default values; insert into drizzle.__drizzle_migrations default values;`);
    assert.deepEqual(await localMigrationCount(TEST_DB, "drizzle"), { ok: true, count: 2 });
    const url = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://u@db.example.com:5432/x";
    assert.deepEqual(await localMigrationCount(TEST_DB, "drizzle"), { ok: false, count: null });
    process.env.DATABASE_URL = url;
  });
});

describe("production drives Publicar", () => {
  test("who migrates, the freeze window, destructive statements", () => {
    assert.equal(prodMigrationsFromEnv(prod({ database: { ...prod().database!, provider: "neon", migrate_when: "paso" } }) as never), "deploy");
    assert.equal(prodMigrationsFromEnv(prod({ database: { ...prod().database!, provider: "neon", migrate_when: "mano" } }) as never), "owner");
    assert.equal(prodMigrationsFromEnv(prod({ database: null }) as never), "none");
    assert.equal(prodMigrationsFromEnv(prod() as never), null, "a database with no service says nothing yet");
    assert.equal(E.whoMigrates(prod({ database: { ...prod().database!, provider: "neon", migrate_when: "build" } }) as never), "deploy");
    const fri = new Date(2026, 10, 20, 18, 30);
    assert.equal(frozen(prod({ freeze: true }) as never, fri), true);
    assert.equal(frozen(prod({ freeze: true }) as never, new Date(2026, 10, 20, 17, 59)), false);
    assert.equal(frozen(prod({ freeze: false }) as never, fri), false);
    assert.equal(E.inFreeze(fri), true);
    assert.deepEqual(destructive("ALTER TABLE users ADD COLUMN age int;\n-- DROP TABLE x;\nDROP TABLE old_logs;\nALTER TABLE users DROP COLUMN nick;\nDELETE FROM sessions;\nDELETE FROM carts WHERE id = 1;\nTRUNCATE events;"), ["DROP TABLE old_logs", "ALTER TABLE users DROP COLUMN nick", "TRUNCATE events", "DELETE FROM sessions"]);
    assert.match(E.rolesSql("tienda"), /CREATE ROLE tienda_migrate LOGIN/);
  });

  test("PLA-158 (F-25): «Usar lo recomendado» also says when production migrates, and names the database when it is missing", () => {
    const db = prod().database!;
    const known = E.prodRecommended({ ...db, provider: "neon", migrate_when: "mano", sql_review: false, backup: "ninguna" });
    assert.deepEqual(known.patch, { sql_review: true, approve_destructive: true, backup: "proveedor", provider: "neon", migrate_when: "paso" });
    assert.equal(known.missing, null);
    assert.equal(known.done, false);
    const after = { ...db, ...known.patch } as never;
    assert.equal(prodMigrationsFromEnv(prod({ database: after }) as never), "deploy", "after the click Publicar knows who migrates");
    assert.equal(E.prodRecommended(after).done, true);
    const unknown = E.prodRecommended({ ...db, provider: null });
    assert.equal(unknown.missing, "provider");
    assert.equal("provider" in unknown.patch, false, "the service is never guessed");
    assert.equal(unknown.done, false);
    const saved = E.prodRecommended({ ...db, provider: null }, "supabase");
    assert.deepEqual([saved.missing, saved.patch.provider, saved.patch.migrate_when], [null, "supabase", "paso"], "a database service with a saved key counts as known");
    assert.equal(E.envFocus("produccion", "base"), "env-produccion-base");
  });

  test("Publicar reads production's migration path from Camino when the release step names none", async () => {
    const p = await findProject(db, "zigzag");
    const env = prod({ database: { ...prod().database!, provider: "neon", migrate_when: "paso", sql_review: true, approve_destructive: true } });
    await raw.query(`update camino set config = config || $2::jsonb where project_id = $1`, [p.id, JSON.stringify({ envs: [env] })]);
    const cfg = (await raw.query(`select config from camino where project_id = $1`, [p.id])).rows[0].config;
    assert.equal(prodEnvOf(cfg, p.settings.release)?.id, "produccion");
    const plan = (await releasePlan(db, await findProject(db, "zigzag")))!;
    assert.equal(plan.prod_migrations, "deploy");
    assert.equal(plan.prod_env?.sql_review, true);
    assert.equal(plan.prod_env?.db_missing, null);
    // PLA-158 (F-25): a database with no service is the field the screen names.
    await raw.query(`update camino set config = config || $2::jsonb where project_id = $1`, [p.id, JSON.stringify({ envs: [prod()] })]);
    const unset = (await releasePlan(db, await findProject(db, "zigzag")))!;
    assert.equal(unset.prod_migrations, null);
    assert.equal(unset.prod_env?.db_missing, "provider");
    await raw.query(`update camino set config = config || $2::jsonb where project_id = $1`, [p.id, JSON.stringify({ envs: [env] })]);
  });

  describe("shipping a release with a destructive migration", () => {
    const SQL = "DROP TABLE old_logs;\n";
    let gh: string[][] = [];
    let content = SQL;
    beforeEach(() => {
      gh = [];
      releaseGh.run = async (args) => {
        gh.push(args);
        if (args[0] === "api") return { ok: true, stdout: JSON.stringify({ content: Buffer.from(content).toString("base64") }), stderr: "" };
        if (args[1] === "list") return { ok: true, stdout: "[]", stderr: "" };
        if (args[1] === "create") return { ok: true, stdout: `https://github.com/${REPO}/pull/40\n`, stderr: "" };
        if (args[1] === "view") return { ok: true, stdout: JSON.stringify({ mergeCommit: { oid: "f".repeat(40) }, url: `https://github.com/${REPO}/pull/40`, statusCheckRollup: [] }), stderr: "" };
        return { ok: true, stdout: "", stderr: "" };
      };
    });
    before(async () => {
      const p = await findProject(db, "zigzag");
      await raw.query(`insert into branches (project_id, name, head_sha) values ($1, 'sandbox', $2), ($1, 'main', $3) on conflict do nothing`, [p.id, "d".repeat(40), "e".repeat(40)]);
      await raw.query(`update branches set head_sha = $2 where project_id = $1 and name = 'sandbox'`, [p.id, "d".repeat(40)]);
      await raw.query(`update branches set head_sha = $2 where project_id = $1 and name = 'main'`, [p.id, "e".repeat(40)]);
      await raw.query(`insert into poll_state (project_id, source, cursor) values ($1, 'github', $2) on conflict (project_id, source) do update set cursor = excluded.cursor`, [p.id, JSON.stringify({ release: { key: `${"d".repeat(40)}...${"e".repeat(40)}`, from_head: "d".repeat(40), into_head: "e".repeat(40), ahead: 2, contains: false, commits: [], migration_files: ["drizzle/0009_cleanup.sql"] } })]);
      const t = (await createTask(db, { project: "zigzag", title: "Limpieza", scope: "s", checks: ["c"], status: "Ready" } as never, ctx as never)) as { key: string };
      const id = (await raw.query(`update tasks set status = 'Merged' where key = $1 returning id`, [t.key])).rows[0].id;
      await raw.query(`update checks set done = true where task_id = $1`, [id]);
      await raw.query(`insert into pull_requests (project_id, repo, number, url, title, task_id, state, base_branch, merged_at) values ($1, $2, 39, 'u', 't', $3, 'merged', 'sandbox', now())`, [p.id, REPO, id]);
    });

    test("squawk's errors stop it", async () => {
      shipDeps.sqlReview = async () => ({ available: true, issues: [{ rule: "ban-drop-table", level: "Error", message: "Dropping a table is not allowed" }] });
      await assert.rejects(shipRelease(db, "zigzag", human), (e: any) => e.code === "CAMINO_SQL_REVIEW" && e.detail.files[0].path === "drizzle/0009_cleanup.sql");
      assert.ok(!gh.some((a) => a[1] === "merge"));
      shipDeps.sqlReview = async () => ({ available: true, issues: [] });
    });

    test("a destructive file waits for the owner's approval of that exact file; a changed file asks again", async () => {
      let err: any;
      await shipRelease(db, "zigzag", human).catch((e) => (err = e));
      assert.equal(err?.code, "CAMINO_NEEDS_APPROVAL");
      assert.deepEqual(err.detail.files[0], { path: "drizzle/0009_cleanup.sql", sha256: sha256(SQL), statements: ["DROP TABLE old_logs"] });
      assert.ok(!gh.some((a) => a[1] === "merge"));
      const res = await post("/projects/zigzag/camino/approve", { path: "drizzle/0009_cleanup.sql", sha256: sha256(SQL) });
      assert.equal(res.status, 200);
      const out = await shipRelease(db, "zigzag", human);
      assert.equal(out.merge_sha, "f".repeat(40));
      assert.equal((await raw.query(`select label from camino_history order by at desc limit 2`)).rows.some((r) => /Aprobaste drizzle\/0009_cleanup\.sql/.test(r.label)), true);
      content = "DROP TABLE old_logs;\nDROP TABLE more;\n";
      await raw.query(`delete from events where type = 'release.merged'`);
      await assert.rejects(shipRelease(db, "zigzag", human), (e: any) => e.code === "CAMINO_NEEDS_APPROVAL");
      content = SQL;
    });

    test("the freeze window holds the release", async () => {
      const p = await findProject(db, "zigzag");
      const cfg = (await raw.query(`select config from camino where project_id = $1`, [p.id])).rows[0].config;
      cfg.envs[0].freeze = true;
      await raw.query(`update camino set config = $2 where project_id = $1`, [p.id, JSON.stringify(cfg)]);
      const RealDate = Date;
      const fixed = new RealDate(2026, 10, 20, 19, 0).getTime();
      (globalThis as any).Date = class extends RealDate {
        constructor(...a: any[]) {
          super(...((a.length ? a : [fixed]) as []));
        }
        static now() {
          return fixed;
        }
      };
      try {
        assert.equal((await releasePlan(db, await findProject(db, "zigzag")))!.ship.reason, "freeze");
      } finally {
        (globalThis as any).Date = RealDate;
      }
    });
  });

  test("squawk reviews SQL when it is installed", { skip: !squawkAvailable && "squawk is not installed here" }, async () => {
    const out = await runSquawk("drizzle/0009.sql", "ALTER TABLE users ADD COLUMN age int NOT NULL;");
    assert.ok(out.available);
    assert.ok(out.issues.some((i) => i.rule === "adding-required-field"));
  });
});
