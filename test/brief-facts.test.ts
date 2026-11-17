// PLA-I41-2: the Morning brief facts pack. Seeds four projects on a throwaway test store (never the live one) and
// checks buildFacts: a diverged release compare, a stale prod record, PRs by window, the owner's inbox, threads
// (pass A cannot thread_read), the previous brief (§17 sample), source_errors, and that no token value or email
// reaches facts.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { resetTestStore, TEST_BEARER, TEST_READ_TOKEN, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
process.env.PLANIA_BRIEF_TOKEN = "brief-secret-value-1234567890";
const { makeDb } = await import("../src/db/client.js");
const { buildFacts, briefWindow, redactText } = await import("../src/brief/facts.js");
const { saveBriefSettings } = await import("../src/brief/settings.js");
type NewTask = import("../src/store/types.js").NewRow<"tasks">;

type Db = ReturnType<typeof makeDb>["db"];
type Facts = Awaited<ReturnType<typeof buildFacts>>;
let store: TestStore;
let db: Db;
let facts: Facts;

const NOW = new Date("2026-11-13T13:04:12Z"); // 07:04 CDMX
const FROM = new Date("2026-11-13T00:00:00Z"); // 18:00 CDMX the day before
const W = { from: FROM, to: NOW };
const at = (h: number) => new Date(NOW.getTime() - h * 3600_000); // h hours before NOW
const iso = (h: number) => at(h).toISOString();
const ACTOR = { agent: "Claude Code", session_id: "s-secret-session", machine: "mac-secret-machine" };
const GH_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const PLA_TOKEN = "pla_ZXhhbXBsZS10b2tlbi1mb3ItdGVzdHMtb25seQ";
const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));

const ids: Record<string, string> = {};
async function task(project: string, key: string, kind: string, status: string, extra: Partial<NewTask> = {}): Promise<string> {
  const row = await store.fix((uow) => uow.insert("tasks", { projectId: ids[project]!, key, kind, status, title: `${key} title`, ...extra } as NewTask));
  return row.id;
}
async function pr(project: string, repo: string, n: number, state: string, base: string, extra: { taskId?: string; mergedAt?: Date; title?: string; mergeSha?: string } = {}) {
  await store.fix((uow) =>
    uow.insert("pullRequests", {
      projectId: ids[project]!,
      repo,
      number: n,
      url: `https://github.com/${repo}/pull/${n}`,
      title: extra.title ?? `PR ${n}`,
      taskId: extra.taskId ?? null,
      state,
      headBranch: `jl/pr-${n}`,
      baseBranch: base,
      mergedAt: extra.mergedAt ?? null,
      mergeSha: extra.mergeSha ?? null,
      ghUpdatedAt: at(1),
    }),
  );
}
async function event(project: string, type: string, payload: Record<string, unknown>, createdAt: Date) {
  await store.fix((uow) => uow.insert("events", { projectId: ids[project]!, type, actor: ACTOR, payload, createdAt }));
}

before(async () => {
  store = await resetTestStore();
  ({ db } = makeDb());
  for (const r of await store.find("projects")) ids[r.slug] = r.id;

  // Settings: workia, filmia, micasa have a repo; zigzag has none. workia and filmia release sandbox → main → prod.
  const release = { from: "sandbox", into: "main", env: "prod" };
  await store.fix(async (uow) => {
    await uow.update("projects", { slug: "workia" }, { settings: { github: { repo: "Jorg3L3on/workia" }, release, next_first: "WRK-14" } });
    await uow.update("projects", { slug: "filmia" }, { settings: { github: { repo: "Jorg3L3on/filmia" }, release } });
    await uow.update("projects", { slug: "micasa" }, { settings: { github: { repo: "Jorg3L3on/micasa", token_env: "MICASA_GH_TOKEN" } } });
  });
  await saveBriefSettings(db, { projects: { workia: { order: 0 }, zigzag: { order: 1 }, filmia: { order: 2 }, micasa: { order: 3 } }, hidden_refs: ["PLA-I16"] });

  // Workia: an active initiative, one ticket in review with an open PR, one in progress with a question, Ready work.
  const ini = await task("workia", "WRK-I14", "initiative", "Active", { nextAction: "Release after the legal check", createdAt: at(48) });
  const review = await task("workia", "WRK-I14-1", "ticket", "In review", { parentId: ini, phase: 1, statusChangedAt: at(5), createdAt: at(48) });
  const prog = await task("workia", "WRK-I14-2", "ticket", "In progress", {
    parentId: ini,
    phase: 2,
    priority: "P1",
    owner: ACTOR,
    leaseUntil: new Date(NOW.getTime() + 600_000),
    claimedAt: at(2),
    lastSeenAt: at(1),
    workspace: { branch: "jl/wrk-i14-2", machine: "mac-secret-machine", worktree_path: "/x" },
    createdAt: at(48),
  } as Partial<NewTask>);
  await task("workia", "WRK-13", "ticket", "Ready", { priority: "P2", title: "Fix expediente crash on contracts with pay", createdAt: at(3) });
  await task("workia", "WRK-14", "ticket", "Ready", { priority: "P3", createdAt: at(30) });
  await store.fix(async (uow) => {
    await uow.insert("checks", { taskId: review, n: 1, position: 1, text: "iPhone check" });
    await uow.insert("questions", { projectId: ids.workia!, taskId: prog, question: "Ship the legal text now? Ask ana@example.com", options: ["yes", "no"], askedBy: ACTOR, askedAt: at(4) });
  });

  await pr("workia", "Jorg3L3on/workia", 50, "open", "sandbox", { taskId: review, title: "WRK-I14-1 legal pages" });
  await event("workia", "pr.opened", { url: "https://github.com/Jorg3L3on/workia/pull/50", number: 50 }, at(24 * 20));
  await pr("workia", "Jorg3L3on/workia", 51, "open", "sandbox", { title: "No key PR" });
  await event("workia", "pr.opened", { url: "https://github.com/Jorg3L3on/workia/pull/51", number: 51 }, at(2));
  await pr("workia", "Jorg3L3on/workia", 49, "closed", "sandbox", { title: "Duplicate fix" });
  await event("workia", "pr.closed", { url: "https://github.com/Jorg3L3on/workia/pull/49", number: 49 }, at(3));
  await pr("workia", "Jorg3L3on/workia", 48, "merged", "sandbox", { mergedAt: at(6), title: "Old merge" });
  await pr("workia", "Jorg3L3on/workia", 40, "merged", "sandbox", { mergedAt: at(24 * 5), title: "Outside the window" });

  await store.fix(async (uow) => {
    // The diverged release: sandbox 9 ahead, main 2 ahead (the poller's compare for these heads).
    await uow.insert("branches", { projectId: ids.workia!, name: "sandbox", headSha: "aaaaaaa1111" });
    await uow.insert("branches", { projectId: ids.workia!, name: "main", headSha: "bbbbbbb2222" });
    await uow.insert("branches", { projectId: ids.workia!, name: "jl/wrk-12", headSha: "ccc", mergedAt: at(30) });
    await uow.insert("pollState", {
      projectId: ids.workia!,
      source: "github",
      cursor: { release: { key: "aaaaaaa1111...bbbbbbb2222", from_head: "aaaaaaa1111", into_head: "bbbbbbb2222", ahead: 9, contains: false, commits: [], status: "diverged", behind_by: 2 } },
      polledAt: at(0),
    });
    await uow.insert("envStates", { projectId: ids.workia!, env: "prod", commit: "ddddddd", migrationsApplied: 27, migrations: ["0027"], deployedAt: at(24 * 3), by: ACTOR, updatedAt: at(24 * 3) });

    // Filmia: prod record from Oct 29, then #238 merged into main last night → stale.
    const oct29 = new Date("2026-10-29T18:00:00Z");
    await uow.insert("envStates", { projectId: ids.filmia!, env: "prod", commit: "1fb7188000", migrationsApplied: 24, migrations: ["0024"], deployedAt: oct29, flags: { api_key_env: "FILMIA_KEY" }, by: ACTOR, updatedAt: oct29 } as import("../src/store/types.js").NewRow<"envStates">);
  });
  await pr("filmia", "Jorg3L3on/filmia", 238, "merged", "main", { mergedAt: at(8), title: "Extras and Quinielas", mergeSha: "eeeeeee" });
  await store.fix(async (uow) => {
    await uow.insert("branches", { projectId: ids.filmia!, name: "sandbox", headSha: "fff" });
    await uow.insert("branches", { projectId: ids.filmia!, name: "main", headSha: "fff" });

    // MiCasa: the poller's last call failed.
    await uow.insert("pollState", { projectId: ids.micasa!, source: "github", cursor: {}, error: `401 Bad credentials for token ${GH_TOKEN}` });

    // Audit finding on workia.
    await uow.insert("auditRuns", { projectId: ids.workia!, at: at(1), count: 1, findings: [{ code: "STALE_NOTE", key: "WRK-I14", detail: "state_note is older than the last move", fix_hint: "set_task state_note" }] });

    // Threads: what pass A would have read with thread_read, carrying an email and token values that must not leak.
    const pt = (await uow.insert("threads", { kind: "project", projectId: ids.workia!, readAt: at(3) })).id;
    await uow.insert("threadMessages", { threadId: pt, at: at(5), authorAgent: "jorge", authorRole: "ceo", body: `Use the legal text from mail of luis.perez@empresa.mx; my token is ${TEST_BEARER} and ${PLA_TOKEN}`, links: [] });
    await uow.insert("threadMessages", {
      threadId: pt,
      at: at(2),
      authorAgent: "po-workia",
      authorRole: "po",
      body: `Plan ready for WRK-I15. Also Bearer ${process.env.PLANIA_BRIEF_TOKEN} and read ${TEST_READ_TOKEN}`,
      links: [{ kind: "ticket", ref: "WRK-I15", title: "Renewal board" }],
    });
    await uow.insert("threadMessages", { threadId: pt, at: at(24 * 4), authorAgent: "po-workia", authorRole: "po", body: "old message", links: [] });
    const ct = (await uow.get("threads", { kind: "company" })) ?? (await uow.insert("threads", { kind: "company" }));
    await uow.insert("threadMessages", { threadId: ct.id, at: at(6), authorAgent: "asistente", authorRole: "asistente", body: "Brief de hoy: 3 runs ok" });

    // Yesterday's brief (§17 sample) and one checked item.
    await uow.insert("morningBriefs", { localDate: "2026-11-12", generatedAt: at(24), trigger: "schedule", mode: "full", data: sample });
    await uow.insert("briefChecks", { itemId: "i|filmia|2476a1071b2c" });
  });

  // Tasks created in the window.
  await task("zigzag", "ZIG-I3", "initiative", "Active", { createdAt: at(4), title: "Privacy and terms pack" });

  facts = await buildFacts(db, W);
});

after(async () => {
  await store.end();
});

const proj = (slug: string) => facts.projects.find((p) => p.slug === slug)!;

test("facts: window, settings, project order (included projects only)", () => {
  assert.deepEqual(facts.window, { from: FROM.toISOString(), to: NOW.toISOString() });
  assert.equal(facts.timezone, "America/Mexico_City");
  assert.deepEqual(facts.hidden_refs, ["PLA-I16"]);
  assert.deepEqual(facts.projects.map((p) => p.slug), ["workia", "zigzag", "filmia", "micasa"]);
});

test("facts: workia tickets, initiative state, Ready (next_first first), inbox, audit", () => {
  const w = proj("workia");
  assert.deepEqual(w.tickets_in_progress, [{ handle: "t:WRK-I14-2", key: "WRK-I14-2", title: "WRK-I14-2 title", priority: "P1", parent: "WRK-I14", agent: "Claude Code", lease_live: true, last_seen_at: iso(1), branch: "jl/wrk-i14-2" }]);
  assert.equal(w.tickets_in_review.length, 1);
  assert.deepEqual({ ...w.tickets_in_review[0], pr: w.tickets_in_review[0]!.pr?.number }, { handle: "t:WRK-I14-1", key: "WRK-I14-1", title: "WRK-I14-1 title", parent: "WRK-I14", since: iso(5), open_checks: 1, pr: 50 });
  assert.equal(w.initiatives.length, 1);
  const i = w.initiatives[0]!;
  assert.deepEqual([i.key, i.done, i.total, i.next_action], ["WRK-I14", 0, 2, "Release after the legal check"]);
  assert.deepEqual(i.in_review, [{ key: "WRK-I14-1", pr: 50 }]);
  assert.ok(i.waiting_on.some((x) => x.key === "WRK-I14-2"), "the open question shows as a wait");
  assert.deepEqual(w.ready.map((r) => [r.key, r.first]), [["WRK-14", true], ["WRK-13", false]]);
  assert.deepEqual(w.created_in_window.map((t) => t.key), ["WRK-13"]);
  const question = w.inbox.find((x) => x.kind === "question")!;
  assert.equal(question.key, "WRK-I14-2");
  assert.deepEqual(question.options, ["yes", "no"]);
  assert.deepEqual(w.audit?.findings.map((f) => f.code), ["STALE_NOTE"]);
  assert.deepEqual(w.merged_branches_not_deleted, ["jl/wrk-12"]);
});

test("facts: PRs opened/merged/closed in the window, every open PR with age and base", () => {
  const p = proj("workia").pull_requests;
  assert.deepEqual(p.opened.map((x) => x.number), [51]);
  assert.deepEqual(p.merged.map((x) => x.number), [48]);
  assert.deepEqual(p.closed.map((x) => x.number), [49]);
  assert.deepEqual(p.open.map((x) => [x.number, x.base, x.age_days, x.ticket]), [[51, "sandbox", 0, null], [50, "sandbox", 20, "WRK-I14-1"]]);
});

test("facts: a diverged release compare gives ahead/behind and no fast-forward", () => {
  const r = proj("workia").release!;
  assert.equal(r.state, "diverged");
  assert.equal(r.ahead, 9);
  assert.equal(r.behind, 2);
  assert.equal(r.fast_forward, false);
  assert.equal(r.compare_url, "https://github.com/Jorg3L3on/workia/compare/main...sandbox");
  assert.deepEqual([r.from, r.into, r.env, r.from_head, r.into_head], ["sandbox", "main", "prod", "aaaaaaa", "bbbbbbb"]);
  const f = proj("filmia").release!;
  assert.equal(f.state, "identical");
  assert.equal(f.behind, 0);
});

test("facts: a stale env record names the merges since; a fresh one is not stale", () => {
  const prod = proj("filmia").envs.find((e) => e.env === "prod")!;
  assert.equal(prod.stale, true);
  assert.deepEqual(prod.merged_since.map((m) => m.number), [238]);
  assert.deepEqual([prod.commit, prod.migrations_applied, prod.migrations], ["1fb7188", 24, ["0024"]]);
  assert.equal("flags" in prod, false, "env flags are not copied");
  const wprod = proj("workia").envs.find((e) => e.env === "prod")!;
  assert.equal(wprod.stale, false, "no merge into main after the record");
});

test("facts: threads carry what thread_read would have shown, within the window", () => {
  const t = proj("workia").thread;
  assert.equal(t.messages.length, 2, "the 4-day-old message is outside the window");
  assert.deepEqual(t.messages.map((m) => m.author), ["jorge", "po-workia"]);
  assert.deepEqual(t.messages[1]!.links, [{ kind: "ticket", ref: "WRK-I15", title: "Renewal board" }]);
  assert.equal(t.unread, 1, "one message after read_at not written by the owner");
  assert.deepEqual(facts.company_thread.messages.map((m) => m.body), ["Brief de hoy: 3 runs ok"]);
  assert.deepEqual(proj("zigzag").thread, { unread: 0, messages: [] });
});

test("facts: the previous brief's items with their checks", () => {
  const prev = facts.previous_brief!;
  assert.equal(prev.generated_at, iso(24));
  assert.equal(prev.items.length, 7);
  assert.deepEqual(prev.items.find((i) => i.id === "i|filmia|2476a1071b2c"), { id: "i|filmia|2476a1071b2c", app: "filmia", status: "open_pr", title: "Dependabot npm minor/patch bump", ref: "#235", checked: true });
  assert.equal(prev.items.filter((i) => i.checked).length, 1);
  assert.deepEqual(prev.ideas.map((i) => i.code), ["W1", "Z1", "Z2", "F1", "F2", "M1", "X1"]);
});

test("facts: a project without settings.github.repo yields one source_errors entry", () => {
  const zig = facts.source_errors.filter((e) => e.project === "zigzag");
  assert.equal(zig.length, 1);
  assert.deepEqual([zig[0]!.source, zig[0]!.error, zig[0]!.fix], ["github", "no_repo", "pnpm project:add zigzag --repo owner/name"]);
  assert.deepEqual(facts.source_errors.map((e) => [e.project, e.error]), [["zigzag", "no_repo"], ["micasa", "poll_error"]]);
  assert.equal(proj("zigzag").github_repo, null);
});

test("facts: github_mode off reports no GitHub gaps", async () => {
  const f = await buildFacts(db, W, { settings: { ...(await import("../src/brief/settings.js")).DEFAULT_SETTINGS, github_mode: "off" } });
  assert.deepEqual(f.source_errors, []);
});

test("facts.json carries no token values or emails", () => {
  const json = JSON.stringify(facts);
  for (const secret of [TEST_BEARER, TEST_READ_TOKEN, process.env.PLANIA_BRIEF_TOKEN!, GH_TOKEN, PLA_TOKEN, "s-secret-session", "mac-secret-machine", "MICASA_GH_TOKEN", "FILMIA_KEY"]) {
    assert.equal(json.includes(secret), false, `facts must not contain ${secret}`);
  }
  assert.doesNotMatch(json, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "no email address");
  assert.match(json, /\[redacted\]/, "the pasted tokens were replaced, not dropped silently");
  assert.match(json, /\[email\]/);
  const micasa = facts.source_errors.find((e) => e.project === "micasa")!;
  assert.match(micasa.detail, /401 Bad credentials for token \[redacted\]/);
});

// PLA-I49-2: every fact the owner can act on carries a handle, and the handle keeps the id the inbox had.
test("facts v2: handles on questions, steps, the release, PRs, tickets, initiatives, env records, findings and runs", async () => {
  assert.equal(facts.version, 2);
  const w = proj("workia");
  const qrow = (await store.get("questions", { projectId: ids.workia! }))!;
  const question = w.inbox.find((x) => x.kind === "question")!;
  assert.equal(question.id, qrow.id);
  assert.equal(question.handle, `q:${qrow.id}`);
  assert.equal(w.release!.handle, "rel:workia");
  assert.equal(w.runs_handle, "runs:workia");
  assert.deepEqual(w.pull_requests.open.map((x) => x.handle), ["pr:workia#51", "pr:workia#50"]);
  assert.equal(w.initiatives[0]!.handle, "i:WRK-I14");
  assert.deepEqual(w.ready.map((r) => r.handle), ["t:WRK-14", "t:WRK-13"]);
  assert.equal(w.envs[0]!.handle, "env:workia/prod");
  assert.equal(w.audit!.findings[0]!.handle, "f:workia/STALE_NOTE/WRK-I14");
  assert.equal(proj("zigzag").created_in_window[0]!.handle, "i:ZIG-I3");

  // A human step: its blocker id is kept, with who it is for.
  const t = (await store.get("tasks", { key: "WRK-I14-1" }))!;
  const b = await store.fix((uow) => uow.insert("blockers", { taskId: t.id, type: "human_action", spec: { assignee: "jorge", text: "Check the legal text on the phone" } }));
  const again = (await buildFacts(db, W)).projects.find((p) => p.slug === "workia")!;
  const step = again.inbox.find((x) => x.kind === "human_action")!;
  assert.deepEqual([step.handle, step.id, step.key, step.assignee], [`b:${b.id}`, b.id, "WRK-I14-1", "jorge"]);
  await store.fix((uow) => uow.delete("blockers", { id: b.id }));
});

test("redactText and briefWindow", () => {
  assert.equal(redactText("a sk-ant-api03-abcdefghijklmnopqrstuvwx b", {}), "a [redacted] b");
  assert.equal(redactText("contact me: x.y+z@mail.co", {}), "contact me: [email]");
  assert.equal(redactText("plain WRK-I14 · #238", {}), "plain WRK-I14 · #238");
  const now = new Date("2026-11-13T13:00:00Z");
  assert.deepEqual(briefWindow(null, now), { from: new Date("2026-11-12T13:00:00Z"), to: now });
  assert.deepEqual(briefWindow(new Date("2026-11-13T01:00:00Z"), now).from, new Date("2026-11-13T01:00:00Z"));
  assert.deepEqual(briefWindow(new Date("2026-11-01T00:00:00Z"), now).from, new Date("2026-11-10T13:00:00Z"), "at most three days back");
});
