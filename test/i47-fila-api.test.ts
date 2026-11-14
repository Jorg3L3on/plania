// PLA-I47-3: what La fila needs from GET /api/company. Throwaway database, fake names only.
//   a Backlog step of the leg in course is postponed; a held Ready step says which step holds it (waits);
//   the project carries next_first, the ticket the owner put first.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const SYS = { actor: { agent: "test", session_id: "s-test" } };
const make = (input: Json) => writes.createTask(db, { project: "micasa", scope: "s", ...input } as never, SYS as never);

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await make({ kind: "initiative", key: "MIC-I1", title: "Registro" });
  await make({ key: "MIC-I1-1", parent_key: "MIC-I1", phase: 1, title: "Formulario", checks: ["c"], status: "Ready" });
  await make({ key: "MIC-I1-2", parent_key: "MIC-I1", phase: 2, title: "Validación", checks: ["c"], status: "Ready", blocked_by: ["MIC-I1-1"] });
  await make({ key: "MIC-I1-3", parent_key: "MIC-I1", phase: 3, title: "Hosting propio", checks: ["c"], status: "Backlog" });
  await raw.query(`update tasks set status = 'Active' where key = 'MIC-I1'`);
  await raw.query(`update projects set settings = settings || '{"next_first": "MIC-I1-1"}'::jsonb where slug = 'micasa'`);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("I47-3: route steps carry postponed and waits only when they say something; the project carries next_first", async () => {
  const res = await app.request("/api/company", { headers: { Cookie: `${SESSION_COOKIE}=${createSession()}` } });
  assert.equal(res.status, 200);
  const p = ((await res.json()) as Json).projects.find((x: Json) => x.slug === "micasa");
  const steps = p.route.legs.find((l: Json) => l.state === "here").steps as Json[];
  const by = Object.fromEntries(steps.map((s) => [s.key, s]));
  assert.equal(by["MIC-I1-1"].state, "next");
  assert.equal("waits" in by["MIC-I1-1"] || "postponed" in by["MIC-I1-1"], false, "a free step has neither");
  assert.deepEqual([by["MIC-I1-2"].state, by["MIC-I1-2"].waits], ["later", "Formulario"]);
  assert.deepEqual([by["MIC-I1-3"].state, by["MIC-I1-3"].postponed], ["later", true]);
  assert.equal(p.next_first, "MIC-I1-1");
});
