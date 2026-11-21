// PLA-I68-1: Publicar says the truth about production. The database Plania migrates after a release is the local test
// copy (settings.capture.database), never production; who migrates production is settings.release.prod_migrations
// (deploy | owner | none). A release that adds migrations with nobody named is not shippable: ShipBlock
// prod_migration_unhandled, shipRelease refuses RELEASE_NOT_READY, and the board's row says «Publicar espera» with the
// setting as its lever. Stubbed GitHub and gh: nothing real runs. Test DB only.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject, findTask } = await import("../src/mcp/queries.js");
const { reserveSequence } = await import("../src/mcp/sequences.js");
const { pollGithubProject } = await import("../src/jobs/github.js");
const { checkReleaseSettings, prodMigrationUnhandled, releasePlan } = await import("../src/mcp/release-plan.js");
const { releaseGh, shipRelease } = await import("../src/mcp/release-ship.js");
const { settingsRead } = await import("../src/api/project-settings.js");
const publicar = (await import(new URL("../ui/src/lib/publicar.ts", import.meta.url).href)) as typeof import("../ui/src/lib/publicar.js");

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "t", session_id: "s-i68-1", machine: "ci" } };
const human = { ...ctx, human: true };
const REPO = "acme/zigzag";
const SANDBOX = "5aaaaaa111111111111111111111111111111111";
const MAIN = "0bbbbbb222222222222222222222222222222222";
const MERGE = "7ccccccc33333333333333333333333333333333";

const fetch = async (url: string) => {
  const p = url.replace(/^https:\/\/api\.github\.com/, "");
  const ok = (data: unknown) => ({ status: 200, headers: { get: () => null }, json: async () => data });
  if (p.startsWith(`/repos/${REPO}/pulls?`)) return ok([]);
  if (p.startsWith(`/repos/${REPO}/branches`)) return ok([{ name: "sandbox", commit: { sha: SANDBOX } }, { name: "main", commit: { sha: MAIN } }]);
  if (p.startsWith(`/repos/${REPO}/compare/`)) return ok({ status: "ahead", ahead_by: 2, commits: [{ sha: SANDBOX }], files: [{ filename: "drizzle/0007_cita.sql", status: "added" }] });
  return { status: 404, headers: { get: () => null }, json: async () => ({}) };
};
const project = () => findProject(db, "zigzag");
const setRelease = async (release: Record<string, unknown>) => {
  const p = await project();
  await setProject(db, { project: "zigzag", version: p.version, settings: { release } }, ctx);
};

let gh: string[][] = [];
before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  const p = await project();
  await setProject(db, { project: "zigzag", version: p.version, settings: { github: { repo: REPO }, release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } } }, ctx);
  const made1 = (await createTask(db, { project: "zigzag", title: "Citas", scope: "s", checks: ["c"], status: "Ready" }, ctx)) as { key: string };
  const t = (await findTask(db, p.id, made1.key))!;
  await raw.query("update tasks set status = 'Merged', pr_url = $2 where id = $1", [t.id, `https://github.com/${REPO}/pull/9`]);
  await raw.query(
    "insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_sha, head_branch, base_branch, merged_at, merge_sha) values ($1, $2, 9, $3, 'Citas', $4, 'merged', $5, 'jl/zig-1', 'sandbox', now(), $5)",
    [p.id, REPO, `https://github.com/${REPO}/pull/9`, t.id, "9".padEnd(40, "e")],
  );
  await raw.query("update checks set done = true where task_id = $1", [t.id]);
  await reserveSequence(db, { project: "zigzag", name: "migration", task_key: made1.key, value: 7 }, ctx);
  await pollGithubProject(db, await project(), { fetch, env: { GITHUB_TOKEN: "ghp_test" } });
  // The poller may settle the ticket; the release under test holds it Merged, its checks closed.
  await raw.query("update tasks set status = 'Merged' where id = $1", [t.id]);
});
beforeEach(() => {
  gh = [];
  releaseGh.run = async (args) => {
    gh.push(args);
    const verb = args[1];
    if (verb === "list") return { ok: true, stdout: "[]", stderr: "" };
    if (verb === "create") return { ok: true, stdout: `https://github.com/${REPO}/pull/10\n`, stderr: "" };
    if (verb === "view") return { ok: true, stdout: JSON.stringify({ mergeCommit: { oid: MERGE }, url: `https://github.com/${REPO}/pull/10` }), stderr: "" };
    return { ok: true, stdout: "", stderr: "" };
  };
});
after(async () => {
  await closeDb?.();
  await raw?.end();
});

describe("settings.release.prod_migrations", () => {
  test("takes deploy, owner or none and refuses anything else", () => {
    const base = { from: "sandbox", into: "main", env: "prod" };
    for (const v of ["deploy", "owner", "none"]) assert.equal(checkReleaseSettings({ ...base, prod_migrations: v }).prod_migrations, v);
    assert.equal(checkReleaseSettings(base).prod_migrations, undefined);
    assert.throws(() => checkReleaseSettings({ ...base, prod_migrations: "plania" }), /INVALID_FILTER/);
  });

  test("prodMigrationUnhandled: only when the release adds migrations and nobody is named", () => {
    assert.equal(prodMigrationUnhandled({}, ["0007"], []), true);
    assert.equal(prodMigrationUnhandled({}, [], ["drizzle/0007_x.sql"]), true);
    assert.equal(prodMigrationUnhandled({}, [], []), false);
    assert.equal(prodMigrationUnhandled({ prod_migrations: "owner" }, ["0007"], []), false);
  });
});

describe("the release waits while nobody migrates production", () => {
  test("a release with migrations and no production path is not shippable, and shipRelease refuses before any gh call", async () => {
    const plan = (await releasePlan(db, await project()))!;
    assert.deepEqual(plan.migrations, ["0007"]);
    assert.deepEqual(plan.migration_files, ["drizzle/0007_cita.sql"]);
    assert.equal(plan.prod_migrations, null);
    assert.deepEqual(plan.ship, { ready: false, reason: "prod_migration_unhandled" });
    await assert.rejects(shipRelease(db, "zigzag", human), (e: any) => e.code === "RELEASE_NOT_READY" && e.detail.reason === "prod_migration_unhandled");
    assert.equal(gh.length, 0);
  });

  test("a project capturing a local test copy still waits: the copy is not production", async () => {
    const p = await project();
    await raw.query("update projects set settings = settings || $2::jsonb where id = $1", [p.id, JSON.stringify({ capture: { database: { env_var: "DATABASE_URL", migrate_command: "npm run db:migrate" } } })]);
    assert.equal((await releasePlan(db, await project()))!.ship.reason, "prod_migration_unhandled");
    await raw.query("update projects set settings = settings - 'capture' where id = $1", [p.id]);
  });

  test("with a declared path it ships as before, and the merge record names who migrates production", async () => {
    await setRelease({ from: "sandbox", into: "main", env: "prod", mode: "merge", prod_migrations: "deploy" });
    const plan = (await releasePlan(db, await project()))!;
    assert.deepEqual(plan.ship, { ready: true, reason: null });
    assert.equal(plan.prod_migrations, "deploy");
    const out = await shipRelease(db, "zigzag", human);
    assert.equal(out.merge_sha, MERGE);
    assert.equal(out.prod_migrations, "deploy");
    assert.equal(out.migrate, "manual", "no local copy: Plania migrates nothing itself");
    assert.ok(gh.some((a) => a[1] === "merge"));
  });

  test("the settings read still carries the setting", async () => {
    const read = await settingsRead(db, "zigzag");
    assert.equal(read.release?.prod_migrations, "deploy");
  });
});

describe("the words", () => {
  test("the sheet never says production is migrated when only the test copy is", () => {
    const copyOnly = publicar.migrationLine(["0007_cita.sql"], "auto", "Zigzag", "es", null);
    assert.match(copyOnly, /copia de prueba de Zigzag en esta computadora y la migra/);
    assert.match(copyOnly, /Nadie dijo quién migra la base de producción de Zigzag: Publicar espera/);
    assert.doesNotMatch(copyOnly, /respalda la base de Zigzag/);
    assert.match(publicar.migrationLine(["0007_cita.sql"], null, "Zigzag", "es", "deploy"), /En producción, el despliegue corre las migraciones\.$/);
    assert.match(publicar.migrationLine(["0007_cita.sql"], null, "Zigzag", "es", "owner"), /En producción las corres tú después de publicar\.$/);
    assert.match(publicar.migrationLine(["a.sql"], "auto", "Zigzag", "en", "none"), /test copy on this computer.*no production database/);
  });

  test("prodWaits: only migrations with nobody named", () => {
    assert.equal(publicar.prodWaits({ migrations: ["0007"], prod_migrations: null }), true);
    assert.equal(publicar.prodWaits({ migrations: ["0007"], prod_migrations: "none" }), false);
    assert.equal(publicar.prodWaits({ migrations: [] }), false);
    assert.equal(publicar.prodWaits(null), false);
  });
});
