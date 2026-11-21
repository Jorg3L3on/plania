// PLA-I71-6: the team catalog. A team is data (ADR 0007): seats (a role from the catalog, or a role of the owner's own
// with its title, line and base role), who reports to whom (by role), the skills each seat carries (by slug), a
// suggested motor and the owner's manner. The factory teams are files in kit/teams/ (read at run time); the teams the
// owner saved from a project and those brought from a file or a repository live in team_templates (0077).
//   saveTeam        a project's team as a template; its owner skill texts travel with it; lessons and references only
//                   when ticked.
//   adoptPreview    what adopting would do, computed without writing: who stays, who arrives (and what each brings),
//                   who does not fit (eight seats), and for seats that already exist, what «also» would add.
//   adopt           the same plan, applied: new seats arrive paused; adoption is a copy (the template never follows).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentReferences, agents, lessons, projects, puestos, skillVersions, skills, teamAdoptions, teamTemplates, type Agent, type TeamSeatSpec, type TeamSpec } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { kitRoot } from "./kit.js";
import { listPacks, NO_SKILLS } from "./packs.js";
import { addSeat, moveSeat, TEAM_MAX } from "./puestos.js";
import { isTeamTemplate, teamOf } from "./team.js";
import { defaultSkills } from "./kit.js";
import { roleOf } from "./limits.js";
import { addVersion } from "./skills.js";
import { scrub } from "../api/scoreboard.js";

export type TeamOrigin = "factory" | "owner" | "imported";
export type TeamView = { slug: string; name: string; line: string; origin: TeamOrigin; seats: { role: string; title: string | null }[]; skills: number; hash: string; source: string | null; at: string | null; spec: TeamSpec };

export const hashOf = (spec: TeamSpec): string => createHash("sha256").update(JSON.stringify(spec)).digest("hex");

export function factoryTeams(env: NodeJS.ProcessEnv = process.env): TeamView[] {
  const dirs = [path.join(kitRoot(env), "teams"), path.resolve(import.meta.dirname, "../../kit/teams")];
  const dir = dirs.find((d) => existsSync(d));
  if (!dir) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { slug: string; name: string; line: string; spec: TeamSpec })
    .map((t) => ({ slug: t.slug, name: t.name, line: t.line, origin: "factory" as const, seats: t.spec.seats.map((s) => ({ role: s.role, title: s.title ?? null })), skills: new Set(t.spec.seats.flatMap((s) => s.skills)).size, hash: hashOf(t.spec), source: null, at: null, spec: t.spec }));
}

export async function teamCatalog(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<TeamView[]> {
  const rows = await db.select().from(teamTemplates).orderBy(asc(teamTemplates.createdAt));
  const mine = rows.map((r) => ({ slug: r.slug, name: r.name, line: r.line, origin: r.origin as TeamOrigin, seats: r.spec.seats.map((s) => ({ role: s.role, title: s.title ?? null })), skills: new Set(r.spec.seats.flatMap((s) => s.skills)).size, hash: r.hash, source: r.source, at: r.createdAt.toISOString(), spec: r.spec }));
  return [...factoryTeams(env), ...mine];
}

async function projectOf(db: Db, slug: string) {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  return p;
}

/** A seat's role in a team: a role of the owner's own by its slug, else its factory template. */
export const roleKey = (a: Pick<Agent, "role" | "roleTemplate">): string => (a.roleTemplate && a.role && a.role !== a.roleTemplate && !isTeamTemplate(a.role) && a.roleTemplate !== "asistente" ? a.role : (a.roleTemplate ?? a.role));

/** What a seat carries by slug: its own list, else its role's default kit; plus the owner's skills on its own scope. */
async function seatSkills(db: Db, a: Agent, env: NodeJS.ProcessEnv): Promise<string[]> {
  const list = a.skillPacks ?? [];
  const base = list.includes(NO_SKILLS) ? [] : list.length ? list : (() => {
    const r = roleOf(a);
    return r ? defaultSkills(r, env) : [];
  })();
  const own = await db.select({ slug: skills.slug }).from(skills).where(and(eq(skills.agentId, a.id), eq(skills.state, "on")));
  return [...new Set([...base, ...own.map((x) => x.slug)])];
}

/** A project's team as a spec. Lessons and references only when asked; free text passes through scrub. */
export async function specOf(db: Db, project: string, opts: { lessons?: boolean; references?: boolean } = {}, env: NodeJS.ProcessEnv = process.env): Promise<TeamSpec> {
  const p = await projectOf(db, project);
  const team = await teamOf(db, p.id);
  const byId = new Map(team.map((a) => [a.id, a]));
  const own = new Map((await db.select().from(puestos)).filter((x) => x.origin === "owner").map((x) => [x.slug, x]));
  const seats: TeamSeatSpec[] = [];
  const carried = new Set<string>();
  for (const a of team) {
    const role = roleKey(a);
    const mine = own.get(role);
    const list = await seatSkills(db, a, env);
    list.forEach((s) => carried.add(s));
    seats.push({
      role,
      ...(mine ? { title: mine.title, line: mine.line, base: mine.promptRef } : {}),
      reports_to: a.reportsTo && byId.has(a.reportsTo) ? roleKey(byId.get(a.reportsTo)!) : null,
      skills: list,
      motor: a.motorModel || a.motorEffort ? { model: a.motorModel, effort: a.motorEffort } : null,
      manner: scrub(a.manner, 2000),
    });
  }
  // The owner's skill texts the team carries travel with it (the factory ones go by name).
  const factory = new Set((await listPacks(db, env)).filter((x) => !x.slug.startsWith("__")).map((x) => x.slug));
  const ownerSkills = await db.select().from(skills).where(sql`${skills.state} <> 'archived'`);
  const texts: NonNullable<TeamSpec["skills"]> = [];
  for (const s of ownerSkills.filter((x) => carried.has(x.slug))) {
    const [v] = await db.select().from(skillVersions).where(eq(skillVersions.skillId, s.id)).orderBy(sql`${skillVersions.n} desc`).limit(1);
    if (v) texts.push({ slug: s.slug, name: v.name, description: v.description, body: v.body });
  }
  void factory;
  const spec: TeamSpec = { seats, ...(texts.length ? { skills: texts } : {}) };
  if (opts.lessons) {
    const ls = await db.select().from(lessons).where(and(eq(lessons.projectId, p.id), eq(lessons.state, "active")));
    spec.lessons = ls.filter((l) => l.agentId && byId.has(l.agentId)).map((l) => ({ role: roleKey(byId.get(l.agentId!)!), text: scrub(l.text, 600) ?? "" }));
  }
  if (opts.references) {
    const rs = await db.select().from(agentReferences).where(and(eq(agentReferences.projectId, p.id), eq(agentReferences.kind, "link")));
    spec.references = rs.filter((r) => r.url && byId.has(r.agentId)).map((r) => ({ role: roleKey(byId.get(r.agentId)!), title: r.title, url: r.url! }));
  }
  return spec;
}

const slugOf = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "equipo";

export async function saveTeam(db: Db, project: string, input: { name: string; line?: string; lessons?: boolean; references?: boolean }, env: NodeJS.ProcessEnv = process.env): Promise<TeamView> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) throw new ToolError("PUESTO_INVALID", { field: "name" });
  const spec = await specOf(db, project, input, env);
  const taken = new Set([...factoryTeams(env).map((t) => t.slug), ...(await db.select({ slug: teamTemplates.slug }).from(teamTemplates)).map((r) => r.slug)]);
  let slug = slugOf(name);
  if (!/^[a-z]/.test(slug)) slug = `e-${slug}`;
  for (let n = 2; taken.has(slug); n++) slug = `${slugOf(name).slice(0, 34)}-${n}`;
  const [row] = await db.insert(teamTemplates).values({ slug, name, line: (input.line ?? "").slice(0, 300), origin: "owner", spec, hash: hashOf(spec) }).returning();
  return { slug, name, line: row!.line, origin: "owner", seats: spec.seats.map((s) => ({ role: s.role, title: s.title ?? null })), skills: new Set(spec.seats.flatMap((s) => s.skills)).size, hash: row!.hash, source: null, at: row!.createdAt.toISOString(), spec };
}

/** A team brought from a file or a repository (company-package.ts reads the open layout into a spec). */
export async function bringTeam(db: Db, input: { name: string; line?: string; spec: TeamSpec; source?: string | null; commit?: string | null }, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const taken = new Set([...factoryTeams(env).map((t) => t.slug), ...(await db.select({ slug: teamTemplates.slug }).from(teamTemplates)).map((r) => r.slug)]);
  let slug = slugOf(input.name);
  if (!/^[a-z]/.test(slug)) slug = `e-${slug}`;
  for (let n = 2; taken.has(slug); n++) slug = `${slugOf(input.name).slice(0, 34)}-${n}`;
  await db.insert(teamTemplates).values({ slug, name: input.name.slice(0, 80), line: (input.line ?? "").slice(0, 300), origin: "imported", spec: input.spec, source: input.source ?? null, sourceCommit: input.commit ?? null, hash: hashOf(input.spec) });
  return slug;
}

// ---- adopting

export type AdoptMode = "keep" | "also";
export type AdoptPlan = {
  template: string;
  name: string;
  hash: string;
  stays: { role: string; agent: string; adds: string[] }[];
  arrives: { role: string; title: string | null; reports_to: string | null; skills: string[]; motor: { model: string | null; effort: string | null } | null }[];
  no_room: string[];
  plan_note: { more_agents: number };
};

export async function adoptPreview(db: Db, project: string, template: string, mode: AdoptMode = "keep", env: NodeJS.ProcessEnv = process.env): Promise<AdoptPlan> {
  const p = await projectOf(db, project);
  const t = (await teamCatalog(db, env)).find((x) => x.slug === template);
  if (!t) throw new ToolError("PUESTO_INVALID", { field: "template" });
  const team = await teamOf(db, p.id);
  const have = new Map(team.map((a) => [roleKey(a), a]));
  const stays: AdoptPlan["stays"] = [];
  const arrives: AdoptPlan["arrives"] = [];
  const noRoom: string[] = [];
  let room = TEAM_MAX - team.length;
  for (const s of t.spec.seats) {
    const a = have.get(s.role);
    if (a) {
      const now = await seatSkills(db, a, env);
      stays.push({ role: s.role, agent: a.slug, adds: mode === "also" ? s.skills.filter((x) => !now.includes(x)) : [] });
    } else if (room > 0) {
      arrives.push({ role: s.role, title: s.title ?? null, reports_to: s.reports_to, skills: s.skills, motor: s.motor ?? null });
      room -= 1;
    } else noRoom.push(s.role);
  }
  for (const a of team) if (!stays.some((x) => x.agent === a.slug)) stays.push({ role: roleKey(a), agent: a.slug, adds: [] });
  return { template: t.slug, name: t.name, hash: t.hash, stays, arrives, no_room: noRoom, plan_note: { more_agents: arrives.length } };
}

/** The plan, applied. Arrivals come paused, report as the team says (to the role's seat here; none: the owner, or the
 *  PO), carry the team's skills that exist here and its motor; «also» adds the team's skills to seats that stayed. */
export async function adopt(db: Db, project: string, template: string, mode: AdoptMode = "keep", env: NodeJS.ProcessEnv = process.env): Promise<AdoptPlan> {
  const plan = await adoptPreview(db, project, template, mode, env);
  const t = (await teamCatalog(db, env)).find((x) => x.slug === template)!;
  const p = await projectOf(db, project);
  const known = new Set((await listPacks(db, env)).map((x) => x.slug));
  const ownerSlugs = new Set<string>();
  // Roles of the owner's own the team names: made when missing.
  for (const s of t.spec.seats.filter((x) => !isTeamTemplate(x.role))) {
    const base = s.base && isTeamTemplate(s.base) ? s.base : "taller";
    await db.insert(puestos).values({ slug: s.role, title: (s.title ?? s.role).slice(0, 60), line: (s.line ?? "").slice(0, 200), origin: "owner", promptRef: base }).onConflictDoNothing();
  }
  // The owner skill texts it carries, made when no live skill has that slug (off: the owner turns them on).
  for (const k of t.spec.skills ?? []) {
    const [live] = await db.select({ id: skills.id }).from(skills).where(and(eq(skills.slug, k.slug), sql`${skills.state} <> 'archived'`)).limit(1);
    if (live) continue;
    const [row] = await db.insert(skills).values({ slug: k.slug, origin: "owner", scope: "project", projectId: p.id, state: "on", createdBy: "owner" }).returning();
    await addVersion(db, row!, { name: k.name, description: k.description, body: k.body, files: [] }, "owner", `team:${t.slug}`);
    ownerSlugs.add(k.slug);
  }
  for (const s of plan.arrives) {
    const made = await addSeat(db, project, s.role, { fromTeam: t.slug });
    // The factory and doc packs it carries go on its own list; the owner's skills ride on their scope (the project).
    const own = s.skills.filter((x) => known.has(x) && !ownerSlugs.has(x));
    await db
      .update(agents)
      .set({ skillPacks: own.slice(0, 10), motorModel: s.motor?.model ?? null, motorEffort: s.motor?.effort ?? null, manner: t.spec.seats.find((x) => x.role === s.role)?.manner ?? made.manner, updatedAt: new Date() })
      .where(eq(agents.id, made.id));
  }
  // Managers: by role, once everyone is here.
  const team = await teamOf(db, p.id);
  const byRole = new Map(team.map((a) => [roleKey(a), a]));
  for (const s of plan.arrives) {
    const a = byRole.get(s.role);
    if (!a) continue;
    const boss = s.reports_to ? byRole.get(s.reports_to) : null;
    // Through the screen's move: a team whose seats name each other in a circle keeps the loop out of the chart.
    if (boss && boss.id !== a.id)
      try {
        await moveSeat(db, project, a.slug, boss.slug);
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
      }
  }
  if (mode === "also")
    for (const s of plan.stays.filter((x) => x.adds.length)) {
      const a = team.find((x) => x.slug === s.agent)!;
      const now = await seatSkills(db, a, env);
      await db.update(agents).set({ skillPacks: [...new Set([...now, ...s.adds])].filter((x) => known.has(x)).slice(0, 10), updatedAt: new Date() }).where(eq(agents.id, a.id));
    }
  for (const l of t.spec.lessons ?? []) {
    const a = byRole.get(l.role);
    if (a && plan.arrives.some((x) => x.role === l.role)) await db.insert(lessons).values({ projectId: p.id, agentId: a.id, scope: "agent", text: l.text.slice(0, 600), state: "active", proposedBy: "owner" });
  }
  await db.insert(teamAdoptions).values({ projectId: p.id, template: t.slug, hash: t.hash, plan: plan as unknown as Record<string, unknown> });
  return plan;
}
