// PLA-104: a wake for Taller that arrived while it was busy was coalesced and lost, so an idle Taller sat next to its
// own Ready tickets (MIA-38, MIA-40 in guided test 2). When a Taller run ends well it takes the next one it owns:
// «Hacer primero» first, never the ticket that just ran, never a blocked one. Throwaway DB, fake values only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const events = await import("../src/runner/events.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ME = { actor: { agent: "test", session_id: "pla104" } };

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  await seedOrg(made.db);
  await raw.query(`update runner_settings set company_paused = false`);
  await raw.query(`update projects set runs_paused = false`);
});
after(async () => {
  await closeDb?.();
  await raw?.end();
});

async function taller(): Promise<{ agent: never; slug: string }> {
  const rows = (
    await raw.query(
      `select * from agents where role_template = 'taller' and (project_id = (select id from projects where slug = 'micasa') or project_id is null) order by project_id nulls last`,
    )
  ).rows;
  const a = rows[0];
  assert.ok(a, "seed has a Taller");
  return { agent: { ...a, projectId: a.project_id, roleTemplate: a.role_template, capabilities: a.capabilities } as never, slug: a.slug };
}
const projectRef = async () => ({ id: (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id as string, slug: "micasa" });
const ticket = async (title: string, extra: Json = {}) =>
  ((await writes.createTask(db, { project: "micasa", title, scope: "s", checks: ["c"], status: "Ready", ...extra } as never, ME)) as Json).key as string;

test("PLA-104 #1: a Taller run that ends takes its next unblocked Ready ticket, «Hacer primero» first, never the one that ran", async () => {
  const { agent, slug } = await taller();
  const ran = await ticket("La que corrió", { owner_agent: slug });
  const older = await ticket("Más vieja", { owner_agent: slug });
  const first = await ticket("Hacer primero", { owner_agent: slug });
  await ticket("Bloqueada", { owner_agent: slug, blocked_by: [{ human_action: { text: "Jorge: algo" } }] });
  await ticket("[PRUEBA] no", { owner_agent: slug });
  await raw.query(`delete from agent_runs`);
  await raw.query(`update projects set settings = settings || jsonb_build_object('next_first', $1::text) where slug = 'micasa'`, [first]);
  const out = (await events.wakePoIfWaiting(db as never, agent, await projectRef(), ran)) as Json;
  assert.equal(out?.kind, "queued", JSON.stringify(out));
  assert.equal(out.taskKey, first);
  // Without «Hacer primero»: the oldest one that is not the ticket that ran.
  await raw.query(`delete from agent_runs`);
  await raw.query(`update projects set settings = settings - 'next_first' where slug = 'micasa'`);
  const again = (await events.wakePoIfWaiting(db as never, agent, await projectRef(), ran)) as Json;
  assert.equal(again?.taskKey, older, JSON.stringify(again));
});

test("PLA-104 #2: nothing is queued when Taller owns no unblocked Ready ticket besides the one that ran", async () => {
  const { agent } = await taller();
  const left = (await raw.query(`select key from tasks where kind = 'ticket' and status = 'Ready' and title = 'La que corrió'`)).rows[0].key as string;
  await raw.query(`update tasks set status = 'Done' where kind = 'ticket' and status = 'Ready' and title in ('Más vieja', 'Hacer primero')`);
  await raw.query(`delete from agent_runs`);
  const out = await events.wakePoIfWaiting(db as never, agent, await projectRef(), left);
  assert.equal(out, null);
});
