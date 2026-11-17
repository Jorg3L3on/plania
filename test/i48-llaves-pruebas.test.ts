// PLA-I48-3: Llaves (names set or missing, never a value), Pruebas (a run on demand with a fake exec: pass, fail
// with the tail, a second call refused while one runs) and Cómo probarla (the doc's steps, else the capture pages;
// the password route refuses a user outside the reserved test domains). Test store only, fake repos in a temp dir.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";
import type { ProjectSettings } from "../src/db/schema.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i48-llaves-"));
const WT = path.join(TMP, "wt");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const maquinas = await import("../src/maquinas/machines.js");
const pruebas = await import("../src/maquinas/pruebas.js");
type Json = Record<string, any>;

const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
const call = async (method: string, url: string): Promise<{ status: number; body: Json; text: string }> => {
  const r = await app.request(url, { method, headers: jorge() });
  const text = await r.text();
  return { status: r.status, body: JSON.parse(text) as Json, text };
};

const REPO = path.join(TMP, "zigzag");
const PRUEBA = path.join(WT, "zigzag", "_prueba");
const FAKE_SECRET = "sk_test_fake_value_7731";
let store: TestStore;
type ExecCall = { command: string; cwd: string; stdin?: string; env?: NodeJS.ProcessEnv };
let execs: ExecCall[] = [];
let gate: (() => void) | null = null;
let answers: Record<string, { code: number; stdout: string; stderr?: string }> = {};
// The zigzag project's settings, changed in place (what jsonb || and jsonb_set did in SQL).
const zigzagSettings = (change: (s: ProjectSettings) => ProjectSettings) =>
  store.fix(async (uow) => {
    const p = (await uow.get("projects", { slug: "zigzag" }))!;
    await uow.update("projects", { id: p.id }, { settings: change(structuredClone(p.settings)) });
  });
const setTestUser = (user: string) =>
  zigzagSettings((s) => {
    s.capture!.session!.user = user;
    return s;
  });

before(async () => {
  store = await resetTestStore();
  for (const d of [REPO, path.join(PRUEBA, "src", "lib"), path.join(PRUEBA, "app")]) mkdirSync(d, { recursive: true });
  // The test copy: an example file, code that reads variables, and the app's env file.
  writeFileSync(path.join(PRUEBA, ".env.example"), "DATABASE_URL=\nSTRIPE_SECRET_KEY=\nRESEND_API_KEY=\n");
  writeFileSync(path.join(PRUEBA, "src", "lib", "mail.ts"), "export const key = process.env.RESEND_API_KEY;\nconst env = process.env['SENTRY_DSN'];\nif (process.env.NODE_ENV === 'x') {}\n");
  writeFileSync(path.join(PRUEBA, "app", "page.tsx"), "const u = process.env.NEXT_PUBLIC_SITE_URL;\n");
  writeFileSync(path.join(PRUEBA, ".env.local"), `DATABASE_URL=postgres://a@127.0.0.1:5433/zig\nSTRIPE_SECRET_KEY="${FAKE_SECRET}"\nRESEND_API_KEY=\nNEXT_PUBLIC_SITE_URL=http://localhost:3000\n`);
  writeFileSync(path.join(PRUEBA, "package.json"), JSON.stringify({ scripts: { dev: "next dev", test: "vitest run" } }));
  writeFileSync(path.join(PRUEBA, "package-lock.json"), "{}");
  await zigzagSettings((s) => ({
    ...s,
    local: { repo_path: REPO },
    qa: { verify: [{ name: "test", command: "npm test" }, { name: "typecheck", command: "npx tsc --noEmit" }] },
    capture: {
      start_command: "npm run dev -- --port {port}",
      port: 3000,
      pages: [
        { key: "inicio", path: "/", label: "Inicio" },
        { key: "registro", path: "/registro", label: "Registro", session: true },
      ],
      session: { login_path: "/entrar", user: "prueba@example.com", user_field: "email", password_field: "password", password_command: "npm run panel:usuario -- {user}" },
    },
  }) as ProjectSettings);
  maquinas.setMaquinasDeps({
    env: { ...process.env, PLANIA_WORKTREES_ROOT: WT },
    exec: async (command, opts) => {
      execs.push({ command, cwd: opts.cwd, stdin: opts.stdin, env: opts.env });
      if (gate) await new Promise<void>((r) => (gate = r));
      const a = answers[command] ?? { code: 0, stdout: "" };
      return { code: a.code, stdout: a.stdout, stderr: a.stderr ?? "" };
    },
  });
});

after(async () => {
  await store?.end();
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => {
  execs = [];
  answers = {};
  gate = null;
});

describe("Llaves", () => {
  test("each name from the example file and the code, set or missing; an empty value is missing; never a value", async () => {
    const r = await call("GET", "/api/projects/zigzag/maquinas/llaves");
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.body.llaves.map((l: Json) => [l.name, l]));
    assert.equal(by.STRIPE_SECRET_KEY.set, true, "set");
    assert.deepEqual(by.STRIPE_SECRET_KEY.from, ["ejemplo"]);
    assert.equal(by.RESEND_API_KEY.set, false, "present with an empty value counts as missing");
    assert.deepEqual(by.RESEND_API_KEY.from, ["código", "ejemplo"]);
    assert.equal(by.SENTRY_DSN.set, false, "missing");
    assert.deepEqual(by.SENTRY_DSN.from, ["código"]);
    assert.equal(by.NEXT_PUBLIC_SITE_URL.public, true);
    assert.equal(by.NODE_ENV, undefined, "runtime variables are not keys");
    assert.deepEqual([r.body.env_file, r.body.where, r.body.example_file], [".env.local", "prueba", ".env.example"]);
    assert.deepEqual([r.body.set, r.body.missing], [3, 2]);
    // Missing ones first.
    assert.deepEqual(r.body.llaves.slice(0, 2).map((l: Json) => l.name), ["RESEND_API_KEY", "SENTRY_DSN"]);
    assert.ok(!r.text.includes(FAKE_SECRET), "no value in the response");
    assert.ok(!r.text.includes("127.0.0.1:5433"), "not even a harmless one");
    for (const l of r.body.llaves) assert.deepEqual(Object.keys(l).sort(), ["from", "name", "public", "set"]);
  });
});

describe("Pruebas", () => {
  test("pass: each verify command in the test copy's worktree, with counts, the duration and the tail", async () => {
    answers["npm test"] = { code: 0, stdout: "running…\n# tests 12\n# pass 12\n# fail 0\n" };
    answers["npx tsc --noEmit"] = { code: 0, stdout: "" };
    const start = await call("POST", "/api/projects/zigzag/maquinas/pruebas");
    assert.equal(start.status, 200);
    assert.ok(start.body.running, "the click starts the run and returns");
    await pruebas.pruebasDone("zigzag");
    const r = (await call("GET", "/api/projects/zigzag/maquinas/pruebas")).body;
    assert.equal(r.running, null);
    assert.equal(r.last.ok, true);
    assert.deepEqual([r.last.passed, r.last.failed], [12, 0]);
    assert.deepEqual(r.last.steps.map((s: Json) => [s.name, s.ok]), [["test", true], ["typecheck", true]]);
    assert.ok(r.last.duration_ms >= 0);
    assert.deepEqual(execs.map((e) => [e.command, e.cwd]), [["npm test", PRUEBA], ["npx tsc --noEmit", PRUEBA]]);
    assert.equal(execs[0]!.env!.DATABASE_URL, undefined, "Plania's env never reaches the app");
    // Kept in machine_state.
    const kept = (await store.get("machineState", { key: "maquinas:pruebas:zigzag" }))!.value;
    assert.equal(kept.ok, true);
  });

  test("fail: the failing command's tail, scrubbed of secrets", async () => {
    answers["npm test"] = { code: 1, stdout: "", stderr: `FAIL registro.test.ts\n  expected 2 got 3\nusing ${FAKE_SECRET}\n 3 passed\n 1 failed\n` };
    answers["npx tsc --noEmit"] = { code: 0, stdout: "" };
    await call("POST", "/api/projects/zigzag/maquinas/pruebas");
    await pruebas.pruebasDone("zigzag");
    const r = (await call("GET", "/api/projects/zigzag/maquinas/pruebas"));
    assert.equal(r.body.last.ok, false);
    assert.deepEqual([r.body.last.passed, r.body.last.failed], [3, 1]);
    const step = r.body.last.steps[0];
    assert.equal(step.ok, false);
    assert.equal(step.code, 1);
    assert.ok(step.tail.includes("  expected 2 got 3"));
    assert.ok(!r.text.includes(FAKE_SECRET));
  });

  test("a second call while one runs is refused", async () => {
    gate = () => undefined;
    const first = await call("POST", "/api/projects/zigzag/maquinas/pruebas");
    assert.equal(first.status, 200);
    const second = await call("POST", "/api/projects/zigzag/maquinas/pruebas");
    assert.equal(second.status, 409);
    assert.equal(second.body.error, "TESTS_RUNNING");
    const reading = (await call("GET", "/api/projects/zigzag/maquinas/pruebas")).body;
    assert.equal(reading.running.step, "test");
    // Let both commands finish.
    const release = async () => {
      while (gate) {
        const g = gate;
        gate = null;
        g();
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    await release();
    await pruebas.pruebasDone("zigzag");
    assert.equal(execs.length, 2, "only the first run ran");
  });

  test("PLA-53: a run a restart cut reads as interrupted, once", async () => {
    // What an earlier server left: the marker of a run, and no run behind it.
    const MARK = "maquinas:pruebas:zigzag:corriendo";
    const value = { started_at: new Date(Date.now() - 60_000).toISOString(), step: "test", server_pid: 999_999 };
    await store.fix(async (uow) => {
      if (await uow.get("machineState", { key: MARK })) await uow.update("machineState", { key: MARK }, { value });
      else await uow.insert("machineState", { key: MARK, value });
    });
    const r1 = (await call("GET", "/api/projects/zigzag/maquinas/pruebas")).body;
    assert.equal(r1.running, null);
    assert.equal(r1.last.ok, false);
    assert.deepEqual(r1.last.steps.map((s: Json) => [s.name, s.tail[0]]), [["test", pruebas.INTERRUPTED]]);
    assert.equal(await store.count("machineState", { key: MARK }), 0, "the marker is gone");
    const r2 = (await call("GET", "/api/projects/zigzag/maquinas/pruebas")).body;
    assert.equal(r2.last.ended_at, r1.last.ended_at, "recorded once");
    // A run that ends on its own leaves no marker.
    gate = null;
    await call("POST", "/api/projects/zigzag/maquinas/pruebas");
    await pruebas.pruebasDone("zigzag");
    assert.equal(await store.count("machineState", { key: MARK }), 0);
    assert.notEqual((await call("GET", "/api/projects/zigzag/maquinas/pruebas")).body.last.steps[0].tail[0], pruebas.INTERRUPTED);
  });
});

describe("Cómo probarla", () => {
  test("the doc «Recorrido de prueba» as steps, with the page each names", async () => {
    const zigzag = await store.projectId("zigzag");
    await store.fix((uow) =>
      uow.insert("docs", {
        projectId: zigzag,
        title: "Recorrido de prueba",
        markdown: "# Recorrido\n\n- [ ] Abre la portada en `/`\n- [x] Llena el [registro](/registro) con un nombre\n- [ ] Revisa el **correo** de bienvenida\n",
        actor: { agent: "po", session_id: "t" },
      }),
    );
    const r = (await call("GET", "/api/projects/zigzag/maquinas/recorrido")).body;
    assert.equal(r.from, "doc");
    assert.ok(r.doc_id);
    assert.deepEqual(r.steps, [
      { n: 1, text: "Abre la portada en /", page: "inicio", path: "/" },
      { n: 2, text: "Llena el registro con un nombre", page: "registro", path: "/registro" },
      { n: 3, text: "Revisa el correo de bienvenida", page: null, path: null },
    ]);
    assert.equal(r.user, "prueba@example.com");
    assert.equal(r.can_password, true);
    await store.fix((uow) => uow.delete("docs", { title: "Recorrido de prueba" }));
  });

  test("without the doc, one step per capture page", async () => {
    const r = (await call("GET", "/api/projects/zigzag/maquinas/recorrido")).body;
    assert.equal(r.from, "pages");
    assert.deepEqual(r.steps, [
      { n: 1, text: "Abre Inicio", page: "inicio", path: "/" },
      { n: 2, text: "Abre Registro (con la sesión de prueba)", page: "registro", path: "/registro" },
    ]);
  });

  test("Copiar una nueva: a fresh password set through password_command and returned once", async () => {
    const r = await call("POST", "/api/projects/zigzag/maquinas/recorrido/contrasena");
    assert.equal(r.status, 200);
    assert.equal(r.body.user, "prueba@example.com");
    assert.match(r.body.password, /^[A-Za-z0-9_-]{16}$/);
    assert.equal(execs.length, 1);
    assert.equal(execs[0]!.command, "npm run panel:usuario -- prueba@example.com");
    assert.equal(execs[0]!.cwd, PRUEBA);
    assert.equal(execs[0]!.stdin, `${r.body.password}\n${r.body.password}\n`);
    const again = await call("POST", "/api/projects/zigzag/maquinas/recorrido/contrasena");
    assert.notEqual(again.body.password, r.body.password, "a new one each time; none is kept");
    const stored = JSON.stringify((await store.get("projects", { slug: "zigzag" }))!.settings);
    assert.ok(!stored.includes(r.body.password));
  });

  test("the password route refuses a user outside the reserved test domain", async () => {
    // Written around the schema on purpose: the route checks again.
    await setTestUser("ana@gmail.com");
    const r = await call("POST", "/api/projects/zigzag/maquinas/recorrido/contrasena");
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "NOT_A_TEST_USER");
    assert.equal(execs.length, 0, "the command never ran");
    assert.equal((await call("GET", "/api/projects/zigzag/maquinas/recorrido")).body.can_password, false);
    await setTestUser("prueba@example.com");
  });
});
