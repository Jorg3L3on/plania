// PLA-I8-3 findings, after PLA-I18 removed the gate ones; protocol under 900 words.
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

describe("protocol 2.17", () => {
  test("no gates, human_only is a click on the screen, the delegated path is honest, and the text stays under 900 words", () => {
    const text = instructions(false);
    assert.equal(PROTOCOL_VERSION, "2.20");
    assert.match(text, /Unknown or missing data is caution, never ready/);
    assert.match(text, /ENV_UNKNOWN/);
    assert.match(text, /The screen shows the server's reason text/);
    assert.ok(text.split(/\s+/).length < 900, `${text.split(/\s+/).length} words`);
    assert.match(text, /A human_only question is answered on the owner's screen/);
    assert.equal(/\bgates?\b/i.test(text.replaceAll("merge-gate", "")), false, "2.17: the protocol names no gate");
    assert.match(text, /answer_delegated/);
    assert.match(text, /cannot prove the caller is that bot or that the message exists/);
    assert.match(text, /Never forward an answer/);
    assert.equal(/authenticator|otpauth|TOTP|enrol/i.test(text), false);
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
    // A lowercase branch is not a key token. web-i2 must not satisfy KEY_SHAPE.
    await raw.query("update pull_requests set title = 'Ratings', head_branch = 'web-i2' where number = 40");
    assert.equal((await codes("PR_WITHOUT_PLANIA_KEY")).length, 1);
    assert.match((await codes("PR_WITHOUT_PLANIA_KEY"))[0]!.detail, /web-i2/);

    // Merged (and closed) rows are history. A missing key there is not a finding.
    await raw.query(
      `insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_branch)
       values ($1, 'Jorg3L3on/filmia', 41, 'https://github.com/Jorg3L3on/filmia/pull/41', 'Ratings', $2, 'merged', 'jl/ratings')`,
      [projectId, ticketId],
    );
    await raw.query("update pull_requests set state = 'closed', title = 'Ratings', head_branch = 'jl/ratings' where number = 40");
    assert.equal((await codes("PR_WITHOUT_PLANIA_KEY")).length, 0, "merged and closed PRs are not flagged");
    await raw.query("update pull_requests set state = 'open', title = 'Ratings', head_branch = 'jl/ratings' where number = 40");
    const onlyOpen = await codes("PR_WITHOUT_PLANIA_KEY");
    assert.equal(onlyOpen.length, 1);
    assert.match(onlyOpen[0]!.detail, /PR #40/);

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
  // PLA-I18-2: gates were removed. Old gate rows answered by an agent, by the screen or by nobody
  // are history and raise no finding.
  test("is no longer emitted for any old gate answer", async () => {
    await raw.query(
      `insert into questions (project_id, task_id, question, options, human_only, asked_by, answer, answered_by, answered_at) values
       ($1, $2, 'Puerta A', '{pursue,drop,later}', false, $3::jsonb, 'pursue', $3::jsonb, '2026-01-02T00:00:00Z'),
       ($1, $2, 'Puerta B', '{proceed,rework,drop}', true, $3::jsonb, 'proceed', $4::jsonb, '2026-01-03T00:00:00Z'),
       ($1, $2, 'Sin actor', '{pursue,drop,later}', false, $3::jsonb, 'pursue', null, '2026-01-05T00:00:00Z')`,
      [projectId, ideaId, AGENT, SCREEN],
    );
    const p = await findProject(db, "filmia");
    const all = await auditProject(db, p);
    assert.deepEqual(all.filter((f) => f.code.startsWith("GATE_")), []);
  });
});

describe("STAGE_DOC_STALE", () => {
  // PLA-I18-1: the finding measured docs against the gate that approved them. Gates are gone,
  // so a doc edited after an old gate answer is just an edit.
  test("is no longer emitted, even for a doc edited after an old gate answer", async () => {
    await raw.query(
      `insert into docs (project_id, task_id, title, markdown, version, actor, updated_at) values
       ($1, $2, 'Idea', 'problem', 2, $3::jsonb, '2026-03-01T00:00:00Z')`,
      [projectId, stageIdeaId, AGENT],
    );
    await raw.query(
      `insert into questions (project_id, task_id, question, options, human_only, asked_by, answer, answered_by, answered_at) values
       ($1, $2, 'A', '{pursue,drop,later}', true, $3::jsonb, 'pursue', $4::jsonb, '2026-02-01T00:00:00Z')`,
      [projectId, stageIdeaId, AGENT, SCREEN],
    );
    assert.deepEqual(await codes("STAGE_DOC_STALE"), []);
  });
});
