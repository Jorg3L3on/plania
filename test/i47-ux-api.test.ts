// PLA-I47-7: a delivery held for QA's pass is not the owner's turn. The floor's light read the delivery message before
// the decisions were read, said «Una entrega espera tu visto bueno.» and drew «Ver en Te toca», a link to an anchor
// that no longer exists. Throwaway database, fake names only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_HOME_PROJECT = "zigzag";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { resolveThread } = await import("../src/runner/threads.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let pid = "";
const company = async () => (await (await app.request("/api/company", { headers: { Cookie: `${SESSION_COOKIE}=${createSession()}` } })).json()) as Json;
const card = async () => (await company()).projects.find((p: Json) => p.slug === "micasa") as Json;

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  pid = (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id;
  await raw.query(`insert into agents (slug, name, role, kind, adapter, project_id, role_template) values ('taller-mc-ux', 'Taller', 'engineer', 'coder', 'claude_code', $1, 'taller'), ('qa-mc-ux', 'QA', 'qa', 'coder', 'claude_code', $1, 'qa')`, [pid]);
  const t = (await writes.createTask(db, { project: "micasa", title: "Pantalla de gracias", scope: "s", checks: ["c"], work_type: "code" } as never, { actor: { agent: "po-micasa", session_id: "s-ux" } } as never)) as { key: string };
  const url = "https://github.com/example/micasa/pull/77";
  await raw.query(`update tasks set status = 'In review', pr_url = $2 where key = $1`, [t.key, url]);
  await raw.query(`insert into pull_requests (project_id, repo, number, url, title, task_id, state, ci_state) select $1, 'example/micasa', 77, $2, 'Gracias', id, 'open', 'success' from tasks where key = $3`, [pid, url, t.key]);
  const { thread } = await resolveThread(db, "micasa");
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, 'taller-mc-ux', 'taller', $2, $3)`, [
    thread.id,
    `Listo ${t.key}: PR #77`,
    JSON.stringify([{ kind: "ticket", ref: t.key, title: "Pantalla de gracias" }, { kind: "pr", ref: url, title: "PR #77" }]),
  ]);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("I47-7: a delivery still waiting for QA is not Te toca: no needs_jorge light and no dead «Ver en Te toca» move", async () => {
  const c = await company();
  assert.equal(c.decisions.filter((d: Json) => d.project === "micasa").length, 0, "QA holds it off Te toca");
  const p = c.projects.find((x: Json) => x.slug === "micasa");
  assert.notEqual(p.light, "needs_jorge");
  assert.equal(p.next_move?.accion?.href, undefined, "no link move to #te-toca");
});

test("I47-7: once QA passes, the same delivery is the owner's move again", async () => {
  const t = (await raw.query(`select id, key from tasks where title = 'Pantalla de gracias'`)).rows[0];
  await raw.query(`insert into qa_lanes (project_id, task_id, task_key, status, verify, review) values ($1, $2, $3, 'pass', $4::jsonb, $5::jsonb)`, [
    pid, t.id, t.key,
    JSON.stringify([{ name: "test", command: "pnpm test", exit_code: 0, ok: true, pass: 3, fail: 0, tail: "" }]),
    JSON.stringify({ verdict: "pass", notes: "Sin hallazgos", model: null }),
  ]);
  const c = await company();
  const p = c.projects.find((x: Json) => x.slug === "micasa");
  assert.equal(p.light, "needs_jorge", JSON.stringify({ light: p.light, reason: p.light_reason, d: c.decisions.map((d: Json) => [d.project, d.kind, d.hold]) }));
  assert.equal(p.next_move.origen.kind, "decision", "the move is the delivery itself, not the light's link");
});
