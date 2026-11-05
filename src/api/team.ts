import { Hono } from "hono";
import { asc, eq, notInArray } from "drizzle-orm";
import { withDb } from "../db/client.js";
import { agents, projects, tasks } from "../db/schema.js";
import { listAgents, workingOnBySlug, type AgentView, type WorkingOn } from "../mcp/team.js";

// Closed work is not "owned" on the chart. The lease stays on tasks.owner; this list is informational.
const CLOSED = ["Done", "Won't do"];

export type OwnedTask = { project: string; key: string; title: string; status: string };

export type TeamMember = Omit<AgentView, "wake_url" | "tokens" | "adapter_config"> & { tasks: OwnedTask[]; working_on: WorkingOn | null };

// Screen only. Mounted under the session middleware in routes.ts; a Bearer never reaches it.
export const teamRoutes = new Hono();

teamRoutes.get("/", async (c) => {
  const body = await withDb(async (db) => {
    const [{ agents: roster }, working] = await Promise.all([listAgents(db), workingOnBySlug(db)]);
    const open = await db
      .select({
        slug: agents.slug,
        project: projects.slug,
        key: tasks.key,
        title: tasks.title,
        status: tasks.status,
      })
      .from(tasks)
      .innerJoin(agents, eq(agents.id, tasks.ownerAgent))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(notInArray(tasks.status, CLOSED))
      .orderBy(asc(projects.slug), asc(tasks.key));
    const bySlug = new Map<string, OwnedTask[]>();
    for (const row of open) {
      const list = bySlug.get(row.slug) ?? [];
      list.push({ project: row.project, key: row.key, title: row.title, status: row.status });
      bySlug.set(row.slug, list);
    }
    const members: TeamMember[] = roster.map(({ wake_url: _wake, tokens: _tokens, adapter_config: _config, ...member }) => ({
      ...member,
      tasks: bySlug.get(member.slug) ?? [],
      working_on: working.get(member.slug) ?? null,
    }));
    return { agents: members };
  });
  return c.json(body);
});
