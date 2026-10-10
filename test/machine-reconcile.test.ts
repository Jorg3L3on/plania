// PLA-I1-5: primary things (no teardown, never orphan or stale), the stale and ghost states and their
// thresholds, the audit findings about the Mac, the resume line and the inbox.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask, claim } = await import("../src/mcp/writes.js");
const { findProject } = await import("../src/mcp/queries.js");
const infer = await import("../src/jobs/machine/infer.js");
const collect = await import("../src/jobs/machine/collect.js");
const run = await import("../src/jobs/machine/run.js");
const { reconcile } = await import("../src/jobs/machine/reconcile.js");
const { runMachineTick, machineInventory } = await import("../src/jobs/machine/index.js");
const { auditProject } = await import("../src/mcp/audit.js");
const { footprintFindings } = await import("../src/mcp/footprint-audit.js");
const { resumeDigest } = await import("../src/mcp/resume.js");
const { inbox } = await import("../src/mcp/inbox.js");

import type { Directory, Observed, OwnerFacts, StateInput } from "../src/jobs/machine/infer.js";
import type { Run, RunResult } from "../src/jobs/machine/run.js";

const ok = (stdout: string): RunResult => ({ ok: true, stdout });
const missing: RunResult = { ok: false, reason: "missing", stdout: "" };
const H = 3600_000;
const ctx = { actor: { agent: "claude", session_id: "s1", machine: "test-mac" } };

// ---- a pure look at the rules

const NOW = new Date("2026-10-10T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const base: StateInput = { source: "observed", self: false, shared: false, projectId: "p", taskId: "t", repo: "zigzag", kind: "server", now: NOW, startedAt: ago(30 * H) };
const owner = (over: Partial<OwnerFacts> = {}): OwnerFacts => ({ key: "ZIG-I3-2", status: "In progress", closedAt: null, claimLive: true, lapsedAt: null, ...over });

describe("primary", () => {
  const dir = {
    projects: [{ id: "p", slug: "zigzag", keyPrefix: "ZIG" }, { id: "m", slug: "micasa", keyPrefix: "MIC" }],
    repos: [{ name: "zigzag", path: "/r/zigzag", projectId: "p", projectSlug: "zigzag" }, { name: "plania", path: "/r/plania", projectId: null, projectSlug: null }],
  } as unknown as Directory;
  const db = (name: string): Observed => ({ kind: "database", locator: `${name}@127.0.0.1:5432`, database: { name, port: 5432 }, details: { name, port: 5432 } });

  test("a database named exactly like a project or a repo, or postgres / template0 / template1, is primary; copies, test databases and strangers are not", () => {
    for (const n of ["plania", "micasa", "zigzag", "postgres", "template0", "template1", "Zigzag"]) assert.equal(infer.isPrimary(db(n), dir), true, n);
    for (const n of ["xize", "zigzag_test_abc123", "plania_test_fadac0", "plania_preview_ui", "zigzag_zig_i5_scratch", "zigzagx", "filmia"]) assert.equal(infer.isPrimary(db(n), dir), false, n);
  });

  test("a project- or repo-named database is primary only on the main Postgres server; postgres and templates everywhere", () => {
    const on = (name: string, port: number): Observed => ({ kind: "database", locator: `${name}@127.0.0.1:${port}`, database: { name, port }, details: { name, port } });
    assert.equal(infer.isPrimary(on("zigzag", 5432), dir), true);
    assert.equal(infer.isPrimary(on("zigzag", 5433), dir), false, "a scratch server's copy is an ordinary row");
    assert.equal(infer.isPrimary(on("plania", 5433), dir), false);
    assert.equal(infer.isPrimary(on("postgres", 5433), dir), true);
    assert.equal(infer.isPrimary(on("template1", 5433), dir), true);
    process.env.PLANIA_PRIMARY_PG_PORT = "5433";
    try {
      assert.equal(infer.isPrimary(on("zigzag", 5433), dir), true, "the main port comes from PLANIA_PRIMARY_PG_PORT");
      assert.equal(infer.isPrimary(on("zigzag", 5432), dir), false);
    } finally {
      delete process.env.PLANIA_PRIMARY_PG_PORT;
    }
  });

  test("self, database servers, brew services and a LaunchAgent named after a repo are primary; other LaunchAgents, servers and worktrees are not", () => {
    const item = (o: Partial<Observed> & Pick<Observed, "kind">): Observed => ({ locator: "x", details: {}, ...o });
    assert.equal(infer.isPrimary(item({ kind: "server", self: true }), dir), true);
    assert.equal(infer.isPrimary(item({ kind: "server" }), dir), false);
    assert.equal(infer.isPrimary(item({ kind: "db_server" }), dir), true);
    assert.equal(infer.isPrimary(item({ kind: "service", details: { manager: "brew" } }), dir), true);
    assert.equal(infer.isPrimary(item({ kind: "service", details: { manager: "launchd" }, repoHint: "plania" }), dir), true);
    assert.equal(infer.isPrimary(item({ kind: "service", details: { manager: "launchd" } }), dir), false);
    assert.equal(infer.isPrimary(item({ kind: "worktree" }), dir), false);
  });

  test("brew's own LaunchAgents stay brew services when brew itself did not run (launchd's PATH)", () => {
    const { serviceItems } = collect;
    const files = ["homebrew.mxcl.postgresql@14.plist", "sh.brew.postgresql@17.plist", "com.google.keystone.agent.plist"];
    const items = serviceItems({ ran: false, services: [] }, files, "/Users/x/Library/LaunchAgents", []).items;
    const by = Object.fromEntries(items.map((i) => [i.locator, i]));
    for (const label of ["homebrew.mxcl.postgresql@14", "sh.brew.postgresql@17"]) {
      const row = by[`launchagent:${label}`]!;
      assert.equal(row.details.manager, "brew");
      assert.equal(infer.isPrimary(row, dir), true);
    }
    assert.equal(by["launchagent:sh.brew.postgresql@17"]!.details.brew_formula, "postgresql@17");
    assert.equal(infer.isPrimary(by["launchagent:com.google.keystone.agent"]!, dir), false);
  });

  test("commands find brew and docker under launchd's short PATH", () => {
    const p = run.commandPath("/usr/bin:/bin:/usr/sbin:/sbin").split(":");
    assert.ok(p.includes("/opt/homebrew/bin") && p.includes("/usr/local/bin"));
    assert.equal(p.indexOf("/usr/bin"), 0);
    assert.equal(new Set(p).size, p.length);
  });

  test("a primary row is never orphan or stale, whatever its ticket says", () => {
    const closed = owner({ status: "Done", closedAt: ago(100 * H), claimLive: false });
    assert.equal(infer.computeState({ ...base, kind: "database", primary: true, task: closed }), "live");
    assert.equal(infer.computeState({ ...base, kind: "database", primary: true, projectId: null, taskId: null, repo: null, shared: true }), "system");
    assert.equal(infer.computeState({ ...base, kind: "database", primary: true, projectId: null, taskId: null, repo: null }), "system", "never orphan");
    assert.equal(infer.computeState({ ...base, kind: "server", self: true, primary: true }), "self");
  });
});

describe("computeState: stale", () => {
  const closedAt = (h: number, status = "Done") => owner({ status, closedAt: ago(h * H), claimLive: false, lapsedAt: ago(h * H) });

  test("servers, browsers and tunnels go stale 2 hours after the ticket closed, and not a minute before", () => {
    for (const kind of ["server", "browser", "tunnel"] as const) {
      assert.equal(infer.computeState({ ...base, kind, task: closedAt(1.98) }), "live", `${kind} at 1h59`);
      const v = infer.computeVerdict({ ...base, kind, task: closedAt(2.02) });
      assert.equal(v.state, "stale", `${kind} at 2h01`);
      assert.deepEqual([v.reason, v.since?.toISOString()], ["ticket ZIG-I3-2 Done", ago(2.02 * H).toISOString()]);
    }
  });

  test("databases and containers: the same rules at 24 hours", () => {
    for (const kind of ["database", "container"] as const) {
      assert.equal(infer.computeState({ ...base, kind, task: closedAt(23.9) }), "live", `${kind} at 23h54`);
      assert.equal(infer.computeState({ ...base, kind, task: closedAt(24.1) }), "stale", `${kind} at 24h06`);
    }
  });

  test("Done, Merged, Won't do and Released all close a ticket; the reason names the status", () => {
    for (const status of ["Done", "Merged", "Won't do", "Released"]) {
      assert.equal(infer.computeVerdict({ ...base, task: closedAt(3, status) }).reason, `ticket ZIG-I3-2 ${status}`);
    }
    assert.equal(infer.computeState({ ...base, task: owner({ status: "In review", claimLive: true }) }), "live");
  });

  test("no live claim for the threshold: sin claim, counted from the later of the lapse and the first sighting", () => {
    const lapsed = (h: number) => owner({ claimLive: false, lapsedAt: ago(h * H) });
    assert.equal(infer.computeState({ ...base, task: lapsed(1.9) }), "live");
    const v = infer.computeVerdict({ ...base, task: lapsed(2.1) });
    assert.deepEqual([v.state, v.reason, v.since?.toISOString()], ["stale", "sin claim", ago(2.1 * H).toISOString()]);
    // first seen 30 minutes ago, claim lapsed 10 hours ago: unclaimed for only as long as it has existed
    assert.equal(infer.computeState({ ...base, startedAt: ago(0.5 * H), task: lapsed(10) }), "live");
    assert.equal(infer.computeState({ ...base, startedAt: ago(2.5 * H), task: lapsed(10) }), "stale");
    // never claimed: from the first sighting
    assert.equal(infer.computeState({ ...base, startedAt: ago(3 * H), task: owner({ claimLive: false, lapsedAt: null }) }), "stale");
    assert.equal(infer.computeState({ ...base, kind: "database", startedAt: ago(3 * H), task: lapsed(10) }), "live", "a database waits 24h");
  });

  test("a live claim keeps it live; no ticket (repo-only, project-only) is never stale from ticket rules", () => {
    assert.equal(infer.computeState({ ...base, startedAt: ago(500 * H), task: owner({ claimLive: true }) }), "live");
    assert.equal(infer.computeState({ ...base, taskId: null, startedAt: ago(500 * H), task: null }), "live");
    assert.equal(infer.computeState({ ...base, taskId: null, projectId: null, startedAt: ago(500 * H), task: null }), "live", "repo only");
  });

  test("database servers and services are never stale", () => {
    for (const kind of ["db_server", "service"] as const) {
      assert.equal(infer.computeState({ ...base, kind, shared: true, task: closedAt(500) }), "live");
    }
  });

  test("orphan stays orphan; shared stays system; a declaration makes a row live", () => {
    const bare = { ...base, projectId: null, taskId: null, repo: null, task: null };
    assert.equal(infer.computeState(bare), "orphan");
    assert.equal(infer.computeState({ ...bare, shared: true }), "system");
    assert.equal(infer.computeState({ ...bare, source: "declared" }), "live");
  });

  test("worktrees: merged work and clean, or the branch merged on GitHub, or a closed ticket; never when dirty, unknown or in use", () => {
    const wt = (over: Partial<NonNullable<StateInput["worktree"]>> = {}, task: OwnerFacts | null = null): StateInput => ({
      ...base,
      kind: "worktree",
      task,
      worktree: { merged: false, ownCommits: 0, dirty: false, branchMergedAt: null, ...over },
    });
    assert.equal(infer.computeState(wt()), "live", "unmerged");
    assert.equal(infer.computeState(wt({ merged: true, ownCommits: 0 })), "live", "a new worktree with no commits counts as merged but is not merged work");
    assert.equal(infer.computeState(wt({ merged: true, ownCommits: null })), "live", "unknown reflog");
    const merged = infer.computeVerdict(wt({ merged: true, ownCommits: 4 }));
    assert.deepEqual([merged.state, merged.reason], ["stale", "rama fusionada"]);
    const at = ago(5 * H);
    const squashed = infer.computeVerdict(wt({ branchMergedAt: at }));
    assert.deepEqual([squashed.state, squashed.reason, squashed.since], ["stale", "rama fusionada", at]);
    assert.equal(infer.computeState(wt({ merged: true, ownCommits: 4, dirty: true })), "live", "uncommitted changes");
    assert.equal(infer.computeState(wt({ merged: true, ownCommits: 4, dirty: null })), "live", "git could not tell");
    assert.equal(infer.computeState(wt({ branchMergedAt: at }, owner({ claimLive: true }))), "live", "someone holds a claim on it");
    for (const status of ["Merged", "Done", "Released", "Won't do"]) {
      const v = infer.computeVerdict(wt({}, owner({ status, claimLive: false })));
      assert.deepEqual([v.state, v.reason], ["stale", `ticket ZIG-I3-2 ${status}`], status);
    }
    assert.equal(infer.computeState(wt({}, owner({ status: "Done", claimLive: false }))), "stale");
    assert.equal(infer.computeState({ ...wt({}, owner({ status: "Done", claimLive: false })), worktree: { merged: false, ownCommits: 0, dirty: true, branchMergedAt: null } }), "live");
    assert.equal(infer.computeState(wt({}, owner({ status: "In review", claimLive: false }))), "live", "a worktree has no claim clock");
  });
});

describe("computeState: ghost", () => {
  const unseen = (over: Partial<StateInput>): StateInput => ({ ...base, source: "declared", seen: false, collectorRan: true, declaredAt: ago(10 * 60_000), misses: 1, ...over });

  test("declared and never observed: a ghost 5 minutes after it was declared, when its collector ran", () => {
    assert.equal(infer.computeState(unseen({ declaredAt: ago(4 * 60_000), current: "live" })), "live");
    assert.equal(infer.computeState(unseen({ declaredAt: ago(5 * 60_000 + 1000) })), "ghost");
  });

  test("declared and observed before (both): a ghost after two ticks of its collector without it", () => {
    assert.equal(infer.computeState(unseen({ source: "both", misses: 1, current: "live" })), "live");
    assert.equal(infer.computeState(unseen({ source: "both", misses: 2 })), "ghost");
  });

  test("never a ghost when the collector did not run (a cache has none, Docker may be missing) or for an observed row", () => {
    assert.equal(infer.computeState(unseen({ collectorRan: false, declaredAt: ago(500 * H), current: "live" })), "live");
    assert.equal(infer.computeState(unseen({ source: "observed", misses: 9, current: "live" })), "live");
  });
});

// ---- a Mac, by hand: the commands the job runs answered from a small model

type World = {
  listeners: { pid: number; cmd: string; port: number; cwd: string; ps: string }[];
  dbs: Record<number, string[]>;
  brew: { name: string; status: string }[];
  worktrees: { path: string; branch: string | null; dirty: boolean; merged: boolean; commits: number }[];
  sizeKb: number;
};

function fakeRun(root: string, repos: string[], w: World): Run {
  return async (cmd, args) => {
    if (cmd === "lsof") {
      if (args.includes("cwd")) return ok(w.listeners.map((l) => `p${l.pid}\nfcwd\nn${l.cwd}\n`).join(""));
      return ok(w.listeners.map((l) => `p${l.pid}\nc${l.cmd}\nf13\nn*:${l.port}\n`).join(""));
    }
    if (cmd === "ps") return ok(w.listeners.map((l) => ` ${l.pid}     1 Fri Oct  9 19:58:33 2026     ${l.ps}\n`).join(""));
    if (cmd === "brew") return ok(JSON.stringify(w.brew.map((b) => ({ ...b, user: "jorge", file: `/x/${b.name}.plist` }))));
    if (cmd === "du") return ok(`${w.sizeKb}\t${args.at(-1)}\n`);
    if (cmd !== "git") return missing;
    const [, cwd, sub] = args as [string, string, string];
    const repo = repos.find((r) => r === cwd);
    if (sub === "worktree") {
      const blocks = repo ? [`worktree ${repo}\nHEAD aaa\nbranch refs/heads/main\n`, ...w.worktrees.filter((x) => x.path.startsWith(repo)).map((x) => `worktree ${x.path}\nHEAD bbb\n${x.branch ? `branch refs/heads/${x.branch}` : "detached"}\n`)] : [];
      return repo ? ok(blocks.join("\n")) : missing;
    }
    const wt = w.worktrees.find((x) => x.path === cwd);
    if (sub === "status") return ok(wt?.dirty ? " M a.ts\n" : "");
    if (sub === "log") return ok("2026-10-09T10:00:00-06:00\n");
    if (sub === "rev-parse" || sub === "symbolic-ref") return ok("main\n");
    if (sub === "merge-base") return wt?.merged ? ok("") : { ok: false, reason: "exit", code: 1, stdout: "" };
    if (sub === "rev-list") return ok(`${wt?.merged ? 0 : 2}\n`);
    if (sub === "reflog") return ok(Array.from({ length: wt?.commits ?? 0 }, (_, i) => `commit: work ${i}\n`).join("") + "checkout: moving from main to x\n");
    return missing;
  };
}

function fixture(prefix: string) {
  const root = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  const zig = path.join(root, "zigzag");
  const plania = path.join(root, "plania");
  for (const r of [zig, plania]) mkdirSync(path.join(r, ".git"), { recursive: true });
  const agents = path.join(root, "LaunchAgents");
  mkdirSync(agents);
  return { root, zig, plania, agents };
}

const tickAt = (db: ReturnType<typeof makeDb>["db"], fx: ReturnType<typeof fixture>, w: World, now: Date, over: Record<string, unknown> = {}) =>
  runMachineTick(db, now, {
    run: fakeRun(fx.root, [fx.zig, fx.plania], w),
    listDatabases: async (port: number) => (w.dbs[port] ? { version: "17.2", databases: w.dbs[port]!.map((name) => ({ name, sizeBytes: 1000 })) } : null),
    machine: "test-mac",
    projectsRoot: fx.root,
    launchAgentsDir: fx.agents,
    selfPid: 777,
    selfPorts: [3737],
    state: { lastRun: {}, brewNames: [] },
    ...over,
  });

const stateOf = async (raw: pg.Client, locator: string) => (await raw.query("select * from footprints where locator = $1 and released_at is null", [locator])).rows[0];

// ---- primary things, on a whole tick

describe("primary things on a whole tick", () => {
  let raw: pg.Client;
  let close: () => Promise<void>;
  let db: ReturnType<typeof makeDb>["db"];
  const fx = fixture("primary");
  before(async () => {
    raw = await resetTestDb();
    ({ db, close } = makeDb());
  });
  after(async () => {
    await close?.();
    await raw?.end();
  });

  const PG_PS = "/opt/homebrew/opt/postgresql@17/bin/postgres -D /opt/homebrew/var/postgresql@17";
  const world = (): World => ({
    listeners: [
      { pid: 777, cmd: "node", port: 3737, cwd: fx.plania, ps: `node ${fx.plania}/dist/index.js` },
      { pid: 1331, cmd: "postgres", port: 5432, cwd: "/opt/homebrew/var/postgresql@17", ps: PG_PS },
      { pid: 4242, cmd: "node", port: 3069, cwd: fx.zig, ps: `node ${fx.zig}/node_modules/.bin/next dev -p 3069` },
    ],
    dbs: { 5432: ["plania", "micasa", "zigzag", "postgres", "xize", `plania_test_${infer.pathHash(fx.plania)}`, "plania_test_abc123", "zigzag_test_deadbe"] },
    brew: [{ name: "postgresql@17", status: "started" }],
    worktrees: [],
    sizeKb: 10,
  });

  test("the live database, each project's database, postgres, Plania itself, database servers and brew services are primary: no teardown, never orphan or stale", async () => {
    writeFileSync(path.join(fx.agents, "com.plania.server.plist"), "");
    writeFileSync(path.join(fx.agents, "com.google.keystone.agent.plist"), "");
    // rows from before this change: teardowns the old job suggested for primary things, and a declared one
    for (const [kind, locator, teardown] of [["database", "plania@127.0.0.1:5432", "dropdb -h 127.0.0.1 -p 5432 plania"], ["server", "port:3737", "kill 777"]] as const) {
      await raw.query(`insert into footprints (machine, kind, locator, source, teardown, state, first_seen_at, last_seen_at) values ('test-mac', $1, $2, 'observed', $3, 'orphan', now(), now())`, [kind, locator, teardown]);
    }
    await raw.query(
      `insert into footprints (machine, kind, locator, source, purpose, teardown, project_id, state, declared_at)
       values ('test-mac', 'database', 'micasa@127.0.0.1:5432', 'declared', 'migration rehearsal', 'dropdb -h 127.0.0.1 -p 5432 micasa_rehearsal', (select id from projects where slug = 'micasa'), 'live', now())`,
    );

    await tickAt(db, fx, world(), new Date());
    const inv = Object.fromEntries((await machineInventory(db, "test-mac")).map((r) => [r.locator, r]));

    for (const [locator, state] of [["plania@127.0.0.1:5432", "live"], ["zigzag@127.0.0.1:5432", "live"], ["postgres@127.0.0.1:5432", "system"], ["port:3737", "self"], ["postgres:5432", "system"], ["brew:postgresql@17", "system"], ["launchagent:com.plania.server", "live"]] as const) {
      const r = inv[locator]!;
      assert.deepEqual([r.state, r.teardown, r.details.primary], [state, "", true], locator);
    }
    // the old suggestions are gone from rows that already existed
    assert.equal(inv["plania@127.0.0.1:5432"]!.teardown, "");
    assert.equal(inv["port:3737"]!.teardown, "");
    // what a declaration said stays as declared, even on a primary name
    const micasa = inv["micasa@127.0.0.1:5432"]!;
    assert.deepEqual([micasa.source, micasa.teardown, micasa.purpose, micasa.details.primary, micasa.state], ["both", "dropdb -h 127.0.0.1 -p 5432 micasa_rehearsal", "migration rehearsal", true, "live"]);

    // nothing in the inventory offers to drop a project's database or postgres, or to kill Plania
    const teardowns = Object.values(inv).map((r) => r.teardown);
    assert.ok(!teardowns.some((t) => /dropdb .* '?(plania|zigzag|postgres|template[01])'?$/.test(t)), teardowns.join("\n"));
    assert.ok(!teardowns.includes("kill 777"));
    assert.ok(!teardowns.some((t) => /plania\.server/.test(t)));
  });

  test("what agents left behind is not primary: copies and test databases get their dropdb, an unknown database is an orphan, a foreign LaunchAgent keeps its unload", async () => {
    const inv = Object.fromEntries((await machineInventory(db, "test-mac")).map((r) => [r.locator, r]));
    const xize = inv["xize@127.0.0.1:5432"]!;
    assert.deepEqual([xize.state, xize.details.primary, xize.teardown], ["orphan", undefined, "dropdb -h 127.0.0.1 -p 5432 xize"]);
    for (const name of [`plania_test_${infer.pathHash(fx.plania)}`, "plania_test_abc123", "zigzag_test_deadbe"]) {
      const r = inv[`${name}@127.0.0.1:5432`]!;
      assert.deepEqual([r.details.primary, r.state, r.teardown], [undefined, "live", `dropdb -h 127.0.0.1 -p 5432 ${name}`], name);
    }
    const google = inv["launchagent:com.google.keystone.agent"]!;
    assert.deepEqual([google.details.primary, google.state, /^launchctl unload /.test(google.teardown)], [undefined, "system", true]);
    // a server in a project's checkout is not primary either
    assert.deepEqual([inv["port:3069"]!.details.primary, inv["port:3069"]!.teardown], [undefined, "kill 4242"]);
  });

  test("audit: the orphan and the test database whose checkout is gone go to the machine findings, with their teardown as the hint; primary rows never appear", async () => {
    const findings = await footprintFindings(db, { projectless: true });
    const by = (code: string) => findings.filter((f) => f.code === code);
    assert.deepEqual(by("FOOTPRINT_ORPHAN").map((f) => f.detail.split(": ")[0]), ["database xize@127.0.0.1:5432"]);
    assert.equal(by("FOOTPRINT_ORPHAN")[0]!.fix_hint, "dropdb -h 127.0.0.1 -p 5432 xize");
    // the hash of the main checkout is known; abc123 belongs to no checkout of the plania repo
    assert.deepEqual(by("DATABASE_WITHOUT_WORKTREE").map((f) => f.detail.split(": ")[0]), ["database plania_test_abc123@127.0.0.1:5432"]);
    assert.equal(by("DATABASE_WITHOUT_WORKTREE")[0]!.fix_hint, "dropdb -h 127.0.0.1 -p 5432 plania_test_abc123");
    assert.ok(!findings.some((f) => /plania@|postgres|port:3737|brew:/.test(f.detail)), "primary rows are not findings");
    // a zigzag test database is the project's: it is in the zigzag audit
    const zig = await findProject(db, "zigzag");
    const project = (await auditProject(db, zig)).filter((f) => f.code.startsWith("DATABASE_") || f.code.startsWith("FOOTPRINT_"));
    assert.deepEqual(project.map((f) => f.code), ["DATABASE_WITHOUT_WORKTREE"]);
    assert.match(project[0]!.detail, /zigzag_test_deadbe/);
  });

  test("a worktree path makes its test database known: removing the worktree turns it into a finding", async () => {
    const wtPath = path.join(fx.zig, ".claude", "worktrees", "box");
    mkdirSync(wtPath, { recursive: true });
    const w = world();
    w.worktrees.push({ path: wtPath, branch: "jl/box", dirty: false, merged: false, commits: 0 });
    w.dbs[5432]!.push(`zigzag_test_${infer.pathHash(wtPath)}`);
    await tickAt(db, fx, w, new Date());
    const zig = await findProject(db, "zigzag");
    const codes = (await auditProject(db, zig)).filter((f) => f.code === "DATABASE_WITHOUT_WORKTREE").map((f) => f.detail.split(": ")[0]);
    assert.deepEqual(codes, ["database zigzag_test_deadbe@127.0.0.1:5432"], "the live worktree's database is fine");
    w.worktrees.length = 0; // the worktree is removed
    await tickAt(db, fx, w, new Date(Date.now() + 1000));
    const after = (await auditProject(db, zig)).filter((f) => f.code === "DATABASE_WITHOUT_WORKTREE").map((f) => f.detail.split(": ")[0]).sort();
    assert.deepEqual(after, ["database zigzag_test_deadbe@127.0.0.1:5432", `database zigzag_test_${infer.pathHash(wtPath)}@127.0.0.1:5432`].sort());
  });

  test("on a scratch Postgres the project's database is an ordinary row (dropdb, secondary-server flag) and the undeclared server is a finding", async () => {
    const w = world();
    w.listeners.push({ pid: 2000, cmd: "postgres", port: 5433, cwd: "/opt/homebrew/var/postgresql@17b", ps: "/opt/homebrew/opt/postgresql@17/bin/postgres -D /opt/homebrew/var/postgresql@17b" });
    w.dbs[5433] = ["zigzag", "postgres", "plania"];
    await tickAt(db, fx, w, new Date());
    const inv = Object.fromEntries((await machineInventory(db, "test-mac")).map((r) => [r.locator, r]));
    const scratch = inv["zigzag@127.0.0.1:5433"]!;
    assert.deepEqual([scratch.details.primary, scratch.details.on_secondary_server, scratch.teardown, scratch.project, scratch.state], [undefined, true, "dropdb -h 127.0.0.1 -p 5433 zigzag", "zigzag", "live"]);
    assert.equal(inv["plania@127.0.0.1:5433"]!.teardown, "dropdb -h 127.0.0.1 -p 5433 plania");
    assert.deepEqual([inv["postgres@127.0.0.1:5433"]!.details.primary, inv["postgres@127.0.0.1:5433"]!.teardown], [true, ""]);
    // the main server's own are untouched
    assert.deepEqual([inv["zigzag@127.0.0.1:5432"]!.details.primary, inv["zigzag@127.0.0.1:5432"]!.details.on_secondary_server, inv["zigzag@127.0.0.1:5432"]!.teardown], [true, undefined, ""]);
    // the db_server stays primary (no teardown), but nobody declared it: a finding that never stops it
    assert.deepEqual([inv["postgres:5433"]!.details.primary, inv["postgres:5433"]!.teardown], [true, ""]);
    const found = (await footprintFindings(db, { projectless: true })).filter((f) => f.code === "SECONDARY_DB_SERVER");
    assert.deepEqual(found.map((f) => f.detail.split(": ")[0]), ["db_server postgres:5433"]);
    assert.match(found[0]!.fix_hint, /register_footprint/);
    assert.ok(!/\b(stop|kill|pg_ctl)\b/.test(found[0]!.fix_hint));
    // declared: no longer a finding
    await raw.query("update footprints set source = 'both', purpose = 'scratch pg' where locator = 'postgres:5433'");
    assert.deepEqual((await footprintFindings(db, { projectless: true })).filter((f) => f.code === "SECONDARY_DB_SERVER"), []);
  });
});

// ---- stale on a whole tick, the audit, the resume line and the inbox

describe("stale rows on a whole tick", () => {
  let raw: pg.Client;
  let close: () => Promise<void>;
  let db: ReturnType<typeof makeDb>["db"];
  const fx = fixture("stale");
  const wt = path.join(fx.zig, ".claude", "worktrees", "box");
  let t0: Date;
  const at = (ms: number) => new Date(t0.getTime() + ms);

  before(async () => {
    raw = await resetTestDb();
    ({ db, close } = makeDb());
    mkdirSync(wt, { recursive: true });
    await createTask(db, { project: "zigzag", kind: "initiative", title: "Sandbox", scope: "PRD", integration_branch: "jl/sandbox" }, ctx); // ZIG-I1
    await createTask(db, { project: "zigzag", title: "Box", scope: "s", checks: ["c"], parent_key: "ZIG-I1", status: "Ready" }, ctx); // ZIG-I1-1
    await claim(db, { project: "zigzag", key: "ZIG-I1-1", workspace: { worktree_path: wt, branch: "jl/sandbox" } }, ctx);
    t0 = new Date();
  });
  after(async () => {
    await close?.();
    await raw?.end();
  });

  const world = (over: Partial<World["worktrees"][number]> = {}): World => ({
    listeners: [{ pid: 4242, cmd: "node", port: 3069, cwd: `${wt}/apps/web`, ps: `node ${wt}/node_modules/.bin/next dev -p 3069` }],
    dbs: { 5432: [] },
    brew: [],
    worktrees: [{ path: wt, branch: "jl/sandbox", dirty: false, merged: false, commits: 0, ...over }],
    sizeKb: 2 * 1024 * 1024,
  });
  // postgres must listen for its databases to be read
  const withDb = (w: World): World => ({
    ...w,
    listeners: [...w.listeners, { pid: 1331, cmd: "postgres", port: 5432, cwd: "/pg", ps: "/opt/homebrew/opt/postgresql@17/bin/postgres -D /opt/homebrew/var/postgresql@17" }],
    dbs: { 5432: ["zigzag_zig_i1_1_copy"] },
  });

  test("while the claim is live everything is live; without a claim the server goes stale after 2h and the database after 24h", async () => {
    await tickAt(db, fx, withDb(world()), t0);
    for (const l of [wt, "port:3069", "zigzag_zig_i1_1_copy@127.0.0.1:5432"]) assert.equal((await stateOf(raw, l)).state, "live", l);

    await claim(db, { project: "zigzag", key: "ZIG-I1-1", action: "release" }, ctx);
    await tickAt(db, fx, withDb(world()), at(1.9 * H));
    assert.equal((await stateOf(raw, "port:3069")).state, "live", "unclaimed for under 2h");
    await tickAt(db, fx, withDb(world()), at(2.2 * H));
    const server = await stateOf(raw, "port:3069");
    assert.deepEqual([server.state, server.details.stale_reason], ["stale", "sin claim"]);
    assert.ok(Math.abs(new Date(server.details.stale_since).getTime() - t0.getTime()) < 60_000, "since the claim lapsed");
    assert.equal((await stateOf(raw, "zigzag_zig_i1_1_copy@127.0.0.1:5432")).state, "live", "a database waits 24h");
    await tickAt(db, fx, withDb(world()), at(24.5 * H));
    assert.equal((await stateOf(raw, "zigzag_zig_i1_1_copy@127.0.0.1:5432")).state, "stale");
    assert.equal((await stateOf(raw, wt)).state, "live", "an unmerged worktree has no clock");
  });

  test("a stale row records why, and the reason is stable between ticks (the row is not rewritten for a plain refresh)", async () => {
    const stale = () => raw.query("select locator, state, details, updated_at from footprints where locator in ('port:3069', 'zigzag_zig_i1_1_copy@127.0.0.1:5432') order by locator");
    const before = (await stale()).rows;
    await tickAt(db, fx, withDb(world()), at(24.6 * H));
    assert.deepEqual((await stale()).rows, before);
  });

  test("the ticket closing makes the reason the ticket's", async () => {
    // the claim was released a day ago, so the owner is the ticket that started it, not the initiative the branch points at
    assert.equal((await raw.query("select t.key from footprints f join tasks t on t.id = f.task_id where f.locator = 'port:3069'")).rows[0].key, "ZIG-I1-1");
    await raw.query("update tasks set status = 'Done', status_changed_at = $1 where key = 'ZIG-I1-1'", [at(25 * H)]);
    await tickAt(db, fx, withDb(world()), at(28 * H));
    const server = await stateOf(raw, "port:3069");
    assert.deepEqual([server.state, server.details.stale_reason, new Date(server.details.stale_since).toISOString()], ["stale", "ticket ZIG-I1-1 Done", at(25 * H).toISOString()]);
    // closed 3 hours ago is under a database's 24h, but its claim lapsed over a day ago
    assert.equal((await stateOf(raw, "zigzag_zig_i1_1_copy@127.0.0.1:5432")).details.stale_reason, "sin claim");
    await raw.query("update tasks set status = 'In progress', status_changed_at = now() where key = 'ZIG-I1-1'");
  });

  test("worktrees: merged work and clean is stale; with uncommitted changes it is not; the squash merge counts through branches.merged_at", async () => {
    await tickAt(db, fx, withDb(world({ merged: true, commits: 3 })), at(29 * H));
    const w = await stateOf(raw, wt);
    assert.deepEqual([w.state, w.details.stale_reason, w.details.merged, w.details.own_commits, w.details.dirty], ["stale", "rama fusionada", true, 3, false]);
    await tickAt(db, fx, withDb(world({ merged: true, commits: 3, dirty: true })), at(30 * H));
    assert.equal((await stateOf(raw, wt)).state, "live");
    // a new worktree on an already-merged commit: git says merged, but nothing was done in it
    await tickAt(db, fx, withDb(world({ merged: true, commits: 0 })), at(31 * H));
    assert.equal((await stateOf(raw, wt)).state, "live");
    // squash: not an ancestor, GitHub says merged
    const zig = await findProject(db, "zigzag");
    await raw.query("insert into branches (project_id, name, owner_task_id, merged_at) values ($1, 'jl/sandbox', (select id from tasks where key = 'ZIG-I1'), $2) on conflict (project_id, name) do update set merged_at = $2", [zig.id, at(2 * H)]);
    await tickAt(db, fx, withDb(world({ merged: false, commits: 3 })), at(32 * H));
    const sq = await stateOf(raw, wt);
    assert.deepEqual([sq.state, sq.details.stale_reason, new Date(sq.details.stale_since).toISOString()], ["stale", "rama fusionada", at(2 * H).toISOString()]);
  });

  test("audit: FOOTPRINT_STALE for the server and database with their teardown, WORKTREE_MERGED_NOT_REMOVED for the worktree", async () => {
    const zig = await findProject(db, "zigzag");
    const findings = (await auditProject(db, zig)).filter((f) => f.code.startsWith("FOOTPRINT_") || f.code.startsWith("WORKTREE_"));
    const by = (code: string) => findings.filter((f) => f.code === code);
    assert.deepEqual(by("FOOTPRINT_STALE").map((f) => f.detail.split(": ")[0]).sort(), ["database zigzag_zig_i1_1_copy@127.0.0.1:5432", "server port:3069"]);
    assert.deepEqual(by("FOOTPRINT_STALE").map((f) => f.fix_hint).sort(), ["dropdb -h 127.0.0.1 -p 5432 zigzag_zig_i1_1_copy", "kill 4242"]);
    assert.match(by("FOOTPRINT_STALE").find((f) => f.detail.startsWith("server"))!.detail, /^server port:3069: (sin claim desde hace|ticket ZIG-I1-1 Done hace) \d+ (min|h|d)$/);
    const removed = by("WORKTREE_MERGED_NOT_REMOVED");
    assert.equal(removed.length, 1);
    assert.equal(removed[0]!.key, "ZIG-I1-1");
    assert.match(removed[0]!.fix_hint, /^git -C .*zigzag worktree remove .*box/);
    assert.match(removed[0]!.detail, /rama fusionada hace/);
  });

  test("get_resume: one machine line over the project's rows", async () => {
    const zig = await findProject(db, "zigzag");
    const digest = await resumeDigest(db, zig);
    // server (stale), database (stale), worktree 2 GB (stale); the postgres server belongs to no project
    assert.equal(digest.machine, "1 servidor, 3 obsoletos, 2.0 GB de worktrees");
    const filmia = await findProject(db, "filmia");
    assert.equal((await resumeDigest(db, filmia)).machine, null, "a project with nothing on the Mac has no line");
  });

  test("inbox: stale and orphan items older than 24h show, younger ones do not", async () => {
    const zig = await findProject(db, "zigzag");
    // everything above went stale within the last real minute: nothing is a day old yet
    assert.deepEqual((await inbox(db, zig)).items.filter((i) => i.kind === "footprint"), []);
    await raw.query("update footprints set details = jsonb_set(details, '{stale_since}', to_jsonb((now() - interval '30 hours')::text)) where locator = 'port:3069'");
    await raw.query("update footprints set details = jsonb_set(details, '{stale_since}', to_jsonb((now() - interval '3 hours')::text)) where kind = 'database'");
    const items = (await inbox(db, zig)).items.filter((i) => i.kind === "footprint");
    assert.equal(items.length, 1);
    const [it] = items;
    assert.deepEqual([it!.project, it!.key, it!.title, it!.target?.teardown], ["zigzag", "ZIG-I1-1", "server port:3069", "kill 4242"]);
    assert.match(it!.why, /^obsoleto: /);
    assert.ok(it!.wait_s >= 29 * 3600);

    // an orphan nobody owns goes under the machine in "all", once it is a day old
    await raw.query(`insert into footprints (machine, kind, locator, source, teardown, state, first_seen_at, last_seen_at) values ('test-mac', 'database', 'xize@127.0.0.1:5432', 'observed', 'dropdb xize', 'orphan', now() - interval '2 hours', now())`);
    await raw.query(`insert into footprints (machine, kind, locator, source, teardown, state, first_seen_at, last_seen_at) values ('test-mac', 'database', 'old@127.0.0.1:5432', 'observed', 'dropdb old', 'orphan', now() - interval '26 hours', now())`);
    const all = (await inbox(db, "all")).items.filter((i) => i.kind === "footprint");
    assert.deepEqual(all.map((i) => `${i.project}:${i.title}`).sort(), ["machine:database old@127.0.0.1:5432", "zigzag:server port:3069"]);
    assert.equal(all.find((i) => i.project === "machine")!.why.startsWith("sin dueño"), true);
  });
});

// ---- ghosts

describe("ghost rows", () => {
  let raw: pg.Client;
  let close: () => Promise<void>;
  let db: ReturnType<typeof makeDb>["db"];
  let zig: { id: string };
  const dir = (): Directory => ({ projects: [{ id: zig.id, slug: "zigzag", keyPrefix: "ZIG" }], repos: [], worktrees: new Map(), tasksById: new Map(), tasksByKey: new Map(), branchOwner: new Map(), claimed: [] });
  const base = Date.UTC(2026, 9, 9, 12, 0, 0);
  const at = (min: number) => new Date(base + min * 60_000);
  before(async () => {
    raw = await resetTestDb();
    ({ db, close } = makeDb());
    zig = await findProject(db, "zigzag");
  });
  after(async () => {
    await close?.();
    await raw?.end();
  });
  const tick = (min: number, ran: string[], items: Observed[] = []) =>
    reconcile(db, { machine: "test-mac", now: at(min), dir: dir(), inferred: items.map((item) => ({ item, owner: { projectId: null, taskId: null, sessionId: null, repo: null, via: "none" as const }, repoPath: null })), ran: new Set(ran) });
  const declare = (kind: string, locator: string, source: string, extra = "") =>
    raw.query(
      `insert into footprints (machine, kind, locator, source, purpose, teardown, project_id, state, declared_at, first_seen_at, last_seen_at, misses)
       values ('test-mac', $1, $2, $3, 'p', 't', (select id from projects where slug = 'zigzag'), 'live', $4, ${extra || "null, null, 0"})`,
      [kind, locator, source, at(0)],
    );

  test("declared and never seen: live for 5 minutes, then a ghost when its collector ran; seeing it brings it back", async () => {
    await declare("server", "port:4100", "declared");
    await tick(4, ["ports"]);
    assert.equal((await stateOf(raw, "port:4100")).state, "live");
    const r = await tick(6, ["ports"]);
    assert.equal(r.ghosted, 1);
    const g = await stateOf(raw, "port:4100");
    assert.deepEqual([g.state, g.details.ghost_since, g.source], ["ghost", at(6).toISOString(), "declared"]);
    await tick(7, ["ports"], [{ kind: "server", locator: "port:4100", details: { port: 4100 } }]);
    const back = await stateOf(raw, "port:4100");
    assert.deepEqual([back.state, back.source, back.details.ghost_since], ["live", "both", undefined]);
  });

  test("declared and observed before: two ticks of its collector without it make a ghost", async () => {
    await declare("server", "port:4101", "both", "$4, $4, 0");
    await tick(10, ["ports"]);
    assert.equal((await stateOf(raw, "port:4101")).state, "live");
    await tick(11, ["ports"]);
    assert.equal((await stateOf(raw, "port:4101")).state, "ghost");
  });

  test("a ghost is released an hour later with footprint.released and reason ghost; the Mac is not touched", async () => {
    const before = (await raw.query("select count(*)::int as n from events where type = 'footprint.released'")).rows[0].n;
    await tick(6 + 59, ["ports"]);
    assert.equal((await stateOf(raw, "port:4101"))?.state, "ghost", "a ghost row is not released before its hour");
    const r = await tick(11 + 61, ["ports"]);
    assert.ok(r.released >= 1);
    assert.equal(await stateOf(raw, "port:4101"), undefined);
    const ev = await raw.query("select payload, task_key from events where type = 'footprint.released' order by id desc");
    assert.ok(ev.rows.length > before);
    assert.ok(ev.rows.every((e) => e.payload.reason === "ghost"));
    assert.ok(ev.rows.some((e) => e.payload.locator === "port:4101"));
    const row = (await raw.query("select state, released_at from footprints where locator = 'port:4101'")).rows[0];
    assert.deepEqual([row.state, row.released_at !== null], ["released", true]);
  });

  test("a collector that did not run, or a kind without one, never makes a ghost", async () => {
    await declare("server", "port:4102", "declared");
    await declare("cache", "fixtures/seed", "declared");
    await declare("container", "docker:pg", "declared");
    await tick(500, ["procs"]); // ports did not run, docker is missing
    for (const l of ["port:4102", "fixtures/seed", "docker:pg"]) assert.equal((await stateOf(raw, l)).state, "live", l);
    await tick(501, ["ports", "procs", "docker"]);
    assert.equal((await stateOf(raw, "port:4102")).state, "ghost");
    assert.equal((await stateOf(raw, "docker:pg")).state, "ghost");
    assert.equal((await stateOf(raw, "fixtures/seed")).state, "live", "a cache has no collector");
  });
});

// ---- services that start at login

describe("SERVICE_STARTS_AT_LOGIN", () => {
  let raw: pg.Client;
  let close: () => Promise<void>;
  let db: ReturnType<typeof makeDb>["db"];
  const fx = fixture("services");
  before(async () => {
    raw = await resetTestDb();
    ({ db, close } = makeDb());
  });
  after(async () => {
    await close?.();
    await raw?.end();
  });
  const w = (brew: World["brew"]): World => ({ listeners: [], dbs: {}, brew, worktrees: [], sizeKb: 1 });

  test("what was there when Plania began watching never fires; what appeared afterwards does, with a hint that does not stop it", async () => {
    // when Plania started watching, the Mac already had Google's updater, an old brew Postgres and Plania's own agent
    for (const f of ["com.google.keystone.agent", "com.plania.server"]) writeFileSync(path.join(fx.agents, `${f}.plist`), "");
    const t0 = new Date();
    await tickAt(db, fx, w([{ name: "postgresql@14", status: "started" }]), t0);
    assert.deepEqual(await footprintFindings(db, { projectless: true }), []);

    // half an hour later an agent started redis through brew and dropped a LaunchAgent of its own
    writeFileSync(path.join(fx.agents, "com.example.tunnel.plist"), "");
    const t1 = new Date(t0.getTime() + 30 * 60_000);
    await tickAt(db, fx, w([{ name: "postgresql@14", status: "started" }, { name: "redis", status: "started" }, { name: "mysql", status: "error" }]), t1);
    const found = (await footprintFindings(db, { projectless: true })).filter((f) => f.code === "SERVICE_STARTS_AT_LOGIN");
    assert.deepEqual(found.map((f) => f.detail.split(": ")[0]).sort(), ["service brew:redis", "service launchagent:com.example.tunnel"]);
    assert.ok(found.every((f) => !/\b(stop|unload|kill)\b/.test(f.fix_hint)), "never a command that stops it");
    assert.match(found[0]!.fix_hint, /register_footprint/);
  });

  test("a service an agent declared is not reported; neither is one that is attributed to a repo", async () => {
    await raw.query(`update footprints set source = 'both', purpose = 'redis for tests', project_id = (select id from projects where slug = 'zigzag') where locator = 'brew:redis'`);
    const found = (await footprintFindings(db, { projectless: true })).filter((f) => f.code === "SERVICE_STARTS_AT_LOGIN");
    assert.deepEqual(found.map((f) => f.detail.split(": ")[0]), ["service launchagent:com.example.tunnel"]);
  });
});
