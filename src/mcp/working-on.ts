import { sql } from "drizzle-orm";
import { agents } from "../db/schema.js";
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
  const roster = await db.select({ id: agents.id, slug: agents.slug, name: agents.name }).from(agents);
  const slugById = new Map(roster.map((row) => [row.id, row.slug]));
  const slugByLabel = new Map<string, string>();
  for (const row of roster) {
    slugByLabel.set(row.slug.toLowerCase(), row.slug);
    slugByLabel.set(row.name.trim().toLowerCase(), row.slug);
  }

  const found = await db.execute<Row>(sql`
    select p.slug as project, t.key, t.title, t.status, t.owner_agent::text as owner_agent,
           t.owner->>'agent' as lease_agent, t.lease_until
    from tasks t
    join projects p on p.id = t.project_id
    where t.kind = 'ticket'
      and position('[PRUEBA]' in t.title) = 0
      and (
        (t.owner is not null and t.lease_until > ${now.toISOString()}::timestamptz)
        or (t.owner_agent is not null and t.status in ('Ready', 'In progress'))
      )`);

  const leases = new Map<string, WorkingOn[]>();
  const owned = new Map<string, Candidate[]>();
  for (const row of found.rows) {
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
