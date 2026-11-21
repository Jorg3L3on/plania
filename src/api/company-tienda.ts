// PLA-I71-4: the skill store (board Habilidades). One read, from what Plania already stores: every skill a seat of
// this project could carry (the factory kit, Plania's pack docs, the owner's skills and the ones brought from a link,
// as each seat's Oficio read shows them), with which seats carry it now and how often it was used of the runs that
// carried it. No table of its own; writes reuse the seat routes (packs, a skill's state, duplicate, create).
//   GET /api/company/projects/:slug/tienda → {seats: [{agent, role}], skills: [...]}
//     origin  factory (the kit or a pack doc) | yours (the owner's, or a copy of a factory one) | brought (from a link)
//     carriers  one per seat: on (its next run carries it) and, for an owner skill, the scope that decides it
//     runs_carried / runs_used  over every seat's runs in Oficio's window; runs_carried 0 means no run carried it
import type { Db } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { teamOf } from "../runner/team.js";
import { projects } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { oficioRead, type Oficio } from "./company-oficio.js";

export type TiendaSkill = {
  slug: string;
  name: string;
  when: string;
  source: "kit" | "doc" | "owner";
  origin: "factory" | "yours" | "brought";
  version: string;
  scope: string | null;
  carriers: { agent: string; on: boolean }[];
  runs_carried: number;
  runs_used: number;
};
export type Tienda = { seats: { agent: string; role: string }[]; skills: TiendaSkill[] };

export async function tiendaRead(db: Db, slug: string, env: NodeJS.ProcessEnv = process.env): Promise<Tienda> {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  const seats = await teamOf(db, p.id);
  const reads: Oficio[] = [];
  for (const a of seats) {
    const o = await oficioRead(db, slug, a.slug, env);
    if (!("error" in o)) reads.push(o as Oficio);
  }
  const by = new Map<string, TiendaSkill>();
  for (const o of reads) {
    for (const s of o.skills) {
      const origin = s.owner ? (s.owner.origin === "imported" ? "brought" : "yours") : "factory";
      const row = by.get(s.slug) ?? { slug: s.slug, name: s.name, when: s.when, source: s.source, origin, version: s.version, scope: s.owner?.scope ?? null, carriers: [], runs_carried: 0, runs_used: 0 };
      // An owner's copy seen by one seat names the skill (the factory original stays behind it for the others).
      if (row.origin === "factory" && origin !== "factory") Object.assign(row, { name: s.name, when: s.when, source: s.source, origin, version: s.version, scope: s.owner?.scope ?? null });
      row.carriers.push({ agent: o.agent, on: s.on });
      row.runs_carried += s.runs_carried;
      row.runs_used += s.runs_used;
      by.set(s.slug, row);
    }
  }
  // A seat that does not see a skill (another seat's own) is listed as not carrying it.
  for (const row of by.values()) for (const o of reads) if (!row.carriers.some((c) => c.agent === o.agent)) row.carriers.push({ agent: o.agent, on: false });
  const order = new Map(reads.map((o, i) => [o.agent, i]));
  const skills = [...by.values()].map((r) => ({ ...r, carriers: r.carriers.sort((a, b) => order.get(a.agent)! - order.get(b.agent)!) }));
  skills.sort((a, b) => Number(b.carriers.some((c) => c.on)) - Number(a.carriers.some((c) => c.on)) || a.name.localeCompare(b.name));
  return { seats: reads.map((o) => ({ agent: o.agent, role: o.role })), skills };
}
