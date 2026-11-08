// PLA-I30-2/3/4: Compañía's blocks and sheets render with fake data, one test per state (5a–5i), the sheets
// hide Cambiar for a session that cannot edit limits, Prompt ↗ points at the A2 doc ids, and the nav has the
// logo plus exactly four links. Server-rendered with react-dom/server; no browser, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { Budget, Company, CompanyProjectRow, CompanyRun, ProjectFacts, ProjectSheetData, RosterRow } from "../ui/src/lib/compania.js";
import { bannersOf, healthOf } from "../ui/src/lib/compania.js";

// The UI files use the automatic JSX runtime under Vite; tsx compiles them with React.createElement.
(globalThis as { React?: unknown }).React = React;
// Loaded by URL so the root typecheck (NodeNext, no JSX) does not follow them; `pnpm build` checks them.
const ui = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, React.FC<any>>;
const parts = await ui("components/compania/parts.tsx");
const sheets = await ui("components/compania/sheets.tsx");
const nav = await ui("components/main-nav.tsx");
const v2 = await ui("components/dashboard/ceo-v2.tsx");

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
const facts = (goal: string | null, extra: Partial<ProjectFacts> = {}): ProjectFacts => ({
  goal,
  in_flight: 2,
  blocked: 0,
  last_move_at: "2026-11-08T14:48:00Z",
  po: { slug: "po-x", name: "PO" },
  last_run: null,
  ...extra,
});
const run = (id: string, role: string, project: string, status: "running" | "queued", started: string | null): CompanyRun => ({
  id, agent: role, role, project, ticket: "MIA-I3-4", status, queued_at: "2026-11-08T14:40:00Z", started_at: started, turns: 18, tokens: 92_000,
});
const PROMPTS = {
  "product-owner": { doc_id: "377b1840-9262-411e-b6c4-53ddff950665", title: "Prompt: Product owner", version: 1 },
  taller: { doc_id: "f449a74e-fd0f-492d-80ab-eb90718c2c86", title: "Prompt: Taller", version: 1 },
  research: { doc_id: "eb161d26-d865-4c20-887a-0f5fa512a981", title: "Prompt: Research", version: 1 },
  artist: { doc_id: "e2ca3031-99b2-4d49-8c76-33143f82efc6", title: "Prompt: Artist", version: 1 },
  asistente: { doc_id: "4aa86adf-cd32-4163-ad4e-e900966f0a15", title: "Prompt: Asistente", version: 1 },
};
const roster: RosterRow[] = [
  { slug: "asistente", name: "Asistente", role: "asistente", project: null, heartbeat_minutes: 120, next_wake_at: "2026-11-08T17:00:00Z", last_run: null },
  { slug: "taller", name: "Taller", role: "taller", project: null, heartbeat_minutes: null, next_wake_at: null, last_run: null },
  { slug: "research", name: "Research", role: "research", project: null, heartbeat_minutes: null, next_wake_at: null, last_run: null },
  { slug: "artist", name: "Artist", role: "artist", project: null, heartbeat_minutes: null, next_wake_at: null, last_run: null },
  { slug: "po-mianovia", name: "Mianovia", role: "product-owner", project: "mianovia", heartbeat_minutes: 60, next_wake_at: "2026-11-08T16:00:00Z", last_run: null },
];
const company = (patch: Partial<Company> = {}): Company => ({
  company: { paused: false, paused_at: null },
  settings: { max_concurrent: 2, cooldown_minutes: 30, plan_guard_pct: 70, reserve_tokens: 60000, max_turns: 40, timeout_minutes: 45 },
  week: { starts_at: "2026-11-02T06:00:00Z", resets_at: "2026-11-09T06:00:00Z", timezone: TZ },
  projects: [project("mianovia", "Mianovia", budget(1_180_000, 2_000_000)), project("micasa", "MiCasa", budget(1_640_000, 2_000_000))],
  roles: (["product-owner", "taller", "research", "artist", "asistente"] as const).map((role) => ({ role, budget: budget(95_000, 300_000) })),
  runs: { live: [run("r1", "taller", "mianovia", "running", "2026-11-08T14:45:28Z")], queued: [run("r2", "product-owner", "plania", "queued", null)] },
  plan: { five_hour_pct: 41, seven_day_pct: 23, resets_at: "2026-11-08T19:20:00Z", seven_day_resets_at: null, guard_pct: 70, status: "allowed", state: "ok", read_at: null, source: "stream" },
  viewer: { can_edit_limits: true },
  prompts: PROMPTS,
  roster,
  project_facts: { mianovia: facts("Que una novia arme su lista de regalos y la comparta en cinco minutos."), micasa: facts("Llegar a los primeros diez usuarios.") },
  ...patch,
});
const cardsFor = (c: Company, needs = new Set<string>()) =>
  c.projects.map((p) => ({ project: p, facts: c.project_facts?.[p.slug], health: healthOf(p, c.project_facts?.[p.slug], { companyPaused: c.company.paused, needsJorge: needs.has(p.slug), now: NOW }) }));
const page = (c: Company, canEdit = true) =>
  html(
    h(React.Fragment, null,
      h(parts.Banners!, { banners: bannersOf(c), canEdit, timeZone: TZ, onResume: noop, onRaise: noop, onMoveGuard: noop, onSeeSpend: noop, dismissed: new Set(), onDismiss: noop }),
      h(parts.ProjectCards!, { items: cardsFor(c), now: NOW, onOpen: noop, onResume: noop, onWriteGoal: noop, onNew: noop, onEquipo: noop }),
      h(parts.EnMarcha!, { company: c, now: NOW, projectTitle: (s: string) => s }),
      h(parts.Gasto!, { company: c, canEdit, onMoveGuard: noop, projectTitle: (s: string) => s }),
      h(parts.KillSwitch!, { company: c, onStop: noop, onResume: noop }),
    ),
  );
const noMoney = (s: string) => assert.equal(/\$|USD|usd/.test(s), false, "no money on screen");

test("1a normal: brief, Solo tú, cards, En marcha with cap and queue, Gasto in tokens, kill switch", () => {
  const out = html(
    h(React.Fragment, null,
      h(v2.Brief!, { lines: ["Seis PRs llegaron a sandbox."], title: "Brief de hoy", sign: "Asistente · jefa de gabinete" }),
      h(v2.Queue!, { items: [], title: "Solo tú", note: "Nada se detiene por esto: el equipo sigue con lo demás.", onAssign: noop }),
    ),
  ) + page(company());
  for (const text of ["Brief de hoy", "Solo tú", "Nada te espera.", "Proyectos", "+ Nuevo proyecto", "Mianovia", "1.18M / 2M", "En marcha", "Tope: 2 a la vez · 1 en espera", "14:32", "Gasto", "Ventana de 5 h del plan", "41%", "Detener la compañía"]) {
    assert.ok(out.includes(text), text);
  }
  assert.equal(out.includes("Pedir"), false, "no Pedir on Compañía");
  noMoney(out);
});

test("5a empty: one path to the first project and one-line empty texts", () => {
  const out = page(company({ projects: [], project_facts: {}, runs: { live: [], queued: [] } }));
  assert.ok(out.includes("Crear el primer proyecto"));
  assert.ok(out.includes("Nada corre."));
  assert.ok(out.includes("0 tokens esta semana."));
});

test("5a′ a project with no goal is a dashed card that says its PO does not wake", () => {
  const out = page(company({ project_facts: { mianovia: facts(null), micasa: facts("x") } }));
  assert.ok(out.includes("Sin meta"));
  assert.ok(out.includes("Escribir la meta"));
  assert.ok(out.includes("no despierta sin una meta"));
});

test("5b loading skeletons and 5c per-block error render", () => {
  assert.ok(html(h(parts.CardsSkeleton!, {})).includes("cards-skeleton"));
  assert.ok(html(h(parts.BriefSkeleton!, {})).length > 0);
  assert.ok(html(h(parts.SideSkeleton!, {})).length > 0);
  const err = html(h(parts.BlockError!, { what: "la compañía", onRetry: noop }));
  assert.ok(err.includes("No se pudo cargar la compañía."));
  assert.ok(err.includes("Si la Mac está dormida, nada corre hasta que despierte."));
  assert.ok(err.includes("Reintentar"));
  const unknown = page(company({ plan: { ...company().plan, five_hour_pct: null, state: "unknown" } }));
  assert.ok(unknown.includes("Desconocido = alto"));
});

test("5d long text clamps names, goals and Solo tú; clocks keep 1:02:45", () => {
  const long = "Un nombre de proyecto larguísimo que no cabe en dos líneas de ninguna tarjeta ni en el teléfono";
  const c = company({ projects: [project("largo", long, budget(10, 1000))], project_facts: { largo: facts(long.repeat(3)) }, runs: { live: [run("r", "taller", "largo", "running", "2026-11-08T13:57:15Z")], queued: [] } });
  const out = page(c);
  assert.ok(count(out, /line-clamp-2/g) >= 2);
  assert.ok(out.includes("1:02:45"));
  assert.ok(out.includes("whitespace-nowrap"));
  const queue = html(h(v2.Queue!, { items: [{ id: "q", kind: "decidir", project: "filmia", key: "FIL-1", title: long, detail: "", age_days: 1, href: null, action: "open" }], title: "Solo tú", onAssign: noop }));
  assert.ok(queue.includes("line-clamp-3"));
});

test("5e everything paused: grey banner with Reanudar, grey cards, own pause kept, nothing runs", () => {
  const c = company({
    company: { paused: true, paused_at: "2026-11-08T16:42:00Z" },
    projects: [project("mianovia", "Mianovia", budget(10, 1000)), project("zigzag", "ZigZag", budget(0, 1000), true)],
    runs: { live: [], queued: [] },
  });
  const out = page(c);
  assert.ok(out.includes('data-banner="paused"'));
  assert.ok(out.includes("La compañía está detenida · desde 10:42, por ti"));
  assert.ok(out.includes("En pausa (propia)"));
  assert.ok(out.includes("Nada corre: la compañía está detenida."));
  assert.ok(out.includes("Reanudar la compañía"));
  assert.equal(out.includes('data-banner="budget"'), false);
});

test("5f 80%: no banner, amber card that says only this project stops at 100%", () => {
  const out = page(company({ projects: [project("micasa", "MiCasa", budget(1_640_000, 2_000_000))] }));
  assert.equal(out.includes("data-banner"), false);
  assert.ok(out.includes("Presupuesto 82%"));
  assert.ok(out.includes("Al llegar a 100% se detiene solo este proyecto."));
});

test("5g 100%: red banner with Subir límite for Jorge only; the card reads Detenido", () => {
  const c = company({ projects: [project("micasa", "MiCasa", budget(2_000_000, 2_000_000)), project("mianovia", "Mianovia", budget(10, 1000))] });
  const jorge = page(c, true);
  assert.ok(jorge.includes('data-banner="budget"'));
  assert.ok(jorge.includes("MiCasa llegó a su límite semanal · 2M / 2M · nada nuevo arranca ahí hasta el lunes 00:00 · los demás siguen"));
  assert.ok(jorge.includes("Subir límite"));
  assert.ok(jorge.includes("Dejarlo así"));
  assert.ok(jorge.includes("Detenido"));
  assert.ok(jorge.includes("rama guardada"));
  assert.equal(page(c, false).includes("Subir límite"), false);
  noMoney(jorge);
});

test("5h plan guard: amber banner, Ver gasto, Mover guardia for Jorge only", () => {
  const c = company({ plan: { ...company().plan, five_hour_pct: 72, state: "stopped" }, runs: { live: [], queued: [run("q1", "taller", "x", "queued", null), run("q2", "taller", "y", "queued", null), run("q3", "artist", "z", "queued", null)] } });
  const out = page(c, true);
  assert.ok(out.includes('data-banner="plan"'));
  assert.ok(out.includes("la ventana de 5 h pasó el guardia · no arrancan corridas nuevas hasta 13:20 para que te quede plan a ti · las que corren terminan su paso"));
  assert.ok(out.includes("Ver gasto"));
  assert.ok(out.includes("Mover guardia"));
  assert.ok(out.includes("Nada arranca: 3 en espera del guardia."));
  assert.equal(page(c, false).includes("Mover guardia"), false);
});

test("5i stop sheet names what closes, what stops starting and what is kept; no typing", () => {
  const c = company();
  const out = html(h(parts.StopBody!, { scope: { kind: "company" }, runs: c.runs.live, projectTitle: (s: string) => s, onConfirm: noop, onCancel: noop }));
  for (const t of ["Se cierra", "Taller en mianovia (MIA-I3-4)", "Deja de arrancar", "Se queda", "No se borra nada", "Detener la compañía", "Seguir en marcha"]) assert.ok(out.includes(t), t);
  assert.equal(out.includes("<input"), false);
  const proj = html(h(parts.StopBody!, { scope: { kind: "project", slug: "mianovia", title: "Mianovia" }, runs: c.runs.live, projectTitle: (s: string) => s, onConfirm: noop, onCancel: noop }));
  assert.ok(proj.includes("Pausar Mianovia"));
});

const sheetData: ProjectSheetData = {
  slug: "mianovia",
  title: "Mianovia",
  goal: "Que una novia arme su lista de regalos y la comparta en cinco minutos.",
  pipeline: [
    { stage: "idea", count: 3, newest: "Filtros por precio" },
    { stage: "research", count: 1, newest: null },
    { stage: "design", count: 1, newest: "Compartir por WhatsApp" },
    { stage: "planning", count: 0, newest: null },
    { stage: "ready", count: 2, newest: null },
  ],
  in_progress: [{ key: "MIA-I3-4", title: "Botón de compartir", status: "In progress", owner: "Claude Code" }],
  blocked: [{ key: "MIA-I3-5", title: "Pagos", status: "Blocked", why: "la API de pagos" }],
  next: [{ key: "MIA-I3-6", title: "Lista ordenable", priority: "P2" }],
  runs: [{ id: "x", agent: "taller", role: "taller", project: "mianovia", ticket: "MIA-I3-3", status: "ok", summary: "PR a sandbox", started_at: "2026-11-08T13:00:00Z", ended_at: "2026-11-08T13:40:00Z", tokens: 120_000 }],
};

test("project sheet (2a/2b) renders goal, pipeline, en curso, bloqueado, siguiente, runs with tokens, meter and switch", () => {
  const c = company();
  const p = c.projects[0]!;
  const props = { project: p, facts: c.project_facts!.mianovia, health: cardsFor(c)[0]!.health, sheet: sheetData, companyPaused: false, now: NOW, onEditBudget: noop, onEditGoal: noop, onPause: noop, onResume: noop };
  const out = html(h(sheets.ProjectSheetBody!, { ...props, canEdit: true }));
  for (const t of ["Meta", "Que una novia arme", "Ideas", "avanzan solas, sin compuertas", "Diseño", "Lista", "En curso", "MIA-I3-4", "Bloqueado", "espera: la API de pagos", "Siguiente", "MIA-I3-6", "Corridas recientes", "120k tok", "Presupuesto semanal", "Aviso al 80% · alto al 100%", "Pausar"]) {
    assert.ok(out.includes(t), t);
  }
  assert.equal(count(out, /data-control="cambiar"/g), 1);
  const agent = html(h(sheets.ProjectSheetBody!, { ...props, canEdit: false }));
  assert.equal(agent.includes("Cambiar"), false, "no Cambiar for an agent session");
  const paused = html(h(sheets.ProjectSheetBody!, { ...props, project: { ...p, paused: true }, canEdit: true }));
  assert.ok(paused.includes("Su PO despierta cuando lo reanudes."));
  noMoney(out);
});

test("Equipo sheet (3a/3b) lists only the real roles with last run, next wake, Prompt ↗ to the A2 docs and meters", () => {
  const c = company();
  const out = html(h(sheets.EquipoSheetBody!, { company: c, canEdit: true, now: NOW, onEditBudget: noop, projectTitle: (s: string) => s }));
  assert.deepEqual([...out.matchAll(/data-role="([^"]+)"/g)].map((m) => m[1]), ["asistente", "product-owner", "taller", "research", "artist"]);
  for (const [role, ref] of Object.entries(PROMPTS)) {
    assert.ok(out.includes(`href="/ceo?doc=${ref.doc_id}"`), `${role} prompt link`);
  }
  assert.equal(count(out, /Prompt ↗/g), 5);
  assert.equal(/Cursor|Coach|COO|CTO/.test(out), false);
  assert.ok(out.includes("Corriendo MIA-I3-4"), "Taller is running");
  assert.ok(out.includes("Tope: 2 a la vez"));
  assert.equal(count(out, /data-control="cambiar"/g), 5);
  const agent = html(h(sheets.EquipoSheetBody!, { company: c, canEdit: false, now: NOW, onEditBudget: noop, projectTitle: (s: string) => s }));
  assert.equal(agent.includes("Cambiar"), false);
});

test("new project (4a/4b): starts paused, and a missing endpoint is a clear error", () => {
  const form = html(h(sheets.NewProjectForm!, { state: { kind: "idle" }, onSubmit: noop, onCancel: noop }));
  assert.ok(form.includes("Meta, en una oración"));
  assert.ok(form.includes("Empieza en pausa. Su PO despierta cuando lo reanudes."));
  assert.equal(form.includes("Empieza en marcha"), false);
  const missing = html(h(sheets.NewProjectForm!, { state: { kind: "missing" }, onSubmit: noop, onCancel: noop }));
  assert.ok(missing.includes("el servidor no tiene esa ruta"));
  assert.ok(missing.includes("No se creó nada."));
  const done = html(h(sheets.NewProjectDone!, {
    state: { kind: "done", name: "Viajia", goal: "Que alguien arme su viaje.", result: { slug: "viajia", key_prefix: "VIA", paused: true, po: "po-viajia", prompt_doc_id: PROMPTS["product-owner"].doc_id } },
    onOpen: noop,
    onClose: noop,
  }));
  assert.ok(done.includes("Su PO despierta cuando lo reanudes"));
  assert.ok(done.includes("Ver Viajia"));
  assert.ok(done.includes(`/ceo?doc=${PROMPTS["product-owner"].doc_id}`));
});

test("nav: the logo is Inicio and the header has exactly four links; the phone tab bar has the same four", () => {
  const counts = { inbox: 3, chores: 2 };
  const header = html(h(React.Fragment, null, h(nav.Logo!, {}), h(nav.HeaderNav!, { counts })));
  assert.equal(count(header, /<a /g), 5);
  assert.ok(header.includes('href="/"'));
  const links = [...header.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, ["/", "/ceo", "/inbox", "/progreso", "/machine"]);
  for (const gone of ["/ahora", "/goals", "/equipo", "/tokens"]) assert.equal(header.includes(`href="${gone}"`), false, gone);
  const tabs = html(h(nav.TabBar!, { counts }));
  assert.deepEqual([...tabs.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ["/ceo", "/inbox", "/progreso", "/machine"]);
  assert.ok(tabs.includes("sm:hidden"));
});
