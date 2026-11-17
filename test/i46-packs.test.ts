// PLA-I46-12: skill packs. Stored as `Pack: <name>` docs in Plania, carried by a role (agents.skill_packs),
// written into the run's worktree only for the role that carries them, removed when the run ends, and never
// in the PR diff. Fake child and fake git for the runner (no real claude), real git only in a temp folder,
// and the throwaway test store (test/helpers.ts), never a live one.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const writes = await import("../src/mcp/writes.js");
const { wakeAgent } = await import("../src/jobs/heartbeat.js");
const runner = await import("../src/runner/runner.js");
const packs = await import("../src/runner/packs.js");
const { defaultGit } = await import("../src/runner/worktree.js");

type Db = ReturnType<typeof makeDb>["db"];
let store: TestStore;
let db: Db;
let closeDb: () => Promise<void>;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-packs-test-"));
const repo = path.join(scratch, "repos", "micasa");
const wtRoot = path.join(scratch, "worktrees");
const ctx = { actor: { agent: "test-agent", session_id: "s-i46-12" } };
const jorge = { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${createSession()}` };

class FakeChild extends EventEmitter {
  pid: number;
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  exit(code: number): void {
    this.stdout.write(
      `${JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, session_id: `sess-${this.pid}`, result: "OK", modelUsage: { m: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } })}\n`,
    );
    this.stdout.end();
    setImmediate(() => this.emit("exit", code, null));
  }
}

type Seen = { cwd: string; prompt: string; child: FakeChild; packFiles: string[] };

// diff: what `git diff --name-only` answers in the worktree (the guard's question).
function fakes(opts: { diff?: string } = {}) {
  const spawned: Seen[] = [];
  let pid = 50_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: wtRoot,
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async (args: string[], cwd: string) => {
      if (args[0] === "worktree" && args[1] === "add") {
        const target = args.find((a) => a.startsWith(wtRoot))!;
        mkdirSync(target, { recursive: true });
        writeFileSync(path.join(target, ".git"), "gitdir: fake\n");
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") return { code: 1, stdout: "", stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: "jl/feature\n", stderr: "" };
      if (args[0] === "diff" && cwd.startsWith(wtRoot)) return { code: 0, stdout: opts.diff ?? "src/app.ts\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    spawn: (_command: string, args: string[], options: { cwd: string }) => {
      pid += 1;
      const child = new FakeChild(pid);
      const dir = path.join(options.cwd, packs.PACK_DIR);
      const packFiles = existsSync(dir) ? execFileSync("ls", ["-A", dir], { encoding: "utf8" }).split("\n").filter(Boolean).sort() : [];
      spawned.push({ cwd: options.cwd, prompt: args[args.indexOf("-p") + 1]!, child, packFiles });
      return child;
    },
    kill: () => undefined,
    reportTokens: async (_db: unknown, input: unknown) => input,
    probeUsage: async () => null,
  };
  return { deps, spawned };
}

const projectId = async (slug: string) => store.projectId(slug);
const ready = (key: string) => writes.createTask(db, { project: "micasa", key, title: "Pack ticket", scope: "Scope", checks: ["Done"], status: "Ready" } as never, ctx);
const wake = (slug: string, deps: unknown, taskKey: string) => wakeAgent(db, { agent: slug, taskKey, now: new Date() }, { runner: deps as never });
// The agent's newest run.
const lastRun = async (slug: string): Promise<{ status: string; summary: string }> => {
  const agent = (await store.get("agents", { slug }))!;
  const [r] = await store.find("agentRuns", { agentId: agent.id }, { orderBy: [{ column: "queuedAt", desc: true }], limit: 1 });
  return { status: r!.status, summary: r!.summary };
};
const packsOfAgent = async (slug: string) => (await store.get("agents", { slug }))!.skillPacks;

const PACK_DOCS: [string, string][] = [
  ["Pack: Pruebas primero", "# Pruebas primero\n\nCuándo: antes de cambiar código que tiene o debería tener pruebas.\n\n1. Escribe la prueba que falla (rojo).\n2. Haz el cambio mínimo (verde).\n3. Abre el PR."],
  ["Pack: Español claro", "# Español claro\n\n**Cuándo:** al escribir texto que Jorge lee.\n\nFrases cortas."],
  ["Pack: Sin cuándo", "# Sin cuándo\n\nNo tiene la línea, así que no es un paquete."],
];

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  mkdirSync(repo, { recursive: true });
  const micasa = await projectId("micasa");
  await store.fix(async (uow) => {
    await uow.update("agents", {}, { heartbeatMinutes: null, adapter: "none", adapterConfig: {} });
    await uow.update("agents", { slug: ["taller", "research"] }, { adapter: "claude_code" });
    // Taller and Research are on MiCasa's team for the API routes.
    await uow.update("agents", { slug: ["taller", "research"] }, { projectId: micasa });
    await uow.update("projects", { slug: "micasa" }, { settings: { local: { repo_path: repo } } });
    const actor = { agent: "test", session_id: "s" };
    for (const title of ["Prompt: Taller", "Prompt: Research"]) await uow.insert("docs", { projectId: micasa, title, markdown: `# ${title}\nNever main.`, actor });
    for (const [title, markdown] of PACK_DOCS) await uow.insert("docs", { projectId: micasa, title, markdown, actor });
    await uow.insert("goals", { projectId: micasa, title: "Ship the MiCasa beta", why: "" });
  });
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  await store.fix(async (uow) => {
    await uow.delete("agentRuns", {});
    await uow.delete("agentSessions", {});
    await uow.delete("heartbeatRuns", {});
    await uow.update("runnerSettings", { id: 1 }, { companyPaused: false, maxConcurrent: 2, cooldownMinutes: 0, planGuardPct: 70, guardOverride: false, reserveTokens: 1000 });
    await uow.update("projects", { slug: "micasa" }, { runsPaused: false });
    await uow.delete("planReadings", {});
    const now = new Date();
    await uow.insert("planReadings", { at: now, source: "stream", status: "allowed", fiveHourPct: 10, sevenDayPct: 19, fiveHourResetsAt: new Date(now.getTime() + 3 * 3_600_000) });
    await uow.update("agents", {}, { skillPacks: [] });
  });
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await store?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("I46-12: a pack doc gives slug, name and its one «Cuándo» line; a doc without one is not a pack", async () => {
  assert.equal(packs.packSlug("Preguntas antes de construir"), "preguntas-antes-de-construir");
  assert.equal(packs.packSlug("Revisión de seguridad"), "revision-de-seguridad");
  assert.equal(packs.packSlug("QA visual con capturas"), "qa-visual-con-capturas");
  assert.equal(packs.whenOf("# X\n\n**Cuándo:** al escribir texto.\n"), "al escribir texto.");
  assert.equal(packs.whenOf("When: before a PR"), "before a PR");
  assert.equal(packs.whenOf("# X\nnada"), null);
  const list = await packs.listPacks(db);
  assert.deepEqual(
    list.map((p) => [p.slug, p.name, p.when]),
    [
      ["espanol-claro", "Español claro", "al escribir texto que Jorge lee."],
      ["pruebas-primero", "Pruebas primero", "antes de cambiar código que tiene o debería tener pruebas."],
    ],
  );
});

test("I46-12: the API reads and sets a role's packs (screen only); unknown packs are refused", async () => {
  const catalog = await app.request("/api/company/packs", { headers: jorge });
  assert.equal(catalog.status, 200);
  const body = (await catalog.json()) as { packs: { slug: string; name: string; when: string; doc_id: string }[] };
  assert.deepEqual(Object.keys(body.packs[0]!).sort(), ["doc_id", "name", "slug", "when"]);

  const put = await app.request("/api/company/projects/micasa/team/taller/packs", { method: "PUT", headers: jorge, body: JSON.stringify({ packs: ["pruebas-primero", "pruebas-primero"] }) });
  assert.equal(put.status, 200);
  assert.deepEqual(((await put.json()) as { packs: { slug: string }[] }).packs.map((p) => p.slug), ["pruebas-primero"]);
  assert.deepEqual(await packsOfAgent("taller"), ["pruebas-primero"]);

  const get = await app.request("/api/company/projects/micasa/team/taller/packs", { headers: jorge });
  assert.equal(((await get.json()) as { packs: { slug: string }[] }).packs[0]!.slug, "pruebas-primero");

  const bad = await app.request("/api/company/projects/micasa/team/taller/packs", { method: "PUT", headers: jorge, body: JSON.stringify({ packs: ["sin-cuando"] }) });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "UNKNOWN_PACK", hint: "no pack doc for sin-cuando", packs: ["sin-cuando"] });
  const elsewhere = await app.request("/api/company/projects/workia/team/taller/packs", { headers: jorge });
  assert.equal(elsewhere.status, 404);
  const bearer = await app.request("/api/company/packs", { headers: { ...jorge, Authorization: "Bearer test-token" } });
  assert.equal(bearer.status, 403);

  // The project read shows each member's packs for the hire sheet.
  const read = (await (await app.request("/api/company/projects/micasa", { headers: jorge })).json()) as { team: { agent: string; packs: string[] }[] };
  assert.deepEqual(read.team.find((m) => m.agent === "taller")?.packs, ["pruebas-primero"]);
});

test("I46-12 #2/#3: the role with the pack has it in its worktree and prompt; a role without it gets neither; both are removed at the end", async () => {
  await store.fix((uow) => uow.update("agents", { slug: "taller" }, { skillPacks: ["pruebas-primero"] }));
  await ready("RUN-PK");
  const f = fakes();
  assert.equal((await wake("taller", f.deps, "RUN-PK")).reason, "ok");
  const withPack = f.spawned[0]!;
  assert.deepEqual(withPack.packFiles, [".gitignore", "pruebas-primero.md"]);
  assert.match(withPack.prompt, /- Pruebas primero \(\.plania-packs\/pruebas-primero\.md\): antes de cambiar código/);
  assert.equal(readFileSync(path.join(withPack.cwd, packs.PACK_DIR, "pruebas-primero.md"), "utf8"), `${PACK_DOCS[0]![1]}\n`);
  withPack.child.exit(0);
  await runner.waitForAllRuns();
  assert.equal(existsSync(path.join(withPack.cwd, packs.PACK_DIR)), false, "the pack leaves with the run");
  assert.equal((await lastRun("taller")).status, "ok");

  // Same ticket, same worktree, a role that does not carry the pack: no body and no line.
  mkdirSync(path.join(withPack.cwd, packs.PACK_DIR), { recursive: true });
  writeFileSync(path.join(withPack.cwd, packs.PACK_DIR, "pruebas-primero.md"), "left over");
  assert.equal((await wake("research", f.deps, "RUN-PK")).reason, "ok");
  const without = f.spawned[1]!;
  assert.equal(without.cwd, withPack.cwd);
  assert.deepEqual(without.packFiles, []);
  assert.doesNotMatch(without.prompt, /Skill packs|Pruebas primero/);
  without.child.exit(0);
  await runner.waitForAllRuns();
});

test("I46-12 #2: the guard fails the run when a pack file shows in the branch diff", async () => {
  await store.fix((uow) => uow.update("agents", { slug: "taller" }, { skillPacks: ["espanol-claro"] }));
  await ready("RUN-LEAK");
  const f = fakes({ diff: "src/app.ts\n.plania-packs/espanol-claro.md\n" });
  await wake("taller", f.deps, "RUN-LEAK");
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
  const run = await lastRun("taller");
  assert.equal(run.status, "fail");
  assert.equal(run.summary, "fail: pack file in the diff (.plania-packs/espanol-claro.md)");
  const [hb] = await store.find("heartbeatRuns", {}, { orderBy: [{ column: "startedAt", desc: true }], limit: 1 });
  assert.equal(hb!.status, "fail");
});

test("I46-12 #2 on real git: `git add -A` never stages a pack, and a forced one is caught by the guard", async () => {
  const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  const base = path.join(scratch, "real");
  const origin = path.join(base, "origin.git");
  const appRepo = path.join(base, "app");
  const wt = path.join(base, "wt");
  mkdirSync(appRepo, { recursive: true });
  git(["init", "-q", "--bare", "-b", "sandbox", origin], base);
  git(["init", "-q", "-b", "sandbox"], appRepo);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base"], appRepo);
  git(["remote", "add", "origin", origin], appRepo);
  git(["push", "-q", "origin", "sandbox"], appRepo);
  git(["fetch", "-q", "origin"], appRepo);
  git(["worktree", "add", "-q", "--no-track", wt, "-b", "jl/pack", "origin/sandbox"], appRepo);

  const all = await packs.listPacks(db);
  packs.writePacks(wt, all);
  writeFileSync(path.join(wt, "feature.ts"), "export const x = 1;\n");
  git(["add", "-A"], wt);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "work"], wt);
  assert.deepEqual(git(["diff", "--name-only", "origin/sandbox...HEAD"], wt).trim().split("\n"), ["feature.ts"]);
  assert.deepEqual(await packs.packsInDiff(wt, defaultGit), []);

  git(["add", "-f", ".plania-packs/pruebas-primero.md"], wt);
  assert.deepEqual(await packs.packsInDiff(wt, defaultGit), [".plania-packs/pruebas-primero.md"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "oops"], wt);
  assert.deepEqual(await packs.packsInDiff(wt, defaultGit), [".plania-packs/pruebas-primero.md"]);

  // The tree leaves clean once the run's packs are cleared, so `git worktree remove` works.
  git(["rm", "-q", "--cached", ".plania-packs/pruebas-primero.md"], wt);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "undo"], wt);
  packs.clearPacks(wt);
  git(["worktree", "remove", wt], appRepo);
  assert.equal(existsSync(wt), false);
});

test("I46-12: hiring with packs sets them in the same call; an unknown pack hires nobody", async () => {
  const bad = await app.request("/api/company/projects/micasa/team", { method: "POST", headers: jorge, body: JSON.stringify({ template: "research", packs: ["nope"] }) });
  assert.equal(bad.status, 400);
  assert.equal(await store.count("agents", { slug: "research-micasa" }), 0);
  const ok = await app.request("/api/company/projects/micasa/team", { method: "POST", headers: jorge, body: JSON.stringify({ template: "research", packs: ["espanol-claro"] }) });
  assert.equal(ok.status, 201);
  const out = (await ok.json()) as { agent: { agent: string; packs: string[] }; packs: { slug: string }[] };
  assert.equal(out.agent.agent, "research-micasa");
  assert.deepEqual(out.packs.map((p) => p.slug), ["espanol-claro"]);
  assert.deepEqual(out.agent.packs, ["espanol-claro"]);
  assert.deepEqual(await packsOfAgent("research-micasa"), ["espanol-claro"]);
});

test("I46-13: the project read lists every role with free, taken or no_doc; Seguridad is hired with its packs and joins the team", async () => {
  const read = async () => (await (await app.request("/api/company/projects/micasa", { headers: jorge })).json()) as { hire: { slug: string; state: string }[]; templates: { slug: string }[]; team: { agent: string; template: string | null; packs: string[] }[] };
  const stateOf = (r: Awaited<ReturnType<typeof read>>, slug: string) => r.hire.find((x) => x.slug === slug)?.state;
  const first = await read();
  assert.equal(stateOf(first, "seguridad"), "no_doc");
  assert.equal(stateOf(first, "qa"), "no_doc");
  assert.equal(first.templates.some((t) => t.slug === "seguridad"), false);
  const micasa = await projectId("micasa");
  await store.fix((uow) => uow.insert("docs", { projectId: micasa, title: "Prompt: Seguridad", markdown: "# Seguridad", actor: { agent: "test", session_id: "s" } }));
  const second = await read();
  assert.equal(stateOf(second, "seguridad"), "free");
  assert.ok(second.templates.some((t) => t.slug === "seguridad"));

  const res = await app.request("/api/company/projects/micasa/team", {
    method: "POST",
    headers: jorge,
    body: JSON.stringify({ template: "seguridad", packs: ["pruebas-primero", "espanol-claro"] }),
  });
  assert.equal(res.status, 201);
  const row = (await store.get("agents", { slug: "seguridad-micasa" }))!;
  assert.deepEqual(
    { role: row.role, template: row.roleTemplate, project: row.projectId, packs: row.skillPacks, adapter: row.adapter },
    { role: "seguridad", template: "seguridad", project: micasa, packs: ["pruebas-primero", "espanol-claro"], adapter: "claude_code" },
  );
  // Its window: the next read has it on the team, with its packs; the role is taken now.
  const third = await read();
  assert.equal(stateOf(third, "seguridad"), "taken");
  const member = third.team.find((m) => m.agent === "seguridad-micasa");
  assert.deepEqual(member && { template: member.template, packs: member.packs }, { template: "seguridad", packs: ["pruebas-primero", "espanol-claro"] });
  const company = (await (await app.request("/api/company", { headers: jorge })).json()) as { projects: { slug: string; team: { agent: string }[] }[] };
  assert.ok(company.projects.find((p) => p.slug === "micasa")?.team.some((m) => m.agent === "seguridad-micasa"));
});
