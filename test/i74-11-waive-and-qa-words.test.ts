// PLA-I74-11: the builder cannot waive its own visual checks (WAIVE_VISUAL_FORBIDDEN): only the QA lane, a QA seat's
// run or the owner's screen may. QA's line on the screen says what happened (a pass never reads «fallaron las
// pruebas»), and a waived check shows who waived it and why instead of a bare «No aplica».
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { waiveCheck, isVisualCheck } = await import("../src/mcp/checks.js");
const { webCtx } = await import("../src/mcp/tx.js");
const { ERRORS } = await import("../src/mcp/errors.js");
const { qaSummary } = await import("../src/runner/qa.js");
const { runSession } = await import("../src/runner/run-session.js");
(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const waiver = await load("lib/waiver.ts");
const tablero = await load("components/corriente/tablero.tsx");
const h = React.createElement;

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let close: () => Promise<void>;
const builder = { actor: { agent: "Claude Code", session_id: "s-builder", machine: "mac" } };
const reason = "Lo vi en local";

async function ticket(): Promise<string> {
  const t = (await createTask(db, { project: "zigzag", title: "Lista", scope: "s", checks: ["La lista se ve bien a 375px", "El endpoint guarda el correo", "La captura de escritorio muestra el botón"], status: "Ready" }, builder)) as { key: string };
  return t.key;
}
async function code(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}
async function seatRun(slug: string, template: string): Promise<string> {
  const [{ id: pid }] = (await raw.query("select id from projects where slug = 'zigzag'")).rows;
  await raw.query("insert into agents (slug, name, role, kind, adapter, project_id, role_template) values ($1, $1, $2, 'bot', 'claude_code', $3, $2) on conflict (slug) do nothing", [slug, template, pid]);
  const [{ id }] = (await raw.query("insert into agent_runs (agent_id, project_id, role, status, summary) select id, project_id, role_template, 'running', '' from agents where slug = $1 returning id", [slug])).rows;
  return runSession(id);
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close } = makeDb());
});
after(async () => {
  await close();
  await raw.end();
});

describe("waive rights (check 1)", () => {
  test("the builder gets WAIVE_VISUAL_FORBIDDEN on a visual check and may still waive a non-visual one", async () => {
    const key = await ticket();
    assert.equal(await code(waiveCheck(db, { project: "zigzag", key, n: 1, reason }, builder)), "WAIVE_VISUAL_FORBIDDEN");
    assert.equal(await code(waiveCheck(db, { project: "zigzag", key, n: 3, reason }, builder)), "WAIVE_VISUAL_FORBIDDEN");
    assert.equal(await code(waiveCheck(db, { project: "zigzag", key, n: 2, reason: "Lo cubre otro ticket" }, builder)), null);
    const { rows } = await raw.query("select n, waived_at is not null as waived from checks where task_id = (select id from tasks where key = $1) order by n", [key]);
    assert.deepEqual(rows, [{ n: 1, waived: false }, { n: 2, waived: true }, { n: 3, waived: false }]);
    // A Taller run is the builder too; an actor that only calls itself qa is not a QA seat.
    const taller = await seatRun("taller-zig", "taller");
    assert.equal(await code(waiveCheck(db, { project: "zigzag", key, n: 1, reason }, { actor: { agent: "taller-zig", session_id: taller } })), "WAIVE_VISUAL_FORBIDDEN");
    assert.equal(await code(waiveCheck(db, { project: "zigzag", key, n: 1, reason }, { actor: { agent: "qa", session_id: "s-fake" } })), "WAIVE_VISUAL_FORBIDDEN");
    assert.equal(ERRORS.WAIVE_VISUAL_FORBIDDEN[0], 403);
  });

  test("the owner's screen, the QA lane and a QA seat's run may waive a visual check", async () => {
    const key = await ticket();
    assert.equal(await code(waiveCheck(db, { project: "zigzag", key, n: 1, reason: "No hay versión móvil" }, webCtx)), null);
    assert.equal(await code(waiveCheck(db, { project: "zigzag", key, n: 3, reason: "La captura no aplica a esta ruta" }, { actor: { agent: "qa", session_id: "qa-lane", machine: "mac" } })), null);
    const key2 = await ticket();
    const qa = await seatRun("qa-zig", "qa");
    assert.equal(await code(waiveCheck(db, { project: "zigzag", key: key2, n: 1, reason: "Revisado en el recorrido" }, { actor: { agent: "qa-zig", session_id: qa } })), null);
  });

  test("what counts as visual", () => {
    for (const t of ["Se ve bien en móvil", "La captura a 1440 muestra la tabla", "Layout holds at 375x812", "El diseño sigue la marca", "Visible on desktop", "Pasa axe sin errores de contraste"]) assert.ok(isVisualCheck(t), t);
    for (const t of ["El endpoint devuelve 404 sin sesión", "La migración corre dos veces sin error", "pnpm test pasa"]) assert.ok(!isVisualCheck(t), t);
  });
});

describe("QA words from the result (check 2)", () => {
  const ok = (name: string, pass: number | null = null) => ({ name, command: name, exit_code: 0, ok: true, pass, fail: pass === null ? null : 0, duration_s: 1, tail: "" });
  const bad = (name: string) => ({ name, command: name, exit_code: 1, ok: false, pass: 12, fail: 2, duration_s: 1, tail: "x" });
  const base = { attempt: 1, checklist: { ok: 0, total: 0 }, captures: null };
  test("pass: a checks-only lane says why there is no review, never «fallaron las pruebas»", () => {
    const s = qaSummary({ ...base, pass: true, verify: [ok("test", 14), ok("build")], review: null, checksOnly: true }, "es");
    assert.match(s, /^QA pasa \(intento 1\) · pruebas 14 de 14 · sin revisión aparte \(este proyecto solo corre sus comprobaciones\)/);
    assert.ok(!/fallaron/.test(s));
    const reviewed = qaSummary({ ...base, pass: true, verify: [ok("test", 3)], review: { verdict: "pass" }, checksOnly: false, checklist: { ok: 2, total: 2 }, captures: 4 }, "es");
    assert.equal(reviewed, "QA pasa (intento 1) · pruebas 3 de 3 · revisión pasa · check list 2 de 2 · 4 capturas");
  });
  test("fail: failed tests say so", () => {
    const s = qaSummary({ ...base, pass: false, attempt: 2, verify: [bad("test"), ok("build")], review: null, checksOnly: false }, "es");
    assert.equal(s, "QA falla (intento 2) · pruebas 12 de 14 · sin revisión (fallaron las pruebas) · sin check list · sin capturas");
  });
  test("skipped: no tests and no review are said as such; checks with no counts are counted as checks", () => {
    assert.match(qaSummary({ ...base, pass: true, verify: [], review: null, checksOnly: false }, "es"), /· sin pruebas · sin revisión ·/);
    assert.match(qaSummary({ ...base, pass: true, verify: [ok("typecheck"), ok("build")], review: null, checksOnly: true }, "es"), /· comprobaciones 2 de 2 ·/);
    assert.match(qaSummary({ ...base, pass: true, verify: [ok("test", 5)], review: null, checksOnly: true }, "en"), /^QA passes \(attempt 1\) · tests 5 of 5 · no separate review/);
  });
});

describe("a waived check shows who and why (check 3)", () => {
  test("the line names the owner, QA or the agent, with the reason", () => {
    assert.equal(waiver.waiverLine({ by: { agent: "owner", session_id: "web" }, reason: "No hay versión móvil" }, "es"), "Eximido por ti: No hay versión móvil");
    assert.equal(waiver.waiverLine({ by: { agent: "qa", session_id: "qa-lane" }, reason: "No aplica a esta ruta" }, "es"), "Eximido por QA: No aplica a esta ruta");
    assert.equal(waiver.waiverLine({ by: { agent: "Claude Code", session_id: "s1" }, reason: "Lo cubre otro ticket" }, "es"), "Eximido por Claude Code: Lo cubre otro ticket");
    assert.equal(waiver.waiverLine({ by: null, reason: null }, "en"), "Waived by someone");
  });

  test("the step's card shows it, with no bare «No aplica»", async () => {
    const key = await ticket();
    await waiveCheck(db, { project: "zigzag", key, n: 1, reason: "No hay versión móvil" }, webCtx);
    const checks = (await raw.query("select n, text, done, waived_at, waived_by, waive_reason from checks where task_id = (select id from tasks where key = $1) order by n", [key])).rows.map((c) => ({
      n: c.n,
      text: c.text,
      done: c.done,
      waived: c.waived_at ? { at: c.waived_at.toISOString(), by: c.waived_by, reason: c.waive_reason, approval_id: null } : null,
    }));
    const qc = new QueryClient();
    qc.setQueryData(["task", "zigzag", key], { key, kind: "ticket", title: "Lista", checks, results: [], docs: [], log: [], parent_key: null, questions: [] });
    const proj = { slug: "zigzag", title: "Zigzag", team: [], orders: [], tablero: { initiatives: [], loose: [] } };
    const html = renderToStaticMarkup(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(tablero.Paso, { p: proj, k: key, links: { paso: (k: string) => `/p/${k}`, iniciativa: (k: string) => `/i/${k}`, entrega: () => "/e", sueltos: "/s", doc: (id: string) => `/d/${id}` }, back: "/b" }))));
    assert.match(html, /Eximido<\/span>[\s\S]*La lista se ve bien a 375px[\s\S]*data-waived-by[^>]*> · Eximido por ti: No hay versión móvil/);
    assert.ok(!/No aplica/.test(html));
  });
});
