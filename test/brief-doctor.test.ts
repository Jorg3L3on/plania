// PLA-I41-6: pnpm brief:doctor (spec §9): one ✓/✗ line per check, never a value. A fake exec stands in for claude
// (the real dry run is never made in tests); the database is the throwaway test DB.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_DATABASE_URL, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { formatDoctor, runDoctor } = await import("../src/brief/doctor.js");
type ExecFn = import("../src/brief/doctor.js").ExecFn;

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-brief-doctor-test-"));
const FIXTURE = readFileSync(new URL("./fixtures/claude/structured-output-2.1.302.jsonl", import.meta.url), "utf8");
const SECRETS = { PLANIA_BRIEF_TOKEN: "brief-secret-value-123", PLANIA_RUNNER_TOKEN: "runner-secret-value-456", GITHUB_TOKEN: "ghp_secretvalue789", MCP_READ_TOKEN: "read-secret-000" };
const root = path.join(scratch, "projects");
const env = { HOME: scratch, PATH: "/usr/bin:/bin", CLAUDE_CODE_BIN: path.join(scratch, "bin", "claude"), PLANIA_PROJECTS_ROOT: root, ANTHROPIC_API_KEY: "sk-ant-secret", ...SECRETS } as NodeJS.ProcessEnv;

function fakeExec(dry: { stdout: string; code?: number } = { stdout: FIXTURE }) {
  const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const exec: ExecFn = async (_cmd, args, opts) => {
    calls.push({ args, env: opts.env });
    if (args[0] === "--version") return { code: 0, stdout: "2.1.302 (Claude Code)\n", stderr: "" };
    return { code: dry.code ?? 0, stdout: dry.stdout, stderr: "" };
  };
  return { exec, calls };
}

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  for (const slug of ["micasa", "workia", "zigzag"]) mkdirSync(path.join(root, slug), { recursive: true });
});

after(async () => {
  await raw.end();
  rmSync(scratch, { recursive: true, force: true });
});

const noValues = (text: string) => {
  for (const v of [...Object.values(SECRETS), "sk-ant-secret", scratch, root]) assert.ok(!text.includes(v), `prints no value (${v.slice(0, 6)}…)`);
};

test("check 6: one line per check, ✓ or ✗, and no secret values", async () => {
  const f = fakeExec();
  const lines = await runDoctor(db, { env, exec: f.exec });
  const out = formatDoctor(lines);
  const text = out.split("\n");
  assert.equal(text.length, lines.length);
  for (const l of text) assert.match(l, /^[✓✗] \S/);
  assert.deepEqual(
    lines.map((l) => [l.ok, l.text.replace(/ \(.*$/, "").replace(/:.*$/, "")]),
    [
      [true, "claude found"],
      [true, "claude logged in; the result event carries structured_output"],
      [true, "read token set"],
      [true, "runner token set"],
      [true, "GitHub token readable"],
      [false, "repo for filmia exists"],
      [true, "repo for micasa exists"],
      [true, "repo for workia exists"],
      [true, "repo for zigzag exists"],
      [true, "migration 0045 applied"],
      [true, "prompts folder present"],
    ],
  );
  assert.match(out, /✓ claude found \(version 2\.1\.302\)/);
  noValues(out);

  // The dry run: pass A's flags with --json-schema, 2 turns, no MCP server, and a child env without secrets.
  const dry = f.calls.find((c) => c.args[0] === "-p")!;
  assert.equal(dry.args[1], "reply ok");
  assert.ok(dry.args.includes("--json-schema"));
  assert.equal(dry.args[dry.args.indexOf("--max-turns") + 1], "2");
  assert.equal(dry.args[dry.args.indexOf("--tools") + 1], "Read,Grep,Glob,Bash");
  for (const k of ["ANTHROPIC_API_KEY", "PLANIA_RUNNER_TOKEN", "GITHUB_TOKEN", "MCP_READ_TOKEN"]) assert.equal(dry.env[k], undefined, `${k} is not passed to claude`);
});

test("check 6: failures are ✗ lines with the fix, still without values", async () => {
  // No tokens, no GitHub token file, claude without structured_output, no database.
  const bare = { HOME: scratch, PATH: "/usr/bin:/bin", CLAUDE_CODE_BIN: path.join(scratch, "bin", "claude"), PLANIA_GITHUB_TOKEN_FILE: path.join(scratch, "none") } as NodeJS.ProcessEnv;
  const noStructured = FIXTURE.split("\n")
    .filter(Boolean)
    .map((l) => {
      const e = JSON.parse(l) as Record<string, unknown>;
      if (e.type === "result") delete e.structured_output;
      return JSON.stringify(e);
    })
    .join("\n");
  const lines = await runDoctor(null, { env: bare, exec: fakeExec({ stdout: noStructured }).exec });
  const out = formatDoctor(lines);
  assert.match(out, /✗ claude logged in, but the result event has no structured_output/);
  assert.match(out, /✗ read token set: add PLANIA_BRIEF_TOKEN/);
  assert.match(out, /✗ runner token set: add PLANIA_RUNNER_TOKEN/);
  assert.match(out, /✗ GitHub token readable/);
  assert.match(out, /✗ migration 0045 applied: the database is not reachable/);
  noValues(out);

  // A logged-out claude and a missing claude.
  const loggedOut = JSON.stringify({ type: "result", subtype: "success", is_error: true, num_turns: 0, result: "Invalid API key · Please run /login" });
  assert.match(formatDoctor(await runDoctor(db, { env, exec: fakeExec({ stdout: loggedOut }).exec })), /✗ claude logged in: not logged in/);
  const missing: ExecFn = async () => {
    throw new Error("ENOENT");
  };
  const m = formatDoctor(await runDoctor(db, { env, exec: missing }));
  assert.match(m, /✗ claude found/);
  assert.match(m, /✗ claude logged in: skipped, claude was not found/);

  // The migration not applied.
  await raw.query(`alter table brief_checks rename to brief_checks_off`);
  try {
    assert.match(formatDoctor(await runDoctor(db, { env, exec: fakeExec().exec })), /✗ migration 0045 applied: 1 of 5 tables missing/);
  } finally {
    await raw.query(`alter table brief_checks_off rename to brief_checks`);
  }
});

test("check 6: the script prints the lines and exits 1 on a ✗ (fake claude on PATH, test DB, --skip-claude)", async () => {
  const bin = path.join(scratch, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "claude"), "#!/bin/sh\necho '2.1.302 (Claude Code)'\n");
  chmodSync(path.join(bin, "claude"), 0o755);
  const childEnv = { ...process.env, ...env, DATABASE_URL: TEST_DATABASE_URL, PLANIA_JOBS: "0" };
  const res = await new Promise<{ code: number | null; stdout: string }>((resolve) =>
    execFile(process.execPath, ["--import", "tsx", "scripts/brief-doctor.ts", "--skip-claude"], { env: childEnv, cwd: path.resolve(import.meta.dirname, "..") }, (err, stdout) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout) }),
    ),
  );
  const lines = res.stdout.trim().split("\n");
  assert.equal(lines.length, 11);
  for (const l of lines) assert.match(l, /^[✓✗] /);
  assert.match(res.stdout, /✓ claude logged in: skipped \(--skip-claude\)/);
  assert.equal(res.code, 1, "filmia's repo is missing");
  noValues(res.stdout);
});
