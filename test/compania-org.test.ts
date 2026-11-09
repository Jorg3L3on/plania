// PLA-I33: Compañía como organización, rendered with fake data (no browser, no database). The thread with
// Asistente and its inline buttons, the team cards with one row per role, the project page blocks, the
// plumbing in Máquina, and one test per state in the Design doc's Scope. Fake names and numbers only.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
// Loaded by URL so the root typecheck (NodeNext, no JSX) does not follow them; `pnpm build` checks them.
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const org = await load("components/compania/org.tsx");
const lib = await load("lib/org.ts");

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const NOW = new Date("2026-11-08T15:00:00Z").getTime();
const TZ = "America/Mexico_City";
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const noMoney = (s: string) => assert.equal(/\$|USD|usd|total_cost/.test(s), false, "no money on screen");

export const budget = (used: number, limit: number | null) => {
  if (limit == null) return { used, limit: null, pct: null, state: "stopped", reason: "unset" };
  const pct = Math.floor((used / limit) * 1000) / 10;
  return { used, limit, pct, state: pct >= 100 ? "stopped" : pct >= 80 ? "warn" : "ok", reason: null };
};

const member = (role: string, slug: string, patch: Record<string, unknown> = {}) => ({
  agent: role === "product-owner" ? `po-${slug}` : `${role}-${slug}`,
  role,
  template: role,
  state: "idle",
  now: null,
  last: { ticket: `${slug.slice(0, 3).toUpperCase()}-1`, status: "Done", at: "2026-11-08T13:00:00Z" },
  produced: null,
  waiting: null,
  ...patch,
});
const team = (slug: string, patch: Record<string, Record<string, unknown>> = {}) =>
  ["product-owner", "research", "artist", "taller"].map((r) => member(r, slug, patch[r] ?? {}));

const orgProject = (slug: string, title: string, patch: Record<string, unknown> = {}) => ({
  slug,
  title,
  paused: false,
  light: "ok",
  goal: `Meta de prueba de ${title}.`,
  budget: budget(912_000, 6_000_000),
  team: team(slug),
  thread: { id: `t-${slug}`, unread: 0, last: null },
  ...patch,
});

const SIX = [
  orgProject("mianovia", "Mianovia", {
    light: "needs_jorge",
    team: team("mianovia", {
      "product-owner": { state: "waiting_jorge", waiting: "que aceptes el doc Campos y flujos", produced: { kind: "doc", ref: "d-1", title: "Campos y flujos" } },
      taller: { state: "running", now: { ticket: "MIA-I3-4", since: "2026-11-08T14:42:00Z" }, last: null },
    }),
    thread: { id: "t-mianovia", unread: 2, last: { at: "2026-11-08T14:50:00Z", author_role: "product-owner", body: "Listo el doc." } },
  }),
  orgProject("micasa", "MiCasa", { light: "paused", paused: true }),
  orgProject("filmia", "Filmia", { light: "quiet" }),
  orgProject("plania", "Plania"),
  orgProject("workia", "Workia", { light: "no_budget", budget: budget(2_000_000, 2_000_000) }),
  orgProject("zigzag", "ZigZag", { light: "paused", paused: true }),
];

const msg = (id: string, at: string, patch: Record<string, unknown> = {}) => ({
  id,
  at,
  author: { agent: "asistente", role: "asistente" },
  body: `Mensaje ${id}`,
  links: [],
  actions: [],
  action_state: null,
  question_id: null,
  ...patch,
});
const asistenteThread = {
  id: "t-company",
  kind: "company",
  project: null,
  messages: [
    msg("m1", "2026-11-06T22:00:00Z", { author: { agent: "jorge", role: "jorge" }, body: "Mianovia: quiero compartir la lista por WhatsApp." }),
    msg("m2", "2026-11-08T13:00:00Z", {
      body: "El PO de Mianovia terminó el doc.",
      links: [{ kind: "ticket", ref: "MIA-01", title: "Compartir la lista" }, { kind: "doc", ref: "d-1", title: "Campos y flujos" }],
      actions: ["aceptar", "cambios"],
    }),
    msg("m3", "2026-11-08T13:10:00Z", { body: "Taller abrió el PR.", links: [{ kind: "pr", ref: "https://example.test/pr/12", title: "PR #12" }], actions: ["fusionar", "cambios"] }),
    msg("m4", "2026-11-08T13:20:00Z", { body: "El PO pregunta: ¿precio en pesos o sin precio?", links: [{ kind: "question", ref: "q-1", title: "Precio" }], actions: ["responder"], question_id: "q-1" }),
    msg("m5", "2026-11-08T13:30:00Z", { body: "Plan de Filmia aceptado.", actions: ["aceptar"], action_state: { action: "aceptar", at: "2026-11-08T13:31:00Z", result: "Done" } }),
    msg("m6", "2026-11-08T14:00:00Z", { body: "PR #9 de Plania.", actions: ["fusionar"], action_state: { action: "fusionar", at: "2026-11-08T14:01:00Z", result: "1abb07d" } }),
    msg("m7", "2026-11-08T14:05:00Z", { body: "Pregunta de Workia.", actions: ["responder"], action_state: { action: "responder", at: "2026-11-08T14:06:00Z", result: "" }, question_id: "q-2" }),
    msg("m8", "2026-11-08T13:00:00Z".replace("13:00", "13:05"), { body: "Brief de las 07:00: seis equipos, uno en marcha.", }),
  ],
};
const threadProps = (patch: Record<string, unknown> = {}) => ({
  title: "Asistente",
  thread: asistenteThread,
  loading: false,
  error: false,
  onRetry: noop,
  project: null,
  now: NOW,
  timeZone: TZ,
  placeholder: "Dile a Asistente…",
  send: { kind: "idle" },
  onSend: noop,
  busy: null,
  onAction: noop,
  expanded: false,
  onToggle: noop,
  ...patch,
});

// ---- PLA-I33-1 Compañía

test("I33-1 thread: Jorge and Asistente messages, the four inline buttons, their action_state and the text box", () => {
  const out = html(h(org.ThreadPanel, threadProps()));
  for (const t of ["Asistente", "Tú", "Mianovia: quiero compartir", "MIA-01 · Compartir la lista", 'doc “Campos y flujos”', "PR #12", "Dile a Asistente…", "Enviar"]) assert.ok(out.includes(t), t);
  const buttons = [...out.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(buttons, ["aceptar", "cambios", "fusionar", "cambios", "responder"]);
  for (const label of ["Aceptar", "Pedir cambios", "Responder", "Fusionar"]) assert.ok(out.includes(`>${label}<`), label);
  // After acting, a message shows the result instead of buttons.
  assert.ok(out.includes("Aceptado · Done"));
  assert.ok(out.includes("Fusionado a sandbox · 1abb07d"));
  assert.ok(out.includes(">Respondido<"));
  assert.equal(count(out, /data-action-state=/g), 3);
  assert.ok(out.includes("3 te esperan"));
  assert.ok(out.includes('href="https://example.test/pr/12"'));
  assert.ok(out.includes('href="/ceo?doc=d-1"'));
  noMoney(out);
});

test("I33-1 thread: continuous, with a separator where the day changes, and the brief as the last Asistente message", () => {
  const items = lib.threadItems(asistenteThread.messages, NOW, TZ);
  assert.deepEqual(items.filter((i: any) => i.kind === "day").map((i: any) => i.label), ["Viernes, 6 de noviembre", "Hoy"]);
  const out = html(h(org.ThreadPanel, threadProps()));
  assert.ok(out.includes("data-day"));
  // Thirty messages first, "Ver anteriores" for the rest.
  const many = { ...asistenteThread, messages: Array.from({ length: 45 }, (_, i) => msg(`n${i}`, new Date(NOW - (45 - i) * 60_000).toISOString())) };
  const long = html(h(org.ThreadPanel, threadProps({ thread: many, onMore: noop, expanded: true })));
  assert.equal(count(long, /data-message=/g), 30);
  assert.ok(long.includes("Ver anteriores (15)"));
});

test("I33-1 phone: the thread folds to its last message; the toggle shows only on a phone", () => {
  const folded = html(h(org.ThreadPanel, threadProps()));
  assert.equal(count(folded, /data-message="[^"]+" (?:data-waiting="1" )?class="[^"]*max-sm:hidden/g), asistenteThread.messages.length - 1);
  assert.ok(folded.includes(`Ver el hilo (${asistenteThread.messages.length})`));
  assert.ok(/data-control="fold"[^>]*|class="[^"]*sm:hidden[^"]*"[^>]*data-control="fold"/.test(folded));
  const open = html(h(org.ThreadPanel, threadProps({ expanded: true })));
  assert.equal(count(open, /max-sm:hidden/g), 0);
  assert.ok(open.includes("Plegar el hilo"));
});

test("I33-1 team cards: six cards, four role rows each, light, goal, plumbing line to Máquina, Abrir to /p", () => {
  const out = html(h(org.TeamCards, { projects: SIX, now: NOW, onPreview: noop, onNew: noop }));
  assert.equal(count(out, /data-card=/g), 6);
  assert.equal(count(out, /data-role-row=/g), 24);
  for (const slug of SIX.map((p) => p.slug)) assert.ok(out.includes(`href="/p/${slug}"`), slug);
  assert.deepEqual([...new Set([...out.matchAll(/data-role-row="([^"]+)"/g)].map((m) => m[1]))], ["product-owner", "research", "artist", "taller"]);
  for (const t of ["Te necesita", "En pausa", "Quieto", "Bien", "Sin presupuesto", "PO", "Research", "Artist", "Taller", "MIA-I3-4", "desde 18 min", 'doc “Campos y flujos”', "espera: que aceptes", "912k / 6M · en marcha", "→ Máquina", "2 mensajes nuevos del PO"]) {
    assert.ok(out.includes(t), t);
  }
  assert.equal(count(out, /href="\/machine"/g), 6);
  assert.ok(out.includes("md:grid-cols-2"), "two columns from the Mac width");
  noMoney(out);
});

test("I33-1 the retired blocks are gone from the page: Solo tú, En marcha, Gasto, the switch and the Equipo sheet", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  for (const gone of ["Solo tú", "EnMarcha", "Gasto", "KillSwitch", "EquipoSheetBody", "setCompanyPaused", "Queue"]) assert.equal(page.includes(gone), false, gone);
  assert.ok(page.includes("lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]"), "thread left at a fixed width, cards right");
  assert.ok(page.includes("ThreadPanel") && page.includes("TeamCards") && page.includes("CompanyPlumbing"));
});

test("I33-1 the company plumbing line reads tokens and what runs, amber at 80 % and red at 100 %", () => {
  assert.deepEqual(lib.plumbingLine({ spend: 912_000, limit: 6_000_000, running: 1, paused: false }), { text: "912k / 6M · 1 en marcha", tone: "ok" });
  assert.equal(lib.plumbingLine({ spend: 4_900_000, limit: 6_000_000, running: 0, paused: false }).tone, "warn");
  assert.equal(lib.plumbingLine({ spend: 6_000_000, limit: 6_000_000, running: 0, paused: false }).tone, "stop");
  assert.deepEqual(lib.plumbingLine({ spend: 0, limit: null, running: 0, paused: true }), { text: "0 · sin límite · detenida", tone: "idle" });
  const out = html(h(org.CompanyPlumbing, { plumbing: { spend: 912_000, limit: 6_000_000, running: 1, paused: false } }));
  assert.ok(out.includes("Plomería · 912k / 6M · 1 en marcha"));
  assert.ok(out.includes('href="/machine"'));
});

test("I33-1 a bare link in the text box says Asistente saves it to the library", () => {
  assert.equal(lib.isBareLink("https://example.test/a"), true);
  assert.equal(lib.isBareLink("mira https://example.test/a"), false);
  assert.equal(lib.isBareLink("Mianovia: algo"), false);
});

// ---- PLA-I33-2 project page /p/<slug>

const compLib = await load("lib/compania.ts");
const poThread = {
  id: "t-mianovia",
  kind: "project",
  project: "mianovia",
  messages: [
    msg("p1", "2026-11-08T10:00:00Z", { author: { agent: "jorge", role: "jorge" }, body: "Quiero que la lista se comparta por WhatsApp." }),
    msg("p2", "2026-11-08T11:00:00Z", { author: { agent: "po-mianovia", role: "product-owner" }, body: "La idea pasa a Research." }),
    msg("p3", "2026-11-08T12:00:00Z", { author: { agent: "po-mianovia", role: "product-owner" }, body: "Terminé el doc.", links: [{ kind: "doc", ref: "d-1", title: "Campos y flujos" }], actions: ["aceptar", "cambios"] }),
    msg("p4", "2026-11-08T13:00:00Z", { author: { agent: "taller-mianovia", role: "taller" }, body: "PR del botón.", links: [{ kind: "pr", ref: "https://example.test/pr/12", title: "PR #12" }], actions: ["fusionar", "cambios"] }),
  ],
};
const TEMPLATES = [
  { slug: "qa", title: "QA" },
  { slug: "copy", title: "Copy" },
  { slug: "marketing", title: "Marketing" },
  { slug: "data", title: "Data" },
];

test("I33-2 project page: header with light, goal and Editar, plumbing line, Pausar; the team; the PO thread; Añadir al equipo", () => {
  const p = SIX[0]!;
  const bar = html(h(org.ProjectOrgBar, { project: p, companyPaused: false, canEdit: true, onEditGoal: noop, onPause: noop, onResume: noop }));
  for (const t of ["Te necesita", "Meta", "Editar", "Meta de prueba de Mianovia.", "912k / 6M · en marcha", "→ Máquina", "Pausar"]) assert.ok(bar.includes(t), t);
  assert.ok(bar.includes('href="/machine"'));
  const runs = [{ id: "r", agent: "taller-mianovia", role: "taller", project: "mianovia", ticket: "MIA-I3-3", status: "ok", summary: "", started_at: null, ended_at: "2026-11-08T13:40:00Z", tokens: 120_000 }];
  const teamOut = html(h(org.ProjectTeam, { project: "mianovia", team: p.team, runs, templates: TEMPLATES, now: NOW, add: { kind: "idle" }, onAdd: noop, canEdit: true }));
  assert.equal(count(teamOut, /data-role-row=/g), 4);
  for (const t of ["Equipo", "po-mianovia", "MIA-I3-3 · 120k tokens", "Añadir al equipo", ">QA<", ">Copy<", ">Marketing<", ">Data<", "Añadir"]) assert.ok(teamOut.includes(t), t);
  const added = html(h(org.AddToTeam, { templates: TEMPLATES, team: [...p.team, member("qa", "mianovia", { template: "qa" })], state: { kind: "done", agent: "qa-mianovia" }, onAdd: noop }));
  assert.equal(added.includes(">QA<"), false, "a template already on the team is not offered again");
  assert.ok(added.includes("Listo: qa-mianovia"));
  const thread = html(h(org.ThreadPanel, threadProps({ title: "PO", thread: poThread, project: "mianovia", placeholder: "Dile al PO…" })));
  for (const t of ["Dile al PO…", ">Aceptar<", ">Pedir cambios<", ">Fusionar<", "2 te esperan"]) assert.ok(thread.includes(t), t);
  assert.ok(thread.includes('href="/ceo?doc=d-1"'));
  noMoney(bar + teamOut + thread);
});

test("I33-2 the old Pedir box is gone from /p and the page holds the team, the PO thread and the plan", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../ui/src/pages/project.tsx", import.meta.url), "utf8");
  assert.equal(count(page, /PedirBox/g), 0);
  const order = ["<ProjectHeader", "<ProjectOrg slug", "<QuestionsPanel", "<LaneGrid", "<InitiativeTable"].map((t) => page.indexOf(t));
  assert.ok(order.every((i) => i > 0), "all blocks present");
  assert.ok(order[1]! < order[3]!, "team and thread above the plan");
  const pedir = readFileSync(new URL("../ui/src/components/pedir.tsx", import.meta.url), "utf8");
  assert.equal(pedir.includes("export function PedirBox"), false);
});

test("I33-2 preview sheet: header, team, the last 3 messages and Abrir; /ceo?p=x redirects to /p/x", () => {
  const out = html(h(org.ProjectPreview, { project: SIX[0], messages: poThread.messages, now: NOW, timeZone: TZ }));
  assert.equal(count(out, /data-message=/g), 3);
  assert.equal(out.includes("Quiero que la lista"), false, "only the last three");
  assert.equal(count(out, /data-role-row=/g), 4);
  assert.ok(out.includes('href="/p/mianovia"'));
  assert.ok(out.includes("Abrir Mianovia"));
  assert.equal(count(out, /data-action=/g), 0, "the preview does not act; Abrir does");
  assert.equal(compLib.ceoRedirect("?p=x"), "/p/x");
  assert.equal(compLib.ceoRedirect("?equipo"), "/machine");
  assert.equal(compLib.ceoRedirect("?vista=x"), null);
  assert.equal(compLib.ceoRedirect(""), null);
});

// ---- PLA-I33-4: one test per state in the Design doc's Scope

const card = (p: Record<string, unknown>) => html(h(org.TeamCard, { project: p, now: NOW, onPreview: noop }));
const parts = await load("components/compania/parts.tsx");

test("I33-4 state vacío: no projects, no messages, a team with no runs", () => {
  const cards = html(h(org.TeamCards, { projects: [], now: NOW, onNew: noop }));
  assert.ok(cards.includes('data-empty="projects"'));
  assert.ok(cards.includes("Crear el primer proyecto"));
  const thread = html(h(org.ThreadPanel, threadProps({ thread: { ...asistenteThread, messages: [] } })));
  assert.ok(thread.includes('data-empty="thread"'));
  assert.ok(thread.includes("Dile a Asistente…"), "the text box stays");
  const fresh = card(orgProject("nuevo", "Nuevo", { team: team("nuevo", { "product-owner": { last: null }, research: { last: null }, artist: { last: null }, taller: { last: null } }) }));
  assert.equal(count(fresh, />Sin corridas todavía</g), 4);
  assert.ok(card(orgProject("solo", "Solo", { team: [] })).includes("Sin equipo todavía."));
});

test("I33-4 state carga: a skeleton per block", () => {
  assert.ok(html(h(org.ThreadSkeleton, {})).includes("thread-skeleton"));
  assert.ok(html(h(org.TeamCardsSkeleton, {})).includes("cards-skeleton"));
  const loading = html(h(org.ThreadPanel, threadProps({ thread: undefined, loading: true })));
  assert.ok(loading.includes("thread-skeleton"));
  assert.equal(loading.includes("data-message"), false);
});

test("I33-4 state error por bloque: the thread says the Mac may be asleep and offers Reintentar; the box stays", () => {
  const out = html(h(org.ThreadPanel, threadProps({ thread: undefined, error: true })));
  assert.ok(out.includes("No se pudo cargar el hilo."));
  assert.ok(out.includes("Si la Mac está dormida"));
  assert.ok(out.includes("Reintentar"));
  assert.ok(out.includes("Dile a Asistente…"));
  const team = html(h(parts.BlockError, { what: "el equipo", onRetry: noop }));
  assert.ok(team.includes("No se pudo cargar el equipo."));
});

test("I33-4 state texto largo: goal, title, message and ticket clamp or truncate", () => {
  const long = "Un nombre de proyecto larguísimo que no cabe en dos líneas de ninguna tarjeta ni en el teléfono";
  const out = card(orgProject("largo", long, { goal: long.repeat(3), team: team("largo", { taller: { now: { ticket: `MIA-I3-4 · ${long}`, since: "2026-11-08T14:00:00Z" }, last: null } }) }));
  assert.ok(count(out, /line-clamp-2/g) >= 2, "title and goal");
  assert.ok(out.includes("truncate"), "ticket line");
  const message = html(h(org.MessageRow, { message: msg("x", "2026-11-08T14:00:00Z", { body: long.repeat(5) }), project: null, busy: null, onAction: noop }));
  assert.ok(message.includes("line-clamp-6"));
  assert.ok(message.includes("Ver todo"));
  const bar = html(h(org.ProjectOrgBar, { project: orgProject("largo", long, { goal: long.repeat(3) }), companyPaused: false, canEdit: true, onEditGoal: noop, onPause: noop, onResume: noop }));
  assert.ok(bar.includes("line-clamp-3"));
});

test("I33-4 state proyecto en pausa: grey card, read-only thread with a notice, Reanudar", () => {
  const p = SIX[1]!;
  const out = card(p);
  assert.ok(out.includes("bg-surface-sunken"));
  assert.ok(out.includes("En pausa"));
  assert.ok(out.includes("en pausa"), "the plumbing line");
  const thread = html(h(org.ThreadPanel, threadProps({ title: "PO", thread: poThread, project: "micasa", placeholder: "Dile al PO…", readOnly: "En pausa: el PO no despierta. Reanuda el proyecto para escribirle." })));
  assert.ok(thread.includes("data-readonly"));
  assert.ok(thread.includes("Reanuda el proyecto para escribirle."));
  assert.equal(count(thread, /data-action=/g), 0, "no buttons while paused");
  assert.ok(/<textarea[^>]*disabled/.test(thread));
  const bar = html(h(org.ProjectOrgBar, { project: p, companyPaused: false, canEdit: true, onEditGoal: noop, onPause: noop, onResume: noop }));
  assert.ok(bar.includes('data-control="reanudar"'));
  assert.ok(bar.includes("Su PO despierta cuando lo reanudes."));
});

test("I33-4 state compañía detenida: the plumbing line reads detenida, the project page says so", () => {
  const line = html(h(org.CompanyPlumbing, { plumbing: { spend: 912_000, limit: 6_000_000, running: 0, paused: true } }));
  assert.ok(line.includes("detenida"));
  assert.ok(line.includes('data-plumbing="idle"'));
  const bar = html(h(org.ProjectOrgBar, { project: SIX[3], companyPaused: true, canEdit: true, onEditGoal: noop, onPause: noop, onResume: noop }));
  assert.ok(bar.includes("La compañía está detenida"));
});

test("I33-4 state sin presupuesto: red light, the plumbing line says sin presupuesto, roles wait", () => {
  const out = card(orgProject("workia", "Workia", { light: "no_budget", budget: budget(2_000_000, 2_000_000), team: team("workia", { "product-owner": { state: "no_budget" } }) }));
  assert.ok(out.includes("Sin presupuesto"));
  assert.ok(out.includes("2M / 2M · sin presupuesto"));
  assert.ok(out.includes('data-plumbing="stop"'));
  assert.ok(out.includes('data-state="no_budget"'));
});

test("I33-4 state presupuesto al 80 % y al 100 %: the plumbing line turns amber, then red", () => {
  assert.ok(card(orgProject("a", "A", { budget: budget(1_640_000, 2_000_000) })).includes('data-plumbing="warn"'));
  assert.ok(card(orgProject("b", "B", { budget: budget(2_000_000, 2_000_000) })).includes('data-plumbing="stop"'));
  assert.ok(card(orgProject("c", "C", { budget: budget(400_000, 2_000_000) })).includes('data-plumbing="ok"'));
  assert.equal(lib.plumbingLine({ spend: 4_800_000, limit: 6_000_000, running: 1, paused: false }).tone, "warn");
  assert.equal(lib.plumbingLine({ spend: 6_000_000, limit: 6_000_000, running: 1, paused: false }).tone, "stop");
});

test("I33-4 state rol quieto: a role that has not run in days reads quieto desde hace N días", () => {
  const out = card(orgProject("filmia", "Filmia", { light: "quiet", team: team("filmia", { research: { last: { ticket: "FIL-1", status: "Done", at: "2026-11-05T15:00:00Z" } } }) }));
  assert.ok(out.includes("quieto desde hace 3 días"));
  assert.equal(count(out, /data-still="1"/g), 1);
  assert.ok(out.includes("Quieto"));
});

test("I33-4 state esperando a Jorge: Te necesita on the card, the message with buttons ringed in the thread", () => {
  const out = card(SIX[0]!);
  assert.ok(out.includes("Te necesita"));
  assert.ok(out.includes("espera: que aceptes"));
  const thread = html(h(org.ThreadPanel, threadProps()));
  assert.equal(count(thread, /data-waiting="1"/g), 3);
  assert.ok(thread.includes("ring-status-jorge/60"));
});

test("I33-4 state PR fusionado and pregunta respondida: the result replaces the buttons", () => {
  const merged = html(h(org.MessageRow, { message: asistenteThread.messages[5], project: null, busy: null, onAction: noop }));
  assert.ok(merged.includes("Fusionado a sandbox · 1abb07d"));
  assert.equal(count(merged, /data-action=/g), 0);
  const answered = html(h(org.MessageRow, { message: asistenteThread.messages[6], project: null, busy: null, onAction: noop }));
  assert.ok(answered.includes("Respondido"));
  assert.equal(count(answered, /data-action=/g), 0);
  assert.equal(lib.actionStateText({ action: "cambios", at: "x", result: "el PO despierta" }), "Cambios pedidos · el PO despierta");
});

test("I33-4 phone: the pages keep one column under 640 px and nothing sets a width wider than a phone", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (p: string) => readFileSync(new URL(`../ui/src/${p}`, import.meta.url), "utf8");
  const ceo = read("pages/ceo.tsx");
  assert.ok(ceo.includes("lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]"), "two columns from lg only");
  const files = ["pages/ceo.tsx", "components/compania/org.tsx", "components/compania/plumbing.tsx"].map(read).join("\n");
  assert.equal(/(?:^|[\s"\'`])(?:min-)?w-\[\d{3,}px\]/m.test(files), false, "no fixed width of 100 px or more without a breakpoint");
  assert.ok(html(h(org.TeamCards, { projects: SIX, now: NOW, onNew: noop })).includes("md:grid-cols-2"));
});
