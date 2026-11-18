// NEWPROJ-1: one creation function behind every door. The screen's sheet (POST /api/company/projects),
// the MCP tool create_company_project and `pnpm project:add` (registerProject) leave the same project:
// paused, plan approval on, a checked key prefix, the four core roles on the runner config, the same
// events. Throwaway DB.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { registerProject } = await import("../scripts/register-project.js");
const { RUNNER_CONFIG } = await import("../src/runner/team.js");

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let client: Client;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const micasa = (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id;
  await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, 'Prompt: Product owner', '# PO', $2)`, [
    micasa,
    JSON.stringify({ agent: "test", session_id: "s" }),
  ]);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "newproj-1", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

// What a project looks like, with its slug written as <p> so the three can be compared.
async function shape(slug: string) {
  const p = (await raw.query(`select id, key_prefix, runs_paused, settings from projects where slug = $1`, [slug])).rows[0];
  assert.ok(p, slug);
  const team = (
    await raw.query(
      `select a.slug, a.role, a.role_template, a.kind, a.adapter, a.adapter_config, a.capabilities, a.heartbeat_minutes, b.slug as boss
       from agents a left join agents b on b.id = a.reports_to where a.project_id = $1 order by a.slug`,
      [p.id],
    )
  ).rows.map((r) => ({
    ...r,
    slug: r.slug.replace(slug, "<p>"),
    boss: r.boss?.replace(slug, "<p>") ?? null,
    capabilities: r.capabilities.map((c: string) => c.replace(slug, "<p>")),
  }));
  const events = (await raw.query(`select type, payload from events where project_id = $1 order by id`, [p.id])).rows;
  const created = events.find((e) => e.type === "project.created")!;
  return {
    key_prefix: p.key_prefix,
    paused: p.runs_paused,
    plan_approval: p.settings.plan_approval,
    team,
    created: { ...created.payload, slug: "<p>", title: "<t>", key_prefix: "<k>" },
    // goal.set comes only with a goal (the sheet asks for one); doc.put is the MCP tool's Playbook.
    events: events.map((e) => e.type).filter((t) => t !== "goal.set" && t !== "doc.put"),
  };
}

test("NEWPROJ-1: the sheet, the MCP tool and the script leave the same project", async () => {
  const sheet = await app.request("/api/company/projects", { method: "POST", headers: jorge(), body: JSON.stringify({ name: "Alfa", goal: "Una meta." }) });
  assert.equal(sheet.status, 201);

  const r = (await client.callTool({
    name: "create_company_project",
    arguments: { actor: { agent: "test", session_id: "s" }, slug: "bravo", name: "Bravo", owner_bot_name: "PO Bravo" },
  })) as { isError?: boolean; content: { text: string }[] };
  assert.equal(r.isError, undefined, r.content[0]!.text);

  assert.deepEqual(await registerProject(db, { slug: "charlie", title: "Charlie", repo: "o/charlie", path: "/tmp/charlie" }), { created: true, slug: "charlie" });

  const [a, b, c] = [await shape("alfa"), await shape("bravo"), await shape("charlie")];
  assert.deepEqual([a.key_prefix, b.key_prefix, c.key_prefix], ["ALF", "BRA", "CHA"]);
  for (const s of [a, b, c]) {
    assert.equal(s.paused, true);
    assert.equal(s.plan_approval, true);
    assert.deepEqual(s.events, ["project.created", "project.updated"]);
    assert.deepEqual(s.created, { slug: "<p>", title: "<t>", key_prefix: "<k>", template: "company", paused: true });
  }
  assert.deepEqual(b.team, a.team);
  assert.deepEqual(c.team, a.team);
  assert.deepEqual(
    a.team.map((m: { slug: string; boss: string | null }) => [m.slug, m.boss]),
    [["artist-<p>", "po-<p>"], ["po-<p>", "ceo"], ["research-<p>", "po-<p>"], ["taller-<p>", "po-<p>"]],
  );
  // The PO runs on the same adapter config as its teammates.
  for (const m of a.team) assert.deepEqual(m.adapter_config, RUNNER_CONFIG.adapterConfig, m.slug);

  // The script still keeps the repo fields; the sheet's goal is its project's only goal.
  const charlie = (await raw.query(`select settings from projects where slug = 'charlie'`)).rows[0].settings;
  assert.deepEqual(charlie, { plan_approval: true, github: { repo: "o/charlie" }, local: { repo_path: "/tmp/charlie" } });
  const goals = (await raw.query(`select p.slug, g.title from goals g join projects p on p.id = g.project_id where p.slug in ('alfa','bravo','charlie')`)).rows;
  assert.deepEqual(goals, [{ slug: "alfa", title: "Una meta." }]);
});

test("NEWPROJ-1: both repeatable doors stay safe to call twice; an explicit taken prefix is refused", async () => {
  const count = async () => (await raw.query(`select (select count(*) from projects)::int as p, (select count(*) from agents)::int as a, (select count(*) from events)::int as e`)).rows[0];
  const before = await count();
  const again = (await client.callTool({
    name: "create_company_project",
    arguments: { actor: { agent: "test", session_id: "s" }, slug: "bravo", name: "Otro", owner_bot_name: "Otro" },
  })) as { content: { text: string }[] };
  assert.equal(JSON.parse(again.content[0]!.text).created, false);
  assert.deepEqual(await registerProject(db, { slug: "charlie", title: "Charlie" }), { created: false, slug: "charlie" });
  assert.deepEqual(await count(), before);

  await assert.rejects(registerProject(db, { slug: "delta", title: "Delta", prefix: "ALF" }), /KEY_PREFIX_TAKEN/);
  assert.equal((await raw.query(`select count(*)::int as n from projects where slug = 'delta'`)).rows[0].n, 0);
});
