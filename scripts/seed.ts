// Usage: pnpm seed  (after applying the migration)
// Slice 1: inserts the four project rows with empty bodies. Idempotent.
// Slice 6 fills bodies, rules and resume cards.
import { withDb } from "../src/db/client.js";
import { projects } from "../src/db/schema.js";

const PROJECTS = [
  { slug: "micasa", title: "MiCasa" },
  { slug: "workia", title: "Workia" },
  { slug: "filmia", title: "Filmia" },
  { slug: "zigzag", title: "Zigzag" },
];

await withDb(async (db) => {
  const inserted = await db
    .insert(projects)
    .values(PROJECTS)
    .onConflictDoNothing({ target: projects.slug })
    .returning({ slug: projects.slug });
  const all = await db.select({ slug: projects.slug }).from(projects).orderBy(projects.slug);
  console.log(`inserted: ${inserted.map((p) => p.slug).join(", ") || "none"}`);
  console.log(`projects: ${all.map((p) => p.slug).join(", ")}`);
});
