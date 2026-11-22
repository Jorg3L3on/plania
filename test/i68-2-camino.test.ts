// PLA-I68-2: the Camino door's read side. Keys live in the keychain or a 0600 file, never in Plania's database, an API
// reply or an MCP tool; a key is tried before it is saved and a refusal says the service's reason. Discovery reads a fake
// GitHub (no network) and the findings engine is a pure function whose every fix lands on a real section. PRs leave
// Archivo for Camino's Propuestas, grouped by destination. Test DB only; nothing real runs.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";
import { needs } from "./platform.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i68-2-"));
process.env.PLANIA_PROJECTS_ROOT = path.join(TMP, "projects");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const keys = await import("../src/camino/keys.js");
const { caminoDeps, discover } = await import("../src/camino/store.js");
const { storedConfigText } = await import("../src/camino/connections.js");
const { effectiveConfig } = await import("../src/camino/config.js");
const { envNames, originOf, repoOfRemote } = await import("../src/camino/mac.js");
const { hasAiTrailer } = await import("../src/camino/github.js");
const cam = (await import(new URL("../ui/src/lib/camino.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino.js");
const barra = (await import(new URL("../ui/src/lib/barra.ts", import.meta.url).href)) as Record<string, any>;
const corr = (await import(new URL("../ui/src/lib/corriente.ts", import.meta.url).href)) as Record<string, any>;

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "t", session_id: "s-i68-2", machine: "ci" } };
const REPO = "acme/zigzag";
const SECRET = "vcp_abcdefghijklmnopqrstuvwxyz0123456789WXYZ";
const store = new keys.MemoryCaminoKeyStore();

// A fake GitHub and a fake Vercel: every outside call of this file goes here.
let vercelOk = true;
let calls: string[] = [];
const ok = (data: unknown, headers: Record<string, string> = {}) => ({ status: 200, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, json: async () => data });
const no = (status: number, data: unknown = {}) => ({ status, headers: { get: () => null }, json: async () => data });
const HEAD_MAIN = "a".repeat(40);
const HEAD_SB = "b".repeat(40);
const fakeFetch = async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
  calls.push(`${init?.method ?? "GET"} ${url}`);
  if (url.startsWith("https://api.vercel.com/v2/user")) {
    const auth = init?.headers?.Authorization ?? "";
    return vercelOk && auth === `Bearer ${SECRET}` ? ok({ user: { username: "acme" } }) : no(403, { error: { message: "Not authorized" } });
  }
  const p = url.replace("https://api.github.com", "");
  if (p === "/user") return ok({ login: "acme" }, { "x-oauth-scopes": "repo, workflow, read:org" });
  if (p.startsWith("/user/repos")) return ok([{ full_name: REPO }, { full_name: "acme/other" }]);
  if (p === `/repos/${REPO}`) return ok({ full_name: REPO, private: false, default_branch: "main", html_url: `https://github.com/${REPO}`, permissions: { admin: true, push: true }, allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: false, delete_branch_on_merge: false, allow_update_branch: false });
  if (p.startsWith(`/repos/${REPO}/branches`)) return ok([{ name: "main", commit: { sha: HEAD_MAIN }, protected: false }, { name: "sandbox", commit: { sha: HEAD_SB }, protected: false }, { name: "jl/zig-1", commit: { sha: "c".repeat(40) }, protected: false }]);
  if (p.startsWith(`/repos/${REPO}/compare/`)) return ok({ ahead_by: 3, behind_by: 1 });
  if (p.startsWith(`/repos/${REPO}/rulesets?`)) return ok([{ id: 7, name: "scan", enforcement: "disabled", target: "branch" }]);
  if (p.startsWith(`/repos/${REPO}/rulesets/7`)) return ok({ id: 7, name: "scan", enforcement: "disabled", target: "branch", conditions: { ref_name: { include: ["refs/heads/main"] } }, rules: [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "plania-scan" }] } }] });
  if (p.startsWith(`/repos/${REPO}/actions/workflows`)) return ok({ workflows: [{ id: 1, name: "CI", path: ".github/workflows/ci.yml", state: "active" }] });
  if (p.startsWith(`/repos/${REPO}/contents/.github/workflows/ci.yml`)) return ok({ content: Buffer.from("name: CI\non: [push]\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n").toString("base64"), sha: "f1" });
  if (p.startsWith(`/repos/${REPO}/contents/.github/dependabot.yml`)) return no(404);
  if (p.startsWith(`/repos/${REPO}/actions/runs`)) return ok({ workflow_runs: [{ id: 11, name: "CI", head_branch: "sandbox", event: "push", status: "completed", conclusion: "success", head_sha: HEAD_SB, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), run_attempt: 1, html_url: "https://github.com/x/actions/runs/11", workflow_id: 1 }] });
  if (/\/commits\/[0-9a-f]+\/check-runs/.test(p)) return ok({ check_runs: [{ name: "check", app: { slug: "github-actions" }, completed_at: new Date().toISOString(), started_at: null }] });
  if (/\/commits\/[0-9a-f]+\/status/.test(p)) return ok({ statuses: [] });
  if (p.startsWith(`/repos/${REPO}/commits?`)) {
    if (p.includes("page=2")) return ok([]);
    return ok([
      { sha: "1", parents: [{}], commit: { message: "feat(citas): add the calendar\n\nCo-Authored-By: Claude <noreply@anthropic.com>", author: { date: "2026-11-19T00:00:00Z" } } },
      { sha: "2", parents: [{}], commit: { message: "fix: keep the clock", author: { date: "2026-11-18T00:00:00Z" } } },
      { sha: "3", parents: [{}, {}], commit: { message: "Merge pull request #4", author: { date: "2026-11-17T00:00:00Z" } } },
    ]);
  }
  return no(404);
};

const cookie = () => `${SESSION_COOKIE}=${createSession()}`;
const req = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api/company${p}`, { method, headers: { Cookie: cookie(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  keys.useCaminoKeyStore(store);
  Object.assign(caminoDeps, { fetch: fakeFetch, env: { ...process.env, GITHUB_TOKEN: "ghp_test", PLANIA_PROJECTS_ROOT: path.join(TMP, "projects") }, now: () => new Date(), listDatabases: async () => ["zigzag_dev", "zigzag_test"] });
  // A local clone of the repo, found by its .git/config origin.
  const clone = path.join(TMP, "projects", "zigzag");
  mkdirSync(path.join(clone, ".git"), { recursive: true });
  mkdirSync(path.join(clone, "drizzle"), { recursive: true });
  writeFileSync(path.join(clone, ".git", "config"), `[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:${REPO}.git\n`);
  writeFileSync(path.join(clone, ".env.example"), "# comment\nDATABASE_URL=postgres://x\nexport AUTH_SECRET=\nTMDB_KEY=abc\n");
  writeFileSync(path.join(clone, "package.json"), JSON.stringify({ scripts: { test: "x", build: "y" }, devDependencies: { "drizzle-kit": "1" } }));
  writeFileSync(path.join(clone, "drizzle", "0001_a.sql"), "");
  writeFileSync(path.join(clone, "drizzle", "0002_b.sql"), "");
  const p = await findProject(db, "zigzag");
  await setProject(db, { project: "zigzag", version: p.version, settings: { github: { repo: REPO }, release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } } }, ctx);
});
beforeEach(() => {
  calls = [];
  vercelOk = true;
});
after(async () => {
  keys.useCaminoKeyStore(null);
  await closeDb?.();
  await raw?.end();
  rmSync(TMP, { recursive: true, force: true });
});

describe("where keys live", () => {
  test("the keychain gets the key on stdin, never in argv; a pasted key with spaces or a label is refused", () => {
    const lines = keys.keychainWriteLines("zigzag", "vercel", SECRET);
    assert.match(lines.add, /^add-generic-password -T \/usr\/bin\/security -s plania-camino -a zigzag:vercel -w vcp_/);
    assert.match(lines.del, /^delete-generic-password -s plania-camino -a zigzag:vercel\n$/);
    assert.ok(keys.KEY_SHAPE.test(SECRET));
    for (const bad of ["Bearer abc12345678", "abc 12345678", 'abc"12345678', "short"]) assert.equal(keys.KEY_SHAPE.test(bad), false, bad);
  });

  test("the keychain store passes the key only on stdin and reads it back", async () => {
    const seen: { args: string[]; stdin: string }[] = [];
    let item: string | null = null;
    const kc = new keys.KeychainCaminoKeyStore(async (args, stdin) => {
      seen.push({ args, stdin });
      if (args[0] === "find-generic-password") {
        if (!item) throw new Error("The specified item could not be found in the keychain.");
        return `${item}\n`;
      }
      if (stdin.startsWith("delete")) {
        item = null;
        throw new Error("could not be found");
      }
      item = stdin.match(/-w (\S+)/)![1]!;
      return "";
    });
    await kc.set("zigzag", "vercel", SECRET);
    assert.equal(await kc.get("zigzag", "vercel"), SECRET);
    assert.ok(seen.every((s) => !s.args.join(" ").includes(SECRET)), "the key is never an argument");
  });

  test("the file store is 0600 in a 0700 folder and a group-readable file is not trusted", { skip: needs({ posix: true }) }, async () => {
    const dir = path.join(TMP, "keys");
    const fs = new keys.FileCaminoKeyStore(dir, "darwin");
    await fs.set("zigzag", "neon", SECRET);
    assert.equal(statSync(path.join(dir, "zigzag", "neon")).mode & 0o777, 0o600);
    assert.equal(statSync(path.join(dir, "zigzag")).mode & 0o777, 0o700);
    assert.equal(await fs.get("zigzag", "neon"), SECRET);
    (await import("node:fs")).chmodSync(path.join(dir, "zigzag", "neon"), 0o644);
    assert.equal(await fs.get("zigzag", "neon"), null);
    assert.equal(keys.systemCaminoKeyStore({ platform: "linux", env: { HOME: TMP } }).kind, "file");
    assert.equal(keys.systemCaminoKeyStore({ platform: "darwin", exists: () => true }).kind, "keychain");
  });
});

describe("Conexiones y llaves", () => {
  test("an unknown service, a malformed key and a refused key save nothing", async () => {
    let res = await req("PUT", "/projects/zigzag/camino/keys/heroku", { value: SECRET });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as Json).error, "CAMINO_PROVIDER_UNKNOWN");
    res = await req("PUT", "/projects/zigzag/camino/keys/vercel", { value: "Bearer something long" });
    assert.equal(((await res.json()) as Json).error, "CAMINO_KEY_INVALID");
    vercelOk = false;
    res = await req("PUT", "/projects/zigzag/camino/keys/vercel", { value: SECRET });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "CAMINO_KEY_REJECTED", status: 403, message: "Not authorized" });
    assert.equal(store.items.size, 0);
  });

  test("a key the service accepts is saved in the store; the camino row and every reply hold only its last 4", async () => {
    const res = await req("PUT", "/projects/zigzag/camino/keys/vercel", { value: SECRET });
    assert.equal(res.status, 200, await res.clone().text());
    const out = (await res.json()) as Json;
    assert.equal(out.meta.last4, "WXYZ");
    assert.equal(out.meta.test.account, "acme");
    assert.equal(await store.get("zigzag", "vercel"), SECRET);
    const p = await findProject(db, "zigzag");
    assert.ok(!(await storedConfigText(db, p.id)).includes(SECRET));
    const read = await req("GET", "/projects/zigzag/camino");
    const text = await read.text();
    assert.ok(!text.includes(SECRET), "the read never carries the key");
    assert.equal((JSON.parse(text) as Json).config.connections.vercel.last4, "WXYZ");
    const dump = (await raw.query("select config::text as c from camino")).rows.map((r) => r.c).join("\n") + (await raw.query("select label from camino_history")).rows.map((r) => r.label).join("\n");
    assert.ok(!dump.includes(SECRET));
  });

  test("Probar uses the saved key; Quitar removes it; Probar then says there is none", async () => {
    let res = await req("POST", "/projects/zigzag/camino/keys/vercel/test", {});
    assert.deepEqual(await res.json(), { provider: "vercel", ok: true, status: 200, message: "ok", account: "acme" });
    res = await req("DELETE", "/projects/zigzag/camino/keys/vercel");
    assert.equal(res.status, 200);
    assert.equal(await store.get("zigzag", "vercel"), null);
    res = await req("POST", "/projects/zigzag/camino/keys/vercel/test", {});
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as Json).error, "CAMINO_KEY_MISSING");
  });

  test("a store that refuses the key reports it and keeps nothing", async () => {
    const failing = { kind: "keychain" as const, get: async () => null, set: async () => { throw new Error("nope"); }, delete: async () => {} };
    keys.useCaminoKeyStore(failing);
    const res = await req("PUT", "/projects/zigzag/camino/keys/vercel", { value: SECRET });
    assert.equal(((await res.json()) as Json).error, "CAMINO_KEY_STORE");
    keys.useCaminoKeyStore(store);
  });

  test("the routes are the owner's screen only: a Bearer token is refused", async () => {
    const res = await req("GET", "/projects/zigzag/camino", undefined, { Authorization: `Bearer ${TEST_BEARER}` });
    assert.equal(res.status, 403);
  });

  test("nothing an agent can reach reads a Camino key: no MCP tool or runner file imports the key store", () => {
    const root = new URL("../src/", import.meta.url).pathname;
    const files = ["mcp", "runner"].flatMap((d) => readdirSync(path.join(root, d), { recursive: true }).map((f) => path.join(root, d, String(f)))).filter((f) => f.endsWith(".ts"));
    const users = files.filter((f) => /camino\/keys/.test(readFileSync(f, "utf8")));
    assert.deepEqual(users, []);
  });
});

describe("discovery", () => {
  test("reads GitHub and this Mac, stores it with checked_at, and the read shows both", async () => {
    const p = await findProject(db, "zigzag");
    const d = await discover(db, p);
    assert.ok(d.github.ok);
    if (!d.github.ok) return;
    assert.equal(d.github.repo.default_branch, "main");
    assert.deepEqual(d.github.token.scopes, ["repo", "workflow", "read:org"]);
    assert.deepEqual(d.github.branches.find((b) => b.name === "sandbox"), { name: "sandbox", sha: HEAD_SB, ahead: 3, behind: 1, protected: false });
    assert.deepEqual(d.github.rules.list[0]?.required_checks, ["plania-scan"]);
    assert.equal(d.github.workflow_files[0]?.text.split("\n")[0], "name: CI");
    assert.deepEqual(d.github.checks.map((c) => c.name), ["check"]);
    assert.equal(d.github.commits.length, 2, "merge commits are left out");
    assert.ok(d.mac.folder?.matches);
    assert.deepEqual(d.mac.env_example, ["DATABASE_URL", "AUTH_SECRET", "TMDB_KEY"]);
    assert.deepEqual(d.mac.migrations, { dir: "drizzle", count: 2, tool: "drizzle" });
    assert.deepEqual(d.mac.postgres, { ok: true, databases: ["zigzag_dev", "zigzag_test"], own: null });
    const read = (await (await req("GET", "/projects/zigzag/camino")).json()) as Json;
    assert.ok(read.checked_at);
    assert.equal(read.config.branches.published, "main");
    assert.equal(read.config.branches.integration, "sandbox");
    assert.equal(read.config.source.branches, "settings");
  });

  test("PLA-158 (F-26): the database picker hides Plania's own test and copy bases and leads with the project's own", async () => {
    const { pickDatabases, isLeftover } = await import("../src/camino/mac.js");
    const listed = ["plania", "plania_test_ab12cd", "plania_demo", "zigzag_dev", "zigzag_dev_entrega", "zigzag_dev_prueba", "zigzag_dev_taller", "zigzag_dev_ini_zig_i3", "otra_demo"];
    assert.deepEqual(pickDatabases(listed, null), ["plania", "zigzag_dev"]);
    assert.deepEqual(pickDatabases(listed, "zigzag_app"), ["zigzag_app", "plania", "zigzag_dev"], "the project's own base, even on another server");
    assert.ok(isLeftover("plania_test_x") && isLeftover("x_entrega") && !isLeftover("zigzag_dev"));
    const clone = path.join(TMP, "projects", "zigzag");
    writeFileSync(path.join(clone, ".env.local"), "DATABASE_URL=postgres://u:secreto@localhost:5433/zigzag_app\n");
    const was = caminoDeps.listDatabases;
    caminoDeps.listDatabases = async () => ["plania_test_1", "zigzag_dev", "zigzag_dev_entrega"];
    try {
      const d = await discover(db, await findProject(db, "zigzag"));
      assert.deepEqual(d.mac.postgres, { ok: true, databases: ["zigzag_app", "zigzag_dev"], own: "zigzag_app" });
      assert.ok(!JSON.stringify(d).includes("secreto"), "names only, never a value");
    } finally {
      caminoDeps.listDatabases = was;
      rmSync(path.join(clone, ".env.local"));
    }
  });

  test("a private repo whose plan has no rulesets says so; no token and an unknown repo are their own errors", async () => {
    const { discoverGithub } = await import("../src/camino/github.js");
    const api = (status: Record<string, number>) => ({
      source: "test",
      call: async (_m: string, p: string) => {
        if (p === "/user") return ok({ login: "a" });
        if (p.startsWith("/user/repos")) return ok([]);
        if (p === "/repos/a/b") return status.repo === 404 ? no(404) : ok({ full_name: "a/b", private: true, default_branch: "main", html_url: "x", permissions: { admin: true } });
        if (p.startsWith("/repos/a/b/rulesets")) return no(403, { message: "Upgrade to GitHub Pro or make this repository public to enable this feature." });
        return no(404);
      },
    });
    const priv = await discoverGithub(api({}), "a/b", ["main"], new Date());
    assert.ok(priv.ok && !priv.rules.available && priv.rules.reason === "plan");
    const gone = await discoverGithub(api({ repo: 404 }), "a/b", ["main"], new Date());
    assert.equal(!gone.ok && gone.error, "not_found");
  });

  test("the folder's origin, a GitHub remote's repo and .env.example names are read from files", () => {
    assert.equal(originOf(path.join(TMP, "projects", "zigzag")), `git@github.com:${REPO}.git`);
    assert.equal(repoOfRemote("https://github.com/acme/zigzag.git"), REPO);
    assert.equal(repoOfRemote("git@github.com:acme/zigzag"), REPO);
    assert.equal(repoOfRemote("https://gitlab.com/acme/zigzag"), null);
    assert.deepEqual(envNames("A=1\n# B=2\n  C =3\nlower_d=4\n"), ["A", "C", "lower_d"]);
    assert.ok(hasAiTrailer("x\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>"));
    assert.ok(!hasAiTrailer("x\n\nCo-Authored-By: Ana <ana@example.com>"));
  });

  test("older settings are read into the config: release → integration branch and production, capture → the test copy", () => {
    const c = effectiveConfig({ release: { from: "sandbox", into: "main", env: "prod", prod_migrations: "deploy" }, capture: { database: { env_var: "DATABASE_URL" } } as never, vercel: { project_id: "prj_1" } }, {}, null);
    assert.equal(c.model, "integ");
    assert.deepEqual(c.branches, { published: "main", integration: "sandbox", work_pattern: "plania/<clave>" });
    assert.deepEqual(c.envs.map((e) => [e.id, e.kind, e.server.provider, e.database?.migrate_when ?? null]), [["copia", "permanente", "mac_service", "llegar"], ["prod", "produccion", "vercel", "build"]]);
    const owned = effectiveConfig({}, { model: "trunk", branches: { published: "trunk" } }, { default_branch: "main", merge: null });
    assert.equal(owned.branches.published, "trunk");
    assert.equal(owned.source.model, "camino");
  });
});

// ---- the pure engine
const base = (over: Json = {}): any => ({
  slug: "zigzag",
  title: "Zigzag",
  version: 1,
  config: { model: "integ", branches: { published: "main", integration: "sandbox", work_pattern: "plania/<clave>" }, rules: {}, merge: {}, required_checks: {}, commits: { convention: null, ai: false }, deps: {}, envs: [], connections: {}, source: { model: "settings", branches: "settings", merge: "default", envs: "settings" }, ...(over.config ?? {}) },
  settings: { repo: REPO, folder: "/x", no_code: false, release: { from: "sandbox", into: "main", env: "prod", prod_migrations: null }, capture: false, vercel: false, ...(over.settings ?? {}) },
  discovery: over.discovery === undefined ? { checked_at: "2026-11-20T00:00:00Z", took_ms: 1, github: gh(), mac: { folder: { path: "/x", exists: true, clone: true, remote: "r", matches: true, clones: [] }, postgres: null, env_example: null, scripts: null, folders: null, migrations: null } } : over.discovery,
  checked_at: "2026-11-20T00:00:00Z",
  checking: false,
  plania: { envs: [], note_stale: false, keys_store: "keychain", ...(over.plania ?? {}) },
  proposals: over.proposals ?? [],
  history: [],
});
function gh(over: Json = {}): Json {
  return {
    ok: true,
    repo: { full_name: REPO, private: false, default_branch: "main", admin: true, push: true, html_url: "", merge: null },
    token: { source: "GITHUB_TOKEN", scopes: [], expires_at: null },
    branches: [{ name: "main", sha: HEAD_MAIN, ahead: 0, behind: 0, protected: false }, { name: "sandbox", sha: HEAD_SB, ahead: 2, behind: 0, protected: false }],
    branches_total: 2,
    rules: { available: true, reason: null, list: [] },
    workflows: [{ id: 1, name: "CI", path: ".github/workflows/ci.yml", state: "active" }],
    workflow_files: [],
    dependabot: null,
    checks: [{ name: "check", app: null, branches: ["main"], last_at: "2026-11-19T00:00:00Z" }],
    runs: [],
    commits: [{ sha: "1", message: "fix: x", date: "" }],
    repos: [],
    ...over,
  };
}
const NOW = new Date("2026-11-20T01:00:00Z");
const ids = (F: { id: string }[]) => F.map((f) => f.id);

describe("findings", () => {
  test("an unprotected published branch, nothing required, no convention, the prod migration path unset", () => {
    const F = cam.findings(base(), NOW, "es");
    assert.deepEqual(ids(F).filter((i) => !["public-repo", "all-good"].includes(i)), ["unprotected:main", "nothing-required:main", "no-convention", "prod-unset"]);
    assert.equal(F[0]!.sev, "warn");
    assert.equal(F[0]!.title, "main no está protegida");
    // PLA-132: no production environment to open yet, so no fix button; never a link to Ajustes.
    assert.equal(F.find((f) => f.id === "prod-unset")!.fix, null);
  });

  test("PLA-132: who migrates production is fixed in its environment, and a saved environment that says it clears the finding", () => {
    const env = { id: "prod", name: "Producción", kind: "produccion", record: "prod", runs: { kind: "branch", branch: "main" }, url: null, server: { provider: null, project: null, note: null }, database: { provider: null, name: null, data: "real", roles_split: false, migrate_when: "mano", lock: false, sql_review: false, approve_destructive: true, backup: "ninguna" }, vars: [], health: { url: null, pages: [] }, publisher: "owner", freeze: false };
    const derived = cam.findings(base({ config: { envs: [env] } }), NOW, "es");
    assert.deepEqual(derived.find((f) => f.id === "prod-unset")!.fix, { label: "Decir quién migra", go: "env:prod" });
    const saved = { ...env, database: { ...env.database, provider: "neon" } };
    const F = cam.findings(base({ config: { envs: [saved], source: { model: "settings", branches: "settings", merge: "default", envs: "camino" } } }), NOW, "es");
    assert.ok(!ids(F).includes("prod-unset"), "Despliegue already says who migrates");
    for (const f of F) assert.equal((f.fix as { ajustes?: string } | null)?.ajustes, undefined, f.id);
  });

  test("a ruleset that protects main and requires a check that nobody produces", () => {
    const g = gh({ rules: { available: true, reason: null, list: [{ id: 1, name: "plania-main", enforcement: "active", target: "branch", branches: ["main"], required_checks: ["ci-ok"], plania: true }] } });
    const F = cam.findings(base({ discovery: { checked_at: "", took_ms: 0, github: g, mac: base().discovery.mac } }), NOW, "es");
    assert.ok(!ids(F).includes("unprotected:main"));
    assert.ok(!ids(F).some((i) => i.startsWith("nothing-required")));
    const ghost = F.find((f) => f.id === "ghost:plania-main")!;
    assert.equal(ghost.title, "La regla «plania-main» exige una prueba que nadie produce");
    assert.equal(ghost.fix?.go, "ci");
  });

  test("a private repo on the free plan, a missing published branch, no workflows, AI trailers against the rule", () => {
    const g = gh({ repo: { ...gh().repo, private: true }, rules: { available: false, reason: "plan", list: [] }, workflows: [], commits: [{ sha: "1", message: "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>", date: "" }, { sha: "2", message: "y", date: "" }] });
    let F = cam.findings(base({ discovery: { checked_at: "", took_ms: 0, github: g, mac: base().discovery.mac } }), NOW, "es");
    assert.ok(ids(F).includes("no-rules-plan"));
    assert.ok(ids(F).includes("no-workflows"));
    assert.equal(F.find((f) => f.id === "ai-trailers")!.title, "1 de 2 commits llevan coautor de IA");
    F = cam.findings(base({ config: { branches: { published: "production", integration: null, work_pattern: "" }, model: "trunk" } }), NOW, "es");
    assert.equal(F[0]!.id, "pub-missing");
    assert.equal(F[0]!.sev, "bad");
  });

  test("GitHub unreachable: no token is bad and points to Conexiones; a network failure offers Volver a leer", () => {
    let F = cam.findings(base({ discovery: { checked_at: "", took_ms: 0, github: { ok: false, error: "no_token" }, mac: base().discovery.mac } }), NOW, "es");
    assert.deepEqual([F[0]!.id, F[0]!.sev, F[0]!.fix?.go], ["no-token", "bad", "conn"]);
    F = cam.findings(base({ discovery: { checked_at: "", took_ms: 0, github: { ok: false, error: "network" }, mac: base().discovery.mac } }), NOW, "es");
    assert.deepEqual(F.find((f) => f.id === "network")!.fix, { label: "Volver a leer", act: "recheck" });
  });

  test("environments: a record behind its branch, migrations that do not add up, fake data counted as fine", () => {
    const env = { id: "prod", name: "Producción", kind: "produccion", record: "prod", runs: { kind: "branch", branch: "main" }, url: null, server: { provider: "vercel", project: null, note: null }, database: { provider: null, data: "real" }, vars: [], health: { url: null, pages: [] }, publisher: "owner", freeze: false };
    const copy = { ...env, id: "copia", name: "Copia de prueba", kind: "permanente", record: null, database: { provider: "local_postgres", data: "falsos" } };
    const F = cam.findings(base({ config: { envs: [env, copy] }, plania: { envs: [{ env: "prod", commit: "1fb7188", branch: "main", migrations_applied: 73, migrations: 70, deployed_at: null }] } }), NOW, "es");
    assert.equal(F.find((f) => f.id === "env-behind:prod")!.detail, "El registro dice 1fb7188; main ya está en aaaaaaa.");
    assert.equal(F.find((f) => f.id === "env-count:prod")!.title, "Producción: las migraciones no cuadran");
    assert.equal(F.find((f) => f.id === "fake:copia")!.sev, "ok");
  });

  test("keys: a failed test is bad, an expiry within 14 days warns; the stale note is info", () => {
    const F = cam.findings(base({ config: { connections: { vercel: { last4: "WXYZ", saved_at: "", store: "keychain", test: { ok: false, at: "", message: "" } }, neon: { last4: "abcd", saved_at: "", store: "keychain", expires_at: "2026-11-25T00:00:00Z", test: { ok: true, at: "", message: "ok" } } } }, plania: { note_stale: true } }), NOW, "es");
    assert.equal(F.find((f) => f.id === "key-failed:vercel")!.sev, "bad");
    assert.equal(F.find((f) => f.id === "key-expiring:neon")!.title, "La llave de Neon vence en 5 días");
    assert.equal(F.find((f) => f.id === "note-stale")!.sev, "info");
  });

  test("every fix lands on a section the door draws, or on Ajustes, or reads again", () => {
    const env = { id: "prod", name: "Producción", kind: "produccion", record: "prod", runs: { kind: "branch", branch: "main" }, url: null, server: { provider: null, project: null, note: null }, database: null, vars: [], health: { url: null, pages: [] }, publisher: "owner", freeze: false };
    const r = base({ config: { envs: [env] }, plania: { envs: [{ env: "prod", commit: "1fb7188", branch: "main", migrations_applied: 3, migrations: 2, deployed_at: null }] } });
    const F = cam.findings(r, NOW, "es");
    const S = cam.sections(r, F, "es");
    const drawn = new Set([...S.main, ...S.envs, S.hist].map((s) => s.id));
    for (const f of F) if (f.fix) assert.ok((f.fix.go && drawn.has(f.fix.go)) || f.fix.ajustes || f.fix.act === "recheck", f.id);
    assert.deepEqual(S.main.map((s) => s.id), ["resumen", "conn", "codigo", "commits", "ci", "propuestas"]);
    assert.deepEqual(S.envs.map((s) => s.id), ["env:prod"]);
  });

  test("the bar's word, the page's pill, the strip and the setup list", () => {
    const F = cam.findings(base(), NOW, "es");
    assert.deepEqual(cam.doorState(F, "es"), { dot: "warn", text: "2 POR RESOLVER", n: 2 });
    assert.deepEqual(cam.readyLine(F, "es"), { dot: "warn", text: "Funciona, con avisos", more: "· 2 por mejorar" });
    assert.deepEqual(cam.doorState([], "en"), { dot: "ok", text: "READY", n: 0 });
    const nodes = cam.strip(base(), F, "es");
    assert.deepEqual(nodes.map((n) => [n.title, n.sub, n.meta]), [["Código", "zigzag · rama de integración", "público"], ["Pruebas", "CI", "no exigidas"]]);
    const setup = base({ settings: { release: null } });
    assert.equal(cam.isSetup(setup), true);
    assert.deepEqual(cam.setupList(setup, "es").map((x) => x.mark), ["✓", "✓", "✓", "○", "—"]);
  });
});

describe("Propuestas leave Archivo", () => {
  test("PRs are grouped by destination, the published branch first, open ones first", () => {
    const pr = (number: number, base_branch: string | null, state: string, updated_at: string) => ({ number, title: `PR ${number}`, url: "", state, base_branch, head_branch: `jl/x-${number}`, ci_state: null, task_key: null, merged_at: state === "merged" ? updated_at : null, updated_at });
    const g = cam.proposalGroups(base({ proposals: [pr(1, "sandbox", "merged", "2026-11-19"), pr(2, "main", "merged", "2026-11-18"), pr(3, "sandbox", "open", "2026-11-10"), pr(4, "feat/x", "open", "2026-11-11")] }));
    assert.deepEqual(g.map((x) => [x.base, x.items.map((i) => i.number)]), [["main", [2]], ["sandbox", [3, 1]], ["feat/x", [4]]]);
  });

  test("a PR address opens in Camino; the door sits before Ajustes (PLA-135: Archivo is gone)", () => {
    assert.equal((barra as Record<string, unknown>).archivoCount, undefined);
    assert.deepEqual([...corr.DOORS], ["equipo", "maquinas", "marca", "camino", "ajustes"]);
    assert.equal(corr.tabOfVer({ kind: "pr", n: 3 }), "camino");
    assert.deepEqual(corr.verOf("camino:conn"), { kind: "camino", sec: "conn" });
    assert.equal(corr.verParam({ kind: "camino", sec: "env:prod" }), "camino:env:prod");
    assert.equal(corr.atOf("?proyecto=zigzag&t=prs").tab, "camino");
  });
});
