// PLA-I53-6 #1: the zone tag rules (src/api/zonas.ts). Pure, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ZONA_RULES, zonaOfArea, zonasOf, type ZonaRule } from "../src/api/zonas.js";

test("I53-6 #1: ui globs, .tsx and .css are Pantalla", () => {
  for (const a of ["ui/**", "ui/src/components/plan/stage-board.tsx", "./ui/src/index.css", "*.tsx", "src/**/*.tsx", "*.css", "ui"]) assert.equal(zonaOfArea(a), "pantalla", a);
  assert.deepEqual(zonasOf(["ui/**", "*.css"]), ["pantalla"]);
});

test("I53-6 #1: src/api, src/mcp, the runner and scripts are Servidor", () => {
  for (const a of ["src/api/**", "src/api/etapa.ts", "src/mcp/*", "src/runner/qa.ts", "scripts/seed-org.ts", "test/**", "package.json"]) assert.equal(zonaOfArea(a), "servidor", a);
  assert.deepEqual(zonasOf(["src/api/**"]), ["servidor"]);
});

test("I53-6 #1: drizzle, src/db and migrations are Datos (before src/** makes them Servidor)", () => {
  for (const a of ["drizzle/**", "drizzle/0051_brief.sql", "src/db/**", "src/db/schema.ts", "migrations/**", "src/migrations/x.ts", "*.sql"]) assert.equal(zonaOfArea(a), "datos", a);
  assert.deepEqual(zonasOf(["drizzle/**"]), ["datos"]);
});

test("I53-6 #1: docs, prompts and Markdown are Docs", () => {
  for (const a of ["docs/**", "prompts/taller.md", "README.md", "*.md"]) assert.equal(zonaOfArea(a), "docs", a);
});

test("I53-6 #1: a mixed ticket carries two tags, in a fixed order, without repeats", () => {
  assert.deepEqual(zonasOf(["src/api/routes.ts", "ui/src/pages/project.tsx"]), ["pantalla", "servidor"]);
  assert.deepEqual(zonasOf(["src/db/schema.ts", "src/api/**", "src/mcp/**"]), ["servidor", "datos"]);
  assert.deepEqual(zonasOf(["docs/x.md", "drizzle/**", "ui/**", "src/**"]), ["pantalla", "servidor", "datos", "docs"]);
});

test("I53-6 #1: no areas, no tags", () => {
  assert.deepEqual(zonasOf([]), []);
  assert.deepEqual(zonasOf(null), []);
  assert.deepEqual(zonasOf(undefined), []);
  assert.deepEqual(zonasOf(["", "  "]), []);
});

test("I53-6 #1: the table is data, a project can pass its own", () => {
  const mine: ZonaRule[] = [{ zona: "pantalla", prefix: ["app/views"] }, ...DEFAULT_ZONA_RULES];
  assert.equal(zonaOfArea("app/views/home.erb", mine), "pantalla");
  assert.equal(zonaOfArea("app/views/home.erb"), "servidor");
  assert.deepEqual(zonasOf(["lib/x.rb"], DEFAULT_ZONA_RULES, "docs"), ["docs"]);
});
