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
