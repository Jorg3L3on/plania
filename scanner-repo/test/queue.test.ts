import assert from "node:assert/strict";
import { test } from "node:test";
import { SCAN_BUDGET_MS, scanTargets, type Posted, type ScanTarget } from "../src/run-queue.ts";

function target(number: number): ScanTarget {
  return {
    owner: "Jorg3L3on",
    repo: "filmia",
    number,
    headSha: number === 1 ? "a".repeat(40) : "b".repeat(40),
    baseRef: "main",
    baseSha: "c".repeat(40),
  };
}

test("a clean head goes pending then success, and a finding does not fail the job", async () => {
  const posts: Posted[] = [];
  const failures = await scanTargets([target(1)], {
    now: () => 0,
    async post(_target, body) {
      posts.push({ state: body.state, description: body.description });
    },
    fetchPull: () => "/tmp/plania-fixture",
    async scan() {
      return { findings: [], error: null };
    },
    log() {},
    remove() {},
  });
  assert.equal(failures, 0);
  assert.deepEqual(posts, [
    { state: "pending", description: "scan started" },
    { state: "success", description: "0 findings, 0 rules" },
  ]);
});

test("findings post a redacted failure and an operational error is a failed job", async () => {
  const leaked = "fixture.scanner@mail-ficticio.mx";
  const posts: string[] = [];
  const findings = await scanTargets([target(1)], {
    now: () => 0,
    async post(_target, body) {
      posts.push(body.description);
    },
    fetchPull: () => "/tmp/plania-fixture",
    async scan() {
      return { findings: [{ rule: "plania-email" }, { rule: "plania-email" }], error: null };
    },
    log() {},
    remove() {},
  });
  assert.equal(findings, 0);
  assert.equal(posts[1], "2 findings, 1 rule");
  assert.equal(posts.join(" ").includes(leaked), false);

  const errors = await scanTargets([target(1)], {
    now: () => 0,
    async post(_target, body) {
      posts.push(body.description);
    },
    fetchPull() {
      throw new Error(leaked);
    },
    async scan() {
      return { findings: [], error: null };
    },
    log() {},
    remove() {},
  });
  assert.equal(errors, 1);
  assert.equal(posts.at(-1), "scan did not finish");
  assert.equal(posts.join(" ").includes(leaked), false);
});

test("a head past the time budget stays unmarked", async () => {
  let calls = 0;
  const seen: number[] = [];
  const failures = await scanTargets([target(1), target(2)], {
    now() {
      calls += 1;
      return calls < 3 ? 0 : SCAN_BUDGET_MS + 1;
    },
    async post() {},
    fetchPull(item) {
      seen.push(item.number);
      return "/tmp/plania-fixture";
    },
    async scan() {
      return { findings: [], error: null };
    },
    log() {},
    remove() {},
  });
  assert.equal(failures, 0);
  assert.deepEqual(seen, [1]);
});
