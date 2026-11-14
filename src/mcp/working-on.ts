import { readerOf } from "../store/port.js";
import { gt, notNull } from "../store/types.js";
import { payloadText } from "./delegate.js";
import type { Q } from "./tx.js";

// PLA-I26: the one "working on" key for CEO and Equipo.
// A live claim lease wins. Otherwise the owner's In progress ticket, then a Ready one.

export type WorkingOn = { project: string; key: string; title: string };

type Row = {
  project: string;
  key: string;
  title: string;
  status: string;
  owner_agent: string | null;
  lease_agent: string | null;
  lease_until: Date | string | null;
};

type Candidate = WorkingOn & { status: string };

const byKey = (a: WorkingOn, b: WorkingOn) => a.project.localeCompare(b.project) || a.key.localeCompare(b.key);

const byStatusThenKey = (a: Candidate, b: Candidate) => {
  const rank = (status: string) => (status === "In progress" ? 0 : 1);
  return rank(a.status) - rank(b.status) || byKey(a, b);
};

export const workingOnBySlug = async (db: Q, now = new Date()): Promise<Map<string, WorkingOn>> => {
  const r = readerOf(db);
  const roster = await r.find("agents");
  const slugById = new Map(roster.map((row) => [row.id, row.slug]));
  const slugByLabel = new Map<string, string>();
  for (const row of roster) {
    slugByLabel.set(row.slug.toLowerCase(), row.slug);
    slugByLabel.set(row.name.trim().toLowerCase(), row.slug);
  }

  // Tickets with a live lease, and tickets an agent owns that are Ready or In progress; test tickets
  // ([PRUEBA] in the title) never count.
  const leased = await r.find("tasks", { kind: "ticket", owner: notNull(), leaseUntil: gt(now) });
  const assigned = await r.find("tasks", { kind: "ticket", ownerAgent: notNull(), status: ["Ready", "In progress"] });
  const tickets = [...new Map([...leased, ...assigned].map((t) => [t.id, t])).values()].filter((t) => !t.title.includes("[PRUEBA]"));
  const slugOf = new Map(tickets.length ? (await r.find("projects", { id: [...new Set(tickets.map((t) => t.projectId))] })).map((p) => [p.id, p.slug]) : []);
  const found: Row[] = tickets.flatMap((t) => {
    const project = slugOf.get(t.projectId);
    if (project === undefined) return [];
    // owner->>'agent': the lease holder's agent as text.
    const lease_agent = t.owner ? payloadText(t.owner, "agent") : null;
    return [{ project, key: t.key, title: t.title, status: t.status, owner_agent: t.ownerAgent, lease_agent, lease_until: t.leaseUntil }];
  });

  const leases = new Map<string, WorkingOn[]>();
  const owned = new Map<string, Candidate[]>();
  for (const row of found) {
    const item = { project: row.project, key: row.key, title: row.title };
    const leaseLive = !!row.lease_agent && !!row.lease_until && new Date(row.lease_until).getTime() > now.getTime();
    if (leaseLive) {
      const slug = slugByLabel.get(row.lease_agent!.trim().toLowerCase());
      if (slug) {
        const list = leases.get(slug) ?? [];
        list.push(item);
        leases.set(slug, list);
      }
    }
    if ((row.status === "Ready" || row.status === "In progress") && row.owner_agent) {
      const slug = slugById.get(row.owner_agent);
      if (!slug) continue;
      const list = owned.get(slug) ?? [];
      list.push({ ...item, status: row.status });
      owned.set(slug, list);
    }
  }

  const out = new Map<string, WorkingOn>();
  for (const row of roster) {
    const lease = (leases.get(row.slug) ?? []).sort(byKey)[0];
    const owner = (owned.get(row.slug) ?? []).sort(byStatusThenKey)[0];
    const picked = lease ?? owner;
    if (picked) out.set(row.slug, { project: picked.project, key: picked.key, title: picked.title });
  }
  return out;
};
