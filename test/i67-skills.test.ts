// PLA-I67-2: skills the owner writes on screen and «tu manera». A skill made through the screen's routes reaches the
// next run's plugin folder and its stamp; versions, diff source and roll back; a factory edit makes an owner copy and
// leaves the kit file alone; scope; «tu manera» on a fresh session of that agent only; scripts, hooks and tool grants
// refused; the migration runs twice. Fake child and fake git (no real claude), a kit folder in a temp dir, and the
// throwaway test database.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const scratch = mkdtempSync(path.join(tmpdir(), "plania-skills-test-"));
const kitDir = path.join(scratch, "kit");
process.env.PLANIA_KIT_DIR = kitDir;
useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const writes = await import("../src/mcp/writes.js");
const { wakeAgent } = await import("../src/jobs/heartbeat.js");
const runner = await import("../src/runner/runner.js");
const skills = await import("../src/runner/skills.js");
const { oficioRead } = await import("../src/api/company-oficio.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const scriptsRoot = path.join(scratch, "worktrees");
const repo = path.join(scratch, "repos", "micasa");
const ctx = { actor: { agent: "test-agent", session_id: "s-i67-2" } };
const jorge = { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${createSession()}` };
const TDD = "---\nname: tdd\ndescription: Builds behaviour test first.\n---\n\n# TDD\n\nSee one test fail.\n";

function writeKit(): void {
  rmSync(kitDir, { recursive: true, force: true });
  mkdirSync(path.join(kitDir, "skills", "tdd"), { recursive: true });
  writeFileSync(path.join(kitDir, "skills", "tdd", "SKILL.md"), TDD);
  writeFileSync(path.join(kitDir, "skills", "tdd", "mocking.md"), "Mock only at the edge.\n");
  writeFileSync(path.join(kitDir, "kits.json"), JSON.stringify({ taller: ["tdd"], research: [] }));
}

class FakeChild extends EventEmitter {
  pid: number;
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  exit(code: number): void {
    this.stdout.write(`${JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, session_id: `sess-${this.pid}`, result: "OK", modelUsage: { m: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } })}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", code, null));
  }
}

type Seen = { args: string[]; child: FakeChild; rolePrompt: string | null; plugin: Record<string, string> };
const argAfter = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);

// Every file of the plugin, read at spawn time (the folder leaves with the run).
function readTree(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) Object.assign(out, readTree(full, base));
    else out[path.relative(base, full)] = readFileSync(full, "utf8");
  }
  return out;
}

function fakes() {
  const spawned: Seen[] = [];
  let pid = 70_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude", PLANIA_KIT_DIR: kitDir } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: scriptsRoot,
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async (args: string[]) => {
      if (args[0] === "worktree" && args[1] === "add") {
        const target = args.find((a) => a.startsWith(scriptsRoot))!;
        mkdirSync(target, { recursive: true });
        writeFileSync(path.join(target, ".git"), "gitdir: fake\n");
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") return { code: 1, stdout: "", stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: "jl/feature\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    spawn: (_command: string, args: string[]) => {
      pid += 1;
      const child = new FakeChild(pid);
      const plugin = argAfter(args, "--plugin-dir");
      const sys = argAfter(args, "--append-system-prompt-file");
      spawned.push({ args, child, rolePrompt: sys ? readFileSync(sys, "utf8") : null, plugin: plugin ? readTree(path.join(plugin, "skills")) : {} });
      return child;
    },
    kill: () => undefined,
    reportTokens: async (_db: unknown, input: unknown) => input,
    probeUsage: async () => null,
  };
  return { deps, spawned };
}

const projectId = async (slug: string) => (await raw.query(`select id from projects where slug = $1`, [slug])).rows[0].id as string;
const agentRow = async (slug: string) => (await raw.query(`select * from agents where slug = $1`, [slug])).rows[0];
const agentOf = async (slug: string) => {
  const r = await agentRow(slug);
  return { ...r, projectId: r.project_id, roleTemplate: r.role_template, skillPacks: r.skill_packs, capabilities: r.capabilities, manner: r.manner } as never;
};
let n = 0;
const ready = async () => {
  n += 1;
  const key = `SKL-${n}`;
  await writes.createTask(db, { project: "micasa", key, title: "Skill ticket", scope: "Scope", checks: ["Done"], status: "Ready" } as never, ctx);
  return key;
};
const runOnce = async (slug: string) => {
  const f = fakes();
  const key = await ready();
  assert.equal((await wakeAgent(db, { agent: slug, taskKey: key, now: new Date() }, { runner: f.deps as never })).reason, "ok");
  const seen = f.spawned[0]!;
  seen.child.exit(0);
  await runner.waitForAllRuns();
  const row = (await raw.query(`select r.skills, r.manner_version from agent_runs r join agents a on a.id = r.agent_id where a.slug = $1 order by r.queued_at desc limit 1`, [slug])).rows[0] as { skills: string[]; manner_version: string | null };
  return { seen, row };
};
const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = jorge) =>
  app.request(`/api/company/projects/micasa/team/${url}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

before(async () => {
  writeKit();
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  mkdirSync(repo, { recursive: true });
  const micasa = await projectId("micasa");
  await raw.query(`update agents set heartbeat_minutes = null, adapter = 'none', adapter_config = '{}'::jsonb`);
  await raw.query(`update agents set adapter = 'claude_code', project_id = $1 where slug in ('taller', 'research')`, [micasa]);
  // A second builder, on another project.
  await raw.query(
    `insert into agents (slug, name, role, kind, capabilities, project_id, role_template, adapter) values ('taller-workia', 'Taller', 'taller', 'bot', '{engineering}', $1, 'taller', 'claude_code')`,
    [await projectId("workia")],
  );
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  for (const title of ["Prompt: Taller", "Prompt: Research"]) await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4)`, [micasa, title, `# ${title}\nNever main.`, actor]);
  await raw.query(`update projects set settings = $1::jsonb where slug = 'micasa'`, [JSON.stringify({ local: { repo_path: repo } })]);
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  writeKit();
  await raw.query(`delete from agent_runs`);
  await raw.query(`delete from agent_sessions`);
  await raw.query(`delete from skills`);
  await raw.query(`update agents set skill_packs = '{}', manner = null`);
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 4, cooldown_minutes = 0, plan_guard_pct = 70, guard_override = false, reserve_tokens = 1000`);
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  await raw.query(`delete from plan_readings`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, seven_day_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, 19, now() + interval '3 hours')`);
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

const NEW = { name: "Boceto en la pantalla real", description: "Use when the change lives on a screen that already exists.", body: "# Boceto\n\nRedraw the screen as it is, then mark what is new.", files: [{ path: "ejemplo.md", content: "An example.\n" }] };

test("PLA-I67-2: a skill created on screen reaches the next run's plugin folder, stamped slug@hash", async () => {
  const res = await call("POST", "taller/skills", NEW);
  assert.equal(res.status, 201);
  const card = (await res.json()) as { slug: string; version: string; n: number; scope: string; on: boolean; source: string };
  assert.equal(card.slug, "boceto-en-la-pantalla-real");
  assert.equal(card.source, "owner");
  assert.equal(card.n, 1);
  assert.equal(card.scope, "agent");
  assert.equal(card.on, true);
  const { seen, row } = await runOnce("taller");
  const skillMd = seen.plugin[path.join("boceto-en-la-pantalla-real", "SKILL.md")]!;
  assert.equal(skillMd, skills.renderSkillMd(card.slug, NEW.description, NEW.body));
  assert.equal(seen.plugin[path.join("boceto-en-la-pantalla-real", "ejemplo.md")], "An example.\n");
  assert.ok(seen.plugin[path.join("tdd", "SKILL.md")], "the factory kit still rides along");
  assert.deepEqual(row.skills.map((s) => s.split("@")[0]), ["tdd", card.slug]);
  assert.ok(row.skills.includes(card.version), "the stamp is the card's version");
  assert.match(card.version, /@[0-9a-f]{8}$/);
  // The page lists it as the owner's, on.
  const o = await oficioRead(db, "micasa", "taller");
  if ("error" in o) throw new Error(o.error);
  const s = o.skills.find((x) => x.slug === card.slug)!;
  assert.equal(s.source, "owner");
  assert.equal(s.on, true);
  assert.deepEqual(s.owner, { scope: "agent", state: "on", origin: "owner", n: 1 });
});

test("PLA-I67-2: editing saves a new version with the old one kept; rolling back makes the old content the one runs carry", async () => {
  const made = (await (await call("POST", "taller/skills", NEW)).json()) as { slug: string; version: string };
  const v1 = made.version;
  const edited = (await (await call("PUT", `taller/skills/${made.slug}`, { body: "# Boceto\n\nRedraw it, then number every new part." })).json()) as { n: number; version: string; versions: { n: number; body: string }[] };
  assert.equal(edited.n, 2);
  assert.notEqual(edited.version, v1);
  assert.deepEqual(edited.versions.map((v) => v.n), [2, 1], "both contents stay, newest first: the screen diffs them");
  assert.match(edited.versions[1]!.body, /mark what is new/);
  // Saving the same content again is not a version.
  const same = (await (await call("PUT", `taller/skills/${made.slug}`, { body: "# Boceto\n\nRedraw it, then number every new part." })).json()) as { n: number };
  assert.equal(same.n, 2);
  assert.equal((await runOnce("taller")).row.skills.find((s) => s.startsWith(made.slug)), edited.version);
  const back = (await (await call("POST", `taller/skills/${made.slug}/rollback`, { n: 1 })).json()) as { n: number; version: string; versions: { n: number; note: string | null }[] };
  assert.equal(back.n, 3, "a roll back is a new version; history stays whole");
  assert.equal(back.versions[0]!.note, "rollback:1");
  assert.equal(back.version, v1, "same content, same hash");
  assert.equal((await runOnce("taller")).row.skills.find((s) => s.startsWith(made.slug)), v1);
  assert.equal((await call("POST", `taller/skills/${made.slug}/rollback`, { n: 9 })).status, 404);
});

test("PLA-I67-2: editing a factory skill creates an owner copy and leaves the kit file untouched", async () => {
  const before = readFileSync(path.join(kitDir, "skills", "tdd", "SKILL.md"), "utf8");
  const res = await call("PUT", "taller/skills/tdd", { body: "# TDD\n\nSee one test fail. Then name it after the behaviour." });
  assert.equal(res.status, 200);
  const card = (await res.json()) as { origin: string; source: string; n: number; versions: { n: number; author: string; body: string }[]; factory_changed: boolean };
  assert.equal(card.source, "owner");
  assert.equal(card.origin, "factory-copy");
  assert.deepEqual(card.versions.map((v) => [v.n, v.author]), [[2, "owner"], [1, "factory"]]);
  assert.match(card.versions[1]!.body, /^# TDD\n\nSee one test fail\.$/);
  assert.equal(readFileSync(path.join(kitDir, "skills", "tdd", "SKILL.md"), "utf8"), before, "the kit file is never written");
  assert.equal(card.factory_changed, false);
  const { seen, row } = await runOnce("taller");
  assert.match(seen.plugin[path.join("tdd", "SKILL.md")]!, /Then name it after the behaviour/);
  assert.equal(seen.plugin[path.join("tdd", "mocking.md")], "Mock only at the edge.\n", "the copy keeps the kit's text files");
  assert.deepEqual(row.skills.map((s) => s.split("@")[0]), ["tdd"], "the copy takes the factory skill's place");
  // The factory one keeps updating; the card says so.
  writeFileSync(path.join(kitDir, "skills", "tdd", "SKILL.md"), TDD.replace("fail.", "fail first."));
  const later = (await (await call("GET", "taller/skills/tdd")).json()) as { factory_changed: boolean };
  assert.equal(later.factory_changed, true);
  // Off: neither the copy nor the factory one rides.
  await call("PUT", "taller/skills/tdd/state", { on: false });
  assert.deepEqual((await runOnce("taller")).row.skills, []);
});

test("PLA-I67-2: scope: one agent's skill is not carried by another seat or project; widened to the seat template it is", async () => {
  const made = (await (await call("POST", "taller/skills", NEW)).json()) as { slug: string };
  const carries = async (slug: string) => (await skills.resolvedKit(db, await agentOf(slug))).some((s) => s.slug === made.slug);
  assert.equal(await carries("taller"), true);
  assert.equal(await carries("research"), false, "another seat");
  assert.equal(await carries("taller-workia"), false, "the same seat in another project");
  const wide = (await (await call("PUT", `taller/skills/${made.slug}`, { scope: "seat" })).json()) as { scope: string; n: number };
  assert.equal(wide.scope, "seat");
  assert.equal(wide.n, 1, "a scope change is not a new version");
  assert.equal(await carries("taller-workia"), true, "every builder now");
  assert.equal(await carries("research"), false);
  await call("PUT", `taller/skills/${made.slug}`, { scope: "project" });
  assert.equal(await carries("research"), true, "everyone in MiCasa");
  assert.equal(await carries("taller-workia"), false);
});

test("PLA-I67-2: «tu manera» is carried by the next fresh session of that agent only", async () => {
  const res = await call("PUT", "taller/manner", { text: "Primero la pantalla entera, luego el detalle." });
  assert.equal(res.status, 200);
  const p = (await res.json()) as { manner: string; manner_version: string };
  assert.match(p.manner_version, /^[0-9a-f]{8}$/);
  const first = await runOnce("taller");
  assert.match(first.seen.rolePrompt!, /^# Prompt: Taller\nNever main\.\n\n# Your owner's way for this seat\n[\s\S]*Primero la pantalla entera, luego el detalle\.\n$/);
  assert.equal(first.row.manner_version, p.manner_version);
  const other = await runOnce("research");
  assert.doesNotMatch(other.seen.rolePrompt!, /owner's way/);
  assert.equal(other.row.manner_version, null);
  // Emptied, it is gone from the next fresh session.
  await call("PUT", "taller/manner", { text: "  " });
  await raw.query(`delete from agent_sessions`);
  const cleared = await runOnce("taller");
  assert.doesNotMatch(cleared.seen.rolePrompt!, /owner's way/);
  assert.equal((await call("PUT", "taller/manner", { text: "x".repeat(2001) })).status, 400);
});

test("PLA-I67-2: a skill with a script, a hook, a tool grant or a load-time command is refused with SKILL_NOT_ALLOWED", async () => {
  const refused = async (body: unknown) => {
    const res = await call("POST", "taller/skills", body);
    assert.equal(res.status, 400);
    return ((await res.json()) as { error: string }).error;
  };
  assert.equal(await refused({ ...NEW, body: "allowed-tools: Bash\n# x" }), "SKILL_NOT_ALLOWED");
  assert.equal(await refused({ ...NEW, body: "# x\nhooks:\n  PreToolUse: []" }), "SKILL_NOT_ALLOWED");
  assert.equal(await refused({ ...NEW, body: "# x\nToday: !`date`" }), "SKILL_NOT_ALLOWED");
  assert.equal(await refused({ ...NEW, files: [{ path: "scripts/run.sh", content: "echo hi" }] }), "SKILL_NOT_ALLOWED");
  assert.equal(await refused({ ...NEW, files: [{ path: "run.md", content: "#!/bin/sh\necho" }] }), "SKILL_NOT_ALLOWED");
  assert.equal(await refused({ ...NEW, description: "" }), "SKILL_INVALID");
  assert.equal(await refused({ ...NEW, description: "x".repeat(1025) }), "SKILL_INVALID");
  assert.equal(await refused({ ...NEW, body: "---\nname: x\n---\nbody" }), "SKILL_INVALID");
  assert.equal(await refused({ ...NEW, body: Array.from({ length: 501 }, () => "x").join("\n") }), "SKILL_INVALID");
  // An edit is checked the same way.
  const made = (await (await call("POST", "taller/skills", NEW)).json()) as { slug: string };
  const edit = await call("PUT", `taller/skills/${made.slug}`, { body: "allowed-tools: Read" });
  assert.equal(((await edit.json()) as { error: string }).error, "SKILL_NOT_ALLOWED");
  assert.equal((await raw.query(`select count(*)::int as n from skill_versions`)).rows[0].n, 1, "nothing was saved");
  // A name taken by the kit or a live skill; only the owner's screen writes.
  assert.equal((await call("POST", "taller/skills", { ...NEW, name: "tdd" })).status, 409);
  assert.equal((await call("POST", "taller/skills", NEW)).status, 409);
  assert.equal((await call("POST", "taller/skills", NEW, { "Content-Type": "application/json", Authorization: "Bearer runner-token" })).status, 403);
});

test("PLA-I67-2: duplicate, delete into a 30-day archive, restore", async () => {
  const made = (await (await call("POST", "taller/skills", NEW)).json()) as { slug: string };
  const dup = await call("POST", `taller/skills/${made.slug}/duplicate`);
  assert.equal(dup.status, 201);
  const copy = (await dup.json()) as { slug: string; name: string };
  assert.equal(copy.slug, `${made.slug}-2`);
  assert.equal((await call("DELETE", `taller/skills/${made.slug}`)).status, 200);
  assert.equal((await skills.resolvedKit(db, await agentOf("taller"))).some((s) => s.slug === made.slug), false, "out of the next run at once");
  const puesto = (await (await call("GET", "taller/puesto")).json()) as { archived: { slug: string }[] };
  assert.deepEqual(puesto.archived.map((a) => a.slug), [made.slug]);
  assert.equal((await call("POST", `taller/skills/${made.slug}/restore`)).status, 200);
  assert.equal((await skills.resolvedKit(db, await agentOf("taller"))).some((s) => s.slug === made.slug), true);
  // Past 30 days it cannot come back.
  await call("DELETE", `taller/skills/${made.slug}`);
  await raw.query(`update skills set archived_at = now() - interval '31 days' where slug = $1`, [made.slug]);
  assert.equal((await call("POST", `taller/skills/${made.slug}/restore`)).status, 404);
});

test("PLA-I67-2: migration 0068 is safe to run twice", async () => {
  const sql = readFileSync(path.resolve(import.meta.dirname, "../drizzle/migrations/0068_owner_skills.sql"), "utf8");
  await raw.query(sql);
  await raw.query(sql);
  const cols = (await raw.query(`select column_name from information_schema.columns where table_name = 'agents' and column_name in ('manner', 'manner_updated_at')`)).rows;
  assert.equal(cols.length, 2);
});
