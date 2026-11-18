// PLA-75: a delivery copy runs on <db>_entrega, a copy of the app's local database migrated to the branch.
import assert from "node:assert/strict";
import { test } from "node:test";
const { envValue, entregaUrl } = await import("../src/captures/prueba.js");
const { captureSettingsSchema } = await import("../src/captures/settings.js");

test("PLA-75 #1: the URL comes from the app's env file, quotes and export allowed", () => {
  const text = "# app\nOTHER=1\nexport DATABASE_URL=\"postgres://u@localhost:5433/mianovia_dev\"\n";
  assert.equal(envValue(text, "DATABASE_URL"), "postgres://u@localhost:5433/mianovia_dev");
  assert.equal(envValue("DATABASE_URL=\n", "DATABASE_URL"), null);
  assert.equal(envValue("X=1", "DATABASE_URL"), null);
});

test("PLA-75 #2: the delivery database is <name>_entrega on the same local server; remote or odd URLs are refused", () => {
  assert.deepEqual(entregaUrl("postgres://u:p@localhost:5433/mianovia_dev"), { url: "postgres://u:p@localhost:5433/mianovia_dev_entrega", name: "mianovia_dev_entrega" });
  assert.equal(entregaUrl("postgres://u@db.example.com/app"), null, "never a remote database");
  assert.equal(entregaUrl("postgres://localhost/app;drop"), null);
  assert.equal(entregaUrl("mysql://localhost/app"), null);
  assert.equal(entregaUrl("not a url"), null);
  // PLA-77: the sandbox copy's own database.
  assert.deepEqual(entregaUrl("postgres://localhost:5433/mianovia_dev", "_prueba"), { url: "postgres://localhost:5433/mianovia_dev_prueba", name: "mianovia_dev_prueba" });
});

test("PLA-75 #3: settings.capture.database is optional, env_var defaults to DATABASE_URL", () => {
  const base = { start_command: "npm run dev -- -p {port}", port: 3001, pages: [{ key: "home", path: "/", label: "Inicio" }] };
  assert.equal(captureSettingsSchema.parse(base).database, undefined);
  const s = captureSettingsSchema.parse({ ...base, database: { migrate_command: "npm run db:migrate" } });
  assert.deepEqual(s.database, { env_var: "DATABASE_URL", migrate_command: "npm run db:migrate" });
  assert.throws(() => captureSettingsSchema.parse({ ...base, database: { env_var: "bad var", migrate_command: "x" } }));
});
