// PLA-I27-2: one goal per product. The second run adds zero rows.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();

const { makeDb } = await import("../src/db/client.js");
const { listGoals } = await import("../src/mcp/goals.js");
const { COMPANY_TITLE, GOAL_SLUGS, projectGoalTitle, seedGoals } = await import("../scripts/seed-goals.js");

let raw: pg.Client;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;

const countGoals = async () => {
  const { rows } = await raw.query<{ n: number }>("select count(*)::int as n from goals");
  return rows[0]!.n;
};

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await raw.query(
    "insert into projects (slug, title, key_prefix) values ('plania','Plania','PLA'), ('mianovia','Mianovia','MIA')",
  );
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("list_goals is non-empty for each product and a second seed adds zero rows", async () => {
  const first = await seedGoals(db);
  assert.deepEqual(first.missing, []);
  assert.deepEqual(first.created, ["company", ...GOAL_SLUGS]);
  const afterFirst = await countGoals();
  assert.equal(afterFirst, GOAL_SLUGS.length + 1);

  const tree = await listGoals(db);
  const company = tree.goals.find((goal) => goal.title === COMPANY_TITLE);
  assert.ok(company);
  assert.equal(company.project, null);

  for (const slug of GOAL_SLUGS) {
    const listed = await listGoals(db, slug);
    assert.equal(listed.goals.length >= 1, true, slug);
    const goal = listed.goals.find((row) => row.title === projectGoalTitle(slug));
    assert.ok(goal, slug);
    assert.equal(goal.project, slug);
    assert.equal(goal.parent_id, company.id);
    assert.equal(goal.title.includes(slug), true);
  }

  const second = await seedGoals(db);
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.missing, []);
  assert.equal(await countGoals(), afterFirst);
});
