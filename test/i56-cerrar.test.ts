// PLA-I56-1: shipped work closes itself. A project with no deploy counts "on its release branch" as released;
// a released code ticket with every check closed and no open question moves to Done by the rule; the board read
// says when the owner can close the initiative.
import assert from "node:assert/strict";
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
const { projectEtapas } = await import("../src/api/etapa.js");
const { initiativeState } = await import("../src/mcp/initiative-state.js");

let raw: pg.Client;
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };
const human = { ...ctx, human: true };
const REPO = "Jorg3L3on/micasa";
const sha = (c: string) => c.repeat(40);

const pr = (n: number, key: string, merge: string) => ({
  number: n,
  html_url: `https://github.com/${REPO}/pull/${n}`,
  title: `${key} work`,
  state: "closed",
  body: `Plania: ${key}\n`,
  merged_at: "2026-11-16T20:00:00Z",
  merge_commit_sha: merge,
  updated_at: `2026-11-16T20:0${n}:00Z`,
  head: { sha: sha(String(n)), ref: `jl/${key.toLowerCase()}` },
  base: { ref: "main" },
});

// A fetch that answers from a table of path prefixes; the compare answers say whether the head contains the merge.
function fakeFetch(routes: Record<string, unknown>) {
  return async (url: string) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, "");
    const hit = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
    if (!hit) return { status: 404, headers: { get: () => null }, json: async () => ({}) };
    return { status: 200, headers: { get: () => null }, json: async () => hit[1] };
  };
}

async function status(key: string): Promise<string> {
  return (await raw.query("select status from tasks where key = $1", [key])).rows[0].status;
}

async function toReview(db: Parameters<typeof createTask>[0], key: string, n: number) {
  const p = await findProject(db, "micasa");
  await claim(db, { project: "micasa", key }, ctx);
  await addResult(db, { project: "micasa", key, kind: "unit", verdict: "pass", cite: "ok", check_ns: [1] }, ctx);
  const t = (await findTask(db, p.id, key))!;
  await setTask(db, { project: "micasa", key, status: "In review", pr_url: `https://github.com/${REPO}/pull/${n}`, version: t.version }, ctx);
}

before(async () => {
  raw = await resetTestDb();
  const { db, close } = makeDb();
  try {
    const p = await findProject(db, "micasa");
    await setProject(db, { project: "micasa", version: p.version, settings: { github: { repo: REPO } } }, ctx);
    await createTask(db, { project: "micasa", kind: "initiative", title: "Contacto", scope: "PRD" }, ctx); // MIC-I1
    for (const title of ["Enlaces", "Excel", "Aviso"]) await createTask(db, { project: "micasa", title, scope: "s", checks: ["c"], parent_key: "MIC-I1", status: "Ready" }, ctx);
    await toReview(db, "MIC-I1-1", 5);
    await toReview(db, "MIC-I1-2", 6);
    await toReview(db, "MIC-I1-3", 7);
  } finally {
    await close();
  }
});

after(async () => {
  await raw?.end();
});

describe("release by branch (no deploy)", () => {
  test("a merged ticket stays Merged while main lacks the merge, then reaches Released and Done once main contains it", async () => {
    const { db, close } = makeDb();
    try {
      let p = await findProject(db, "micasa");
      const pulls = [pr(5, "MIC-I1-1", sha("a"))];
      const s1 = await pollGithubProject(db, p, {
        fetch: fakeFetch({ [`/repos/${REPO}/pulls?`]: pulls, [`/repos/${REPO}/branches`]: [{ name: "main", commit: { sha: sha("1") } }], [`/repos/${REPO}/compare/`]: { status: "behind" } }),
        env: { GITHUB_TOKEN: "ghp_test" },
      });
      assert.equal(s1.merged, 1);
      assert.equal(s1.released, 0);
      assert.equal(await status("MIC-I1-1"), "Merged", "main does not contain the merge yet");
      const { rows } = await raw.query("select b.name from branches b join projects p on p.id = b.project_id where p.slug = 'micasa' and b.name = 'main'");
      assert.equal(rows.length, 1, "the poller tracks the release branch");

      p = await findProject(db, "micasa");
      const s2 = await pollGithubProject(db, p, {
        fetch: fakeFetch({ [`/repos/${REPO}/pulls?`]: pulls, [`/repos/${REPO}/branches`]: [{ name: "main", commit: { sha: sha("2") } }], [`/repos/${REPO}/compare/`]: { status: "ahead" } }),
        env: { GITHUB_TOKEN: "ghp_test" },
      });
      assert.equal(s2.released, 1);
      assert.equal(s2.closed, 1);
      assert.equal(await status("MIC-I1-1"), "Done");
      const moves = (await listEvents(db, p.id, { key: "MIC-I1-1", types: ["task.status"] })).events.map((e) => [e.payload.from, e.payload.to, e.actor.agent]);
      assert.deepEqual(moves.slice(-2), [["Merged", "Released", "plania"], ["Released", "Done", "plania"]]);
      const notes = (await listEvents(db, p.id, { key: "MIC-I1-1", types: ["note"] })).events.map((e) => String(e.payload.text));
      assert.ok(notes.some((n) => n.includes("counts as released")), "the note says why");
    } finally {
      await close();
    }
  });

  test("auto_done false keeps a released ticket Released; an open check keeps it Released; the board says can_close only when every ticket is Done", async () => {
    const { db, close } = makeDb();
    try {
      let p = await findProject(db, "micasa");
      await setProject(db, { project: "micasa", version: p.version, settings: { auto_done: false } }, ctx);
      p = await findProject(db, "micasa");
      const pulls = [pr(5, "MIC-I1-1", sha("a")), pr(6, "MIC-I1-2", sha("b")), pr(7, "MIC-I1-3", sha("c"))];
      const routes = { [`/repos/${REPO}/pulls?`]: pulls, [`/repos/${REPO}/branches`]: [{ name: "main", commit: { sha: sha("3") } }], [`/repos/${REPO}/compare/`]: { status: "ahead" } };
      const s = await pollGithubProject(db, p, { fetch: fakeFetch(routes), env: { GITHUB_TOKEN: "ghp_test" } });
      assert.equal(s.released, 2);
      assert.equal(s.closed, 0);
      assert.equal(await status("MIC-I1-2"), "Released", "the rule is off");
      assert.equal(await status("MIC-I1-3"), "Released");

      let board = await projectEtapas(db, p);
      let ini = board.initiatives.find((i) => i.key === "MIC-I1")!;
      assert.deepEqual([ini.done, ini.closed, ini.total, ini.can_close], [3, 1, 3, false], "landed is not closed");
      let state = await initiativeState(db, (await findTask(db, p.id, "MIC-I1"))!);
      assert.deepEqual([state.to_close, state.ready_to_close, state.line], [["MIC-I1-2", "MIC-I1-3"], false, "1/3 hechos · 2 por cerrar"]);

      // The rule back on; MIC-I1-3 gets a check nobody closed.
      const t3 = (await findTask(db, p.id, "MIC-I1-3"))!;
      await raw.query("insert into checks (task_id, n, position, text, done) values ($1, 2, 2, 'probado en el teléfono', false)", [t3.id]);
      await setProject(db, { project: "micasa", version: p.version, settings: { auto_done: true } }, ctx);
      p = await findProject(db, "micasa");
      const again = await pollGithubProject(db, p, { fetch: fakeFetch(routes), env: { GITHUB_TOKEN: "ghp_test" } });
      assert.equal(again.closed, 1);
      assert.equal(await status("MIC-I1-2"), "Done");
      assert.equal(await status("MIC-I1-3"), "Released", "an open check holds it");

      // The owner closes it on screen; now the initiative can close, and Cerrar is accepted.
      const t3b = (await findTask(db, p.id, "MIC-I1-3"))!;
      await raw.query("update checks set done = true where task_id = $1", [t3b.id]);
      await setTask(db, { project: "micasa", key: "MIC-I1-3", status: "Done", version: t3b.version }, human);
      board = await projectEtapas(db, p);
      ini = board.initiatives.find((i) => i.key === "MIC-I1")!;
      assert.deepEqual([ini.done, ini.closed, ini.total, ini.can_close], [3, 3, 3, true]);
      state = await initiativeState(db, (await findTask(db, p.id, "MIC-I1"))!);
      assert.equal(state.line, "3/3 hechos · lista para cerrar");
      await setTask(db, { project: "micasa", key: "MIC-I1", status: "Done", version: ini.version }, human);
      assert.equal(await status("MIC-I1"), "Done");
    } finally {
      await close();
    }
  });

  test("release_on and auto_done are checked settings", async () => {
    const { db, close } = makeDb();
    try {
      const p = await findProject(db, "micasa");
      await assert.rejects(setProject(db, { project: "micasa", version: p.version, settings: { release_on: "deploy" } }, ctx), /INVALID_FILTER/);
      await assert.rejects(setProject(db, { project: "micasa", version: p.version, settings: { auto_done: "yes" } }, ctx), /INVALID_FILTER/);
    } finally {
      await close();
    }
  });
});
