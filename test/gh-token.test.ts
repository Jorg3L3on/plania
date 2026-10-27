// PLA-I14: the GitHub token comes from the env var, then a file, then gh only when asked.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import type { GroupRun } from "../src/jobs/gh-process.js";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { findProject } = await import("../src/mcp/queries.js");
const { setProject } = await import("../src/mcp/project.js");
const { githubToken, pollGithubProject, resetGithubAuthCache } = await import("../src/jobs/github.js");
const { githubReleaseTokenFilePath, githubTokenFilePath, readTokenFile, resetTokenFileCache } = await import("../src/jobs/gh-token.js");

const GAP = "no token: GITHUB_TOKEN unset, ~/.config/plania/github-token missing or empty";
const T0 = Date.parse("2026-10-27T00:00:00Z");
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };

function writeToken(file: string, content: string, mode: number) {
  writeFileSync(file, content);
  chmodSync(file, mode);
}

function counting() {
  const fetches: string[] = [];
  const ghRuns: { args: string[]; timeoutMs: number }[] = [];
  const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    fetches.push(init?.headers?.Authorization ?? url);
    return { status: 200, headers: { get: () => null }, json: async () => [] };
  };
  const ghRun: GroupRun = async (cmd, args, opts) => {
    ghRuns.push({ args: [cmd, ...args], timeoutMs: opts.timeoutMs });
    return { ok: true, stdout: "  ghp_test \n", stderr: "" };
  };
  return { fetch, fetches, ghRun, ghRuns };
}

beforeEach(() => {
  resetTokenFileCache();
  resetGithubAuthCache();
});

describe("readTokenFile", () => {
  test("default path is ~/.config/plania/github-token, overridable by env or argument", () => {
    assert.equal(githubTokenFilePath({}), path.join(homedir(), ".config", "plania", "github-token"));
    assert.equal(githubReleaseTokenFilePath({}), path.join(homedir(), ".config", "plania", "github-release-token"));
    assert.equal(githubTokenFilePath({ PLANIA_GITHUB_TOKEN_FILE: "/tmp/plania-token" }), "/tmp/plania-token");
  });

  test("trims one line, and empty or multi-line is no token", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-tok-"));
    const file = path.join(dir, "github-token");
    try {
      writeToken(file, "  ghp_test  \n", 0o600);
      assert.equal(readTokenFile(file).token, "ghp_test");
      writeToken(file, " \n", 0o600);
      assert.equal(readTokenFile(file).token, null);
      writeToken(file, "ghp_test\nsecond\n", 0o600);
      assert.equal(readTokenFile(file).token, null);
      assert.equal(readTokenFile(path.join(dir, "missing")).token, null);
      assert.equal(readTokenFile(dir).token, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("caches by mtime and size, and re-reads when the mtime changes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-cache-"));
    const file = path.join(dir, "github-token");
    try {
      writeToken(file, "ghp_test\n", 0o600);
      const stable = new Date(Math.floor(Date.now() / 1000) * 1000);
      utimesSync(file, stable, stable);
      assert.equal(readTokenFile(file).token, "ghp_test");
      const st = statSync(file);
      writeFileSync(file, "ghp_tesu\n");
      chmodSync(file, 0o600);
      utimesSync(file, st.atime, st.mtime);
      const again = statSync(file);
      assert.equal(again.mtimeMs, st.mtimeMs);
      assert.equal(again.size, st.size);
      assert.equal(readTokenFile(file).token, "ghp_test", "same mtime and size keeps the cached line");
      const later = new Date(st.mtimeMs + 2_000);
      utimesSync(file, later, later);
      assert.equal(readTokenFile(file).token, "ghp_tesu");
      rmSync(file);
      assert.equal(readTokenFile(file).token, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("0600 is quiet; 0644 still returns the token and warns once per mtime, with no contents", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-mode-"));
    const tight = path.join(dir, "tight");
    const loose = path.join(dir, "loose");
    const lines: string[] = [];
    const orig = console.warn;
    console.warn = (msg?: unknown) => {
      lines.push(String(msg));
    };
    try {
      writeToken(tight, "ghp_test\n", 0o600);
      assert.equal(statSync(tight).mode & 0o777, 0o600);
      const ok = readTokenFile(tight);
      assert.equal(ok.token, "ghp_test");
      assert.equal(ok.modeNote, null);
      assert.equal(lines.length, 0);

      writeToken(loose, "ghp_test\n", 0o644);
      assert.equal(statSync(loose).mode & 0o777, 0o644);
      const wide = readTokenFile(loose);
      assert.equal(wide.token, "ghp_test");
      assert.match(wide.modeNote ?? "", /644/);
      assert.match(wide.modeNote ?? "", /group or world readable/);
      readTokenFile(loose);
      assert.equal(lines.length, 1);
      const st = statSync(loose);
      const later = new Date(st.mtimeMs + 2_000);
      utimesSync(loose, later, later);
      readTokenFile(loose);
      assert.equal(lines.length, 2);
      const notes = lines.join("\n");
      assert.match(notes, /644/);
      assert.doesNotMatch(notes, /ghp_/);
    } finally {
      console.warn = orig;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the argument wins over PLANIA_GITHUB_TOKEN_FILE", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-over-"));
    const a = path.join(dir, "a");
    const b = path.join(dir, "b");
    try {
      writeToken(a, "ghp_test\n", 0o600);
      writeToken(b, "ghp_testb\n", 0o600);
      assert.equal(readTokenFile(b, { PLANIA_GITHUB_TOKEN_FILE: a }).token, "ghp_testb");
      assert.equal(readTokenFile(undefined, { PLANIA_GITHUB_TOKEN_FILE: a }).token, "ghp_test");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("githubToken order", () => {
  test("env var wins over the file and over gh; a file is trimmed and does not spawn", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-env-"));
    const file = path.join(dir, "github-token");
    writeToken(file, "  ghp_testb \n", 0o600);
    const { fetch, fetches, ghRun, ghRuns } = counting();
    try {
      const fromEnv = await githubToken(
        { fetch, env: { GITHUB_TOKEN: "ghp_test", PLANIA_GITHUB_TOKEN_FILE: file, PLANIA_GH_FALLBACK: "1" }, ghRun },
        {},
      );
      assert.equal(fromEnv.token, "ghp_test");
      assert.equal(fromEnv.source, "GITHUB_TOKEN");
      assert.equal(ghRuns.length, 0);
      assert.equal(fetches.length, 0);

      const named = await githubToken({ fetch, env: { OTHER_TOKEN: "ghp_test", PLANIA_GITHUB_TOKEN_FILE: file }, ghRun }, { token_env: "OTHER_TOKEN" });
      assert.equal(named.token, "ghp_test");
      assert.equal(named.source, "OTHER_TOKEN");

      writeToken(file, "  ghp_test \n", 0o600);
      const fromFile = await githubToken({ fetch, env: { PLANIA_GITHUB_TOKEN_FILE: file, PLANIA_GH_FALLBACK: "1" }, ghRun }, {});
      assert.equal(fromFile.token, "ghp_test");
      assert.equal(ghRuns.length, 0);
      assert.equal(fetches.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fallback off never spawns; fallback on caches a success for 10 minutes and backs off an hour", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-fb-"));
    const missing = path.join(dir, "missing");
    const env = { PLANIA_GITHUB_TOKEN_FILE: missing };
    try {
      let runs = 0;
      const ghRun: GroupRun = async (cmd, args, opts) => {
        runs++;
        assert.deepEqual([cmd, ...args], ["gh", "auth", "token"]);
        assert.equal(opts.timeoutMs, 5_000);
        return { ok: true, stdout: "  ghp_test \n", stderr: "" };
      };
      const fetch = async () => {
        throw new Error("fetch");
      };
      const off = await githubToken({ fetch, env, ghRun, now: new Date(T0) }, {});
      assert.equal(off.token, null);
      assert.equal(off.source, GAP);
      assert.equal(runs, 0);

      const forcedOff = await githubToken(
        { fetch, env: { ...env, PLANIA_GH_FALLBACK: "1" }, ghRun, fallback: false, now: new Date(T0) },
        {},
      );
      assert.equal(forcedOff.token, null);
      assert.equal(runs, 0);

      const first = await githubToken({ fetch, env: { ...env, PLANIA_GH_FALLBACK: "1" }, ghRun, now: new Date(T0) }, {});
      assert.equal(first.token, "ghp_test");
      assert.equal(runs, 1);
      const cached = await githubToken(
        { fetch, env: { ...env, PLANIA_GH_FALLBACK: "1" }, ghRun, now: new Date(T0 + 9 * 60 * 1000) },
        {},
      );
      assert.equal(cached.token, "ghp_test");
      assert.equal(runs, 1);
      await githubToken({ fetch, env: { ...env, PLANIA_GH_FALLBACK: "1" }, ghRun, now: new Date(T0 + 10 * 60 * 1000) }, {});
      assert.equal(runs, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a failed gh is not retried for an hour", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-back-"));
    const env = { PLANIA_GITHUB_TOKEN_FILE: path.join(dir, "missing"), PLANIA_GH_FALLBACK: "1" };
    let runs = 0;
    const ghRun: GroupRun = async () => {
      runs++;
      return { ok: false, reason: "timeout", stdout: "", stderr: "" };
    };
    const fetch = async () => {
      throw new Error("fetch");
    };
    try {
      const failed = `${GAP}; gh auth token failed (timeout)`;
      const first = await githubToken({ fetch, env, ghRun, now: new Date(T0) }, {});
      assert.equal(first.token, null);
      assert.equal(first.source, failed);
      assert.equal(runs, 1);
      const held = await githubToken({ fetch, env, ghRun, now: new Date(T0 + 59 * 60 * 1000) }, {});
      assert.equal(held.token, null);
      assert.equal(held.source, failed);
      assert.equal(runs, 1);
      await githubToken({ fetch, env, ghRun, now: new Date(T0 + 60 * 60 * 1000) }, {});
      assert.equal(runs, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing gh says missing, and the backoff repeats that instead of only the empty file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-miss-"));
    const env = { PLANIA_GITHUB_TOKEN_FILE: path.join(dir, "missing"), PLANIA_GH_FALLBACK: "1" };
    let runs = 0;
    const ghRun: GroupRun = async () => {
      runs++;
      return { ok: false, reason: "missing", stdout: "", stderr: "" };
    };
    const fetch = async () => {
      throw new Error("fetch");
    };
    try {
      const failed = `${GAP}; gh auth token failed (missing)`;
      const first = await githubToken({ fetch, env, ghRun, now: new Date(T0) }, {});
      assert.equal(first.token, null);
      assert.equal(first.source, failed);
      assert.doesNotMatch(first.source, /ghp_/);
      const held = await githubToken({ fetch, env, ghRun, now: new Date(T0 + 59 * 60 * 1000) }, {});
      assert.equal(held.source, failed);
      assert.equal(runs, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("poller", () => {
  let raw: pg.Client;
  let db: ReturnType<typeof makeDb>["db"];
  let closeDb: () => Promise<void>;

  before(async () => {
    raw = await resetTestDb();
    const made = makeDb();
    db = made.db;
    closeDb = made.close;
    const p = await findProject(db, "filmia");
    await setProject(db, { project: "filmia", version: p.version, settings: { github: { repo: "Jorg3L3on/filmia" } } }, ctx);
  });

  after(async () => {
    await closeDb?.();
    await raw?.end();
  });

  test("without a file the job fetches nothing, spawns nothing, and names the file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-gap-"));
    let fetches = 0;
    let ghRuns = 0;
    const p = await findProject(db, "filmia");
    try {
      await pollGithubProject(db, p, {
        fetch: async () => {
          fetches++;
          return { status: 200, headers: { get: () => null }, json: async () => [] };
        },
        env: { PLANIA_GITHUB_TOKEN_FILE: path.join(dir, "missing") },
        ghRun: async () => {
          ghRuns++;
          return { ok: false, reason: "missing", stdout: "", stderr: "" };
        },
      });
      assert.equal(fetches, 0);
      assert.equal(ghRuns, 0);
      const { rows } = await raw.query("select error from poll_state where source = 'github'");
      assert.equal(rows[0].error, GAP);
      assert.match(rows[0].error, /~\/\.config\/plania\/github-token/);
      assert.doesNotMatch(rows[0].error, /ghp_/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a trimmed file token is sent, and the env var still wins", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-send-"));
    const file = path.join(dir, "github-token");
    writeToken(file, "  ghp_test \n", 0o600);
    const auths: string[] = [];
    let ghRuns = 0;
    const fetch = async (_url: string, init?: { headers?: Record<string, string> }) => {
      auths.push(init?.headers?.Authorization ?? "");
      return { status: 200, headers: { get: () => null }, json: async () => [] };
    };
    const ghRun: GroupRun = async () => {
      ghRuns++;
      return { ok: false, reason: "missing", stdout: "", stderr: "" };
    };
    const p = await findProject(db, "filmia");
    try {
      await pollGithubProject(db, p, { fetch, env: { PLANIA_GITHUB_TOKEN_FILE: file }, ghRun });
      assert.equal(auths[0], "Bearer ghp_test");
      assert.equal(ghRuns, 0);
      const { rows } = await raw.query("select error from poll_state where source = 'github'");
      assert.equal(rows[0].error, null);

      auths.length = 0;
      const other = path.join(dir, "other");
      writeToken(other, "ghp_testb\n", 0o600);
      await pollGithubProject(db, p, {
        fetch,
        env: { GITHUB_TOKEN: "ghp_test", PLANIA_GITHUB_TOKEN_FILE: other, PLANIA_GH_FALLBACK: "1" },
        ghRun,
      });
      assert.equal(auths[0], "Bearer ghp_test");
      assert.equal(ghRuns, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
