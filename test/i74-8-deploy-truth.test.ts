// PLA-I74-8: deploy truth. Every Vercel deploy state is read: a failed production build is a red card with its log
// and «Pedir arreglo» makes a Taller step that carries it; «En producción» (Released) waits for READY and a live answer
// from the production URL; without a Vercel token the host's GitHub commit statuses are read instead.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject, findTask } = await import("../src/mcp/queries.js");
const { pollVercelProject } = await import("../src/jobs/vercel.js");
const { pollGithubProject } = await import("../src/jobs/github.js");
const { readDeployTruth, logExcerpt } = await import("../src/jobs/deploy-truth.js");
const { builtOf } = await import("../src/api/company-idea.js");
const { pedirArreglo, carries } = await import("../src/api/deploy-fix.js");

let raw: pg.Client;
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };
const MERGE = "abcdef1234567890abcdef1234567890abcdef12";
const T0 = Date.parse("2026-11-22T12:00:00Z");

type Route = { status?: number; body?: unknown } | ((url: string) => { status?: number; body?: unknown });
function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit) return { status: 404, headers: { get: () => null }, json: async () => ({}) };
    const r = typeof hit[1] === "function" ? hit[1](url) : hit[1];
    return { status: r.status ?? 200, headers: { get: () => null }, json: async () => r.body ?? {} };
  };
  return { fetch: f, calls };
}

// An initiative with one step merged at T0 with MERGE as its merge commit, waiting on the deploy.
async function mergedStep(slug: string, settings: Record<string, unknown>): Promise<{ init: string; step: string }> {
  const { db, close } = makeDb();
  try {
    const p = await findProject(db, slug);
    await setProject(db, { project: slug, version: p.version, settings }, ctx);
    const init = (await createTask(db, { project: slug, kind: "initiative", title: "Catalog", scope: "s" }, ctx)) as { key: string };
    const step = (await createTask(db, { project: slug, title: "Catalog list", scope: "s", checks: ["c"], parent_key: init.key, status: "Ready" }, ctx)) as { key: string };
    const t = (await findTask(db, p.id, step.key))!;
    await raw.query("update tasks set status = 'Merged' where id = $1", [t.id]);
    await raw.query(
      "insert into pull_requests (project_id, repo, number, url, task_id, state, merged_at, merge_sha) values ($1, 'o/r', 7, 'https://github.com/o/r/pull/7', $2, 'merged', $3, $4)",
      [p.id, t.id, new Date(T0), MERGE],
    );
    return { init: init.key, step: step.key };
  } finally {
    await close();
  }
}
const status = async (key: string) => (await raw.query("select status from tasks where key = $1", [key])).rows[0].status as string;
async function built(slug: string, key: string) {
  const { db, close } = makeDb();
  try {
    const p = await findProject(db, slug);
    return await builtOf(db, slug, (await findTask(db, p.id, key))!);
  } finally {
    await close();
  }
}

before(async () => {
  raw = await resetTestDb();
});
after(async () => {
  await raw.end();
});

describe("vercel: every state", () => {
  test("a production deploy in ERROR is kept with its log; the ficha shows the red card from the first poll and still on the second; READY deploys still become env records", async () => {
    const { init, step } = await mergedStep("filmia", { vercel: { project_id: "prj_1" }, release_target: "prod" });
    const deployments = [
      { uid: "dpl_ok", url: "filmia-old.vercel.app", state: "READY", target: "production", created: T0 - 60_000, meta: { githubCommitSha: "1111111111111111111111111111111111111111" } },
      { uid: "dpl_bad", url: "filmia-new.vercel.app", state: "ERROR", target: "production", created: T0 + 60_000, inspectorUrl: "https://vercel.com/o/filmia/dpl_bad", meta: { githubCommitSha: MERGE } },
    ];
    const events = [
      { type: "stdout", text: "Running \"next build\"" },
      { type: "stderr", text: "Type error: Property 'precio' does not exist on type 'Item'." },
      { type: "stderr", text: "Error: Command \"next build\" exited with 1" },
    ].reverse(); // the API answers newest first (direction=backward)
    const { fetch, calls } = fakeFetch({
      "https://api.vercel.com/v6/deployments?": { body: { deployments } },
      "https://api.vercel.com/v3/deployments/dpl_bad/events": { body: events },
      "https://filmia-old.vercel.app": { status: 200 },
    });
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "filmia");
      const s = await pollVercelProject(db, p, { fetch, env: { VERCEL_TOKEN: "vc_test" } });
      assert.equal(s.failed, 1);
      assert.equal(s.deployments, 1, "the READY one is still recorded (R-20)");
      assert.ok(!calls.some((u) => u.includes("state=READY")), "every state is asked for");
      const truth = (await readDeployTruth(db, p.id))!;
      assert.equal(truth.state, "error");
      assert.match(truth.log!, /Property 'precio' does not exist/);
      assert.match(truth.log!, /exited with 1/);
      assert.ok(truth.log!.indexOf("Running") < truth.log!.indexOf("Type error"), "the log reads oldest first");
      const b1 = await built("filmia", init);
      assert.equal(b1.published_at, null);
      assert.equal(b1.deploy?.state, "error");
      assert.match(b1.deploy!.log!, /precio/);
      assert.equal(b1.deploy!.url, "https://vercel.com/o/filmia/dpl_bad");
      // Second cycle: nothing new from the host, the card stays.
      await pollVercelProject(db, await findProject(db, "filmia"), { fetch, env: { VERCEL_TOKEN: "vc_test" } });
      assert.equal((await built("filmia", init)).deploy?.state, "error");
      assert.equal(await status(step), "Merged", "a failed build releases nothing");
      const { rows } = await raw.query("select r.error from poll_state r join projects p on p.id = r.project_id where p.slug = 'filmia' and r.source = 'deploy'");
      assert.equal(rows[0].error, "production deploy failed", "readiness reads it as a failed deploy");
    } finally {
      await close();
    }
  });

  test("«Pedir arreglo» makes one Ready Taller step under the initiative with the log; asking again returns it, and the card points at it", async () => {
    const { db, close } = makeDb();
    try {
      const [{ key: init }] = (await raw.query("select key from tasks where kind = 'initiative' and project_id = (select id from projects where slug = 'filmia') order by created_at desc limit 1")).rows;
      const made = (await pedirArreglo(db, "filmia", init)) as { key: string; existing: boolean };
      assert.equal(made.existing, false);
      const p = await findProject(db, "filmia");
      const fix = (await findTask(db, p.id, made.key))!;
      assert.equal(fix.status, "Ready");
      assert.equal(fix.workType, "bug");
      const [{ key: parent }] = (await raw.query("select key from tasks where id = $1", [fix.parentId])).rows;
      assert.equal(parent, init);
      assert.match(fix.scope ?? "", /Property 'precio' does not exist/);
      assert.match(fix.scope ?? "", /```/);
      const again = (await pedirArreglo(db, "filmia", init)) as { key: string; existing: boolean };
      assert.deepEqual(again, { key: made.key, existing: true });
      assert.equal((await built("filmia", init)).deploy?.fix_key, made.key);
      const refused = (await pedirArreglo(db, "filmia", "FIL-404")) as { error: string };
      assert.equal(refused.error, "TASK_NOT_FOUND");
    } finally {
      await close();
    }
  });

  test("a READY production deploy is «En producción» only once the production URL answers: before that the step stays Merged and nothing is recorded", async () => {
    const { init, step } = await mergedStep("workia", { vercel: { project_id: "prj_w", production_url: "https://workia.example.com" }, release_target: "prod" });
    let up = false;
    const deployments = [{ uid: "dpl_w1", url: "workia-1.vercel.app", state: "READY", target: "production", created: T0 + 120_000, meta: { githubCommitSha: MERGE } }];
    const { fetch, calls } = fakeFetch({
      "https://api.vercel.com/v6/deployments?": { body: { deployments } },
      "https://workia.example.com": () => ({ status: up ? 200 : 503 }),
    });
    const { db, close } = makeDb();
    try {
      const s1 = await pollVercelProject(db, await findProject(db, "workia"), { fetch, env: { VERCEL_TOKEN: "vc_test" } });
      assert.equal(s1.deployments, 0);
      assert.ok(calls.includes("https://workia.example.com"), "the production URL is the one probed");
      const p = await findProject(db, "workia");
      assert.equal((await readDeployTruth(db, p.id))!.state, "checking");
      assert.equal((await readDeployTruth(db, p.id))!.probe_status, 503);
      assert.equal(await status(step), "Merged");
      assert.equal((await built("workia", init)).deploy?.state, "checking");
      const { rows: none } = await raw.query("select 1 from env_states where project_id = $1", [p.id]);
      assert.equal(none.length, 0);
      up = true;
      const s2 = await pollVercelProject(db, p, { fetch, env: { VERCEL_TOKEN: "vc_test" } });
      assert.equal(s2.deployments, 1);
      assert.equal(s2.released, 1);
      assert.equal(await status(step), "Released");
      assert.equal((await readDeployTruth(db, p.id))!.state, "live");
      const b = await built("workia", init);
      assert.equal(b.deploy, null);
    } finally {
      await close();
    }
  });

  test("a production deploy still building holds the cursor and says so; once READY and live it is recorded", async () => {
    const { db, close } = makeDb();
    try {
      const p0 = await findProject(db, "micasa");
      await setProject(db, { project: "micasa", version: p0.version, settings: { vercel: { project_id: "prj_m" }, release_target: "prod" } }, ctx);
      let state = "BUILDING";
      const { fetch } = fakeFetch({
        "https://api.vercel.com/v6/deployments?": () => ({ body: { deployments: [{ uid: "dpl_m", url: "micasa-1.vercel.app", state, target: "production", created: T0, meta: { githubCommitSha: MERGE } }] } }),
        "https://micasa-1.vercel.app": { status: 200 },
      });
      await pollVercelProject(db, await findProject(db, "micasa"), { fetch, env: { VERCEL_TOKEN: "vc_test" } });
      assert.equal((await readDeployTruth(db, p0.id))!.state, "building");
      state = "READY";
      const s = await pollVercelProject(db, await findProject(db, "micasa"), { fetch, env: { VERCEL_TOKEN: "vc_test" } });
      assert.equal(s.deployments, 1, "the cursor did not pass the building deploy");
      assert.equal((await readDeployTruth(db, p0.id))!.state, "live");
    } finally {
      await close();
    }
  });
});

describe("github statuses without a Vercel token", () => {
  test("a red host status on the release branch head is a failed build; a green one counts once the production URL answers, and releases the merged step", async () => {
    const { init, step } = await mergedStep("zigzag", { github: { repo: "o/zig" }, vercel: { project_id: "prj_z", production_url: "https://zig.example.com" }, release_target: "prod" });
    let host: { state: string; description: string } = { state: "failure", description: "Deployment has failed" };
    const { fetch } = fakeFetch({
      "https://api.github.com/repos/o/zig/branches/main": { body: { name: "main", commit: { sha: MERGE } } },
      [`https://api.github.com/repos/o/zig/commits/${MERGE}/status`]: () => ({ body: { state: host.state, total_count: 2, statuses: [{ context: "Vercel", state: host.state, target_url: "https://vercel.com/o/zig/dpl_9", description: host.description }, { context: "ci/tests", state: "success", target_url: null }] } }),
      "https://api.github.com/repos/o/zig/compare/": { body: { status: "identical" } },
      "https://zig.example.com": { status: 200 },
    });
    const { db, close } = makeDb();
    try {
      const deps = { fetch, env: { GITHUB_TOKEN: "ghp_test" }, tokenFile: () => ({ token: null }), fallback: false };
      // The Vercel poller runs first and says it has no token (PLA-169: the fallback waits for that).
      await pollVercelProject(db, await findProject(db, "zigzag"), { fetch, env: {} });
      await pollGithubProject(db, await findProject(db, "zigzag"), deps);
      const p = await findProject(db, "zigzag");
      const t = (await readDeployTruth(db, p.id))!;
      assert.equal(t.state, "error");
      assert.equal(t.provider, "github");
      assert.match(t.log!, /Vercel: failure\nDeployment has failed/);
      assert.equal((await built("zigzag", init)).deploy?.state, "error");
      assert.equal(await status(step), "Merged");
      host = { state: "success", description: "Deployment has completed" };
      // The settled answer for this commit is not asked again: a new commit is a new answer.
      await raw.query("update poll_state set cursor = '{}' where source = 'deploy' and project_id = $1", [p.id]);
      await pollGithubProject(db, await findProject(db, "zigzag"), deps);
      assert.equal((await readDeployTruth(db, p.id))!.state, "live");
      const { rows } = await raw.query("select commit, deploy_source->>'provider' as provider from env_states where project_id = $1 and env = 'prod'", [p.id]);
      assert.deepEqual(rows, [{ commit: MERGE, provider: "github-status" }]);
      assert.equal(await status(step), "Released");
    } finally {
      await close();
    }
  });

  test("while the Vercel poller reads the host fine (or has not run) the GitHub poller leaves the host to it, whatever its own env holds", async () => {
    const { db, close } = makeDb();
    try {
      const { fetch, calls } = fakeFetch({});
      const p = await findProject(db, "zigzag");
      const { pollHostStatuses } = await import("../src/jobs/github.js");
      // PLA-169/170: only the Vercel poller's own record counts, not this poller's env.
      await raw.query("update poll_state set error = null where source = 'vercel' and project_id = $1", [p.id]);
      assert.equal(await pollHostStatuses(db, p, { fetch, env: {} }, "ghp", "o/zig"), 0);
      await raw.query("delete from poll_state where source = 'vercel' and project_id = $1", [p.id]);
      assert.equal(await pollHostStatuses(db, p, { fetch, env: { VERCEL_TOKEN: "vc" } }, "ghp", "o/zig"), 0);
      assert.equal(calls.length, 0);
    } finally {
      await close();
    }
  });
});

describe("pieces", () => {
  test("the log excerpt starts a little before the first error and keeps at most 30 lines", () => {
    const lines = [...Array.from({ length: 50 }, (_, i) => `step ${i}`), "Error: boom", "at x"];
    const out = logExcerpt(lines)!;
    assert.ok(out.split("\n").length <= 30);
    assert.match(out, /Error: boom/);
    assert.equal(logExcerpt([]), null);
    assert.equal(logExcerpt(["\u001b[31mfailed\u001b[0m"]), "failed", "colour codes are dropped");
  });
  test("a deploy carries the merges when it names their commit or came after the first one", () => {
    const merges = [{ sha: MERGE, at: new Date(T0) }];
    assert.equal(carries({ sha: MERGE.slice(0, 7), created_at: new Date(T0 - 1000).toISOString() }, merges), true);
    assert.equal(carries({ sha: "9999999", created_at: new Date(T0 + 1000).toISOString() }, merges), true);
    assert.equal(carries({ sha: "9999999", created_at: new Date(T0 - 1000).toISOString() }, merges), false);
    assert.equal(carries({ sha: MERGE, created_at: new Date(T0).toISOString() }, []), false);
  });
});
