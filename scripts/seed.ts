// Usage: pnpm seed  (after applying the migration). Safe to run again.
//
// Day-one data from the handoff (§Seed día uno): four projects, no historical tickets.
// - title and body belong to this seed until someone edits them with set_project (version > 1);
//   until then every run rewrites them, so fixing a body means editing here and rerunning.
// - v2 has no hand-written resume card. The handoff's must_keep_decision becomes a pinned project
//   decision, added once (a rerun finds it by text and leaves it alone).
// - rules_text and design docs are not in the handoff seed and are left untouched.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { withDb, type Db } from "../src/db/client.js";
import type { Actor } from "../src/db/schema.js";
import { writeTx } from "../src/mcp/tx.js";
import { pgStore, readerOf, uowOf } from "../src/store/pg.js";

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
    // A new project's id is chosen here, so the write that inserts it is already that project's.
    const id = (await readerOf(db).get("projects", { slug: s.slug }))?.id ?? randomUUID();
    // p is the row this run inserted or rewrote; undefined when the project's text is no longer the seed's.
    const p = await pgStore(db).write(id, {}, async (uow) => {
      const row = await uow.get("projects", { slug: s.slug });
      if (!row) return uow.insert("projects", { id, slug: s.slug, title: s.title, body: s.body, keyPrefix: s.prefix });
      // Once set_project edited the project (version > 1), its text belongs to the project, not the seed.
      // The version stays in the condition so the rewrite only lands on a row still at version 1.
      if (row.version !== 1) return undefined;
      const [rewritten] = await uow.update(
        "projects",
        { id: row.id, version: 1 },
        { title: s.title, body: s.body, keyPrefix: s.prefix, updatedAt: uow.now },
      );
      return rewritten;
    });
    const project = p ?? (await readerOf(db).get("projects", { slug: s.slug }))!;
    // 2.7: a row this run inserted (version 1, created just now) tells the feed the project exists.
    if (p && p.version === 1 && Date.now() - p.createdAt.getTime() < 60_000) {
      await writeTx(db, project, { actor: SEED_ACTOR, requestId: `project-created:${project.slug}`, tool: "seed" }, async (_tx, emit) => {
        await emit("project.created", null, { slug: project.slug, title: project.title, key_prefix: project.keyPrefix });
      });
    }
    const pinned = await writeTx(db, project, { actor: SEED_ACTOR }, async (tx, emit) => {
      const uow = uowOf(tx);
      const existing = await uow.get("decisions", { projectId: project.id, line: s.must_keep });
      if (existing || !s.must_keep) return false;
      const d = await uow.insert("decisions", { projectId: project.id, line: s.must_keep, pinned: true, actor: SEED_ACTOR });
      await emit("decision.added", null, { decision_id: d.id, text: d.line, pinned: true });
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
