// PLA-109 (guided test PLA-86, F-27): a PO that turns one of Jorge's «Hacerlo ya» requests into a Taller ticket closes
// the request Done, naming the ticket, instead of sending Jorge an «Aceptar» with nothing behind it. A request the PO
// finishes without handing it on still goes to In review. Throwaway DB, fake values only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const surface = await import("../src/mcp/agent-surface.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  await seedOrg(made.db);
  // No runs start here: the PO's moves are made by hand below.
});
after(async () => {
  await closeDb?.();
  await raw?.end();
});

// A «Hacerlo ya» request as Pedir leaves it: a Ready ops ticket, origin jorge (made here so no run starts).
async function request(text: string): Promise<string> {
  const t = (await writes.createTask(db, { project: "micasa", title: text, scope: text, checks: ["El PO lo hizo o lo pasó a Taller"], status: "Ready", work_type: "ops" } as never, { actor: { agent: "test", session_id: "pla109" } })) as Json;
  await raw.query(`update tasks set origin = 'owner' where key = $1`, [t.key]);
  return t.key as string;
}
const po = (session: string) => ({ actor: { agent: "plania-runner", session_id: session } });
const checksOf = async (key: string) => (await raw.query(`select c.n from checks c join tasks t on t.id = c.task_id where t.key = $1 order by c.n`, [key])).rows.map((r) => r.n as number);
const ownerSlug = async (role: string) =>
  (await raw.query(`select slug from agents where role_template = $1 and (project_id = (select id from projects where slug = 'micasa') or project_id is null) order by project_id nulls last limit 1`, [role])).rows[0].slug as string;

test("PLA-109 #1: the PO hands a request to Taller: the request closes Done and names the ticket", async () => {
  const key = await request("Quita el saludo cuando la novia ya envió el formulario");
  const poSlug = await ownerSlug("product-owner");
  await raw.query(`update tasks set owner_agent = (select id from agents where slug = $2) where key = $1`, [key, poSlug]);
  const session = "run-1091aaaa1091aaaa";
  await writes.claim(db, { project: "micasa", key, action: "acquire" } as never, po(session));
  const made = (await writes.createTask(db, { project: "micasa", title: "Registro: quitar el saludo tras enviar", scope: "s", checks: ["c"], status: "Ready", owner_agent: await ownerSlug("taller") } as never, po(session))) as Json;
  const out = (await surface.finish(
    db,
    { project: "micasa", key, no_pr_reason: "Trabajo de PO: ticket Listo para Taller", result: { kind: "verify", verdict: "pass", cite: "alcance escrito; ticket para Taller", check_ns: await checksOf(key) } } as never,
    po(session) as never,
  )) as Json;
  assert.equal(out.status, "Done");
  assert.deepEqual(out.handed_to, [made.key]);
  const note = (await raw.query(`select payload->>'text' as text from events where type = 'note' and task_key = $1 order by id desc limit 1`, [key])).rows[0].text as string;
  assert.match(note, new RegExp(`Pasó a Taller: ${made.key}`));
});

test("PLA-109 #2: a request the PO finishes itself, with no ticket for Taller, still goes to Jorge In review", async () => {
  const key = await request("Escribe el texto del aviso de privacidad");
  await raw.query(`update tasks set owner_agent = (select id from agents where slug = $2) where key = $1`, [key, await ownerSlug("product-owner")]);
  const session = "run-1092bbbb1092bbbb";
  await writes.claim(db, { project: "micasa", key, action: "acquire" } as never, po(session));
  const out = (await surface.finish(
    db,
    { project: "micasa", key, no_pr_reason: "Un documento", result: { kind: "verify", verdict: "pass", cite: "doc escrito", check_ns: await checksOf(key) } } as never,
    po(session) as never,
  )) as Json;
  assert.equal(out.status, "In review");
  assert.equal(out.handed_to, undefined);
});
