// PLA-I26-4: CEO and Equipo show the same working-on key.
// A live lease wins. Otherwise In progress, then Ready, for that owner.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");

let raw: pg.Client;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;
const cookie = `${SESSION_COOKIE}=${createSession()}`;
const ctx = { actor: { agent: "test-agent", session_id: "s-i26" } };

const get = async (path: string, headers: Record<string, string> = {}) => {
  const res = await app.request(path, { headers });
  const body = (await res.json()) as Record<string, any>;
  return { status: res.status, body };
};

const keyOn = (dashboard: Record<string, any>, team: Record<string, any>, slug: string) => {
  const ceo = dashboard.team.agents.find((agent: { slug: string }) => agent.slug === slug);
  const equipo = team.agents.find((agent: { slug: string }) => agent.slug === slug);
  return { ceo: ceo?.claim?.key ?? null, equipo: equipo?.working_on?.key ?? null };
};

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await writes.createTask(
    db,
    { project: "micasa", key: "MIC-READY", title: "Listo", scope: "pantalla", checks: ["c"], status: "Ready", owner_agent: "cursor" },
    ctx,
  );
  await writes.createTask(
    db,
    { project: "micasa", key: "MIC-NOW", title: "En curso", scope: "pantalla", checks: ["c"], status: "Ready", owner_agent: "cursor" },
    ctx,
  );
  await raw.query(`update tasks set status = 'In progress' where key = 'MIC-NOW'`);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("dashboard stays cookie-only and both screens share the owner key", async () => {
  const denied = await get("/api/dashboard", { Authorization: `Bearer ${TEST_BEARER}`, Cookie: cookie });
  assert.equal(denied.status, 401);
  const teamDenied = await get("/api/team", { Authorization: `Bearer ${TEST_BEARER}` });
  assert.equal(teamDenied.status, 401);

  const dash = await get("/api/dashboard", { Cookie: cookie });
  const team = await get("/api/team", { Cookie: cookie });
  assert.equal(dash.status, 200);
  assert.equal(team.status, 200);
  const owned = keyOn(dash.body, team.body, "cursor");
  assert.equal(owned.ceo, "MIC-NOW");
  assert.equal(owned.equipo, "MIC-NOW");
});

test("a live lease replaces the owned ticket on both screens", async () => {
  await writes.createTask(
    db,
    { project: "workia", key: "WRK-LEASE", title: "Turno", scope: "pantalla", checks: ["c"], owner_agent: "cursor" },
    ctx,
  );
  await raw.query(
    `update tasks set owner = $1::jsonb, claimed_at = now(), lease_until = now() + interval '1 hour', status = 'In progress' where key = 'WRK-LEASE'`,
    [JSON.stringify({ agent: "Cursor", session_id: "s-cursor" })],
  );
  const dash = await get("/api/dashboard", { Cookie: cookie });
  const team = await get("/api/team", { Cookie: cookie });
  const leased = keyOn(dash.body, team.body, "cursor");
  assert.equal(leased.ceo, "WRK-LEASE");
  assert.equal(leased.equipo, "WRK-LEASE");
  assert.equal(JSON.stringify(dash.body).includes("wake_url"), false);
  assert.equal(JSON.stringify(team.body).includes("wake_url"), false);
});
