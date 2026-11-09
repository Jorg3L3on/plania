// The roster as PLA-I30-1 left it (11 rows: ceo, asistente, the shared taller, research and artist, and one
// PO per project, named after its bot), with no project teams. Tests whose subject is not the roster
// (dashboards, delegation, the presence sweep, routines...) use it as their fixture, so PLA-I32-2's
// per-project teams (scripts/seed-org.ts, test/i32-roster.test.ts) do not rewrite them. Fake values only.
import { eq, sql } from "drizzle-orm";
import type { Db } from "../../src/db/client.js";
import { agents } from "../../src/db/schema.js";

type Row = { slug: string; name: string; role: string; title: string; kind: "bot" | "human"; reportsTo: string | null; capabilities: string[]; note?: string };

const po = (slug: string, name: string, project: string, note?: string): Row => ({
  slug,
  name,
  role: "product-owner",
  title: "Product owner",
  kind: "bot",
  reportsTo: "ceo",
  capabilities: [project],
  ...(note ? { note } : {}),
});

export const LEGACY_ORG: Row[] = [
  { slug: "ceo", name: "CEO", role: "human", title: "CEO", kind: "human", reportsTo: null, capabilities: [] },
  { slug: "asistente", name: "Asistente", role: "chief-of-staff", title: "Chief of Staff", kind: "bot", reportsTo: "ceo", capabilities: ["staff"] },
  { slug: "taller", name: "Taller", role: "taller", title: "Builder", kind: "bot", reportsTo: "ceo", capabilities: ["engineering"] },
  { slug: "research", name: "Research", role: "shared", title: "Shared service", kind: "bot", reportsTo: "asistente", capabilities: ["research"] },
  { slug: "artist", name: "Artist", role: "shared", title: "Shared service", kind: "bot", reportsTo: "asistente", capabilities: ["design"] },
  po("po-mianovia", "Mianovia", "mianovia"),
  po("housi", "Housi", "micasa", "MiCasa"),
  po("workia", "Workia", "workia"),
  po("filmia", "Filmia", "filmia"),
  po("zigzag", "ZigZag", "zigzag"),
  po("owner-plania", "Plania", "plania"),
];

// Same contract as seedOrg's first form: inserts what is missing, leaves edits in place, fills reports_to
// while empty. Returns the slugs it inserted.
export async function seedLegacyOrg(db: Db): Promise<{ inserted: string[]; removed: string[] }> {
  const inserted: string[] = [];
  for (const row of LEGACY_ORG) {
    const human = row.kind === "human";
    const [made] = await db
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
        adapter: human ? "none" : "claude_code",
        adapterConfig: human ? {} : { command_env: "CLAUDE_CODE_BIN", args_env: "CLAUDE_CODE_ARGS" },
        heartbeatMinutes: null,
      })
      .onConflictDoNothing({ target: agents.slug })
      .returning({ slug: agents.slug });
    if (made) inserted.push(made.slug);
  }
  for (const row of LEGACY_ORG) {
    if (!row.reportsTo) continue;
    const [self] = await db.select().from(agents).where(eq(agents.slug, row.slug)).limit(1);
    const [parent] = await db.select().from(agents).where(eq(agents.slug, row.reportsTo)).limit(1);
    if (!self || !parent || self.reportsTo) continue;
    await db.update(agents).set({ reportsTo: parent.id, updatedAt: sql`now()` }).where(eq(agents.id, self.id));
  }
  return { inserted, removed: [] };
}
