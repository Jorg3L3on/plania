// PLA-I41-7: the GitHub poller keeps the release compare's behind_by and status, so the Morning brief
// facts pack says "diverged" (with ahead and behind) when into has commits from lacks, e.g. sandbox
// 44 behind main. A recorded compare response, a counting fake fetch, and the throwaway test store only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const { pollGithubProject } = await import("../src/jobs/github.js");
const { releaseCompareOf } = await import("../src/mcp/release-plan.js");
const { buildFacts } = await import("../src/brief/facts.js");

const REPO = "Jorg3L3on/zigzag";
const SANDBOX = "5aaaaaa111111111111111111111111111111111";
const MAIN = "0bbbbbb222222222222222222222222222222222";
const recorded = JSON.parse(readFileSync(new URL("./fixtures/github/compare-diverged.json", import.meta.url), "utf8"));
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };

let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let heads: Record<string, string> = { sandbox: SANDBOX, main: MAIN };
let compare: Record<string, unknown> = recorded;
let requests: string[] = [];

const fetch = async (url: string) => {
  const path = url.replace(/^https:\/\/api\.github\.com/, "");
  requests.push(path);
  const ok = (data: unknown) => ({ status: 200, headers: { get: () => null }, json: async () => data });
  if (path.startsWith(`/repos/${REPO}/pulls?`)) return ok([]);
  if (path.startsWith(`/repos/${REPO}/branches`)) return ok(Object.entries(heads).map(([name, sha]) => ({ name, commit: { sha } })));
  if (path.startsWith(`/repos/${REPO}/compare/`)) return ok(compare);
  return { status: 404, headers: { get: () => null }, json: async () => ({}) };
};
const project = () => findProject(db, "zigzag");
const poll = async () => pollGithubProject(db, await project(), { fetch, env: { GITHUB_TOKEN: "ghp_test" } });
const compares = () => requests.filter((r) => r.startsWith(`/repos/${REPO}/compare/`));
const facts = async () => (await buildFacts(db, { from: new Date(Date.now() - 86_400_000), to: new Date() })).projects.find((p) => p.slug === "zigzag")!;

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  const p = await project();
  await setProject(db, { project: "zigzag", version: p.version, settings: { github: { repo: REPO }, release_target: "prod", release: { from: "sandbox", into: "main", env: "prod" } } }, ctx);
});

after(async () => {
  await closeDb?.();
  await store?.end();
});

test("the poller stores behind_by and status from the recorded release compare", async () => {
  requests = [];
  await poll();
  const c = (await releaseCompareOf(db, (await project()).id))!;
  assert.equal(c.key, `${SANDBOX}...${MAIN}`);
  assert.equal(c.status, "diverged");
  assert.equal(c.behind_by, 44);
  assert.equal(c.ahead, 3);
  assert.equal(c.contains, false);
  assert.deepEqual(c.commits, ["a1a1a1a", "b2b2b2b", "5aaaaaa"]);
});

test("no extra GitHub request: one compare of into...from per new pair of heads, none when they stay", async () => {
  // requests still holds the first tick's calls: exactly one compare, into...from.
  assert.deepEqual(compares(), [`/repos/${REPO}/compare/${MAIN}...${SANDBOX}`]);

  requests = [];
  await poll();
  assert.equal(compares().length, 0, "unchanged heads reuse the cache");
  assert.ok(requests.every((r) => !r.includes("behind")), "behind_by needs no request of its own");
});

test("buildFacts reports diverged with ahead and behind counts when both are above 0", async () => {
  const r = (await facts()).release!;
  assert.equal(r.state, "diverged");
  assert.equal(r.ahead, 3);
  assert.equal(r.behind, 44);
  assert.equal(r.fast_forward, false);
  assert.deepEqual([r.from, r.into, r.from_head, r.into_head], ["sandbox", "main", "5aaaaaa", "0bbbbbb"]);
});

test("buildFacts: ahead and behind both above 0 is diverged even if the cached status says otherwise", async () => {
  const p = await project();
  const cached = (await releaseCompareOf(db, p.id))!;
  await store.fix(async (uow) => {
    const at = { projectId: p.id, source: "github" };
    const row = (await uow.get("pollState", at))!;
    await uow.update("pollState", at, { cursor: { ...row.cursor, release: { ...cached, status: "ahead" } } });
  });
  const r = (await facts()).release!;
  assert.equal(r.state, "diverged");
  assert.deepEqual([r.ahead, r.behind], [3, 44]);
});

test("a plain ahead compare (behind_by 0) stays ahead with a fast-forward", async () => {
  heads = { sandbox: "5eeeeee555555555555555555555555555555555", main: MAIN };
  compare = { ...recorded, status: "ahead", ahead_by: 2, behind_by: 0, commits: recorded.commits.slice(0, 2) };
  requests = [];
  await poll();
  assert.equal(compares().length, 1, "new heads: one compare");
  const c = (await releaseCompareOf(db, (await project()).id))!;
  assert.deepEqual([c.status, c.behind_by, c.ahead], ["ahead", 0, 2]);
  const r = (await facts()).release!;
  assert.equal(r.state, "ahead");
  assert.deepEqual([r.ahead, r.behind, r.fast_forward], [2, 0, true]);
});
