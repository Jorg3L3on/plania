// PLA-I27-2: one goal per product. The second run adds zero rows.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();

const { makeDb } = await import("../src/db/client.js");
const { listGoals } = await import("../src/mcp/goals.js");
const { COMPANY_TITLE, GOAL_SLUGS, projectGoalTitle, seedGoals } = await import("../scripts/seed-goals.js");

let store: TestStore;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;

const countGoals = () => store.count("goals");

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await store.fix(async (uow) => {
    await uow.insert("projects", { slug: "plania", title: "Plania", keyPrefix: "PLA" });
    await uow.insert("projects", { slug: "mianovia", title: "Mianovia", keyPrefix: "MIA" });
  });
});

after(async () => {
  await closeDb?.();
  await store?.end();
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
