// v2 backfill: v1 data moves into the v2 shape. Dry-run writes nothing; --apply is idempotent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { STAGES, parseLegacyClaim, parseV1Body, runStage } = await import("../scripts/backfill-v2.js");

const F4_BODY = readFileSync(new URL("./fixtures/fil-01-f4.body.md", import.meta.url), "utf8").trimEnd();

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;

const stage = (name: string) => STAGES.find((s) => s.name === name)!;

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  // A v1 ticket as it exists in filmia: In progress, claimed by a note.
  await raw.query(
    `insert into tasks (project_id, kind, key, title, body, status, priority, origin, branch)
     select id, 'ticket', 'FIL-01-F4', 'Frontend lockdown', $1, 'In progress', 'P2', 'chartered', 'jl/catalog-frontend'
     from projects where slug = 'filmia'`,
    [F4_BODY],
  );
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

describe("body", () => {
  test("FIL-01-F4 parses into phase 4, 5 checks and its claim note; the rest stays in scope", () => {
    const parsed = parseV1Body(F4_BODY, "ticket");
    assert.equal(parsed.phase, 4);
    assert.equal(parsed.checks.length, 5);
    assert.ok(parsed.checks.every((c) => !c.done));
    assert.match(parsed.checks[0]!.text, /^`npm run lint/);
    assert.deepEqual(parsed.notes.map((n) => n.date), ["2026-10-07", "2026-10-06", "2026-10-06", "2026-10-07"]);
    assert.match(parsed.notes[0]!.text, /^claimed by Claude Code/);
    // Two Results inside one note, a third on its own.
    assert.deepEqual(parsed.results.map((r) => [r.kind, r.verdict]), [["test", "pass"], ["live", "pass"], ["live", "pass"]]);
    assert.match(parsed.results[0]!.cite, /^npm run lint, typecheck, test \(202\/202.*en verde\.$/);
    assert.match(parsed.scope, /^Phase 4 \(se hace PRIMERO/);
    assert.match(parsed.scope, /## Alcance/);
    assert.doesNotMatch(parsed.scope, /Done when|claimed by|- \[ \]/);
  });

  test("Result notes become results; ticked boxes stay done; stray Done when lines are kept", () => {
    const parsed = parseV1Body(
      ["Phase 2", "## Done when", "- [x] tests", "- [ ] PR", "Note under the list", "",
        "- 2026-10-06 · Result: ✓ unit — 12 tests pass", "- 2026-10-06 · Result: ⚠ live — slow on 3G"].join("\n"),
      "ticket",
    );
    assert.deepEqual(parsed.checks, [{ text: "tests", done: true }, { text: "PR", done: false }]);
    assert.deepEqual(parsed.results.map((r) => [r.kind, r.verdict, r.cite]), [["unit", "pass", "12 tests pass"], ["live", "warn", "slow on 3G"]]);
    assert.equal(parsed.scope, "Phase 2\n\n## Done when (v1 notes)\nNote under the list");
  });

  test("apply fills scope, checks, dated notes and results once; body is untouched", async () => {
    const dry = await runStage(db, stage("body"), { apply: false, project: "filmia" });
    assert.deepEqual(dry[0]!.lines, ["FIL-01-F4: phase 4, scope " + parseV1Body(F4_BODY, "ticket").scope.length + " chars, 5 checks (0 done), 4 notes, 3 results"]);
    await runStage(db, stage("body"), { apply: true, project: "filmia" });
    const { rows } = await raw.query("select scope, phase, body from tasks where key = 'FIL-01-F4'");
    assert.equal(rows[0].phase, 4);
    assert.equal(rows[0].body, F4_BODY);
    const { rows: n } = await raw.query("select created_at, payload from events where task_key = 'FIL-01-F4' and type = 'note' order by id");
    assert.equal(n[0].created_at.toISOString(), "2026-10-07T18:00:00.000Z");
    assert.equal(n[0].payload.legacy, true);
    const { rows: c } = await raw.query("select count(*)::int as n from checks");
    assert.equal(c[0].n, 5);
    assert.equal((await runStage(db, stage("body"), { apply: true, project: "filmia" }))[0]!.skipped, true);
  });
});

describe("claims", () => {
  test("parses the last claimed-by note", () => {
    assert.deepEqual(parseLegacyClaim(F4_BODY), {
      agent: "Claude Code",
      detail: "sesión catalog split, worktree movie-database-design-64954a",
      worktree: "movie-database-design-64954a",
    });
  });

  test("a claim note may go on after the detail", () => {
    const body = "- 2026-10-07 · claimed by Claude Code (sesión catalog split). Decisión Jorge (opción 1): 0009 después.";
    assert.deepEqual(parseLegacyClaim(body), { agent: "Claude Code", detail: "sesión catalog split", worktree: null });
    assert.equal(parseLegacyClaim("- 2026-10-07 · claimed by Codex")?.agent, "Codex");
  });

  test("dry run reports and writes nothing", async () => {
    const report = await runStage(db, stage("claims"), { apply: false, project: "filmia" });
    assert.match(report[0]!.lines[0]!, /^FIL-01-F4: owner Claude Code \(legacy\)/);
    const { rows } = await raw.query("select owner from tasks where key = 'FIL-01-F4'");
    assert.equal(rows[0].owner, null);
  });

  test("apply gives a legacy lease with the workspace, once", async () => {
    await runStage(db, stage("claims"), { apply: true, project: "filmia" });
    const { rows } = await raw.query("select owner, workspace, lease_until, body from tasks where key = 'FIL-01-F4'");
    assert.deepEqual(rows[0].owner, { agent: "Claude Code", session_id: "legacy" });
    assert.deepEqual(rows[0].workspace, { branch: "jl/catalog-frontend", worktree_path: "movie-database-design-64954a" });
    const hours = (rows[0].lease_until.getTime() - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24);
    assert.equal(rows[0].body, F4_BODY, "body is never changed");
    const again = await runStage(db, stage("claims"), { apply: true, project: "filmia" });
    assert.equal(again[0]!.skipped, true);
  });
});

describe("resume", () => {
  test("pins the v1 must_keep_decision once; the card stays as legacy", async () => {
    await raw.query("update projects set resume_must_keep_decision = 'Plania es la fuente del plan.', resume_in_progress = 'x' where slug = 'workia'");
    const dry = await runStage(db, stage("resume"), { apply: false, project: "workia" });
    assert.deepEqual(dry[0]!.lines, ["add pinned decision: Plania es la fuente del plan."]);
    await runStage(db, stage("resume"), { apply: true, project: "workia" });
    await runStage(db, stage("resume"), { apply: true, project: "workia" });
    const { rows } = await raw.query(
      "select d.line, d.pinned from decisions d join projects p on p.id = d.project_id where p.slug = 'workia'",
    );
    assert.deepEqual(rows, [{ line: "Plania es la fuente del plan.", pinned: true }]);
    const { rows: card } = await raw.query("select resume_in_progress from projects where slug = 'workia'");
    assert.equal(card[0].resume_in_progress, "x");
  });

  test("pins an existing decision with the same text instead of adding one", async () => {
    await raw.query(
      `update projects set resume_must_keep_decision = 'Ya decidido' where slug = 'zigzag';
       insert into decisions (project_id, line) select id, 'Ya decidido' from projects where slug = 'zigzag'`,
    );
    await runStage(db, stage("resume"), { apply: true, project: "zigzag" });
    const { rows } = await raw.query(
      "select d.pinned from decisions d join projects p on p.id = d.project_id where p.slug = 'zigzag'",
    );
    assert.deepEqual(rows, [{ pinned: true }]);
  });
});

describe("sequences", () => {
  test("without --map lists the numbers each ticket mentions", async () => {
    await raw.query(
      `insert into tasks (project_id, kind, key, title, body, status, priority, origin)
       select id, 'ticket', 'FIL-02', 'Apply 0008', 'Correr la migración 0008 en Neon (2026-10-06).', 'Backlog', 'P2', 'chartered'
       from projects where slug = 'filmia'`,
    );
    const r = await runStage(db, stage("sequences"), { apply: false, project: "filmia" });
    assert.ok(r[0]!.lines.includes("FIL-02 mentions 0008"));
  });

  test("--map reserves the given numbers and moves the counter past them", async () => {
    await runStage(db, stage("sequences"), { apply: true, project: "filmia", map: "migration:0008=FIL-02,0010=FIL-01-F4" });
    const { rows } = await raw.query(
      `select r.value, t.key from sequence_reservations r join tasks t on t.id = r.task_id order by r.value`,
    );
    assert.deepEqual(rows, [{ value: 8, key: "FIL-02" }, { value: 10, key: "FIL-01-F4" }]);
    const { rows: seq } = await raw.query("select next_value from sequences where name = 'migration'");
    assert.equal(seq[0].next_value, 11);
  });
});

describe("decisions", () => {
  test("typed dates move to decided_on, a single key ties the task, a wrong day is flagged, --map links reversals", async () => {
    const { rows } = await raw.query(
      `insert into decisions (project_id, line, created_at)
       select id, x.line, x.at::timestamptz from projects, (values
         ('2026-10-06 · Quitar de Filmia con confirmación fuerte (#117)', '2026-10-06T20:00:00Z'),
         ('2026-10-07 · FIL-01-F4 va primero; ya no hay borrado', '2026-10-07T05:28:00Z')
       ) as x(line, at) where slug = 'filmia' returning decisions.id`,
    );
    const [older, newer] = rows.map((r) => r.id as string);
    const dry = await runStage(db, stage("decisions"), { apply: false, project: "filmia", map: `${newer!.slice(0, 8)}:${older!.slice(0, 8)}` });
    assert.deepEqual(dry[0]!.lines, [
      `${older!.slice(0, 8)}: decided_on 2026-10-06`,
      `${newer!.slice(0, 8)}: decided_on 2026-10-07 (FLAG: written on 2026-10-06 local)`,
      `${newer!.slice(0, 8)}: task FIL-01-F4`,
      `${newer!.slice(0, 8)} supersedes ${older!.slice(0, 8)}`,
    ]);
    await runStage(db, stage("decisions"), { apply: true, project: "filmia", map: `${newer!.slice(0, 8)}:${older!.slice(0, 8)}` });
    const { rows: after } = await raw.query(
      `select line, to_char(decided_on, 'YYYY-MM-DD') as day, task_id is not null as has_task,
         (select ds.supersedes_id from decision_supersessions ds where ds.decision_id = decisions.id) as supersedes_id
       from decisions where project_id = (select id from projects where slug = 'filmia') order by created_at`,
    );
    assert.deepEqual(after.map((r) => [r.line, r.day, r.has_task]), [
      ["Quitar de Filmia con confirmación fuerte (#117)", "2026-10-06", false],
      ["FIL-01-F4 va primero; ya no hay borrado", "2026-10-07", true],
    ]);
    assert.equal(after[1].supersedes_id, older);
  });
});
