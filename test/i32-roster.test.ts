// PLA-I32-2: one team per project. The roster as it stands before the deploy (11 rows, fake values, the
// same shape) is rebuilt on a private throwaway database with six projects, every migration runs, then
// seedOrg runs the way Jorge's deploy runs it, twice. Never a real database.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema.js";
import { seedOrg } from "../scripts/seed-org.js";
import { roleOf } from "../src/runner/limits.js";

const dir = path.resolve(import.meta.dirname, "../drizzle/migrations");

const PROJECTS: [slug: string, title: string, prefix: string][] = [
  ["filmia", "Filmia", "FIL"],
  ["mianovia", "Mianovia", "MIA"],
  ["micasa", "MiCasa", "MIC"],
  ["plania", "Plania", "PLA"],
  ["workia", "Workia", "WRK"],
  ["zigzag", "Zigzag", "ZIG"],
];

// Today's 11 rows after PLA-I30-1 (fake names, same roles).
const ROSTER: [slug: string, name: string, role: string, title: string, kind: string, caps: string, parent: string | null][] = [
  ["ceo", "CEO", "human", "CEO", "human", "{}", null],
  ["asistente", "Asistente", "chief-of-staff", "Chief of Staff", "bot", "{staff}", "ceo"],
  ["taller", "Taller", "taller", "Builder", "bot", "{engineering}", "ceo"],
  ["research", "Research", "shared", "Shared service", "bot", "{research}", "asistente"],
  ["artist", "Artist", "shared", "Shared service", "bot", "{design}", "asistente"],
  ["po-mianovia", "Bot Mianovia", "product-owner", "Product owner", "bot", "{mianovia}", "ceo"],
  ["housi", "Housi", "product-owner", "Product owner", "bot", "{micasa}", "ceo"],
  ["workia", "Workia", "product-owner", "Product owner", "bot", "{workia}", "ceo"],
  ["filmia", "Filmia", "product-owner", "Product owner", "bot", "{filmia}", "ceo"],
  ["zigzag", "ZigZag", "product-owner", "Product owner", "bot", "{zigzag}", "ceo"],
  ["owner-plania", "Plania", "product-owner", "Product owner", "bot", "{plania}", "ceo"],
];

test("I32-2: today's 11-row roster becomes asistente, ceo and six teams of four; the shared three retire with their history", async () => {
  const name = "plania_mig_i32_roster";
  const adminUrl = `postgres://${userInfo().username}@localhost:5432/postgres`;
  const url = `postgres://${userInfo().username}@localhost:5432/${name}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const raw = new pg.Client({ connectionString: url });
  await raw.connect();
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await raw.query(readFileSync(path.join(dir, f), "utf8"));
    for (const [slug, title, prefix] of PROJECTS) await raw.query(`insert into projects (slug, title, key_prefix) values ($1, $2, $3)`, [slug, title, prefix]);
    for (const [slug, nm, role, title, kind, caps] of ROSTER) {
      await raw.query(`insert into agents (slug, name, role, title, kind, adapter, adapter_config, capabilities) values ($1, $2, $3, $4, $5, $6, '{"command_env":"CLAUDE_CODE_BIN"}'::jsonb, $7::text[])`, [
        slug, nm, role, title, kind, kind === "human" ? "none" : "claude_code", caps,
      ]);
    }
    for (const [slug, , , , , , parent] of ROSTER) {
      if (parent) await raw.query(`update agents set reports_to = (select id from agents where slug = $2) where slug = $1`, [slug, parent]);
    }
    const id = async (slug: string) => (await raw.query(`select id from agents where slug = $1`, [slug])).rows[0]?.id as string;
    const pid = async (slug: string) => (await raw.query(`select id from projects where slug = $1`, [slug])).rows[0].id as string;
    // History on the rows that change: runs of a PO about to be renamed and of the shared taller,
    // an open ticket of the shared taller in micasa and a closed one in filmia.
    await raw.query(`insert into agent_runs (agent_id, project_id, role, status) values ($1, $2, 'product-owner', 'ok'), ($1, $2, 'product-owner', 'fail')`, [await id("housi"), await pid("micasa")]);
    await raw.query(`insert into agent_runs (agent_id, project_id, role, status) values ($1, $2, 'taller', 'ok')`, [await id("taller"), await pid("micasa")]);
    await raw.query(`insert into heartbeat_runs (agent_id, started_at, status, adapter) values ($1, now(), 'ok', 'claude_code')`, [await id("owner-plania")]);
    await raw.query(`insert into tasks (project_id, key, title, kind, status, owner_agent) values ($1, 'MIC-1', 'Fake open ticket', 'ticket', 'Ready', $2)`, [await pid("micasa"), await id("taller")]);
    await raw.query(`insert into tasks (project_id, key, title, kind, status, owner_agent) values ($1, 'FIL-1', 'Fake closed ticket', 'ticket', 'Done', $2)`, [await pid("filmia"), await id("taller")]);
    const housiId = await id("housi");

    const db = drizzle(pool, { schema });
    const first = await seedOrg(db);
    assert.deepEqual(first.renamed.sort(), ["filmia→po-filmia", "housi→po-micasa", "owner-plania→po-plania", "workia→po-workia", "zigzag→po-zigzag"]);
    assert.deepEqual(first.retired.sort(), ["artist", "research", "taller"]);
    const second = await seedOrg(db);
    assert.deepEqual([second.inserted, second.removed, second.renamed, second.retired], [[], [], [], []], "a second run changes nothing");

    const { rows } = await raw.query<{ slug: string; status: string; adapter: string; project: string | null; role_template: string | null; boss: string | null; note: string; role: string; capabilities: string[] }>(
      `select a.slug, a.status, a.adapter, p.slug as project, a.role_template, b.slug as boss, a.note, a.role, a.capabilities
       from agents a left join projects p on p.id = a.project_id left join agents b on b.id = a.reports_to order by a.slug`,
    );
    const live = rows.filter((r) => r.status !== "retired");
    const company = live.filter((r) => !r.project).map((r) => r.slug);
    assert.deepEqual(company, ["asistente", "ceo"]);
    assert.equal(live.find((r) => r.slug === "asistente")!.role_template, "asistente");
    for (const [slug] of PROJECTS) {
      const team = live.filter((r) => r.project === slug);
      assert.deepEqual(
        team.map((r) => [r.slug, r.role_template, r.boss]),
        [
          [`artist-${slug}`, "artist", `po-${slug}`],
          [`po-${slug}`, "product-owner", "ceo"],
          [`research-${slug}`, "research", `po-${slug}`],
          [`taller-${slug}`, "taller", `po-${slug}`],
        ],
        slug,
      );
      for (const r of team) {
        assert.equal(r.adapter, "claude_code", r.slug);
        assert.equal(roleOf({ slug: r.slug, role: r.role, capabilities: r.capabilities, roleTemplate: r.role_template }), r.role_template, r.slug);
      }
    }
    assert.equal(live.length, 2 + 6 * 4);

    const retired = rows.filter((r) => r.status === "retired");
    assert.deepEqual(retired.map((r) => [r.slug, r.adapter, r.project]), [["artist", "none", null], ["research", "none", null], ["taller", "none", null]]);

    // Renamed POs keep their id, name and runs; the old slug is in the note.
    const micasaPo = (await raw.query(`select id, name, note from agents where slug = 'po-micasa'`)).rows[0];
    assert.equal(micasaPo.id, housiId);
    assert.equal(micasaPo.name, "Housi");
    assert.match(micasaPo.note, /alias: housi/);
    assert.equal((await raw.query(`select count(*)::int as n from agent_runs where agent_id = $1`, [housiId])).rows[0].n, 2);
    assert.equal((await raw.query(`select count(*)::int as n from heartbeat_runs h join agents a on a.id = h.agent_id where a.slug = 'po-plania'`)).rows[0].n, 1);
    assert.equal((await raw.query(`select name from agents where slug = 'po-mianovia'`)).rows[0].name, "Bot Mianovia", "an existing name is kept");

    // The shared taller keeps its run; its open ticket moved to the project's Taller, the closed one stayed.
    assert.equal((await raw.query(`select count(*)::int as n from agent_runs where agent_id = $1`, [await id("taller")])).rows[0].n, 1);
    const owners = (await raw.query(`select t.key, a.slug from tasks t join agents a on a.id = t.owner_agent order by t.key`)).rows;
    assert.deepEqual(owners, [{ key: "FIL-1", slug: "taller" }, { key: "MIC-1", slug: "taller-micasa" }]);
  } finally {
    await pool.end();
    await raw.end();
    const drop = new pg.Client({ connectionString: adminUrl });
    await drop.connect();
    await drop.query(`drop database if exists ${name} with (force)`);
    await drop.end();
  }
});
