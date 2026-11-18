// PLA-66: a question (Preguntar) reads a fresh copy of origin/sandbox, never the owner's checkout as it sits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { ensureReadCopy, readCopyPathFor } = await import("../src/runner/worktree.js");
const { consultaPrompt } = await import("../src/pedidos/consultas.js");

const scratch = mkdtempSync(path.join(tmpdir(), "plania-pla66-"));
const repo = path.join(scratch, "repos", "mianovia");
const root = path.join(scratch, "worktrees");
mkdirSync(repo, { recursive: true });

const fakeGit = (calls: { args: string[]; cwd: string }[], opts: { fetchFails?: boolean } = {}) => async (args: string[], cwd: string) => {
  calls.push({ args, cwd });
  if (args[0] === "fetch" && opts.fetchFails) return { code: 1, stdout: "", stderr: "offline" };
  if (args[0] === "worktree" && args[1] === "add") mkdirSync(args[3]!, { recursive: true });
  if (args[0] === "rev-parse" && args[1] === "--short") return { code: 0, stdout: "92111e1\n", stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};

test("PLA-66 #1: the first question makes a detached copy at a freshly fetched origin/sandbox, outside the repo", async () => {
  const calls: { args: string[]; cwd: string }[] = [];
  const out = await ensureReadCopy({ repo, root, project: "mianovia" }, fakeGit(calls));
  assert.deepEqual(out, { ok: true, path: readCopyPathFor(root, "mianovia"), branch: "sandbox", commit: "92111e1", created: true });
  assert.deepEqual(calls[0], { args: ["fetch", "origin", "sandbox"], cwd: repo });
  const add = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add")!;
  assert.deepEqual(add.args, ["worktree", "add", "--detach", readCopyPathFor(root, "mianovia"), "origin/sandbox"]);
  // Nothing ran inside the owner's checkout except fetch and worktree bookkeeping: no checkout, reset or merge there.
  assert.equal(calls.some((c) => c.cwd === repo && ["checkout", "reset", "merge", "pull"].includes(c.args[0]!)), false);
});

test("PLA-66 #2: the next question fetches again and moves the same copy to origin/sandbox", async () => {
  const calls: { args: string[]; cwd: string }[] = [];
  const target = readCopyPathFor(root, "mianovia");
  assert.equal(existsSync(target), true);
  const out = await ensureReadCopy({ repo, root, project: "mianovia" }, fakeGit(calls));
  assert.equal(out.ok && out.created, false);
  assert.deepEqual(calls[0]!.args, ["fetch", "origin", "sandbox"]);
  assert.deepEqual(calls.find((c) => c.args[0] === "checkout"), { args: ["checkout", "--detach", "--force", "origin/sandbox"], cwd: target });
});

test("PLA-66 #3: no fetch means no copy (the runner then falls back and says so)", async () => {
  const out = await ensureReadCopy({ repo, root, project: "mianovia" }, fakeGit([], { fetchFails: true }));
  assert.deepEqual(out, { ok: false, summary: "fail: fetch origin/sandbox" });
  const inside = await ensureReadCopy({ repo, root: path.join(repo, "x"), project: "mianovia" }, fakeGit([]));
  assert.deepEqual(inside, { ok: false, summary: "fail: worktree inside the repo" });
});

test("PLA-66 #4: the prompt names the copy's branch and commit, or warns that the checkout may be old", () => {
  const base = { agent: "PO", project: { slug: "mianovia", title: "Mianovia" }, consulta: { id: "c1", text: "¿Qué falta?" }, cwd: "/w/mianovia/_consulta", sessionId: "run-1" };
  const fresh = consultaPrompt({ ...base, copy: { branch: "sandbox", commit: "92111e1" } });
  assert.match(fresh, /read-only copy of the project at origin\/sandbox 92111e1, fetched just now/);
  assert.match(fresh, /branch is "sandbox" and commit is "92111e1"/);
  assert.doesNotMatch(fresh, /project's own checkout/);
  const old = consultaPrompt({ ...base, cwd: "/p/mianovia", copy: { branch: null, commit: null, fallback: "fail: fetch origin/sandbox" } });
  assert.match(old, /project's own checkout: \/p\/mianovia\. A fresh copy could not be made \(fail: fetch origin\/sandbox\)/);
  assert.match(consultaPrompt(base), /project's own checkout: \/w\/mianovia\/_consulta\. This run is read-only/);
});
