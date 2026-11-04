// Usage: pnpm tsx --env-file=.env scripts/seed-org.ts
//
// PLA-I21 org chart. Roles and bot labels only: the human row is «CEO», never a person's name.
// Idempotent. A row that already exists keeps its name, title, role, capabilities, note and wake_url
// (the chart is editable). reports_to is filled only while it is still empty, so a re-parent sticks
// and a missing link is repaired. Safe to run again.
import { pathToFileURL } from "node:url";
import { eq, sql } from "drizzle-orm";
import { withDb, type Db } from "../src/db/client.js";
import { agents, type Agent } from "../src/db/schema.js";

export type OrgRow = {
  slug: string;
  name: string;
  role: string;
  title: string;
  kind: "bot" | "coder" | "human";
  reportsTo: string | null;
  capabilities: string[];
  note?: string;
};

// CEO at the top. Asistente (Chief of Staff) leads the shared services. Plania (COO) leads product
// owners. Taller (CTO) leads the coding agents. Product owner «Plania» is owner-plania, not the COO.
export const ORG: OrgRow[] = [
  { slug: "ceo", name: "CEO", role: "human", title: "CEO", kind: "human", reportsTo: null, capabilities: [] },
  { slug: "asistente", name: "Asistente", role: "chief-of-staff", title: "Chief of Staff", kind: "bot", reportsTo: "ceo", capabilities: ["staff"] },
  { slug: "plania", name: "Plania", role: "coo", title: "COO", kind: "bot", reportsTo: "ceo", capabilities: ["coo"] },
  { slug: "taller", name: "Taller", role: "cto", title: "CTO", kind: "bot", reportsTo: "ceo", capabilities: ["engineering"] },
  { slug: "cursor", name: "Cursor", role: "engineer", title: "Engineer", kind: "coder", reportsTo: "taller", capabilities: ["cursor"] },
  { slug: "claude-code", name: "Claude Code", role: "engineer", title: "Engineer", kind: "coder", reportsTo: "taller", capabilities: ["claude-code"] },
  { slug: "artist", name: "Artist", role: "shared", title: "Shared service", kind: "bot", reportsTo: "asistente", capabilities: ["design"] },
  { slug: "research", name: "Research", role: "shared", title: "Shared service", kind: "bot", reportsTo: "asistente", capabilities: ["research"] },
  { slug: "coach", name: "Coach", role: "shared", title: "Shared service", kind: "bot", reportsTo: "asistente", capabilities: ["coaching"] },
  { slug: "housi", name: "Housi", role: "product-owner", title: "Product owner", kind: "bot", reportsTo: "plania", capabilities: ["micasa"], note: "MiCasa" },
  { slug: "workia", name: "Workia", role: "product-owner", title: "Product owner", kind: "bot", reportsTo: "plania", capabilities: ["workia"] },
  { slug: "filmia", name: "Filmia", role: "product-owner", title: "Product owner", kind: "bot", reportsTo: "plania", capabilities: ["filmia"] },
  { slug: "zigzag", name: "ZigZag", role: "product-owner", title: "Product owner", kind: "bot", reportsTo: "plania", capabilities: ["zigzag"] },
  { slug: "owner-plania", name: "Plania", role: "product-owner", title: "Product owner", kind: "bot", reportsTo: "plania", capabilities: ["plania"] },
];

async function bySlug(db: Db, slug: string): Promise<Agent | undefined> {
  const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  return row;
}

export async function seedOrg(db: Db): Promise<{ inserted: string[] }> {
  const inserted: string[] = [];
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
      })
      .onConflictDoNothing({ target: agents.slug })
      .returning({ slug: agents.slug });
    if (created) inserted.push(created.slug);
  }
  for (const row of ORG) {
    if (!row.reportsTo) continue;
    const self = await bySlug(db, row.slug);
    const parent = await bySlug(db, row.reportsTo);
    if (!self || !parent || self.reportsTo) continue;
    await db.update(agents).set({ reportsTo: parent.id, updatedAt: sql`now()` }).where(eq(agents.id, self.id));
  }
  return { inserted };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await withDb(async (db) => {
    const { inserted } = await seedOrg(db);
    console.log(inserted.length ? `inserted ${inserted.join(", ")}` : "org already present");
  });
}
