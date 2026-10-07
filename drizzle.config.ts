import { defineConfig } from "drizzle-kit";

// Only generates SQL. Jorge applies migrations by hand (handoff §Tecnología).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
});
