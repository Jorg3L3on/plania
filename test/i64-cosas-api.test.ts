// PLA-I64-1: what the ficha read adds for the joined list. Throwaway database, fictional projects only.
//   promoted ideas carry promoted_to and come after the rest; an open idea not promoted carries the tube's stop and
//   state (any origin), its shelf and its open question; promoted[] maps every idea that became an initiative.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");

let raw: pg.Client;
let pid = "";
const task = async (key: string, kind: string, status: string, extra: { stage?: string; promoted?: string; origin?: string; at?: string } = {}) =>
  (
    await raw.query(
      `insert into tasks (project_id, key, title, kind, status, stage, promoted_to, origin, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now())) returning id`,
      [pid, key, `Título ${key}`, kind, status, extra.stage ?? null, extra.promoted ?? null, extra.origin ?? null, extra.at ?? null],
    )
  ).rows[0].id as string;

before(async () => {
  raw = await resetTestDb();
  await raw.query(`insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda Luna', 'TLU')`);
  pid = (await raw.query(`select id from projects where slug = 'tienda'`)).rows[0].id;
  await task("TLU-I1", "initiative", "Active");
  await task("TLU-I2", "initiative", "Done");
  // Promoted ideas are newer, yet listed after the ones still in the tube.
  await task("TLU-IDEA1", "idea", "Open", { stage: "ready", promoted: "TLU-I1", origin: "jorge", at: "2026-11-10T10:00:00Z" });
  await task("TLU-IDEA2", "idea", "Done", { stage: "ready", promoted: "TLU-I2", at: "2026-11-09T10:00:00Z" });
  const q = await task("TLU-IDEA3", "idea", "Open", { stage: "design", at: "2026-11-01T10:00:00Z" });
  await task("TLU-IDEA4", "idea", "Open", { stage: "ready", origin: "jorge", at: "2026-11-02T10:00:00Z" });
  await raw.query(`insert into questions (project_id, task_id, question, asked_by) values ($1, $2, '¿Azul o verde?', '{"agent":"po","session_id":"s"}'::jsonb)`, [pid, q]);
});
after(async () => {
  await raw?.end();
});

test("I64-1: the ficha carries promoted_to, origin, the tube's state and the promoted map", async () => {
  const res = await app.request("/api/company/projects/tienda/ficha", { headers: { Cookie: `${SESSION_COOKIE}=${createSession()}` } });
  assert.equal(res.status, 200);
  const f = (await res.json()) as any;
  assert.deepEqual(f.ideas.map((i: any) => i.key), ["TLU-IDEA4", "TLU-IDEA3", "TLU-IDEA1"], "not promoted first, newest first");
  const by = Object.fromEntries(f.ideas.map((i: any) => [i.key, i]));
  assert.equal(by["TLU-IDEA1"].promoted_to, "TLU-I1");
  assert.equal(by["TLU-IDEA1"].state, null, "a promoted idea has no tube state");
  assert.deepEqual([by["TLU-IDEA3"].stop, by["TLU-IDEA3"].state, by["TLU-IDEA3"].question?.text], ["diseno", "espera", "¿Azul o verde?"]);
  assert.deepEqual([by["TLU-IDEA4"].origin, by["TLU-IDEA4"].stop, by["TLU-IDEA4"].guardada], ["jorge", "lista", false]);
  assert.deepEqual(f.promoted, [
    { idea: "TLU-IDEA1", initiative: "TLU-I1" },
    { idea: "TLU-IDEA2", initiative: "TLU-I2" },
  ]);
});

test("I64-3 #2 el pulso: steps landed per day for 14 days match a control count", async () => {
  const at = (d: string) => `${d}T18:00:00Z`;
  const t = async (key: string, status: string, when: string | null, kind = "ticket") =>
    raw.query(`insert into tasks (project_id, key, title, kind, status, resolved_at, status_changed_at) values ($1, $2, $2, $3, $4, $5, $5)`, [pid, key, kind, status, when]);
  await t("TLU-1", "Done", at("2026-11-17"));
  await t("TLU-2", "Released", at("2026-11-17"));
  await t("TLU-3", "Merged", at("2026-11-10"));
  await t("TLU-4", "Done", at("2026-11-01")); // before the window
  await t("TLU-5", "In review", at("2026-11-16")); // not landed
  await t("TLU-I9", "Done", at("2026-11-17"), "initiative"); // not a step
  const { pulsoRead } = await import("../src/api/company-ficha.js");
  const { withDb } = await import("../src/db/client.js");
  const p = await withDb((db) => pulsoRead(db, "tienda", { now: new Date("2026-11-17T20:00:00Z"), tz: "America/Mexico_City" }));
  assert.equal(p.days.length, 14);
  assert.equal(p.days[0]!.day, "2026-11-04");
  assert.equal(p.days.at(-1)!.day, "2026-11-17");
  const control = (await raw.query(
    `select count(*)::int as n from tasks where project_id = $1 and kind = 'ticket' and status in ('Merged','Released','Done') and (coalesce(resolved_at, status_changed_at) at time zone 'America/Mexico_City')::date between '2026-11-04' and '2026-11-17'`,
    [pid],
  )).rows[0].n;
  assert.equal(p.total, control);
  assert.equal(p.total, 3);
  assert.deepEqual(p.days.filter((d) => d.n > 0), [{ day: "2026-11-10", n: 1 }, { day: "2026-11-17", n: 2 }]);
  const res = await app.request("/api/company/projects/tienda/pulso", { headers: { Cookie: `${SESSION_COOKIE}=${createSession()}` } });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).days.length, 14);
});
