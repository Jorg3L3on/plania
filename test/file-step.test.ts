// File steps (src/api/file-step.ts): a teammate needs lines in a file its session may not write (.env.example).
// Compañía shows the file and the lines and commits them to the ticket's PR through a stubbed gh: no real gh runs.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject, findTask } = await import("../src/mcp/queries.js");
const { releaseGh } = await import("../src/mcp/release-ship.js");
const fs = await import("../src/api/file-step.js");

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const v2 = await load("components/compania/v2.tsx");
const lib = await load("lib/v2.ts");

type Json = Record<string, any>;
const REPO = "Jorg3L3on/zigzag";
const PR_URL = `https://github.com/${REPO}/pull/19`;
const ctx = { actor: { agent: "t", session_id: "s1", machine: "ci" } };
// The step as Taller wrote it on the real screen (MIA-I5-1), with fake values.
const TEXT =
  "Agregar a .env.example (la sesión no puede escribir .env*), líneas exactas en el PR #19: `# Secreto para firmar la cookie del panel (32 caracteres o más)` / `PANEL_SESSION_SECRET=` / `# Dirección base del panel` / `PANEL_URL_BASE=http://localhost:3000`";

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let calls: string[][] = [];
let file: string | null = "DATABASE_URL=postgres://localhost/app\n# Dirección base del panel\n";
let prState = "OPEN";
let head = "jl/mia-i5-1";
let put: Json | null = null;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const decisions = async (): Promise<Json[]> => ((await (await app.request("/api/company", { headers: jorge() })).json()) as Json).decisions;
const act = (id: string, body: unknown) => app.request(`/api/company/decisions/${encodeURIComponent(id)}`, { method: "POST", headers: jorge(), body: JSON.stringify(body) });

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  const p = await findProject(db, "zigzag");
  await setProject(db, { project: "zigzag", version: p.version, settings: { github: { repo: REPO }, release: { from: "sandbox", into: "main", env: "prod" } } }, ctx);
  releaseGh.run = async (args) => {
    calls.push(args);
    if (args[0] === "pr" && args[1] === "view") return { ok: true, stdout: JSON.stringify({ headRefName: head, baseRefName: "sandbox", state: prState, url: PR_URL }), stderr: "" };
    if (args[0] === "api" && args[1] !== "-X") {
      if (file === null) return { ok: false, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
      return { ok: true, stdout: JSON.stringify({ type: "file", sha: "abc", content: Buffer.from(file).toString("base64") }), stderr: "" };
    }
    if (args[0] === "api" && args[1] === "-X") {
      const f = Object.fromEntries(args.filter((_, i) => args[i - 1] === "-f").map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]));
      put = { ...f, content: Buffer.from(f.content!, "base64").toString("utf8"), at: args[3] };
      return { ok: true, stdout: JSON.stringify({ commit: { sha: "c0ffee1234567" } }), stderr: "" };
    }
    return { ok: false, stdout: "", stderr: "unexpected" };
  };
});

after(async () => {
  await closeDb();
  await raw.end();
});

beforeEach(() => {
  calls = [];
  put = null;
  file = "DATABASE_URL=postgres://localhost/app\n# Dirección base del panel\n";
  prState = "OPEN";
  head = "jl/mia-i5-1";
});

async function step(blocker: { text: string; file?: { path: string; append: string } }): Promise<{ id: string; key: string }> {
  const t = await createTask(db, { project: "zigzag", title: "Variables de ejemplo", scope: "s", checks: ["c"], status: "Ready", blocked_by: [{ human_action: blocker }] }, ctx);
  const p = await findProject(db, "zigzag");
  const row = (await findTask(db, p.id, t.key))!;
  await raw.query("update tasks set pr_url = $2 where id = $1", [row.id, PR_URL]);
  const b = (await raw.query("select id from blockers where task_id = $1", [row.id])).rows[0] as { id: string };
  return { id: `b-${b.id}`, key: t.key };
}

describe("reading the step", () => {
  test("Taller's own words become the file and the lines", () => {
    const f = fs.fileStepOf({ text: TEXT }, TEXT, PR_URL)!;
    assert.equal(f.path, ".env.example");
    assert.equal(f.source, "text");
    assert.deepEqual(f.lines.split("\n"), ["# Secreto para firmar la cookie del panel (32 caracteres o más)", "PANEL_SESSION_SECRET=", "# Dirección base del panel", "PANEL_URL_BASE=http://localhost:3000"]);
  });
  test("an agent's file {path, append} wins over the text; a step with no file or no lines is none", () => {
    assert.deepEqual(fs.fileStepOf({ file: { path: "config/app.example.yml", append: "a: 1\nb: 2\n" } }, "x", null), { path: "config/app.example.yml", lines: "a: 1\nb: 2", pr_url: null, source: "agent" });
    assert.equal(fs.fileStepOf({}, "Crear la cuenta de la tienda", null), null);
    assert.equal(fs.fileStepOf({}, "Revisar .env.example a mano", null), null, "a path with no lines");
  });
  test("secrets and paths outside the repo are refused", () => {
    for (const p of [".env", ".env.local", "apps/web/.env.production", ".ENV"]) assert.equal(fs.secretPath(p), true, p);
    for (const p of [".env.example", "apps/web/.env.sample", ".env.template", "README.md"]) assert.equal(fs.secretPath(p), false, p);
    for (const p of ["../x", "/etc/passwd", "a//b", ".git/config", "a\\b", "a b"]) assert.equal(fs.cleanPath(p), null, p);
    assert.equal(fs.cleanPath("./.env.example"), ".env.example");
  });
  test("only the missing lines are added, after one blank line", () => {
    const now = "A=1\n# Dirección\n";
    const miss = fs.missingLines(now, "# Dirección\nB=\n\nC=3");
    assert.deepEqual(miss, ["B=", "", "C=3"]);
    assert.equal(fs.appended(now, miss), "A=1\n# Dirección\n\nB=\n\nC=3\n");
    assert.deepEqual(fs.missingLines(now, "A=1\n"), []);
    assert.equal(fs.appended("", ["X="]), "X=\n");
  });
});

describe("Agregar al PR", () => {
  test("the step shows in Te toca with the file and aplicar; aplicar commits to the PR's branch and the step is done", async () => {
    const s = await step({ text: TEXT });
    const row = (await decisions()).find((d) => d.id === s.id)!;
    assert.deepEqual(row.actions, ["aplicar", "hecho"]);
    assert.equal(row.file_step.path, ".env.example");

    const res = await act(s.id, { action: "aplicar", path: ".env.example", lines: row.file_step.lines });
    assert.equal(res.status, 200, await res.clone().text());
    const out = (await res.json()) as Json;
    assert.deepEqual(out.state.result, { path: ".env.example", branch: "jl/mia-i5-1", added: 3, commit: "c0ffee1234567", pr_url: PR_URL });
    assert.equal(put!.branch, "jl/mia-i5-1");
    assert.equal(put!.sha, "abc");
    assert.equal(put!.at, `repos/${REPO}/contents/.env.example`);
    assert.match(put!.message, /^ZIG-\d+: agrega 3 líneas a \.env\.example \(desde Plania\)$/);
    assert.equal(
      put!.content,
      "DATABASE_URL=postgres://localhost/app\n# Dirección base del panel\n\n# Secreto para firmar la cookie del panel (32 caracteres o más)\nPANEL_SESSION_SECRET=\nPANEL_URL_BASE=http://localhost:3000\n",
      "the line already there is not repeated",
    );
    const b = (await raw.query("select satisfied_at, spec from blockers where id = $1", [s.id.slice(2)])).rows[0] as Json;
    assert.ok(b.satisfied_at, "the step is done");
    assert.equal((await decisions()).some((d) => d.id === s.id && !d.state), false);
    assert.equal((await act(s.id, { action: "aplicar" })).status, 409, "twice is refused");
  });

  test("the owner's edits are what goes out; a new file is created", async () => {
    file = null;
    const s = await step({ text: "x", file: { path: "config/.env.example", append: "A=1" } });
    const res = await act(s.id, { action: "aplicar", path: "config/.env.example", lines: "A=2\nB=3" });
    assert.equal(res.status, 200);
    assert.equal(put!.content, "A=2\nB=3\n");
    assert.equal(put!.sha, undefined, "no sha for a new file");
  });

  test("refusals say why and change nothing: a secrets file, a closed PR, a PR on main", async () => {
    const s = await step({ text: TEXT });
    const secret = await act(s.id, { action: "aplicar", path: ".env.local", lines: "X=1" });
    assert.equal(secret.status, 409);
    assert.equal(((await secret.json()) as Json).error, "FILE_SECRET");
    prState = "MERGED";
    const closed = (await (await act(s.id, { action: "aplicar" })).json()) as Json;
    assert.equal(closed.error, "FILE_PR_CLOSED");
    assert.match(closed.hint, /PR #19 está merged/);
    prState = "OPEN";
    head = "main";
    assert.equal(((await (await act(s.id, { action: "aplicar" })).json()) as Json).error, "FILE_BRANCH");
    assert.equal(put, null, "nothing was written");
    const b = (await raw.query("select satisfied_at from blockers where id = $1", [s.id.slice(2)])).rows[0] as Json;
    assert.equal(b.satisfied_at, null);
  });

  test("an agent sends the file with its step; a file without lines is refused", async () => {
    await assert.rejects(createTask(db, { project: "zigzag", title: "x", scope: "s", checks: ["c"], blocked_by: [{ human_action: { text: "t", file: { path: ".env.example", append: " " } } }] }, ctx), /INVALID_BLOCKER/);
  });
});

describe("the card", () => {
  const d = { id: "b-1", project: "zigzag", title: "Agregar a .env.example", kind: "step", options: null, actions: ["aplicar", "hecho"], state: null, at: "2026-11-14T02:30:00Z", ref: "ZIG-9", detail: null, file_step: { path: ".env.example", lines: "A=1\nB=2", pr_url: PR_URL, source: "text" } };
  const render = (props: Json) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(v2.DecisionBody, { d, now: Date.parse("2026-11-14T02:31:00Z"), onAct() {}, ...props })));
  test("it shows the file, the lines and one button; Hecho becomes Ya lo hice yo", () => {
    const html = render({});
    assert.ok(html.includes("Plania puede hacerlo por ti") && html.includes('value=".env.example"') && html.includes("A=1\nB=2"));
    assert.ok(html.includes("Agregar al PR #19 y marcar hecho") && html.includes("Ya lo hice yo"));
    assert.ok(html.includes("revísalas"), "read from the text: it says to check them");
  });
  test("while it runs it says what it is doing; when done the line says where it went", () => {
    const html = render({ busy: { id: "b-1", key: "aplicar" } });
    assert.ok(html.includes("data-file-working") && html.includes("Agregando en GitHub"));
    assert.equal(lib.stateText({ action: "aplicar", at: "", result: { path: ".env.example", branch: "jl/x", added: 3, commit: "c0ffee1234" } }), "Agregado al PR · 3 líneas en .env.example en jl/x (c0ffee1) · paso hecho");
    assert.equal(lib.stateText({ action: "aplicar", at: "", result: { path: ".env.example", branch: "jl/x", added: 0, commit: null } }), "Ya estaba en el PR · .env.example en jl/x · paso hecho");
  });
});
