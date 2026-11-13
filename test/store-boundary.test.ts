// SQL stays inside the store. Outside src/store/ and src/db/, no .ts file under src/ or scripts/ may import
// drizzle-orm (a type-only import aside), pg, or a table of src/db/schema.ts. Files whose move onto the store port
// has not landed yet are listed in ALLOWED; the test fails when a file off the list offends and when a listed
// file no longer does, so the list can only shrink.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema.js";

// One entry per file that still offends, with what is left. Delete the entry in the change that converts the file.
const ALLOWED: Record<string, string> = {
  "src/jobs/audit.ts": "reads the projects table with the query builder",
  "src/jobs/backup.ts": "the server version and the machine_state upsert in SQL (the pg_dump job)",
  "src/jobs/machine/collect.ts": "a pg client that lists the machine's Postgres databases (inventory, not plania's data)",
};

const ROOT = path.resolve(import.meta.dirname, "..");
const SCANNED = ["src", "scripts"];
const EXEMPT = ["src/store/", "src/db/"];
const SCHEMA = path.join(ROOT, "src", "db", "schema");

// The schema's exports that are tables. Row types and plain constants (statuses, kinds) are not.
const TABLES = new Set(Object.entries(schema).filter(([, value]) => is(value, PgTable)).map(([name]) => name));

type Import = {
  line: number;
  from: string;
  // How the module is taken: named specifiers, the whole namespace (import * / export *), only for its side
  // effects, or with import() at run time.
  form: "named" | "namespace" | "side-effect" | "dynamic";
  typeOnly: boolean; // `import type ...` or `export type ...`
  defaultName?: string;
  names: { name: string; type: boolean }[];
};

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

// The import and export-from statements of a source file. A regular expression is enough for this code base:
// statements start a line, and a clause is a default name, braces or a namespace.
function importsOf(text: string): Import[] {
  const out: Import[] = [];
  const statement = /^[ \t]*(import|export)\s+(type\s+)?(?:([\w$]+)\s*,?\s*)?(\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)?\s*from\s*["']([^"']+)["']/gm;
  for (const m of text.matchAll(statement)) {
    const [, keyword, type, defaultName, clause, from] = m;
    if (!defaultName && !clause) continue;
    // `export x from` is not a statement; a lone word before from only counts after import.
    if (keyword === "export" && defaultName) continue;
    const names = clause?.startsWith("{")
      ? clause
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const marked = /^type\s+/.test(s);
            return { name: s.replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim(), type: marked };
          })
      : [];
    out.push({
      line: lineAt(text, m.index),
      from: from!,
      form: clause?.startsWith("*") ? "namespace" : "named",
      typeOnly: !!type,
      ...(defaultName ? { defaultName } : {}),
      names,
    });
  }
  for (const m of text.matchAll(/^[ \t]*import\s*["']([^"']+)["']/gm)) {
    out.push({ line: lineAt(text, m.index), from: m[1]!, form: "side-effect", typeOnly: false, names: [] });
  }
  // import("x") at run time; `typeof import("x")` is a type and a commented line is not code.
  for (const m of text.matchAll(/(?<!typeof\s+)\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    const start = text.lastIndexOf("\n", m.index) + 1;
    if (/^\s*(\/\/|\*|\/\*)/.test(text.slice(start, m.index))) continue;
    out.push({ line: lineAt(text, m.index), from: m[1]!, form: "dynamic", typeOnly: false, names: [] });
  }
  return out.sort((a, b) => a.line - b.line);
}

const isDrizzle = (from: string) => from === "drizzle-orm" || from.startsWith("drizzle-orm/");
const isPg = (from: string) => from === "pg" || from.startsWith("pg/");

// A type-only import: `import type ...`, or braces whose every name is marked type.
const typeOnly = (i: Import) => i.typeOnly || (i.form === "named" && !i.defaultName && i.names.length > 0 && i.names.every((n) => n.type));

// What in one file keeps SQL outside the store, as "line N: ..." lines. file is the absolute path of the source.
function offensesOf(file: string, text: string, tables: ReadonlySet<string> = TABLES): string[] {
  const out: string[] = [];
  for (const i of importsOf(text)) {
    const at = `line ${i.line}`;
    if (isPg(i.from)) {
      out.push(`${at}: imports ${i.from}`);
    } else if (isDrizzle(i.from)) {
      if (!typeOnly(i)) out.push(`${at}: imports values from ${i.from}`);
    } else if (i.from.startsWith(".") && path.resolve(path.dirname(file), i.from).replace(/\.(js|ts|mjs|mts)$/, "") === SCHEMA) {
      if (i.typeOnly || i.form === "side-effect") continue;
      if (i.form === "dynamic" || i.form === "namespace" || i.defaultName) {
        out.push(`${at}: imports the whole schema (${i.form === "dynamic" ? "import()" : "every table"})`);
        continue;
      }
      const used = i.names.filter((n) => !n.type && tables.has(n.name)).map((n) => n.name);
      if (used.length) out.push(`${at}: imports schema tables ${used.join(", ")}`);
    }
  }
  return out;
}

function sourcesUnder(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => path.relative(ROOT, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();
}

// Every offending file outside the store, relative to the repo root with forward slashes.
function scan(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const rel of SCANNED.flatMap(sourcesUnder)) {
    if (EXEMPT.some((dir) => rel.startsWith(dir))) continue;
    const abs = path.join(ROOT, rel);
    const offenses = offensesOf(abs, readFileSync(abs, "utf8"));
    if (offenses.length) found.set(rel, offenses);
  }
  return found;
}

describe("SQL stays inside the store", () => {
  const found = scan();

  test("no file off the list imports drizzle-orm values, pg or a schema table", () => {
    const unlisted = [...found].filter(([file]) => !(file in ALLOWED)).flatMap(([file, offenses]) => offenses.map((o) => `${file} ${o}`));
    assert.deepEqual(unlisted, [], `outside src/store and src/db, go through the store port (src/store/types.ts):\n${unlisted.join("\n")}`);
  });

  test("every listed file still offends, so the list only shrinks", () => {
    const clean = Object.keys(ALLOWED).filter((file) => !found.has(file));
    assert.deepEqual(clean, [], `no SQL left in these files: remove them from ALLOWED in test/store-boundary.test.ts:\n${clean.join("\n")}`);
  });

  test("the devva adapter does not depend on SQL", () => {
    const file = path.join(ROOT, "src", "store", "devva.ts");
    const imports = importsOf(readFileSync(file, "utf8"));
    assert.ok(imports.some((i) => i.from === "./types.js"), "the scanner reads devva.ts's imports");
    const sql = imports.filter((i) => isPg(i.from) || (isDrizzle(i.from) && !typeOnly(i))).map((i) => `line ${i.line}: ${i.from}`);
    assert.deepEqual(sql, []);
  });

  test("the schema's tables are told apart from its types and constants", () => {
    assert.ok(TABLES.has("projects") && TABLES.has("tasks") && TABLES.has("agents"));
    assert.equal(TABLES.has("TICKET_STATUSES"), false);
    assert.equal(TABLES.has("Project"), false);
  });
});

describe("the import scanner", () => {
  const file = path.join(ROOT, "src", "mcp", "example.ts");
  const offenses = (text: string) => offensesOf(file, text, new Set(["projects", "tasks"]));

  test("type-only imports of drizzle-orm pass, value imports fail", () => {
    assert.deepEqual(offenses(`import type { SQL } from "drizzle-orm";\nimport { type PgTable, type PgColumn } from "drizzle-orm/pg-core";`), []);
    assert.deepEqual(offenses(`// note\nimport { sql, type SQL } from "drizzle-orm";`), ["line 2: imports values from drizzle-orm"]);
    assert.deepEqual(offenses(`import {\n  and,\n  eq,\n} from "drizzle-orm";`), ["line 1: imports values from drizzle-orm"]);
    assert.deepEqual(offenses(`import { drizzle } from "drizzle-orm/node-postgres";`), ["line 1: imports values from drizzle-orm/node-postgres"]);
    assert.deepEqual(offenses(`export { sql } from "drizzle-orm";`), ["line 1: imports values from drizzle-orm"]);
    assert.deepEqual(offenses(`const { sql } = await import("drizzle-orm");`), ["line 1: imports values from drizzle-orm"]);
    assert.deepEqual(offenses(`type Q = typeof import("drizzle-orm");`), []);
  });

  test("any import of pg fails", () => {
    assert.deepEqual(offenses(`import pg from "pg";`), ["line 1: imports pg"]);
    assert.deepEqual(offenses(`import type { PoolClient } from "pg";`), ["line 1: imports pg"]);
  });

  test("schema tables fail; row types, constants and type-only imports pass", () => {
    assert.deepEqual(offenses(`import { TICKET_STATUSES, type Task, Project } from "../db/schema.js";`), []);
    assert.deepEqual(offenses(`import type * as schema from "../db/schema.js";`), []);
    assert.deepEqual(offenses(`import { projects as p, type tasks, KINDS } from "../db/schema.js";`), ["line 1: imports schema tables projects"]);
    assert.deepEqual(offenses(`import * as schema from "../db/schema.js";`), ["line 1: imports the whole schema (every table)"]);
    assert.deepEqual(offenses(`export * from "../db/schema.js";`), ["line 1: imports the whole schema (every table)"]);
    // The same module reached from scripts/.
    assert.deepEqual(offensesOf(path.join(ROOT, "scripts", "x.ts"), `import { tasks } from "../src/db/schema.js";`, new Set(["tasks"])), [
      "line 1: imports schema tables tasks",
    ]);
    // Another module named schema is not the schema.
    assert.deepEqual(offenses(`import { tasks } from "./schema.js";`), []);
  });
});
