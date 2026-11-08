// PLA-10: /ceo only works with Claude. Equipo, its counts, the KPI and the Asignar sheet see only agents on the
// claude_code adapter. The roster itself (/equipo, list_agents) keeps every bot.
import type { Dashboard } from "../components/dashboard/types.js";

export const CEO_ADAPTER = "claude_code";

export function claudeOnly(data: Dashboard): Dashboard {
  const agents = data.team.agents.filter((agent) => agent.adapter === CEO_ADAPTER);
  const counts = { alive: 0, idle: 0, stuck: 0, total: agents.length };
  for (const agent of agents) {
    if (agent.status === "alive" || agent.status === "idle" || agent.status === "stuck") counts[agent.status] += 1;
  }
  return { ...data, team: { ...counts, agents } };
}
