// PLA-I32-1: agents have a project and a role template, and there are threads and thread messages.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { agents, runnerSettings, threadMessages, threads } from "../src/db/schema.js";

test("schema.ts exposes project_id, role_template, threads and thread_messages with their checks", () => {
  const a = getTableConfig(agents);
  assert.ok(a.columns.some((c) => c.name === "project_id"));
  assert.ok(a.columns.some((c) => c.name === "role_template"));
  assert.ok(a.checks.some((c) => c.name === "agents_role_template_check"));
  const t = getTableConfig(threads);
  assert.deepEqual(t.columns.map((c) => c.name).sort(), ["created_at", "id", "kind", "project_id", "read_at"]);
  assert.ok(t.checks.some((c) => c.name === "threads_kind_check"));
  const m = getTableConfig(threadMessages);
  assert.deepEqual(m.columns.map((c) => c.name).sort(), ["action_state", "at", "author_agent", "author_role", "body", "id", "links", "proposal", "question_id", "thread_id"]);
  assert.deepEqual(m.checks.map((c) => c.name).sort(), [
    "thread_messages_action_state_check",
    "thread_messages_author_check",
    "thread_messages_body_check",
    "thread_messages_links_check",
    "thread_messages_proposal_check",
  ]);
  // PLA-21 (0043) dropped Asistente's weekly limit again.
  assert.equal(getTableConfig(runnerSettings).columns.some((c) => c.name === "asistente_weekly_limit"), false);
});
