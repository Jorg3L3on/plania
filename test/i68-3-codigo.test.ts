// PLA-I68-3: Código y ramas and the change set. Changes apply in order (Plania, services, GitHub, PRs), stop at the
// first failure with its reason, and land in Historial with how to undo them; a public repo gets a Plania-owned ruleset
// through GitHub's API, a private Free repo keeps the rule in Plania, which refuses its own merges that break it;
// Taller and Publicar read the branch roles (settings.release, start_branch) and agents read them from get_project and
// start. A fake GitHub answers everything; nothing real runs. Test DB only.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i68-3-"));
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const keys = await import("../src/camino/keys.js");
const { caminoDeps, outsideChanges } = await import("../src/camino/store.js");
const { applyChanges, destOf, ordered, rulesetBody } = await import("../src/camino/changes.js");
const { branchRoles } = await import("../src/camino/roles.js");
const { missingChecks } = await import("../src/camino/guard.js");
const { getContext } = await import("../src/mcp/context.js");
const { releaseGh, shipRelease } = await import("../src/mcp/release-ship.js");
const cambios = (await import(new URL("../ui/src/lib/camino-cambios.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino-cambios.js");
const codigo = (await import(new URL("../ui/src/lib/camino-codigo.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino-codigo.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "t", session_id: "s-i68-3", machine: "ci" } };
const REPO = "acme/zigzag";

// The fake GitHub: records every call; fail names a step to refuse.
let calls: { method: string; path: string; body: any }[] = [];
let failOn: string | null = null;
let rulesets: { id: number; name: string }[] = [];
const ok = (data: unknown, status = 200) => ({ status, headers: { get: () => null }, json: async () => data });
const fakeFetch = async (url: string, init?: { method?: string; body?: string }) => {
  const method = init?.method ?? "GET";
  const p = url.replace("https://api.github.com", "");
  const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ method, path: p, body });
  if (failOn && `${method} ${p}`.includes(failOn)) return ok({ message: "Validation Failed: invalid rule" }, 422);
  if (p === `/repos/${REPO}` && method === "GET") return ok({ full_name: REPO });
  if (p === `/repos/${REPO}` && method === "PATCH") return ok({ full_name: REPO });
  if (p.startsWith(`/repos/${REPO}/rulesets?`)) return ok(rulesets);
  if (p === `/repos/${REPO}/rulesets` && method === "POST") return ok({ id: 77, name: body.name }, 201);
  if (/\/rulesets\/\d+$/.test(p)) return method === "DELETE" ? ok(null, 204) : ok({ id: 77 });
  if (p.startsWith(`/repos/${REPO}/git/refs/heads/`) && method === "DELETE") return ok(null, 204);
  if (p.startsWith("/repos/acme/other")) return ok({ message: "Not Found" }, 404);
  return ok({ message: "Not Found" }, 404);
};
const cookie = () => `${SESSION_COOKIE}=${createSession()}`;
const post = (p: string, body: unknown) => app.request(`/api/company${p}`, { method: "POST", headers: { Cookie: cookie(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
const version = async () => Number((await raw.query(`select coalesce((select version from camino where project_id = (select id from projects where slug = 'zigzag')), 0) as v`)).rows[0].v);
const history = async () => (await raw.query(`select label, dest, undo, who from camino_history where project_id = (select id from projects where slug = 'zigzag') order by at, id`)).rows;
const setDiscovery = async (priv: boolean) => {
  const p = await findProject(db, "zigzag");
  const d = { checked_at: new Date().toISOString(), took_ms: 1, github: { ok: true, repo: { full_name: REPO, private: priv, default_branch: "main", admin: true, push: true, html_url: "", merge: null }, token: { source: "x", scopes: [], expires_at: null }, branches: [], branches_total: 0, rules: { available: !priv, reason: priv ? "plan" : null, list: [] }, workflows: [], workflow_files: [], dependabot: null, checks: [], runs: [], commits: [], repos: [] }, mac: { folder: null, postgres: null, env_example: null, scripts: null, folders: null, migrations: null } };
  await raw.query(`insert into camino (project_id, discovery, checked_at) values ($1, $2, now()) on conflict (project_id) do update set discovery = excluded.discovery`, [p.id, JSON.stringify(d)]);
};

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  keys.useCaminoKeyStore(new keys.MemoryCaminoKeyStore());
  Object.assign(caminoDeps, { fetch: fakeFetch, env: { ...process.env, GITHUB_TOKEN: "ghp_test" }, now: () => new Date(), listDatabases: async () => [] });
  const p = await findProject(db, "zigzag");
  await setProject(db, { project: "zigzag", version: p.version, settings: { github: { repo: REPO }, release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } } }, ctx);
  await setDiscovery(false);
});
beforeEach(() => {
  calls = [];
  failOn = null;
  rulesets = [];
});
after(async () => {
  keys.useCaminoKeyStore(null);
  await closeDb?.();
  await raw?.end();
  rmSync(TMP, { recursive: true, force: true });
});

describe("the change set on the screen", () => {
  test("one edit per key, an edit back to the start drops it, groups apply in the server's order", () => {
    let list: any[] = [];
    list = cambios.stageIn(list, { key: "rule:main", change: { kind: "ruleset", label: "r" }, dest: "github", from: "a", to: "b" });
    list = cambios.stageIn(list, { key: "roles", change: { kind: "roles", label: "x" }, dest: "plania", from: "a", to: "b" });
    list = cambios.stageIn(list, { key: "rule:main", change: { kind: "ruleset", label: "r2" }, dest: "github", from: "a", to: "c" });
    assert.equal(list.length, 2);
    assert.deepEqual(cambios.toSend(list).map((c) => c.label), ["x", "r2"]);
    list = cambios.stageIn(list, { key: "roles", change: { kind: "roles", label: "x" }, dest: "plania", from: "a", to: "a" });
    assert.deepEqual(list.map((x) => x.key), ["rule:main"]);
    assert.deepEqual(cambios.counts([...list, { key: "k", change: { kind: "file_pr", label: "f" }, dest: "pr", from: "", to: "" }]), { github: 1, pr: 1 });
  });

  test("the screen and the server agree on where each kind applies", () => {
    for (const kind of ["config", "roles", "repo", "folder", "ruleset", "repo_merge", "delete_branch", "delete_ruleset"]) {
      for (const avail of [true, false]) assert.equal(cambios.destOf(kind, avail), destOf({ kind } as never, avail), `${kind} ${avail}`);
    }
    const o = ordered([{ dest: "pr" as const }, { dest: "github" as const }, { dest: "plania" as const }, { dest: "proveedor" as const }]);
    assert.deepEqual(o.map((x) => x.dest), ["plania", "proveedor", "github", "pr"]);
  });

  test("a stop says why in the owner's words", () => {
    assert.equal(cambios.whyStopped("CAMINO_GITHUB_REFUSED", { status: 422, message: "Validation Failed" }, "es"), "GitHub lo rechazó (422): Validation Failed.");
    assert.equal(cambios.whyStopped("CAMINO_NO_GITHUB", {}, "es"), "Falta el repositorio o la llave de GitHub.");
  });
});

describe("Código y ramas: picked, never typed", () => {
  test("a work pattern matches real branches; each branch gets its role; a pasted link becomes owner/name", () => {
    const names = ["main", "sandbox", "jl/zig-1", "jl/zig-22-pago", "dependabot/npm/x", "feat/old"];
    assert.deepEqual(codigo.matchesOf("jl/<clave>", names), ["jl/zig-1", "jl/zig-22-pago"]);
    assert.deepEqual(codigo.matchesOf("feat/<tema>", names), ["feat/old"]);
    const roles = { published: "main", integration: "sandbox", work_pattern: "jl/<clave>" };
    assert.deepEqual(names.map((n) => codigo.kindOf(n, roles)), ["publicada", "integracion", "trabajo", "trabajo", "fuera", "otra"]);
    assert.equal(codigo.repoFromLink("https://github.com/acme/zigzag.git"), REPO);
    assert.equal(codigo.repoFromLink("github.com/acme/zigzag/"), REPO);
    assert.equal(codigo.repoFromLink("git@github.com:acme/zigzag.git"), REPO);
    assert.equal(codigo.repoFromLink("https://gitlab.com/acme/zigzag"), null);
    assert.deepEqual(codigo.roleOptions([{ name: "main" }, { name: "dependabot/npm/x" }] as never), ["main"]);
  });

  test("a folder that is not a clone of the repo is refused; a clone is saved", async () => {
    const bad = path.join(TMP, "other");
    const good = path.join(TMP, "zigzag");
    for (const [d, origin] of [[bad, "git@github.com:acme/other.git"], [good, `https://github.com/${REPO}.git`]] as const) {
      mkdirSync(path.join(d, ".git"), { recursive: true });
      writeFileSync(path.join(d, ".git", "config"), `[remote "origin"]\n\turl = ${origin}\n`);
    }
    let out = await applyChanges(db, "zigzag", { version: await version(), changes: [{ kind: "folder", label: "Carpeta", path: bad }] });
    assert.equal(out.stopped?.error, "CAMINO_CHANGE_INVALID");
    assert.equal((out.stopped?.detail as Json).reason, "other_repo");
    out = await applyChanges(db, "zigzag", { version: await version(), changes: [{ kind: "folder", label: "Carpeta", path: good }] });
    assert.equal(out.applied, 1);
    assert.equal((await findProject(db, "zigzag")).settings.local?.repo_path, good);
  });

  test("a repo is checked against GitHub when applied: an unknown one stops with GitHub's reason", async () => {
    const out = await applyChanges(db, "zigzag", { version: await version(), changes: [{ kind: "repo", label: "Repo", repo: "acme/other" }] });
    assert.equal(out.stopped?.error, "CAMINO_GITHUB_REFUSED");
    assert.equal((out.stopped?.detail as Json).status, 404);
    assert.equal((await findProject(db, "zigzag")).settings.github?.repo, REPO);
  });
});

describe("applying in order", () => {
  test("a public repo: Plania first, then GitHub's ruleset and merge options; every change lands in Historial", async () => {
    const before = (await history()).length;
    const res = await post("/projects/zigzag/camino/apply", {
      version: await version(),
      changes: [
        { kind: "ruleset", label: "Regla de GitHub para main", branch: "main", rule: { on: true, pr: true, nodel: true, agents: false } },
        { kind: "repo_merge", label: "Cómo se fusionan las propuestas", squash: true, promo_merge: true, delete_on_merge: true, suggest_update: true },
        { kind: "roles", label: "Cómo se publica", model: "integ", published: "main", integration: "develop", work_pattern: "jl/<clave>" },
      ],
    });
    assert.equal(res.status, 200, await res.clone().text());
    const out = (await res.json()) as Json;
    assert.deepEqual(out.results.map((r: Json) => [r.kind, r.ok, r.dest]), [["roles", true, "plania"], ["ruleset", true, "github"], ["repo_merge", true, "github"]]);
    const create = calls.find((c) => c.method === "POST" && c.path === `/repos/${REPO}/rulesets`)!;
    assert.deepEqual(create.body, rulesetBody("main", { on: true, pr: true, nodel: true, agents: false }, []));
    assert.equal(create.body.name, "plania-main");
    assert.deepEqual(create.body.bypass_actors, [], "nobody bypasses it");
    assert.deepEqual((create.body.rules as Json[]).map((r) => r.type), ["pull_request", "deletion", "non_fast_forward"]);
    assert.deepEqual(calls.find((c) => c.method === "PATCH")!.body, { allow_squash_merge: true, allow_merge_commit: true, delete_branch_on_merge: true, allow_update_branch: true });
    const h = (await history()).slice(before);
    assert.deepEqual(h.map((x) => [x.label, x.dest]), [["Cómo se publica", "plania"], ["Regla de GitHub para main", "github"], ["Cómo se fusionan las propuestas", "github"]]);
    assert.ok(h.every((x) => x.undo), "each says how to undo it");
    assert.equal(out.read.config.branches.integration, "develop");
  });

  test("Taller and Publicar read the roles: release goes integration → published and Taller starts from integration; agents read them", async () => {
    const p = await findProject(db, "zigzag");
    assert.deepEqual([p.settings.release?.from, p.settings.release?.into, p.settings.start_branch], ["develop", "main", "develop"]);
    assert.deepEqual(await branchRoles(db, p), { model: "integ", published: "main", integration: "develop", work_pattern: "jl/<clave>", source: "camino" });
    const c = (await getContext(db, p, { workspace: {} })) as Json;
    assert.equal(c.branch_roles.integration, "develop");
    const { createMcpServer } = await import("../src/mcp/register.js");
    assert.ok(createMcpServer);
  });

  test("it stops at the first failure: what came before stays, nothing after runs, and the reason is GitHub's", async () => {
    failOn = "POST /repos/acme/zigzag/rulesets";
    const before = (await history()).length;
    const out = await applyChanges(db, "zigzag", {
      version: await version(),
      changes: [
        { kind: "ruleset", label: "Regla para develop", branch: "develop", rule: { on: true, pr: true, nodel: true, agents: false } },
        { kind: "delete_branch", label: "Borrar la rama feat/old", branch: "feat/old" },
        { kind: "config", label: "Pruebas exigidas", patch: { required_checks: { main: ["check"] } } },
      ],
    });
    assert.deepEqual(out.results.map((r) => [r.kind, r.ok]), [["config", true], ["ruleset", false]]);
    assert.equal(out.stopped?.error, "CAMINO_GITHUB_REFUSED");
    assert.deepEqual(out.stopped?.detail, { step: "create", status: 422, message: "Validation Failed: invalid rule" });
    assert.equal(out.skipped, 1);
    assert.ok(!calls.some((c) => c.method === "DELETE" && c.path.includes("/git/refs/")), "the branch was not deleted");
    assert.deepEqual((await history()).slice(before).map((x) => x.label), ["Pruebas exigidas"]);
  });

  test("a stale version, an unknown config key, deleting a role branch and no GitHub token are refused", async () => {
    await assert.rejects(applyChanges(db, "zigzag", { version: 0, changes: [{ kind: "config", label: "x", patch: {} }] }), (e: any) => e.code === "STALE_VERSION");
    let out = await applyChanges(db, "zigzag", { version: await version(), changes: [{ kind: "config", label: "x", patch: { connections: {} } }] });
    assert.equal(out.stopped?.error, "CAMINO_CHANGE_INVALID");
    out = await applyChanges(db, "zigzag", { version: await version(), changes: [{ kind: "delete_branch", label: "x", branch: "develop" }] });
    assert.deepEqual([out.stopped?.error, (out.stopped?.detail as Json).reason], ["CAMINO_CHANGE_INVALID", "role_branch"]);
    const env = caminoDeps.env;
    caminoDeps.env = { PLANIA_GH_FALLBACK: "0", PLANIA_GITHUB_TOKEN_FILE: path.join(TMP, "none") };
    out = await applyChanges(db, "zigzag", { version: await version(), changes: [{ kind: "delete_branch", label: "x", branch: "feat/old" }] });
    caminoDeps.env = env;
    assert.equal(out.stopped?.error, "CAMINO_NO_GITHUB");
  });

  test("turning a rule off deletes Plania's ruleset; the body carries the required checks", async () => {
    rulesets = [{ id: 77, name: "plania-main" }];
    const out = await applyChanges(db, "zigzag", { version: await version(), changes: [{ kind: "ruleset", label: "Regla", branch: "main", rule: { on: false, pr: true, nodel: true, agents: false } }] });
    assert.equal(out.applied, 1);
    assert.ok(calls.some((c) => c.method === "DELETE" && c.path === `/repos/${REPO}/rulesets/77`));
    const b = rulesetBody("main", { on: true, pr: false, nodel: false, agents: true }, ["ci-ok"]);
    assert.deepEqual(b.rules, [{ type: "required_status_checks", parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: "ci-ok" }] } }]);
    assert.equal(b.bypass_actors.length, 1);
  });
});

describe("a private repo on GitHub's free plan", () => {
  test("the rule is kept in Plania (no GitHub call), and Publicar refuses while its required checks are not green", async () => {
    await setDiscovery(true);
    const out = await applyChanges(db, "zigzag", {
      version: await version(),
      changes: [
        { kind: "ruleset", label: "Regla de main", branch: "main", rule: { on: true, pr: true, nodel: true, agents: false } },
        { kind: "config", label: "Pruebas exigidas", patch: { required_checks: { main: ["check"] } } },
      ],
    });
    assert.deepEqual(out.results.map((r) => [r.kind, r.dest, r.ok]), [["ruleset", "plania", true], ["config", "plania", true]]);
    assert.match(out.results[0]!.note ?? "", /Plania la hace cumplir/);
    assert.ok(!calls.some((c) => c.path.includes("/rulesets")), "GitHub was not asked");
    assert.deepEqual(missingChecks(["check", "build"], [{ name: "check", conclusion: "SUCCESS" }, { context: "build", state: "PENDING" }]), ["build"]);

    // Publicar: the release PR's checks are read before the merge; red stops it.
    const p = await findProject(db, "zigzag");
    await setProject(db, { project: "zigzag", version: p.version, settings: { release: { from: "develop", into: "main", env: "prod", mode: "merge", prod_migrations: "none" } } }, ctx);
    const pr = await findProject(db, "zigzag");
    await raw.query(`insert into branches (project_id, name, head_sha) values ($1, 'develop', $2), ($1, 'main', $3) on conflict do nothing`, [pr.id, "d".repeat(40), "e".repeat(40)]);
    await raw.query(`insert into poll_state (project_id, source, cursor) values ($1, 'github', $2) on conflict (project_id, source) do update set cursor = excluded.cursor`, [pr.id, JSON.stringify({ release: { key: `${"d".repeat(40)}...${"e".repeat(40)}`, from_head: "d".repeat(40), into_head: "e".repeat(40), ahead: 2, contains: false, commits: [] } })]);
    const { createTask } = await import("../src/mcp/writes.js");
    const made = (await createTask(db, { project: "zigzag", title: "Algo", scope: "s", checks: ["c"], status: "Ready" } as never, ctx as never)) as { key: string };
    const t = (await raw.query(`update tasks set status = 'Merged' where key = $1 returning id`, [made.key])).rows[0].id;
    await raw.query(`update checks set done = true where task_id = $1`, [t]);
    await raw.query(`insert into pull_requests (project_id, repo, number, url, title, task_id, state, base_branch, merged_at) values ($1, $2, 5, 'u', 't', $3, 'merged', 'develop', now())`, [pr.id, REPO, t]);
    const gh: string[][] = [];
    releaseGh.run = async (args) => {
      gh.push(args);
      if (args[1] === "list") return { ok: true, stdout: "[]", stderr: "" };
      if (args[1] === "create") return { ok: true, stdout: `https://github.com/${REPO}/pull/6\n`, stderr: "" };
      if (args[1] === "view") return { ok: true, stdout: JSON.stringify({ statusCheckRollup: [{ name: "check", conclusion: "FAILURE" }] }), stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    };
    await assert.rejects(shipRelease(db, "zigzag", { ...ctx, human: true }), (e: any) => e.code === "CAMINO_RULE_BLOCKS" && e.detail.checks[0] === "check");
    assert.ok(!gh.some((a) => a[1] === "merge"), "nothing was merged");
  });
});

describe("changes made outside Plania", () => {
  test("a ruleset someone else created, deleted or changed, the default branch and the merge options are noticed", () => {
    const base = (over: Json = {}): any => ({ checked_at: "", took_ms: 0, mac: {}, github: { ok: true, repo: { full_name: REPO, default_branch: "main", merge: { squash: true, merge: true, rebase: false, delete_on_merge: false, suggest_update: false } }, rules: { available: true, list: [] }, ...over } });
    const r = (id: number, name: string, enforcement = "active") => ({ id, name, enforcement, target: "branch", branches: ["main"], required_checks: [], plania: name.startsWith("plania-") });
    const a = base({ rules: { available: true, list: [r(1, "scan", "disabled"), r(2, "old"), r(3, "plania-main")] } });
    const b = base({ repo: { full_name: REPO, default_branch: "trunk", merge: { squash: false, merge: true, rebase: false, delete_on_merge: false, suggest_update: false } }, rules: { available: true, list: [r(1, "scan", "active"), r(4, "new")] } });
    assert.deepEqual(outsideChanges(a, b), ["Regla «new» creada en GitHub", "Regla «old» borrada en GitHub", "Regla «scan» cambiada en GitHub", "La rama por defecto pasó a trunk en GitHub", "Las opciones de fusión cambiaron en GitHub"]);
    assert.deepEqual(outsideChanges(a, a), []);
  });
});
