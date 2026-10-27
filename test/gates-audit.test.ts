// PLA-I8-3: three audit findings, and protocol 2.13 under 900 words.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { auditProject } = await import("../src/mcp/audit.js");
const { createTask } = await import("../src/mcp/writes.js");
const { findProject } = await import("../src/mcp/queries.js");
const { instructions, PROTOCOL_VERSION } = await import("../src/mcp/protocol.js");
const { WEB_ACTOR } = await import("../src/mcp/tx.js");

const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const ctx = { actor: A };
const SCREEN = JSON.stringify(WEB_ACTOR);
const AGENT = JSON.stringify(A);

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let projectId: string;
let ideaId: string;
let stageIdeaId: string;
let ticketId: string;

const codes = async (code: string) => {
  const p = await findProject(db, "filmia");
  return (await auditProject(db, p)).filter((f) => f.code === code);
};

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  const idea = await createTask(db, { project: "filmia", kind: "idea", title: "Gate answers" }, ctx);
  const stage = await createTask(db, { project: "filmia", kind: "idea", title: "Stage docs" }, ctx);
  const ticket = await createTask(db, { project: "filmia", title: "Ship it", scope: "s", checks: ["c"] }, ctx);
  assert.deepEqual([idea.key, stage.key, ticket.key], ["FIL-IDEA1", "FIL-IDEA2", "FIL-01"]);
  const p = await findProject(db, "filmia");
  projectId = p.id;
  const ids = await raw.query("select key, id from tasks where project_id = $1 and key = any($2)", [projectId, [idea.key, stage.key, ticket.key]]);
  const byKey = Object.fromEntries(ids.rows.map((r) => [r.key, r.id as string]));
  ideaId = byKey[idea.key];
  stageIdeaId = byKey[stage.key];
  ticketId = byKey[ticket.key];
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

describe("protocol 2.13", () => {
  test("gates are screen-only, and the text stays under 900 words", () => {
    const text = instructions(false);
    assert.equal(PROTOCOL_VERSION, "2.13");
    assert.ok(text.split(/\s+/).length < 900, `${text.split(/\s+/).length} words`);
    assert.match(text, /Gates A, B and C are answered only on the screen with the authenticator code/);
    assert.match(text, /Never answer a gate, and never forward an answer/);
  });
});

describe("PR_WITHOUT_PLANIA_KEY", () => {
  test("a linked PR with no key in the title or branch is flagged; a key, or no link, is not", async () => {
    await raw.query(
      `insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_branch)
       values ($1, 'Jorg3L3on/filmia', 40, 'https://github.com/Jorg3L3on/filmia/pull/40', 'Ratings', $2, 'open', 'jl/ratings')`,
      [projectId, ticketId],
    );
    const hit = await codes("PR_WITHOUT_PLANIA_KEY");
    assert.equal(hit.length, 1);
    assert.equal(hit[0]!.key, "FIL-01");
    assert.match(hit[0]!.detail, /PR #40/);
    assert.match(hit[0]!.detail, /jl\/ratings/);
    assert.match(hit[0]!.fix_hint, /title or head branch/);

    // The body is not stored. The key in the title clears it; so does the project's standalone shape in the branch.
    await raw.query("update pull_requests set title = 'FIL-01 ratings' where number = 40");
    assert.equal((await codes("PR_WITHOUT_PLANIA_KEY")).length, 0);
    await raw.query("update pull_requests set title = 'Ratings', head_branch = 'jl/fil-01' where number = 40");
    assert.equal((await codes("PR_WITHOUT_PLANIA_KEY")).length, 0);
    // A Plania-shaped key from another prefix counts too (PLA-I8-3), even when it is not a task here.
    await raw.query("update pull_requests set title = 'PLA-I8-3 ship', head_branch = 'jl/ratings' where number = 40");
    assert.equal((await codes("PR_WITHOUT_PLANIA_KEY")).length, 0);

    await raw.query("update pull_requests set title = 'Ratings', head_branch = 'jl/ratings', task_id = null where number = 40");
    await raw.query("update tasks set pr_url = null where id = $1", [ticketId]);
    assert.equal((await codes("PR_WITHOUT_PLANIA_KEY")).length, 0, "an unlinked row is not a finding");

    // Linked only by the ticket's pr_url, with an empty title and no branch: the minimum stored PR.
    await raw.query("update tasks set pr_url = 'https://github.com/Jorg3L3on/filmia/pull/40' where id = $1", [ticketId]);
    await raw.query("update pull_requests set title = '', head_branch = null where number = 40");
    const viaUrl = await codes("PR_WITHOUT_PLANIA_KEY");
    assert.equal(viaUrl.length, 1);
    assert.equal(viaUrl[0]!.key, "FIL-01");
    assert.match(viaUrl[0]!.detail, /PR #40/);
  });
});

describe("GATE_ANSWERED_BY_AGENT", () => {
  test("a gate answered by an agent is flagged; a screen answer, or a question that is not a gate, is not", async () => {
    const agent = await raw.query(
      `insert into questions (project_id, task_id, question, options, gate, human_only, asked_by, answer, answered_by, answered_at)
       values ($1, $2, 'Puerta A', '{pursue,drop,later}', 'A', false, $3::jsonb, 'pursue', $3::jsonb, '2026-01-02T00:00:00Z')
       returning id`,
      [projectId, ideaId, AGENT],
    );
    const screen = await raw.query(
      `insert into questions (project_id, task_id, question, options, gate, human_only, asked_by, answer, answered_by, answered_at)
       values ($1, $2, 'Puerta B', '{proceed,rework,drop}', 'B', true, $3::jsonb, 'proceed', $4::jsonb, '2026-01-03T00:00:00Z')
       returning id`,
      [projectId, ideaId, AGENT, SCREEN],
    );
    await raw.query(
      `insert into questions (project_id, task_id, question, asked_by, answer, answered_by, answered_at)
       values ($1, $2, 'Which size?', $3::jsonb, 'large', $3::jsonb, '2026-01-04T00:00:00Z')`,
      [projectId, ideaId, AGENT],
    );
    const hit = await codes("GATE_ANSWERED_BY_AGENT");
    assert.equal(hit.length, 1);
    assert.equal(hit[0]!.key, "FIL-IDEA1");
    assert.equal(hit[0]!.id, agent.rows[0].id);
    assert.match(hit[0]!.detail, /gate A answered by test-agent\/ci/);
    assert.equal(hit.some((f) => f.id === screen.rows[0].id), false);

    await raw.query("update questions set answered_by = $1::jsonb where id = $2", [SCREEN, agent.rows[0].id]);
    assert.equal((await codes("GATE_ANSWERED_BY_AGENT")).length, 0);
  });
});

describe("STAGE_DOC_STALE", () => {
  test("a stage doc older than the next gate is stale; a Plan rewritten after gate C is stale; equal clocks are not", async () => {
    const actor = JSON.stringify(A);
    await raw.query(
      `insert into docs (project_id, task_id, title, markdown, version, actor, updated_at) values
       ($1, $2, 'Idea', 'problem', 1, $3::jsonb, '2026-01-01T00:00:00Z'),
       ($1, $2, 'Research', 'learned', 1, $3::jsonb, '2026-01-01T00:00:00Z'),
       ($1, $2, 'Plan', 'steps', 2, $3::jsonb, '2026-08-01T00:00:00Z')`,
      [projectId, stageIdeaId, actor],
    );
    await raw.query(
      `insert into questions (project_id, task_id, question, options, gate, human_only, asked_by, answer, answered_by, answered_at) values
       ($1, $2, 'B', '{proceed,rework,drop}', 'B', true, $3::jsonb, 'proceed', $4::jsonb, '2026-06-01T00:00:00Z'),
       ($1, $2, 'C', '{ready,rework,drop}', 'C', true, $3::jsonb, 'ready', $4::jsonb, '2026-07-01T00:00:00Z')`,
      [projectId, stageIdeaId, AGENT, SCREEN],
    );
    await raw.query(
      `insert into docs (project_id, task_id, title, markdown, version, actor, updated_at)
       values ($1, $2, 'Notes', 'not a stage doc', 1, $3::jsonb, '2020-01-01T00:00:00Z')`,
      [projectId, stageIdeaId, actor],
    );
    const stale = async () => (await codes("STAGE_DOC_STALE")).filter((f) => f.key === "FIL-IDEA2").map((f) => f.detail).sort();
    const first = await stale();
    // Research's next gate is C: design has none. Plan is the version rule (newer than C), not the age rule.
    assert.deepEqual(first.map((d) => d.replace(/ \(.*\)$/, "")), [
      "Idea v1 is older than gate B",
      "Plan v2 changed after gate C approved it",
      "Research v1 is older than gate C",
    ]);
    await raw.query(
      `update docs set updated_at = case title
         when 'Idea' then '2026-06-01T00:00:00Z'
         when 'Research' then '2026-07-01T00:00:00Z'
         when 'Plan' then '2026-07-01T00:00:00Z'
         else updated_at end
       where task_id = $1`,
      [stageIdeaId],
    );
    assert.deepEqual(await stale(), [], "equal to the gate clock is not stale");
  });
});
