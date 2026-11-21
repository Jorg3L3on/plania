// PLA-I70-2 and -3: a re-read of an untouched repo writes no false «outside» row, and GitHub being unreachable keeps the
// last good read (marked stale) instead of replacing it with an empty one. Test DB only; every outside call is fake.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const keys = await import("../src/camino/keys.js");
const { caminoDeps, discover, outsideChanges } = await import("../src/camino/store.js");

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const REPO = "acme/zigzag";
let down = false;
const ok = (data: unknown) => ({ status: 200, headers: { get: () => null }, json: async () => data });
const no = (status: number) => ({ status, headers: { get: () => null }, json: async () => ({}) });
const fakeFetch = async (url: string) => {
  if (down) throw new Error("ECONNRESET");
  const p = url.replace("https://api.github.com", "");
  if (p === "/user") return ok({ login: "acme" });
  if (p === `/repos/${REPO}`)
    return ok({ full_name: REPO, private: false, default_branch: "main", html_url: "x", permissions: { admin: true, push: true }, allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: false, delete_branch_on_merge: false, allow_update_branch: false });
  if (p.startsWith(`/repos/${REPO}/actions/workflows`)) return ok({ workflows: [{ id: 1, name: "CI", path: ".github/workflows/ci.yml", state: "active" }] });
  return no(404);
};

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  keys.useCaminoKeyStore(new keys.MemoryCaminoKeyStore());
  Object.assign(caminoDeps, { fetch: fakeFetch, env: { ...process.env, GITHUB_TOKEN: "ghp_test" }, now: () => new Date(), listDatabases: async () => [] });
  const p = await findProject(db, "zigzag");
  await setProject(db, { project: "zigzag", version: p.version, settings: { github: { repo: REPO } } }, { actor: { agent: "t", session_id: "s-i70-23", machine: "ci" } });
});
after(async () => {
  keys.useCaminoKeyStore(null);
  await closeDb?.();
  await raw?.end();
});

const outsideRows = async (id: string) => Number((await raw.query(`select count(*) from camino_history where project_id = $1 and who = 'outside'`, [id])).rows[0].count);

test("B2: merge options compared field by field, key order never matters", async () => {
  const p = await findProject(db, "zigzag");
  const a = await discover(db, p, caminoDeps);
  assert.ok(a.github.ok);
  for (let i = 0; i < 3; i++) await discover(db, p, caminoDeps);
  assert.equal(await outsideRows(p.id), 0);
  const b = JSON.parse(JSON.stringify(a));
  if (b.github.ok) b.github.repo.merge = Object.fromEntries(Object.entries(b.github.repo.merge).reverse());
  assert.deepEqual(outsideChanges(a, b), []);
  if (b.github.ok) b.github.repo.merge.rebase = true;
  assert.equal(outsideChanges(a, b).length, 1);
});

test("B3: an unreachable GitHub keeps the last good read, marked stale with its age", async () => {
  const p = await findProject(db, "zigzag");
  const good = await discover(db, p, caminoDeps);
  assert.ok(good.github.ok);
  down = true;
  const bad = await discover(db, p, caminoDeps);
  down = false;
  assert.ok(bad.github.ok, "the previous block is kept");
  if (bad.github.ok) {
    assert.equal(bad.github.stale?.since, good.checked_at);
    assert.equal(bad.github.workflows.length, 1);
  }
  const back = await discover(db, p, caminoDeps);
  assert.ok(back.github.ok && !back.github.stale, "a good read clears the mark");
});
