// PLA-I71-4: the skill store. The read lists factory, the owner's and brought skills with the right carriers per seat;
// a seat's switch in the store changes what its next run carries (the same read the panel shows); use counts come from
// recorded runs and a skill no run carried says so; creating and copying work from the store's routes. Scratch kit,
// throwaway DB, no network.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const scratch = mkdtempSync(path.join(tmpdir(), "plania-i71-tienda-"));
const kitDir = path.join(scratch, "kit");
process.env.PLANIA_KIT_DIR = kitDir;
useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "tienda";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { ensureTeam } = await import("../src/runner/team.js");
const lib = await import("../ui/src/lib/tienda.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let pid: string;
const owner = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const call = async (method: string, url: string, body?: unknown) => {
  const res = await app.request(url, { method, headers: owner(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
};
const store = async () => (await call("GET", "/api/company/projects/tienda/tienda")).json as { seats: Json[]; skills: Json[] };
const skill = (slug: string, description: string) => {
  mkdirSync(path.join(kitDir, "skills", slug), { recursive: true });
  writeFileSync(path.join(kitDir, "skills", slug, "SKILL.md"), `---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${slug}\n\nOne step at a time.\n`);
};
const on = (s: Json, agent: string) => s.carriers.find((c: Json) => c.agent === agent)?.on;

before(async () => {
  skill("tdd", "Builds behaviour test first.");
  skill("pr", "Opens the pull request.");
  skill("design-it-twice", "Two or three ways before choosing.");
  writeFileSync(path.join(kitDir, "kits.json"), JSON.stringify({ taller: ["tdd", "pr"], research: [], artist: ["design-it-twice"], "product-owner": [] }));
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  pid = (await raw.query(`insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND') returning id`)).rows[0].id;
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  for (const t of ["Product owner", "Taller", "Research", "Artist"]) await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4)`, [pid, `Prompt: ${t}`, `# ${t}`, actor]);
  await ensureTeam(db, { id: pid, slug: "tienda", title: "Tienda" });
  // Taller carried tdd in three runs and used it in two.
  for (const used of [["tdd"], ["tdd"], []])
    await raw.query(
      `insert into agent_runs (agent_id, project_id, task_key, role, status, skills, skills_used, queued_at, started_at, ended_at) select id, $1, 'TND-1', 'taller', 'ok', $2, $3, now() - interval '1 hour', now() - interval '1 hour', now() - interval '50 minutes' from agents where slug = 'taller-tienda'`,
      [pid, ["tdd@abc12345", "pr@abc12345"], used],
    );
});
after(async () => {
  await closeDb();
  await raw.end();
});

test("I71-4 #1 #3: the store lists the factory skills with their carriers per seat and use from recorded runs", async () => {
  const s = await store();
  assert.deepEqual(s.seats.map((x) => x.agent).sort(), ["artist-tienda", "po-tienda", "research-tienda", "taller-tienda"]);
  const tdd = s.skills.find((x) => x.slug === "tdd")!;
  assert.equal(tdd.origin, "factory");
  assert.equal(on(tdd, "taller-tienda"), true);
  assert.equal(on(tdd, "research-tienda"), false);
  assert.deepEqual([tdd.runs_carried, tdd.runs_used], [3, 2]);
  assert.equal(lib.usageLine(tdd as never, "es"), "usada en 2 de 3");
  const twice = s.skills.find((x) => x.slug === "design-it-twice")!;
  assert.equal(on(twice, "artist-tienda"), true);
  assert.equal(twice.runs_carried, 0);
  assert.equal(lib.usageLine(twice as never, "es"), "sin corridas todavía", "never «0 de 0»");
  const counts = lib.filterCounts(s.skills as never);
  assert.equal(counts.todas, 3);
  assert.equal(counts.fabrica, 3);
  assert.equal(counts.nadie, 0);
});

test("I71-4 #2: a seat's switch in the store changes what its next run carries, and the panel's read agrees", async () => {
  const s = await store();
  const list = lib.seatListAfter(s.skills as never, "research-tienda", "tdd", true);
  assert.deepEqual(list, ["tdd"]);
  assert.equal((await call("PUT", "/api/company/projects/tienda/team/research-tienda/packs", { packs: list, own: true })).status, 200);
  const after = await store();
  assert.equal(on(after.skills.find((x) => x.slug === "tdd")!, "research-tienda"), true);
  const panel = (await call("GET", "/api/company/projects/tienda/team/research-tienda/oficio")).json;
  assert.equal(panel.skills.find((x: Json) => x.slug === "tdd").on, true);
  // Off again for Taller: its list keeps pr only.
  const off = lib.seatListAfter(after.skills as never, "taller-tienda", "tdd", false);
  assert.deepEqual(off, ["pr"]);
});

test("I71-4 #4: creating a skill and copying a factory one, from the store's routes, show up as yours", async () => {
  const made = await call("POST", "/api/company/projects/tienda/team/po-tienda/skills", { name: "Tono de la marca", description: "Cómo habla este proyecto.", body: "# Tono\n\nCercano y claro.", scope: "project" });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const copy = await call("POST", "/api/company/projects/tienda/team/taller-tienda/skills/pr/duplicate");
  assert.equal(copy.status, 201, JSON.stringify(copy.json));
  const s = await store();
  const tono = s.skills.find((x) => x.slug === made.json.slug)!;
  assert.equal(tono.origin, "yours");
  assert.equal(tono.scope, "project");
  assert.ok(tono.carriers.every((c: Json) => c.on), "a project skill reaches every seat");
  // «Hacer mi copia» makes a skill of the owner's (pr-2) beside the factory one, carried by the seat that copied it.
  const mine = s.skills.find((x) => x.slug === copy.json.slug)!;
  assert.equal(mine.origin, "yours");
  assert.equal(on(mine, "taller-tienda"), true);
  assert.equal(s.skills.find((x) => x.slug === "pr")!.origin, "factory");
  assert.equal(lib.filterCounts(s.skills as never).tuyas, 2);
  assert.deepEqual(lib.searchOf(s.skills as never, "tono").map((x: Json) => x.slug), [made.json.slug]);
});
