// PLA-I2-7: GET /api/limits, the page «Lo que el equipo nunca puede hacer» built from the real rules: the deny
// groups the runner passes to Claude (src/runner/deny.ts), the list of what leaves the machine (src/outbound.ts),
// where the agents' copies live and whether run isolation is on. Words in ui/src/lib/limites.ts.
import { Hono } from "hono";
import { limitsPage, type LimitsInput, type LimitsPage } from "../../ui/src/lib/limites.js";
import { installLanguage } from "../language.js";
import { OUTBOUND } from "../outbound.js";
import { DENY_GROUPS, RUN_GROUP_IDS } from "../runner/deny.js";
import { isolationOf } from "../runner/runner.js";
import { worktreeRoot } from "../runner/worktree.js";

export const limitsInput = (env: NodeJS.ProcessEnv = process.env): LimitsInput => ({
  groups: DENY_GROUPS.map((g) => ({ id: g.id, does: g.rules.map((r) => r.does), rules: g.rules.length })),
  everyRun: [...RUN_GROUP_IDS],
  outbound: OUTBOUND.map((o) => ({ id: o.id, optional: o.optional })),
  worktrees: worktreeRoot(env),
  isolation: isolationOf(env),
});

// PLA-I2-10: the page in the install's language.
export function limitsRoutes(read: () => LimitsPage = () => limitsPage(limitsInput(), installLanguage())) {
  const routes = new Hono();
  routes.get("/", (c) => c.json(read()));
  return routes;
}
