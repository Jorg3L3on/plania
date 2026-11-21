// PLA-132: Ajustes no longer repeats Despliegue. Where the code is, the release step and the production address are
// edited only in Despliegue (Camino); the values other readers use (settings.preview_url, settings.release.mode and
// prod_migrations, settings.local.no_code) follow Despliegue's saves, and Publicar reads who migrates production from
// Despliegue's saved environment before the older setting. A fake GitHub; test DB only.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const keys = await import("../src/camino/keys.js");
const { caminoDeps } = await import("../src/camino/store.js");
const { applyChanges } = await import("../src/camino/changes.js");
const { effectiveConfig } = await import("../src/camino/config.js");
const { releasePlan } = await import("../src/mcp/release-plan.js");
const { SETTINGS } = await import("../src/mcp/settings-registry.js");
const E = (await import(new URL("../ui/src/lib/camino-entornos.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino-entornos.js");
const listo = (await import(new URL("../ui/src/lib/listo.ts", import.meta.url).href)) as typeof import("../ui/src/lib/listo.js");
const AJ = (await import(new URL("../ui/src/lib/ajustes.ts", import.meta.url).href)) as typeof import("../ui/src/lib/ajustes.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "t", session_id: "s-pla-132", machine: "ci" } };
const REPO = "acme/zigzag";
const store = new keys.MemoryCaminoKeyStore();
const ok = (data: unknown, status = 200) => ({ status, headers: { get: () => null }, json: async () => data });
// Only the repository check a «repo» change makes; anything else is refused.
const fakeFetch = async (url: string) => (url === `https://api.github.com/repos/${REPO}` ? ok({ full_name: REPO }) : ok({ message: "Not Found" }, 404));
const version = async () => Number((await raw.query(`select coalesce((select version from camino where project_id = (select id from projects where slug = 'zigzag')), 0) as v`)).rows[0].v);
const settings = async () => (await findProject(db, "zigzag")).settings;
const prodEnv = (over: Json = {}) => ({ ...E.newEnv([], "produccion", "Producción", "main"), record: "prod", ...over });
const apply = async (changes: Json[]) => applyChanges(db, "zigzag", { version: await version(), changes: changes as never });
const setSettings = async (s: Json) => setProject(db, { project: "zigzag", version: (await findProject(db, "zigzag")).version, settings: s }, { ...ctx, human: true } as never);

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  keys.useCaminoKeyStore(store);
  await store.set("zigzag", "github", "ghp_test_0123456789");
  Object.assign(caminoDeps, { fetch: fakeFetch, env: {}, now: () => new Date(), listDatabases: async () => [] });
  await setSettings({ github: { repo: REPO }, release: { from: "sandbox", into: "main", env: "prod", mode: "merge", prod_migrations: "deploy" }, preview_url: "https://old.example.com" });
});
after(async () => {
  keys.useCaminoKeyStore(null);
  await closeDb?.();
  await raw?.end();
});

describe("check 5: a project with only the older settings still shows them in Despliegue", () => {
  test("repo, branches and the production environment come from the settings while Camino has nothing saved", async () => {
    const s = await settings();
    const c = effectiveConfig(s, {}, null);
    assert.deepEqual([c.model, c.branches.published, c.branches.integration], ["integ", "main", "sandbox"]);
    const prod = c.envs.find((e) => e.kind === "produccion")!;
    assert.deepEqual([prod.id, prod.url, prod.database?.migrate_when], ["prod", "https://old.example.com", "build"]);
    assert.equal(c.source.envs, "settings");
    // The release plan answers from the older setting while Camino has said nothing.
    assert.equal((await releasePlan(db, await findProject(db, "zigzag")))!.prod_migrations, "deploy");
  });
});

describe("check 1: who migrates production has one place", () => {
  test("Despliegue's saved production environment wins over an old settings.release.prod_migrations, and the setting follows it", async () => {
    const env = prodEnv({ url: "https://tienda.example.com", database: { ...prodEnv().database!, provider: "neon", migrate_when: "mano" } });
    const out = await apply([{ kind: "config", label: "Entornos", patch: { envs: [env] } }]);
    assert.equal(out.applied, 1, JSON.stringify(out));
    const s = await settings();
    assert.equal(s.release?.prod_migrations, "owner", "the older setting follows Despliegue");
    assert.equal(s.release?.mode, "merge", "the rest of the release step is kept");
    assert.equal((await releasePlan(db, await findProject(db, "zigzag")))!.prod_migrations, "owner");
  });

  test("even when the older setting is changed behind Despliegue's back, Publicar reads Despliegue", async () => {
    const s = await settings();
    await setSettings({ release: { ...s.release!, prod_migrations: "deploy" } });
    assert.equal((await releasePlan(db, await findProject(db, "zigzag")))!.prod_migrations, "owner");
  });

  test("an environment that does not say who migrates keeps the older answer (the first save of a derived one)", async () => {
    const s = await settings();
    await setSettings({ release: { ...s.release!, prod_migrations: "deploy" } });
    await raw.query(`delete from camino where project_id = (select id from projects where slug = 'zigzag')`);
    // As Despliegue shows it before anything is saved: no database service chosen.
    const derived = effectiveConfig(await settings(), {}, null).envs.find((e) => e.kind === "produccion")!;
    assert.equal(derived.database?.provider, null);
    await apply([{ kind: "config", label: "Entornos", patch: { envs: [{ ...derived, health: { url: "/salud", pages: [] } }] } }]);
    assert.equal((await settings()).release?.prod_migrations, "deploy", "not erased");
    assert.equal((await releasePlan(db, await findProject(db, "zigzag")))!.prod_migrations, "deploy", "Publicar does not start waiting");
  });

  test("a production environment with no database says nobody needs to migrate", async () => {
    await apply([{ kind: "config", label: "Entornos", patch: { envs: [prodEnv({ url: "https://tienda.example.com", database: null })] } }]);
    assert.equal((await settings()).release?.prod_migrations, "none");
    assert.equal((await releasePlan(db, await findProject(db, "zigzag")))!.prod_migrations, "none");
  });
});

describe("check 2: the production address has one place", () => {
  test("saving the environment's address writes the one the review links to", async () => {
    await apply([{ kind: "config", label: "Entornos", patch: { envs: [prodEnv({ url: "https://nueva.example.com", database: null })] } }]);
    assert.equal((await settings()).preview_url, "https://nueva.example.com");
    // Clearing it clears both.
    await apply([{ kind: "config", label: "Entornos", patch: { envs: [prodEnv({ url: null, database: null })] } }]);
    assert.equal((await settings()).preview_url, undefined);
  });

  test("an address that is not http(s) is left out instead of failing the save", async () => {
    const out = await apply([{ kind: "config", label: "Entornos", patch: { envs: [prodEnv({ url: "tienda.example.com", database: null })] } }]);
    assert.equal(out.applied, 1, JSON.stringify(out));
    assert.equal((await settings()).preview_url, undefined);
  });

  test("environments saved before this change: a production one with no address shows the older one", async () => {
    const s = { ...(await settings()), preview_url: "https://antes.example.com" };
    const stored = { envs: [prodEnv({ url: null, database: null }), { ...E.newEnv([], "temporal", "Previas", "sandbox"), url: null }] };
    const c = effectiveConfig(s, stored as never, null);
    assert.equal(c.envs.find((e) => e.kind === "produccion")!.url, "https://antes.example.com");
    assert.equal(c.envs.find((e) => e.kind === "temporal")!.url, null, "only production takes it");
    const own = effectiveConfig(s, { envs: [prodEnv({ url: "https://propia.example.com" })] } as never, null);
    assert.equal(own.envs[0]!.url, "https://propia.example.com", "an address saved in Despliegue wins");
  });
});

describe("check 4: «Sin código» and «Fusionar desde Plania» are set from Despliegue", () => {
  test("release_mode switches how the step ships and keeps the rest of it", async () => {
    let out = await apply([{ kind: "release_mode", label: "Fusionar desde Plania", mode: "command" }]);
    assert.equal(out.applied, 1, JSON.stringify(out));
    let s = await settings();
    // «command» is the default, which checkReleaseSettings stores as no mode at all.
    assert.deepEqual([s.release?.mode ?? "command", s.release?.from, s.release?.into], ["command", "sandbox", "main"]);
    out = await apply([{ kind: "release_mode", label: "Fusionar desde Plania", mode: "merge" }]);
    s = await settings();
    assert.equal(s.release?.mode, "merge");
    const hist = (await raw.query(`select dest, undo from camino_history order by at desc limit 1`)).rows[0];
    assert.equal(hist.dest, "plania");
    assert.match(hist.undo, /Fusionar desde Plania/);
  });

  test("no_code says the project has no code: folder and repository go, the key's variable stays", async () => {
    await setSettings({ github: { repo: REPO, token_env: "ZIGZAG_GH" } });
    const out = await apply([{ kind: "no_code", label: "Si tiene código", none: true }]);
    assert.equal(out.applied, 1, JSON.stringify(out));
    let s = await settings();
    assert.deepEqual(s.local, { no_code: true });
    assert.deepEqual(s.github, { token_env: "ZIGZAG_GH" });
    // Picking a repository again means it has code.
    await apply([{ kind: "repo", label: "Repositorio", repo: REPO }]);
    s = await settings();
    assert.equal(s.local, undefined);
    assert.equal(s.github?.repo, REPO);
    // And turning it off by itself clears the flag.
    await apply([{ kind: "no_code", label: "Si tiene código", none: true }]);
    await apply([{ kind: "no_code", label: "Si tiene código", none: false }]);
    assert.equal((await settings()).local, undefined);
  });

  test("release_mode is refused, with a code, on a project that has no release step", async () => {
    await setSettings({ release: null });
    const out = await apply([{ kind: "release_mode", label: "Fusionar desde Plania", mode: "merge" }]);
    assert.equal(out.applied, 0);
    assert.equal(out.stopped?.error, "CAMINO_CHANGE_INVALID");
  });
});

describe("check 3 and 6: Ajustes no longer holds the moved fields, nothing sends the owner there for them", () => {
  test("the registry names Despliegue as the control of the code, the release step and the address", () => {
    assert.deepEqual([SETTINGS.local.control, SETTINGS.github.control, SETTINGS.release.control, SETTINGS.preview_url.control], ["camino.codigo", "camino.codigo", "camino.codigo", "camino.entornos"]);
  });

  test("the readiness list sends the code's folder and repository to Despliegue", () => {
    assert.deepEqual(listo.listoIrA("code"), { tab: "camino", sec: "codigo" });
    assert.deepEqual(listo.listoIrA("github"), { tab: "camino", sec: "codigo" });
    assert.deepEqual(listo.listoIrA("verify"), { tab: "ajustes", sec: "pruebas" });
    assert.equal(listo.listoIr("es", "camino"), "Arreglarlo en Despliegue");
    for (const why of ["missing", "notGit", "noOrigin", "noBranch"] as const) {
      const line = listo.listoLinea({ id: "code", state: "missing", blocks: true, why: why === "missing" ? "REPO_FOLDER_MISSING" : why === "notGit" ? "REPO_NOT_GIT" : why === "noOrigin" ? "REPO_NO_ORIGIN" : "REPO_NO_START_BRANCH", path: "/r" } as never, "es").texto;
      assert.doesNotMatch(line, /Ajustes/, line);
    }
  });

  test("the Ajustes words keep no section for the code or the release step", () => {
    const S = AJ.ajustesWords("es").secciones as Record<string, unknown>;
    assert.equal("codigo" in S, false);
    assert.equal("lanzamiento" in S, false);
    assert.doesNotMatch(JSON.stringify(S.vista), /Dónde ves la app/);
  });
});
