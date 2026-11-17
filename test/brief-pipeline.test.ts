// PLA-I41-5: the Morning brief pipeline (spec §4, §5 lock, §11). Throwaway test store (test/helpers.ts) and a fake
// spawnPass only: no claude process, no live store, no network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const pipeline = await import("../src/brief/pipeline.js");
const { itemId } = await import("../src/brief/merge.js");
const { saveBriefSettings } = await import("../src/brief/settings.js");
const { BriefData } = await import("../src/brief/types.js");
const runner = await import("../src/runner/runner.js");
type PassOutcome = import("../src/brief/claude.js").PassOutcome<unknown>;
type SpawnInput = import("../src/brief/claude.js").SpawnPassInput<unknown>;

type Db = ReturnType<typeof makeDb>["db"];
let store: TestStore;
let db: Db;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-brief-pipeline-test-"));
const ENV = { HOME: scratch, PLANIA_TZ: "America/Mexico_City", PLANIA_HOME_PROJECT: "workia", PLANIA_BRIEF_TOKEN: "brief-read-token-value" } as NodeJS.ProcessEnv;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const ok = (data: unknown, pass: string): PassOutcome => ({
  ok: true,
  data,
  attempts: 1,
  turns: 2,
  tokens: { input: 1, output: 2, cacheRead: 0, cacheCreate: 0, total: 3 },
  models: [],
  logPath: path.join(scratch, `2026-11-13-morning-brief-${pass}-abc.jsonl`),
});
const fail = (reason: string, summary: string): PassOutcome => ({ ok: false, reason: reason as never, summary, attempts: 1, logPath: null });

const ITEMS = {
  items: [
    { app: "workia", status: "needs_you", ref: "WRK-I14 · #45", title: "Release sandbox to main", detail: "Sandbox is 9 ahead.", url: "https://github.com/o/workia/compare/main...sandbox", action: "Open compare" },
    { app: "zigzag", status: "blocker", ref: "ZIG-3", title: "Prod checkout is broken" },
    { app: "filmia", status: "next", ref: "FIL-9", title: "Start the taste map" },
  ],
};
const IDEAS = { ideas: [{ app: "workia", title: "Renewal board", why: "Contracts due soon." }, { app: "zigzag", title: "Late-payer flag", why: "Shops ask." }] };

// A fake spawnPass: records each call and answers per pass.
function fakeSpawn(answer: (pass: string, input: SpawnInput) => PassOutcome | Promise<PassOutcome> = (pass) => (pass === "brief" ? ok(ITEMS, pass) : ok(IDEAS, pass))) {
  const calls: { pass: string; input: SpawnInput; timeoutMs?: number; reserved: string | null }[] = [];
  const spawnPass = async (_db: unknown, input: SpawnInput, deps?: { timeoutMs?: number }) => {
    calls.push({ pass: input.pass, input, timeoutMs: deps?.timeoutMs, reserved: runner.slotReservation()?.label ?? null });
    return (await answer(input.pass, input)) as never;
  };
  return { calls, spawnPass };
}
const deps = (over: Record<string, unknown> = {}) => ({ env: ENV, tmpDir: path.join(scratch, "tmp"), liveRuns: () => [], pollMs: 5, buildBrief: async () => ["Corren 4 proyectos."], ...over });

type Listed = { id: string; title: string };
const runRow = async (id: string) => (await store.get("briefRuns", { id }))!;
const briefRow = async (id: string) => {
  const b = (await store.get("morningBriefs", { id }))!;
  return { ...b, data: b.data as { items: Listed[]; ideas: Listed[] } };
};
const newestBrief = async () => (await store.find("morningBriefs", {}, { orderBy: [{ column: "generatedAt", desc: true }], limit: 1 }))[0]!;

before(async () => {
  store = await resetTestStore();
  ({ db } = makeDb());
  const zigzag = await store.projectId("zigzag");
  const filmia = await store.projectId("filmia");
  await store.fix(async (uow) => {
    await uow.insert("tasks", { projectId: zigzag, key: "ZIG-IDEA1", kind: "idea", status: "Open", stage: "idea", title: "Quote templates", summary: "Save a quote as a template." });
    await uow.insert("tasks", { projectId: filmia, key: "FIL-9", kind: "ticket", status: "Done", stage: null, title: "Start the taste map", summary: "" });
  });
  // English texts below; Spanish is the default since PLA-I51-1.
  await saveBriefSettings(db, { github_mode: "off", language: "en", projects: { workia: { order: 0 }, zigzag: { order: 1 }, filmia: { order: 2 }, micasa: { order: 3 } } });
});

beforeEach(async () => {
  runner.releaseReservation();
  await store.fix((uow) => uow.delete("briefRuns", { status: ["waiting", "running"] }));
});

after(async () => {
  await store.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("a full run: waiting -> running -> ok, one morning_briefs row with valid BriefData, settled refs dropped", async () => {
  const f = fakeSpawn();
  const res = await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: f.spawnPass }));
  assert.equal(res.status, "ok");
  assert.equal(res.mode, "full");
  assert.deepEqual(f.calls.map((c) => c.pass), ["brief", "ideas"], "pass A then pass B");
  assert.deepEqual(f.calls.map((c) => c.reserved), ["morning-brief", "morning-brief"], "the slot is held across both passes");
  assert.equal(runner.slotReservation(), null, "and released after");
  assert.deepEqual(f.calls.map((c) => c.timeoutMs), [10 * 60_000, 20 * 60_000], "pass timeouts come from settings");
  assert.match(f.calls[0]!.input.prompt, /facts\.json/);

  const run = await runRow(res.runId);
  assert.equal(run.status, "ok");
  assert.ok(run.endedAt);
  assert.deepEqual(run.passes.brief, { status: "ok", turns: 2, tokens: 3, log_file: "2026-11-13-morning-brief-brief-abc.jsonl" }, "file name only");
  assert.doesNotMatch(JSON.stringify(run), new RegExp(scratch.replace(/[/\\.]/g, "\\$&")));

  const row = await briefRow(res.briefId!);
  assert.equal(row.trigger, "manual");
  assert.equal(row.mode, "full");
  assert.equal(row.runId, res.runId);
  const data = BriefData.parse(row.data);
  assert.match(data.generatedAt, /[-+]\d\d:\d\d$/);
  assert.deepEqual(data.items.map((i) => i.ref), ["ZIG-3", "WRK-I14 · #45"], "blocker first; FIL-9 is Done so it is dropped");
  assert.deepEqual(data.ideas.map((i) => i.code), ["W1", "Z1"]);
});

test("check 1: two runs with the same ref and title keep the item id (and a check on it keeps matching)", async () => {
  const a = await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: fakeSpawn().spawnPass }));
  const changed = { items: ITEMS.items.map((i) => ({ ...i, detail: "New words today.", title: i.title.toUpperCase() })) };
  const b = await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: fakeSpawn((p) => (p === "brief" ? ok(changed, p) : ok(IDEAS, p))).spawnPass }));
  const ids = async (id: string) => (await briefRow(id)).data.items.map((i) => i.id).sort();
  assert.deepEqual(await ids(a.briefId!), await ids(b.briefId!));
  assert.ok((await ids(b.briefId!)).includes(itemId("workia", "WRK-I14 · #45", "Release sandbox to main")));
});

test("check 4: a second trigger while one runs gets BRIEF_RUNNING with the run id; after it ends a new one starts", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const f = fakeSpawn(async (pass) => {
    if (pass === "brief") await gate;
    return pass === "brief" ? ok(ITEMS, pass) : ok(IDEAS, pass);
  });
  const first = await pipeline.startBrief(db, { trigger: "schedule" }, deps({ spawnPass: f.spawnPass }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await runRow(first.runId)).status, "running");

  await assert.rejects(pipeline.startBrief(db, { trigger: "manual" }, deps({ spawnPass: fakeSpawn().spawnPass })), (err: unknown) => {
    assert.ok(err instanceof pipeline.BriefRunningError);
    assert.equal(err.code, "BRIEF_RUNNING");
    assert.equal(err.runId, first.runId);
    return true;
  });
  assert.equal(await store.count("briefRuns", { status: ["waiting", "running"] }), 1, "the refused trigger wrote no row");

  release();
  assert.equal((await first.done).status, "ok");
  const again = await pipeline.runBrief(db, { trigger: "cli" }, deps({ spawnPass: fakeSpawn().spawnPass }));
  assert.equal(again.status, "ok");
});

test("waits with no cutoff while a run is live (status waiting), then runs", async () => {
  let busy = true;
  const f = fakeSpawn();
  const started = await pipeline.startBrief(db, { trigger: "schedule" }, deps({ spawnPass: f.spawnPass, liveRuns: () => (busy ? [{}] : []) }));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal((await runRow(started.runId)).status, "waiting");
  assert.equal(runner.slotReservation()?.label, "morning-brief", "no new run starts meanwhile");
  assert.equal(f.calls.length, 0);
  busy = false;
  assert.equal((await started.done).status, "ok");
  assert.equal(f.calls.length, 2);
});

test("the ceiling signal while waiting stores a facts-only brief (fallback) with one cross item", async () => {
  const ac = new AbortController();
  const f = fakeSpawn();
  const started = await pipeline.startBrief(db, { trigger: "schedule", signal: ac.signal }, deps({ spawnPass: f.spawnPass, liveRuns: () => [{}] }));
  setTimeout(() => ac.abort(), 30);
  const res = await started.done;
  assert.equal(res.status, "fallback");
  assert.equal(res.mode, "facts_only");
  assert.equal(f.calls.length, 0, "no Claude pass");
  const data = BriefData.parse((await briefRow(res.briefId!)).data);
  const cross = data.items.filter((i) => i.app === "cross");
  assert.equal(cross.length, 1);
  assert.match(cross[0]!.detail!, /didn't run by 11:00 because a build was still running.*Corren 4 proyectos/);
  assert.match((await runRow(res.runId)).summary, /^facts only/);
});

test("no read token -> facts only, pass B is not tried", async () => {
  const f = fakeSpawn((pass) => (pass === "brief" ? fail("no_token", "Add PLANIA_BRIEF_TOKEN (read scope) to .env") : ok(IDEAS, pass)));
  const res = await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: f.spawnPass }));
  assert.equal(res.status, "fallback");
  assert.deepEqual(f.calls.map((c) => c.pass), ["brief"]);
  const data = BriefData.parse((await briefRow(res.briefId!)).data);
  assert.ok(data.items.some((i) => i.app === "cross" && /PLANIA_BRIEF_TOKEN/.test(i.detail ?? "")));
  assert.equal((await runRow(res.runId)).passes.brief!.status, "no_token");
});

test("check 3: pass B failed -> partial, ideas never empty (open Plania ideas)", async () => {
  const f = fakeSpawn((pass) => (pass === "brief" ? ok(ITEMS, pass) : fail("timeout", "pass ideas timed out")));
  const res = await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: f.spawnPass }));
  assert.equal(res.status, "partial");
  const data = BriefData.parse((await briefRow(res.briefId!)).data);
  assert.ok(data.ideas.length >= 1);
  assert.ok(data.ideas.some((i) => i.title === "Quote templates" && i.code === "Z1" && i.source === "Plania"));
  assert.equal(data.items.filter((i) => i.app === "cross").length, 1);
});

test("check 5: the Brief de hoy projection is an asistente.brief event (up to 5 lines) and GET /api/company shows it", async () => {
  const many = {
    items: [
      { app: "zigzag", status: "blocker", ref: "ZIG-1", title: "Prod is down" },
      ...[1, 2, 3, 4, 5].map((n) => ({ app: "workia", status: "needs_you", ref: `WRK-${n}`, title: `Need ${n}` })),
      { app: "workia", status: "next", ref: "WRK-9", title: "Later" },
    ],
  };
  const res = await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: fakeSpawn((p) => (p === "brief" ? ok(many, p) : ok(IDEAS, p))).spawnPass }));
  const [e] = await store.find("events", { type: "asistente.brief" }, { orderBy: [{ column: "id", desc: true }], limit: 1 });
  const ev = { slug: (await store.get("projects", { id: e!.projectId }))!.slug, payload: e!.payload as { source: string; brief_id: string; link: string; lines: string[]; generated_at: string } };
  assert.equal(ev.slug, "workia", "home project");
  assert.equal(ev.payload.source, "morning_brief");
  assert.equal(ev.payload.brief_id, res.briefId);
  assert.equal(ev.payload.link, "/brief");
  assert.deepEqual(ev.payload.lines, ["Zigzag: Prod is down", "Workia: Need 1", "Workia: Need 2", "Workia: Need 3", "Workia: Need 4"]);
  assert.equal(await store.count("agentRuns"), 0, "0 tokens: no Claude run queued");

  const http = await app.request("/api/company", { headers: { Cookie: `${SESSION_COOKIE}=${createSession()}` } });
  assert.equal(http.status, 200);
  const body = (await http.json()) as Record<string, unknown>;
  assert.ok(body.company && Array.isArray(body.projects), "the Compañía read keeps its shape");
  // PLA-I42-5: GET /api/company carries Brief de hoy (the event's lines, up to 5) and the link to /brief.
  assert.deepEqual(body.brief, { lines: ev.payload.lines, generated_at: ev.payload.generated_at, link: "/brief" });
  // companyState().brief, via latestBrief(), reads the same event.
  const { latestBrief } = await import("../src/runner/asistente.js");
  const { companyState } = await import("../src/runner/company.js");
  assert.deepEqual(await latestBrief(db), { lines: ev.payload.lines, generated_at: ev.payload.generated_at });
  assert.deepEqual((await companyState(db)).brief?.lines, ev.payload.lines);
});

test("D7: an open Send to Plania target waiting on paused runs gives the 'Turn on runs' item", async () => {
  const b = await newestBrief();
  await store.fix((uow) =>
    uow.insert("briefPlanRequests", { briefId: b.id, codes: ["Z3"], ideas: [], targets: [{ slug: "zigzag", po_agent: "po-zigzag", codes: ["Z3"], state: "waiting_paused", results: [] }] }),
  );
  const res = await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: fakeSpawn().spawnPass }));
  const data = BriefData.parse((await briefRow(res.briefId!)).data);
  assert.ok(data.items.some((i) => i.app === "zigzag" && i.status === "needs_you" && i.title === "Turn on runs for Zigzag to plan Z3"));

  await store.fix((uow) => uow.update("projects", { slug: "zigzag" }, { runsPaused: false }));
  const res2 = await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: fakeSpawn().spawnPass }));
  assert.ok(!BriefData.parse((await briefRow(res2.briefId!)).data).items.some((i) => /Turn on runs/.test(i.title)), "gone once runs are on");
  await store.fix(async (uow) => {
    await uow.update("projects", { slug: "zigzag" }, { runsPaused: true });
    await uow.delete("briefPlanRequests", {});
  });
});

test("stale rows: a running row older than the pass timeouts + 5 min is marked fail; with the lock free, any leftover is", async () => {
  const run = (status: "running" | "waiting", startedAt: Date) => store.fix(async (uow) => (await uow.insert("briefRuns", { trigger: "schedule", status, startedAt })).id);
  const old = await run("running", new Date(Date.now() - 2 * HOUR));
  const fresh = await run("waiting", new Date());
  assert.equal(await pipeline.markStaleRuns(db), 2, "nobody holds the lock: both are leftovers");
  for (const id of [old, fresh]) {
    const r = await runRow(id);
    assert.equal(r.status, "fail");
    assert.match(r.summary, /stale/);
  }

  // While a run holds the lock only the old running row counts.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const live = await pipeline.startBrief(db, { trigger: "manual" }, deps({ spawnPass: fakeSpawn(async (p) => (await gate, p === "brief" ? ok(ITEMS, p) : ok(IDEAS, p))).spawnPass }));
  await new Promise((r) => setTimeout(r, 50));
  const hung = await run("running", new Date(Date.now() - 2 * HOUR));
  assert.equal(await pipeline.markStaleRuns(db), 1);
  assert.equal((await runRow(hung)).status, "fail");
  assert.equal((await runRow(live.runId)).status, "running");
  release();
  assert.equal((await live.done).status, "ok");
});

test("a crash in the run is stored as fail, frees the lock and the slot", async () => {
  const res = await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: fakeSpawn(() => { throw new Error(`boom in ${scratch}/x`); }).spawnPass }));
  assert.equal(res.status, "fail");
  const r = await runRow(res.runId);
  assert.equal(r.status, "fail");
  assert.match(r.summary, /^fail: boom/);
  assert.equal(runner.slotReservation(), null);
  assert.equal((await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: fakeSpawn().spawnPass }))).status, "ok");
});

test("checks unseen in any brief for 30 days are pruned; seen or recent ones stay", async () => {
  const latest = (await newestBrief()).data as { items: Listed[]; ideas: Listed[] };
  const seenId = latest.items[0]!.id;
  const seenIdea = latest.ideas[0]!.id;
  const longAgo = new Date(Date.now() - 40 * DAY);
  await store.fix(async (uow) => {
    await uow.delete("briefChecks", {});
    await uow.insert("briefChecks", { itemId: seenId, checkedAt: longAgo });
    await uow.insert("briefChecks", { itemId: seenIdea, checkedAt: longAgo });
    await uow.insert("briefChecks", { itemId: "i|gone|000000000000", checkedAt: longAgo });
    await uow.insert("briefChecks", { itemId: "i|new|000000000000", checkedAt: new Date() });
  });
  assert.equal(await pipeline.pruneChecks(db), 1);
  const left = (await store.find("briefChecks")).map((r) => r.itemId);
  assert.deepEqual(left.sort(), [seenId, seenIdea, "i|new|000000000000"].sort());
});

test("isoInZone writes the zone's offset", () => {
  assert.equal(pipeline.isoInZone(new Date("2026-11-13T13:04:12.900Z"), "America/Mexico_City"), "2026-11-13T07:04:12-06:00");
  assert.equal(pipeline.isoInZone(new Date("2026-07-01T00:30:00Z"), "Asia/Kolkata"), "2026-07-01T06:00:00+05:30");
  assert.equal(pipeline.localDateIn(new Date("2026-11-14T03:00:00Z"), "America/Mexico_City"), "2026-11-13");
});

// ---- PLA-33: a run where Claude cannot sign in must not replace the day's brief

const SIGN_IN = "Failed to authenticate: OAuth session expired and could not be refreshed";
const signedOut = () => fakeSpawn(() => fail("auth", SIGN_IN));
const cookieHeader = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
const latest = async () => (await (await app.request("/api/brief/latest", { headers: cookieHeader() })).json()) as { brief: { id: string; mode: string }; last_run: { kind: string; reason: string; ended_at: string } | null };
const briefCount = () => store.count("morningBriefs");
const deleteBriefs = () => store.fix((uow) => uow.delete("morningBriefs", {}));

test("PLA-33 check 1: both passes fail to sign in while today has a full brief: no new row, /latest keeps it and carries the reason", async () => {
  await deleteBriefs();
  const good = await pipeline.runBrief(db, { trigger: "schedule" }, deps({ spawnPass: fakeSpawn().spawnPass }));
  assert.equal(good.mode, "full");
  const before = await briefCount();
  const f = signedOut();
  const res = await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: f.spawnPass }));
  assert.equal(res.status, "fail");
  assert.equal(res.briefId, null);
  assert.deepEqual(f.calls.map((c) => c.pass), ["brief"], "pass B is not tried");
  assert.equal(await briefCount(), before, "no new morning_briefs row");
  const run = await runRow(res.runId);
  assert.equal(run.status, "fail");
  assert.match(run.summary, /OAuth session expired/);
  assert.doesNotMatch(run.summary, /failed: success/);
  const l = await latest();
  assert.equal(l.brief.id, good.briefId, "the 07:00 brief is still the latest");
  assert.equal(l.last_run?.kind, "auth");
  assert.match(l.last_run!.reason, /OAuth session expired/);
});

test("PLA-33 check 2: the same failure with no brief today stores a facts-only brief naming the sign-in reason and the fix", async () => {
  await deleteBriefs();
  const res = await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: signedOut().spawnPass }));
  assert.equal(res.status, "fallback");
  assert.equal(res.mode, "facts_only");
  const data = BriefData.parse((await briefRow(res.briefId!)).data);
  const cross = data.items.find((i) => i.app === "cross" && i.status === "needs_you")!;
  assert.match(`${cross.title} ${cross.detail}`, /OAuth session expired/);
  assert.match(cross.detail!, /\/login/);
  assert.match(res.summary, /sign-in:.*OAuth session expired/);
  assert.doesNotMatch(res.summary, /failed: success/);
});

test("PLA-33 check 4: a same-day rerun whose ideas pass fails keeps the morning's ideas nobody acted on", async () => {
  await deleteBriefs();
  const morning = await pipeline.runBrief(db, { trigger: "schedule" }, deps({ spawnPass: fakeSpawn().spawnPass }));
  const morningTitles = (await briefRow(morning.briefId!)).data.ideas.map((i) => i.title).sort();
  assert.deepEqual(morningTitles, ["Late-payer flag", "Renewal board"]);
  const rerun = await pipeline.runBrief(db, { trigger: "manual" }, deps({ spawnPass: fakeSpawn((p) => (p === "brief" ? ok(ITEMS, p) : fail("error", "pass ideas failed: boom"))).spawnPass }));
  assert.equal(rerun.mode, "partial");
  const titles = (await briefRow(rerun.briefId!)).data.ideas.map((i) => i.title);
  assert.ok(titles.includes("Renewal board") && titles.includes("Late-payer flag"), `kept: ${titles.join(", ")}`);
});
