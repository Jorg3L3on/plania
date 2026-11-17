// PLA-I49-6: an idea card's five fates through POST /api/brief/act (keep, discard, research, sketch, plan), the idea
// records they make, Ideas in motion in GET state, discards in the next ideas prompt, and the merge that leaves acted
// ideas out and drops one seen three times. Throwaway test store; no claude, no real repo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_TZ = "America/Mexico_City";
process.env.PLANIA_HOME_PROJECT = "workia";
process.env.PLANIA_PROMPTS_PROJECT = "workia";
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { saveBriefSettings, briefProjects, DEFAULT_SETTINGS, resolveBriefSettings } = await import("../src/brief/settings.js");
const { setProjectPaused } = await import("../src/runner/company.js");
const P = await import("../src/brief/prompts.js");
const { mergeBrief } = await import("../src/brief/merge.js");
const { actedIdeaIds } = await import("../src/brief/ideas.js");

type Json = Record<string, any>;
let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
const cookie = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
let n = 0;
const rid = () => `idea-${Date.now()}-${(n += 1)}`;
let briefId = "";
const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));
const idea = (code: string) => sample.ideas.find((i: Json) => i.code === code);
async function act(item: string, action: string, extra: Json = {}) {
  const res = await app.request("/api/brief/act", { method: "POST", headers: cookie(), body: JSON.stringify({ brief_id: briefId, item_id: item, action, request_id: rid(), ...extra }) });
  return { http: res.status, body: (await res.json()) as Json };
}
const state = async () => (await (await app.request(`/api/brief/${briefId}/state`, { headers: cookie() })).json()) as Json;
const runsOf = async (agent: string) => (await store.find("agentRuns", { agentId: (await store.get("agents", { slug: agent }))!.id })).map((r) => ({ status: r.status, task_key: r.taskKey }));
const task = async (key: string) => (await store.get("tasks", { key }))!;
const ideaTask = async (title: string) => (await store.get("tasks", { kind: "idea", title }))!;

before(async () => {
  store = await resetTestStore();
  ({ db } = makeDb());
  await seedOrg(db);
  await saveBriefSettings(db, { github_mode: "off" });
  await store.fix(async (uow) => {
    await uow.update("projects", {}, { runsPaused: false });
    await uow.update("projects", { slug: "micasa" }, { runsPaused: true });
  });
  const data = { ...sample, version: 2 };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  briefId = (await store.fix((uow) => uow.insert("morningBriefs", { localDate: today, generatedAt: uow.now, trigger: "manual", mode: "full", data }))).id;
});

after(async () => {
  await store?.end();
});

test("check 2: Keep makes one Open idea (stage idea) with an Idea doc that has Problem, Who it is for, Why now; twice makes one", async () => {
  const w1 = idea("W1");
  const a = await act(w1.id, "keep");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  const key = a.body.state.line.match(/WRK-IDEA\d+/)?.[0];
  assert.ok(key, a.body.state.line);
  const t = await task(key);
  assert.deepEqual([t.kind, t.status, t.stage, t.title], ["idea", "Open", "idea", w1.title]);
  const d = (await store.get("docs", { taskId: t.id, title: "Idea" }))!;
  for (const h of ["Problem", "Who it is for", "Why now"]) assert.match(d.markdown, new RegExp(`^## ${h}$`, "m"), h);
  const again = await act(w1.id, "keep");
  assert.equal(again.body.status, "stale");
  assert.equal(await store.count("tasks", { kind: "idea", title: w1.title }), 1);
  const s = await state();
  assert.equal(s.ideas[w1.id].state, "kept");
  assert.equal(s.ideas[w1.id].key, key);
});

test("Research: the idea is kept and moves to stage research; the project's Research is woken", async () => {
  const f1 = idea("F1");
  const a = await act(f1.id, "research");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  const key = a.body.line.match(/FIL-IDEA\d+/)?.[0];
  assert.equal((await task(key)).stage, "research");
  assert.deepEqual((await runsOf("research-filmia")).map((r) => [r.status, r.task_key]), [["queued", key]]);
  assert.equal((await state()).ideas[f1.id].state, "research");
});

test("check 4: Sketch on a paused project waits, and wakes Artist once when runs resume", async () => {
  const m1 = idea("M1");
  const a = await act(m1.id, "sketch");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  const sketch = (await store.get("tasks", { title: `Sketch: ${m1.title}` }))!;
  const t = { key: sketch.key, status: sketch.status, origin: sketch.origin, slug: (await store.get("agents", { id: sketch.ownerAgent! }))!.slug };
  assert.deepEqual([t.status, t.origin, t.slug], ["Ready", "jorge", "artist-micasa"]);
  const ideaKey = a.body.line ? await ideaTask(m1.title) : null;
  assert.equal(ideaKey!.stage, "idea", "a sketch does not move the idea's stage");
  assert.equal((await runsOf("artist-micasa")).length, 0, "paused: no wake");
  await setProjectPaused(db, "micasa", false);
  assert.deepEqual((await runsOf("artist-micasa")).map((r) => [r.status, r.task_key]), [["queued", t.key]], "resumed: Artist wakes once");
  await setProjectPaused(db, "micasa", true);
  await setProjectPaused(db, "micasa", false);
  assert.equal((await runsOf("artist-micasa")).length, 1, "a second resume while it is queued does not wake it twice");
});

test("Discard: one tap and a reason chip; a kept idea closes as Won't do; Undo opens it again", async () => {
  assert.equal((await act(idea("Z2").id, "discard")).http, 400, "a reason is needed");
  assert.equal((await act(idea("Z2").id, "discard", { input: { reason: "maybe" } })).http, 400);
  const d = await act(idea("Z2").id, "discard", { input: { reason: "not_now" } });
  assert.equal(d.body.status, "done");
  assert.equal((await state()).ideas[idea("Z2").id].state, "discarded");
  // W1 was kept: discarding a card that has a record closes it, and Undo reopens it.
  const w1 = idea("W1");
  const s0 = await state();
  const key = s0.ideas[w1.id].key;
  // A kept card can still be discarded (keep is not a final fate).
  const x = await act(w1.id, "discard", { input: { reason: "exists" } });
  assert.equal(x.body.status, "done", JSON.stringify(x.body));
  assert.equal((await task(key)).status, "Won't do");
  const u = await app.request(`/api/brief/act/${x.body.action_id}/undo`, { method: "POST", headers: cookie() });
  assert.equal(u.status, 200, await u.clone().text());
  assert.equal((await task(key)).status, "Open");
});

test("check 3: a discarded idea's title and reason are in the next ideas prompt", async () => {
  const VARS = {
    ownerName: "the owner",
    language: "en",
    timezone: "America/Mexico_City",
    timezoneLabel: "CDMX",
    hiddenRefs: [],
    projects: [{ id: "workia", name: "Workia", keyPrefix: "WRK", repoPath: null, githubRepo: null }],
    localDate: "2026-11-14",
    windowStart: "2026-11-13T18:00:00-06:00",
    windowEnd: "2026-11-14T07:00:00-06:00",
    factsPath: "/tmp/facts.json",
    maxItemsPerApp: 5,
    ideasPerProject: 3,
  };
  const p = await P.loadPassPrompts(db, "ideas", VARS as never, process.env);
  assert.match(p.prompt, new RegExp(`zigzag: ${idea("Z2").title} \\(not now\\)`));
  assert.doesNotMatch(p.prompt, /\{\{DISCARDED\}\}/);
});

test("Plan (Give to PO): Send to Plania, as before", async () => {
  const z1 = idea("Z1");
  await store.fix((uow) => uow.update("projects", { slug: "zigzag" }, { runsPaused: false }));
  const a = await act(z1.id, "plan");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.equal(await store.count("briefPlanRequests", { briefId }), 1);
  assert.equal((await state()).ideas[z1.id].state, "planned");
});

test("check 7: an idea acted on yesterday is in Ideas in motion today and not in Today's ideas; one seen 3 times is dropped", async () => {
  const acted = await actedIdeaIds(db);
  assert.ok(acted.has(idea("W1").id) && acted.has(idea("F1").id));
  const stored = { ...structuredClone(DEFAULT_SETTINGS), projects: { workia: { order: 0 }, zigzag: { order: 1 }, filmia: { order: 2 }, micasa: { order: 3 } } };
  const PROJ = [
    { id: "1", slug: "workia", title: "Workia", keyPrefix: "WRK" },
    { id: "2", slug: "zigzag", title: "ZigZag", keyPrefix: "ZIG" },
    { id: "3", slug: "filmia", title: "Filmia", keyPrefix: "FIL" },
    { id: "4", slug: "micasa", title: "MiCasa", keyPrefix: "MIC" },
  ];
  // Pass B proposes yesterday's ideas again, plus one new one; F2 was shown in 3 briefs already.
  const passIdeas = [...sample.ideas.map((i: Json) => ({ app: i.app, title: i.title, why: i.why })), { app: "workia", title: "Shift swap requests v2", why: "New." }];
  const data = mergeBrief({
    settings: resolveBriefSettings(stored as never, { PLANIA_TZ: "America/Mexico_City" }),
    projects: briefProjects(PROJ, stored as never),
    facts: { projects: [], source_errors: [] },
    generatedAt: "2026-11-15T07:04:12-06:00",
    window: { from: "2026-11-14T18:00:00-06:00", to: "2026-11-15T07:04:12-06:00" },
    brief: { ok: true, data: { items: [] } },
    ideas: { ok: true, data: { ideas: passIdeas } },
    actedIdeas: acted,
    ideaSeen: new Map([[idea("F2").id, 3], [idea("X1").id, 2]]),
  });
  const titles = data.ideas.map((i) => i.title);
  for (const c of ["W1", "Z2", "F1", "M1", "Z1"]) assert.ok(!titles.includes(idea(c).title), `${c} was acted on`);
  assert.ok(!titles.includes(idea("F2").title), "seen in 3 briefs: dropped");
  assert.equal(data.ideas.find((i) => i.title === idea("X1").title)?.seen, 2, "seen 2 days: marked");
  assert.ok(titles.includes("Shift swap requests v2"));
  // And today's state lists the kept and researched ideas in motion (GET state of a brief that does not show them).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const id2 = (await store.fix((uow) => uow.insert("morningBriefs", { localDate: today, generatedAt: new Date(uow.now.getTime() + 60_000), trigger: "manual", mode: "full", data: data as unknown as Record<string, unknown> }))).id;
  const s = (await (await app.request(`/api/brief/${id2}/state`, { headers: cookie() })).json()) as Json;
  const moving = s.in_motion.map((m: Json) => m.title);
  assert.ok(moving.includes(idea("F1").title), "F1 (research) is in motion");
  assert.ok(moving.includes(idea("M1").title), "M1 (sketch) is in motion");
  assert.equal(s.in_motion.find((m: Json) => m.title === idea("F1").title).stage, "research");
});

test("a sketch that came back makes a Needs you row about the idea in the next brief, with Discard", async () => {
  const m = await ideaTask(idea("M1").title);
  await store.fix((uow) => uow.insert("docs", { projectId: m.projectId, taskId: m.id, title: "Sketch", markdown: "Canvas: https://claude.ai/artifact/demo-sketch", actor: { agent: "artist-micasa", session_id: "s" } }));
  const promote = (to: string | null) => store.fix((uow) => uow.update("tasks", { id: m.id }, { promotedTo: to }));
  const { ideasInMotion } = await import("../src/brief/ideas.js");
  const ready = await ideasInMotion(db, ["micasa"]);
  const r = ready.find((x) => x.key === m.key)!;
  assert.equal(r.next, "sketch_ready");
  assert.equal(r.doc_url, "https://claude.ai/artifact/demo-sketch");
  // PLA-I51-4: promoted_to is null while the idea is open work, and the initiative's key once it is planned.
  assert.equal(r.promoted_to, null);
  await promote("MIC-I99");
  const planned = (await ideasInMotion(db, ["micasa"])).find((x) => x.key === m.key)!;
  assert.equal(planned.promoted_to, "MIC-I99");
  assert.equal(planned.next, "planned");
  await promote(null);
  const stored = { ...structuredClone(DEFAULT_SETTINGS), language: "en", projects: { micasa: { order: 0 } } };
  const data = mergeBrief({
    settings: resolveBriefSettings(stored as never, { PLANIA_TZ: "America/Mexico_City" }),
    projects: briefProjects([{ id: "4", slug: "micasa", title: "MiCasa", keyPrefix: "MIC" }], stored as never),
    facts: { projects: [], source_errors: [] },
    generatedAt: "2026-11-15T07:04:12-06:00",
    window: { from: "2026-11-14T18:00:00-06:00", to: "2026-11-15T07:04:12-06:00" },
    brief: { ok: true, data: { items: [] } },
    ideas: null,
    ideasReady: ready,
  });
  const row = data.items.find((i) => i.title.startsWith("Look at the sketch"))!;
  assert.ok(row);
  assert.deepEqual(row.targets, [{ kind: "idea", project: "micasa", key: m.key }]);
  assert.equal(row.url, "https://claude.ai/artifact/demo-sketch");
});
