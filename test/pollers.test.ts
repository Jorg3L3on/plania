// The GitHub and Vercel pollers (R-21, R-12, R-20) against recorded responses: links, CI results,
// Merged, deploys with a source, Released; and a repeated tick adds nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask, claim, setTask } = await import("../src/mcp/writes.js");
const { addResult } = await import("../src/mcp/evidence.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject, findTask, listEvents } = await import("../src/mcp/queries.js");
const { auditProject } = await import("../src/mcp/audit.js");
const { mergeLateReviews, pollGithubProject } = await import("../src/jobs/github.js");
const { pollVercelProject } = await import("../src/jobs/vercel.js");

type Json = Record<string, any>;
let store: TestStore;
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

// A fetch that answers from fixtures and records what was asked.
function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const auths: string[] = [];
  const f = async (url: string, init?: { headers?: Record<string, string> }) => {
    const path = url.replace(/^https:\/\/api\.(github|vercel)\.com/, "");
    calls.push(path);
    auths.push(init?.headers?.Authorization ?? "");
    const hit = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
    if (!hit) return { status: 404, headers: { get: () => null }, json: async () => ({}) };
    return { status: 200, headers: { get: (h: string) => (h === "etag" ? `W/"${hit[0].length}"` : null) }, json: async () => hit[1] };
  };
  return { fetch: f, calls, auths };
}

async function status(key: string): Promise<string> {
  return (await store.get("tasks", { key }))!.status;
}

before(async () => {
  store = await resetTestStore();
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
  await store?.end();
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
      const rows = (await store.find("results", { kind: "ci" })).map((r) => ({ verdict: r.verdict, commit: r.commit, url: r.url }));
      assert.deepEqual(rows, [{ verdict: "fail", commit: "aaaaaaa111111111111111111111111111111111", url: "https://github.com/Jorg3L3on/filmia/actions/runs/1" }]);
      const prRows = await store.find("pullRequests", {}, { orderBy: [{ column: "number" }] });
      const prs = prRows.map((r) => ({ number: r.number, state: r.state, ci_state: r.ciState, linked: r.taskId !== null }));
      assert.deepEqual(prs, [{ number: 129, state: "merged", ci_state: null, linked: false }, { number: 130, state: "open", ci_state: "failure", linked: true }]);
      // 2.11 (PLA-02): the open PR's merge_commit_sha is GitHub's test merge; it is not kept.
      const shas = (await store.find("pullRequests", {}, { orderBy: [{ column: "number" }] })).map((r) => ({ number: r.number, merge_sha: r.mergeSha }));
      assert.deepEqual(shas, [{ number: 129, merge_sha: "ddddddd444444444444444444444444444444444" }, { number: 130, merge_sha: null }]);
      assert.ok(calls.some((c) => c.includes("/pulls?")));

      // The same tick again: nothing new.
      const before = await store.count("events");
      await pollGithubProject(db, p, { fetch, env: { GITHUB_TOKEN: "ghp_test" } });
      assert.equal(await store.count("events"), before);
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
      await store.fix((uow) => uow.update("branches", { name: "jl/catalog-split" }, { headSha: "bbbbbbb222222222222222222222222222222222" }));
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
      assert.equal((await store.get("pullRequests", { number: 130 }))!.mergeSha, "ccccccc333333333333333333333333333333333");
      const rows = (await store.find("branches", { name: "jl/catalog-split" })).map((r) => ({ head_sha: r.headSha, merged: r.mergedAt !== null, deleted: r.deletedAt !== null }));
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
      await store.fix((uow) =>
        uow.insert("pullRequests", { projectId: p.id, repo: "Jorg3L3on/filmia", number: 131, url: "https://github.com/Jorg3L3on/filmia/pull/131", title: "Ratings", state: "open", headSha: "abcabca000000000000000000000000000000000", headBranch: "jl/ratings", baseBranch: "main", mergeSha: "f8a4e19000" }),
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
  test("with no env var and no token file it names the file and calls nothing; a file token polls without gh", async () => {
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "filmia");
      const { fetch, calls, auths } = fakeFetch({ "/repos/Jorg3L3on/filmia/pulls?": [], "/repos/Jorg3L3on/filmia/branches": [] });
      let ghRuns = 0;
      const ghRun = async () => {
        ghRuns++;
        return { ok: false as const, reason: "missing" as const, stdout: "", stderr: "" };
      };
      await pollGithubProject(db, p, { fetch, env: {}, ghRun, tokenFile: () => ({ token: null, modeNote: null }) });
      const errors = async () => (await store.find("pollState", { source: "github" })).map((r) => ({ error: r.error }));
      let rows = await errors();
      assert.equal(rows[0]!.error, "no token: GITHUB_TOKEN unset, ~/.config/plania/github-token missing or empty");
      assert.equal(calls.length, 0, "nothing asked of GitHub without a token");
      assert.equal(ghRuns, 0, "gh is not spawned without a token");
      const s = await pollGithubProject(db, p, { fetch, env: {}, ghRun, tokenFile: () => ({ token: "  ghp_test  \n", modeNote: null }) });
      assert.equal(s.prs, 0);
      assert.ok(calls.some((c) => c.startsWith("/repos/Jorg3L3on/filmia/pulls")), "polled with the file token");
      assert.equal(auths[0], "Bearer ghp_test");
      assert.equal(ghRuns, 0, "a token file does not spawn gh");
      rows = await errors();
      assert.equal(rows[0]!.error, null);
      assert.doesNotMatch(JSON.stringify(rows), /ghp_/);
    } finally {
      await close();
    }
  });
});

describe("vercel", () => {
  test("READY production deployments become sourced env records, oldest first; the merge commit deployed moves Merged to Released, and a released ticket with its checks closed to Done (PLA-I56-1)", async () => {
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "filmia");
      const { fetch } = fakeFetch({ "/v6/deployments?": fixture("vercel/deployments.json") });
      const s = await pollVercelProject(db, p, { fetch, env: { VERCEL_TOKEN: "vc_test" } });
      assert.equal(s.deployments, 3);
      assert.equal(s.released, 2, "dpl_A deployed the merge commit of #130, both its tickets");
      assert.equal(s.closed, 2, "both had every check closed");
      assert.equal(await status("FIL-I1-1"), "Done");
      assert.equal(await status("FIL-I1-2"), "Done", "the sibling finds its PR by pr_url");
      const moves = (await listEvents(db, p.id, { key: "FIL-I1-1", types: ["task.status"] })).events.slice(-2).map((e) => [e.payload.from, e.payload.to]);
      assert.deepEqual(moves, [["Merged", "Released"], ["Released", "Done"]]);
      assert.equal(await status("FIL-I1-3"), "Merged", "#131 is not merged, so it has no merge commit to ship");
      const envs = await store.find("envStates", {}, { orderBy: [{ column: "env" }] });
      const rows = envs.map((r) => ({ env: r.env, commit: r.commit, dpl: r.deploySource?.deployment_id ?? null, deployed: r.deployedAt !== null }));
      assert.deepEqual(rows, [
        { env: "preview", commit: "aaaaaaa111111111111111111111111111111111", dpl: "dpl_P", deployed: true },
        { env: "prod", commit: "fffffff777777777777777777777777777777777", dpl: "dpl_B", deployed: true },
      ]);
      const again = await pollVercelProject(db, p, { fetch, env: { VERCEL_TOKEN: "vc_test" } });
      assert.equal(again.deployments, 0, "the cursor skips what was seen");
      const poll = (await store.find("pollState", {}, { orderBy: [{ column: "source" }] })).map((r) => ({ source: r.source, error: r.error }));
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
      const rows = await store.find("pollState", { source: "vercel" });
      assert.match(rows[0]!.error!, /VERCEL_TOKEN/);
    } finally {
      await close();
    }
  });
});

describe("late review (PLA-07)", () => {
  test("a ticket that reaches In review after its PR was stored as merged moves to Merged; a second tick changes nothing", async () => {
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "workia");
      const url = "https://github.com/Jorg3L3on/workia/pull/77";
      // What an earlier tick stored: #77 merged while the ticket was not in review yet.
      await store.fix((uow) =>
        uow.insert("pullRequests", {
          projectId: p.id,
          repo: "Jorg3L3on/workia",
          number: 77,
          url,
          title: "Late",
          state: "merged",
          headSha: "aaaaaaa111111111111111111111111111111111",
          headBranch: "jl/late",
          baseBranch: "sandbox",
          mergedAt: uow.now,
          mergeSha: "ddddddd444444444444444444444444444444444",
          ghUpdatedAt: uow.now,
        }),
      );
      const late = await createTask(db, { project: "workia", title: "Late", scope: "s", checks: ["c"], status: "Ready" }, ctx);
      await claim(db, { project: "workia", key: late.key }, ctx);
      await addResult(db, { project: "workia", key: late.key, kind: "unit", verdict: "pass", cite: "ok", check_ns: [1] }, ctx);
      const t = (await findTask(db, p.id, late.key))!;
      await setTask(db, { project: "workia", key: late.key, status: "In review", pr_url: url, version: t.version }, ctx);

      assert.equal(await mergeLateReviews(db, p, "Jorg3L3on/workia"), 1);
      assert.equal(await status(late.key), "Merged");
      const ev = (await listEvents(db, p.id, { key: late.key, types: ["task.status"] })).events.at(-1)!;
      assert.equal(ev.actor.agent, "plania");
      assert.deepEqual([ev.payload.from, ev.payload.to], ["In review", "Merged"]);
      assert.equal(await mergeLateReviews(db, p, "Jorg3L3on/workia"), 0, "a second tick changes nothing");
      // The tick runs it with no GitHub change in between.
      assert.match(readFileSync(new URL("../src/jobs/github.ts", import.meta.url), "utf8"), /summary\.merged! \+= await mergeLateReviews\(db, p, cfg\.repo\)/);
    } finally {
      await close();
    }
  });
});

describe("status drift (PLA-03)", () => {
  test("a merged PR linked to a Ready ticket yields one event and one finding across two polls; the token is never stored", async () => {
    const { db, close } = makeDb();
    try {
      let p = await findProject(db, "micasa");
      await setProject(db, { project: "micasa", version: p.version, settings: { ...p.settings, github: { repo: "Jorg3L3on/micasa" } } }, ctx);
      p = await findProject(db, "micasa");
      const ready = await createTask(db, { project: "micasa", title: "Drift", scope: "s", checks: ["c"], status: "Ready" }, ctx);
      const taskId = (await findTask(db, p.id, ready.key))!.id;
      await store.fix((uow) =>
        uow.insert("pullRequests", {
          projectId: p.id,
          repo: "Jorg3L3on/micasa",
          number: 88,
          url: "https://github.com/Jorg3L3on/micasa/pull/88",
          title: "Drift",
          taskId,
          state: "merged",
          headBranch: "jl/drift",
          baseBranch: "sandbox",
          mergedAt: uow.now,
          mergeSha: "eeeeeee555555555555555555555555555555555",
          ghUpdatedAt: uow.now,
        }),
      );
      const SECRET = "ghp_drift_test_token_value_0123456789";
      const deps = () => ({
        fetch: fakeFetch({ "/repos/Jorg3L3on/micasa/pulls?": [], "/repos/Jorg3L3on/micasa/branches": [] }).fetch,
        env: { GITHUB_TOKEN: SECRET },
      });
      const first = await pollGithubProject(db, p, deps());
      const second = await pollGithubProject(db, await findProject(db, "micasa"), deps());
      assert.equal(first.drift, 1);
      assert.equal(second.drift, 1, "still drifting, but said only once");
      assert.equal(await status(ready.key), "Ready", "nothing moves it");
      const ev = (await listEvents(db, p.id, { key: ready.key, types: ["pr.status_drift"] })).events;
      assert.equal(ev.length, 1);
      assert.deepEqual([ev[0]!.payload.number, ev[0]!.payload.status, ev[0]!.actor.agent], [88, "Ready", "plania"]);
      const findings = (await auditProject(db, await findProject(db, "micasa"))).filter((f) => f.code === "PR_MERGED_TICKET_OPEN");
      assert.equal(findings.length, 1);
      assert.equal(findings[0]!.key, ready.key);
      assert.match(findings[0]!.detail, /PR #88 merged .* but the ticket is Ready/);
      const dump = JSON.stringify([
        (await store.find("events", { projectId: p.id })).map((r) => ({ payload: r.payload })),
        (await store.find("pollState", { projectId: p.id })).map((r) => ({ cursor: r.cursor, error: r.error })),
        (await store.find("writeRequests", { projectId: p.id })).map((r) => ({ response: r.response })),
      ]);
      assert.equal(dump.includes(SECRET), false, "the token never lands in the database");
    } finally {
      await close();
    }
  });
});

describe("no CI (PLA-14)", () => {
  test("a head with no check run and no status is none, not pending; a PR stuck at pending is corrected on the next poll; real CI still pends and fails", async () => {
    const { db, close } = makeDb();
    try {
      let p = await findProject(db, "zigzag");
      await setProject(db, { project: "zigzag", version: p.version, settings: { ...p.settings, github: { repo: "Jorg3L3on/zigzag" } } }, ctx);
      p = await findProject(db, "zigzag");
      const NOCI = "bbbbbbb222222222222222222222222222222222";
      const RUNS = "ccccccc333333333333333333333333333333333";
      const STATUS = "fffffff666666666666666666666666666666666";
      const made: string[] = [];
      for (const title of ["Sin CI", "Con checks", "Con status"]) {
        const t = await createTask(db, { project: "zigzag", title, scope: "s", checks: ["c"], status: "Ready" }, ctx);
        await store.fix((uow) => uow.update("tasks", { key: t.key }, { status: "In review" }));
        made.push(t.key);
      }
      // What an earlier poll stored: every PR open, linked, pending, and unchanged on GitHub since.
      const prs = [
        { n: 3, sha: NOCI, key: made[0] },
        { n: 4, sha: RUNS, key: made[1] },
        { n: 5, sha: STATUS, key: made[2] },
      ];
      for (const pr of prs) {
        await store.fix(async (uow) => {
          for (const t of await uow.find("tasks", { key: pr.key })) {
            await uow.insert("pullRequests", {
              projectId: p.id,
              repo: "Jorg3L3on/zigzag",
              number: pr.n,
              url: `https://github.com/Jorg3L3on/zigzag/pull/${pr.n}`,
              title: "pr",
              taskId: t.id,
              state: "open",
              ciState: "pending",
              headSha: pr.sha,
              headBranch: `jl/pr-${pr.n}`,
              baseBranch: "sandbox",
              ghUpdatedAt: new Date("2026-11-10T10:00:00Z"),
            });
          }
        });
      }
      const list = prs.map((pr) => ({
        number: pr.n,
        html_url: `https://github.com/Jorg3L3on/zigzag/pull/${pr.n}`,
        title: "pr",
        state: "open",
        body: "",
        merged_at: null,
        merge_commit_sha: null,
        updated_at: "2026-11-10T10:00:00Z",
        head: { sha: pr.sha, ref: `jl/pr-${pr.n}` },
        base: { ref: "sandbox" },
      }));
      const c = "/repos/Jorg3L3on/zigzag/commits";
      const running = { name: "test", status: "in_progress", conclusion: null, html_url: "https://github.com/Jorg3L3on/zigzag/actions/runs/9", head_sha: RUNS };
      const routes: Record<string, unknown> = {
        "/repos/Jorg3L3on/zigzag/pulls?": list,
        "/repos/Jorg3L3on/zigzag/branches": [],
        // GitHub's answers for a commit with no CI: no check run, and a combined status of pending with total_count 0.
        [`${c}/${NOCI}/check-runs`]: { total_count: 0, check_runs: [] },
        [`${c}/${NOCI}/status`]: { state: "pending", total_count: 0, statuses: [] },
        [`${c}/${RUNS}/check-runs`]: { total_count: 1, check_runs: [running] },
        [`${c}/${RUNS}/status`]: { state: "pending", total_count: 0, statuses: [] },
        [`${c}/${STATUS}/check-runs`]: { total_count: 0, check_runs: [] },
        [`${c}/${STATUS}/status`]: { state: "pending", total_count: 1, statuses: [{ context: "vercel", state: "pending", target_url: "https://vercel.test/1" }] },
      };
      const { fetch } = fakeFetch(routes);
      const deps = { fetch, env: { GITHUB_TOKEN: "ghp_test" } };
      const ci = async () => Object.fromEntries((await store.find("pullRequests", { repo: "Jorg3L3on/zigzag" }, { orderBy: [{ column: "number" }] })).map((r) => [r.number, r.ciState]));
      const ciResults = async () => {
        const keyOf = new Map((await store.find("tasks", { key: made })).map((t) => [t.id, t.key]));
        const results = await store.find("results", { kind: "ci", taskId: [...keyOf.keys()] }, { orderBy: [{ column: "createdAt" }] });
        return results.map((r) => ({ key: keyOf.get(r.taskId), verdict: r.verdict }));
      };

      await pollGithubProject(db, p, deps);
      assert.deepEqual(await ci(), { 3: "none", 4: "pending", 5: "pending" }, "the stuck no-CI PR is corrected; real CI keeps pending");
      assert.deepEqual(await ciResults(), [], "none adds no ci result");
      const none = await pollGithubProject(db, p, deps);
      assert.equal(none.ci, 0);
      assert.deepEqual(await ci(), { 3: "none", 4: "pending", 5: "pending" }, "a second tick changes nothing");

      // Real CI finishes without touching the PR's updated_at: the next poll still hears it.
      routes[`${c}/${RUNS}/check-runs`] = { total_count: 1, check_runs: [{ ...running, status: "completed", conclusion: "failure" }] };
      routes[`${c}/${STATUS}/status`] = { state: "failure", total_count: 1, statuses: [{ context: "vercel", state: "error", target_url: "https://vercel.test/1" }] };
      const red = await pollGithubProject(db, p, deps);
      assert.equal(red.ci, 2);
      assert.deepEqual(await ci(), { 3: "none", 4: "failure", 5: "failure" });
      assert.deepEqual(await ciResults(), [
        { key: made[1], verdict: "fail" },
        { key: made[2], verdict: "fail" },
      ]);
      assert.equal(await status(made[1]!), "Ready", "a red check still sends the ticket back from review");
      assert.equal(await status(made[0]!), "In review", "no CI never sends it back");
    } finally {
      await close();
    }
  });
});
