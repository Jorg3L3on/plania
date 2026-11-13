// The roster as PLA-I30-1 left it (11 rows: ceo, asistente, the shared taller, research and artist, and one
// PO per project, named after its bot), with no project teams. Tests whose subject is not the roster
// (dashboards, delegation, the presence sweep, routines...) use it as their fixture, so PLA-I32-2's
// per-project teams (scripts/seed-org.ts, test/i32-roster.test.ts) do not rewrite them. Fake values only.
// It writes through the store port, so it seeds the roster on Postgres and on devva alike.
import type { Db } from "../../src/db/client.js";
import { pgStore } from "../../src/store/pg.js";

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
// while empty. Returns the slugs it inserted. One roster write (project ""), as seedOrg's are.
export async function seedLegacyOrg(db: Db): Promise<{ inserted: string[]; removed: string[] }> {
  return pgStore(db).write("", {}, async (uow) => {
    const inserted: string[] = [];
    for (const row of LEGACY_ORG) {
      if (await uow.get("agents", { slug: row.slug })) continue;
      const human = row.kind === "human";
      const made = await uow.insert("agents", {
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
      });
      inserted.push(made.slug);
    }
    for (const row of LEGACY_ORG) {
      if (!row.reportsTo) continue;
      const self = await uow.get("agents", { slug: row.slug });
      const parent = await uow.get("agents", { slug: row.reportsTo });
      if (!self || !parent || self.reportsTo) continue;
      await uow.update("agents", { id: self.id }, { reportsTo: parent.id, updatedAt: uow.now });
    }
    return { inserted, removed: [] };
  });
}
