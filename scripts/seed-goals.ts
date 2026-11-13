// Usage: pnpm tsx --env-file=.env scripts/seed-goals.ts
//
// PLA-I27: one company goal and one project goal per product slug.
// The stable key is the title on that project (or the company title, with no project).
// A second run finds those rows and inserts nothing. Projects that are not registered are skipped.
import { pathToFileURL } from "node:url";
import { withDb, type Db } from "../src/db/client.js";
import { setGoal } from "../src/mcp/goals.js";
import { webCtx } from "../src/mcp/tx.js";
import { readerOf } from "../src/store/pg.js";

export const GOAL_SLUGS = ["micasa", "filmia", "workia", "zigzag", "plania", "mianovia"] as const;

export const COMPANY_TITLE = "Avance de la compañía";
export const COMPANY_WHY = "Una dirección común para los productos.";
export const PROJECT_WHY = "El producto avanza con un rumbo claro.";

export const projectGoalTitle = (slug: string) => `Avance del producto (${slug})`;

export type SeedGoalsResult = {
  created: string[];
  kept: string[];
  missing: string[];
};

// Every goal, company and project alike: the check at the end compares the whole table before and after.
const goalCount = (db: Db): Promise<number> => readerOf(db).count("goals");

export async function seedGoals(db: Db): Promise<SeedGoalsResult> {
  const created: string[] = [];
  const kept: string[] = [];
  const missing: string[] = [];
  const r = readerOf(db);
  const before = await goalCount(db);

  const company = await r.get("goals", { projectId: null, title: COMPANY_TITLE });
  let companyId = company?.id;
  if (companyId) {
    kept.push("company");
  } else {
    const view = await setGoal(db, { title: COMPANY_TITLE, why: COMPANY_WHY, status: "active" }, webCtx);
    companyId = view.id;
    created.push("company");
  }

  for (const slug of GOAL_SLUGS) {
    const project = await r.get("projects", { slug });
    if (!project) {
      missing.push(slug);
      continue;
    }
    const title = projectGoalTitle(slug);
    const existing = await r.get("goals", { projectId: project.id, title });
    if (existing) {
      kept.push(slug);
      continue;
    }
    await setGoal(db, { project: slug, parent_id: companyId, title, why: PROJECT_WHY, status: "active" }, webCtx);
    created.push(slug);
  }

  const after = await goalCount(db);
  if (after - before !== created.length) {
    throw new Error(`seed-goals inserted ${after - before} rows but recorded ${created.length}`);
  }
  return { created, kept, missing };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await withDb(async (db) => {
    const { created, kept, missing } = await seedGoals(db);
    console.log(created.length ? `created ${created.join(", ")}` : "goals already present");
    if (kept.length) console.log(`kept ${kept.join(", ")}`);
    if (missing.length) console.log(`missing projects ${missing.join(", ")}`);
  });
}
