// PLA-I30 blocks that PLA-I33 kept, rendered with fake data: Máquina's plumbing (the week's tokens per project
// and for Asistente, plan guard, switches, En marcha, run log) with the 5e/5h banners, the per-block error, the
// 5i stop sheet, the new-project dialog and the nav. Mover guardia shows only with canEdit. PLA-21: no budgets.
// Server-rendered with react-dom/server; no browser, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { CompanyProjectRow, CompanyRun, RunBrief } from "../ui/src/lib/compania.js";

// The UI files use the automatic JSX runtime under Vite; tsx compiles them with React.createElement.
(globalThis as { React?: unknown }).React = React;
// Loaded by URL so the root typecheck (NodeNext, no JSX) does not follow them; `pnpm build` checks them.
const ui = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, React.FC<any>>;
const parts = await ui("components/compania/parts.tsx");
const sheets = await ui("components/compania/sheets.tsx");
const plumbingUi = await ui("components/compania/plumbing.tsx");
const nav = await ui("components/main-nav.tsx");

const html = (el: React.ReactElement) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
const h = React.createElement;
const noop = () => {};
const NOW = new Date("2026-11-08T15:00:00Z").getTime();
const TZ = "America/Mexico_City";
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const project = (slug: string, title: string, used: number, paused = false): CompanyProjectRow => ({ slug, title, paused, paused_at: paused ? "2026-11-06T04:10:00Z" : null, usage: { used } });
const run = (id: string, role: string, project: string, status: "running" | "queued", started: string | null): CompanyRun => ({
  id, agent: role, role, project, ticket: "MIA-I3-4", status, queued_at: "2026-11-08T14:40:00Z", started_at: started, turns: 18, tokens: 92_000,
});
const log: RunBrief[] = [
  { id: "l1", agent: "po-mianovia", role: "product-owner", project: "mianovia", ticket: "MIA-I4-1", status: "ok", summary: "doc Campos y flujos", started_at: "2026-11-08T13:00:00Z", ended_at: "2026-11-08T13:20:00Z", tokens: 64_000 },
  { id: "l2", agent: "research-filmia", role: "research", project: "filmia", ticket: "FIL-I2-1", status: "fail", summary: "fail: timeout", started_at: "2026-11-05T13:00:00Z", ended_at: "2026-11-05T13:45:00Z", tokens: 210_000 },
];
type Patch = Partial<{
  company: { paused: boolean; paused_at: string | null };
  plan: Record<string, unknown>;
  projects: CompanyProjectRow[];
  runs: { live: CompanyRun[]; queued: CompanyRun[] };
  asistente: number;
}>;
const plumbing = (patch: Patch = {}) => ({
  company: patch.company ?? { paused: false, paused_at: null },
  settings: { max_concurrent: 2, cooldown_minutes: 30, plan_guard_pct: 70, reserve_tokens: 60000, max_turns: 40, timeout_minutes: 45 },
  week: { starts_at: "2026-11-02T06:00:00Z", resets_at: "2026-11-09T06:00:00Z", timezone: TZ },
  plan: { five_hour_pct: 41, seven_day_pct: 23, resets_at: "2026-11-08T19:20:00Z", seven_day_resets_at: null, guard_pct: 70, status: "allowed", state: "ok", read_at: null, source: "stream", ...(patch.plan ?? {}) },
  usage: {
    asistente: { used: patch.asistente ?? 180_000 },
    projects: patch.projects ?? [project("mianovia", "Mianovia", 1_180_000), project("micasa", "MiCasa", 1_640_000)],
  },
  runs: patch.runs ?? { live: [run("r1", "taller", "mianovia", "running", "2026-11-08T14:45:28Z")], queued: [run("r2", "product-owner", "plania", "queued", null)] },
  log,
  viewer: { can_edit_limits: true },
});
const page = (p: ReturnType<typeof plumbing>, canEdit = true) =>
  html(
    h(plumbingUi.PlumbingSection!, {
      plumbing: p,
      now: NOW,
      canEdit,
      onMoveGuard: noop,
      onStopCompany: noop,
      onResumeCompany: noop,
      onPauseProject: noop,
      onResumeProject: noop,
    }),
  );
const noMoney = (s: string) => assert.equal(/\$|USD|usd/.test(s), false, "no money on screen");

test("Máquina plumbing: the week's tokens per project and for Asistente with no limit, guard, switches, log; tokens only", () => {
  const out = page(plumbing());
  assert.deepEqual([...out.matchAll(/data-block="([^"]+)"/g)].map((m) => m[1]), ["tokens", "guardia", "interruptores", "bitacora"]);
  for (const t of ["Tokens esta semana", "sin límite", "Asistente", "180k", "Mianovia", "1.18M", "1.64M", "Guardia del plan", "Ventana de 5 h del plan", "41%", "En marcha", "Tope: 2 a la vez · 1 en espera", "14:32", "Detener la compañía", "Bitácora de corridas", "MIA-I4-1", "falló", "64k tok"]) {
    assert.ok(out.includes(t), t);
  }
  assert.equal(/Presupuesto|Por rol|Product owners|Límite de Taller|Subir límite| \/ \d/.test(out), false, "no budgets or limits");
  assert.equal(count(out, /data-switch=/g), 2);
  noMoney(out);
});

test("Máquina plumbing: Mover guardia only for a session that can edit; no Cambiar for tokens", () => {
  const jorge = page(plumbing(), true);
  assert.equal(count(jorge, /data-control="cambiar"/g), 0, "no budget to change");
  assert.equal(count(jorge, /data-control="mover-guardia"/g), 1);
  const agent = page(plumbing(), false);
  assert.equal(agent.includes("Cambiar"), false);
  assert.equal(agent.includes("Mover guardia"), false);
  assert.equal(agent.includes(">Pausar<"), false);
});

test("PLA-25: the Guardia block has a switch to go on past the guard, saying so when on, editable only by Jorge", () => {
  const off = page(plumbing(), true);
  assert.equal(count(off, /data-control="seguir-sin-guardia"/g), 1);
  assert.ok(off.includes("Seguir aunque el plan esté alto"));
  assert.ok(off.includes('data-state="activo"'));
  const box = (s: string) => s.match(/<input[^>]*seguir-sin-guardia[^>]*>/)![0];
  assert.equal(box(off).includes("checked"), false);
  const on = page(plumbing({ plan: { override: true, five_hour_pct: 77, state: "ok" } }), true);
  assert.ok(on.includes("Límite ignorado"));
  assert.ok(on.includes('data-state="ignorado"'));
  assert.ok(box(on).includes("checked"));
  assert.ok(box(page(plumbing({ plan: { override: true } }), false)).includes("disabled"));
});

test("5b/5c a block that failed says so and offers Reintentar; unknown plan usage reads as high", () => {
  const err = html(h(parts.BlockError!, { what: "la compañía", onRetry: noop }));
  assert.ok(err.includes("No se pudo cargar la compañía."));
  assert.ok(err.includes("Si la Mac está dormida, nada corre hasta que despierte."));
  assert.ok(err.includes("Reintentar"));
  const unknown = page(plumbing({ plan: { five_hour_pct: null, state: "unknown" } }));
  assert.ok(unknown.includes("Desconocido = alto"));
});

test("5e company stopped: grey banner, nothing runs, Reanudar la compañía, a project's own pause kept", () => {
  const out = page(plumbing({
    company: { paused: true, paused_at: "2026-11-08T16:42:00Z" },
    projects: [project("mianovia", "Mianovia", 10), project("zigzag", "ZigZag", 0, true)],
    runs: { live: [], queued: [] },
  }));
  assert.ok(out.includes('data-banner="paused"'));
  assert.ok(out.includes("La compañía está detenida · desde 10:42, por ti"));
  assert.ok(out.includes("Nada corre: la compañía está detenida."));
  assert.ok(out.includes("Reanudar la compañía"));
  assert.ok(out.includes("en pausa"));
  assert.equal(out.includes('data-banner="budget"'), false);
});

test("PLA-21: a project past any old limit shows no budget banner and no Subir límite", () => {
  const p = plumbing({ projects: [project("micasa", "MiCasa", 900_000_000), project("mianovia", "Mianovia", 10)] });
  const jorge = page(p, true);
  assert.equal(jorge.includes('data-banner="budget"'), false);
  assert.equal(/Subir límite|llegó a su límite|Sin presupuesto/i.test(jorge), false);
  assert.ok(jorge.includes("900M"));
  noMoney(jorge);
});

test("5h plan guard: amber banner, Ver gasto, Mover guardia for Jorge only", () => {
  const p = plumbing({ plan: { five_hour_pct: 72, state: "stopped" }, runs: { live: [], queued: [run("q1", "taller", "x", "queued", null), run("q2", "taller", "y", "queued", null), run("q3", "artist", "z", "queued", null)] } });
  const out = page(p, true);
  assert.ok(out.includes('data-banner="plan"'));
  assert.ok(out.includes("la ventana de 5 h pasó el guardia · no arrancan corridas nuevas hasta 13:20 para que te quede plan a ti · las que corren terminan su paso"));
  assert.ok(out.includes("Ver gasto"));
  assert.ok(out.includes("Nada arranca: 3 en espera del guardia."));
  assert.equal(page(p, false).includes("Mover guardia"), false);
});

test("5i stop sheet names what closes, what stops starting and what is kept; no typing", () => {
  const live = [run("r1", "taller", "mianovia", "running", "2026-11-08T14:45:28Z")];
  const out = html(h(parts.StopBody!, { scope: { kind: "company" }, runs: live, projectTitle: (s: string) => s, onConfirm: noop, onCancel: noop }));
  for (const t of ["Se cierra", "Taller en mianovia (MIA-I3-4)", "Deja de arrancar", "Se queda", "No se borra nada", "Detener la compañía", "Seguir en marcha"]) assert.ok(out.includes(t), t);
  assert.equal(out.includes("<input"), false);
  const proj = html(h(parts.StopBody!, { scope: { kind: "project", slug: "mianovia", title: "Mianovia" }, runs: live, projectTitle: (s: string) => s, onConfirm: noop, onCancel: noop }));
  assert.ok(proj.includes("Pausar Mianovia"));
});

test("new project (4a/4b): starts paused, and a missing endpoint is a clear error", () => {
  const form = html(h(sheets.NewProjectForm!, { state: { kind: "idle" }, onSubmit: noop, onCancel: noop }));
  assert.ok(form.includes("Meta, en una oración"));
  assert.ok(form.includes("Empieza en pausa. Su PO despierta cuando lo reanudes."));
  const missing = html(h(sheets.NewProjectForm!, { state: { kind: "missing" }, onSubmit: noop, onCancel: noop }));
  assert.ok(missing.includes("el servidor no tiene esa ruta"));
  assert.ok(missing.includes("No se creó nada."));
  const done = html(h(sheets.NewProjectDone!, {
    state: { kind: "done", name: "Viajia", goal: "Que alguien arme su viaje.", result: { slug: "viajia", key_prefix: "VIA", paused: true, po: "po-viajia", prompt_doc_id: "377b1840-9262-411e-b6c4-53ddff950665" } },
    onOpen: noop,
    onClose: noop,
  }));
  assert.ok(done.includes("Su PO despierta cuando lo reanudes"));
  assert.ok(done.includes("Ver Viajia"));
});

test("limit editor: only the guard is left (PLA-21)", () => {
  assert.equal((sheets.limitTitle as unknown as (t: unknown) => string)({ kind: "guard", current: 70 }), "Mover guardia");
  const form = html(h(sheets.LimitForm!, { target: { kind: "guard", current: 70 }, onSave: noop, onCancel: noop }));
  assert.ok(form.includes("Guardia del plan"));
  assert.equal(/Límite semanal|aviso al 80|código del dueño/i.test(form), false);
});

test("nav: the logo is Inicio and the header has exactly five links (Brief, D2); the phone tab bar has the same five on grid-cols-5", () => {
  const counts = { inbox: 3, chores: 2 };
  const header = html(h(React.Fragment, null, h(nav.Logo!, {}), h(nav.HeaderNav!, { counts })));
  assert.equal(count(header, /<a /g), 6);
  const links = [...header.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, ["/", "/ceo", "/inbox", "/brief", "/progreso", "/machine"]);
  for (const gone of ["/ahora", "/goals", "/equipo", "/tokens"]) assert.equal(header.includes(`href="${gone}"`), false, gone);
  const tabs = html(h(nav.TabBar!, { counts }));
  assert.deepEqual([...tabs.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ["/ceo", "/inbox", "/brief", "/progreso", "/machine"]);
  assert.ok(tabs.includes("sm:hidden"));
  assert.ok(tabs.includes("grid-cols-5"));
  assert.ok(header.includes(">Brief<") && tabs.includes(">Brief<"));
});
