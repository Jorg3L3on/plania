// PLA-I71-3: seats as the owner manages them from Equipo. The role catalog is data (puestos, 0075): the factory roles
// seeded from TEMPLATE_ROWS and the owner's own roles (a title, one line, a base factory role whose prompt the seat
// runs on). Every change here is the owner's (the screen's session); runs only propose a seat (propose_seat, the PO's).
//   moveSeat      a new manager: the owner (the company's ceo seat) or a teammate; a loop is MANAGER_LOOP.
//   pauseSeat     paused_at set or cleared; admission holds a paused seat's runs (runner.ts, held seat_paused).
//   retireSeat    status retired (its runs, lessons and skills stay); its reports move up to its manager.
//   addSeat       from the catalog or an owner role; it arrives paused; at most eight seats (TEAM_FULL).
//   proposeSeat / decideProposal   the PO's proposal, then the owner's yes (a paused seat) or no.
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, projects, puestos, seatProposals, type Agent, type Project, type PuestoRow, type SeatProposal } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import type { Q } from "../mcp/tx.js";
import { isRunnerRole, roleOf } from "./limits.js";
import { RUNNER_CONFIG, TEAM_TEMPLATES, TEMPLATE_ROWS, ensureMember, isTeamTemplate, teamOf, teamSlug, type TeamTemplate } from "./team.js";

export const TEAM_MAX = 8;
const COMPANY = "ceo";

export type PuestoView = { slug: string; title: string; line: string; origin: "factory" | "owner"; base: string; taken: boolean };
export type ProposalView = { id: string; role: string; title: string; reason: string; proposed_by: string; state: SeatProposal["state"]; at: string };

async function projectOf(db: Q, slug: string): Promise<Project> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  return p;
}
async function memberOf(db: Q, p: Project, agent: string): Promise<Agent> {
  const [a] = await db.select().from(agents).where(and(eq(agents.slug, agent), eq(agents.projectId, p.id), sql`${agents.status} <> 'retired'`)).limit(1);
  if (!a) throw new ToolError("AGENT_NOT_FOUND", { agent });
  return a;
}
// One team change at a time per project (adds counting to eight, moves checking for a loop): a transaction-scoped
// advisory lock, so two clicks at the same moment are serialized instead of both passing the check.
const lockTeam = (tx: Q, project: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`equipo:${project}`}))`);

const ceoId = async (db: Q): Promise<string | null> => (await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, COMPANY)).limit(1))[0]?.id ?? null;

/** The catalog: factory roles (the table's rows, else the code's list before 0075 ran) and the owner's. taken: on this
 *  project's team already. */
export async function catalog(db: Q, project: string): Promise<PuestoView[]> {
  const p = await projectOf(db, project);
  const team = await teamOf(db, p.id);
  const rows: PuestoRow[] = await db.select().from(puestos).orderBy(asc(puestos.createdAt)).catch(() => []);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const factory = TEAM_TEMPLATES.map((t) => ({ slug: t, title: bySlug.get(t)?.title ?? TEMPLATE_ROWS[t].title, line: bySlug.get(t)?.line ?? "", origin: "factory" as const, base: t }));
  const own = rows.filter((r) => r.origin === "owner").map((r) => ({ slug: r.slug, title: r.title, line: r.line, origin: "owner" as const, base: r.promptRef }));
  const takenSlugs = new Set(team.map((a) => (a.role && !isTeamTemplate(a.role) && !isRunnerRole(a.role) ? a.role : (a.roleTemplate ?? a.role))));
  return [...factory, ...own].map((x) => ({ ...x, taken: takenSlugs.has(x.slug) }));
}

const slugify = (title: string) =>
  title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || "puesto";

/** A role of the owner's own: two lines of text on a factory role's prompt. */
export async function createPuesto(db: Q, input: { title: string; line: string; base: string }): Promise<PuestoView> {
  const title = input.title.trim();
  const line = input.line.trim();
  if (title.length < 1 || title.length > 60) throw new ToolError("PUESTO_INVALID", { field: "title" });
  if (line.length > 200) throw new ToolError("PUESTO_INVALID", { field: "line" });
  if (!isTeamTemplate(input.base)) throw new ToolError("PUESTO_INVALID", { field: "base" });
  let slug = slugify(title);
  if (!/^[a-z]/.test(slug)) slug = `p-${slug}`;
  if ((TEAM_TEMPLATES as readonly string[]).includes(slug) || isRunnerRole(slug)) throw new ToolError("SEAT_TAKEN", { role: slug });
  const [made] = await db.insert(puestos).values({ slug, title, line, origin: "owner", promptRef: input.base }).onConflictDoNothing().returning();
  if (!made) throw new ToolError("SEAT_TAKEN", { role: slug });
  return { slug, title, line, origin: "owner", base: input.base, taken: false };
}

/** One seat on the team, from the catalog, arriving paused. Its manager is the PO (the owner for a PO). */
export async function addSeat(db: Db, project: string, role: string, opts: { fromTeam?: string | null; reportsTo?: string | null; paused?: boolean } = {}): Promise<Agent> {
  return db.transaction(async (tx) => {
    await lockTeam(tx, project);
    const p = await projectOf(tx, project);
    const team = await teamOf(tx, p.id);
    if (team.length >= TEAM_MAX) throw new ToolError("TEAM_FULL", { max: TEAM_MAX });
    const po = team.find((a) => a.roleTemplate === "product-owner");
    const paused = opts.paused === false ? null : new Date();
    if (isTeamTemplate(role)) {
      const slug = teamSlug(role, p.slug);
      const [old] = await tx.select().from(agents).where(eq(agents.slug, slug)).limit(1);
      if (old && old.status !== "retired") throw new ToolError("SEAT_TAKEN", { role });
      // A retired seat of that role comes back (its history stays its own).
      if (old) {
        const [back] = await tx
          .update(agents)
          .set({ status: "idle", projectId: p.id, reportsTo: role === "product-owner" ? await ceoId(tx) : (po?.id ?? null), pausedAt: paused, fromTeam: opts.fromTeam ?? null, updatedAt: new Date() })
          .where(eq(agents.id, old.id))
          .returning();
        return back!;
      }
      const made = await ensureMember(tx, p, role as TeamTemplate, { reportsTo: opts.reportsTo ?? (role === "product-owner" ? COMPANY : (po?.slug ?? COMPANY)) });
      const [set] = await tx.update(agents).set({ pausedAt: paused, fromTeam: opts.fromTeam ?? null }).where(eq(agents.id, made.agent.id)).returning();
      return set!;
    }
    const [own] = await tx.select().from(puestos).where(and(eq(puestos.slug, role), eq(puestos.origin, "owner"))).limit(1);
    if (!own) throw new ToolError("PUESTO_INVALID", { field: "role" });
    const slug = `${own.slug}-${p.slug}`.slice(0, 60);
    const [old] = await tx.select().from(agents).where(eq(agents.slug, slug)).limit(1);
    if (old && old.status !== "retired") throw new ToolError("SEAT_TAKEN", { role });
    const base = own.promptRef as TeamTemplate;
    const boss = opts.reportsTo ? (await tx.select({ id: agents.id }).from(agents).where(eq(agents.slug, opts.reportsTo)).limit(1))[0]?.id : po?.id;
    const values = {
      slug,
      name: `${own.title} ${p.title || p.slug}`.slice(0, 60),
      role: own.slug,
      title: own.title,
      kind: "bot",
      capabilities: TEMPLATE_ROWS[base].capabilities(p.slug),
      note: own.line,
      status: "idle",
      adapter: RUNNER_CONFIG.adapter,
      adapterConfig: RUNNER_CONFIG.adapterConfig,
      projectId: p.id,
      roleTemplate: base,
      reportsTo: boss ?? null,
      // The owner's line travels with every run, after the base role's prompt.
      manner: own.line || null,
      mannerUpdatedAt: own.line ? new Date() : null,
      pausedAt: paused,
      fromTeam: opts.fromTeam ?? null,
    };
    if (old) {
      const [back] = await tx.update(agents).set({ ...values, updatedAt: new Date() }).where(eq(agents.id, old.id)).returning();
      return back!;
    }
    const [made] = await tx.insert(agents).values(values).returning();
    return made!;
  });
}

/** The chain of managers above a seat (by id), stopping at the top or a loop. */
async function chainAbove(db: Q, id: string | null): Promise<string[]> {
  const out: string[] = [];
  let at = id;
  while (at && !out.includes(at) && out.length < 50) {
    out.push(at);
    const [row] = await db.select({ up: agents.reportsTo }).from(agents).where(eq(agents.id, at)).limit(1);
    at = row?.up ?? null;
  }
  return out;
}

/** The seats that would make a loop if made this seat's manager: itself and everyone below it. */
export async function belowOf(db: Q, project: string, agent: string): Promise<string[]> {
  const p = await projectOf(db, project);
  const team = await teamOf(db, p.id);
  const a = team.find((x) => x.slug === agent);
  if (!a) throw new ToolError("AGENT_NOT_FOUND", { agent });
  const below = new Set([a.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of team) if (x.reportsTo && below.has(x.reportsTo) && !below.has(x.id)) (below.add(x.id), (grew = true));
  }
  return team.filter((x) => below.has(x.id)).map((x) => x.slug);
}

/** to: a teammate's slug, or null for the owner (the company's ceo seat). */
export async function moveSeat(db: Db, project: string, agent: string, to: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    await lockTeam(tx, project);
    const p = await projectOf(tx, project);
    const a = await memberOf(tx, p, agent);
    let boss: string | null;
    if (to === null) boss = await ceoId(tx);
    else {
      const [m] = await tx.select().from(agents).where(and(eq(agents.slug, to), eq(agents.projectId, p.id), sql`${agents.status} <> 'retired'`)).limit(1);
      if (!m) throw new ToolError("MANAGER_NOT_ON_TEAM", { reports_to: to });
      const chain = await chainAbove(tx, m.id);
      if (m.id === a.id || chain.includes(a.id)) throw new ToolError("MANAGER_LOOP", { chain: [to, ...(await Promise.all(chain.slice(1).map(async (id) => (await tx.select({ s: agents.slug }).from(agents).where(eq(agents.id, id)))[0]?.s)))].filter(Boolean) });
      boss = m.id;
    }
    await tx.update(agents).set({ reportsTo: boss, updatedAt: new Date() }).where(eq(agents.id, a.id));
  });
}

export async function pauseSeat(db: Db, project: string, agent: string, paused: boolean): Promise<void> {
  const p = await projectOf(db, project);
  const a = await memberOf(db, p, agent);
  await db.update(agents).set({ pausedAt: paused ? (a.pausedAt ?? new Date()) : null, updatedAt: new Date() }).where(eq(agents.id, a.id));
}

/** Retired: off the chart and the runner; its runs, lessons and skills stay. Its reports move up to its manager. */
export async function retireSeat(db: Db, project: string, agent: string): Promise<{ moved: string[] }> {
  return db.transaction(async (tx) => {
    await lockTeam(tx, project);
    const p = await projectOf(tx, project);
    const a = await memberOf(tx, p, agent);
    if (roleOf(a) === "product-owner") throw new ToolError("SEAT_REQUIRED", { agent });
    const reports = await tx.select().from(agents).where(and(eq(agents.reportsTo, a.id), sql`${agents.status} <> 'retired'`));
    if (reports.length) await tx.update(agents).set({ reportsTo: a.reportsTo, updatedAt: new Date() }).where(and(eq(agents.reportsTo, a.id), sql`${agents.status} <> 'retired'`));
    await tx.update(agents).set({ status: "retired", pausedAt: null, updatedAt: new Date() }).where(eq(agents.id, a.id));
    return { moved: reports.map((r) => r.slug) };
  });
}

// ---- proposals

const viewOf = (r: SeatProposal, cat: PuestoView[]): ProposalView => ({ id: r.id, role: r.role, title: cat.find((c) => c.slug === r.role)?.title ?? r.role, reason: r.reason, proposed_by: r.proposedBy, state: r.state, at: r.createdAt.toISOString() });

export async function proposalsOf(db: Q, project: string): Promise<ProposalView[]> {
  const p = await projectOf(db, project);
  const cat = await catalog(db, project);
  const rows = await db.select().from(seatProposals).where(and(eq(seatProposals.projectId, p.id), eq(seatProposals.state, "proposed"))).orderBy(asc(seatProposals.createdAt));
  return rows.map((r) => viewOf(r, cat));
}

/** propose_seat: the project's PO (by its roster slug) proposes a role with a reason. One open proposal per role. */
export async function proposeSeat(db: Q, input: { project: string; role: string; reason: string }, by: Agent | null): Promise<ProposalView> {
  const p = await projectOf(db, input.project);
  if (!by || roleOf(by) !== "product-owner" || by.projectId !== p.id) throw new ToolError("SEAT_PROPOSAL_NOT_PO", { project: input.project });
  const cat = await catalog(db, input.project);
  const role = input.role.trim();
  const known = cat.find((c) => c.slug === role);
  if (!known) throw new ToolError("PUESTO_INVALID", { field: "role", known: cat.map((c) => c.slug) });
  if (known.taken) throw new ToolError("SEAT_TAKEN", { role });
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 600) throw new ToolError("PUESTO_INVALID", { field: "reason" });
  const [open] = await db.select().from(seatProposals).where(and(eq(seatProposals.projectId, p.id), eq(seatProposals.role, role), eq(seatProposals.state, "proposed"))).limit(1);
  if (open) return viewOf(open, cat);
  const [made] = await db.insert(seatProposals).values({ projectId: p.id, role, reason, proposedBy: by.slug }).returning();
  return viewOf(made!, cat);
}

/** The owner's yes (the seat arrives paused) or no. */
export async function decideProposal(db: Db, project: string, id: string, accept: boolean): Promise<{ state: "accepted" | "declined"; agent: string | null }> {
  const p = await projectOf(db, project);
  const [r] = await db.select().from(seatProposals).where(and(eq(seatProposals.id, id), eq(seatProposals.projectId, p.id))).limit(1);
  if (!r) throw new ToolError("PROPOSAL_NOT_FOUND", { id });
  // Claim it first: of two answers at the same moment only one moves it out of «proposed».
  const [claimed] = await db
    .update(seatProposals)
    .set({ state: accept ? "accepted" : "declined", decidedAt: new Date() })
    .where(and(eq(seatProposals.id, id), eq(seatProposals.state, "proposed")))
    .returning();
  if (!claimed) throw new ToolError("PROPOSAL_DECIDED", { state: r.state === "proposed" ? "accepted" : r.state });
  if (!accept) return { state: "declined", agent: null };
  try {
    const made = await addSeat(db, project, r.role);
    await db.update(seatProposals).set({ agentId: made.id }).where(eq(seatProposals.id, id));
    return { state: "accepted", agent: made.slug };
  } catch (e) {
    // No room (or the role was taken meanwhile): the proposal waits again.
    await db.update(seatProposals).set({ state: "proposed", decidedAt: null }).where(eq(seatProposals.id, id));
    throw e;
  }
}

