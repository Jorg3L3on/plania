// The machine footprint job (PLA-I1-2): parsers over recorded command output, the ignore list,
// owner inference (worktree → branch → ticket → session, database names), and reconcile
// (seen / gone after two misses / skipped collectors leave rows alone).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask, claim } = await import("../src/mcp/writes.js");
const { findProject } = await import("../src/mcp/queries.js");
const parse = await import("../src/jobs/machine/parse.js");
const { execRun } = await import("../src/jobs/machine/run.js");
const infer = await import("../src/jobs/machine/infer.js");
const collect = await import("../src/jobs/machine/collect.js");
const { reconcile } = await import("../src/jobs/machine/reconcile.js");
const { runMachineTick, machineInventory } = await import("../src/jobs/machine/index.js");
const { bus } = await import("../src/events.js");

import type { Directory, Observed, TaskLite } from "../src/jobs/machine/infer.js";
import type { Run, RunResult } from "../src/jobs/machine/run.js";

const fx = (name: string) => readFileSync(new URL(`./fixtures/machine/${name}`, import.meta.url), "utf8");
const ZIG = "/Users/jorgeleon/Developer/Projects/zigzag";
const PLANIA = "/Users/jorgeleon/Developer/Projects/plania";
const ctx = { actor: { agent: "claude", session_id: "s1", machine: "test-mac" } };
const NOW0 = new Date();
const ok = (stdout: string): RunResult => ({ ok: true, stdout });
const missing: RunResult = { ok: false, reason: "missing", stdout: "" };

// A Directory by hand: zigzag is a project with a linked worktree on a branch owned by ZIG-I4-1,
// which session "s-zig" holds; plania is a repo that is not a project.
const ZIG_ID = "00000000-0000-0000-0000-00000000000a";
const WT = `${ZIG}/.claude/worktrees/zig-i4-sandbox-check-99d31f`;
const future = new Date(Date.now() + 3600_000);
const task = (id: string, key: string, over: Partial<TaskLite> = {}): TaskLite => ({ id, key, projectId: ZIG_ID, status: "In progress", owner: null, leaseUntil: null, workspace: null, ...over });
const claimed = task("t1", "ZIG-I4-1", { owner: { agent: "claude", session_id: "s-zig" }, leaseUntil: future, workspace: { worktree_path: WT, branch: "zig-i4-box" } });
const initiative = task("t0", "ZIG-I5");
function directory(over: Partial<Directory> = {}): Directory {
  const tasks = [claimed, initiative];
  return {
    projects: [{ id: ZIG_ID, slug: "zigzag", keyPrefix: "ZIG" }],
    repos: [
      { name: "zigzag", path: ZIG, projectId: ZIG_ID, projectSlug: "zigzag" },
      { name: "plania", path: PLANIA, projectId: null, projectSlug: null },
    ],
    worktrees: new Map([[WT, { path: WT, repo: "zigzag", branch: "zig-i4-box" }]]),
    tasksById: new Map(tasks.map((t) => [t.id, t])),
    tasksByKey: new Map([[ZIG_ID, new Map(tasks.map((t) => [t.key, t]))]]),
    branchOwner: new Map([[`${ZIG_ID}\0zig-i4-box`, "t1"]]),
    claimed: [claimed],
    ...over,
  };
}

describe("parsers over recorded output", () => {
  test("lsof listeners: one entry per process, IPv4 and IPv6 sockets merged", () => {
    const l = parse.parseListeners(fx("lsof-listen.txt"));
    const byCmd = Object.fromEntries(l.map((x) => [`${x.command}:${x.pid}`, x.ports]));
    assert.deepEqual(byCmd["postgres:1331"], [5432]);
    assert.deepEqual(byCmd["postgres:41152"], [5433]);
    assert.deepEqual(byCmd["node:10319"], [3069]);
    assert.deepEqual(byCmd["ControlCenter:1106"], [7000, 5000]);
    assert.deepEqual(byCmd["node:86729"], [3737]);
  });

  test("lsof cwd and ps lines", () => {
    const cwds = parse.parseCwds(fx("lsof-cwd.txt"));
    assert.equal(cwds.get(10319), ZIG);
    assert.equal(cwds.get(1106), "/");
    assert.equal(cwds.get(80211), "/Users/jorgeleon/Library/Application Support/Dia/User Data/Default/AgentServer");
    const ps = parse.parsePs(fx("ps.txt"));
    const next = ps.find((p) => p.pid === 10318)!;
    assert.equal(next.ppid, 10301);
    assert.match(next.command, /next dev --turbopack -p 3069/);
    assert.equal(next.startedAt?.getTime(), new Date(2026, 9, 9, 19, 58, 33).getTime()); // lstart is local time
  });

  test("git worktree list --porcelain with detached worktrees", () => {
    const list = parse.parseWorktrees(fx("git-worktree-zigzag.txt"));
    assert.equal(list.length, 4);
    assert.equal(list[0]!.branch, "slice/zig-11-migration-guards");
    assert.deepEqual(list.slice(1).map((w) => w.detached), [true, true, true]);
    assert.equal(list[1]!.path, `${ZIG}/.claude/worktrees/tickets-creation-mobile-initiative-d5b317`);
    assert.match(list[2]!.head!, /^9f42059/);
  });

  test("brew services skip the ones that never ran; docker json lines; du; redaction", () => {
    const brew = parse.parseBrewServices(fx("brew-services.json"));
    assert.deepEqual(brew.map((s) => s.name).filter((n) => n.startsWith("postgresql")), ["postgresql@14", "postgresql@17"]);
    assert.ok(brew.every((s) => s.status !== "none"));
    const docker = parse.parseDockerPs('{"ID":"abc","Names":"pg-scratch","Image":"postgres:17","State":"running","Status":"Up 2 hours","Ports":"0.0.0.0:5434->5432/tcp","CreatedAt":"2026-10-09"}\n');
    assert.deepEqual(docker.map((c) => c.name), ["pg-scratch"]);
    assert.equal(parse.parseDu("2621440\t/some/path\n"), 2621440);
    assert.equal(parse.redact("mcp-server-postgres postgresql://jorge:s3cret@localhost:5432/micasa"), "mcp-server-postgres postgresql://jorge:***@localhost:5432/micasa");
  });

  test("helper processes: headless browsers, playwright-mcp, tunnels; not their children or the npm wrapper", () => {
    const kinds = Object.fromEntries(parse.parsePs(fx("ps-extra.txt")).map((p) => [p.pid, parse.classifyProc(p.command)]));
    assert.deepEqual(kinds, { 31001: "headless_browser", 31002: null, 31010: "ngrok", 31011: "cloudflared", 31020: null });
    const real = Object.fromEntries(parse.parsePs(fx("ps.txt")).map((p) => [p.pid, parse.classifyProc(p.command)]));
    assert.equal(real[2176], "playwright");
    assert.equal(real[1828], null); // npm exec mcp-server-postgres
    assert.equal(real[12206], null); // chrome_crashpad_handler
  });
});

describe("collectors", () => {
  // Answers the commands the process collector runs from the recorded output.
  const fakeRun = (over: Record<string, RunResult> = {}): Run => async (cmd, args) => {
    const key = cmd === "lsof" && args.includes("cwd") ? "lsof-cwd" : cmd;
    const canned: Record<string, RunResult> = { lsof: ok(fx("lsof-listen.txt")), "lsof-cwd": ok(fx("lsof-cwd.txt")), ps: ok(fx("ps.txt") + fx("ps-extra.txt")), docker: missing, ...over };
    return canned[key] ?? missing;
  };

  test("today's listeners: postgres, next dev and plania itself are kept; ControlCenter, rapportd, Spotify and Dia are ignored", async () => {
    const out = await collect.collectProcesses(fakeRun(), directory(), { selfPid: 999999, selfPorts: [3737] });
    assert.deepEqual(out.ran, ["ports", "procs"]);
    const byLocator = Object.fromEntries(out.items.map((i) => [i.locator, i]));
    assert.deepEqual(
      out.items.filter((i) => i.kind === "server" || i.kind === "db_server").map((i) => i.locator).sort(),
      ["port:3069", "port:3737", "postgres:5432", "postgres:5433"],
    );
    assert.equal(byLocator["postgres:5433"]!.details.data_dir, "/opt/homebrew/var/postgresql@17");
    assert.equal(byLocator["port:3069"]!.cwd, ZIG);
    assert.equal(byLocator["port:3737"]!.self, true);
    assert.ok(!out.items.some((i) => /ControlCenter|rapportd|Spotify|agent-server/.test(JSON.stringify(i))));
    assert.deepEqual(
      out.items.filter((i) => i.kind === "browser" || i.kind === "tunnel").map((i) => i.locator).sort(),
      ["pid:2176", "pid:31001", "pid:31010", "pid:31011"],
    );
  });

  test("a missing docker is a skipped collector, not an error; lsof failing skips only the ports", async () => {
    assert.deepEqual(await collect.collectDocker(fakeRun()), { ran: [], items: [] });
    const up = await collect.collectDocker(fakeRun({ docker: ok('{"ID":"abc","Names":"pg-scratch","Image":"postgres:17","State":"running","Status":"Up","Ports":"","CreatedAt":""}\n') }));
    assert.deepEqual([up.ran, up.items.map((i) => i.locator)], [["docker"], ["docker:pg-scratch"]]);
    const noLsof = await collect.collectProcesses(fakeRun({ lsof: { ok: false, reason: "timeout", stdout: "" } }), directory(), { selfPid: 1, selfPorts: [] });
    assert.ok(!noLsof.ran.includes("ports") && noLsof.ran.includes("procs"));
    const r = await execRun("plania-no-such-binary", ["x"]);
    assert.deepEqual(r, { ok: false, reason: "missing", stdout: "" });
  });

  test("worktrees: branch or detached, dirty, merged into the base, last commit; sizes only when due", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "machine-wt-"));
    const wt = path.join(root, ".claude", "worktrees", "a");
    mkdirSync(wt, { recursive: true });
    const listing = `worktree ${root}\nHEAD aaa\nbranch refs/heads/main\n\nworktree ${wt}\nHEAD bbb\ndetached\n`;
    const calls: string[] = [];
    const run: Run = async (cmd, args) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      const sub = args[2];
      if (cmd === "du") return ok(`4096\t${wt}\n`);
      if (sub === "worktree") return ok(listing);
      if (sub === "symbolic-ref") return ok("origin/main\n");
      if (sub === "rev-parse") return ok("sha\n");
      if (sub === "status") return ok(" M a.ts\n?? b.ts\n");
      if (sub === "log") return ok("2026-10-09T17:57:28-06:00\n");
      if (sub === "merge-base") return { ok: false, reason: "exit", code: 1, stdout: "" };
      if (sub === "rev-list") return ok("3\n");
      return missing;
    };
    const repos = [{ name: "zigzag", path: root, projectId: ZIG_ID, projectSlug: "zigzag" }];
    const previous = new Map([[wt, { size_kb: 111, size_at: "2026-10-09T00:00:00.000Z" }]]);
    const now = new Date("2026-10-09T20:00:00Z");
    const cheap = await collect.collectWorktrees(run, repos, { sizes: false, previous, now });
    assert.ok(!calls.some((c) => c.startsWith("du")));
    const d = cheap.items[0]!.details;
    assert.deepEqual([d.detached, d.branch, d.dirty, d.dirty_count, d.merged, d.ahead, d.base, d.size_kb], [true, null, true, 2, false, 3, "origin/main", 111]);
    const sized = await collect.collectWorktrees(run, repos, { sizes: true, previous, now });
    assert.deepEqual([sized.items[0]!.details.size_kb, sized.items[0]!.details.size_at], [4096, now.toISOString()]);
  });
});

describe("owner inference", () => {
  test("a process whose cwd is inside a worktree on a claimed ticket's branch resolves to that ticket and its session", () => {
    const dir = directory({ claimed: [] }); // no workspace match: the branches table alone finds the ticket
    const o = infer.ownerOfPath(dir, `${WT}/apps/web`, new Date());
    assert.deepEqual([o.projectId, o.taskId, o.sessionId, o.repo, o.via], [ZIG_ID, "t1", "s-zig", "zigzag", "worktree"]);
  });

  test("a live claim whose workspace names the worktree wins; an expired claim leaves the ticket without a session", () => {
    const viaClaim = infer.ownerOfPath(directory({ branchOwner: new Map() }), WT, new Date());
    assert.deepEqual([viaClaim.taskId, viaClaim.sessionId], ["t1", "s-zig"]);
    const lapsed = task("t1", "ZIG-I4-1", { owner: claimed.owner, leaseUntil: new Date(Date.now() - 1000), workspace: claimed.workspace });
    const dir = directory({ tasksById: new Map([["t1", lapsed]]), claimed: [lapsed] });
    const o = infer.ownerOfPath(dir, WT, new Date());
    assert.deepEqual([o.taskId, o.sessionId], ["t1", null]);
  });

  test("the main checkout resolves to the project only; a repo that is not a project only names the repo; nested worktrees beat the checkout", () => {
    const dir = directory();
    const main = infer.ownerOfPath(dir, `${ZIG}/src`, new Date());
    assert.deepEqual([main.projectId, main.taskId, main.repo, main.via], [ZIG_ID, null, "zigzag", "checkout"]);
    const plania = infer.ownerOfPath(dir, PLANIA, new Date());
    assert.deepEqual([plania.projectId, plania.repo], [null, "plania"]);
    assert.equal(infer.ownerOfPath(dir, "/", new Date()).via, "none");
    const nested = directory({ worktrees: new Map([[`${PLANIA}/.claude/worktrees/x`, { path: `${PLANIA}/.claude/worktrees/x`, repo: "plania", branch: "b" }]]) });
    assert.equal(infer.locate(nested, `${PLANIA}/.claude/worktrees/x/src`)!.worktree?.path, `${PLANIA}/.claude/worktrees/x`);
  });

  test("database names: <project>_<ticket-key>_<purpose>, <project>_test_<hash>, bare project, repos without a project", () => {
    const dir = directory();
    const now = new Date();
    const scratch = infer.ownerOfDatabase(dir, "zigzag_zig_i5_scratch", now);
    assert.deepEqual([scratch.projectId, scratch.taskId, scratch.extra?.purpose], [ZIG_ID, "t0", "scratch"]);
    const phase = infer.ownerOfDatabase(dir, "zigzag_zig_i4_1_copy", now);
    assert.equal(phase.taskId, "t1");
    assert.equal(phase.sessionId, "s-zig");
    assert.equal(infer.ownerOfDatabase(dir, "zigzag", now).taskId, null);
    assert.equal(infer.ownerOfDatabase(dir, "zigzag", now).projectId, ZIG_ID);
    // zigzag_test_<hash of the worktree path> belongs to the worktree's ticket
    const test = infer.ownerOfDatabase(dir, `zigzag_test_${infer.pathHash(WT)}`, now);
    assert.deepEqual([test.taskId, test.sessionId, test.extra?.repo_path], ["t1", "s-zig", WT]);
    // plania is a repo, not a project: the repo is named, the project is null
    const p = infer.ownerOfDatabase(dir, `plania_test_${infer.pathHash(PLANIA)}`, now);
    assert.deepEqual([p.projectId, p.repo, p.extra?.repo_path], [null, "plania", PLANIA]);
    // an unknown hash is kept so the audit can say the checkout is gone
    assert.equal(infer.ownerOfDatabase(dir, "plania_test_abcdef", now).extra?.repo_path, null);
    assert.equal(infer.ownerOfDatabase(dir, "xize", now).via, "none");
    assert.equal(infer.ownerOfDatabase(dir, "planiax_foo", now).via, "none"); // a prefix must end at "_"
  });

  test("computeState: self, live with any owner, system when shared, orphan otherwise", () => {
    const base = { source: "observed" as const, self: false, shared: false, projectId: null, taskId: null, repo: null };
    assert.equal(infer.computeState({ ...base, self: true }), "self");
    assert.equal(infer.computeState({ ...base, projectId: "p" }), "live");
    assert.equal(infer.computeState({ ...base, repo: "plania" }), "live");
    assert.equal(infer.computeState({ ...base, shared: true }), "system");
    assert.equal(infer.computeState({ ...base, shared: true, taskId: "t" }), "live");
    assert.equal(infer.computeState(base), "orphan");
    assert.equal(infer.computeState({ ...base, source: "declared" }), "live");
  });
});

describe("reconcile", () => {
  let raw: pg.Client;
  before(async () => {
    raw = await resetTestDb();
  });
  after(async () => {
    await raw?.end();
  });

  const server = (port: number): Observed => ({ kind: "server", locator: `port:${port}`, cwd: ZIG, details: { port, pid: 1000 + port } });
  const NOW = (min: number) => new Date(Date.UTC(2026, 9, 9, 12, min, 0));
  const state = async (locator: string) => (await raw.query("select * from footprints where locator = $1 and released_at is null", [locator])).rows[0];

  async function tick(items: Observed[], ran: string[], min: number, dir?: Directory) {
    const { db, close } = makeDb();
    try {
      const d = dir ?? (await (async () => {
        const p = await findProject(db, "zigzag");
        return directory({
          projects: [{ id: p.id, slug: "zigzag", keyPrefix: "ZIG" }],
          repos: [{ name: "zigzag", path: ZIG, projectId: p.id, projectSlug: "zigzag" }, { name: "plania", path: PLANIA, projectId: null, projectSlug: null }],
          worktrees: new Map(),
          tasksById: new Map(),
          tasksByKey: new Map(),
          branchOwner: new Map(),
          claimed: [],
        });
      })());
      const inferred = items.map((item) => {
        const owner = item.cwd ? infer.ownerOfPath(d, item.cwd, NOW(min)) : { projectId: null, taskId: null, sessionId: null, repo: null, via: "none" as const };
        return { item, owner, repoPath: null };
      });
      return await reconcile(db, { machine: "test-mac", now: NOW(min), dir: d, inferred, ran: new Set(ran) });
    } finally {
      await close();
    }
  }

  test("a new item is inserted and logged as footprint.seen on its project; a project-less one is inserted without an event", async () => {
    const heard: string[] = [];
    const off = bus.subscribe((e) => heard.push(`${e.type}:${e.project}`));
    const r = await tick([server(3069), { kind: "db_server", locator: "postgres:5433", shared: true, details: { port: 5433, engine: "postgres" } }], ["ports"], 0);
    off();
    assert.equal(r.seen, 2);
    const s = await state("port:3069");
    assert.deepEqual([s.state, s.project_id !== null, s.source, s.misses], ["live", true, "observed", 0]);
    assert.equal((await state("postgres:5433")).state, "system");
    const ev = await raw.query("select type, payload from events where type like 'footprint.%'");
    assert.deepEqual(ev.rows.map((e) => e.type), ["footprint.seen"]);
    assert.equal(ev.rows[0].payload.locator, "port:3069");
    assert.ok(heard.includes("footprint:"), "the live bus is told the inventory changed");
    assert.ok(heard.includes("project:zigzag"));
  });

  test("a refresh changes nothing and logs nothing; the same item at the same time stays one row", async () => {
    const r = await tick([server(3069)], ["ports"], 1);
    assert.deepEqual([r.seen, r.gone, r.updated], [0, 0, 0]);
    const s = await state("port:3069");
    assert.equal(s.last_seen_at.toISOString(), NOW(1).toISOString());
    assert.equal((await raw.query("select 1 from events where type like 'footprint.%'")).rowCount, 1);
  });

  test("not seen on one run it stays; a collector that did not run leaves the row alone; two misses make it gone", async () => {
    // postgres:5433 was seen at minute 0 and missing from the ports run at minute 1: one miss so far
    assert.equal((await state("postgres:5433")).misses, 1);
    assert.equal((await state("postgres:5433")).state, "system");
    await tick([server(3069)], [], 2); // procs only: ports skipped
    assert.equal((await state("postgres:5433")).misses, 1);
    const r = await tick([server(3069)], ["ports"], 3);
    assert.equal(r.gone, 1);
    const g = await state("postgres:5433");
    assert.deepEqual([g.state, g.last_seen_at.toISOString()], ["gone", NOW(0).toISOString()]); // last_seen frozen
    // gone rows of a project-less item have no event; the project's server is still live
    assert.equal((await raw.query("select 1 from events where type = 'footprint.gone'")).rowCount, 0);
    assert.equal((await state("port:3069")).state, "live");
  });

  test("a project item that goes away logs footprint.gone; coming back revives the same row", async () => {
    await tick([], ["ports"], 4);
    const r = await tick([], ["ports"], 5);
    assert.equal(r.gone, 1);
    assert.equal((await state("port:3069")).state, "gone");
    const ev = await raw.query("select payload from events where type = 'footprint.gone'");
    assert.equal(ev.rows[0].payload.locator, "port:3069");
    const before = (await raw.query("select count(*)::int as n from footprints")).rows[0].n;
    const back = await tick([server(3069)], ["ports"], 6);
    assert.equal(back.revived, 1);
    const s = await state("port:3069");
    assert.deepEqual([s.state, s.misses], ["live", 0]);
    assert.equal((await raw.query("select count(*)::int as n from footprints")).rows[0].n, before);
  });

  test("a gone row is released a day after it was last seen, which frees its locator", async () => {
    await tick([], ["ports"], 7);
    await tick([], ["ports"], 8); // port:3069 is gone again (last seen at 6)
    assert.equal((await state("port:3069")).state, "gone");
    const next = new Date(NOW(0).getTime() + 25 * 3600_000);
    const { db, close } = makeDb();
    try {
      await reconcile(db, { machine: "test-mac", now: next, dir: directory(), inferred: [], ran: new Set(["ports"]) });
    } finally {
      await close();
    }
    assert.equal(await state("port:3069"), undefined);
    assert.ok((await raw.query("select 1 from footprints where locator = 'port:3069' and released_at is not null")).rowCount! >= 1);
  });

  test("a declared owner is not overwritten by inference", async () => {
    await raw.query(
      `insert into footprints (machine, kind, locator, source, purpose, project_id, state, first_seen_at, last_seen_at)
       values ('test-mac', 'server', 'port:4000', 'declared', 'my server', (select id from projects where slug = 'filmia'), 'live', now(), now())`,
    );
    await tick([{ ...server(4000), cwd: ZIG }], ["ports"], 10); // inference would say zigzag
    const s = await state("port:4000");
    assert.equal((await raw.query("select slug from projects where id = $1", [s.project_id])).rows[0].slug, "filmia");
    assert.equal(s.purpose, "my server");
  });

  test("databases of a Postgres server that stopped listening go with it", async () => {
    const db5435: Observed = { kind: "database", locator: "scratch@127.0.0.1:5435", database: { name: "scratch", port: 5435 }, details: { port: 5435 } };
    const srv: Observed = { kind: "db_server", locator: "postgres:5435", shared: true, details: { port: 5435, engine: "postgres" } };
    await tick([srv, db5435], ["ports", "databases:5435"], 20);
    await tick([], ["ports"], 21); // server gone: databases:5435 did not run, but nothing can answer for it
    await tick([], ["ports"], 22);
    assert.equal((await state("scratch@127.0.0.1:5435")).state, "gone");
    assert.equal((await state("postgres:5435")).state, "gone");
  });
});

describe("a whole tick", () => {
  let raw: pg.Client;
  before(async () => {
    raw = await resetTestDb();
  });
  after(async () => {
    await raw?.end();
  });

  test("recorded output end to end: servers, worktrees and databases are matched to a claimed ticket; docker is missing; the second tick adds nothing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "machine-root-"));
    const repo = path.join(root, "zigzag");
    const wt = path.join(repo, ".claude", "worktrees", "box");
    mkdirSync(path.join(repo, ".git"), { recursive: true });
    mkdirSync(wt, { recursive: true });
    const { db, close } = makeDb();
    try {
      await createTask(db, { project: "zigzag", kind: "initiative", title: "Sandbox", scope: "PRD", integration_branch: "jl/sandbox" }, ctx); // ZIG-I1
      await createTask(db, { project: "zigzag", title: "Box", scope: "s", checks: ["c"], parent_key: "ZIG-I1", status: "Ready" }, ctx); // ZIG-I1-1
      await claim(db, { project: "zigzag", key: "ZIG-I1-1", workspace: { worktree_path: wt, branch: "jl/sandbox" } }, ctx);

      const lsof = `p4242\ncnode\nf13\nn*:3069\np1331\ncpostgres\nf8\nn127.0.0.1:5432\np1106\ncControlCenter\nf10\nn*:7000\n`;
      const cwdOut = `p4242\nfcwd\nn${wt}/apps/web\np1331\nfcwd\nn/opt/homebrew/var/postgresql@14\np1106\nfcwd\nn/\n`;
      const ps = ` 4242     1 Fri Oct  9 19:58:33 2026     node ${wt}/node_modules/.bin/next dev -p 3069\n 1331     1 Sat Sep 12 20:58:49 2026     /opt/homebrew/opt/postgresql@14/bin/postgres -D /opt/homebrew/var/postgresql@14\n 1106     1 Sat Sep 12 20:58:17 2026     /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter\n`;
      const listing = `worktree ${repo}\nHEAD aaa\nbranch refs/heads/main\n\nworktree ${wt}\nHEAD bbb\nbranch refs/heads/jl/sandbox\n`;
      const run: Run = async (cmd, args) => {
        if (cmd === "lsof") return ok(args.includes("cwd") ? cwdOut : lsof);
        if (cmd === "ps") return ok(ps);
        if (cmd === "git") {
          const sub = args[2];
          if (sub === "worktree") return ok(listing);
          if (sub === "status") return ok("");
          if (sub === "log") return ok("2026-10-09T10:00:00-06:00\n");
          if (sub === "rev-parse" || sub === "symbolic-ref") return ok("main\n");
          if (sub === "merge-base") return ok("");
          if (sub === "rev-list") return ok("2\n");
        }
        if (cmd === "du") return ok(`1024\t${wt}\n`);
        return missing; // brew, docker
      };
      const listDatabases = async (port: number) =>
        port === 5432 ? { version: "14.9", databases: [{ name: "zigzag", sizeBytes: 10 }, { name: "zigzag_zig_i1_scratch", sizeBytes: 20 }, { name: "xize", sizeBytes: 30 }] } : null;
      const deps = { run, listDatabases, machine: "test-mac", projectsRoot: root, launchAgentsDir: path.join(root, "none"), selfPid: 1, selfPorts: [3737], state: { lastRun: {}, brewNames: [] } };

      const first = await runMachineTick(db, NOW0, deps);
      assert.equal(first.seen, 6); // worktree, server, db_server, 3 databases
      const inv = await machineInventory(db, "test-mac");
      const by = Object.fromEntries(inv.map((r) => [r.locator, r]));
      assert.deepEqual(Object.keys(by).sort(), [wt, "port:3069", "postgres:5432", "xize@127.0.0.1:5432", "zigzag@127.0.0.1:5432", "zigzag_zig_i1_scratch@127.0.0.1:5432"].sort());
      assert.deepEqual([by["port:3069"]!.task_key, by["port:3069"]!.session_id, by["port:3069"]!.state, by["port:3069"]!.project], ["ZIG-I1-1", "s1", "live", "zigzag"]);
      assert.deepEqual([by[wt]!.task_key, by[wt]!.details.size_kb, by[wt]!.details.dirty, by[wt]!.details.merged], ["ZIG-I1-1", 1024, false, true]);
      assert.equal(by["zigzag_zig_i1_scratch@127.0.0.1:5432"]!.task_key, "ZIG-I1");
      assert.equal(by["xize@127.0.0.1:5432"]!.state, "orphan");
      assert.deepEqual([by["postgres:5432"]!.state, by["postgres:5432"]!.details.version, by["postgres:5432"]!.project], ["system", "14.9", null]);
      assert.match(by[wt]!.teardown, /^git -C .* worktree remove /);

      // Slow collectors are gated: a tick a minute later runs only the fast ones and keeps sizes.
      const second = await runMachineTick(db, new Date(NOW0.getTime() + 60_000), deps);
      assert.deepEqual([second.seen, second.gone, second.updated], [0, 0, 0]);
      const again = Object.fromEntries((await machineInventory(db, "test-mac")).map((r) => [r.locator, r]));
      assert.equal(again[wt]!.details.size_kb, 1024);
      assert.equal(again["zigzag@127.0.0.1:5432"]!.state, "live");
    } finally {
      await close();
    }
  });
});
