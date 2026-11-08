// PLA-10: /ceo sees only claude_code agents (ui/src/lib/ceo-team.ts). Pure, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dashboard, DashboardAgent } from "../ui/src/components/dashboard/types.js";
import { claudeOnly } from "../ui/src/lib/ceo-team.js";

const agent = (slug: string, adapter: string, status: string): DashboardAgent => ({
  slug, name: slug, role: "engineer", title: "", status, note: "", claim: null, adapter, can_wake: false, wake_reason: null, ready: 0, last_check_in_at: null,
});

test("keeps only claude_code agents and recounts the team", () => {
  const agents = [
    agent("claude-code", "claude_code", "alive"),
    agent("claude-review", "claude_code", "stuck"),
    agent("cursor", "cursor_agent", "alive"),
    agent("artist", "http", "idle"),
    agent("grok", "grok_webhook", "idle"),
    agent("ceo", "none", "idle"),
  ];
  const data = { name: "Jorge", team: { alive: 2, idle: 3, stuck: 1, total: 6, agents } } as unknown as Dashboard;
  const out = claudeOnly(data);
  assert.deepEqual(out.team.agents.map((row) => row.slug), ["claude-code", "claude-review"]);
  assert.deepEqual({ ...out.team, agents: undefined }, { alive: 1, idle: 0, stuck: 1, total: 2, agents: undefined });
  assert.equal(out.name, "Jorge");
  assert.equal(data.team.agents.length, 6, "input untouched");
});
