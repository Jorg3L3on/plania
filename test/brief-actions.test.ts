// PLA-I49-3: the brief's action registry, POST /api/brief/act, /act/:id/undo and GET /api/brief/:id/state, through
// the app with the session cookie. Throwaway test store; gh is faked through releaseGh.run and the GitHub poller gets
// a fake fetch, so no real gh or GitHub call runs and no live store is touched.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { TEST_BEARER, resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
process.env.PLANIA_TZ = "America/Mexico_City";
process.env.PLANIA_HOME_PROJECT = "workia";
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const { pollGithubProject } = await import("../src/jobs/github.js");
const { releaseGh } = await import("../src/mcp/release-ship.js");
const { saveBriefSettings } = await import("../src/brief/settings.js");
const { setAsideItems } = await import("../src/brief/act.js");
const { REGISTRY, ACTION_IDS } = await import("../src/brief/actions.js");
const { BriefData } = await import("../src/brief/types.js");

type Json = Record<string, any>;
let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
const ctx = { actor: { agent: "po-workia", session_id: "s-po", machine: "ci" } };
const realGh = releaseGh.run;
const REPO = "Jorg3L3on/zigzag";
const SANDBOX = "5aaaaaa111111111111111111111111111111111";
const MAIN = "0bbbbbb222222222222222222222222222222222";
const MERGE = "7ccccccc33333333333333333333333333333333";

const cookie = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
let n = 0;
const rid = () => `req-${Date.now()}-${(n += 1)}`;
const post = (path: string, body: unknown, headers: Record<string, string> = cookie()) => app.request(`/api/brief${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const get = async (path: string) => (await app.request(`/api/brief${path}`, { headers: cookie() })).json() as Promise<Json>;
async function act(item: string, action: string, extra: Json = {}) {
  const res = await post("/act", { brief_id: briefId, item_id: item, action, request_id: rid(), ...extra });
  return { http: res.status, body: (await res.json()) as Json };
}
const state = async () => (await get(`/${briefId}/state`)) as { read_only: boolean; items: Record<string, Json> };
const events = async (type = "brief.action") => {
  const slugOf = new Map((await store.find("projects")).map((p) => [p.id, p.slug]));
  return (await store.find("events", { type }, { orderBy: [{ column: "id" }] })).map((e) => ({ payload: e.payload as Json, slug: slugOf.get(e.projectId)!, actor: e.actor }));
};
// A workia task by key, and its status.
const workiaTask = async (key: string) => (await store.get("tasks", { projectId: await store.projectId("workia"), key }))!;
const statusOf = async (key: string) => (await store.get("tasks", { key }))!.status;

// gh stub: merges and the release ship succeed; every call is recorded.
let calls: string[][] = [];
function stubGh() {
  releaseGh.run = async (args) => {
    calls.push(args);
    const [, verb] = args;
    if (args[0] === "pr" && verb === "view" && args.includes("baseRefName,state,headRefOid,url")) return { ok: true, stdout: JSON.stringify({ baseRefName: "sandbox", state: "OPEN", headRefOid: "abc", url: "https://github.com/Jorg3L3on/workia/pull/78" }), stderr: "" };
    if (args[0] === "pr" && verb === "view" && args.includes("headRefName,baseRefName,state,url")) return { ok: true, stdout: JSON.stringify({ headRefName: "jl/pr-80", baseRefName: "sandbox", state: "OPEN", url: "https://github.com/Jorg3L3on/workia/pull/80" }), stderr: "" };
    if (args[0] === "api" && args.includes("PUT")) return { ok: true, stdout: JSON.stringify({ commit: { sha: "f11e5a1e0000" } }), stderr: "" };
    if (args[0] === "api") return { ok: false, stdout: "", stderr: "HTTP 404: Not Found" };
    if (verb === "list") return { ok: true, stdout: "[]", stderr: "" };
    if (verb === "create") return { ok: true, stdout: `https://github.com/${REPO}/pull/700\n`, stderr: "" };
    if (verb === "view") return { ok: true, stdout: JSON.stringify({ mergeCommit: { oid: MERGE }, url: `https://github.com/${REPO}/pull/700` }), stderr: "" };
    return { ok: true, stdout: "", stderr: "" };
  };
}

// The GitHub poller's fake, for zigzag's release compare (sandbox 2 ahead of main).
const fetch = async (url: string) => {
  const path = url.replace(/^https:\/\/api\.github\.com/, "");
  const ok = (data: unknown) => ({ status: 200, headers: { get: () => null }, json: async () => data });
  if (path.startsWith(`/repos/${REPO}/pulls?`)) return ok([]);
  if (path.startsWith(`/repos/${REPO}/branches`)) return ok([{ name: "sandbox", commit: { sha: SANDBOX } }, { name: "main", commit: { sha: MAIN } }]);
  // main...sandbox is the release compare; merge...main (PLA-I56-1, does main contain a merge) is behind: the merges
  // are on sandbox only.
  if (path.startsWith(`/repos/${REPO}/compare/${MAIN}...`)) return ok({ status: "ahead", ahead_by: 2, commits: [{ sha: "c1c1c1c1" }, { sha: SANDBOX }] });
  if (path.startsWith(`/repos/${REPO}/compare/`)) return ok({ status: "behind", ahead_by: 0, behind_by: 2, commits: [] });
  return { status: 404, headers: { get: () => null }, json: async () => ({}) };
};

const ids: Record<string, string> = {};
let briefId = "";
const T = {
  question: "i|workia|000000000001",
  step: "i|workia|000000000002",
  postpone: "i|workia|000000000003",
  first: "i|workia|000000000004",
  hold: "i|workia|000000000005",
  runs: "i|micasa|000000000006",
  prOps: "i|workia|000000000007",
  prCode: "i|workia|000000000008",
  changes: "i|workia|000000000009",
  release: "i|zigzag|000000000010",
  releaseNo: "i|workia|000000000011",
  finding: "i|workia|000000000012",
  plain: "i|cross|000000000013",
  inbox: "i|workia|000000000014",
  file: "i|workia|000000000015",
};

async function delivery(key: string, number: number, workType: string): Promise<void> {
  const p = await findProject(db, "workia");
  const t = (await createTask(db, { project: "workia", title: `Delivery ${key}`, scope: "s", checks: ["c"], work_type: workType } as never, ctx)) as { key: string };
  ids[key] = t.key;
  const url = `https://github.com/Jorg3L3on/workia/pull/${number}`;
  await store.fix(async (uow) => {
    const [task] = await uow.update("tasks", { key: t.key, projectId: p.id }, { status: "In review", prUrl: url });
    await uow.update("checks", { taskId: task!.id }, { done: true, doneAt: uow.now });
    await uow.insert("pullRequests", { projectId: p.id, repo: "Jorg3L3on/workia", number, url, title: `PR ${number}`, taskId: task!.id, state: "open", headBranch: `jl/pr-${number}`, baseBranch: "sandbox" });
    const th = (await uow.get("threads", { kind: "project", projectId: p.id })) ?? (await uow.insert("threads", { kind: "project", projectId: p.id }));
    await uow.insert("threadMessages", { threadId: th.id, authorAgent: "taller-workia", authorRole: "taller", body: `${t.key} ready`, links: [{ kind: "ticket", ref: t.key, title: "x" }, { kind: "pr", ref: url, title: "PR" }] });
  });
}

before(async () => {
  store = await resetTestStore();
  ({ db } = makeDb());
  await saveBriefSettings(db, { github_mode: "off" });
  const w = await findProject(db, "workia");

  // Workia: a question, a human step, two Ready tickets, an initiative, two deliveries and an audit finding.
  const q = (await createTask(db, { project: "workia", title: "Pricing", scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string };
  ids.q = q.key;
  const qTask = await workiaTask(q.key);
  const question = (text: string, options: string[]) => store.fix(async (uow) => (await uow.insert("questions", { projectId: w.id, taskId: qTask.id, question: text, options, askedBy: ctx.actor })).id);
  ids.question = await question("Monthly or yearly?", ["monthly", "yearly"]);
  ids.question2 = await question("Which logo?", ["a", "b"]);
  const s = (await createTask(db, { project: "workia", title: "Legal", scope: "s", checks: ["c"], status: "Ready", blocked_by: [{ human_action: { text: "Sign the contract" } }] } as never, ctx)) as { key: string };
  ids.s = s.key;
  ids.step = (await store.get("blockers", { type: "human_action" }))!.id;
  const fs = (await createTask(db, { project: "workia", title: "Env example", scope: "s", checks: ["c"], status: "Ready", blocked_by: [{ human_action: { text: "Add the key to .env.example", file: { path: ".env.example", append: "PAY_KEY=" } } }] } as never, ctx)) as { key: string };
  const fsTask = (await store.fix((uow) => uow.update("tasks", { key: fs.key, projectId: w.id }, { prUrl: "https://github.com/Jorg3L3on/workia/pull/80" })))[0]!;
  ids.fileStep = (await store.get("blockers", { taskId: fsTask.id }))!.id;
  ids.r1 = ((await createTask(db, { project: "workia", title: "Renewals", scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string }).key;
  ids.r2 = ((await createTask(db, { project: "workia", title: "Exports", scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string }).key;
  ids.ini = ((await createTask(db, { project: "workia", kind: "initiative", title: "Payroll", scope: "PRD" } as never, ctx)) as { key: string }).key;
  await delivery("ops", 77, "ops");
  await delivery("code", 78, "code");
  await delivery("chg", 79, "code");
  await store.fix(async (uow) => {
    await uow.insert("auditRuns", { projectId: w.id, at: uow.now, count: 1, findings: [{ code: "ENV_DEPLOYED_AT_MISSING", key: null, id: "prod", detail: "prod has no deployed_at", fix_hint: "set_env" }] });
    await uow.insert("envStates", { projectId: w.id, env: "prod", commit: "abcdef1", by: ctx.actor, updatedAt: uow.now });
    await uow.update("projects", {}, { runsPaused: false });
    await uow.update("projects", { slug: "micasa" }, { runsPaused: true });
  });
  await setProject(db, { project: "workia", version: (await findProject(db, "workia")).version, settings: { release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } } }, { actor: { agent: "t", session_id: "s1" } });

  // Zigzag: a release ready to publish (mode merge, two merged tickets, the poller's compare).
  const z = await findProject(db, "zigzag");
  await setProject(db, { project: "zigzag", version: z.version, settings: { github: { repo: REPO }, release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } } }, { actor: { agent: "t", session_id: "s1" } });
  for (const [title, number] of [["Badge", 600], ["Actions", 601]] as const) {
    const t = (await createTask(db, { project: "zigzag", title, scope: "s", checks: ["c"], status: "Ready" } as never, ctx)) as { key: string };
    const url = `https://github.com/${REPO}/pull/${number}`;
    const sha = `${number}`.padEnd(40, "e");
    await store.fix(async (uow) => {
      const [task] = await uow.update("tasks", { key: t.key }, { status: "Merged", prUrl: url });
      await uow.insert("pullRequests", { projectId: z.id, repo: REPO, number, url, title, taskId: task!.id, state: "merged", headSha: sha, headBranch: `jl/${t.key.toLowerCase()}`, baseBranch: "sandbox", mergedAt: uow.now, mergeSha: sha });
    });
  }
  await store.fix(async (uow) => {
    const zTasks = await uow.find("tasks", { projectId: z.id });
    await uow.update("checks", { taskId: zTasks.map((t) => t.id) }, { done: true, doneAt: uow.now });
  });
  await pollGithubProject(db, await findProject(db, "zigzag"), { fetch, env: { GITHUB_TOKEN: "ghp_test" } });

  // Today's brief, v2, one row per kind.
  const row = (status: string, id: string, app: string, title: string, targets: Json[]) => ({ id, app, status, title, ...(targets.length ? { targets } : {}) });
  const data = {
    ...JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8")),
    version: 2,
    items: [
      row("needs_you", T.question, "workia", "Answer: monthly or yearly", [{ kind: "question", project: "workia", id: ids.question, key: ids.q }]),
      row("needs_you", T.step, "workia", "Sign the contract", [{ kind: "step", project: "workia", id: ids.step, key: ids.s }]),
      row("next", T.postpone, "workia", "Start renewals", [{ kind: "ticket", project: "workia", key: ids.r1 }]),
      row("next", T.first, "workia", "Start exports", [{ kind: "ticket", project: "workia", key: ids.r2 }]),
      row("needs_you", T.hold, "workia", "Start building payroll", [{ kind: "initiative", project: "workia", key: ids.ini }]),
      row("needs_you", T.runs, "micasa", "Turn on runs for MiCasa", [{ kind: "runs", project: "micasa" }]),
      row("needs_you", T.prOps, "workia", "Review the ops delivery", [{ kind: "pr", project: "workia", pr: 77, key: ids.ops }]),
      row("needs_you", T.prCode, "workia", "Review the code delivery", [{ kind: "pr", project: "workia", pr: 78, key: ids.code }]),
      row("needs_you", T.changes, "workia", "Review the other delivery", [{ kind: "pr", project: "workia", pr: 79, key: ids.chg }]),
      row("needs_you", T.release, "zigzag", "Publish zigzag", [{ kind: "release", project: "zigzag" }]),
      row("needs_you", T.releaseNo, "workia", "Publish workia", [{ kind: "release", project: "workia" }]),
      row("next", T.finding, "workia", "Fix: prod has no deployed_at", [{ kind: "finding", project: "workia", code: "ENV_DEPLOYED_AT_MISSING" }]),
      row("needs_you", T.plain, "cross", "Close the old PRs", []),
      row("needs_you", T.file, "workia", "Add the key to .env.example", [{ kind: "step", project: "workia", id: ids.fileStep }]),
      row("needs_you", T.inbox, "workia", "Answer: which logo", [{ kind: "question", project: "workia", id: ids.question2, key: ids.q }]),
    ],
  };
  assert.ok(BriefData.safeParse(data).success, JSON.stringify(BriefData.safeParse(data).error?.issues));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  briefId = (await store.fix((uow) => uow.insert("morningBriefs", { localDate: today, generatedAt: new Date(uow.now.getTime() - 60_000), trigger: "manual", mode: "full", data }))).id;
});

beforeEach(() => {
  calls = [];
  stubGh();
});

after(async () => {
  releaseGh.run = realGh;
  await store?.end();
});

test("the registry: every action has a level and an input schema; brief-state actions fit any row", () => {
  for (const id of ACTION_IDS) {
    const a = REGISTRY[id];
    assert.equal(a.id, id);
    assert.ok(["instant", "confirm", "wake"].includes(a.level), id);
  }
  assert.equal(REGISTRY.publish.level, "confirm", "publish to main is confirm");
  assert.equal(REGISTRY.later.applies(null, null), true);
});

test("GET state: each open row lists the actions that fit its object now, main one first, then Later and Not relevant", async () => {
  const s = await state();
  assert.equal(s.read_only, false);
  const ids = (k: string) => s.items[k]!.actions.map((a: Json) => a.id);
  // PLA-I49-5: a paused project's row also offers Turn on runs; none of these projects is paused here.
  assert.deepEqual(ids(T.question), ["answer", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.step), ["step_done", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.postpone), ["postpone", "put_first", "start_now", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.hold), ["hold", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.runs), ["resume_runs", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.prCode), ["accept_pr", "request_changes", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.release), ["publish", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.releaseNo), ["give_to_po", "later", "dismiss"], "a release that is not ready offers no Publish");
  assert.deepEqual(ids(T.finding), ["fix_finding", "give_to_po", "later", "dismiss"]);
  assert.deepEqual(ids(T.plain), ["give_to_po", "later", "dismiss"], "a row with no target still has Give to PO, Later and Not relevant");
  for (const k of Object.values(T)) assert.equal(s.items[k]!.state, "open", k);
  assert.equal((await app.request(`/api/brief/${briefId}/state`)).status, 401, "cookie only");
});

test("answer: picks an option, the question is answered, the row is handled; again is stale", async () => {
  const a = await act(T.question, "answer", { input: { option: 2 } });
  assert.equal(a.http, 200, JSON.stringify(a.body));
  assert.equal(a.body.status, "done");
  assert.equal(a.body.line, "Answered: yearly");
  const answerOf = async () => (await store.get("questions", { id: ids.question! }))!.answer;
  assert.equal(await answerOf(), "yearly");
  assert.equal(a.body.state.state, "handled");
  const again = await act(T.question, "answer", { input: { option: 1 } });
  assert.equal(again.body.status, "stale");
  assert.match(again.body.line, /Answered: yearly/);
  assert.equal(await answerOf(), "yearly");
});

test("check 5: a question answered through the inbox route shows as handled in GET state with no brief action", async () => {
  const res = await app.request(`/api/projects/workia/questions/${ids.question2}/answer`, { method: "POST", headers: cookie(), body: JSON.stringify({ answer: "b" }) });
  assert.equal(res.status, 200, await res.clone().text());
  const s = await state();
  assert.equal(s.items[T.inbox]!.state, "handled");
  assert.equal(s.items[T.inbox]!.line, "Answered: b");
  assert.equal(s.items[T.inbox]!.action_id, null);
  assert.equal(await store.count("briefActions", { itemId: T.inbox }), 0);
});

test("step_done: the human step is resolved; a stale target answers stale", async () => {
  const a = await act(T.step, "step_done", { input: { note: "Signed today" } });
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.notEqual((await store.get("blockers", { id: ids.step! }))!.satisfiedAt, null);
  assert.equal((await act(T.step, "step_done")).body.status, "stale");
});

test("add_to_pr: the file step's lines are committed to the PR and the step resolved; again is stale", async () => {
  assert.deepEqual((await state()).items[T.file]!.actions.map((x: Json) => x.id), ["step_done", "add_to_pr", "give_to_po", "later", "dismiss"]);
  const a = await act(T.file, "add_to_pr");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.match(a.body.line, /Added 1 line to .env.example on jl\/pr-80/);
  assert.ok(calls.some((c) => c[0] === "api" && c.includes("PUT")));
  assert.notEqual((await store.get("blockers", { id: ids.fileStep! }))!.satisfiedAt, null);
  assert.equal((await act(T.file, "add_to_pr")).body.status, "stale");
});

test("postpone and put_first are instant with undo; undo puts the ticket back", async () => {
  const a = await act(T.postpone, "postpone");
  assert.equal(a.body.status, "done");
  assert.equal(a.body.undo, true);
  assert.equal(await statusOf(ids.r1!), "Backlog");
  assert.equal((await act(T.postpone, "postpone")).body.status, "stale", "no longer Ready");
  const u = await post(`/act/${a.body.action_id}/undo`, {});
  assert.equal(u.status, 200, await u.clone().text());
  assert.equal(await statusOf(ids.r1!), "Ready");
  assert.equal((await post(`/act/${a.body.action_id}/undo`, {})).status, 409, "only once");

  const f = await act(T.first, "put_first");
  assert.equal(f.body.status, "done");
  assert.equal((await findProject(db, "workia")).settings.next_first, ids.r2);
  assert.equal((await act(T.first, "put_first")).body.status, "stale", "already first");
  assert.equal((await post(`/act/${f.body.action_id}/undo`, {})).status, 200);
  assert.equal((await findProject(db, "workia")).settings.next_first, undefined);
});

test("hold: the initiative goes On hold; undo puts it back to Planning", async () => {
  const a = await act(T.hold, "hold");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.equal(await statusOf(ids.ini!), "On hold");
  assert.equal((await act(T.hold, "hold")).body.status, "stale");
  assert.equal((await post(`/act/${a.body.action_id}/undo`, {})).status, 200);
  assert.equal(await statusOf(ids.ini!), "Planning");
});

test("resume_runs: the paused project's runs turn on; again is stale (handled)", async () => {
  const a = await act(T.runs, "resume_runs");
  assert.equal(a.body.status, "done");
  assert.equal((await store.get("projects", { slug: "micasa" }))!.runsPaused, false);
  const again = await act(T.runs, "resume_runs");
  assert.equal(again.body.status, "stale");
  assert.equal(again.body.line, "Runs are on");
  await store.fix((uow) => uow.update("projects", { slug: "micasa" }, { runsPaused: true }));
});

test("check 3: accept on a ticket with an open check is refused with the thread route's error and changes nothing", async () => {
  const ops = await workiaTask(ids.ops!);
  await store.fix((uow) => uow.update("checks", { taskId: ops.id }, { done: false, doneAt: null }));
  const a = await act(T.prOps, "accept_pr");
  assert.equal(a.http, 409);
  assert.equal(a.body.status, "failed");
  assert.equal(a.body.error, "CHECKS_OPEN");
  assert.equal((await workiaTask(ids.ops!)).status, "In review");
  assert.equal((await state()).items[T.prOps]!.state, "open", "a failed action leaves the row open");
});

test("accept_pr: a code delivery's PR is merged into sandbox through the thread action", async () => {
  const a = await act(T.prCode, "accept_pr");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.match(a.body.line, /#78 merged into sandbox/);
  assert.ok(calls.some((c) => c[1] === "merge" && c.includes("78")));
  const msg = (await store.get("threadMessages", { body: `${ids.code} ready` }))!;
  assert.equal(msg.actionState?.action, "aceptar");
  assert.equal((await act(T.prCode, "accept_pr")).body.status, "stale", "the delivery was acted on");
  assert.equal((await act(T.prCode, "request_changes", { input: { text: "x" } })).body.status, "stale", "changes on a merged delivery");
});

test("request_changes: needs a text; the ticket goes back to Ready with the note", async () => {
  assert.equal((await act(T.changes, "request_changes")).http, 400);
  const a = await act(T.changes, "request_changes", { input: { text: "Add the empty state" } });
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.equal((await workiaTask(ids.chg!)).status, "Ready");
});

test("check 2: publish refuses a Bearer token and a release that is not ready; a ready one ships", async () => {
  for (const auth of [`Bearer ${TEST_BEARER}`, "bearer x"]) {
    const res = await post("/act", { brief_id: briefId, item_id: T.release, action: "publish", request_id: rid() }, { ...cookie(), Authorization: auth });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as Json).error, "HUMAN_ONLY");
  }
  const not = await act(T.releaseNo, "publish");
  assert.equal(not.body.status, "stale", "workia's release is not ready");
  assert.equal(calls.length, 0, "gh never ran");
  const a = await act(T.release, "publish");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.match(a.body.line, /Published to main with #700/);
  assert.ok(calls.some((c) => c[1] === "merge"));
  assert.equal((await events("release.merged")).length, 1);
});

test("fix_finding: a one-click finding is fixed through fixFinding", async () => {
  const a = await act(T.finding, "fix_finding");
  assert.equal(a.body.status, "done", JSON.stringify(a.body));
  assert.equal((await act(T.finding, "fix_finding")).body.status, "stale", "the finding is gone");
  assert.notEqual((await store.get("envStates", { env: "prod", projectId: await store.projectId("workia") }))!.deployedAt, null);
});

test("later and dismiss: brief state only, with undo; the pipeline sets them aside", async () => {
  const l = await act(T.plain, "later", { input: { until: "2999-01-01" } });
  assert.equal(l.body.status, "done");
  assert.equal(l.body.state.state, "later");
  assert.equal(l.body.state.until, "2999-01-01");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  assert.ok((await setAsideItems(db, today)).has(T.plain));
  assert.ok(!(await setAsideItems(db, "2999-01-02")).has(T.plain), "a later row comes back on its date");
  assert.equal((await post(`/act/${l.body.action_id}/undo`, {})).status, 200);
  assert.equal((await state()).items[T.plain]!.state, "open");
  const d = await act(T.plain, "dismiss", { input: { reason: "already done" } });
  assert.equal(d.body.state.state, "dismissed");
  assert.equal(d.body.line, "Not relevant: already done");
  assert.ok((await setAsideItems(db, "2999-01-02")).has(T.plain));
  assert.equal((await post(`/act/${d.body.action_id}/undo`, {})).status, 200);
});

test("check 4: a double click (same request_id) writes once and replays the first answer", async () => {
  const body = { brief_id: briefId, item_id: T.plain, action: "dismiss", request_id: "double-click-0001" };
  const [a, b] = await Promise.all([post("/act", body), post("/act", body)]);
  const [ja, jb] = [(await a.json()) as Json, (await b.json()) as Json];
  assert.equal(await store.count("briefActions", { requestId: "double-click-0001" }), 1);
  assert.ok([ja.status, jb.status].includes("done"));
  const again = (await (await post("/act", body)).json()) as Json;
  assert.equal(again.replay, true);
  assert.equal(again.action_id, ja.action_id ?? jb.action_id);
  await post(`/act/${again.action_id}/undo`, {});
});

test("check 6: every action left one brief.action event in its project, as the owner", async () => {
  const ev = await events();
  const done = await store.find("briefActions");
  for (const r of done) assert.ok(ev.some((e) => e.payload.action_id === r.id && !e.payload.undone), `${r.action} ${r.itemId}`);
  assert.ok(ev.every((e) => e.actor.agent === "jorge"));
  const by = (item: string) => ev.find((e) => e.payload.item_id === item)!.slug;
  assert.equal(by(T.runs), "micasa");
  assert.equal(by(T.release), "zigzag");
  assert.equal(by(T.plain), "workia", "a cross row goes to the home project");
});

test("bad requests: unknown item, a target that is not the row's, a row with no target, bad input", async () => {
  assert.equal((await act("i|workia|ffffffffffff", "later")).http, 404);
  assert.equal((await act(T.plain, "answer")).http, 409);
  assert.equal((await act(T.question, "later", { target: { kind: "runs", project: "workia" } })).http, 400);
  assert.equal((await act(T.question, "later", { input: { until: "tomorrow" } })).http, 400);
  assert.equal((await post("/act", { brief_id: briefId, action: "later" })).status, 400);
});

test("past days are read-only: no actions in state and act refused", async () => {
  const newer = (await store.fix((uow) => uow.insert("morningBriefs", { localDate: "2999-12-31", generatedAt: uow.now, trigger: "manual", mode: "full", data: { items: [] } }))).id;
  const s = await state();
  assert.equal(s.read_only, true);
  assert.ok(Object.values(s.items).every((i: Json) => i.actions.length === 0));
  const a = await act(T.plain, "later");
  assert.equal(a.http, 409);
  assert.equal(a.body.error, "READ_ONLY");
  await store.fix((uow) => uow.delete("morningBriefs", { id: newer }));
});
