// PLA-I27-1: the token card line. Counts come from usage_summary. A dollar figure is optional.
import assert from "node:assert/strict";
import { test } from "node:test";
import { usageCaption } from "../ui/src/components/dashboard/usage-line.js";

test("the caption names the week and the reported counts", () => {
  const line = usageCaption({ label: "reportado", week: "2026-W10", input: 1200, output: 45 });
  assert.match(line, /2026-W10/);
  assert.match(line, /entrada/);
  assert.match(line, /salida/);
  assert.match(line, /reportado/);
  assert.equal(line.includes("$"), false);
});

test("a dollar amount from the server is never shown (PLA-I30-4)", () => {
  const withUsd = usageCaption({ label: "reportado", week: "2026-W10", input: 1, output: 2, usd: 1.5 } as Parameters<typeof usageCaption>[0]);
  assert.equal(withUsd.includes("$"), false);
  assert.equal(/usd/i.test(withUsd), false);
});
