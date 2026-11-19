// PLA-I2-15: a clean install, as steps a buyer takes, for the end-to-end test (test/clean-install.test.ts).
// PLA-I2-16 extends it to an accepted delivery: add steps that take a CleanInstall and leave their result on it.
//
// What a buyer has, and nothing else: an empty Postgres, the install module (the machine check injected as ready),
// the server started on the settings file the install wrote, the screen's HTTP routes (first start with the one-time
// code, login, a project from the sheet, Reanudar, a request), and the runner's heartbeat with the fake Claude.
// Outside calls are injected: git, the plan-use probe, free memory and disk. No seed script, no SQL typed by hand, no
// value written into .env by anyone but the install.
import { spawn as nodeSpawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import pg from "pg";

export const REPO = path.resolve(import.meta.dirname, "..");
export const FAKE_CLAUDE = path.join(REPO, "test", "fixtures", "fake-claude.mjs");
// The note the fake Claude leaves on its ticket through the MCP: the visible proof the run reached the plan.
export const RUN_NOTE = "Primer paso hecho desde la instalación limpia.";

// The settings the server reads from its environment: everything the install may write, and the names a hand-made
// install pasted in. The test's environment holds none of them except what the install wrote.
const SERVER_ENV = /^(PLANIA_|MCP_|SESSION_SECRET$|DATABASE_URL$|GITHUB_TOKEN$|VERCEL_TOKEN$|VAPID_|PORT$)/;

type Json = Record<string, any>;

export type CleanInstall = {
  adminUrl: string;
  url: string;
  database: string;
  scratch: string;
  envPath: string;
  setupCode: string | null;
  base: string;
  cookie: string;
  project: string;
  ticket: string;
  // PLA-I2-16: the step «Sí, empiecen» made, and what Aceptar did.
  step: string;
  accepted: Json | null;
  stop: Array<() => Promise<void>>;
};

export function newCleanInstall(adminUrl: string, database: string): CleanInstall {
  if (!/^plania_test_[a-z0-9_]+$/.test(database)) throw new Error(`refusing to use ${database}: tests use plania_test_* only`);
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return {
    adminUrl,
    url: url.toString(),
    database,
    scratch: mkdtempSync(path.join(tmpdir(), "plania-clean-install-")),
    envPath: "",
    setupCode: null,
    base: "",
    cookie: "",
    project: "",
    ticket: "",
    step: "",
    accepted: null,
    stop: [],
  };
}

async function admin(w: CleanInstall, sql: string): Promise<void> {
  const c = new pg.Client({ connectionString: w.adminUrl });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

export async function dropDatabase(w: CleanInstall): Promise<void> {
  await admin(w, `drop database if exists ${w.database} with (force)`);
}

// Step 0: an empty Postgres (no database of this name) and an environment with none of the server's settings.
export async function emptyMachine(w: CleanInstall): Promise<void> {
  await dropDatabase(w);
  for (const k of Object.keys(process.env)) if (SERVER_ENV.test(k)) delete process.env[k];
}

// Step 1: the install command's core, as `pnpm plania:install` runs it, writing its settings file in the scratch dir.
export async function install(w: CleanInstall): Promise<{ applied: string[]; created: boolean }> {
  const { install: run } = await import("../src/db/install.js");
  w.envPath = path.join(w.scratch, ".env");
  const r = await run({
    url: w.url,
    named: false,
    envPath: w.envPath,
    examplePath: path.join(REPO, ".env.example"),
    machineCheck: async () => ({ ok: true, lines: [] }),
  });
  w.setupCode = r.setupCode;
  return r;
}

// Step 2: start the server as `pnpm start` does (tsx --env-file=.env scripts/dev.ts): the environment is the settings
// file the install wrote, the start-up check runs first, then the app is served on loopback.
export async function startServer(w: CleanInstall): Promise<{ startupProblem: string | null }> {
  const written = parseEnv(readFileSync(w.envPath, "utf8"));
  for (const k of Object.keys(process.env)) if (SERVER_ENV.test(k)) delete process.env[k];
  process.loadEnvFile(w.envPath);
  const leaked = Object.keys(process.env).filter((k) => SERVER_ENV.test(k) && !(k in written));
  if (leaked.length) throw new Error(`the server's environment holds values the install did not write: ${leaked.join(", ")}`);

  const { startupProblem } = await import("../src/db/migrate.js");
  const problem = await startupProblem(process.env.DATABASE_URL);
  if (problem) return { startupProblem: problem };

  const { serve } = await import("@hono/node-server");
  const { app } = await import("../src/app.js");
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise((res) => server.once("listening", res));
  // 127.0.0.1, not localhost: a runner may resolve localhost to ::1 first. First start accepts either host.
  w.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  w.stop.push(() => new Promise((res) => server.close(() => res())));
  return { startupProblem: null };
}

export async function http(w: CleanInstall, method: string, route: string, body?: unknown): Promise<{ status: number; json: Json; text: string; headers: Headers }> {
  const res = await fetch(`${w.base}${route}`, {
    method,
    headers: { "Content-Type": "application/json", ...(w.cookie ? { Cookie: w.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // Not JSON: the text says what came back.
  }
  return { status: res.status, json, text, headers: res.headers };
}

export const OWNER = { name: "Ana", password: "una contraseña larga de prueba", time_zone: "Europe/Madrid" };

// Step 3: the first-start screen, from a browser on this machine, with the code the install printed.
export async function firstStart(w: CleanInstall): Promise<Json> {
  const open = await http(w, "GET", "/api/first-start");
  if (!open.json.open) throw new Error(`first start is not open: ${open.text}`);
  const r = await http(w, "POST", "/api/first-start", { code: w.setupCode ?? "", ...OWNER });
  if (r.status !== 201) throw new Error(`first start refused (${r.status}): ${r.text}`);
  return r.json;
}

// Step 4: sign in on the login page with the password chosen at first start.
export async function login(w: CleanInstall): Promise<void> {
  w.cookie = "";
  const r = await http(w, "POST", "/api/login", { password: OWNER.password });
  if (r.status !== 204) throw new Error(`login refused (${r.status}): ${r.text}`);
  w.cookie = (r.headers.get("set-cookie") ?? "").split(";")[0]!;
}

// Step 5: «+ Nuevo proyecto», a project with no code yet (the sheet's no-code choice). PLA-I2-16: { repo } names a
// GitHub repository instead (owner/name), so its builder can open a PR and Aceptar merges it; its clone is a folder
// under the runner's projects root (runnerDeps), which the injected git answers for.
export async function createProject(w: CleanInstall, name = "Primero", opts: { repo?: string } = {}): Promise<Json> {
  const code = opts.repo ? { github_repo: opts.repo } : { no_code: true };
  if (opts.repo) {
    // gh, injected: the repository exists, this login can write to it, and it has the working branch.
    const { setNewProjectRepoCheck } = await import("../src/api/company.js");
    setNewProjectRepoCheck({
      git: async () => ({ code: 0, stdout: "", stderr: "" }),
      isDir: () => true,
      gh: async (args: string[]) => ({ code: 0, stdout: args[0] === "repo" ? "WRITE\n" : "sandbox\n", stderr: "" }),
    });
    w.stop.push(async () => setNewProjectRepoCheck(null));
  }
  const r = await http(w, "POST", "/api/company/projects", { name, goal: "Probar que una instalación nueva llega a un trabajo hecho.", ...code });
  if (r.status !== 201) throw new Error(`project refused (${r.status}): ${r.text}`);
  w.project = r.json.slug;
  return r.json;
}

// Step 6: Reanudar, on the company and on the project.
export async function resume(w: CleanInstall): Promise<void> {
  for (const route of ["/api/company/switch", `/api/company/projects/${w.project}/switch`]) {
    const r = await http(w, "POST", route, { paused: false });
    if (r.status !== 200) throw new Error(`${route} refused (${r.status}): ${r.text}`);
  }
}

// Step 7: a request on the project, through the screen's ask route.
export async function ask(w: CleanInstall, text = "Haz la primera página"): Promise<Json> {
  const r = await http(w, "POST", `/api/company/projects/${w.project}/ask`, { text, now: false });
  if (r.status !== 201) throw new Error(`request refused (${r.status}): ${r.text}`);
  w.ticket = r.json.key;
  return r.json;
}

// The runner's outside calls. git answers as a repo would and makes the folders it is asked for; the run is the
// fake Claude as a real child process with the environment the runner built; plan use is low; the machine has room.
export function runnerDeps(w: CleanInstall, extra: Record<string, string> = {}): Json {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_BIN: FAKE_CLAUDE,
    CLAUDE_FAKE_MS: "60",
    CLAUDE_FAKE_COMMENT: RUN_NOTE,
    ...extra,
    // The run's MCP is this server; a real install serves on the default port the runner already uses.
    PLANIA_MCP_URL: `${w.base}/mcp`,
    // Where the project's clone is (PLA-I2-5 makes it on a real install); git is injected, so a folder is enough.
    PLANIA_PROJECTS_ROOT: path.join(w.scratch, "projects"),
  };
  if (w.project) mkdirSync(path.join(w.scratch, "projects", w.project), { recursive: true });
  return {
    env,
    logDir: path.join(w.scratch, "logs"),
    tmpDir: path.join(w.scratch, "tmp"),
    worktreeRoot: path.join(w.scratch, "worktrees"),
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async (args: string[]) => {
      const at = args.indexOf("add");
      if (args[0] === "worktree" && at >= 0) {
        const dir = args.slice(at + 1).find((a) => !a.startsWith("-") && (a.includes("/") || a.includes("\\")));
        if (dir) mkdirSync(dir, { recursive: true });
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    // The fake Claude runs under this Node on every system (a .mjs is not a program on Windows).
    spawn: (_cmd: string, args: string[], opts: Json) => nodeSpawn(process.execPath, [FAKE_CLAUDE, ...args], { ...opts, detached: false }),
    kill: () => undefined,
    probeUsage: async () => "Current session: 10% used\nCurrent week (all models): 5% used",
    machine: () => ({ freeMemBytes: 64 * 2 ** 30, freeDiskBytes: 500 * 2 ** 30 }),
  };
}

// Step 8: the heartbeat drains the queue the request filled, and the run finishes.
export async function heartbeat(w: CleanInstall, extra: Record<string, string> = {}): Promise<{ started: number }> {
  const { waitForAskWakes } = await import("../src/api/company-actions.js");
  const runner = await import("../src/runner/runner.js");
  const { makeDb } = await import("../src/db/client.js");
  await waitForAskWakes();
  await runner.waitForAllRuns();
  const r = await runner.drainQueue(makeDb().db, new Date(), runnerDeps(w, extra) as never);
  await runner.waitForAllRuns();
  return r;
}

// Step 9: what the owner sees afterwards: the ticket, its comment thread with the run's note, the project's page.
export async function workOnProject(w: CleanInstall): Promise<{ ticket: Json; comments: Json[]; project: Json }> {
  const ticket = await http(w, "GET", `/api/projects/${w.project}/tasks/${w.ticket}`);
  const thread = await http(w, "GET", `/api/delegation/comments?project=${w.project}&key=${w.ticket}`);
  const project = await http(w, "GET", `/api/company/projects/${w.project}`);
  for (const r of [ticket, thread, project]) if (r.status !== 200) throw new Error(`reading the project failed (${r.status}): ${r.text}`);
  return { ticket: ticket.json, comments: thread.json.comments, project: project.json };
}

// ---- PLA-I2-16: from the first request to an accepted delivery

// What the fake Claude does in the product owner's run: it answers the request with a plan of one code step, through
// the MCP, as `propose` (the project approves plans, so it waits for «Sí, empiecen»).
export const PLAN_CALLS = JSON.stringify([
  {
    name: "propose",
    arguments: {
      project: "{project}",
      kind: "plan",
      order: "{key}",
      title: "La primera página",
      understood: "Quieres una primera página sencilla.",
      steps: [{ title: "Hacer la primera página", done_when: "La página abre y dice el nombre del proyecto", work_type: "code" }],
    },
  },
]);

export const PR_URL = "https://github.com/ana/primero/pull/1";
export const HEAD = "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0";

// What the fake Claude does in the builder's run: it claims the step, then finishes it with a passing test at the
// branch head and the PR, as Taller does after pushing.
export const FINISH_CALLS = JSON.stringify([
  { name: "start", arguments: { project: "{project}", key: "{key}" } },
  {
    name: "finish",
    arguments: {
      project: "{project}",
      key: "{key}",
      pr_url: PR_URL,
      branch: "plania/{key}",
      result: { kind: "test", verdict: "pass", cite: "La página abre y dice el nombre del proyecto.", commit: HEAD, branch: "plania/{key}", check_ns: [1] },
    },
  },
]);

// The rows Te toca shows for this project, as the screen reads them (GET /api/company).
export async function decisions(w: CleanInstall): Promise<Json[]> {
  const r = await http(w, "GET", "/api/company");
  if (r.status !== 200) throw new Error(`the company page failed (${r.status}): ${r.text}`);
  return (r.json.decisions ?? []).filter((d: Json) => d.project === w.project || d.project?.slug === w.project);
}

// «Sí, empiecen» on the product owner's plan: one Ready step for the builder.
export async function approvePlan(w: CleanInstall): Promise<Json> {
  const plan = (await decisions(w)).find((d) => d.kind === "plan");
  if (!plan) throw new Error(`no plan waits on the company page: ${JSON.stringify(await decisions(w))}`);
  const r = await http(w, "POST", `/api/company/decisions/${plan.id}`, { action: "empezar" });
  if (r.status !== 200) throw new Error(`«Sí, empiecen» refused (${r.status}): ${r.text}`);
  w.step = r.json.state?.result?.created?.[0] ?? "";
  return r.json;
}

// The answers gh gives for one open PR into the project's working branch, then its merge. Recorded calls in `calls`.
export function fakeGh(base: string, calls: string[][] = []): (args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return async (args) => {
    calls.push(args);
    const json = args[args.indexOf("--json") + 1] ?? "";
    const ok = (o: unknown) => ({ ok: true, stdout: JSON.stringify(o), stderr: "" });
    if (args[1] === "merge") return { ok: true, stdout: "", stderr: "" };
    if (json.startsWith("baseRefName")) return ok({ baseRefName: base, state: "OPEN", headRefOid: HEAD, url: PR_URL });
    if (json === "mergeable") return ok({ mergeable: "MERGEABLE" });
    if (json.startsWith("mergeCommit")) return ok({ mergeCommit: { oid: "f".repeat(40) }, url: PR_URL });
    return { ok: false, stdout: "", stderr: `unexpected gh ${args.join(" ")}` };
  };
}

// Aceptar on the builder's delivery, from Te toca, with gh injected (the merge into the working branch).
export async function acceptDelivery(w: CleanInstall, gh: (args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>): Promise<Json> {
  const { releaseGh } = await import("../src/mcp/release-ship.js");
  const delivery = (await decisions(w)).find((d) => (d.kind === "pr" || d.kind === "deliverable") && JSON.stringify(d).includes(w.step));
  if (!delivery) throw new Error(`no delivery of ${w.step} waits on the company page: ${JSON.stringify(await decisions(w))}`);
  const action = (delivery.actions as string[]).includes("fusionar") ? "fusionar" : "aceptar";
  const before = releaseGh.run;
  releaseGh.run = gh;
  try {
    const r = await http(w, "POST", `/api/company/decisions/${delivery.id}`, { action });
    if (r.status !== 200) throw new Error(`Aceptar refused (${r.status}): ${r.text}`);
    w.accepted = r.json;
    return r.json;
  } finally {
    releaseGh.run = before;
  }
}

export async function teardown(w: CleanInstall): Promise<void> {
  for (const stop of w.stop.reverse()) await stop().catch(() => undefined);
  const { resetPool } = await import("../src/db/client.js");
  await resetPool().catch(() => undefined);
  await dropDatabase(w).catch(() => undefined);
  rmSync(w.scratch, { recursive: true, force: true });
}
