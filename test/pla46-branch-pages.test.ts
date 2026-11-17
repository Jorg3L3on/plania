// PLA-46: the GitHub poller reads every page of the branch list. With more than 100 branches, main sat on page 2 and
// its stored head never moved; and a partial read never marks a branch deleted.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const { touchBranch } = await import("../src/mcp/branches.js");
const { pollGithubProject } = await import("../src/jobs/github.js");

let store: TestStore;
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };
const REPO = "Jorg3L3on/micasa";
const sha = (c: string) => c.repeat(40);
// Page 1: a hundred feature branches (GitHub sorts by name, so main comes later).
const PAGE1 = Array.from({ length: 100 }, (_, i) => ({ name: `jl/a-${String(i).padStart(3, "0")}`, commit: { sha: sha("1") } }));

function fakeFetch(pages: Record<number, unknown[] | "fail">) {
  const calls: string[] = [];
  const f = async (url: string) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, "");
    calls.push(path);
    const ok = (data: unknown) => ({ status: 200, headers: { get: () => null }, json: async () => data });
    if (path.startsWith(`/repos/${REPO}/pulls?`)) return ok([]);
    const m = /\/branches\?per_page=100&page=(\d+)$/.exec(path);
    if (m) {
      const page = pages[Number(m[1])] ?? [];
      if (page === "fail") return { status: 502, headers: { get: () => null }, json: async () => ({}) };
      return ok(page);
    }
    return { status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
  return { fetch: f, calls };
}

async function head(name: string) {
  const b = await store.get("branches", { projectId: await store.projectId("micasa"), name });
  return b && { head_sha: b.headSha, deleted: b.deletedAt !== null };
}

before(async () => {
  store = await resetTestStore();
  const { db, close } = makeDb();
  try {
    const p = await findProject(db, "micasa");
    await setProject(db, { project: "micasa", version: p.version, settings: { github: { repo: REPO } } }, ctx);
    await store.fix(async (uow) => {
      await touchBranch(uow.sql, p.id, "main", { headSha: sha("0") });
      await touchBranch(uow.sql, p.id, "jl/a-005", { headSha: sha("0") });
      await touchBranch(uow.sql, p.id, "jl/gone", { headSha: sha("9") });
    });
  } finally {
    await close();
  }
});

after(async () => {
  await store?.end();
});

test("a branch past the first hundred gets its new head; a partial read marks nothing deleted", async () => {
  const { db, close } = makeDb();
  try {
    // Page 2 fails: page 1's heads still count, main is unknown, and jl/gone is not marked deleted from half a list.
    let p = await findProject(db, "micasa");
    const failing = fakeFetch({ 1: PAGE1, 2: "fail" });
    await pollGithubProject(db, p, { fetch: failing.fetch, env: { GITHUB_TOKEN: "ghp_test" } });
    assert.deepEqual(await head("jl/a-005"), { head_sha: sha("1"), deleted: false });
    assert.deepEqual(await head("main"), { head_sha: sha("0"), deleted: false });
    assert.deepEqual(await head("jl/gone"), { head_sha: sha("9"), deleted: false }, "nothing deleted from a partial read");

    // Both pages read: main (on page 2) moves; the branch on neither page is gone.
    p = await findProject(db, "micasa");
    const full = fakeFetch({ 1: PAGE1, 2: [{ name: "main", commit: { sha: sha("2") } }, { name: "sandbox", commit: { sha: sha("3") } }] });
    const s = await pollGithubProject(db, p, { fetch: full.fetch, env: { GITHUB_TOKEN: "ghp_test" } });
    assert.deepEqual(await head("main"), { head_sha: sha("2"), deleted: false });
    assert.deepEqual(await head("jl/gone"), { head_sha: sha("9"), deleted: true });
    assert.ok((s.branches ?? 0) >= 1);
    assert.deepEqual(
      full.calls.filter((c) => c.includes("/branches?")),
      [`/repos/${REPO}/branches?per_page=100&page=1`, `/repos/${REPO}/branches?per_page=100&page=2`],
      "stops at the first short page",
    );
  } finally {
    await close();
  }
});
