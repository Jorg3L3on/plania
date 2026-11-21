// PLA-133: the last five settings that lived only in Ajustes › Avanzado (start_branch, the GitHub key's variable,
// release_on, release_target and vercel) are edited in Despliegue (Camino) through their own change kinds, and leave
// «Avanzado». Each change writes the same settings key its readers use, so the runner, the GitHub client and the
// pollers read what they read before. A fake GitHub and a fake Vercel; test DB only.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const keys = await import("../src/camino/keys.js");
const { caminoDeps, caminoRead } = await import("../src/camino/store.js");
const { applyChanges, ChangeSchema, destOf } = await import("../src/camino/changes.js");
const { SETTINGS } = await import("../src/mcp/settings-registry.js");
const { AVANZADO_FIELDS, advancedWithoutField } = await import("../src/api/settings-avanzado.js");
const { startBranchOf } = await import("../src/runner/start-branch.js");
const { mayReleaseByBranch } = await import("../src/jobs/github.js");
const { pollVercelProject } = await import("../src/jobs/vercel.js");
const CC = (await import(new URL("../ui/src/lib/camino-cambios.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino-cambios.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "t", session_id: "s-pla-133", machine: "ci" } };
const REPO = "acme/zigzag";
const store = new keys.MemoryCaminoKeyStore();
const ok = (data: unknown, status = 200) => ({ status, headers: { get: () => null }, json: async () => data });
const fakeFetch = async () => ok({ message: "Not Found" }, 404);
const version = async () => Number((await raw.query(`select coalesce((select version from camino where project_id = (select id from projects where slug = 'zigzag')), 0) as v`)).rows[0].v);
const settings = async () => (await findProject(db, "zigzag")).settings;
const apply = async (changes: Json[]) => applyChanges(db, "zigzag", { version: await version(), changes: changes as never });
const setSettings = async (s: Json) => setProject(db, { project: "zigzag", version: (await findProject(db, "zigzag")).version, settings: s }, { ...ctx, human: true } as never);
const FIVE = ["start_branch", "release_target", "release_on", "github_token_env", "vercel"];
const VERCEL = { project_id: "prj_1", token_env: "ZIGZAG_VERCEL", targets: { production: "prod", preview: "preview", staging: "staging" } };

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  keys.useCaminoKeyStore(store);
  Object.assign(caminoDeps, { fetch: fakeFetch, env: {}, now: () => new Date(), listDatabases: async () => [] });
  // An existing project set up through «Avanzado» before this change.
  await setSettings({ github: { repo: REPO, token_env: "ZIGZAG_GH" }, start_branch: "pruebas", release_target: "prod", vercel: VERCEL });
});
after(async () => {
  keys.useCaminoKeyStore(null);
  await closeDb?.();
  await raw?.end();
});

describe("check 2: the five left «Avanzado» and the registry names their Despliegue control", () => {
  test("no Avanzado field for them; each key's control is in Camino; every Avanzado key still has its field", () => {
    for (const f of FIVE) assert.ok(!(AVANZADO_FIELDS as readonly string[]).includes(f), `${f} is not in «Avanzado»`);
    assert.equal(SETTINGS.start_branch.control, "camino.codigo");
    for (const k of ["release_target", "release_on", "vercel"] as const) assert.equal(SETTINGS[k].control, "camino.entornos", k);
    assert.equal(SETTINGS.github.control, "camino.codigo");
    assert.deepEqual(advancedWithoutField(), []);
  });

  test("the new kinds apply in Plania, on the server and on the screen", () => {
    for (const kind of ["start_branch", "github_key_env", "release_rule", "vercel"]) {
      assert.equal(destOf({ kind } as never), "plania", kind);
      assert.equal(CC.destOf(kind, true), "plania", `${kind} on the screen`);
    }
  });
});

describe("check 3: existing projects keep their values", () => {
  test("Despliegue reads them as stored, and unset stays unset", async () => {
    const r = await caminoRead(db, "zigzag");
    assert.equal(r.settings.start_branch, "pruebas");
    assert.equal(r.settings.github_token_env, "ZIGZAG_GH");
    assert.equal(r.settings.release_target, "prod");
    assert.equal(r.settings.release_on, null, "release_on was never set");
    assert.deepEqual(r.settings.vercel_config, { project_id: "prj_1", team_id: null, token_env: "ZIGZAG_VERCEL", targets: VERCEL.targets });
    assert.equal(r.settings.start_default, "sandbox");
  });
});

describe("check 1: each one is set from Despliegue into the key its readers use", () => {
  test("start_branch: a name is taken, a protected branch is refused, null puts the default back", async () => {
    let out = await apply([{ kind: "start_branch", label: "Rama de trabajo", branch: "trabajo" }]);
    assert.equal(out.applied, 1, JSON.stringify(out));
    assert.equal(startBranchOf(await settings()), "trabajo", "the runner's start branch");
    out = await apply([{ kind: "start_branch", label: "Rama de trabajo", branch: "main" }]);
    assert.equal(out.stopped?.error, "CAMINO_CHANGE_INVALID");
    assert.equal((out.stopped?.detail as Json).reason, "protected_branch");
    assert.equal((await settings()).start_branch, "trabajo", "nothing written");
    out = await apply([{ kind: "start_branch", label: "Rama de trabajo", branch: null }]);
    assert.equal(out.applied, 1);
    assert.equal((await settings()).start_branch, undefined);
    assert.equal(startBranchOf(await settings()), "sandbox");
  });

  test("the GitHub key's variable: set beside the repository, removed with null; a value that is not a name never parses", async () => {
    let out = await apply([{ kind: "github_key_env", label: "Variable", name: "ZIGZAG_GH_2" }]);
    assert.equal(out.applied, 1, JSON.stringify(out));
    assert.deepEqual((await settings()).github, { repo: REPO, token_env: "ZIGZAG_GH_2" });
    out = await apply([{ kind: "github_key_env", label: "Variable", name: null }]);
    assert.deepEqual((await settings()).github, { repo: REPO });
    for (const name of ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "my token", "lower"]) assert.equal(ChangeSchema.safeParse({ kind: "github_key_env", label: "x", name }).success, false, name);
  });

  test("what counts as released: release_on and release_target, read by the GitHub poller; null leaves Plania's default", async () => {
    let out = await apply([{ kind: "release_rule", label: "Publicado", on: "branch", target: "live" }]);
    assert.equal(out.applied, 1, JSON.stringify(out));
    let s = await settings();
    assert.deepEqual([s.release_on, s.release_target], ["branch", "live"]);
    assert.equal(mayReleaseByBranch({ settings: s }), true);
    out = await apply([{ kind: "release_rule", label: "Publicado", on: null, target: null }]);
    s = await settings();
    assert.deepEqual([s.release_on, s.release_target], [undefined, undefined]);
    assert.equal(mayReleaseByBranch({ settings: s }), false, "with Vercel and nothing said, released means the deploy");
    assert.equal(ChangeSchema.safeParse({ kind: "release_rule", label: "x", on: "deploy", target: null }).success, false);
  });

  test("vercel: the poller reads what Despliegue wrote; targets other than production and preview are kept; null stops it", async () => {
    const out = await apply([{ kind: "vercel", label: "Vercel", config: { project_id: "prj_2", team_id: "team_9", token_env: null, targets: { staging: "staging", production: "prod" } } }]);
    assert.equal(out.applied, 1, JSON.stringify(out));
    assert.deepEqual((await settings()).vercel, { project_id: "prj_2", team_id: "team_9", targets: { staging: "staging", production: "prod" } }, "an empty token variable is left out: the poller's default holds");
    // The poller asks Vercel for that project and team, with the key from its default variable.
    const asked: string[] = [];
    await pollVercelProject(db, await findProject(db, "zigzag"), {
      env: { VERCEL_TOKEN: "t" },
      fetch: (async (url: string, init?: { headers?: Record<string, string> }) => {
        asked.push(`${url} ${init?.headers?.Authorization ?? ""}`);
        return { ok: true, status: 200, json: async () => ({ deployments: [] }) };
      }) as never,
    });
    assert.equal(asked.length, 1);
    assert.match(asked[0]!, /projectId=prj_2/);
    assert.match(asked[0]!, /teamId=team_9/);
    assert.match(asked[0]!, /Bearer t$/);
    assert.equal(ChangeSchema.safeParse({ kind: "vercel", label: "x", config: { project_id: "prj_2", team_id: null, token_env: "vcp_secretvalue", targets: null } }).success, false, "a key in the variable field never parses");
    await apply([{ kind: "vercel", label: "Vercel", config: null }]);
    assert.equal((await settings()).vercel, undefined);
  });

  test("every change says how to undo it in Historial", async () => {
    const r = await caminoRead(db, "zigzag");
    const labels = r.history.map((h) => h.label);
    for (const l of ["Rama de trabajo", "Variable", "Publicado", "Vercel"]) assert.ok(labels.includes(l), l);
    assert.ok(r.history.every((h) => h.undo), "each has its undo sentence");
  });
});
