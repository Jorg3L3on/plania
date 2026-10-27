// PLA-I14: gh runs detached, and a timeout kills the process group. Release-ship uses the same helper.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { runInGroup } from "../src/jobs/gh-process.js";
import { resetTokenFileCache } from "../src/jobs/gh-token.js";
import { ToolError } from "../src/mcp/errors.js";
import { RELEASE_GH_TIMEOUT_MS, runReleaseGh } from "../src/mcp/release-ship.js";

const MISSING = "falta token: ~/.config/plania/github-release-token or ~/.config/plania/github-token";
const ENV_KEYS = ["PATH", "PLANIA_GH_FALLBACK", "PLANIA_GITHUB_TOKEN_FILE", "PLANIA_GITHUB_RELEASE_TOKEN_FILE", "GH_TOKEN"] as const;

function writeToken(file: string, content: string) {
  writeFileSync(file, content);
  chmodSync(file, 0o600);
}

function saveEnv(): () => void {
  const snap = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));
  return () => {
    for (const [key, value] of snap) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function waitGone(pid: number) {
  const start = Date.now();
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      assert.equal((err as NodeJS.ErrnoException).code, "ESRCH");
      return;
    }
    if (Date.now() - start > 2_000) assert.fail(`pid ${pid} still alive`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(() => resetTokenFileCache());

describe("runInGroup", () => {
  test("timeout kills the process group, including a sleeping grandchild", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-grp-"));
    const script = path.join(dir, "parent.mjs");
    writeFileSync(
      script,
      `import { spawn } from "node:child_process";
import fs from "node:fs";
const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { detached: false, stdio: "ignore" });
fs.writeSync(1, String(g.pid) + "\\n");
setInterval(() => {}, 1e9);
`,
    );
    let pid = 0;
    try {
      const result = await runInGroup(process.execPath, [script], { timeoutMs: 400 });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.reason, "timeout");
      pid = Number(result.stdout.trim());
      assert.ok(Number.isInteger(pid) && pid > 0);
      await waitGone(pid);
    } finally {
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone, which is what the test wants.
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing binary is missing", async () => {
    const result = await runInGroup("plania-no-such-bin-i14", ["auth", "token"], { timeoutMs: 2_000 });
    assert.deepEqual(result, { ok: false, reason: "missing", stdout: "", stderr: "" });
  });

  test("a non-zero exit keeps the code and stderr", async () => {
    const result = await runInGroup(process.execPath, ["-e", "process.stderr.write('boom'); process.exit(2)"], { timeoutMs: 5_000 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "exit");
    assert.equal(result.code, 2);
    assert.equal(result.stderr, "boom");
  });
});

describe("release-ship gh", () => {
  test("the production timeout is 60 seconds", () => {
    assert.equal(RELEASE_GH_TIMEOUT_MS, 60_000);
  });

  test("no token and fallback off throws before any process", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-rel-"));
    const marker = path.join(dir, "started");
    const bin = path.join(dir, "gh");
    writeFileSync(bin, `#!/bin/sh\necho ran > '${marker}'\n`, { mode: 0o755 });
    chmodSync(bin, 0o755);
    const restore = saveEnv();
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ""}`;
    delete process.env.PLANIA_GH_FALLBACK;
    process.env.PLANIA_GITHUB_TOKEN_FILE = path.join(dir, "no-github");
    process.env.PLANIA_GITHUB_RELEASE_TOKEN_FILE = path.join(dir, "no-release");
    try {
      await assert.rejects(() => runReleaseGh(["pr", "list"]), (err: unknown) => {
        assert.ok(err instanceof ToolError);
        assert.equal(err.code, "RELEASE_MERGE_FAILED");
        assert.equal(err.detail.step, "token");
        assert.equal(err.detail.output, MISSING);
        return true;
      });
      assert.equal(existsSync(marker), false);
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("GH_TOKEN from the file reaches gh as match or no-match, release file first", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-gh-"));
    const bin = path.join(dir, "gh");
    writeFileSync(
      bin,
      `#!/bin/sh
if [ "$GH_PROMPT_DISABLED" = "1" ] && [ "$GH_TOKEN" = "ghp_test" ]; then
  echo match
else
  echo no-match
fi
`,
      { mode: 0o755 },
    );
    chmodSync(bin, 0o755);
    const restore = saveEnv();
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ""}`;
    delete process.env.PLANIA_GH_FALLBACK;
    const github = path.join(dir, "github-token");
    const release = path.join(dir, "github-release-token");
    try {
      writeToken(github, "ghp_test\n");
      process.env.PLANIA_GITHUB_TOKEN_FILE = github;
      process.env.PLANIA_GITHUB_RELEASE_TOKEN_FILE = path.join(dir, "no-release");
      let result = await runReleaseGh(["pr", "list"], { timeoutMs: 5_000 });
      assert.equal(result.ok, true);
      assert.equal(result.stdout.trim(), "match");
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ghp_/);

      writeToken(github, "ghp_testb\n");
      result = await runReleaseGh(["pr", "list"], { timeoutMs: 5_000 });
      assert.equal(result.stdout.trim(), "no-match");
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ghp_/);

      writeToken(release, "ghp_test\n");
      writeToken(github, "ghp_testb\n");
      process.env.PLANIA_GITHUB_RELEASE_TOKEN_FILE = release;
      result = await runReleaseGh(["pr", "list"], { timeoutMs: 5_000 });
      assert.equal(result.stdout.trim(), "match");

      writeToken(release, "\n");
      writeToken(github, "ghp_test\n");
      result = await runReleaseGh(["pr", "list"], { timeoutMs: 5_000 });
      assert.equal(result.stdout.trim(), "match");
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a 403 from gh names the missing write access and not the token", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-403-"));
    const bin = path.join(dir, "gh");
    writeFileSync(bin, "#!/bin/sh\necho 'HTTP 403' >&2\nexit 1\n", { mode: 0o755 });
    chmodSync(bin, 0o755);
    const restore = saveEnv();
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ""}`;
    delete process.env.PLANIA_GH_FALLBACK;
    const github = path.join(dir, "github-token");
    writeToken(github, "ghp_test\n");
    process.env.PLANIA_GITHUB_TOKEN_FILE = github;
    process.env.PLANIA_GITHUB_RELEASE_TOKEN_FILE = path.join(dir, "no-release");
    try {
      const result = await runReleaseGh(["api"], { timeoutMs: 5_000 });
      assert.equal(result.ok, false);
      assert.match(result.stderr, /\b403\b/);
      assert.match(result.stderr, /write access/);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ghp_/);
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a hanging gh is killed with its grandchild", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-hang-"));
    const bin = path.join(dir, "gh");
    writeFileSync(
      bin,
      `#!/bin/sh
${JSON.stringify(process.execPath)} -e 'setInterval(() => {}, 1e9)' >/dev/null 2>&1 &
echo $!
wait
`,
      { mode: 0o755 },
    );
    chmodSync(bin, 0o755);
    const restore = saveEnv();
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ""}`;
    delete process.env.PLANIA_GH_FALLBACK;
    const github = path.join(dir, "github-token");
    writeToken(github, "ghp_test\n");
    process.env.PLANIA_GITHUB_TOKEN_FILE = github;
    process.env.PLANIA_GITHUB_RELEASE_TOKEN_FILE = path.join(dir, "no-release");
    let pid = 0;
    try {
      const result = await runReleaseGh(["pr", "view"], { timeoutMs: 500 });
      assert.equal(result.ok, false);
      pid = Number(result.stdout.trim());
      assert.ok(Number.isInteger(pid) && pid > 0);
      await waitGone(pid);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ghp_/);
    } finally {
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fallback on spawns gh without a file token", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-fb-"));
    const bin = path.join(dir, "gh");
    writeFileSync(bin, "#!/bin/sh\nif [ -n \"$GH_TOKEN\" ]; then echo has-token; else echo spawned; fi\n", { mode: 0o755 });
    chmodSync(bin, 0o755);
    const restore = saveEnv();
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ""}`;
    process.env.PLANIA_GH_FALLBACK = "1";
    process.env.PLANIA_GITHUB_TOKEN_FILE = path.join(dir, "no-github");
    process.env.PLANIA_GITHUB_RELEASE_TOKEN_FILE = path.join(dir, "no-release");
    delete process.env.GH_TOKEN;
    try {
      const result = await runReleaseGh(["auth", "status"], { timeoutMs: 5_000 });
      assert.equal(result.ok, true);
      assert.equal(result.stdout.trim(), "spawned");
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
