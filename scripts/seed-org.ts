// Usage: pnpm tsx --env-file=.env scripts/seed-org.ts
//
// PLA-I21 org chart, cut to the real roles in PLA-I30-1. Roles and bot labels only: the human row is
// «CEO», never a person's name. Idempotent. First the retired rows go (their tickets, runs and sessions
// move to `into` when it is set). A row that already exists keeps its name, title, role, capabilities,
// note and wake_url (the chart is editable). PLA-I32-2: then the product owners are renamed po-<project>,
// every project gets its team (PO, Research, Artist, Taller with project_id and role_template), and the
// shared research, artist and taller rows are retired (status retired; runs and history stay). reports_to is filled only while it is still empty, so a re-parent sticks and a link to a retired row
// is repaired. Adapter fields are filled while they are still the default (adapter none, empty config,
// no cadence) or a dead http row (no wake_url, no config). Safe to run again. Config values are env var names.
import { pathToFileURL } from "node:url";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { withDb, type Db } from "../src/db/client.js";
import { agentRuns, agentSessions, agents, heartbeatRuns, projects, tasks, type AdapterConfig, type AdapterName, type Agent } from "../src/db/schema.js";
import { RUNNER_CONFIG, ensureTeam, teamSlug, untouchedAdapter, type TeamTemplate } from "../src/runner/team.js";

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

// PLA-I30-1 cut the roster to the real roles; PLA-I32-2 gives every project its own team. The company
// rows are the CEO seat (human, no bot) and Asistente (chief of staff, no project, a runner role). Each
// project's team (PO, Research, Artist, Taller) comes from the role templates in src/runner/team.ts.
// Cadence stays null: the pilot turns heartbeats on per agent, never this seed.
const claude: Pick<OrgRow, "adapter" | "adapterConfig" | "heartbeatMinutes"> = {
  adapter: "claude_code",
  adapterConfig: { command_env: "CLAUDE_CODE_BIN", args_env: "CLAUDE_CODE_ARGS" },
  heartbeatMinutes: null,
};

export const ORG: OrgRow[] = [
  { slug: "ceo", name: "CEO", role: "human", title: "CEO", kind: "human", reportsTo: null, capabilities: [], adapter: "none", adapterConfig: {}, heartbeatMinutes: null },
  { slug: "asistente", name: "Asistente", role: "chief-of-staff", title: "Chief of Staff", kind: "bot", reportsTo: "ceo", capabilities: ["staff"], ...claude },
];

// PLA-I32-2: product owners named after their bot become po-<project>. The old slug stays in the note.
export const RENAMED: Record<string, string> = {
  housi: "po-micasa",
  filmia: "po-filmia",
  "owner-plania": "po-plania",
  workia: "po-workia",
  zigzag: "po-zigzag",
};

// PLA-I32-2: the shared services give way to one per project. They stay as retired rows, so their runs
// and history keep their agent; their open tickets move to the same role in the ticket's project.
export const SHARED_RETIRED = ["research", "artist", "taller"] as const;

// Rows that leave the roster. `into` takes the retired row's tickets, runs and sessions first
// (claude-code folds into taller; cursor's tickets go to taller too). `role` guards the slug, so the
// COO «plania» goes and nothing else named plania does.
export const RETIRED: { slug: string; role?: string; into?: string }[] = [
  { slug: "cursor", into: "taller" },
  { slug: "claude-code", into: "taller" },
  { slug: "coach" },
  { slug: "plania", role: "coo" },
];

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

const TERMINAL = ["Merged", "Released", "Done", "Won't do"];

// housi → po-micasa and the rest: the row (and with it every run, session and ticket) keeps its id.
async function renamePos(db: Db): Promise<string[]> {
  const renamed: string[] = [];
  for (const [from, to] of Object.entries(RENAMED)) {
    const old = await bySlug(db, from);
    if (!old || (await bySlug(db, to))) continue;
    const note = old.note.includes(`alias: ${from}`) ? old.note : [old.note, `alias: ${from}`].filter(Boolean).join(" · ");
    const runner = untouchedAdapter(old) ? { adapter: RUNNER_CONFIG.adapter, adapterConfig: RUNNER_CONFIG.adapterConfig } : {};
    await db
      .update(agents)
      .set({ slug: to, note: note.slice(0, 2000), roleTemplate: old.roleTemplate ?? "product-owner", ...runner, updatedAt: sql`now()` })
      .where(eq(agents.id, old.id));
    renamed.push(`${from}→${to}`);
  }
  return renamed;
}

// The shared research, artist and taller rows: retired (runs, sessions and history stay on them), out of the
// runner (adapter none, no cadence), and their open tickets handed to the same role in each ticket's project.
async function retireShared(db: Db): Promise<string[]> {
  const retired: string[] = [];
  for (const slug of SHARED_RETIRED) {
    const row = await bySlug(db, slug);
    if (!row || row.projectId || row.status === "retired") continue;
    const open = await db
      .select({ id: tasks.id, project: projects.slug })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.ownerAgent, row.id), notInArray(tasks.status, TERMINAL)));
    for (const t of open) {
      const heir = await bySlug(db, teamSlug(slug as TeamTemplate, t.project));
      await db.update(tasks).set({ ownerAgent: heir?.id ?? null }).where(eq(tasks.id, t.id));
    }
    await db
      .update(agents)
      .set({ status: "retired", adapter: "none", heartbeatMinutes: null, reportsTo: null, updatedAt: sql`now()` })
      .where(eq(agents.id, row.id));
    retired.push(slug);
  }
  return retired;
}

export async function seedOrg(db: Db): Promise<{ inserted: string[]; removed: string[]; renamed: string[]; retired: string[] }> {
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
        roleTemplate: row.slug === "asistente" ? "asistente" : null,
      })
      .onConflictDoNothing({ target: agents.slug })
      .returning({ slug: agents.slug });
    if (created) {
      inserted.push(created.slug);
      continue;
    }
    const existing = await bySlug(db, row.slug);
    if (!existing) continue;
    if (row.slug === "asistente" && !existing.roleTemplate) {
      await db.update(agents).set({ roleTemplate: "asistente", projectId: null, updatedAt: sql`now()` }).where(eq(agents.id, existing.id));
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

  const renamed = await renamePos(db);
  // Every product owner joins the runner while its adapter is still the default, with or without a project row.
  for (const a of await db.select().from(agents).where(eq(agents.role, "product-owner"))) {
    if (!untouchedAdapter(a)) continue;
    await db.update(agents).set({ adapter: RUNNER_CONFIG.adapter, adapterConfig: RUNNER_CONFIG.adapterConfig, updatedAt: sql`now()` }).where(eq(agents.id, a.id));
  }
  // Every project gets its four; a PO that existed already (po-mianovia, the renamed ones) is reused.
  for (const p of await db.select({ id: projects.id, slug: projects.slug, title: projects.title }).from(projects).orderBy(asc(projects.slug))) {
    const { created } = await ensureTeam(db, p);
    inserted.push(...created);
  }
  const retired = await retireShared(db);
  return { inserted, removed, renamed, retired };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await withDb(async (db) => {
    const { inserted, removed, renamed, retired } = await seedOrg(db);
    if (removed.length) console.log(`removed ${removed.join(", ")}`);
    if (renamed.length) console.log(`renamed ${renamed.join(", ")}`);
    if (retired.length) console.log(`retired ${retired.join(", ")}`);
    console.log(inserted.length ? `inserted ${inserted.join(", ")}` : "org already present");
  });
}
