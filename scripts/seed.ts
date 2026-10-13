// Usage: pnpm seed  (after applying the migration). Safe to run again.
//
// Day-one data from the handoff (§Seed día uno): four projects, no historical tickets.
// - title and body belong to this seed until someone edits them with set_project (version > 1);
//   until then every run rewrites them, so fixing a body means editing here and rerunning.
// - v2 has no hand-written resume card. The handoff's must_keep_decision becomes a pinned project
//   decision, added once (a rerun finds it by text and leaves it alone).
// - rules_text and design_pages are not in the handoff seed and are left untouched.
import { pathToFileURL } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { withDb, type Db } from "../src/db/client.js";
import { decisions, projects, type Actor } from "../src/db/schema.js";
import { writeTx } from "../src/mcp/tx.js";

type Seed = { slug: string; title: string; prefix: string; body: string; must_keep: string };

const SEED_ACTOR: Actor = { agent: "seed", session_id: "seed" };

export const SEED: Seed[] = [
  {
    slug: "micasa",
    prefix: "MIC",
    title: "MiCasa",
    body: "Finanzas personal y del hogar centrada en quincenas (FIRST: días 1–15, SECOND: 16–fin de mes) como unidad de planeación, con soporte para contexto usuario o casa compartida. Stack: Next.js 16, React 19, TypeScript, PostgreSQL, Prisma 7 (Neon prod), NextAuth v5, Tailwind v4, Zod, Vitest. Módulos: Finanzas (quincenas, panel, gastos, operaciones, presupuestos, billeteras, tarjetas, importación estados de cuenta, proyección liquidez), Despensa, Tareas del hogar. Repo: https://github.com/Jorg3L3on/micasa. Casa real: Leon Solórzano (no Sandbox). Jorge corre las migraciones. Sin deploy prod salvo que diga lo contrario.",
    must_keep: "La herramienta Plania es la fuente del plan; no Markdown de trabajo en el repo.",
  },
  {
    slug: "workia",
    prefix: "WRK",
    title: "Workia",
    body: "Producto Workia. Repo: https://github.com/Jorg3L3on/workia. Dueño de producto: el bot Workia. Taller implementa, revisa y shippea. Solo deploys a producción en Vercel (sin preview). Linear ya no es la fuente del plan.",
    must_keep: "Plania es la fuente del plan.",
  },
  {
    slug: "filmia",
    prefix: "FIL",
    title: "Filmia",
    body: "Tracker personal de películas y series. Repo: https://github.com/Jorg3L3on/filmia. Neon + Vercel (proyecto pausado en Vercel hasta nuevo aviso; flujo de código vía rama sandbox). Solo deploys a producción cuando haya deploy. Linear ya no es la fuente del plan.",
    must_keep: "Plania es la fuente del plan.",
  },
  {
    slug: "zigzag",
    prefix: "ZIG",
    title: "Zigzag",
    body: "App de recibos; nombre nuevo fuera de v1.",
    must_keep: "El nombre nuevo espera; slug zigzag se queda en v1.",
  },
];

// Returns, per slug, whether its pinned decision was added on this run.
export async function seedProjects(db: Db): Promise<{ slug: string; pinned: boolean }[]> {
  const out: { slug: string; pinned: boolean }[] = [];
  for (const s of SEED) {
    const [p] = await db
      .insert(projects)
      .values({ slug: s.slug, title: s.title, body: s.body, keyPrefix: s.prefix })
      // Once set_project edited the project (version > 1), its text belongs to the project, not the seed.
      .onConflictDoUpdate({
        target: projects.slug,
        set: { title: s.title, body: s.body, keyPrefix: s.prefix, updatedAt: sql`now()` },
        setWhere: sql`${projects.version} = 1`,
      })
      .returning();
    const project = p ?? (await db.select().from(projects).where(eq(projects.slug, s.slug)))[0]!;
    // 2.7: a row this run inserted (version 1, created just now) tells the feed the project exists.
    if (p && p.version === 1 && Date.now() - p.createdAt.getTime() < 60_000) {
      await writeTx(db, project, { actor: SEED_ACTOR, requestId: `project-created:${project.slug}`, tool: "seed" }, async (_tx, emit) => {
        await emit("project.created", null, { slug: project.slug, title: project.title, key_prefix: project.keyPrefix });
      });
    }
    const pinned = await writeTx(db, project, { actor: SEED_ACTOR }, async (tx, emit) => {
      const [existing] = await tx
        .select({ id: decisions.id })
        .from(decisions)
        .where(and(eq(decisions.projectId, project.id), eq(decisions.line, s.must_keep)))
        .limit(1);
      if (existing || !s.must_keep) return false;
      const [d] = await tx
        .insert(decisions)
        .values({ projectId: project.id, line: s.must_keep, pinned: true, actor: SEED_ACTOR })
        .returning();
      await emit("decision.added", null, { decision_id: d!.id, text: d!.line, pinned: true });
      return true;
    });
    out.push({ slug: s.slug, pinned });
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await withDb(async (db) => {
    for (const r of await seedProjects(db)) {
      console.log(`${r.slug}: body set; pinned decision ${r.pinned ? "added" : "kept"}`);
    }
  });
}
