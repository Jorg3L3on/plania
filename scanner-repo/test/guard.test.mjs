import assert from "node:assert/strict";
import { test } from "node:test";
import { collectTargets, ghJson, rowsOf, runGuard } from "../src/guard.mjs";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const SHA = "a".repeat(40);
const FRESH = "b".repeat(40);

function pull(number, sha) {
  return { number, head: { sha }, base: { ref: "sandbox", sha: "c".repeat(40) } };
}

test("collectTargets keeps only heads with no settled plania-scan status", async () => {
  const repos = [
    { owner: "Jorg3L3on", repo: "filmia" },
    { owner: "Jorg3L3on", repo: "micasa" },
  ];
  const load = {
    pulls(repo) {
      if (repo.repo === "filmia") return [pull(4, SHA), pull(5, FRESH)];
      return [];
    },
    statuses(target) {
      if (target.headSha === FRESH) {
        return [{ context: "plania-scan", state: "pending", updated_at: "2026-11-11T11:55:00Z" }];
      }
      return [{ context: "ci", state: "success", updated_at: "2026-11-11T11:00:00Z" }];
    },
  };
  const targets = await collectTargets(repos, load, NOW);
  assert.deepEqual(targets.map((item) => item.number), [4]);
  assert.equal(targets[0].baseRef, "sandbox");
});

test("a list that is not an array fails closed", () => {
  assert.throws(() => rowsOf({ workflow_runs: [] }), /not a list/);
  assert.deepEqual(rowsOf([]), []);
});

test("ghJson returns parsed json and hides response bodies on failure", () => {
  const ok = ghJson("repos/Jorg3L3on/filmia/pulls?state=open", {}, () => ({ status: 0, stdout: "[]", stderr: "" }));
  assert.deepEqual(ok, []);
  assert.throws(
    () => ghJson("repos/Jorg3L3on/filmia/pulls", {}, () => ({ status: 1, stdout: "", stderr: "HTTP 403\nsecret body" })),
    (error) => error.message === "github list failed (403)",
  );
});

test("runGuard writes the unmarked count and does not call GitHub without a token", async () => {
  const missing = await runGuard({ token: "", load: { pulls() {}, statuses() {} } });
  assert.equal(missing.code, 2);
  assert.equal(missing.count, 0);

  let written = "";
  const result = await runGuard({
    token: "token",
    nowMs: NOW,
    repos: [{ owner: "Jorg3L3on", repo: "zigzag" }],
    load: {
      pulls() {
        return [pull(9, SHA)];
      },
      statuses() {
        return [];
      },
    },
    writeOutput(targets) {
      written = JSON.stringify(targets);
      return `count=${targets.length}\n`;
    },
  });
  assert.equal(result.code, 0);
  assert.equal(result.count, 1);
  assert.equal(result.line, "count=1\n");
  assert.equal(written.includes(SHA), true);
  assert.equal(written.includes("token"), false);

  const failed = await runGuard({
    token: "token",
    repos: [{ owner: "Jorg3L3on", repo: "workia" }],
    load: {
      pulls() {
        throw new Error("github list failed (502)");
      },
      statuses() {
        return [];
      },
    },
  });
  assert.equal(failed.code, 1);
  assert.equal(failed.error, "github list failed (502)");
});
