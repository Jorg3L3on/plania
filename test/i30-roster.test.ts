// PLA-I30-1: 0040 maps cursor_agent to none and drops it from both adapter checks; the seed then cuts
// the old 15-row roster to the real roles. Proved on a private throwaway database, never a real one:
// the old roster is rebuilt with fake rows, then 0040 and seedOrg run the way Jorge's deploy runs them.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema.js";
import { ORG, seedOrg } from "../scripts/seed-org.js";

const dir = path.resolve(import.meta.dirname, "../drizzle/migrations");

test("the journal has 0040_roster_no_cursor at idx 37 and the file exists", () => {
  const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  const entry = journal.entries.find((e) => e.tag === "0040_roster_no_cursor")!;
  assert.equal(entry.idx, 37);
  assert.equal(readdirSync(dir).filter((f) => f.startsWith("0040")).join(","), "0040_roster_no_cursor.sql");
});

test("no seed row uses the Cursor adapter and every bot runs claude_code with no cadence", () => {
  assert.equal(ORG.some((r) => (r.adapter as string) === "cursor_agent"), false);
  for (const r of ORG.filter((r) => r.kind !== "human")) {
    assert.equal(r.adapter, "claude_code", r.slug);
    assert.equal(r.heartbeatMinutes, null, r.slug);
  }
});

// The roster as it is on the Mac before the deploy (fake values, same shape).
const OLD_ROSTER: [slug: string, name: string, role: string, title: string, kind: string, parent: string | null, adapter: string, caps: string][] = [
  ["ceo", "CEO", "human", "CEO", "human", null, "none", "{}"],
  ["asistente", "Asistente", "chief-of-staff", "Chief of Staff", "bot", "ceo", "http", "{staff}"],
  ["plania", "Plania", "coo", "COO", "bot", "ceo", "http", "{coo}"],
  ["taller", "Taller", "cto", "CTO", "bot", "ceo", "http", "{engineering}"],
  ["cursor", "Cursor", "engineer", "Engineer", "coder", "taller", "cursor_agent", "{cursor}"],
  ["claude-code", "Claude Code", "engineer", "Engineer", "coder", "taller", "claude_code", "{claude-code}"],
  ["artist", "Artist", "shared", "Shared service", "bot", "asistente", "http", "{design}"],
  ["research", "Research", "shared", "Shared service", "bot", "asistente", "http", "{research}"],
  ["coach", "Coach", "shared", "Shared service", "bot", "asistente", "http", "{coaching}"],
  ["housi", "Housi", "product-owner", "Product owner", "bot", "plania", "http", "{micasa}"],
  ["workia", "Workia", "product-owner", "Product owner", "bot", "plania", "http", "{workia}"],
  ["filmia", "Filmia", "product-owner", "Product owner", "bot", "plania", "http", "{filmia}"],
  ["zigzag", "ZigZag", "product-owner", "Product owner", "bot", "plania", "http", "{zigzag}"],
  ["owner-plania", "Plania", "product-owner", "Product owner", "bot", "plania", "http", "{plania}"],
  ["po-mianovia", "Bot Mianovia", "product-owner", "Product owner", "bot", "plania", "none", "{product-owner}"],
];

test("0040 applies twice on a throwaway copy, then the seed leaves only the real roles", async () => {
  const name = "plania_mig_0040";
  const adminUrl = `postgres://${userInfo().username}@localhost:5432/postgres`;
  const url = `postgres://${userInfo().username}@localhost:5432/${name}`;
  const sql0040 = readFileSync(path.join(dir, "0040_roster_no_cursor.sql"), "utf8");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const mig = new pg.Client({ connectionString: url });
  await mig.connect();
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0040").sort()) await mig.query(readFileSync(path.join(dir, f), "utf8"));
    await mig.query(`insert into projects (slug, title, key_prefix) values ('demo', 'Demo', 'DEM')`);
    for (const [slug, nm, role, title, kind, , adapter, caps] of OLD_ROSTER) {
      const config = adapter === "cursor_agent" ? `{"command_env":"CURSOR_AGENT_BIN"}` : adapter === "claude_code" ? `{"command_env":"CLAUDE_CODE_BIN"}` : "{}";
      await mig.query(`insert into agents (slug, name, role, title, kind, adapter, adapter_config, capabilities) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::text[])`, [
        slug, nm, role, title, kind, adapter, config, caps,
      ]);
    }
    for (const [slug, , , , , parent] of OLD_ROSTER) {
      if (parent) await mig.query(`update agents set reports_to = (select id from agents where slug = $2) where slug = $1`, [slug, parent]);
    }
    const id = async (slug: string) => (await mig.query(`select id from agents where slug = $1`, [slug])).rows[0]?.id as string | undefined;
    const demo = (await mig.query(`select id from projects where slug = 'demo'`)).rows[0].id;
    await mig.query(`insert into heartbeat_runs (agent_id, started_at, status, adapter) values ($1, now(), 'fail', 'cursor_agent')`, [await id("cursor")]);
    await mig.query(`insert into heartbeat_runs (agent_id, started_at, status, adapter) values ($1, now(), 'ok', 'claude_code')`, [await id("claude-code")]);
    await mig.query(`insert into agent_runs (agent_id, project_id, role, status) values ($1, $2, 'taller', 'ok')`, [await id("claude-code"), demo]);
    await mig.query(`insert into tasks (project_id, key, title, kind, status, owner_agent) values ($1, 'DEM-1', 'Fake ticket', 'ticket', 'Backlog', $2)`, [demo, await id("claude-code")]);
    await mig.query(`insert into tasks (project_id, key, title, kind, status, owner_agent) values ($1, 'DEM-2', 'Fake ticket two', 'ticket', 'Backlog', $2)`, [demo, await id("coach")]);

    await mig.query(sql0040);
    await mig.query(sql0040);
    assert.equal((await mig.query(`select count(*)::int as n from agents where adapter = 'cursor_agent'`)).rows[0].n, 0);
    assert.equal((await mig.query(`select count(*)::int as n from heartbeat_runs where adapter = 'cursor_agent'`)).rows[0].n, 0);
    assert.equal((await mig.query(`select adapter from agents where slug = 'cursor'`)).rows[0].adapter, "none");
    await assert.rejects(mig.query(`update agents set adapter = 'cursor_agent' where slug = 'ceo'`), /agents_adapter_check/);
    await assert.rejects(
      mig.query(`insert into heartbeat_runs (agent_id, started_at, status, adapter) values ($1, now(), 'ok', 'cursor_agent')`, [await id("ceo")]),
      /heartbeat_runs_adapter_check/,
    );

    // Later migrations (0041 onward) the schema reads, then the seed.
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f > "0040").sort()) await mig.query(readFileSync(path.join(dir, f), "utf8"));
    const db = drizzle(pool, { schema });
    const first = await seedOrg(db);
    assert.deepEqual(first.removed.sort(), ["claude-code", "coach", "cursor", "plania"]);
    const second = await seedOrg(db);
    assert.deepEqual([second.inserted, second.removed], [[], []]);

    const { rows } = await mig.query<{ slug: string; name: string; role: string; title: string; adapter: string; reports_to: string | null }>(
      `select a.slug, a.name, a.role, a.title, a.adapter, p.slug as reports_to from agents a left join agents p on p.id = a.reports_to order by a.slug`,
    );
    const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
    assert.deepEqual(rows.map((r) => r.slug).sort(), ["artist", "asistente", "ceo", "filmia", "housi", "owner-plania", "po-mianovia", "research", "taller", "workia", "zigzag"]);
    assert.equal(rows.filter((r) => r.name === "Plania").length, 1, "one Plania: its product owner");
    assert.equal(rows.some((r) => ["coo", "cto"].includes(r.role)), false);
    assert.deepEqual([bySlug.taller!.role, bySlug.taller!.title, bySlug.taller!.adapter, bySlug.taller!.reports_to], ["taller", "Builder", "claude_code", "ceo"]);
    for (const po of ["housi", "workia", "filmia", "zigzag", "owner-plania", "po-mianovia"]) assert.equal(bySlug[po]!.reports_to, "ceo", po);
    assert.equal(bySlug.asistente!.reports_to, "ceo");
    assert.equal(bySlug.research!.reports_to, "asistente");
    assert.equal(bySlug.artist!.reports_to, "asistente");
    assert.equal(bySlug["po-mianovia"]!.name, "Bot Mianovia", "an existing name is kept");
    for (const r of rows.filter((r) => r.slug !== "ceo")) assert.equal(r.adapter, "claude_code", r.slug);

    // claude-code folded into taller: its ticket and runs moved, nothing cascaded away.
    const owners = (await mig.query(`select t.key, a.slug from tasks t left join agents a on a.id = t.owner_agent order by t.key`)).rows;
    assert.deepEqual(owners, [{ key: "DEM-1", slug: "taller" }, { key: "DEM-2", slug: null }]);
    assert.equal((await mig.query(`select count(*)::int as n from agent_runs where agent_id = $1`, [await id("taller")])).rows[0].n, 1);
    assert.equal((await mig.query(`select count(*)::int as n from heartbeat_runs`)).rows[0].n, 2);
  } finally {
    await pool.end();
    await mig.end();
    const drop = new pg.Client({ connectionString: adminUrl });
    await drop.connect();
    await drop.query(`drop database if exists ${name} with (force)`);
    await drop.end();
  }
});
