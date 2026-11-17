// PLA-I41-6: pnpm brief:doctor (spec §9): one ✓/✗ line per check, never a value. A fake exec stands in for claude
// (the real dry run is never made in tests); the store is the throwaway test store.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { formatDoctor, runDoctor } = await import("../src/brief/doctor.js");
type ExecFn = import("../src/brief/doctor.js").ExecFn;

type Db = ReturnType<typeof makeDb>["db"];
let store: TestStore;
let db: Db;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-brief-doctor-test-"));
const FIXTURE = readFileSync(new URL("./fixtures/claude/structured-output-2.1.302.jsonl", import.meta.url), "utf8");
const SECRETS = { PLANIA_BRIEF_TOKEN: "brief-secret-value-123", PLANIA_RUNNER_TOKEN: "runner-secret-value-456", GITHUB_TOKEN: "ghp_secretvalue789", MCP_READ_TOKEN: "read-secret-000" };
const root = path.join(scratch, "projects");
const env = { HOME: scratch, PATH: "/usr/bin:/bin", CLAUDE_CODE_BIN: path.join(scratch, "bin", "claude"), PLANIA_PROJECTS_ROOT: root, PLANIA_HOME_PROJECT: "workia", ANTHROPIC_API_KEY: "sk-ant-secret", ...SECRETS } as NodeJS.ProcessEnv;

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
  store = await resetTestStore();
  ({ db } = makeDb());
  for (const slug of ["micasa", "workia", "zigzag"]) mkdirSync(path.join(root, slug), { recursive: true });
  // Product owners: po-<slug> for two, a product-owner agent by project_id for the third, none for filmia.
  const zigzag = await store.projectId("zigzag");
  await store.fix(async (uow) => {
    await uow.insert("agents", { slug: "po-micasa", name: "PO MiCasa", role: "product-owner", kind: "bot" });
    await uow.insert("agents", { slug: "po-workia", name: "PO Workia", role: "product-owner", kind: "bot" });
    await uow.insert("agents", { slug: "owner-zz", name: "ZZ owner", role: "product-owner", kind: "bot", projectId: zigzag, roleTemplate: "product-owner" });
    await uow.insert("agents", { slug: "po-filmia", name: "PO Filmia (old)", role: "product-owner", kind: "bot", status: "retired" });
  });
});

after(async () => {
  await store.end();
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
      [true, "brief settings"],
      [true, "time zone valid"],
      [false, "product owner for filmia"],
      [true, "product owner for micasa"],
      [true, "product owner for workia"],
      [true, "product owner for zigzag"],
      [true, "home project for cross ideas exists"],
      [true, "store open"],
      [true, "prompts folder present"],
    ],
  );
  assert.match(out, /✓ claude found \(version 2\.1\.302\)/);
  noValues(out);

  // The dry run: pass A's flags with --json-schema, 2 turns, no MCP server, and a child env without secrets.
  const dry = f.calls.find((c) => c.args[0] === "-p")!;
  assert.equal(dry.args[1], "reply ok");
  assert.ok(dry.args.includes("--json-schema"));
  // PLA-I44-2: the dry run sends pass A's own schema (without $schema), so a schema the CLI refuses shows up here.
  const { readSchemaText } = await import("../src/brief/prompts.js");
  assert.equal(dry.args[dry.args.indexOf("--json-schema") + 1], readSchemaText("brief"));
  assert.equal(dry.args[dry.args.indexOf("--max-turns") + 1], "2");
  assert.equal(dry.args[dry.args.indexOf("--tools") + 1], "Read,Grep,Glob,Bash");
  for (const k of ["ANTHROPIC_API_KEY", "PLANIA_RUNNER_TOKEN", "GITHUB_TOKEN", "MCP_READ_TOKEN"]) assert.equal(dry.env[k], undefined, `${k} is not passed to claude`);
});

test("check 6: failures are ✗ lines with the fix, still without values", async () => {
  // No tokens, no GitHub token file, claude without structured_output, no store.
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
  assert.match(out, /✗ repo paths: skipped, the store is not open/);
  assert.match(out, /✗ store open: the devva engine is not answering/);
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
});

test("check 6: the script prints the lines and exits 1 on a ✗ (fake claude on PATH, test store, --skip-claude)", async () => {
  const bin = path.join(scratch, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "claude"), "#!/bin/sh\necho '2.1.302 (Claude Code)'\n");
  chmodSync(path.join(bin, "claude"), 0o755);
  // The script opens the store on this file's test lobes: the prefix resetTestStore (test/helpers.ts) gives them.
  const prefix = `t_${createHash("sha1").update(`${import.meta.dirname}|${process.argv[1] ?? ""}`).digest("hex").slice(0, 10)}`;
  const childEnv = { ...process.env, ...env, PLANIA_DEVVA_PREFIX: prefix, PLANIA_JOBS: "0" };
  const res = await new Promise<{ code: number | null; stdout: string }>((resolve) =>
    execFile(process.execPath, ["--import", "tsx", "scripts/brief-doctor.ts", "--skip-claude"], { env: childEnv, cwd: path.resolve(import.meta.dirname, "..") }, (err, stdout) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout) }),
    ),
  );
  const lines = res.stdout.trim().split("\n");
  assert.equal(lines.length, 18);
  for (const l of lines) assert.match(l, /^[✓✗] /);
  assert.match(res.stdout, /✓ claude logged in: skipped \(--skip-claude\)/);
  assert.equal(res.code, 1, "filmia's repo is missing");
  noValues(res.stdout);
});

// PLA-I44-2: the §9 settings and Send to Plania rows: first-run defaults vs saved, on/off, the zone, each included
// project's product owner (a retired one does not count), the home project. Still no values.
test("§9 rows: settings, time zone, product owners, home project", async () => {
  const f = fakeExec();
  let out = formatDoctor(await runDoctor(db, { env, exec: f.exec, skipClaudeRun: true }));
  assert.match(out, /✓ brief settings: first-run defaults \(on, runs at 07:00, every project included, no hidden refs\)/);
  assert.match(out, /✓ time zone valid \(the default; set it on \/brief or with PLANIA_TZ\)/);
  assert.match(out, /✗ product owner for filmia: none \(Send to Plania needs po-filmia; create_company_project or scripts\/seed-org.ts makes it\)/);
  assert.match(out, /✓ home project for cross ideas exists/);

  out = formatDoctor(await runDoctor(db, { env: { ...env, PLANIA_TZ: "Mars/Olympus", PLANIA_HOME_PROJECT: "nowhere" }, exec: f.exec, skipClaudeRun: true }));
  assert.match(out, /✗ time zone valid: PLANIA_TZ is not an IANA zone/);
  assert.match(out, /✗ home project for cross ideas exists: no project with that slug/);
  assert.doesNotMatch(out, /Mars|nowhere/, "the env values are not printed");

  // Saved, off, a zone of its own; filmia left out of the brief, so its missing PO and repo no longer count.
  const { saveBriefSettings } = await import("../src/brief/settings.js");
  await saveBriefSettings(db, { enabled: false, timezone: "Europe/Lisbon", projects: { filmia: { include: false } } });
  try {
    const lines = await runDoctor(db, { env, exec: f.exec, skipClaudeRun: true });
    out = formatDoctor(lines);
    assert.match(out, /✓ brief settings saved \(off: no daily run, Generate now still works\)/);
    assert.match(out, /✓ time zone valid \(brief settings\)/);
    assert.doesNotMatch(out, /filmia/);
    assert.ok(lines.every((l) => l.ok), out);
    noValues(out);
  } finally {
    await store.fix((uow) => uow.delete("briefSettings", {}));
  }
});
