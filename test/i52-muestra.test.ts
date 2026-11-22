// PLA-I52-1: la muestra en finish. A delivery that touches the screen, on a project Plania photographs, cannot
// finish without the views it touched, three steps and one sentence (MUESTRA_REQUIRED). The repo is a throwaway
// git repo in a temp folder; the database is the throwaway test one.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { instructions, PROTOCOL_VERSION } = await import("../src/mcp/protocol.js");
const { uiFiles, globToRegex, parseMuestra, DEFAULT_UI_GLOBS } = await import("../src/captures/muestra.js");
const surface = await import("../src/mcp/agent-surface.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s-i52", machine: "ci" };
const P = { project: "micasa" };
const PR = "https://github.com/jorge/micasa/pull/7";
const pass = () => ({ kind: "unit", verdict: "pass", cite: "pnpm test: 3 pass", check_ns: [1] });
const MUESTRA = {
  frase: "Las asesoras ya pueden crear y apagar sucursales desde el panel.",
  vistas: [
    { key: "sucursales", label: "Sucursales", path: "/panel/sucursales", session: true },
    { key: "apagada", label: "Formulario apagado", path: "/registro/satelite", estado: "con Satélite apagada" },
  ],
  pasos: ["Abre Sucursales desde el encabezado", "Crea «Coyoacán»", "Apaga Satélite y abre su enlace"],
};

let client: Client;
let raw: pg.Client;
let closeDb: () => Promise<void>;
const root = mkdtempSync(path.join(tmpdir(), "plania-i52-"));
const repo = path.join(root, "micasa");
mkdirSync(repo);
process.env.PLANIA_PROJECTS_ROOT = root;

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString();
function commitFile(file: string, body: string) {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), body);
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", file);
}

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  return r.isError ? { __error: data.error, ...data } : data;
}

async function ticket(title: string, branch: string): Promise<string> {
  const t = await call("create_task", { ...P, title, scope: "s", checks: [`${title} works`], status: "Ready" });
  await call("start", { ...P, key: t.key, workspace: { worktree_path: repo, branch } });
  return t.key;
}

before(async () => {
  git("init", "-q", "-b", "main");
  commitFile("README.md", "base\n");
  git("checkout", "-qb", "jl/ui");
  commitFile("src/app/panel/sucursales/page.tsx", "export default function P() { return null }\n");
  commitFile("src/app/panel/sucursales/page.test.tsx", "// test\n");
  git("checkout", "-q", "main");
  git("checkout", "-qb", "jl/db");
  commitFile("src/db/sucursales.ts", "export const x = 1;\n");
  commitFile("src/db/sucursales.test.ts", "// test\n");
  git("checkout", "-q", "main");

  raw = await resetTestDb();
  const { db, close } = makeDb();
  closeDb = close;
  const [c, s] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(s);
  client = new Client({ name: "test", version: "0" });
  await client.connect(c);
  const proj = await call("get_project", P);
  const set = await call("set_project", {
    ...P,
    version: proj.version,
    settings: {
      capture: { start_command: "npm run dev -- --port {port}", port: 3000, pages: [{ key: "inicio", path: "/", label: "Inicio" }] },
    },
  });
  assert.ok(!set.__error, JSON.stringify(set));
});

after(async () => {
  await client.close();
  await closeDb();
  await raw.end();
  rmSync(root, { recursive: true, force: true });
});

describe("what counts as the screen", () => {
  test("pages, components and styles count; tests, stories and server code do not", () => {
    const files = ["src/app/panel/page.tsx", "src/components/Fila.tsx", "styles/app.css", "src/db/x.ts", "src/app/x.test.tsx", "test/a.ts", "src/C.stories.tsx", "ui/src/lib/x.ts"];
    assert.deepEqual(uiFiles(files), ["src/app/panel/page.tsx", "src/components/Fila.tsx", "styles/app.css", "ui/src/lib/x.ts"]);
    assert.deepEqual(uiFiles(["lib/a.ts", "web/b.ts"], ["web/**"]), ["web/b.ts"]);
    assert.ok(globToRegex("src/*/page.tsx").test("src/app/page.tsx"));
    assert.ok(!globToRegex("src/*/page.tsx").test("src/app/x/page.tsx"));
    assert.ok(DEFAULT_UI_GLOBS.includes("**/*.css"));
  });

  test("a muestra needs one sentence, 1 to 6 views with unique keys and exactly three steps", () => {
    assert.equal(parseMuestra(MUESTRA).ok, true);
    const two = parseMuestra({ ...MUESTRA, pasos: ["a", "b"] });
    assert.equal(two.ok, false);
    assert.equal(!two.ok && two.field, "muestra.pasos");
    const dup = parseMuestra({ ...MUESTRA, vistas: [MUESTRA.vistas[0], MUESTRA.vistas[0]] });
    assert.equal(!dup.ok && dup.field, "muestra.vistas.1.key");
    const badPath = parseMuestra({ ...MUESTRA, vistas: [{ key: "x", label: "X", path: "panel" }] });
    assert.equal(!badPath.ok && badPath.field, "muestra.vistas.0.path");
  });
});

describe("finish and the muestra", () => {
  test("a screen change without a muestra is refused with the screen files", async () => {
    const key = await ticket("Pantalla de sucursales", "jl/ui");
    const r = await call("finish", { ...P, key, result: pass(), pr_url: PR, branch: "jl/ui" });
    assert.equal(r.__error, "MUESTRA_REQUIRED");
    assert.deepEqual(r.detail?.ui_files ?? r.ui_files, ["src/app/panel/sucursales/page.tsx"]);
    const t = await call("get_task", { ...P, key });
    assert.equal(t.status, "In progress", "nothing was written");
  });

  test("with a muestra it reaches In review and get_task returns it", async () => {
    const key = (await call("list_tasks", { ...P, search: "Pantalla de sucursales" })).tasks[0].key;
    const r = await call("finish", { ...P, key, result: pass(), pr_url: PR, branch: "jl/ui", muestra: MUESTRA });
    assert.ok(!r.__error, JSON.stringify(r));
    assert.equal(r.status, "In review");
    assert.ok(r.changed.includes("muestra"));
    const t = await call("get_task", { ...P, key });
    assert.deepEqual(t.muestra, MUESTRA);
    assert.equal((await raw.query(`select cambio from tasks where key = $1`, [key])).rows[0].cambio, "se_ve");
    const log = await call("list_events", { ...P, key });
    assert.ok(log.events.some((e: Json) => e.type === "task.muestra"));
  });

  test("a muestra that does not fit its shape is MUESTRA_INVALID, naming the field", async () => {
    const key = (await call("list_tasks", { ...P, search: "Pantalla de sucursales" })).tasks[0].key;
    const { db } = makeDb();
    await assert.rejects(
      surface.finish(db, { ...P, key, result: pass(), pr_url: PR, muestra: { ...MUESTRA, pasos: ["solo uno"] } }, { actor: A } as never),
      (e: any) => e.code === "MUESTRA_INVALID" && e.detail.field === "muestra.pasos",
    );
  });

  test("PLA-158 (F-28): a Playwright-only selector is MUESTRA_SELECTOR at finish, naming the field and the value", async () => {
    const key = (await call("list_tasks", { ...P, search: "Pantalla de sucursales" })).tasks[0].key;
    const { db } = makeDb();
    const follow = 'a[href^="/panel/x/"]:has-text("Ana")';
    const bad = { ...MUESTRA, vistas: [{ ...MUESTRA.vistas[0]!, follow }] };
    await assert.rejects(
      surface.finish(db, { ...P, key, result: pass(), pr_url: PR, muestra: bad }, { actor: A } as never),
      (e: any) => e.code === "MUESTRA_SELECTOR" && e.detail.field === "muestra.vistas.0.follow" && e.detail.value === follow && /has-text/.test(e.detail.hint),
    );
    const click = { ...MUESTRA, vistas: [{ ...MUESTRA.vistas[0]!, acciones: [{ click: "Guardar" }, { click: "text=Guardar" }] }] };
    await assert.rejects(
      surface.finish(db, { ...P, key, result: pass(), pr_url: PR, muestra: click }, { actor: A } as never),
      (e: any) => e.code === "MUESTRA_SELECTOR" && e.detail.field === "muestra.vistas.0.acciones.1.click",
    );
  });

  test("a change that does not touch the screen finishes without one", async () => {
    const key = await ticket("Sucursales en la base", "jl/db");
    const r = await call("finish", { ...P, key, result: pass(), pr_url: PR, branch: "jl/db" });
    assert.ok(!r.__error, JSON.stringify(r));
    assert.equal(r.status, "In review");
    const t = await call("get_task", { ...P, key });
    assert.equal(t.muestra, undefined);
    assert.equal((await raw.query(`select cambio from tasks where key = $1`, [key])).rows[0].cambio, "no_se_ve", "PLA-I52-7: finish records the kind of change");
  });

  test("a project Plania does not photograph never asks for one", async () => {
    const t = await call("create_task", { project: "workia", title: "Pantalla", scope: "s", checks: ["works"], status: "Ready" });
    await call("start", { project: "workia", key: t.key, workspace: { worktree_path: repo, branch: "jl/ui" } });
    const r = await call("finish", { project: "workia", key: t.key, result: pass(), pr_url: PR, branch: "jl/ui" });
    assert.ok(!r.__error, JSON.stringify(r));
    assert.equal(r.status, "In review");
  });

  test("when the diff cannot be read it finishes and says why", async () => {
    const key = await ticket("Rama perdida", "jl/no-such-branch");
    const r = await call("finish", { ...P, key, result: pass(), pr_url: PR, branch: "jl/no-such-branch" });
    assert.ok(!r.__error, JSON.stringify(r));
    assert.ok((r.warnings ?? []).some((w: unknown) => String(typeof w === "string" ? w : JSON.stringify(w)).includes("muestra not checked")));
  });
});

describe("the protocol", () => {
  test("2.22 names the muestra in finish", () => {
    assert.equal(PROTOCOL_VERSION, "2.26");
    assert.match(instructions(false), /finish \{key, result, pr_url, branch, muestra\}/);
    assert.match(instructions(false), /MUESTRA_REQUIRED/);
  });
});

describe("PLA-158 (F-28): selectors the browser reads", () => {
  test("Playwright and jQuery forms and open brackets or quotes are refused; plain CSS and visible text pass", async () => {
    const { selectorProblem } = await import("../src/captures/muestra.js");
    for (const s of ['a:has-text("Ana")', "button:text('Ok')", "li:contains(Ana)", "button:visible", "nav >> a", "text=Guardar", "xpath=//a", 'a[href^="/x/"', "a[href='/x/]", "li:nth-child(2"])
      assert.ok(selectorProblem(s, "selector"), s);
    for (const s of ['a[href^="/panel/x/"]', "table tbody tr:first-child a", "#nueva > button.primary", 'input[name="q"]', "li:nth-child(2) a:not(.off)"])
      assert.equal(selectorProblem(s, "selector"), null, s);
    for (const s of ["Guardar cambios", "Don't save", "Ver (3)", "Sí, ¿seguro?"]) assert.equal(selectorProblem(s, "text"), null, s);
    for (const s of ["text=Guardar", 'button:has-text("Ok")', "Ver (3", 'a[title="x]']) assert.ok(selectorProblem(s, "text"), s);
  });
});
