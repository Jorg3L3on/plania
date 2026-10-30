// 2.10 item 2 (phase one): the release as an inbox step, computed from settings.release, the
// branch heads, the GitHub compare (cached by the pair of heads) and the merged tickets.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask, setTask } = await import("../src/mcp/writes.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject, findTask, listEvents } = await import("../src/mcp/queries.js");
const { reserveSequence } = await import("../src/mcp/sequences.js");
const { pollGithubProject } = await import("../src/jobs/github.js");
const { releasePlan } = await import("../src/mcp/release-plan.js");
const { inbox } = await import("../src/mcp/inbox.js");
const { resumeDigest } = await import("../src/mcp/resume.js");
const { auditProject } = await import("../src/mcp/audit.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };
const REPO = "Jorg3L3on/zigzag";
const SANDBOX = "5aaaaaa111111111111111111111111111111111";
const MAIN = "0bbbbbb222222222222222222222222222222222";

let heads: Record<string, string> = { sandbox: SANDBOX, main: MAIN };
function fakeFetch() {
  const calls: string[] = [];
  const f = async (url: string) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, "");
    calls.push(path);
    const ok = (data: unknown) => ({ status: 200, headers: { get: () => null }, json: async () => data });
    if (path.startsWith(`/repos/${REPO}/pulls?`)) return ok([]);
    if (path.startsWith(`/repos/${REPO}/branches`)) return ok(Object.entries(heads).map(([name, sha]) => ({ name, commit: { sha } })));
    if (path.startsWith(`/repos/${REPO}/compare/`)) {
      const [base, head] = path.slice(`/repos/${REPO}/compare/`.length).split("...");
      // The Merged → Released check asks merge...prod: the merge commits are not in prod.
      if (base!.startsWith("60")) return ok({ status: "diverged", ahead_by: 1, commits: [] });
      if (base === head) return ok({ status: "identical", ahead_by: 0, commits: [] });
      return ok({ status: "ahead", ahead_by: 3, commits: [{ sha: "c1c1c1c1" }, { sha: "c2c2c2c2" }, { sha: head }] });
    }
    return { status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
  return { fetch: f, calls };
}
const deps = (fetch: ReturnType<typeof fakeFetch>["fetch"]) => ({ fetch, env: { GITHUB_TOKEN: "ghp_test" } });
const project = () => findProject(db, "zigzag");

async function merged(key: string, number: number, base: string) {
  const p = await project();
  const t = (await findTask(db, p.id, key))!;
  await raw.query("update tasks set status = 'Merged', status_changed_at = now() - interval '1 day', pr_url = $2 where id = $1", [t.id, `https://github.com/${REPO}/pull/${number}`]);
  await raw.query(
    "insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_sha, head_branch, base_branch, merged_at, merge_sha) values ($1, $2, $3, $4, $5, $6, 'merged', $7, $8, $9, now(), $7)",
    [p.id, REPO, number, `https://github.com/${REPO}/pull/${number}`, key, t.id, `${number}`.padEnd(40, "e"), `jl/${key.toLowerCase()}`, base],
  );
}

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  const p = await project();
  await setProject(db, { project: "zigzag", version: p.version, settings: { github: { repo: REPO }, release_target: "prod" } }, ctx);
  await createTask(db, { project: "zigzag", kind: "initiative", title: "Android", scope: "PRD", integration_branch: "jl/android" }, ctx); // ZIG-I1
  await createTask(db, { project: "zigzag", title: "Badge", scope: "s", checks: ["c1", "c2"], parent_key: "ZIG-I1", phase: 1, status: "Ready" }, ctx); // ZIG-I1-1
  await createTask(db, { project: "zigzag", title: "Actions", scope: "s", checks: ["c"], parent_key: "ZIG-I1", phase: 2, status: "Ready" }, ctx); // ZIG-I1-2
  await createTask(db, { project: "zigzag", title: "Hotfix", scope: "s", checks: ["c"], status: "Ready" }, ctx); // ZIG-01
  await createTask(
    db,
    { project: "zigzag", title: "VAPID en prod", scope: "s", checks: ["c"], work_type: "ops", status: "Ready", blocked_by: [{ human_action: { text: "Poner las variables VAPID en Vercel Production antes de mergear sandbox → main" } }] },
    ctx,
  ); // ZIG-02
  await merged("ZIG-I1-1", 600, "sandbox");
  await merged("ZIG-I1-2", 601, "sandbox");
  await merged("ZIG-01", 602, "main"); // straight into main: not part of the release
  await raw.query("update checks set done = true where task_id = (select id from tasks where key = 'ZIG-I1-2')");
  await reserveSequence(db, { project: "zigzag", name: "migration", task_key: "ZIG-I1-1", value: 35 }, ctx);
  await reserveSequence(db, { project: "zigzag", name: "migration", task_key: "ZIG-I1-2", value: 34 }, ctx);
  await raw.query("insert into env_states (project_id, env, commit, branch, migrations, migrations_applied, by) values ($1, 'prod', $2, 'main', '{0033_x,0034_push_subscriptions}', 34, $3)", [p.id, MAIN, JSON.stringify(ctx.actor)]);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

describe("settings.release", () => {
  test("no settings.release, no release step", async () => {
    const p = await project();
    assert.equal(await releasePlan(db, p), null);
    const { fetch } = fakeFetch();
    await pollGithubProject(db, p, deps(fetch));
    assert.equal((await inbox(db, await project())).items.filter((i) => i.kind === "release").length, 0);
  });

  test("set_project validates the triple", async () => {
    const p = await project();
    await assert.rejects(setProject(db, { project: "zigzag", version: p.version, settings: { release: { from: "main", into: "main", env: "prod" } } }, ctx), /INVALID_FILTER/);
    await assert.rejects(setProject(db, { project: "zigzag", version: p.version, settings: { release: { from: "sandbox", into: "main" } } }, ctx), /INVALID_FILTER/);
    await setProject(db, { project: "zigzag", version: p.version, settings: { release: { from: "sandbox", into: "main", env: "prod" } } }, ctx);
    assert.deepEqual((await project()).settings.release, { from: "sandbox", into: "main", env: "prod" });
  });
});

describe("the release step", () => {
  test("the plan: heads, ahead from the compare, merged tickets, their migrations, before-steps, open checks, the command", async () => {
    const { fetch, calls } = fakeFetch();
    await pollGithubProject(db, await project(), deps(fetch));
    assert.equal(calls.filter((c) => c.includes("/compare/")).length, 1);
    const plan = (await releasePlan(db, await project()))!;
    assert.deepEqual(plan.from, { branch: "sandbox", head_sha: SANDBOX });
    assert.deepEqual(plan.into, { branch: "main", head_sha: MAIN });
    assert.equal(plan.ahead, 3);
    assert.equal(plan.shipped, false);
    assert.deepEqual(plan.tickets.map((t) => [t.key, t.status]), [["ZIG-I1-1", "Merged"], ["ZIG-I1-2", "Merged"]]);
    assert.deepEqual(plan.migrations, ["0035"], "0034 already runs in prod");
    assert.deepEqual(plan.before.map((b) => b.key), ["ZIG-02"]);
    assert.equal(plan.open_checks, 2);
    assert.equal(plan.command, "git fetch origin && git checkout main && git merge --ff-only origin/sandbox && git push origin main");

    // The same heads again: no new compare.
    await pollGithubProject(db, await project(), deps(fetch));
    assert.equal(calls.filter((c) => c.includes("/compare/")).length, 1, "cached by the pair of heads");
  });

  test("one release item in pasos; get_resume.status and the audit point at it", async () => {
    const p = await project();
    const box = await inbox(db, p);
    const rel = box.items.filter((i) => i.kind === "release");
    assert.equal(rel.length, 1);
    assert.equal(rel[0]!.group, "pasos");
    assert.equal(rel[0]!.why, "2 tickets listos para prod");
    assert.equal(rel[0]!.title, "sandbox → main");
    assert.equal((rel[0]!.target as Json).ahead, 3);
    assert.ok(box.count >= 2, "the release and the VAPID step count");
    const d = await resumeDigest(db, p);
    assert.equal(d.status.release?.tickets.length, 2);
    // The initiative's branch merged into sandbox; prod lags: ENV_DRIFT names the release step.
    await raw.query("update branches set merged_at = now(), head_sha = 'abcdef1234567' where name = 'jl/android'");
    const drift = (await auditProject(db, p)).find((f) => f.code === "ENV_DRIFT");
    assert.match(drift!.detail, /release step sandbox → main/);
    assert.ok(!(await auditProject(db, p)).some((f) => f.code === "BRANCH_MERGED_NOT_DELETED" && f.detail.startsWith("sandbox")));
  });

  test("Jorge ships it by hand: within one poll the item is gone and release.shipped is written", async () => {
    heads = { sandbox: SANDBOX, main: SANDBOX };
    const { fetch } = fakeFetch();
    await pollGithubProject(db, await project(), deps(fetch));
    const p = await project();
    assert.equal((await inbox(db, p)).items.filter((i) => i.kind === "release").length, 0);
    const plan = (await releasePlan(db, p))!;
    assert.equal(plan.shipped, true);
    assert.equal(plan.ahead, 0);
    const ev = (await listEvents(db, p.id, { types: ["release.shipped"] })).events;
    assert.equal(ev.length, 1);
    assert.deepEqual(ev[0]!.payload.tickets, ["ZIG-I1-1", "ZIG-I1-2"]);
    assert.equal((ev[0]!.payload.from as Json).head_sha, SANDBOX);
    // A second tick writes nothing more.
    await pollGithubProject(db, p, deps(fetch));
    assert.equal((await listEvents(db, p.id, { types: ["release.shipped"] })).events.length, 1);
  });

  test("a human action tagged before_release joins the before-steps", async () => {
    heads = { sandbox: "5ccccccc33333333333333333333333333333333", main: SANDBOX };
    const { fetch } = fakeFetch();
    await pollGithubProject(db, await project(), deps(fetch));
    const p = await project();
    const t = (await findTask(db, p.id, "ZIG-01"))!;
    await setTask(db, { project: "zigzag", key: "ZIG-01", blocked_by: [{ human_action: { text: "Snapshot de Neon", before_release: true } }], version: t.version }, ctx);
    const plan = (await releasePlan(db, p))!;
    assert.deepEqual(plan.before.map((b) => b.text).sort(), ["Poner las variables VAPID en Vercel Production antes de mergear sandbox → main", "Snapshot de Neon"]);
  });
});

describe("no GitHub data (PLA-03)", () => {
  test("no token or a failed compare leaves ahead null and says 'sin datos de GitHub', never nothing to ship", async () => {
    // New heads the poller has not compared yet, and a poll with no token: nothing to compare with.
    heads = { sandbox: "5ddddddd44444444444444444444444444444444", main: SANDBOX };
    await raw.query("update branches set head_sha = $1 where name = 'sandbox' and project_id = (select id from projects where slug = 'zigzag')", [heads.sandbox]);
    await pollGithubProject(db, await project(), { fetch: fakeFetch().fetch, env: { PLANIA_GITHUB_TOKEN_FILE: "/nonexistent/plania-test-no-token" } });
    let p = await project();
    let plan = (await releasePlan(db, p))!;
    assert.equal(plan.ahead, null);
    assert.equal(plan.shipped, false);
    assert.ok(plan.tickets.length > 0);
    const item = (await inbox(db, p)).items.find((i) => i.kind === "release");
    assert.ok(item, "the step still shows when GitHub data is missing");
    assert.match(item!.why, /sin datos de GitHub/);

    await setProject(db, { project: "zigzag", version: p.version, settings: { ...p.settings, release: { ...p.settings.release!, mode: "merge" } } }, ctx);
    p = await project();
    plan = (await releasePlan(db, p))!;
    assert.equal(plan.ship.reason, "no_github_data");

    // A token but a failed compare: still unknown.
    const failing = async (url: string) => {
      if (url.includes("/compare/")) return { status: 500, headers: { get: () => null }, json: async () => ({}) };
      return fakeFetch().fetch(url);
    };
    await assert.rejects(pollGithubProject(db, p, deps(failing as ReturnType<typeof fakeFetch>["fetch"])), /GitHub 500/);
    plan = (await releasePlan(db, await project()))!;
    assert.equal(plan.ahead, null);
    assert.equal(plan.ship.reason, "no_github_data");

    // A working compare puts the number back: N ahead, and the reason is no longer the unknown one.
    await pollGithubProject(db, await project(), deps(fakeFetch().fetch));
    plan = (await releasePlan(db, await project()))!;
    assert.equal(plan.ahead, 3);
    assert.notEqual(plan.ship.reason, "no_github_data");
    assert.doesNotMatch((await inbox(db, await project())).items.find((i) => i.kind === "release")!.why, /sin datos/);
  });
});
