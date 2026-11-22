// PLA-I74-2: the canary harness. One owner request from Pedir («Darle forma») to production, through:
//   - the owner's six decision clicks on the same JSON routes the screen calls (app.request with the screen cookie);
//   - the real runner queue (runHeartbeat → drainQueue), whose `claude` is a scripted agent per role that calls the
//     real MCP tools over HTTP (POST /mcp with the run's own token and X-Plania-Run), as a real run does;
//   - the real QA lane, El Probador, the GitHub poller, the deploy poller, the blockers and leases jobs, each tick;
//   - a fixture product repo (test/canary/fixture.ts) where the builder makes a real commit and Plania's copies are
//     real git worktrees; a git-backed fake GitHub; a fake host that answers READY or ERROR.
// Faked at their existing seams: the claude process (RunnerDeps.spawn), the install and dev-server processes
// (setPruebaDeps, QaDeps.startApp), the browser (ProbadorDeps.capture, QaDeps.capture), gh (releaseGh.run) and the
// GitHub and host HTTP APIs (GithubDeps.fetch, VercelDeps.fetch). No network, no real claude, test database only.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import type pg from "pg";
import { FakeGithub } from "./fake-github.js";
import { FakeHost } from "./fake-host.js";
import { gitIn, head, makeFixture, type Fixture, type Locker } from "./fixture.js";
import { TEST_BEARER } from "../helpers.js";

type Json = Record<string, any>;
type Db = any;

// The modules, imported after the test file called useTestEnv (see canary.test.ts).
export type Mods = Awaited<ReturnType<typeof loadMods>>;
export async function loadMods() {
  return {
    app: (await import("../../src/app.js")).app,
    session: await import("../../src/auth/session.js"),
    client: await import("../../src/db/client.js"),
    seedOrg: (await import("../../scripts/seed-org.js")).seedOrg,
    team: await import("../../src/runner/team.js"),
    limits: await import("../../src/runner/limits.js"),
    runner: await import("../../src/runner/runner.js"),
    heartbeat: await import("../../src/jobs/heartbeat.js"),
    qa: await import("../../src/runner/qa.js"),
    probador: await import("../../src/captures/probador.js"),
    prueba: await import("../../src/captures/prueba.js"),
    github: await import("../../src/jobs/github.js"),
    vercel: await import("../../src/jobs/vercel.js"),
    jobs: await import("../../src/jobs/index.js"),
    ship: await import("../../src/mcp/release-ship.js"),
    actions: await import("../../src/api/company-actions.js"),
    queries: await import("../../src/mcp/queries.js"),
    turns: await import("../../src/jobs/turns.js"),
    capture: await import("../../src/captures/run.js"),
    revision: await import("../../src/captures/revision.js"),
    diff: await import("../../src/captures/diff.js"),
    etapa: await import("../../src/api/etapa.js"),
  };
}

const sh = (cmd: string, args: string[], cwd: string) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) =>
    execFile(cmd, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })),
  );
/** The runner's and the copies' git: the real one, on the fixture repo. */
export const realGit = (args: string[], cwd: string) => sh("git", args, cwd);
/** A command run in a checkout (a verify list item): the real shell. Only the fixture's own `node --test` runs. */
const realExec = async (command: string, opts: { cwd: string; env?: NodeJS.ProcessEnv }) => {
  const r = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) =>
    execFile("/bin/sh", ["-c", command], { cwd: opts.cwd, env: opts.env, encoding: "utf8" }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })),
  );
  return r;
};

// ---- One fake claude run

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  end(ok: boolean, result = "OK"): void {
    if (this.stdout.writableEnded) return;
    const line = { type: "result", subtype: ok ? "success" : "error_during_execution", is_error: !ok, num_turns: 3, session_id: `sess-${this.pid}`, result, modelUsage: { "claude-opus-5-5": { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
    this.stdout.write(`${JSON.stringify(line)}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", ok ? 0 : 1, null));
  }
  kill(): void {
    if (this.stdout.writableEnded) return;
    this.stdout.end();
    setImmediate(() => this.emit("exit", null, "SIGTERM"));
  }
}

/** What a run learns from its prompt and its MCP config, as a real claude reads them. */
export type Run = {
  pid: number;
  role: string;
  agent: string; // the roster slug (read from the run's row)
  project: string;
  key: string | null;
  reason: string;
  session: string;
  workspace: { path: string; branch: string | null } | null;
  prompt: string;
  call: (tool: string, args: Json) => Promise<Json>;
  /** A tool call that may be refused: the refusal comes back as { error } instead of throwing. */
  tryCall: (tool: string, args: Json) => Promise<Json>;
};
export type Script = (run: Run, w: World) => Promise<string | void>;

// ---- The world

export type Options = {
  locker: Locker;
  /** Per-role overrides of the scripted agents, for a scenario. Return the run's final text (QA's report). */
  scripts?: Partial<Record<string, Script>>;
  /** How deliveries are reviewed: "por_paso" (the owner's Aceptar on each step, the canary's default) or the
   * product's default "por_modulo" (Plania accepts a step on its photos; the owner sees them all at Publicar). */
  revision?: "por_paso" | "por_modulo";
};

export type World = Awaited<ReturnType<typeof makeWorld>>;

let worlds = 0;
export async function makeWorld(m: Mods, raw: pg.Client, db: Db, scratch: string, opts: Options) {
  const n = ++worlds;
  const slug = `canary-${opts.locker}-${n}`;
  const prefix = `C${opts.locker === "npm" ? "N" : "P"}${String.fromCharCode(64 + n)}`;
  const fx: Fixture = makeFixture(path.join(scratch, slug), opts.locker);
  const repoName = `canary/${slug}`;
  const github = new FakeGithub(repoName, fx.origin);
  const host = new FakeHost(`prj_${slug}`);
  // One network for the pollers, as the real fetch is: GitHub's API to the fake GitHub, everything else (the host's
  // API, the production site's live check) to the fake host.
  const net = (url: string) => (new URL(url).hostname === "api.github.com" ? github.fetch(url) : host.fetch(url));
  host.onDeploy = (d) => github.statuses.set(d.meta.githubCommitSha, [{ context: "Vercel", state: d.state === "READY" ? "success" : d.state === "ERROR" ? "failure" : "pending", target_url: `https://${d.url}` }]);
  const home = path.join(scratch, slug, "home");
  const worktrees = path.join(scratch, slug, "worktrees");
  mkdirSync(home, { recursive: true });

  // The project, as the setup sheet leaves it: its repo, GitHub, the host, the copies Plania photographs, QA.
  const settings = {
    local: { repo_path: fx.repo },
    github: { repo: repoName },
    vercel: { project_id: host.projectId },
    release: { from: "sandbox", into: "main", env: "prod", mode: "merge" },
    release_target: "prod",
    capture: { start_command: "node server.mjs {port}", port: 4100 + n * 10, pages: [{ key: "inicio", path: "/", label: "Inicio" }, { key: "clientes", path: "/clientes", label: "Clientes" }] },
    qa: { enabled: true, verify: [{ name: "tests", command: "node --test test/*.test.mjs" }] },
    ...(opts.revision === "por_modulo" ? {} : { velocidad: { revision: "por_paso" } }),
  };
  const pid = (await raw.query(`insert into projects (slug, title, key_prefix, settings, runs_paused) values ($1, $2, $3, $4, false) returning id`, [slug, `Canary ${opts.locker} ${n}`, prefix, JSON.stringify(settings)])).rows[0].id as string;
  // The setup sheet always leaves a goal; a run with none is skipped («no goal»).
  await raw.query(`insert into goals (project_id, title) values ($1, 'Que la dueña vea a sus clientes')`, [pid]);
  await m.seedOrg(db);
  const project = { id: pid, slug, title: `Canary ${opts.locker} ${n}` };
  await m.team.ensureMember(db, project, "qa");
  // Every wake in the canary is an event's: no cadence wakes, so a missing wake shows as nobody's turn (PLA-164).
  await raw.query(`update agents set heartbeat_minutes = null`);

  // ---- Fakes at their seams

  // The test copies (Encenderla, the delivery copy): real git worktrees; the install and the dev server are fakes.
  const installs: { command: string; cwd: string; by: string }[] = [];
  const servers: { command: string; cwd: string; at: number }[] = [];
  // The copies' and the check-up's clock (PruebaDeps.now, RevisionDeps.now): a hundred times fast, so a cold start of
  // minutes is seconds of test. Leases stay on Postgres time; the turn watchdog has its own fast clock (tick).
  const clockFrom = Date.now();
  const vnow = () => clockFrom + (Date.now() - clockFrom) * 100;
  // A dev server answers once its cold start (w.coldMs, on the fast clock) has passed since it was started on that port.
  const startedOn = new Map<string, number>();
  const answers = async (url: string) => {
    const port = /:(\d+)/.exec(url)?.[1] ?? "";
    const at = startedOn.get(port);
    return at !== undefined && vnow() - at >= w.coldMs;
  };
  let devPid = 70_000 + n * 1000;
  const children = new Map<number, EventEmitter>();
  const pruebaDeps = {
    git: realGit,
    exec: async (command: string, o: { cwd: string }) => (installs.push({ command, cwd: o.cwd, by: "copia" }), { code: 0, stdout: "", stderr: "" }),
    spawn: (command: string, o: { cwd: string }) => {
      servers.push({ command, cwd: o.cwd, at: vnow() });
      const port = /(\d{4,5})\s*$/.exec(command)?.[1];
      if (port) startedOn.set(port, vnow());
      const child = Object.assign(new EventEmitter(), { pid: ++devPid, stdout: new PassThrough(), stderr: new PassThrough() });
      children.set(child.pid, child);
      return child as never;
    },
    kill: (p: number) => children.get(Math.abs(p))?.emit("exit", null, "SIGTERM"),
    alive: (p: number) => children.has(Math.abs(p)),
    up: answers,
    portBusy: async () => false,
    footprints: false,
    env: { ...process.env, PLANIA_WORKTREES_ROOT: worktrees, HOME: home },
    now: vnow,
    pollMs: 5,
    sweep: false,
    signals: false,
  };

  // The browser: El Probador's, QA's and the check-up's photos go through the real runCapture (its waits, its URL check,
  // the stills it records); only the browser is fake. A tab lands where w.landing says (a scenario sends a view to the
  // login page) and draws a PNG whose colour is its URL, so before and after differ where the page did.
  const shots: { url: string; at: string }[] = [];
  const png = (url: string) => {
    const h = [...url].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const data = Buffer.alloc(16 * 12 * 3);
    for (let k = 0; k < data.length; k += 3) data.set([h & 255, (h >> 8) & 255, (h >> 16) & 255], k);
    return m.diff.encodePng({ width: 16, height: 12, channels: 3, data });
  };
  const browser = {
    launch: async () => {
      let at = "about:blank";
      return {
        page: {
          setViewport: async () => undefined,
          goto: async (url: string) => {
            at = w.landing(url);
            shots.push({ url, at });
            return { status: 200, url: at };
          },
          evaluate: async (expression: string) => {
            if (expression === "location.href") return at;
            if (expression === "location.pathname") return new URL(at).pathname;
            if (expression === m.capture.PAGE_TEXT_SCRIPT) return { overlay: "", body: "Clientes" };
            return null;
          },
          screenshot: async () => png(at),
          cookies: async () => [],
        },
        close: async () => undefined,
      };
    },
    fetch: (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch,
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    loginWaitMs: 50,
    formWaitMs: 50,
  };
  const capture = (cdb: unknown, input: Json) => m.capture.runCapture(cdb as never, input as never, browser as never);

  // «Revisar proyecto» (PLA-I74-6): the check-up the server runs at setup, on a fresh copy, with its outside calls faked.
  const revisionDeps = {
    git: realGit,
    exec: async (command: string, o: { cwd: string }) => {
      if (/install|npm ci/.test(command)) installs.push({ command, cwd: o.cwd, by: "revision" });
      if (w.checkupFails && /install|npm ci/.test(command)) return { code: 1, stdout: "", stderr: "ERR! the lockfile is out of date\n" };
      return { code: 0, stdout: "", stderr: "" };
    },
    spawn: pruebaDeps.spawn,
    kill: pruebaDeps.kill,
    up: answers,
    pickPort: async () => 4600 + n,
    photo: (i: Json) => m.capture.photoCheck(i as never, browser as never),
    fetch: host.fetch as unknown as typeof fetch,
    disk: async () => 500 * 2 ** 30,
    env: { ...process.env, PLANIA_WORKTREES_ROOT: worktrees, HOME: home, VERCEL_TOKEN: "canary-token" },
    now: vnow,
    pollMs: 5,
    footprints: false,
  };

  // The claude process: one scripted agent per role.
  const spawned: Run[] = [];
  const fakeErrors: string[] = [];
  let runPid = 60_000 + n * 1000;
  const mcpCall = (headers: Record<string, string>, session: string, agent: string) => {
    let id = 0;
    return async (tool: string, args: Json): Promise<Json> => {
      const res = await m.app.request("/mcp", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: tool, arguments: { actor: { agent, session_id: session }, ...args } } }),
      });
      const text = await res.text();
      const line = text.split("\n").map((l) => l.replace(/^data:\s*/, "")).filter((l) => l.startsWith("{")).at(-1) ?? "{}";
      const msg = JSON.parse(line);
      const body = msg.result?.structuredContent ?? (msg.result?.content?.[0]?.text ? safeJson(msg.result.content[0].text) : null);
      if (!res.ok || msg.error || msg.result?.isError) return { error: body?.error ?? msg.error ?? body ?? line.slice(0, 400), detail: body };
      return body ?? {};
    };
  };
  const deps = {
    env: { HOME: home, PATH: process.env.PATH, PLANIA_RUNNER_TOKEN: TEST_BEARER, PLANIA_PROMPTS_PROJECT: process.env.PLANIA_PROMPTS_PROJECT, CLAUDE_CODE_BIN: "/fake/bin/claude" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, slug, "logs"),
    tmpDir: path.join(scratch, slug, "tmp"),
    worktreeRoot: worktrees,
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: realGit,
    machine: () => ({ freeMemBytes: 64 * 2 ** 30, freeDiskBytes: 500 * 2 ** 30 }),
    spawn: (_command: string, args: string[]) => {
      const child = new FakeChild(++runPid);
      const prompt = args[args.indexOf("-p") + 1] ?? "";
      const config = JSON.parse(readFileSync(args[args.indexOf("--mcp-config") + 1]!, "utf8")).mcpServers.plania;
      const headers = Object.fromEntries(Object.entries(config.headers ?? {}).map(([k, v]) => [k, String(v).replace(/\$\{(\w+)\}/g, (_x, name) => (deps.env as Json)[name] ?? "")])) as Record<string, string>;
      setImmediate(async () => {
        try {
          const run = await parseRun(prompt, headers, child.pid);
          spawned.push(run);
          const script = opts.scripts?.[run.role] ?? SCRIPTS[run.role];
          if (!script) throw new Error(`no scripted agent for role ${run.role}`);
          if (w.hold?.(run)) return; // a scenario keeps this run open (a restart in the middle of it)
          const text = await script(run, w);
          child.end(true, typeof text === "string" ? text : "OK");
        } catch (e) {
          fakeErrors.push(String((e as Error)?.stack ?? e));
          child.end(false, String(e));
        }
      });
      runs.set(child.pid, child);
      return child;
    },
    kill: (p: number) => runs.get(p)?.kill(),
    reportTokens: async () => undefined,
    probeUsage: async () => null,
  };
  const runs = new Map<number, FakeChild>();

  async function parseRun(prompt: string, headers: Record<string, string>, pid: number): Promise<Run> {
    const session = /actor session_id (run-[0-9a-f]+)/.exec(prompt)?.[1] ?? headers["X-Plania-Run"] ?? "";
    const row = (await raw.query(`select a.slug, r.role from agent_runs r join agents a on a.id = r.agent_id where replace(r.id::text, '-', '') like $1 order by r.queued_at desc limit 1`, [`${session.slice(4)}%`])).rows[0];
    // A builder's prompt names its ticket on «Ticket:»; QA's review prompt on «the delivery of KEY:».
    const key = /^Ticket: ([A-Z0-9]+-[A-Z0-9-]+): /m.exec(prompt)?.[1] ?? /on the delivery of ([A-Z0-9]+-[A-Z0-9-]+): /.exec(prompt)?.[1] ?? null;
    const ws = /^Workspace: (\S+)(?: on branch (\S+))?, base (\S+)\./m.exec(prompt);
    const role = row?.role ?? /^You are \S+ \(([a-z-]+)\)/m.exec(prompt)?.[1] ?? "?";
    const call = mcpCall(headers, session, row?.slug ?? "agent");
    return {
      pid,
      role,
      agent: row?.slug ?? "?",
      project: /for project ([a-z0-9-]+) \(/.exec(prompt)?.[1] ?? slug,
      key,
      reason: /^Why you woke: (.*)$/m.exec(prompt)?.[1] ?? "",
      session,
      workspace: ws ? { path: ws[1]!, branch: ws[2] ?? null } : null,
      prompt,
      tryCall: call,
      call: async (tool, args) => {
        const out = await call(tool, args);
        if (out.error) throw new Error(`${tool} refused: ${JSON.stringify(out.error).slice(0, 500)} ${JSON.stringify(out.detail ?? "").slice(0, 500)}`);
        return out;
      },
    };
  }

  const releaseGhBefore = m.ship.releaseGh.run;
  m.ship.releaseGh.run = github.gh;

  // ---- The owner, on the screen's routes

  const clicks: { what: string; route: string; status: number }[] = [];
  const cookie = () => ({ Cookie: `${m.session.SESSION_COOKIE}=${m.session.createSession()}` });
  const read = async (route: string) => {
    const r = await m.app.request(route, { headers: cookie() });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Json };
  };
  const click = async (what: string, route: string, body: unknown = {}) => {
    const r = await m.app.request(route, { method: "POST", headers: { ...cookie(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await r.json().catch(() => ({}))) as Json;
    clicks.push({ what, route, status: r.status });
    return { status: r.status, json };
  };

  // ---- Reads for the asserts

  const one = async (sql: string, args: unknown[] = []) => (await raw.query(sql, args)).rows[0] as Json | undefined;
  const all = async (sql: string, args: unknown[] = []) => (await raw.query(sql, args)).rows as Json[];
  const task = (key: string) => one(`select * from tasks where project_id = $1 and key = $2`, [pid, key]);

  /** The decision cards the floor shows for this project (GET /api/company, as the screen reads it). */
  const cards = async () => {
    const r = await read("/api/company");
    // Only cards still waiting on him: an answered one (state set) stays listed for a while but is nobody's move.
    return ((r.json.decisions ?? []) as Json[]).filter((d) => (d.project === slug || d.project?.slug === slug) && d.state == null);
  };

  /** Whose turn it is for the request, after a tick. «nobody» is the bug the canary exists to catch. Until lane A's
   * turnOf (PLA-I74-5) lands, the canary reads the same facts itself: a live or queued run, a QA lane or a photo pass
   * at work, a card or a stop that waits on the owner, or a wait outside (the host, CI) with an end. */
  const turn = async (): Promise<{ who: "agent" | "owner" | "outside" | "done" | "nobody"; why: string }> => {
    const live = await one(`select count(*)::int n from agent_runs where project_id = $1 and status in ('queued', 'running', 'starting')`, [pid]);
    if (live!.n) return { who: "agent", why: `${live!.n} run(s) queued or running` };
    const lane = await one(`select count(*)::int n from qa_lanes where project_id = $1 and status in ('queued', 'checking', 'reviewing')`, [pid]);
    if (lane!.n) return { who: "agent", why: "QA lane at work" };
    const photos = await one(`select count(*)::int n from tasks where project_id = $1 and probador->>'state' = 'tomando'`, [pid]);
    if (photos!.n) return { who: "agent", why: "El Probador taking photos" };
    const idea = w.ideaKey ? await task(w.ideaKey) : null;
    if (!idea) return { who: "nobody", why: "no request yet" };
    if (!idea.promoted_to) {
      if (idea.stage === "ready") {
        const built = await one(`select count(*)::int n from events where task_id = $1 and type = 'pedido.construir'`, [idea.id]);
        return built!.n ? { who: "nobody", why: "«Constrúyelo» said and no run on it" } : { who: "owner", why: "the plan waits for «Constrúyelo»" };
      }
      const asked = await one(`select count(*)::int n from questions where task_id = $1 and answered_at is null`, [idea.id]);
      if (asked!.n) return { who: "owner", why: "a question waits for the owner" };
      return { who: "nobody", why: `idea at stage ${idea.stage} with no run` };
    }
    const steps = await all(`select key, status from tasks where project_id = $1 and parent_id = (select id from tasks where project_id = $1 and key = $2) order by phase, key`, [pid, idea.promoted_to]);
    if (steps.length && steps.every((s) => s.status === "Done" || s.status === "Released")) return { who: "done", why: "in production" };
    const open = await one(`select count(*)::int n from questions q join tasks t on t.id = q.task_id where t.project_id = $1 and q.answered_at is null`, [pid]);
    if (open!.n) return { who: "owner", why: "a question waits for the owner" };
    const c = await cards();
    if (c.length) return { who: "owner", why: `card: ${c.map((x) => x.kind).join(", ")}` };
    // A step that reached In review since its last QA lane: the next heartbeat's sweep opens the lane (queued QA).
    const awaitingQa = await one(
      `select count(*)::int n from tasks t where t.project_id = $1 and t.status = 'In review' and not exists (select 1 from qa_lanes l where l.task_id = t.id and l.created_at >= t.status_changed_at)`,
      [pid],
    );
    if (awaitingQa!.n) return { who: "agent", why: "QA lane opens on the next sweep" };
    if (steps.some((s) => s.status === "Merged") && !(await one(`select 1 as x from events where project_id = $1 and type = 'release.merged'`, [pid]))) return { who: "owner", why: "Publicar waits" };
    if (steps.some((s) => s.status === "Merged")) return { who: "outside", why: "waiting for the deploy" };
    return { who: "nobody", why: `steps ${steps.map((s) => `${s.key} ${s.status}`).join(", ")}` };
  };

  // ---- One tick: what the server's jobs do every minute, in order, with the fakes wired in.

  const turns: { tick: number; who: string; why: string; plania?: { key: string; turn: string; why: string | null }[] }[] = [];
  let ticks = 0;
  const born = Date.now();
  const qaDeps = () => ({ runner: deps, env: deps.env, worktreeRoot: worktrees, git: realGit, exec: realExec, startApp: async () => ({ ok: true, error: null, stop: async () => undefined }), capture, freePort: async () => 4900 + n, publicUrl: "http://localhost:3738" });
  const probadorDeps = () => ({ force: true, settleMs: 0, orphanMs: 60_000, capture, pollMs: 5 });
  async function tick(): Promise<void> {
    ticks += 1;
    if (process.env.CANARY_DEBUG) console.log(`[canary] tick ${ticks}`, JSON.stringify(turns.at(-1) ?? null));
    const now = new Date();
    await m.actions.waitForAskWakes();
    // The QA lane's checks first, with their fakes: the heartbeat's own sweep then only drives the review run.
    await m.qa.sweepQa(db, now, qaDeps() as never);
    await m.qa.waitForQa();
    await m.heartbeat.runHeartbeat(db, now, { runner: deps } as never);
    await m.runner.waitForAllRuns();
    await m.probador.sweepProbador(db, now, probadorDeps() as never);
    await m.probador.waitForProbador();
    const p = await m.queries.findProject(db, slug);
    await m.github.pollGithubProject(db, p, { fetch: net as never, env: { GITHUB_TOKEN: "canary-token" }, now });
    await m.vercel.pollVercelProject(db, p, { fetch: net as never, env: { VERCEL_TOKEN: "canary-token" }, now });
    for (const job of m.jobs.JOBS.filter((j: { name: string }) => ["blockers", "leases", "revision"].includes(j.name))) await job.runOnce(db, now);
    // PLA-I74-5: the turn watchdog, on the fast clock: one minute per tick, so its two minutes of grace are two ticks.
    const fast = new Date(Math.max(Date.now(), born + ticks * 60_000));
    await m.turns.sweepTurns(db, fast);
    await m.runner.waitForAllRuns();
    const t = await turn();
    // Plania's own answer (turnOf, on the board) for every open step, next to the canary's.
    const etapas = await m.etapa.projectEtapas(db, p, fast);
    const plania = [...etapas.byTicket.values()].filter((r: Json) => r.turn).map((r: Json) => ({ key: r.key, turn: r.turn.turn, why: r.turn.why ?? r.turn.reason ?? r.turn.card ?? r.turn.on ?? null }));
    turns.push({ tick: ticks, ...t, plania });
  }

  /** Ticks until cond holds; fails naming the last turns when it does not within max ticks. */
  async function until(what: string, cond: () => Promise<boolean>, max = 25): Promise<void> {
    for (let i = 0; i < max; i += 1) {
      if (await cond()) return;
      await tick();
      assert.deepEqual(fakeErrors, [], `a scripted agent failed while waiting for ${what}`);
    }
    assert.fail(`${what} did not happen in ${max} ticks. Last turns: ${JSON.stringify(turns.slice(-6))}; runs: ${JSON.stringify(await all(`select a.slug, r.status, r.task_key, r.summary from agent_runs r join agents a on a.id = r.agent_id where r.project_id = $1 order by r.queued_at`, [pid]))}`);
  }

  const w = {
    n,
    slug,
    pid,
    fx,
    github,
    host,
    installs,
    servers,
    shots,
    spawned,
    fakeErrors,
    clicks,
    turns,
    deps,
    pruebaDeps,
    ideaKey: null as string | null,
    stepKey: null as string | null,
    /** A scenario's extra change in the builder's commit (a test that fails once). */
    build: null as null | ((cwd: string, run: Run) => void),
    /** A scenario's fix when finish refuses the delivery; true when it fixed something worth a second finish. */
    fixOnRefusal: null as null | ((cwd: string, run: Run, out: Json) => boolean),
    refusals: [] as Json[],
    revisionDeps,
    /** The app's cold start on the fast clock (a scenario makes it slower than the old fixed wait). */
    coldMs: 1_000,
    /** The check-up's install fails (a red check-up). */
    checkupFails: false,
    /** Where a browser that opened url ends up (a scenario sends one view to the wrong page). */
    landing: (url: string) => url,
    /** A scenario may keep a run open instead of running its script (returns true to hold). */
    hold: null as null | ((run: Run) => boolean),
    runs,
    /** Plania restarts while `held` runs (PLA-52): the server forgets its live runs, QA checks and copies; the start-up
     * sweep closes the run it left running; then the old process is gone. */
    restart: async (held: Run) => {
      m.runner.resetRunnerForTests();
      m.qa.resetQaForTests();
      m.prueba.resetPrueba();
      m.prueba.setPruebaDeps(pruebaDeps as never);
      const swept = await m.runner.sweepOrphans(db, { ...deps, probePid: async () => false, graceMs: 1 } as never);
      runs.get(held.pid)?.kill();
      return swept;
    },
    read,
    click,
    cards,
    task,
    one,
    all,
    tick,
    until,
    turn,
    restore: () => {
      m.ship.releaseGh.run = releaseGhBefore;
    },
  };
  return w;
}

const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return { text: s };
  }
};

// ---- The scripted agents: what each role's run does, through the MCP tools a real agent calls.

const IDEA = { problem: "Los clientes no se ven en una lista; hay que abrir cada ficha para saber quién es quién.", who: "La dueña del negocio, cada mañana.", why_now: "Hoy perdió una cita por no ver a sus clientes de un vistazo.", decisions: [] };
const RESEARCH = {
  learned: ["Una lista simple con nombre y teléfono es lo que usan las apps de citas pequeñas.", "Buscar por nombre se pide en cuanto hay más de veinte clientes."],
  options: [
    { title: "Lista simple", text: "Una lista con nombre y teléfono en la página Clientes." },
    { title: "Tabla con filtros", text: "Una tabla con columnas, orden y filtros." },
  ],
  recommendation: { option: 0, why: "Resuelve el problema de hoy con un cambio pequeño." },
  unknowns: ["Cuántos clientes tiene hoy."],
};
const DESIGN = { approach: "La página Clientes muestra una lista con el nombre de cada cliente.", scope: ["La lista en la página Clientes"], out_of_scope: ["Buscar y filtrar"] };
const MUESTRA = { frase: "La página Clientes muestra la lista de clientes.", vistas: [{ key: "clientes", label: "Clientes", path: "/clientes" }], pasos: ["Abre Clientes", "Mira la lista", "Vuelve a Inicio"] };
const PLAN = { steps: [{ title: "Lista de clientes", done_when: "La página Clientes muestra los clientes en una lista", try_it: "Abre Clientes y mira la lista", work_type: "code", muestra: MUESTRA }], risks: ["Ninguno conocido"], size: "Un paso pequeño" };

async function idea(run: Run): Promise<Json> {
  return run.call("get_task", { project: run.project, key: run.key });
}
async function moveStage(run: Run, to: string): Promise<void> {
  const t = await idea(run);
  await run.call("set_task", { project: run.project, key: run.key, stage: to, version: t.version });
}
async function closingLine(run: Run, text: string): Promise<void> {
  await run.call("thread_post", { project: run.project, thread: run.project, body: text });
}

export const SCRIPTS: Record<string, Script> = {
  "product-owner": async (run, w) => {
    if (!run.key) return;
    const t = await idea(run);
    if (t.kind !== "idea") return;
    if (t.promoted_to) return;
    // «Constrúyelo»: the initiative and its first step, born Ready, then promoted_to on the idea.
    if (/Constrúyelo|Build it/.test(run.reason)) {
      const ini = await run.call("create_task", { project: run.project, kind: "initiative", title: t.title, base_branch: "sandbox", scope: `Construir ${t.key}.` });
      const step = await run.call("create_task", { project: run.project, parent_key: ini.key, phase: 1, title: PLAN.steps[0]!.title, scope: PLAN.steps[0]!.done_when, checks: [PLAN.steps[0]!.done_when], work_type: "code", priority: "P2", status: "Ready" });
      w.stepKey = step.key;
      const fresh = await idea(run);
      await run.call("set_task", { project: run.project, key: run.key, promoted_to: ini.key, version: fresh.version });
      await closingLine(run, `Creé ${ini.key} con su primer paso ${step.key}.`);
      return;
    }
    if (t.stage === "idea" || !t.stage) {
      await run.call("set_task", { project: run.project, key: run.key, note: "Entendí: quieres ver a tus clientes en una lista.", version: t.version });
      await run.call("deliver_stage", { project: run.project, key: run.key, stage: "idea", data: IDEA });
      await moveStage(run, "research");
      return;
    }
    if (t.stage === "planning") {
      await run.call("deliver_stage", { project: run.project, key: run.key, stage: "planning", data: PLAN });
      await moveStage(run, "ready");
    }
  },
  research: async (run) => {
    if ((await idea(run)).stage !== "research") return;
    await run.call("deliver_stage", { project: run.project, key: run.key, stage: "research", data: RESEARCH });
    await moveStage(run, "design");
  },
  artist: async (run) => {
    if ((await idea(run)).stage !== "design") return;
    await run.call("deliver_stage", { project: run.project, key: run.key, stage: "design", data: DESIGN });
    await moveStage(run, "planning");
  },
  taller: async (run, w) => {
    if (!run.key || !run.workspace) return;
    const ws = run.workspace;
    await run.call("start", { project: run.project, key: run.key, workspace: { worktree_path: ws.path, branch: ws.branch } });
    const branch = ws.branch ?? gitIn(ws.path, "rev-parse", "--abbrev-ref", "HEAD");
    // The change: the list on the Clientes page, and its test. A real commit, pushed to origin.
    w.build?.(ws.path, run);
    // A delivery the owner sent back carries his words in the prompt (PLA-71): the builder does what they say.
    const changes = /Their words: «([^»]*)»/.exec(run.prompt)?.[1];
    const names = changes ? ["Ana", "Beto", "Luis"] : ["Ana", "Luis"];
    writeFileSync(path.join(ws.path, "pages", "clientes.html"), `<!doctype html><title>Clientes</title><h1>Clientes</h1><ul id="clientes">${names.map((x) => `<li>${x}</li>`).join("")}</ul>\n`);
    gitIn(ws.path, "add", "-A");
    // Woken again with nothing to change (the photos failed on Plania's side): no new commit, the same head delivered.
    if (gitIn(ws.path, "status", "--porcelain")) gitIn(ws.path, "-c", "user.name=taller", "-c", "user.email=taller@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", `${run.key}: la lista de clientes`);
    gitIn(ws.path, "push", "-q", "-u", "origin", `HEAD:${branch}`);
    w.github.pushed(branch);
    const pr = await w.github.gh(["pr", "create", "--repo", w.github.repo, "--base", "sandbox", "--head", branch, "--title", `${run.key}: la lista de clientes`, "--body", `Plania: ${run.key}`]);
    const url = pr.stdout.trim();
    const t = await run.call("get_task", { project: run.project, key: run.key });
    const out = await run.tryCall("finish", {
      project: run.project,
      key: run.key,
      pr_url: url,
      branch,
      result: { kind: "test", verdict: "pass", cite: "node --test test/*.test.mjs: pass", command: "node --test test/*.test.mjs", commit: head(ws.path), branch, check_ns: (t.checks as Json[]).map((c) => c.n) },
      muestra: MUESTRA,
    });
    if (out.error) {
      w.refusals.push({ key: run.key, error: out.error });
      if (!w.fixOnRefusal?.(ws.path, run, out)) throw new Error(`finish refused: ${JSON.stringify(out.error)} ${JSON.stringify(out.detail ?? "").slice(0, 400)}`);
      // The builder fixes what the refusal names in the same run, commits, pushes and finishes again.
      gitIn(ws.path, "add", "-A");
      gitIn(ws.path, "-c", "user.name=taller", "-c", "user.email=taller@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", `${run.key}: arreglo la prueba`);
      gitIn(ws.path, "push", "-q", "origin", `HEAD:${branch}`);
      w.github.pushed(branch);
      await run.call("finish", { project: run.project, key: run.key, pr_url: url, branch, result: { kind: "test", verdict: "pass", cite: "node --test test/*.test.mjs: pass", command: "node --test test/*.test.mjs", commit: head(ws.path), branch, check_ns: (t.checks as Json[]).map((c) => c.n) }, muestra: MUESTRA });
    }
    await closingLine(run, `Entregué ${run.key}: ${url}`);
  },
  // Asistente answers what Plania already says; a PO's product question is the owner's, so it leaves it.
  asistente: async () => "La pregunta es del dueño.",
  // QA's review run: its report is the run's final text, a qa-report block over the PO's checks.
  qa: async (run) => {
    const t = await run.call("get_task", { project: run.project, key: run.key });
    const checklist = (t.checks as Json[]).map((c) => ({ n: c.n, mark: "pass", note: "Visto en la página Clientes." }));
    return "Revisé la entrega.\n```qa-report\n" + JSON.stringify({ spec: { verdict: "pass", notes: "Hace lo que pide el paso." }, code: { verdict: "pass", notes: "Cambio pequeño y claro." }, checklist, walked: true }) + "\n```";
  },
};

