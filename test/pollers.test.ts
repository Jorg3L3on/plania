// The GitHub and Vercel pollers (R-21, R-12, R-20) against recorded responses: links, CI results,
// Merged, deploys with a source, Released; and a repeated tick adds nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask, claim, setTask } = await import("../src/mcp/writes.js");
const { addResult } = await import("../src/mcp/evidence.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject, findTask, listEvents } = await import("../src/mcp/queries.js");
const { pollGithubProject } = await import("../src/jobs/github.js");
const { pollVercelProject } = await import("../src/jobs/vercel.js");

type Json = Record<string, any>;
let raw: pg.Client;
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

// A fetch that answers from fixtures and records what was asked.
function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const f = async (url: string) => {
    const path = url.replace(/^https:\/\/api\.(github|vercel)\.com/, "");
    calls.push(path);
    const hit = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
    if (!hit) return { status: 404, headers: { get: () => null }, json: async () => ({}) };
    return { status: 200, headers: { get: (h: string) => (h === "etag" ? `W/"${hit[0].length}"` : null) }, json: async () => hit[1] };
  };
  return { fetch: f, calls };
}

async function status(key: string): Promise<string> {
  const { rows } = await raw.query("select status from tasks where key = $1", [key]);
  return rows[0].status;
}

before(async () => {
  raw = await resetTestDb();
  const { db, close } = makeDb();
  try {
    const p = await findProject(db, "filmia");
    await setProject(db, { project: "filmia", version: p.version, settings: { github: { repo: "Jorg3L3on/filmia" }, vercel: { project_id: "prj_1" }, release_target: "prod" } }, ctx);
    await createTask(db, { project: "filmia", kind: "initiative", title: "Catalog split", scope: "PRD", integration_branch: "jl/catalog-split" }, ctx); // FIL-I1
    await createTask(db, { project: "filmia", title: "Additive migration", scope: "s", checks: ["c"], parent_key: "FIL-I1", status: "Ready" }, ctx); // FIL-I1-1
    await claim(db, { project: "filmia", key: "FIL-I1-1" }, ctx);
    await addResult(db, { project: "filmia", key: "FIL-I1-1", kind: "unit", verdict: "pass", cite: "ok", check_ns: [1] }, ctx);
    const t = (await findTask(db, p.id, "FIL-I1-1"))!;
    await setTask(db, { project: "filmia", key: "FIL-I1-1", status: "In review", version: t.version }, ctx);
  } finally {
    await close();
  }
});

after(async () => {
  await raw?.end();
});

describe("github", () => {
  test("links a PR by its Plania: line, records a red check as a ci fail and sends the ticket back to Ready", async () => {
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "filmia");
      const { fetch, calls } = fakeFetch({
        "/repos/Jorg3L3on/filmia/pulls?": fixture("github/pulls.json"),
        "/repos/Jorg3L3on/filmia/commits/aaaaaaa": fixture("github/check-runs-red.json"),
        "/repos/Jorg3L3on/filmia/branches": fixture("github/branches.json"),
      });
      const s = await pollGithubProject(db, p, { fetch, env: { GITHUB_TOKEN: "ghp_test" } });
      assert.equal(s.prs, 2);
      assert.equal(s.linked, 1);
      assert.equal(s.ci, 1);
      const t = (await findTask(db, p.id, "FIL-I1-1"))!;
      assert.equal(t.prUrl, "https://github.com/Jorg3L3on/filmia/pull/130");
      assert.equal(t.status, "Ready", "CI red sends it back from review");
      const types = (await listEvents(db, p.id, { key: "FIL-I1-1" })).events.map((e) => e.type);
      assert.ok(types.includes("pr.ci_failed") && types.includes("result.added"));
      // 2.7: the open PR is announced once; #129 was already merged when first seen, so it says nothing.
      const prEvents = (await listEvents(db, p.id, { types: ["pr.opened", "pr.merged", "pr.closed"] })).events;
      assert.deepEqual(prEvents.map((e) => [e.type, e.payload.number, e.task_key]), [["pr.opened", 130, "FIL-I1-1"]]);
      assert.equal(prEvents[0]!.summary, "PR #130 abierto (FIL-I1-1): Catalog split F1: additive migration");
      const again = await pollGithubProject(db, p, { fetch, env: { GITHUB_TOKEN: "ghp_test" } });
      assert.equal(again.pr_events ?? 0, 0, "a second tick announces nothing");
      assert.equal((await listEvents(db, p.id, { types: ["pr"] })).events.filter((e) => e.type === "pr.opened").length, 1);
      const { rows } = await raw.query("select verdict, commit, url from results where kind = 'ci'");
      assert.deepEqual(rows, [{ verdict: "fail", commit: "aaaaaaa111111111111111111111111111111111", url: "https://github.com/Jorg3L3on/filmia/actions/runs/1" }]);
      const { rows: prs } = await raw.query("select number, state, ci_state, task_id is not null as linked from pull_requests order by number");
      assert.deepEqual(prs, [{ number: 129, state: "merged", ci_state: null, linked: false }, { number: 130, state: "open", ci_state: "failure", linked: true }]);
      // 2.11 (PLA-02): the open PR's merge_commit_sha is GitHub's test merge; it is not kept.
      const { rows: shas } = await raw.query("select number, merge_sha from pull_requests order by number");
      assert.deepEqual(shas, [{ number: 129, merge_sha: "ddddddd444444444444444444444444444444444" }, { number: 130, merge_sha: null }]);
      assert.ok(calls.some((c) => c.includes("/pulls?")));

      // The same tick again: nothing new.
      const before = (await raw.query("select count(*)::int as n from events")).rows[0].n;
      await pollGithubProject(db, p, { fetch, env: { GITHUB_TOKEN: "ghp_test" } });
      assert.equal((await raw.query("select count(*)::int as n from events")).rows[0].n, before);
    } finally {
      await close();
    }
  });

  test("a merged PR moves the In review ticket to Merged by the system; the branch head updates; a known branch gone from GitHub is marked deleted", async () => {
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "filmia");
      // 2.11 (PLA-02): a sibling phase on the same PR, linked by pr_url only.
      await createTask(db, { project: "filmia", title: "Backfill", scope: "s", checks: ["c"], parent_key: "FIL-I1", status: "Ready" }, ctx); // FIL-I1-2
      await claim(db, { project: "filmia", key: "FIL-I1-2" }, ctx);
      await addResult(db, { project: "filmia", key: "FIL-I1-2", kind: "unit", verdict: "pass", cite: "ok", check_ns: [1] }, ctx);
      const sib = (await findTask(db, p.id, "FIL-I1-2"))!;
      await setTask(db, { project: "filmia", key: "FIL-I1-2", status: "In review", pr_url: "https://github.com/Jorg3L3on/filmia/pull/130", version: sib.version }, ctx);
      // The branch moved on (the poller saw the new head); back to review with a fresh pass at it.
      await raw.query("update branches set head_sha = 'bbbbbbb222222222222222222222222222222222' where name = 'jl/catalog-split'");
      await claim(db, { project: "filmia", key: "FIL-I1-1" }, ctx);
      await addResult(db, { project: "filmia", key: "FIL-I1-1", kind: "ci", verdict: "pass", cite: "green", commit: "bbbbbbb222222222222222222222222222222222", branch: "jl/catalog-split" }, ctx);
      const t = (await findTask(db, p.id, "FIL-I1-1"))!;
      await setTask(db, { project: "filmia", key: "FIL-I1-1", status: "In review", version: t.version }, ctx);
      const { fetch } = fakeFetch({
        "/repos/Jorg3L3on/filmia/pulls?": fixture("github/pulls-merged.json"),
        "/repos/Jorg3L3on/filmia/branches": [{ name: "main", commit: { sha: "9999999" } }],
      });
      const s = await pollGithubProject(db, p, { fetch, env: { GITHUB_TOKEN: "ghp_test" }, now: new Date("2026-10-07T21:05:00Z") });
      assert.equal(s.merged, 2, "the linked ticket and the one sharing its pr_url");
      assert.equal(await status("FIL-I1-1"), "Merged");
      assert.equal(await status("FIL-I1-2"), "Merged");
      const merged = (await listEvents(db, p.id, { types: ["pr.merged"] })).events;
      assert.deepEqual(merged.map((e) => [e.payload.number, e.payload.base_branch, e.task_key]), [[130, "sandbox", "FIL-I1-1"]]);
      const ev = (await listEvents(db, p.id, { key: "FIL-I1-1", types: ["task.status"] })).events.at(-1)!;
      assert.equal(ev.actor.agent, "plania");
      assert.deepEqual([ev.payload.from, ev.payload.to], ["In review", "Merged"]);
      assert.equal((await raw.query("select merge_sha from pull_requests where number = 130")).rows[0].merge_sha, "ccccccc333333333333333333333333333333333");
      const { rows } = await raw.query("select head_sha, merged_at is not null as merged, deleted_at is not null as deleted from branches where name = 'jl/catalog-split'");
      assert.deepEqual(rows, [{ head_sha: "bbbbbbb222222222222222222222222222222222", merged: true, deleted: true }]);
      // jl/docs went when its PR (#129) merged in the first tick; jl/catalog-split now.
      assert.deepEqual((await listEvents(db, p.id, { types: ["branch.deleted"] })).events.map((e) => e.payload.branch), ["jl/docs", "jl/catalog-split"]);
    } finally {
      await close();
    }
  });
});

describe("merged gate (PLA-02)", () => {
  test("a stored test-merge sha of an open PR is not demanded; a ci pass on the real merge commit (not the PR head) is accepted", async () => {
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "filmia");
      await createTask(db, { project: "filmia", title: "Ratings", scope: "s", checks: ["c"], parent_key: "FIL-I1", status: "Ready" }, ctx); // FIL-I1-3
      await claim(db, { project: "filmia", key: "FIL-I1-3" }, ctx);
      await addResult(db, { project: "filmia", key: "FIL-I1-3", kind: "unit", verdict: "pass", cite: "ok", check_ns: [1] }, ctx);
      let t = (await findTask(db, p.id, "FIL-I1-3"))!;
      await setTask(db, { project: "filmia", key: "FIL-I1-3", status: "In review", pr_url: "https://github.com/Jorg3L3on/filmia/pull/131", version: t.version }, ctx);
      // A row written before 2.11: open, with GitHub's test-merge sha stored.
      await raw.query(
        "insert into pull_requests (project_id, repo, number, url, title, state, head_sha, head_branch, base_branch, merge_sha) values ($1, 'Jorg3L3on/filmia', 131, 'https://github.com/Jorg3L3on/filmia/pull/131', 'Ratings', 'open', 'abcabca000', 'jl/ratings', 'main', 'f8a4e19000')",
        [p.id],
      );
      await addResult(db, { project: "filmia", key: "FIL-I1-3", kind: "ci", verdict: "pass", cite: "PR head green", commit: "abcabca000" }, ctx);
      t = (await findTask(db, p.id, "FIL-I1-3"))!;
      await assert.rejects(setTask(db, { project: "filmia", key: "FIL-I1-3", status: "Merged", version: t.version }, ctx), (e: Json) => {
        assert.equal(e.code, "EVIDENCE_REQUIRED");
        assert.doesNotMatch(String(e.detail?.hint), /f8a4e19/);
        return true;
      });
      await addResult(db, { project: "filmia", key: "FIL-I1-3", kind: "ci", verdict: "pass", cite: "main green after merge", commit: "1234567890" }, ctx);
      t = (await findTask(db, p.id, "FIL-I1-3"))!;
      await setTask(db, { project: "filmia", key: "FIL-I1-3", status: "Merged", version: t.version }, ctx);
      assert.equal(await status("FIL-I1-3"), "Merged");
    } finally {
      await close();
    }
  });
});

describe("github token", () => {
  test("falls back to the gh CLI's token when the env var is unset, and names both when neither is there", async () => {
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "filmia");
      const { fetch, calls } = fakeFetch({ "/repos/Jorg3L3on/filmia/pulls?": [], "/repos/Jorg3L3on/filmia/branches": [] });
      await pollGithubProject(db, p, { fetch, env: {}, ghToken: async () => null });
      let { rows } = await raw.query("select error from poll_state where source = 'github'");
      assert.equal(rows[0].error, "no token in GITHUB_TOKEN or gh auth token");
      assert.equal(calls.length, 0, "nothing asked of GitHub without a token");
      const s = await pollGithubProject(db, p, { fetch, env: {}, ghToken: async () => "gho_from_keyring" });
      assert.equal(s.prs, 0);
      assert.ok(calls.some((c) => c.startsWith("/repos/Jorg3L3on/filmia/pulls")), "polled with the gh token");
      ({ rows } = await raw.query("select error from poll_state where source = 'github'"));
      assert.equal(rows[0].error, null);
    } finally {
      await close();
    }
  });
});

describe("vercel", () => {
  test("READY production deployments become sourced env records, oldest first; the merge commit deployed moves Merged to Released", async () => {
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "filmia");
      const { fetch } = fakeFetch({ "/v6/deployments?": fixture("vercel/deployments.json") });
      const s = await pollVercelProject(db, p, { fetch, env: { VERCEL_TOKEN: "vc_test" } });
      assert.equal(s.deployments, 3);
      assert.equal(s.released, 2, "dpl_A deployed the merge commit of #130, both its tickets");
      assert.equal(await status("FIL-I1-1"), "Released");
      assert.equal(await status("FIL-I1-2"), "Released", "the sibling finds its PR by pr_url");
      assert.equal(await status("FIL-I1-3"), "Merged", "#131 is not merged, so it has no merge commit to ship");
      const { rows } = await raw.query("select env, commit, deploy_source->>'deployment_id' as dpl, deployed_at is not null as deployed from env_states order by env");
      assert.deepEqual(rows, [
        { env: "preview", commit: "aaaaaaa111111111111111111111111111111111", dpl: "dpl_P", deployed: true },
        { env: "prod", commit: "fffffff777777777777777777777777777777777", dpl: "dpl_B", deployed: true },
      ]);
      const again = await pollVercelProject(db, p, { fetch, env: { VERCEL_TOKEN: "vc_test" } });
      assert.equal(again.deployments, 0, "the cursor skips what was seen");
      const { rows: poll } = await raw.query("select source, error from poll_state order by source");
      assert.deepEqual(poll, [{ source: "github", error: null }, { source: "vercel", error: null }]);
    } finally {
      await close();
    }
  });

  test("without a token the poller records the gap instead of failing", async () => {
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "filmia");
      const { fetch } = fakeFetch({});
      await pollVercelProject(db, p, { fetch, env: {} });
      const { rows } = await raw.query("select error from poll_state where source = 'vercel'");
      assert.match(rows[0].error, /VERCEL_TOKEN/);
    } finally {
      await close();
    }
  });
});
