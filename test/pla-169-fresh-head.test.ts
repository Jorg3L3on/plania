// PLA-169: finish refused every redelivery with EVIDENCE_STALE until the GitHub poller read the new push, because the
// poller's stored head (the previous delivery) counted as newer than the pass. A pass on a commit that descends from
// the stored head is not stale; one on an older commit still is; and the hint never asks to re-run the checks on an
// older commit than the one the pass names. git is injected (setAncestryForTests); the database is the test one.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask, claim, setTask } = await import("../src/mcp/writes.js");
const { addResult, setAncestryForTests, taskResults } = await import("../src/mcp/evidence.js");
const { touchBranch } = await import("../src/mcp/branches.js");
const { findProject, findTask } = await import("../src/mcp/queries.js");

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let close: () => Promise<void>;
const A = "aaaaaaa" + "1".repeat(33);
const B = "bbbbbbb" + "2".repeat(33);
const O = "0000000" + "3".repeat(33);
const ws = mkdtempSync(path.join(tmpdir(), "plania-169-"));
let n = 0;

async function step(opts: { workspace?: boolean } = {}) {
  const ctx = { actor: { agent: "taller", session_id: `s-169-${++n}`, machine: hostname() } };
  const branch = `jl/pla-169-${n}`;
  const t = (await createTask(db, { project: "filmia", title: `Step ${n}`, scope: "s", checks: ["c"], status: "Ready" }, ctx)) as { key: string };
  await claim(db, { project: "filmia", key: t.key, ...(opts.workspace ? { workspace: { worktree_path: ws, branch } } : {}) }, ctx);
  const p = await findProject(db, "filmia");
  const pass = (commit: string) => addResult(db, { project: "filmia", key: t.key, kind: "unit", verdict: "pass", cite: "ok", commit, branch, check_ns: [1] }, ctx);
  const review = async () => {
    const cur = (await findTask(db, p.id, t.key))!;
    try {
      await setTask(db, { project: "filmia", key: t.key, status: "In review", version: cur.version, branch, pr_url: `https://github.com/o/filmia/pull/${n}` }, ctx);
      return null;
    } catch (e) {
      return e as { code: string; detail?: { hint?: string } };
    }
  };
  const poll = (sha: string) => touchBranch(db, p.id, branch, { headSha: sha, headAt: new Date() });
  const stale = async () => (await taskResults(db, (await findTask(db, p.id, t.key))!)).map((r) => [r.commit?.slice(0, 7), r.stale_for_head]);
  return { key: t.key, pass, review, poll, stale };
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close } = makeDb());
});
afterEach(() => setAncestryForTests(null));
after(async () => {
  await close();
  await raw.end();
});

test("check 2: a redelivery on B right after the poller stored the first delivery A is not stale, with no git to ask", async () => {
  const s = await step();
  await s.pass(A);
  await new Promise((r) => setTimeout(r, 5));
  await s.poll(A); // the poller reads the first delivery
  await new Promise((r) => setTimeout(r, 5));
  await s.pass(B); // «Pedir ajuste»: Taller commits B, pushes, and finishes before the next poll
  assert.equal(await s.review(), null, "finish goes through");
  assert.deepEqual(await s.stale(), [["aaaaaaa", false], ["bbbbbbb", false]], "get_task shows neither as stale");
});

test("check 2: git in the workspace decides: a descendant of the stored head is fresh, an ancestor is stale", async () => {
  const newer = await step({ workspace: true });
  await newer.poll(A);
  await newer.pass(B);
  setAncestryForTests(async (cwd, anc, desc) => (cwd === ws && anc === A && desc === B ? true : null));
  assert.equal(await newer.review(), null);

  const older = await step({ workspace: true });
  await older.poll(A);
  await older.pass(O);
  setAncestryForTests(async (_cwd, anc, desc) => (anc === A && desc === O ? false : null));
  const e = await older.review();
  assert.equal(e?.code, "EVIDENCE_STALE");
  assert.deepEqual(await older.stale(), [["0000000", true]]);
  assert.match(e!.detail!.hint!, /is at aaaaaaa \(what the GitHub poller last saw\), past the commits your passes name \(0000000\); run the checks again at aaaaaaa/);
});

test("check 3: when Plania cannot tell, the hint does not send the builder back to the older head", async () => {
  const s = await step();
  await s.poll(A);
  await s.pass(B); // the head was never this ticket's delivery and git cannot answer
  setAncestryForTests(async () => null);
  const e = await s.review();
  assert.equal(e?.code, "EVIDENCE_STALE");
  const hint = e!.detail!.hint!;
  assert.match(hint, /If bbbbbbb is newer, push it to jl\/pla-169-\d+ and call finish again/);
  assert.ok(!/run the checks again at aaaaaaa/.test(hint), hint);
});

test("the same commit as the head is fresh", async () => {
  const s = await step();
  await s.poll(B);
  await s.pass(B.slice(0, 7));
  assert.equal(await s.review(), null);
});
