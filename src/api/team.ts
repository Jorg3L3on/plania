import { Hono } from "hono";
import { withDb } from "../db/client.js";
import { listAgents, workingOnBySlug, type AgentView, type WorkingOn } from "../mcp/team.js";
import { readerOf } from "../store/port.js";
import { notNull } from "../store/types.js";

// Closed work is not "owned" on the chart. The lease stays on tasks.owner; this list is informational.
const CLOSED = ["Done", "Won't do"];

export type OwnedTask = { project: string; key: string; title: string; status: string };

export type TeamMember = Omit<AgentView, "wake_url" | "tokens" | "adapter_config"> & { tasks: OwnedTask[]; working_on: WorkingOn | null };

// Screen only. Mounted under the session middleware in routes.ts; a Bearer never reaches it.
export const teamRoutes = new Hono();

teamRoutes.get("/", async (c) => {
  const body = await withDb(async (db) => {
    const [{ agents: roster }, working] = await Promise.all([listAgents(db), workingOnBySlug(db)]);
    const r = readerOf(db);
    // Open assigned tasks by project slug, then key: Postgres sorts both, so text order stays the database's.
    const open: { owner: string; task: OwnedTask }[] = [];
    for (const p of await r.find("projects", {}, { orderBy: [{ column: "slug" }] })) {
      for (const t of await r.find("tasks", { projectId: p.id, ownerAgent: notNull() }, { orderBy: [{ column: "key" }] })) {
        if (!CLOSED.includes(t.status)) open.push({ owner: t.ownerAgent!, task: { project: p.slug, key: t.key, title: t.title, status: t.status } });
      }
    }
    const owners = [...new Set(open.map((o) => o.owner))];
    const slugById = new Map(owners.length ? (await r.find("agents", { id: owners })).map((a) => [a.id, a.slug]) : []);
    const bySlug = new Map<string, OwnedTask[]>();
    for (const o of open) {
      const slug = slugById.get(o.owner);
      if (slug === undefined) continue;
      const list = bySlug.get(slug) ?? [];
      list.push(o.task);
      bySlug.set(slug, list);
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
