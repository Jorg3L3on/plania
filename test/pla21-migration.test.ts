// PLA-21: the weekly token budgets are gone (token_budgets and runner_settings.asistente_weekly_limit).
import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema.js";

test("the schema has no token budget left", () => {
  assert.equal("tokenBudgets" in schema, false);
  assert.equal(getTableConfig(schema.runnerSettings).columns.some((c) => c.name === "asistente_weekly_limit"), false);
});
