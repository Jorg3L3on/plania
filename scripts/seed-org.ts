// Usage: pnpm tsx --env-file=.env scripts/seed-org.ts
//
// PLA-I21 org chart, cut to the real roles in PLA-I30-1. Roles and bot labels only: the human row is
// «CEO», never a person's name. Idempotent. First the retired rows go (their tickets, runs and sessions
// move to `into` when it is set). A row that already exists keeps its name, title, role, capabilities,
// note and wake_url (the chart is editable), except the legacy CTO role, which becomes the builder.
// reports_to is filled only while it is still empty, so a re-parent sticks and a link to a retired row
// is repaired. Adapter fields are filled while they are still the default (adapter none, empty config,
// no cadence) or a dead http row (no wake_url, no config). Safe to run again. Config values are env var names.
import { pathToFileURL } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withDb, type Db } from "../src/db/client.js";
import { agentRuns, agentSessions, agents, heartbeatRuns, tasks, type AdapterConfig, type AdapterName, type Agent } from "../src/db/schema.js";

export type OrgRow = {
  slug: string;
  name: string;
  role: string;
  title: string;
  kind: "bot" | "coder" | "human";
  reportsTo: string | null;
  capabilities: string[];
  note?: string;
  adapter: AdapterName;
  adapterConfig: AdapterConfig;
  heartbeatMinutes: number | null;
};

// PLA-I30-1: the real roles only, Claude Code only. Jorge is the CEO (human, no bot). Asistente
// (chief of staff), Taller (the builder) and one product owner per project report to him; Research
// and Artist are services under Asistente. No COO, no CTO layer, no Coach, no Cursor. Cadence stays
// null: the pilot (A8) turns heartbeats on per agent, never this seed.
const claude: Pick<OrgRow, "adapter" | "adapterConfig" | "heartbeatMinutes"> = {
  adapter: "claude_code",
  adapterConfig: { command_env: "CLAUDE_CODE_BIN", args_env: "CLAUDE_CODE_ARGS" },
  heartbeatMinutes: null,
};

const po = (slug: string, name: string, project: string, note?: string): OrgRow => ({
  slug,
  name,
  role: "product-owner",
  title: "Product owner",
  kind: "bot",
  reportsTo: "ceo",
  capabilities: [project],
  ...(note ? { note } : {}),
  ...claude,
});

export const ORG: OrgRow[] = [
  { slug: "ceo", name: "CEO", role: "human", title: "CEO", kind: "human", reportsTo: null, capabilities: [], adapter: "none", adapterConfig: {}, heartbeatMinutes: null },
  { slug: "asistente", name: "Asistente", role: "chief-of-staff", title: "Chief of Staff", kind: "bot", reportsTo: "ceo", capabilities: ["staff"], ...claude },
  { slug: "taller", name: "Taller", role: "taller", title: "Builder", kind: "bot", reportsTo: "ceo", capabilities: ["engineering"], ...claude },
  { slug: "research", name: "Research", role: "shared", title: "Shared service", kind: "bot", reportsTo: "asistente", capabilities: ["research"], ...claude },
  { slug: "artist", name: "Artist", role: "shared", title: "Shared service", kind: "bot", reportsTo: "asistente", capabilities: ["design"], ...claude },
  po("po-mianovia", "Mianovia", "mianovia"),
  po("housi", "Housi", "micasa", "MiCasa"),
  po("workia", "Workia", "workia"),
  po("filmia", "Filmia", "filmia"),
  po("zigzag", "ZigZag", "zigzag"),
  po("owner-plania", "Plania", "plania"),
];

// Rows that leave the roster. `into` takes the retired row's tickets, runs and sessions first
// (claude-code folds into taller; cursor's tickets go to taller too). `role` guards the slug, so the
// COO «plania» goes and nothing else named plania does.
export const RETIRED: { slug: string; role?: string; into?: string }[] = [
  { slug: "cursor", into: "taller" },
  { slug: "claude-code", into: "taller" },
  { slug: "coach" },
  { slug: "plania", role: "coo" },
];

// Old shapes the seed upgrades in place: the CTO layer becomes the builder role.
const LEGACY_ROLE: Record<string, { from: string[]; role: string; title: string }> = {
  taller: { from: ["cto", "engineer"], role: "taller", title: "Builder" },
};

async function bySlug(db: Db, slug: string): Promise<Agent | undefined> {
  const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  return row;
}

export async function retireOrg(db: Db): Promise<{ removed: string[] }> {
  const removed: string[] = [];
  for (const r of RETIRED) {
    const row = await bySlug(db, r.slug);
    if (!row || (r.role && row.role !== r.role)) continue;
    const heir = r.into ? await bySlug(db, r.into) : undefined;
    await db.transaction(async (tx) => {
      if (heir) {
        await tx.update(tasks).set({ ownerAgent: heir.id }).where(eq(tasks.ownerAgent, row.id));
        await tx.update(heartbeatRuns).set({ agentId: heir.id }).where(eq(heartbeatRuns.agentId, row.id));
        await tx.update(agentRuns).set({ agentId: heir.id }).where(eq(agentRuns.agentId, row.id));
        // A session is per agent and project: the heir keeps its own where both have one.
        const mine = await tx.select({ projectId: agentSessions.projectId }).from(agentSessions).where(eq(agentSessions.agentId, heir.id));
        const taken = mine.map((m) => m.projectId);
        if (taken.length) await tx.delete(agentSessions).where(and(eq(agentSessions.agentId, row.id), inArray(agentSessions.projectId, taken)));
        await tx.update(agentSessions).set({ agentId: heir.id }).where(eq(agentSessions.agentId, row.id));
      }
      await tx.delete(agents).where(eq(agents.id, row.id));
    });
    removed.push(r.slug);
  }
  return { removed };
}

export async function seedOrg(db: Db): Promise<{ inserted: string[]; removed: string[] }> {
  const inserted: string[] = [];
  const { removed } = await retireOrg(db);
  for (const row of ORG) {
    const [created] = await db
      .insert(agents)
      .values({
        slug: row.slug,
        name: row.name,
        role: row.role,
        title: row.title,
        kind: row.kind,
        capabilities: row.capabilities,
        note: row.note ?? "",
        status: "idle",
        adapter: row.adapter,
        adapterConfig: row.adapterConfig,
        heartbeatMinutes: row.heartbeatMinutes,
      })
      .onConflictDoNothing({ target: agents.slug })
      .returning({ slug: agents.slug });
    if (created) {
      inserted.push(created.slug);
      continue;
    }
    const existing = await bySlug(db, row.slug);
    if (!existing) continue;
    const legacy = LEGACY_ROLE[row.slug];
    if (legacy && legacy.from.includes(existing.role)) {
      await db.update(agents).set({ role: legacy.role, title: legacy.title, updatedAt: sql`now()` }).where(eq(agents.id, existing.id));
    }
    const config = existing.adapterConfig ?? {};
    const empty = existing.heartbeatMinutes == null && Object.keys(config).length === 0;
    const untouched = empty && (existing.adapter === "none" || (existing.adapter === "http" && !existing.wakeUrl));
    if (!untouched) continue;
    if (row.adapter === "none" && row.heartbeatMinutes == null) continue;
    await db
      .update(agents)
      .set({ adapter: row.adapter, adapterConfig: row.adapterConfig, heartbeatMinutes: row.heartbeatMinutes, updatedAt: sql`now()` })
      .where(eq(agents.id, existing.id));
  }
  for (const row of ORG) {
    if (!row.reportsTo) continue;
    const self = await bySlug(db, row.slug);
    const parent = await bySlug(db, row.reportsTo);
    if (!self || !parent || self.reportsTo) continue;
    await db.update(agents).set({ reportsTo: parent.id, updatedAt: sql`now()` }).where(eq(agents.id, self.id));
  }
  return { inserted, removed };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await withDb(async (db) => {
    const { inserted, removed } = await seedOrg(db);
    if (removed.length) console.log(`removed ${removed.join(", ")}`);
    console.log(inserted.length ? `inserted ${inserted.join(", ")}` : "org already present");
  });
}
