// PLA-170: a failed production build is seen with no setting typed by hand. The host's GitHub statuses are read for
// every project with a repo; the Vercel reader takes Camino's production server and the key saved in Conexiones; a
// refused key falls back to the statuses; readiness never calls «no token» a failed deploy; the watchdog asks Taller
// for the fix of a merged step whose build failed (standalone or not), and the fix still works once the step left Merged.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { createTask } = await import("../src/mcp/writes.js");
const { findProject, findTask } = await import("../src/mcp/queries.js");
const { pollVercelProject } = await import("../src/jobs/vercel.js");
const { pollGithubProject, pollHostStatuses } = await import("../src/jobs/github.js");
const { vercelTargetOf, vercelTokenOf } = await import("../src/jobs/deploy-host.js");
const { readDeployTruth } = await import("../src/jobs/deploy-truth.js");
const { arregloDePaso } = await import("../src/api/deploy-fix.js");
const { projectEtapas } = await import("../src/api/etapa.js");
const { sweepTurns, resetTurnWatchForTests } = await import("../src/jobs/turns.js");
const { loadReadiness } = await import("../src/mcp/readiness.js");
const keys = await import("../src/camino/keys.js");

const ctx = { actor: { agent: "t", session_id: "s-170", machine: "ci" } };
const ON = { PLANIA_JOBS: "1" } as NodeJS.ProcessEnv;
const MIN = 60_000;
const MERGE = "c0ffee1234567890c0ffee1234567890c0ffee12";
const T0 = Date.parse("2026-11-22T12:00:00Z");
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const store = new keys.MemoryCaminoKeyStore();

type Hit = { status?: number; body?: unknown };
function net(routes: Record<string, Hit | ((url: string) => Hit)>) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, auth: init?.headers?.Authorization ?? null });
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    const r = hit ? (typeof hit[1] === "function" ? hit[1](url) : hit[1]) : { status: 404, body: {} };
    return { status: r.status ?? 200, headers: { get: () => null }, json: async () => r.body ?? {}, text: async () => JSON.stringify(r.body ?? {}) };
  };
  return { fetch, calls };
}
const github = (repo: string, state: string) => ({
  [`https://api.github.com/repos/${repo}/branches/main`]: { body: { name: "main", commit: { sha: MERGE } } },
  [`https://api.github.com/repos/${repo}/commits/${MERGE}/status`]: {
    body: { state, total_count: 1, statuses: [{ context: "Vercel", state, target_url: "https://vercel.com/o/p/dpl_x", description: "Deployment has failed" }] },
  },
  [`https://api.github.com/repos/${repo}/compare/`]: { body: { status: "identical" } },
});
const ghDeps = (fetch: unknown) => ({ fetch: fetch as never, env: { GITHUB_TOKEN: "ghp_test" }, tokenFile: () => ({ token: null }), fallback: false });

async function project(slug: string, settings: Record<string, unknown>): Promise<string> {
  const prefix = slug.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase();
  const id = (await raw.query(`insert into projects (slug, title, key_prefix, settings, runs_paused) values ($1, $1, $2, $3, false) returning id`, [slug, prefix, JSON.stringify(settings)])).rows[0].id as string;
  await seedOrg(db);
  return id;
}
/** A step merged at T0 with MERGE as its merge commit; under an initiative when parent is given. */
async function mergedStep(slug: string, parent?: string): Promise<string> {
  const p = await findProject(db, slug);
  const step = (await createTask(db, { project: slug, title: "Lista de clientes", scope: "s", checks: ["c"], status: "Ready", ...(parent ? { parent_key: parent } : {}) } as never, ctx)) as { key: string };
  const t = (await findTask(db, p.id, step.key))!;
  await raw.query("update tasks set status = 'Merged', status_changed_at = $2 where id = $1", [t.id, new Date(T0)]);
  await raw.query(
    "insert into pull_requests (project_id, repo, number, url, task_id, state, merged_at, merge_sha) values ($1, 'o/r', $2, 'https://github.com/o/r/pull/1', $3, 'merged', $4, $5)",
    [p.id, Math.floor(Math.random() * 1e6), t.id, new Date(T0), MERGE],
  );
  return step.key;
}
const status = async (key: string) => (await raw.query("select status from tasks where key = $1", [key])).rows[0].status as string;

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  keys.useCaminoKeyStore(store);
  // Only the projects a test makes run: the four seeded ones stay paused and out of the watchdog's way.
  await raw.query("update projects set runs_paused = true");
});
after(async () => {
  keys.useCaminoKeyStore(null);
  await closeDb();
  await raw.end();
});

describe("a project with no deploy setting at all", () => {
  test("a red host status on the published branch is the failed-deploy truth, and the step is not «En producción» by branch", async () => {
    await project("tienda-sin-ajuste", { github: { repo: "o/tienda" } });
    const step = await mergedStep("tienda-sin-ajuste");
    const { fetch } = net(github("o/tienda", "failure"));
    const p = await findProject(db, "tienda-sin-ajuste");
    assert.equal(await vercelTargetOf(db, p), null, "no Vercel target: nothing to configure");
    assert.deepEqual(await pollVercelProject(db, p, { fetch: fetch as never, env: {} }), {}, "the Vercel poller has nothing to read");
    await pollGithubProject(db, p, ghDeps(fetch));
    const t = (await readDeployTruth(db, p.id))!;
    assert.equal(t.state, "error");
    assert.equal(t.provider, "github");
    assert.equal(t.sha, MERGE);
    assert.equal(await status(step), "Merged", "a red build on the release branch does not release by branch");
  });

  test("the watchdog asks Taller for the fix (a standalone step with the host's words), with no owner card; the step then waits on it", async () => {
    resetTurnWatchForTests();
    const p = await findProject(db, "tienda-sin-ajuste");
    const [{ key: step }] = (await raw.query("select key from tasks where project_id = $1 and status = 'Merged'", [p.id])).rows;
    const before = (await projectEtapas(db, p)).byTicket.get(step)!.turn!;
    assert.deepEqual([before.turn, (before as { why?: string }).why], ["nobody", "deploy_failed"], "not «waiting on the deploy»: the build failed");
    const t0 = new Date();
    await sweepTurns(db, t0, ON);
    const s = await sweepTurns(db, new Date(t0.getTime() + 3 * MIN), ON);
    assert.equal(s.healed, 1);
    const [healed] = (await raw.query("select payload from events where type = 'turn.healed' and task_key = $1", [step])).rows;
    assert.equal(healed.payload.heal, "deploy_fix");
    const fixKey = healed.payload.fix_key as string;
    const fix = (await findTask(db, p.id, fixKey))!;
    assert.equal(fix.parentId, null, "a standalone step's fix is standalone");
    assert.equal(fix.status, "Ready");
    assert.equal(fix.workType, "bug");
    assert.match(fix.scope ?? "", /Vercel: failure/);
    assert.match(fix.scope ?? "", new RegExp(step), "the fix names the step whose build failed");
    assert.equal((await readDeployTruth(db, p.id))!.fix_key, fixKey);
    const after = (await projectEtapas(db, p)).byTicket.get(step)!.turn!;
    assert.deepEqual([after.turn, (after as { reason?: string }).reason], ["agent_queued", "waits_step"]);
    // No vague card later: the step is no longer nobody's.
    await sweepTurns(db, new Date(t0.getTime() + 90 * MIN), ON);
    assert.equal((await raw.query("select count(*)::int as n from questions where task_id = (select id from tasks where key = $1)", [step])).rows[0].n, 0);
  });

  test("«Pedir arreglo» still answers once the step left Merged (Needs owner): the same fix, not a refusal", async () => {
    const p = await findProject(db, "tienda-sin-ajuste");
    const [{ key: step }] = (await raw.query("select key from tasks where project_id = $1 and status = 'Merged' and title = 'Lista de clientes'", [p.id])).rows;
    const fixKey = (await readDeployTruth(db, p.id))!.fix_key;
    await raw.query("update tasks set status = 'Needs owner' where key = $1", [step]);
    assert.deepEqual(await arregloDePaso(db, "tienda-sin-ajuste", step), { key: fixKey, existing: true });
  });

  test("an initiative's step: the fix goes under its initiative, and the ficha card stays after the step went to Needs owner", async () => {
    await project("tienda-con-iniciativa", { github: { repo: "o/ini" } });
    const p = await findProject(db, "tienda-con-iniciativa");
    const init = (await createTask(db, { project: p.slug, kind: "initiative", title: "Catálogo", scope: "s" } as never, ctx)) as { key: string };
    const step = await mergedStep(p.slug, init.key);
    await pollGithubProject(db, p, ghDeps(net(github("o/ini", "failure")).fetch));
    await raw.query("update tasks set status = 'Needs owner' where key = $1", [step]);
    const { builtOf } = await import("../src/api/company-idea.js");
    const card = (await builtOf(db, p.slug, (await findTask(db, p.id, init.key))!)).deploy;
    assert.equal(card?.state, "error", "the red card is still on the ficha");
    const made = (await arregloDePaso(db, p.slug, step)) as { key: string; existing: boolean };
    assert.equal(made.existing, false);
    const fix = (await findTask(db, p.id, made.key))!;
    const [{ key: parent }] = (await raw.query("select key from tasks where id = $1", [fix.parentId])).rows;
    assert.equal(parent, init.key);
  });
});

describe("the Vercel reader takes what the screen saved", () => {
  const deployments = [{ uid: "dpl_c1", url: "c-1.vercel.app", state: "READY", target: "production", created: T0 + MIN, meta: { githubCommitSha: MERGE } }];

  test("Camino's production server picks the Vercel project; the key saved in Conexiones is used before the env var", async () => {
    const pid = await project("tienda-camino", { github: { repo: "o/cam" } });
    await raw.query(`insert into camino (project_id, config, version) values ($1, $2, 1)`, [pid, JSON.stringify({ envs: [{ id: "prod", name: "Producción", kind: "produccion", record: "prod", server: { provider: "vercel", project: "prj_camino", note: null } }] })]);
    await store.set("tienda-camino", "vercel", "vc_saved_key");
    const p = await findProject(db, "tienda-camino");
    assert.deepEqual(await vercelTargetOf(db, p), { project_id: "prj_camino", from: "camino" });
    assert.deepEqual(await vercelTokenOf(p, {}, { env: { VERCEL_TOKEN: "vc_env" } }), { token: "vc_saved_key", source: "camino" });
    const { fetch, calls } = net({ "https://api.vercel.com/v6/deployments?": { body: { deployments } }, "https://c-1.vercel.app": { status: 200 } });
    const s = await pollVercelProject(db, p, { fetch: fetch as never, env: { VERCEL_TOKEN: "vc_env" } });
    assert.equal(s.deployments, 1);
    const list = calls.find((c) => c.url.startsWith("https://api.vercel.com/v6/deployments?"))!;
    assert.match(list.url, /projectId=prj_camino/);
    assert.equal(list.auth, "Bearer vc_saved_key");
    assert.equal((await readDeployTruth(db, p.id))!.state, "live");
    // With nothing saved, the env var is the key.
    await store.delete("tienda-camino", "vercel");
    assert.deepEqual(await vercelTokenOf(p, {}, { env: { VERCEL_TOKEN: "vc_env" } }), { token: "vc_env", source: "env" });
    // settings.vercel still wins over Camino when the owner set it.
    await raw.query(`update projects set settings = settings || '{"vercel": {"project_id": "prj_own"}}' where id = $1`, [pid]);
    assert.equal((await vercelTargetOf(db, await findProject(db, "tienda-camino")))!.project_id, "prj_own");
  });

  test("a refused key: the GitHub poller reads the host's statuses instead, and readiness says deploys cannot be read before that, never «failed»", async () => {
    await project("tienda-llave-mala", { github: { repo: "o/bad" }, vercel: { project_id: "prj_bad" } });
    await store.set("tienda-llave-mala", "vercel", "vc_refused_key");
    const p = await findProject(db, "tienda-llave-mala");
    const review = (await createTask(db, { project: p.slug, title: "En revisión", scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string };
    await raw.query("update tasks set status = 'In review' where key = $1", [review.key]);
    const { fetch } = net({ "https://api.vercel.com/": { status: 403, body: { error: { code: "forbidden" } } }, ...github("o/bad", "failure") });
    await assert.rejects(pollVercelProject(db, p, { fetch: fetch as never, env: {} }), /Vercel 403/);
    const unread = await loadReadiness(db, p);
    assert.ok(!unread.reasons.some((r) => r.code === "DEPLOY_BLOCKED"), JSON.stringify(unread.reasons));
    assert.ok(unread.reasons.some((r) => r.code === "ENV_UNKNOWN" && /no se pueden leer los despliegues|deploys cannot be read/.test(r.text)), JSON.stringify(unread.reasons));
    assert.equal(await pollHostStatuses(db, p, ghDeps(fetch), "ghp_test", "o/bad"), 1);
    assert.equal((await readDeployTruth(db, p.id))!.state, "error");
    const failed = await loadReadiness(db, p);
    assert.ok(failed.reasons.some((r) => r.code === "DEPLOY_BLOCKED"), "now the host said it failed");
  });

  test("«no token» alone never reads as a failed deploy", async () => {
    await project("tienda-sin-llave", { github: { repo: "o/none" }, vercel: { project_id: "prj_none" } });
    const p = await findProject(db, "tienda-sin-llave");
    const review = (await createTask(db, { project: p.slug, title: "En revisión", scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string };
    await raw.query("update tasks set status = 'In review' where key = $1", [review.key]);
    await pollVercelProject(db, p, { fetch: net({}).fetch as never, env: {} });
    const [{ error }] = (await raw.query("select error from poll_state where project_id = $1 and source = 'vercel'", [p.id])).rows;
    assert.match(error, /^no token/);
    const r = await loadReadiness(db, p);
    assert.ok(!r.reasons.some((x) => x.code === "DEPLOY_BLOCKED"), JSON.stringify(r.reasons));
    assert.notEqual(r.state, "blocked");
  });
});
