// PLA-I41-2: the Morning brief facts pack. Seeds four projects on the throwaway plania_test_<hash> database (never the
// live plania database) and checks buildFacts: a diverged release compare, a stale prod record, PRs by window, the
// owner's inbox, threads (pass A cannot thread_read), the previous brief (§17 sample), source_errors, and that no
// token value or email reaches facts.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, TEST_BEARER, TEST_DATABASE_URL, TEST_READ_TOKEN, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_BRIEF_TOKEN = "brief-secret-value-1234567890";
const { makeDb } = await import("../src/db/client.js");
const { buildFacts, briefWindow, redactText } = await import("../src/brief/facts.js");
const { saveBriefSettings } = await import("../src/brief/settings.js");

type Db = ReturnType<typeof makeDb>["db"];
type Facts = Awaited<ReturnType<typeof buildFacts>>;
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
let facts: Facts;

const NOW = new Date("2026-11-13T13:04:12Z"); // 07:04 CDMX
const FROM = new Date("2026-11-13T00:00:00Z"); // 18:00 CDMX the day before
const W = { from: FROM, to: NOW };
const at = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString(); // h hours before NOW
const ACTOR = JSON.stringify({ agent: "Claude Code", session_id: "s-secret-session", machine: "mac-secret-machine" });
const GH_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const PLA_TOKEN = "pla_ZXhhbXBsZS10b2tlbi1mb3ItdGVzdHMtb25seQ";
const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));

const ids: Record<string, string> = {};
async function q(text: string, values: unknown[] = []) {
  return (await raw.query(text, values)).rows;
}
async function task(project: string, key: string, kind: string, status: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { title, ...rest } = extra;
  const cols = ["project_id", "key", "kind", "status", "title", ...Object.keys(rest)];
  const vals = [ids[project], key, kind, status, title ?? `${key} title`, ...Object.values(rest)];
  const rows = await q(`insert into tasks (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, vals);
  return rows[0].id;
}
async function pr(project: string, repo: string, n: number, state: string, base: string, extra: { taskId?: string; mergedAt?: string; title?: string; mergeSha?: string } = {}) {
  await q(
    `insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_branch, base_branch, merged_at, merge_sha, gh_updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [ids[project], repo, n, `https://github.com/${repo}/pull/${n}`, extra.title ?? `PR ${n}`, extra.taskId ?? null, state, `jl/pr-${n}`, base, extra.mergedAt ?? null, extra.mergeSha ?? null, at(1)],
  );
}
async function event(project: string, type: string, payload: Record<string, unknown>, createdAt: string) {
  await q(`insert into events (project_id, type, actor, payload, created_at) values ($1, $2, $3, $4, $5)`, [ids[project], type, ACTOR, JSON.stringify(payload), createdAt]);
}

before(async () => {
  assert.match(TEST_DATABASE_URL, /\/plania_test_[0-9a-f]{6}$/);
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  for (const r of await q("select id, slug from projects")) ids[r.slug] = r.id;

  // Settings: workia, filmia, micasa have a repo; zigzag has none. workia and filmia release sandbox → main → prod.
  const release = { from: "sandbox", into: "main", env: "prod" };
  await q(`update projects set settings = $2 where slug = $1`, ["workia", JSON.stringify({ github: { repo: "Jorg3L3on/workia" }, release, next_first: "WRK-14" })]);
  await q(`update projects set settings = $2 where slug = $1`, ["filmia", JSON.stringify({ github: { repo: "Jorg3L3on/filmia" }, release })]);
  await q(`update projects set settings = $2 where slug = $1`, ["micasa", JSON.stringify({ github: { repo: "Jorg3L3on/micasa", token_env: "MICASA_GH_TOKEN" } })]);
  await saveBriefSettings(db, { projects: { workia: { order: 0 }, zigzag: { order: 1 }, filmia: { order: 2 }, micasa: { order: 3 } }, hidden_refs: ["PLA-I16"] });

  // Workia: an active initiative, one ticket in review with an open PR, one in progress with a question, Ready work.
  const ini = await task("workia", "WRK-I14", "initiative", "Active", { next_action: "Release after the legal check", created_at: at(48) });
  const review = await task("workia", "WRK-I14-1", "ticket", "In review", { parent_id: ini, phase: 1, status_changed_at: at(5), created_at: at(48) });
  const prog = await task("workia", "WRK-I14-2", "ticket", "In progress", {
    parent_id: ini,
    phase: 2,
    priority: "P1",
    owner: ACTOR,
    lease_until: new Date(NOW.getTime() + 600_000).toISOString(),
    claimed_at: at(2),
    last_seen_at: at(1),
    workspace: JSON.stringify({ branch: "jl/wrk-i14-2", machine: "mac-secret-machine", worktree_path: "/x" }),
    created_at: at(48),
  });
  await task("workia", "WRK-13", "ticket", "Ready", { priority: "P2", title: "Fix expediente crash on contracts with pay", created_at: at(3) });
  await task("workia", "WRK-14", "ticket", "Ready", { priority: "P3", created_at: at(30) });
  await q(`insert into checks (task_id, n, position, text) values ($1, 1, 1, 'iPhone check')`, [review]);
  await q(`insert into questions (project_id, task_id, question, options, asked_by, asked_at) values ($1, $2, 'Ship the legal text now? Ask ana@example.com', '{yes,no}', $3, $4)`, [ids.workia, prog, ACTOR, at(4)]);

  await pr("workia", "Jorg3L3on/workia", 50, "open", "sandbox", { taskId: review, title: "WRK-I14-1 legal pages" });
  await event("workia", "pr.opened", { url: "https://github.com/Jorg3L3on/workia/pull/50", number: 50 }, at(24 * 20));
  await pr("workia", "Jorg3L3on/workia", 51, "open", "sandbox", { title: "No key PR" });
  await event("workia", "pr.opened", { url: "https://github.com/Jorg3L3on/workia/pull/51", number: 51 }, at(2));
  await pr("workia", "Jorg3L3on/workia", 49, "closed", "sandbox", { title: "Duplicate fix" });
  await event("workia", "pr.closed", { url: "https://github.com/Jorg3L3on/workia/pull/49", number: 49 }, at(3));
  await pr("workia", "Jorg3L3on/workia", 48, "merged", "sandbox", { mergedAt: at(6), title: "Old merge" });
  await pr("workia", "Jorg3L3on/workia", 40, "merged", "sandbox", { mergedAt: at(24 * 5), title: "Outside the window" });

  // The diverged release: sandbox 9 ahead, main 2 ahead (the poller's compare for these heads).
  await q(`insert into branches (project_id, name, head_sha) values ($1, 'sandbox', 'aaaaaaa1111'), ($1, 'main', 'bbbbbbb2222')`, [ids.workia]);
  await q(`insert into branches (project_id, name, head_sha, merged_at) values ($1, 'jl/wrk-12', 'ccc', $2)`, [ids.workia, at(30)]);
  await q(`insert into poll_state (project_id, source, cursor, polled_at) values ($1, 'github', $2, $3)`, [
    ids.workia,
    JSON.stringify({ release: { key: "aaaaaaa1111...bbbbbbb2222", from_head: "aaaaaaa1111", into_head: "bbbbbbb2222", ahead: 9, contains: false, commits: [], status: "diverged", behind_by: 2 } }),
    at(0),
  ]);
  await q(`insert into env_states (project_id, env, commit, migrations_applied, migrations, deployed_at, by, updated_at) values ($1, 'prod', 'ddddddd', 27, '{0027}', $2, $3, $2)`, [ids.workia, at(24 * 3), ACTOR]);

  // Filmia: prod record from Oct 29, then #238 merged into main last night → stale.
  await q(`insert into env_states (project_id, env, commit, migrations_applied, migrations, deployed_at, flags, by, updated_at) values ($1, 'prod', '1fb7188000', 24, '{0024}', '2026-10-29T18:00:00Z', '{"api_key_env": "FILMIA_KEY"}', $2, '2026-10-29T18:00:00Z')`, [ids.filmia, ACTOR]);
  await pr("filmia", "Jorg3L3on/filmia", 238, "merged", "main", { mergedAt: at(8), title: "Extras and Quinielas", mergeSha: "eeeeeee" });
  await q(`insert into branches (project_id, name, head_sha) values ($1, 'sandbox', 'fff'), ($1, 'main', 'fff')`, [ids.filmia]);

  // MiCasa: the poller's last call failed.
  await q(`insert into poll_state (project_id, source, cursor, error) values ($1, 'github', '{}', $2)`, [ids.micasa, `401 Bad credentials for token ${GH_TOKEN}`]);

  // Audit finding on workia.
  await q(`insert into audit_runs (project_id, at, count, findings) values ($1, $2, 1, $3)`, [ids.workia, at(1), JSON.stringify([{ code: "STALE_NOTE", key: "WRK-I14", detail: "state_note is older than the last move", fix_hint: "set_task state_note" }])]);

  // Threads: what pass A would have read with thread_read, carrying an email and token values that must not leak.
  const pt = (await q(`insert into threads (kind, project_id, read_at) values ('project', $1, $2) returning id`, [ids.workia, at(3)]))[0].id;
  await q(`insert into thread_messages (thread_id, at, author_agent, author_role, body, links) values ($1, $2, 'jorge', 'ceo', $3, '[]'), ($1, $4, 'po-workia', 'po', $5, $6), ($1, $7, 'po-workia', 'po', 'old message', '[]')`, [
    pt,
    at(5),
    `Use the legal text from mail of luis.perez@empresa.mx; my token is ${TEST_BEARER} and ${PLA_TOKEN}`,
    at(2),
    `Plan ready for WRK-I15. Also Bearer ${process.env.PLANIA_BRIEF_TOKEN} and read ${TEST_READ_TOKEN}`,
    JSON.stringify([{ kind: "ticket", ref: "WRK-I15", title: "Renewal board" }]),
    at(24 * 4),
  ]);
  const ct = (await q(`select id from threads where kind = 'company'`))[0].id; // made by migration 0041
  await q(`insert into thread_messages (thread_id, at, author_agent, author_role, body) values ($1, $2, 'asistente', 'asistente', 'Brief de hoy: 3 runs ok')`, [ct, at(6)]);

  // Yesterday's brief (§17 sample) and one checked item.
  await q(`insert into morning_briefs (local_date, generated_at, trigger, mode, data) values ('2026-11-12', $1, 'schedule', 'full', $2)`, [at(24), JSON.stringify(sample)]);
  await q(`insert into brief_checks (item_id) values ('i|filmia|2476a1071b2c')`);

  // Tasks created in the window.
  await task("zigzag", "ZIG-I3", "initiative", "Active", { created_at: at(4), title: "Privacy and terms pack" });

  facts = await buildFacts(db, W);
});

after(async () => {
  await closeDb();
  await raw.end();
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
  assert.deepEqual(w.tickets_in_progress, [{ key: "WRK-I14-2", title: "WRK-I14-2 title", priority: "P1", parent: "WRK-I14", agent: "Claude Code", lease_live: true, last_seen_at: at(1), branch: "jl/wrk-i14-2" }]);
  assert.equal(w.tickets_in_review.length, 1);
  assert.deepEqual({ ...w.tickets_in_review[0], pr: w.tickets_in_review[0]!.pr?.number }, { key: "WRK-I14-1", title: "WRK-I14-1 title", parent: "WRK-I14", since: at(5), open_checks: 1, pr: 50 });
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
  assert.equal(prev.generated_at, at(24));
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

test("redactText and briefWindow", () => {
  assert.equal(redactText("a sk-ant-api03-abcdefghijklmnopqrstuvwx b", {}), "a [redacted] b");
  assert.equal(redactText("contact me: x.y+z@mail.co", {}), "contact me: [email]");
  assert.equal(redactText("plain WRK-I14 · #238", {}), "plain WRK-I14 · #238");
  const now = new Date("2026-11-13T13:00:00Z");
  assert.deepEqual(briefWindow(null, now), { from: new Date("2026-11-12T13:00:00Z"), to: now });
  assert.deepEqual(briefWindow(new Date("2026-11-13T01:00:00Z"), now).from, new Date("2026-11-13T01:00:00Z"));
  assert.deepEqual(briefWindow(new Date("2026-11-01T00:00:00Z"), now).from, new Date("2026-11-10T13:00:00Z"), "at most three days back");
});
