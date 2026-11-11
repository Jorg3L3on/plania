import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateRunMinutes, listWorkflowRuns, monthWindow, nextLink, summarizeBilling } from "../src/usage.mjs";

test("billing summary counts action minutes and ignores other products", () => {
  const summary = summarizeBilling({
    usageItems: [
      { product: "actions", sku: "actions_linux", quantity: 40, unitType: "minutes", netAmount: 0 },
      { product: "Actions", sku: "actions_linux", quantity: 2, unitType: "minutes", netAmount: 0.012 },
      { product: "packages", sku: "storage", quantity: 9, unitType: "minutes", netAmount: 3 },
    ],
  });
  assert.deepEqual(summary, { actionItems: 2, actionMinutes: 42, actionNet: 0.012 });
  assert.deepEqual(summarizeBilling({}), { actionItems: 0, actionMinutes: 0, actionNet: 0 });
});

test("run estimates round each completed run up to a minute inside the month", () => {
  const start = Date.parse("2026-11-01T00:00:00Z");
  const end = Date.parse("2026-12-01T00:00:00Z");
  const estimate = estimateRunMinutes([
    { status: "completed", run_started_at: "2026-11-11T12:00:00Z", updated_at: "2026-11-11T12:00:30Z" },
    { status: "completed", run_started_at: "2026-11-11T13:00:00Z", updated_at: "2026-11-11T13:01:30Z" },
    { status: "completed", run_started_at: "2026-10-31T23:00:00Z", updated_at: "2026-10-31T23:10:00Z" },
    { status: "in_progress", run_started_at: "2026-11-11T14:00:00Z", updated_at: "2026-11-11T14:05:00Z" },
  ], start, end);
  assert.deepEqual(estimate, { minutes: 3, counted: 2 });
  const window = monthWindow(new Date("2026-11-11T12:00:00Z"));
  assert.equal(window.start, start);
  assert.equal(window.end, end);
});

test("next link and paged workflow runs", async () => {
  assert.equal(nextLink('<https://example.test/runs?page=2>; rel="next"'), "https://example.test/runs?page=2");
  assert.equal(nextLink('<https://example.test/runs?page=1>; rel="prev"'), null);
  const pages = [
    { body: { workflow_runs: [{ id: 1 }] }, link: '<https://api.github.com/next>; rel="next"' },
    { body: { workflow_runs: [{ id: 2 }] }, link: null },
  ];
  const runs = await listWorkflowRuns(async () => {
    const page = pages.shift();
    return { ok: true, status: 200, json: async () => page.body, headers: { get: () => page.link } };
  }, "token", "Jorg3L3on/plania-scan", "2026-11-01..2026-11-11");
  assert.deepEqual(runs.map((run) => run.id), [1, 2]);
});
