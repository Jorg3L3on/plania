// Usage: pnpm seed  (after applying the migration). Safe to run again.
//
// Day-one data from the handoff (§Seed día uno): four projects, no historical tickets.
// - title and body belong to this seed: every run rewrites them, so fixing a body means editing here and rerunning.
// - The resume card belongs to agents once they use update_resume: the seed writes it only while all
//   four fields are still empty, so a rerun never clobbers live work.
// - rules_text and design_pages are not in the handoff seed and are left untouched.
import { pathToFileURL } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { withDb, type Db } from "../src/db/client.js";
import { projects } from "../src/db/schema.js";

type Seed = {
  slug: string;
  title: string;
  body: string;
  resume: { in_progress: string; next_action: string; branch_or_prod: string; must_keep_decision: string };
};

export const SEED: Seed[] = [
  {
    slug: "micasa",
    title: "MiCasa",
    body: "Finanzas personal y del hogar centrada en quincenas (FIRST: días 1–15, SECOND: 16–fin de mes) como unidad de planeación, con soporte para contexto usuario o casa compartida. Stack: Next.js 16, React 19, TypeScript, PostgreSQL, Prisma 7 (Neon prod), NextAuth v5, Tailwind v4, Zod, Vitest. Módulos: Finanzas (quincenas, panel, gastos, operaciones, presupuestos, billeteras, tarjetas, importación estados de cuenta, proyección liquidez), Despensa, Tareas del hogar. Repo: https://github.com/Jorg3L3on/micasa. Casa real: Leon Solórzano (no Sandbox). Jorge corre las migraciones. Sin deploy prod salvo que diga lo contrario.",
    resume: {
      in_progress: "Sin trabajo de producto en curso en Linear; lote visual en main (PR #271).",
      next_action: "Arrancar Plania como fuente; no importar catálogo de errores ni tablero Notion.",
      branch_or_prod: "main (prod); sandbox un commit adelante (npm audit).",
      must_keep_decision: "La herramienta Plania es la fuente del plan; no Markdown de trabajo en el repo.",
    },
  },
  {
    slug: "workia",
    title: "Workia",
    body: "Producto Workia. Repo: https://github.com/Jorg3L3on/workia. Dueño de producto: el bot Workia. Taller implementa, revisa y shippea. Solo deploys a producción en Vercel (sin preview). Linear ya no es la fuente del plan.",
    resume: {
      in_progress: "Sin trabajo de producto abierto en Plania aún.",
      next_action: "Definir primera iniciativa en Plania cuando toque.",
      branch_or_prod: "main",
      must_keep_decision: "Plania es la fuente del plan.",
    },
  },
  {
    slug: "filmia",
    title: "Filmia",
    body: "Tracker personal de películas y series. Repo: https://github.com/Jorg3L3on/filmia. Neon + Vercel (proyecto pausado en Vercel hasta nuevo aviso; flujo de código vía rama sandbox). Solo deploys a producción cuando haya deploy. Linear ya no es la fuente del plan.",
    resume: {
      in_progress: "Filmia pausado en Vercel; sin lote abierto en Plania.",
      next_action: "Retomar cuando Jorge reactive el proyecto.",
      branch_or_prod: "sandbox / main según el flujo vigente.",
      must_keep_decision: "Plania es la fuente del plan.",
    },
  },
  {
    slug: "zigzag",
    title: "Zigzag",
    body: "App de recibos; nombre nuevo fuera de v1.",
    resume: {
      in_progress: "",
      next_action: "Escribir el cuerpo cuando el concepto de recibos esté fijo.",
      branch_or_prod: "",
      must_keep_decision: "El nombre nuevo espera; slug zigzag se queda en v1.",
    },
  },
];

const cardIsEmpty = sql`(
  ${projects.resumeInProgress} = '' and ${projects.resumeNextAction} = ''
  and ${projects.resumeBranchOrProd} = '' and ${projects.resumeMustKeepDecision} = ''
)`;

// Returns, per slug, whether the resume card was written on this run.
export async function seedProjects(db: Db): Promise<{ slug: string; resumeWritten: boolean }[]> {
  const out: { slug: string; resumeWritten: boolean }[] = [];
  for (const s of SEED) {
    const card = {
      resumeInProgress: s.resume.in_progress,
      resumeNextAction: s.resume.next_action,
      resumeBranchOrProd: s.resume.branch_or_prod,
      resumeMustKeepDecision: s.resume.must_keep_decision,
    };
    const inserted = await db
      .insert(projects)
      .values({ slug: s.slug, title: s.title, body: s.body, ...card })
      .onConflictDoNothing({ target: projects.slug })
      .returning({ slug: projects.slug });
    if (inserted.length) {
      out.push({ slug: s.slug, resumeWritten: true });
      continue;
    }
    await db
      .update(projects)
      .set({ title: s.title, body: s.body, updatedAt: sql`now()` })
      .where(eq(projects.slug, s.slug));
    const written = await db
      .update(projects)
      .set(card)
      .where(and(eq(projects.slug, s.slug), cardIsEmpty))
      .returning({ slug: projects.slug });
    out.push({ slug: s.slug, resumeWritten: written.length > 0 });
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await withDb(async (db) => {
    for (const r of await seedProjects(db)) {
      console.log(`${r.slug}: body set; resume ${r.resumeWritten ? "written" : "kept"}`);
    }
  });
}
