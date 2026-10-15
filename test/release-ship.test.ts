// 2.13 (PLA-I6-2): Jorge ships the release from the screen. settings.release.mode "merge", the Lanzar
// gate in the plan, POST /api/projects/:slug/release/ship (cookie only, Bearer refused), a PR from →
// into merged with gh pr merge --merge through a stubbed gh: no real gh runs against any repo here.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject, findTask, listEvents } = await import("../src/mcp/queries.js");
const { pollGithubProject } = await import("../src/jobs/github.js");
const { releasePlan } = await import("../src/mcp/release-plan.js");
const { releaseGh, shipRelease } = await import("../src/mcp/release-ship.js");
const { inbox } = await import("../src/mcp/inbox.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };
const REPO = "Jorg3L3on/zigzag";
const SANDBOX = "5aaaaaa111111111111111111111111111111111";
const MAIN = "0bbbbbb222222222222222222222222222222222";
const MERGE = "7ccccccc33333333333333333333333333333333";
const PATH = "/api/projects/zigzag/release/ship";

let heads: Record<string, string> = { sandbox: SANDBOX, main: MAIN };
const fetch = async (url: string) => {
  const path = url.replace(/^https:\/\/api\.github\.com/, "");
  const ok = (data: unknown) => ({ status: 200, headers: { get: () => null }, json: async () => data });
  if (path.startsWith(`/repos/${REPO}/pulls?`)) return ok([]);
  if (path.startsWith(`/repos/${REPO}/branches`)) return ok(Object.entries(heads).map(([name, sha]) => ({ name, commit: { sha } })));
  if (path.startsWith(`/repos/${REPO}/compare/`)) {
    const [base] = path.slice(`/repos/${REPO}/compare/`.length).split("...");
    if (base === MERGE) return ok({ status: "behind", ahead_by: 0, commits: [] }); // main now contains sandbox
    if (base!.startsWith("6")) return ok({ status: "diverged", ahead_by: 1, commits: [] });
    return ok({ status: "ahead", ahead_by: 2, commits: [{ sha: "c1c1c1c1" }, { sha: SANDBOX }] });
  }
  return { status: 404, headers: { get: () => null }, json: async () => ({}) };
};
const poll = async () => pollGithubProject(db, await project(), { fetch, env: { GITHUB_TOKEN: "ghp_test" } });
const project = () => findProject(db, "zigzag");

// The gh stub: every call is recorded; `open` is an open PR sandbox → main gh pr list returns.
let calls: string[][] = [];
let open: { number: number; url: string } | null = null;
let failOn: string | null = null;
function stubGh() {
  releaseGh.run = async (args) => {
    calls.push(args);
    const [, verb] = args;
    if (verb === failOn) return { ok: false, stdout: "", stderr: `GraphQL: ${verb} refused` };
    if (verb === "list") return { ok: true, stdout: JSON.stringify(open ? [open] : []), stderr: "" };
    if (verb === "create") return { ok: true, stdout: `https://github.com/${REPO}/pull/700\n`, stderr: "" };
    if (verb === "view") return { ok: true, stdout: JSON.stringify({ mergeCommit: { oid: MERGE }, url: `https://github.com/${REPO}/pull/${open?.number ?? 700}` }), stderr: "" };
    return { ok: true, stdout: "", stderr: "" };
  };
}

function ship(headers: Record<string, string> = {}) {
  return app.request(PATH, { method: "POST", headers: { Cookie: `${SESSION_COOKIE}=${createSession()}`, ...headers } });
}

async function merged(key: string, number: number) {
  const p = await project();
  const t = (await findTask(db, p.id, key))!;
  await raw.query("update tasks set status = 'Merged', pr_url = $2 where id = $1", [t.id, `https://github.com/${REPO}/pull/${number}`]);
  await raw.query(
    "insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_sha, head_branch, base_branch, merged_at, merge_sha) values ($1, $2, $3, $4, $5, $6, 'merged', $7, $8, 'sandbox', now(), $7)",
    [p.id, REPO, number, `https://github.com/${REPO}/pull/${number}`, key, t.id, `${number}`.padEnd(40, "e"), `jl/${key.toLowerCase()}`],
  );
}

const setRelease = async (release: Json) => {
  const p = await project();
  await setProject(db, { project: "zigzag", version: p.version, settings: { release } }, ctx);
};

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  const p = await project();
  await setProject(db, { project: "zigzag", version: p.version, settings: { github: { repo: REPO }, release_target: "prod", release: { from: "sandbox", into: "main", env: "prod" } } }, ctx);
  await createTask(db, { project: "zigzag", kind: "initiative", title: "Android", scope: "PRD", integration_branch: "jl/android" }, ctx); // ZIG-I1
  await createTask(db, { project: "zigzag", title: "Badge", scope: "s", checks: ["c1"], parent_key: "ZIG-I1", phase: 1, status: "Ready" }, ctx); // ZIG-I1-1
  await createTask(db, { project: "zigzag", title: "Actions", scope: "s", checks: ["c"], parent_key: "ZIG-I1", phase: 2, status: "Ready", blocked_by: [{ human_action: { text: "Poner VAPID en prod", before_release: true } }] }, ctx); // ZIG-I1-2
  await merged("ZIG-I1-1", 600);
  await merged("ZIG-I1-2", 601);
  await poll();
});

beforeEach(() => {
  calls = [];
  open = null;
  failOn = null;
  stubGh();
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

describe("settings.release.mode", () => {
  test("command by default: the plan shows the command and Lanzar is off", async () => {
    const plan = (await releasePlan(db, await project()))!;
    assert.equal(plan.mode, "command");
    assert.deepEqual(plan.ship, { ready: false, reason: "mode_command" });
    const res = await ship();
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "RELEASE_NOT_READY", reason: "mode_command", before: 1, open_checks: 2 });
    assert.equal(calls.length, 0);
  });

  test("set_project takes mode merge and refuses anything else", async () => {
    await assert.rejects(setRelease({ from: "sandbox", into: "main", env: "prod", mode: "squash" }), /INVALID_FILTER/);
    await setRelease({ from: "sandbox", into: "main", env: "prod", mode: "merge" });
    assert.equal((await project()).settings.release?.mode, "merge");
  });
});

describe("the Lanzar gate", () => {
  test("off while a before-step is open, then while a check is open", async () => {
    assert.equal((await releasePlan(db, await project()))!.ship.reason, "before_steps");
    await raw.query("update blockers set satisfied_at = now() where type = 'human_action'");
    assert.equal((await releasePlan(db, await project()))!.ship.reason, "open_checks");
    const res = await ship();
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as Json).reason, "open_checks");
    await raw.query("update checks set done = true where task_id in (select id from tasks where key in ('ZIG-I1-1', 'ZIG-I1-2'))");
    assert.deepEqual((await releasePlan(db, await project()))!.ship, { ready: true, reason: null });
  });

  test("any Bearer is refused with 403, even next to the cookie, and only Jorge's ctx may ship", async () => {
    for (const auth of [`Bearer ${TEST_BEARER}`, "Bearer whatever", "bearer x"]) {
      const res = await ship({ Authorization: auth });
      assert.equal(res.status, 403);
      assert.equal(((await res.json()) as Json).error, "HUMAN_ONLY");
    }
    assert.equal((await app.request(PATH, { method: "POST", headers: { Authorization: `Bearer ${TEST_BEARER}` } })).status, 401, "no cookie");
    await assert.rejects(shipRelease(db, "zigzag", ctx), /HUMAN_ONLY/);
    assert.equal(calls.length, 0, "gh never ran");
  });
});

describe("shipping", () => {
  test("a gh failure records nothing and says which step", async () => {
    failOn = "merge";
    const res = await ship();
    assert.equal(res.status, 409);
    const body = (await res.json()) as Json;
    assert.equal(body.error, "RELEASE_MERGE_FAILED");
    assert.equal(body.step, "merge");
    assert.match(body.output, /merge refused/);
    const p = await project();
    assert.equal((await listEvents(db, p.id, { types: ["release.merged"] })).events.length, 0);
    assert.equal((await releasePlan(db, p))!.ship.ready, true);
  });

  test("an open PR sandbox → main is reused, retitled and merged with a merge commit at the plan's head", async () => {
    open = { number: 699, url: `https://github.com/${REPO}/pull/699` };
    const res = await ship();
    assert.equal(res.status, 200);
    const out = (await res.json()) as Json;
    assert.equal(out.merge_sha, MERGE);
    assert.deepEqual(out.pr, { number: 699, url: `https://github.com/${REPO}/pull/699` });
    assert.deepEqual(out.tickets, ["ZIG-I1-1", "ZIG-I1-2"]);
    const verbs = calls.map((c) => c[1]);
    assert.deepEqual(verbs, ["list", "edit", "merge", "view"], "no create when one is open");
    const edit = calls.find((c) => c[1] === "edit")!;
    assert.equal(edit[edit.indexOf("--title") + 1], "Release: ZIG-I1-1, ZIG-I1-2");
    assert.match(edit[edit.indexOf("--body") + 1]!, /- ZIG-I1-1 Badge \(https:\/\/github.com\/Jorg3L3on\/zigzag\/pull\/600\)/);
    const merge = calls.find((c) => c[1] === "merge")!;
    assert.deepEqual(merge, ["pr", "merge", "699", "--repo", REPO, "--merge", "--match-head-commit", SANDBOX]);
    assert.ok(!calls.flat().some((a) => a === "--squash" || a === "--rebase" || a === "--delete-branch" || a === "--admin"));
  });

  test("release.merged is written as Jorge; the step shows merged and Lanzar is off", async () => {
    const p = await project();
    const ev = (await listEvents(db, p.id, { types: ["release.merged"] })).events as Json[];
    assert.equal(ev.length, 1);
    assert.equal(ev[0]!.actor.agent, "jorge");
    assert.equal(ev[0]!.payload.merge_sha, MERGE);
    assert.equal(ev[0]!.payload.from.head_sha, SANDBOX);
    assert.match(ev[0]!.summary, /sandbox → main fusionado por jorge \(2 tickets, 7cccccc\)/);
    const plan = (await releasePlan(db, p))!;
    assert.deepEqual(plan.merged, { sha: MERGE, pr_url: `https://github.com/${REPO}/pull/699`, at: plan.merged!.at });
    assert.deepEqual(plan.ship, { ready: false, reason: "merged" });
    assert.equal((await ship()).status, 409, "a second click does not merge again");
  });

  test("without an open PR one is created; the poller then sees main contain sandbox and the step goes", async () => {
    // A new sandbox head (another release) makes the step shippable again.
    await raw.query("delete from events where type = 'release.merged'");
    const res = await ship();
    assert.equal(res.status, 200);
    assert.deepEqual(calls.map((c) => c[1]), ["list", "create", "merge", "view"]);
    const create = calls.find((c) => c[1] === "create")!;
    assert.deepEqual(create.slice(0, 8), ["pr", "create", "--repo", REPO, "--base", "main", "--head", "sandbox"]);
    assert.equal(((await res.json()) as Json).pr.number, 700);

    heads = { sandbox: SANDBOX, main: MERGE };
    await poll();
    const p = await project();
    assert.equal((await releasePlan(db, p))!.shipped, true);
    assert.equal((await inbox(db, p)).items.filter((i) => i.kind === "release").length, 0);
    assert.equal((await listEvents(db, p.id, { types: ["release.shipped"] })).events.length, 1);
  });
});
