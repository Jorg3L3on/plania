// PLA-I30 blocks that PLA-I33 kept, rendered with fake data: Máquina's plumbing (budgets per project and for
// Asistente, plan guard, switches, En marcha, run log) with the 5e/5g/5h banners, the per-block error, the
// 5i stop sheet, the new-project dialog and the nav. Cambiar and Mover guardia show only with canEdit.
// Server-rendered with react-dom/server; no browser, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { Budget, CompanyProjectRow, CompanyRun, RunBrief } from "../ui/src/lib/compania.js";

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

const budget = (used: number, limit: number | null): Budget => {
  if (limit == null) return { used, limit: null, pct: null, state: "stopped", reason: "unset" };
  const pct = Math.floor((used / limit) * 1000) / 10;
  return { used, limit, pct, state: pct >= 100 ? "stopped" : pct >= 80 ? "warn" : "ok", reason: null };
};
const project = (slug: string, title: string, b: Budget, paused = false): CompanyProjectRow => ({ slug, title, paused, paused_at: paused ? "2026-11-06T04:10:00Z" : null, budget: b });
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
  asistente: Budget;
}>;
const plumbing = (patch: Patch = {}) => ({
  company: patch.company ?? { paused: false, paused_at: null },
  settings: { max_concurrent: 2, cooldown_minutes: 30, plan_guard_pct: 70, reserve_tokens: 60000, max_turns: 40, timeout_minutes: 45 },
  week: { starts_at: "2026-11-02T06:00:00Z", resets_at: "2026-11-09T06:00:00Z", timezone: TZ },
  plan: { five_hour_pct: 41, seven_day_pct: 23, resets_at: "2026-11-08T19:20:00Z", seven_day_resets_at: null, guard_pct: 70, status: "allowed", state: "ok", read_at: null, source: "stream", ...(patch.plan ?? {}) },
  budgets: {
    asistente: patch.asistente ?? budget(180_000, 600_000),
    projects: patch.projects ?? [project("mianovia", "Mianovia", budget(1_180_000, 2_000_000)), project("micasa", "MiCasa", budget(1_640_000, 2_000_000))],
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
      dismissed: new Set(),
      onDismiss: noop,
      onEditProject: noop,
      onEditAsistente: noop,
      onMoveGuard: noop,
      onStopCompany: noop,
      onResumeCompany: noop,
      onPauseProject: noop,
      onResumeProject: noop,
    }),
  );
const noMoney = (s: string) => assert.equal(/\$|USD|usd/.test(s), false, "no money on screen");

test("Máquina plumbing: five blocks, budgets per project and for Asistente, no per-role limits, tokens only", () => {
  const out = page(plumbing());
  assert.deepEqual([...out.matchAll(/data-block="([^"]+)"/g)].map((m) => m[1]), ["presupuestos", "guardia", "interruptores", "bitacora"]);
  for (const t of ["Presupuestos", "Asistente", "180k / 600k", "Mianovia", "1.18M / 2M", "Guardia del plan", "Ventana de 5 h del plan", "41%", "En marcha", "Tope: 2 a la vez · 1 en espera", "14:32", "Detener la compañía", "Bitácora de corridas", "MIA-I4-1", "falló", "64k tok"]) {
    assert.ok(out.includes(t), t);
  }
  assert.equal(/Por rol|Product owners|Límite de Taller/.test(out), false, "no per-role limits");
  assert.equal(count(out, /data-switch=/g), 2);
  noMoney(out);
});

test("Máquina plumbing: Cambiar and Mover guardia only for a session that can edit limits", () => {
  const jorge = page(plumbing(), true);
  assert.equal(count(jorge, /data-control="cambiar"/g), 3, "Asistente and two projects");
  assert.equal(count(jorge, /data-control="mover-guardia"/g), 1);
  const agent = page(plumbing(), false);
  assert.equal(agent.includes("Cambiar"), false);
  assert.equal(agent.includes("Mover guardia"), false);
  assert.equal(agent.includes(">Pausar<"), false);
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
    projects: [project("mianovia", "Mianovia", budget(10, 1000)), project("zigzag", "ZigZag", budget(0, 1000), true)],
    runs: { live: [], queued: [] },
  }));
  assert.ok(out.includes('data-banner="paused"'));
  assert.ok(out.includes("La compañía está detenida · desde 10:42, por ti"));
  assert.ok(out.includes("Nada corre: la compañía está detenida."));
  assert.ok(out.includes("Reanudar la compañía"));
  assert.ok(out.includes("en pausa"));
  assert.equal(out.includes('data-banner="budget"'), false);
});

test("5g 100%: red banner with Subir límite for Jorge only", () => {
  const p = plumbing({ projects: [project("micasa", "MiCasa", budget(2_000_000, 2_000_000)), project("mianovia", "Mianovia", budget(10, 1000))] });
  const jorge = page(p, true);
  assert.ok(jorge.includes('data-banner="budget"'));
  assert.ok(jorge.includes("MiCasa llegó a su límite semanal · 2M / 2M · nada nuevo arranca ahí hasta el lunes 00:00 · los demás siguen"));
  assert.ok(jorge.includes("Subir límite"));
  assert.ok(jorge.includes("Dejarlo así"));
  assert.equal(page(p, false).includes("Subir límite"), false);
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

test("limit editor titles: a project's budget, Asistente's budget, the guard", () => {
  assert.equal((sheets.limitTitle as unknown as (t: unknown) => string)({ kind: "project", slug: "m", title: "Mianovia", current: 1 }), "Presupuesto de Mianovia");
  assert.equal((sheets.limitTitle as unknown as (t: unknown) => string)({ kind: "asistente", current: null }), "Presupuesto de Asistente");
  assert.equal((sheets.limitTitle as unknown as (t: unknown) => string)({ kind: "guard", current: 70 }), "Mover guardia");
});

test("nav: the logo is Inicio and the header has exactly four links; the phone tab bar has the same four", () => {
  const counts = { inbox: 3, chores: 2 };
  const header = html(h(React.Fragment, null, h(nav.Logo!, {}), h(nav.HeaderNav!, { counts })));
  assert.equal(count(header, /<a /g), 5);
  const links = [...header.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, ["/", "/ceo", "/inbox", "/progreso", "/machine"]);
  for (const gone of ["/ahora", "/goals", "/equipo", "/tokens"]) assert.equal(header.includes(`href="${gone}"`), false, gone);
  const tabs = html(h(nav.TabBar!, { counts }));
  assert.deepEqual([...tabs.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ["/ceo", "/inbox", "/progreso", "/machine"]);
  assert.ok(tabs.includes("sm:hidden"));
});
