// PLA-I41-6: the Morning brief API contract (spec §7.3), through the app with the session cookie. Throwaway test DB
// and a fake spawnPass: no claude, no live database.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_TZ = "America/Mexico_City";
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { setBriefApiDepsForTests } = await import("../src/api/brief.js");
const { saveBriefSettings } = await import("../src/brief/settings.js");
const { BriefData } = await import("../src/brief/types.js");
type PassOutcome = import("../src/brief/claude.js").PassOutcome<unknown>;

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-brief-api-test-"));
const ENV = { HOME: scratch, PLANIA_TZ: "America/Mexico_City", PLANIA_HOME_PROJECT: "workia", PLANIA_BRIEF_TOKEN: "brief-read-token-value" } as NodeJS.ProcessEnv;
const ok = (data: unknown): PassOutcome => ({ ok: true, data, attempts: 1, turns: 2, tokens: { input: 1, output: 2, cacheRead: 0, cacheCreate: 0, total: 3 }, models: [], logPath: "/tmp/fake-brief-pass.jsonl" });
const ITEMS = {
  items: [
    { app: "zigzag", status: "blocker", ref: "ZIG-3", title: "Prod checkout is broken" },
    { app: "workia", status: "needs_you", ref: "WRK-1", title: "Decide the pricing page" },
    { app: "workia", status: "next", ref: "WRK-2", title: "Start the renewal board" },
  ],
};
const IDEAS = { ideas: [{ app: "workia", title: "Renewal board", why: "Contracts due soon." }] };

let gate: Promise<void> = Promise.resolve();
let passes: string[] = [];
setBriefApiDepsForTests({
  env: ENV,
  liveRuns: () => [],
  pollMs: 2,
  tmpDir: path.join(scratch, "tmp"),
  spawnPass: (async (_db: unknown, input: { pass: string }) => {
    passes.push(input.pass);
    await gate;
    return input.pass === "brief" ? ok(ITEMS) : ok(IDEAS);
  }) as never,
});

const cookie = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
const json = () => ({ ...cookie(), "Content-Type": "application/json" });
const get = (p: string) => app.request(`/api/brief${p}`, { headers: cookie() });
const send = (method: string, p: string, body?: unknown) => app.request(`/api/brief${p}`, { method, headers: json(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function untilIdle() {
  for (let i = 0; i < 400; i += 1) {
    const l = (await (await get("/latest")).json()) as { run: unknown };
    if (!l.run) {
      // The row says done a moment before the run frees its lock.
      await new Promise((r) => setTimeout(r, 100));
      return;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("the run did not end");
}

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  await saveBriefSettings(db, { github_mode: "off" });
});

after(async () => {
  setBriefApiDepsForTests({});
  await raw.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("every route needs the session cookie", async () => {
  for (const [method, p] of [["GET", "/latest"], ["GET", "/history"], ["GET", "/2026-11-13"], ["POST", "/run"], ["PUT", "/checks/x"], ["DELETE", "/checks/x"], ["GET", "/settings"], ["PUT", "/settings"], ["POST", "/plan"], ["GET", "/plan/1"]] as const) {
    const res = await app.request(`/api/brief${p}`, { method });
    assert.equal(res.status, 401, `${method} ${p}`);
  }
});

test("GET /latest before any brief: no brief, no checks, no run", async () => {
  const res = await get("/latest");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { brief: null, checks: [], run: null });
});

test("POST /run: 202 {run_id}; a second press while it runs is 409 BRIEF_RUNNING with the run id; latest shows the run", async () => {
  let release!: () => void;
  gate = new Promise<void>((r) => (release = r));
  passes = [];
  const first = await send("POST", "/run");
  assert.equal(first.status, 202);
  const { run_id } = (await first.json()) as { run_id: string };
  assert.match(run_id, /^[0-9a-f-]{36}$/);

  const second = await send("POST", "/run", {});
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { error: "BRIEF_RUNNING", run_id });

  for (let i = 0; i < 300 && ((await (await get("/latest")).json()) as { run?: { status: string } }).run?.status !== "running"; i += 1) await new Promise((r) => setTimeout(r, 10));
  const during = (await (await get("/latest")).json()) as { run: { id: string; status: string; started_at: string; waiting_for_build: boolean } };
  assert.equal(during.run.id, run_id);
  assert.equal(during.run.status, "running");
  assert.equal(during.run.waiting_for_build, false);
  assert.ok(!Number.isNaN(Date.parse(during.run.started_at)));

  release();
  await untilIdle();
  assert.deepEqual(passes, ["brief", "ideas"]);
  const latest = (await (await get("/latest")).json()) as { brief: { id: string; local_date: string; trigger: string; mode: string; data: unknown }; checks: string[]; run: null };
  assert.equal(latest.run, null);
  assert.equal(latest.brief.trigger, "manual");
  assert.equal(latest.brief.mode, "full");
  BriefData.parse(latest.brief.data);
  assert.deepEqual(latest.checks, []);
  const row = (await raw.query(`select trigger from morning_briefs where id = $1`, [latest.brief.id])).rows[0];
  assert.equal(row.trigger, "manual");
});

test("POST /run: passes picks the passes, trigger cli is stored, a bad body is 400", async () => {
  gate = Promise.resolve();
  passes = [];
  const res = await send("POST", "/run", { passes: ["brief"], trigger: "cli" });
  assert.equal(res.status, 202);
  await untilIdle();
  assert.deepEqual(passes, ["brief"]);
  const [b] = (await raw.query(`select trigger from morning_briefs order by generated_at desc limit 1`)).rows;
  assert.equal(b.trigger, "cli");
  for (const body of [{ passes: ["write"] }, { passes: [] }, { trigger: "schedule" }, { extra: 1 }]) assert.equal((await send("POST", "/run", body)).status, 400, JSON.stringify(body));
  const notJson = await app.request("/api/brief/run", { method: "POST", headers: { ...cookie(), "Content-Type": "text/plain" }, body: "x" });
  assert.equal(notJson.status, 415);
});

test("PUT / DELETE /checks/:itemId check and uncheck; latest lists the checked ids of its brief", async () => {
  const latest = (await (await get("/latest")).json()) as { brief: { data: { items: { id: string }[]; ideas: { id: string }[] } } };
  const id = latest.brief.data.items[0]!.id;
  const idea = latest.brief.data.ideas[0]!.id;
  const put = await send("PUT", `/checks/${encodeURIComponent(id)}`);
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), { item_id: id, checked: true });
  assert.equal((await send("PUT", `/checks/${encodeURIComponent(id)}`)).status, 200, "checking twice is fine");
  await send("PUT", `/checks/${encodeURIComponent(idea)}`);
  assert.deepEqual(((await (await get("/latest")).json()) as { checks: string[] }).checks, [id, idea].sort());
  const del = await send("DELETE", `/checks/${encodeURIComponent(id)}`);
  assert.deepEqual(await del.json(), { item_id: id, checked: false });
  assert.deepEqual(((await (await get("/latest")).json()) as { checks: string[] }).checks, [idea]);
  for (const bad of ["x", "i|Workia|abc", `i|workia|${"0".repeat(11)}`]) assert.equal((await send("PUT", `/checks/${encodeURIComponent(bad)}`)).status, 400, bad);
});

test("GET /history?days=14 lists the newest brief per date with counts; days out of range is 400", async () => {
  // An older brief, two days back.
  const data = { items: [{ status: "needs_you" }, { status: "blocker" }, { status: "next" }], ideas: [{}, {}] };
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(twoDaysAgo);
  await raw.query(`insert into morning_briefs (local_date, generated_at, trigger, mode, data) values ($1, $2, 'schedule', 'partial', $3)`, [d, twoDaysAgo, data]);
  const res = await get("/history?days=14");
  assert.equal(res.status, 200);
  const rows = (await res.json()) as { id: string; local_date: string; generated_at: string; mode: string; needs: number; next: number; ideas: number }[];
  assert.equal(rows.length, 2, "one per date (today has two briefs)");
  assert.deepEqual(Object.keys(rows[0]!).sort(), ["generated_at", "id", "ideas", "local_date", "mode", "needs", "next"]);
  assert.equal(rows[0]!.mode, "full", "newest first: today's newest brief");
  assert.deepEqual(rows[1], { ...rows[1]!, local_date: d, mode: "partial", needs: 2, next: 1, ideas: 2 });
  assert.equal((await get("/history")).status, 200, "days defaults to 14");
  assert.equal(((await (await get("/history?days=1")).json()) as unknown[]).length, 1);
  for (const q of ["0", "91", "abc", "-1"]) assert.equal((await get(`/history?days=${q}`)).status, 400, q);
});

test("GET /:date is the newest brief of that local date; unknown or bad dates are 404", async () => {
  const latest = (await (await get("/latest")).json()) as { brief: { id: string; local_date: string } };
  const res = await get(`/${latest.brief.local_date}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { brief: { id: string }; checks: string[] };
  assert.equal(body.brief.id, latest.brief.id);
  assert.ok(Array.isArray(body.checks));
  assert.equal((await get("/2020-01-01")).status, 404);
  assert.equal((await get("/2026-13-45")).status, 404);
});

test("GET / PUT /settings: brief_settings, the resolved zone and owner, and persona doc ids; invalid patches are 400", async () => {
  const pid = (await raw.query(`select id from projects where slug = 'zigzag'`)).rows[0].id;
  const doc = (await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, 'Idea persona', 'You run a repair shop.', '{"agent":"t","session_id":"s"}') returning id`, [pid])).rows[0].id;
  const res = await get("/settings");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { settings: Record<string, unknown>; resolved: Record<string, string>; personas: { project: string; doc_id: string }[] };
  assert.equal(body.settings.run_at, "07:00");
  assert.equal(body.settings.fallback_at, "11:00");
  assert.equal(body.settings.enabled, true);
  assert.deepEqual(body.resolved, { timezone: "America/Mexico_City", timezone_label: "CDMX", owner_name: body.resolved.owner_name });
  assert.deepEqual(body.personas, [{ project: "zigzag", doc_id: doc }]);
  assert.doesNotMatch(JSON.stringify(body), /brief-read-token-value|test-read-token/);

  const put = await send("PUT", "/settings", { run_at: "07:30", fallback_at: "12:00", language: "es" });
  assert.equal(put.status, 200);
  const saved = (await put.json()) as { settings: { run_at: string; fallback_at: string; language: string } };
  assert.deepEqual([saved.settings.run_at, saved.settings.fallback_at, saved.settings.language], ["07:30", "12:00", "es"]);
  assert.equal(((await (await get("/settings")).json()) as { settings: { run_at: string } }).settings.run_at, "07:30");

  const bad = await send("PUT", "/settings", { run_at: "25:00" });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: string }).error, "INVALID_SETTINGS");
  assert.equal((await send("PUT", "/settings", { nope: true })).status, 400, "unknown keys are refused");
  assert.equal((await send("PUT", "/settings", [1])).status, 400);
  await send("PUT", "/settings", { run_at: "07:00", fallback_at: "11:00", language: "en" });
});

test("POST /plan and GET /plan/:id answer 501 until Morning brief C", async () => {
  const plan = await send("POST", "/plan", { brief_id: "x", codes: ["W1"] });
  assert.equal(plan.status, 501);
  assert.equal(((await plan.json()) as { error: string }).error, "NOT_IMPLEMENTED");
  assert.equal((await get("/plan/abc")).status, 501);
});
