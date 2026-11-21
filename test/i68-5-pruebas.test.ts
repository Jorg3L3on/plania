// PLA-I68-5: GitHub's tests from Camino. Every warning shows on a workflow that has the problem and its fix removes it;
// edits keep comments and touch only the intended lines; a workflow Camino proposes passes actionlint (and actionlint's
// errors block the PR); turning a workflow off is a change GitHub applies; a renamed required check is caught before
// it can block merges; runs, flaky ones and the dependency bot. A fake GitHub; actionlint runs when it is installed.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const keys = await import("../src/camino/keys.js");
const { caminoDeps } = await import("../src/camino/store.js");
const { applyChanges, rerunFailed, resolvePins } = await import("../src/camino/changes.js");
const { runActionlint } = await import("../src/camino/actionlint.js");
const CI = (await import(new URL("../ui/src/lib/camino-ci.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino-ci.js");
const CM = (await import(new URL("../ui/src/lib/camino-commits.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino-commits.js");
const { DEFAULT_COMMITS } = await import("../src/camino/config.js");

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "t", session_id: "s-i68-5", machine: "ci" } };
const REPO = "acme/zigzag";
const lintAvailable = (await runActionlint(".github/workflows/x.yml", "name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n")).available;

let calls: { method: string; path: string }[] = [];
const ok = (data: unknown, status = 200) => ({ status, headers: { get: () => null }, json: async () => data });
const fakeFetch = async (url: string, init?: { method?: string }) => {
  const method = init?.method ?? "GET";
  const p = url.replace("https://api.github.com", "");
  calls.push({ method, path: p });
  if (p.startsWith("/repos/actions/checkout/commits/v4")) return ok({ sha: "b4ffde65f46336ab88eb53be808477a3936bae11" });
  if (p.startsWith("/repos/actions/setup-node/commits/")) return ok({ message: "No commit found" }, 422);
  if (p.includes("/actions/workflows/7/disable") || p.includes("/actions/runs/55/rerun-failed-jobs")) return ok(null, 204);
  return ok({ message: "Not Found" }, 404);
};

const WF = `name: CI
# Runs on every PR. Keep this comment.
on:
  pull_request:
    branches: [sandbox, main]
    paths: ["src/**"]
  schedule:
    - cron: "0 3 * * 1"
jobs:
  check:
    name: Build and tests
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    steps:
      - uses: actions/checkout@v4 # the code
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm test
        continue-on-error: true
      - run: npm run build
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}
`;

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  keys.useCaminoKeyStore(new keys.MemoryCaminoKeyStore());
  Object.assign(caminoDeps, { fetch: fakeFetch, env: { ...process.env, GITHUB_TOKEN: "ghp_test" }, now: () => new Date(), listDatabases: async () => [] });
  const p = await findProject(db, "zigzag");
  await setProject(db, { project: "zigzag", version: p.version, settings: { github: { repo: REPO } } }, ctx);
});
after(async () => {
  keys.useCaminoKeyStore(null);
  await closeDb?.();
  await raw?.end();
});

const changedLines = (a: string, b: string) => {
  const A = a.split("\n");
  const B = b.split("\n");
  return { removed: A.filter((l) => !B.includes(l)), added: B.filter((l) => !A.includes(l)) };
};

describe("reading a workflow", () => {
  test("triggers, permissions, secrets, jobs, matrix names, pins", () => {
    const wf = CI.readWorkflow(".github/workflows/ci.yml", WF);
    assert.equal(wf.name, "CI");
    assert.deepEqual(wf.on.pr, ["sandbox", "main"]);
    assert.equal(wf.on.paths, true);
    assert.deepEqual(wf.on.schedule, ["0 3 * * 1"]);
    assert.equal(wf.permissions, "unset");
    assert.equal(wf.cancels, false);
    assert.deepEqual(wf.secrets, ["DATABASE_URL"]);
    assert.deepEqual(wf.checkNames, ["Build and tests (ubuntu-latest)", "Build and tests (macos-latest)"]);
    assert.deepEqual(wf.actions.map((a) => a.pinned), [false, false]);
    assert.equal(wf.jobs[0]!.steps[3]!.cont, true);
    assert.equal(CI.readWorkflow("x", "on: [push\n").error !== null, true);
  });
});

describe("every warning shows where the problem is, and its fix removes it", () => {
  const ctxW = { required: ["Build and tests"], publicRepo: true, quietDays: 90 };
  test("all nine on the bad workflow", () => {
    const ids = CI.warnings(CI.readWorkflow("ci", WF), ctxW, "es").map((w) => w.id);
    assert.deepEqual(ids.sort(), ["cancel", "continue", "matrix", "paths", "permissions", "schedule", "secret", "timeout", "unpinned"]);
    const withPaths = CI.warnings(CI.readWorkflow("ci", WF), { ...ctxW, required: ["Build and tests (ubuntu-latest)"] }, "es").map((w) => w.id);
    assert.ok(withPaths.includes("paths"), "a required job with path filters");
  });

  test("each fix is an edit that makes its warning go away", () => {
    const shas = { "actions/checkout@v4": "b4ffde65f46336ab88eb53be808477a3936bae11", "actions/setup-node@v4": "1".repeat(40) };
    const req = { ...ctxW, required: ["Build and tests (ubuntu-latest)"] };
    for (const w of CI.warnings(CI.readWorkflow("ci", WF), req, "es")) {
      const after = CI.fixEdit(w.id, WF, CI.readWorkflow("ci", WF), shas);
      assert.notEqual(after, WF, w.id);
      const left = CI.warnings(CI.readWorkflow("ci", after), w.id === "matrix" ? { ...req, required: ["ci-ok"] } : req, "es").map((x) => x.id);
      assert.ok(!left.includes(w.id), `${w.id} still there`);
      assert.ok(after.includes("# Runs on every PR. Keep this comment."), `${w.id} kept the comment`);
    }
  });

  test("a clean workflow has none", () => {
    const clean = CI.newWorkflow(["lint", "test", "build", "dev"], "pnpm", ["sandbox"]);
    const pinned = CI.edits.pin(clean, { "actions/checkout@v4": "a".repeat(40), "pnpm/action-setup@v4": "b".repeat(40), "actions/setup-node@v4": "c".repeat(40) });
    assert.deepEqual(CI.warnings(CI.readWorkflow("ci", pinned), { required: ["ci-ok"], publicRepo: true, quietDays: 1 }, "es"), []);
    assert.doesNotMatch(clean, /run dev|pnpm dev/);
  });
});

describe("edits keep everything they do not mean to change", () => {
  test("pause, remove, move, add, pin: only the intended lines", () => {
    let d = changedLines(WF, CI.edits.stepPause(WF, "check", 2));
    // PLA-I70-42: the pause also leaves a comment line saying why the step never runs.
    assert.deepEqual(d.removed, ["      - run: npm ci"]);
    assert.equal(d.added.length, 3);
    assert.match(d.added[0]!, /^ {6}# Paused from Plania \(Camino\)/);
    assert.deepEqual(d.added.slice(1), ["      - if: ${{ github.event_name == 'camino-paused' }}", "        run: npm ci"]);
    assert.equal(CI.readWorkflow("ci", CI.edits.stepPause(WF, "check", 2)).jobs[0]!.steps[2]!.off, true);
    d = changedLines(WF, CI.edits.stepRemove(WF, "check", 4));
    assert.deepEqual(d.removed, ["      - run: npm run build", "        env:", "          DATABASE_URL: ${{ secrets.DATABASE_URL }}"]);
    assert.deepEqual(d.added, []);
    const moved = CI.edits.stepMove(WF, "check", 3, 1);
    assert.ok(moved.indexOf("npm run build") < moved.indexOf("npm test"));
    assert.deepEqual(changedLines(WF, CI.edits.stepAdd(WF, "check", "npm run lint")).added, ["      - run: npm run lint"]);
    const pinned = CI.edits.pin(WF, { "actions/checkout@v4": "b4ffde65f46336ab88eb53be808477a3936bae11" });
    assert.deepEqual(changedLines(WF, pinned), { removed: ["      - uses: actions/checkout@v4 # the code"], added: ["      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4 · the code"] });
    assert.equal(CI.edits.stepPause(CI.edits.stepPause(WF, "check", 2), "check", 2), WF, "pause twice is resume");
  });

  test("a renamed or removed required check is caught; turning a workflow off says what it leaves unrun", () => {
    const renamed = WF.replace("name: Build and tests", "name: Build");
    assert.deepEqual(CI.lostRequired(WF, renamed, "ci", ["Build and tests (ubuntu-latest)", "other"]), ["Build and tests (ubuntu-latest)"]);
    assert.deepEqual(CI.lostRequired(WF, null, "ci", ["Build and tests (macos-latest)"]), ["Build and tests (macos-latest)"]);
    assert.deepEqual(CI.lostRequired(WF, CI.edits.okJob(WF), "ci", ["Build and tests (ubuntu-latest)"]), [], "adding ci-ok loses nothing");
    assert.deepEqual(CI.requiredIn(WF, "ci", ["Build and tests (ubuntu-latest)", "x"]), ["Build and tests (ubuntu-latest)"]);
  });
});

describe("actionlint", () => {
  test("what Camino writes passes it: a new workflow, the PR-title check, the patch auto-merge", { skip: !lintAvailable && "actionlint is not installed here" }, async () => {
    for (const [p, text] of [
      [".github/workflows/ci.yml", CI.newWorkflow(["lint", "typecheck", "test", "build"], "npm", ["sandbox", "main"])],
      [".github/workflows/pr-title.yml", CM.prTitleWorkflow("conventional", { ...DEFAULT_COMMITS, convention: "conventional" })!],
      [".github/workflows/dependabot-auto-merge.yml", CI.AUTO_PATCH_YML],
      [".github/workflows/ci.yml", CI.fixEdit("matrix", WF, CI.readWorkflow("ci", WF))],
      [".github/workflows/ci.yml", CI.edits.stepPause(WF, "check", 2)],
    ] as const) {
      const out = await runActionlint(p, text);
      assert.deepEqual(out.errors, [], `${p}: ${JSON.stringify(out.errors)}`);
    }
    const bad = await runActionlint(".github/workflows/x.yml", "name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ github.nope.x }}\n");
    assert.equal(bad.errors.length, 1);
  });

  test("its errors block the PR before anything is created on GitHub", async () => {
    const lint = caminoDeps.actionlint;
    caminoDeps.actionlint = async () => ({ available: true, errors: [{ line: 7, column: 23, message: 'property "nope" is not defined', kind: "expression" }] });
    calls = [];
    const p = await findProject(db, "zigzag");
    const v = Number((await raw.query(`select coalesce((select version from camino where project_id = $1), 0) as v`, [p.id])).rows[0].v);
    const out = await applyChanges(db, "zigzag", { version: v, changes: [{ kind: "file_pr", label: "Cambiar ci.yml", path: ".github/workflows/ci.yml", content: "x", base: "main", title: "ci: x", body: "" }] });
    caminoDeps.actionlint = lint;
    assert.equal(out.stopped?.error, "CAMINO_ACTIONLINT");
    assert.equal((out.stopped?.detail as any).errors[0].line, 7);
    assert.equal(calls.length, 0, "no branch, no file, no PR");
  });
});

describe("GitHub actions on workflows and runs", () => {
  test("turning a workflow off is a change GitHub applies, with how to undo it", async () => {
    const p = await findProject(db, "zigzag");
    const v = Number((await raw.query(`select coalesce((select version from camino where project_id = $1), 0) as v`, [p.id])).rows[0].v);
    calls = [];
    const out = await applyChanges(db, "zigzag", { version: v, changes: [{ kind: "workflow_state", label: "Apagar «CI» en GitHub", id: 7, name: "CI", enable: false }] });
    assert.equal(out.applied, 1);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [`PUT /repos/${REPO}/actions/workflows/7/disable`]);
    assert.equal((await raw.query(`select undo from camino_history order by at desc limit 1`)).rows[0].undo, "Encender «CI» en Pruebas");
  });

  test("pins resolve tags to commits; an unknown tag is left out", async () => {
    const p = await findProject(db, "zigzag");
    assert.deepEqual(await resolvePins(p, ["actions/checkout@v4", "actions/setup-node@v99"]), { "actions/checkout@v4": "b4ffde65f46336ab88eb53be808477a3936bae11" });
  });

  test("re-running what failed asks GitHub and says so in Historial", async () => {
    const p = await findProject(db, "zigzag");
    calls = [];
    assert.deepEqual(await rerunFailed(db, p, 55), { rerun: true });
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [`POST /repos/${REPO}/actions/runs/55/rerun-failed-jobs`]);
  });

  test("flaky runs and minutes", () => {
    const run = (id: number, sha: string, conclusion: string, mins: number) => ({ id, name: "CI", branch: "main", event: "push", conclusion, status: "completed", head_sha: sha, created_at: "2026-11-20T00:00:00Z", updated_at: new Date(Date.parse("2026-11-20T00:00:00Z") + mins * 60000).toISOString(), url: "", workflow_id: 1 });
    const runs = [run(1, "a", "failure", 3), run(2, "a", "success", 4), run(3, "b", "failure", 2)];
    assert.deepEqual([...CI.flaky(runs)].sort(), [1, 2]);
    assert.equal(CI.minutesOf(runs), 9);
  });
});

describe("the dependency bot", () => {
  test("its file says the interval, the target branch and the grouping; unsafe scripts never become a step", () => {
    const y = CI.dependabotYml({ on: true, interval: "weekly", target: "sandbox", group: true, auto_patch: false }, ["npm", "github-actions"]);
    assert.match(y, /package-ecosystem: npm\n {4}directory: "\/"\n {4}schedule:\n {6}interval: weekly\n {4}target-branch: sandbox\n {4}groups:/);
    assert.match(y, /package-ecosystem: github-actions/);
    for (const s of ["dev", "start", "deploy", "db:migrate", "db:push", "migrate", "release", "publish:npm"]) assert.ok(CI.UNSAFE_SCRIPT.test(s), s);
    for (const s of ["lint", "test", "test:db", "build", "typecheck", "check:migrations"]) assert.ok(!CI.UNSAFE_SCRIPT.test(s), s);
  });
});
