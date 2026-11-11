import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSafeRef, fetchRefspecs, redactGitError } from "../src/fetch-pr.mjs";
import { postStatus, runUrl, statusUrl } from "../src/github.mjs";

test("fetch refspecs stay inside the pull and the base branch", () => {
  assert.deepEqual(fetchRefspecs({ number: 12, baseRef: "main" }), {
    head: "pull/12/head:refs/plania/head",
    base: "refs/heads/main:refs/plania/base",
  });
  assert.equal(assertSafeRef("feature/demo"), "feature/demo");
  assert.throws(() => fetchRefspecs({ number: 3, baseRef: "main:evil" }));
  assert.throws(() => fetchRefspecs({ number: 3, baseRef: "-main" }));
  assert.throws(() => fetchRefspecs({ number: 3, baseRef: "a..b" }));
  assert.throws(() => fetchRefspecs({ number: 0, baseRef: "main" }));
});

test("git errors do not keep a token", () => {
  assert.equal(redactGitError("fatal: Authentication failed"), "fatal: Authentication failed");
  assert.equal(redactGitError("remote: invalid github_pat_example\n"), "git failed");
  assert.equal(redactGitError(""), "git failed");
});

test("status posts use the head sha and a counts-only body", async () => {
  const target = { owner: "Jorg3L3on", repo: "filmia", headSha: "d".repeat(40) };
  assert.equal(statusUrl(target), `https://api.github.com/repos/Jorg3L3on/filmia/statuses/${"d".repeat(40)}`);
  assert.equal(runUrl({}), null);
  assert.equal(runUrl({ GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "Jorg3L3on/plania-scan", GITHUB_RUN_ID: "42" }), "https://github.com/Jorg3L3on/plania-scan/actions/runs/42");
  let body = "";
  await postStatus(async (url, init) => {
    assert.equal(url, statusUrl(target));
    assert.equal(init.method, "POST");
    body = init.body;
    return { ok: true, status: 201 };
  }, "token", target, { state: "failure", context: "plania-scan", description: "1 finding, 1 rule" }, {
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "Jorg3L3on/plania-scan",
    GITHUB_RUN_ID: "42",
  });
  assert.equal(body.includes("fixture.scanner"), false);
  assert.equal(body.includes("token"), false);
  assert.match(body, /1 finding, 1 rule/);
});
