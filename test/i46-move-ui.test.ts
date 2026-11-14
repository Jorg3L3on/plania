// PLA-I46-3: la siguiente jugada. One object per floor (src/api/company-move.ts) and every surface that reads it:
// Ahora, the Tú window, the roof chip, the sky line and the phone bar. Rendered with react-dom/server and fake data;
// no browser, no database. Fake names only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { nextMove } from "../src/api/company-move.js";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const building = await load("components/compania/edificio/building.tsx");

type Json = Record<string, any>;
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const NOW = new Date("2026-11-13T20:44:00Z").getTime();
const TZ = "America/Mexico_City";
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const unq = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const member = (role: string, patch: Json = {}): Json => ({ agent: `${role}-mia`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, queue: [], next_start: null, ...patch });
const legs = (hereDone: number) => ({
  legs: [
    { key: "MIA-I1", title: "Arranque y configuración", done: 4, total: 5, state: "planned", note: "Pospuesto: Hosting, dominio y despliegue" },
    { key: "MIA-I4", title: "Contacto, exportación y avisos", done: hereDone, total: 4, state: "here", note: null, steps: [] },
    { key: "MIA-I5", title: "Ajustes finales y entrega", done: 0, total: 0, state: "unplanned", note: null },
  ],
  more_legs: 0,
});
const project = (patch: Json = {}): Json => ({
  slug: "mia",
  title: "Mianovia",
  paused: false,
  light: "ok",
  light_reason: null,
  goal: "Registro listo para la boutique",
  rumbo: { goal_id: "g", goal: "Registro listo para la boutique", why: "", target_on: null, forecast_on: null, weeks_behind: null, missing: true },
  usage: { used: 541_000, last_week: 1_250_000 },
  team: ["product-owner", "research", "artist", "taller"].map((r) => member(r)),
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  route: legs(4),
  latest: [],
  stale_requests: [],
  this_week: { done: 3, docs: 0, prs: 0, last_at: null },
  next: null,
  ready: [],
  work: { open: 1, in_progress: 0 },
  orders: [],
  ...patch,
});
const delivery = (patch: Json = {}): Json => ({
  id: "pr-4",
  project: "mia",
  title: "Avisos al equipo",
  kind: "pr",
  options: null,
  actions: ["aceptar", "cambios"],
  state: null,
  at: "2026-11-13T19:00:00Z",
  ref: null,
  detail: null,
  links: [],
  body: null,
  checks: null,
  release: null,
  hold: null,
  asker: { agent: "taller-mia", role: "taller" },
  ...patch,
});

// The four floor states the ticket names.
const STATES: Record<string, { p: Json; ds: Json[] }> = {
  "plan next initiative": { p: project(), ds: [] },
  "accept a delivery": { p: project({ route: legs(3) }), ds: [delivery()] },
  "returned to Taller": {
    p: project({ route: legs(3), team: [member("product-owner"), member("taller", { queue: [{ key: "MIA-I4-4", title: "Avisos al equipo" }], next_start: { key: "MIA-I4-4", title: "Avisos al equipo", hold: "soon", starts_at: null, text: "Arranca en un momento." } })] }),
    ds: [delivery({ actions: [], state: { action: "cambios", at: "2026-11-13T20:30:00Z", result: {} } })],
  },
  "nothing pending": { p: project({ route: legs(2), team: [member("product-owner"), member("taller", { state: "running", now: { ticket: "MIA-I4-3", title: "Exportar a Excel", since: "2026-11-13T20:30:00Z", run_id: "r" } })] }), ds: [] },
};
const EXPECTED: Record<string, { verbo: string; texto: string; label: string; kind: string } | null> = {
  "plan next initiative": { verbo: "planear", texto: "Planear «Ajustes finales y entrega»", label: "Que PO lo planee", kind: "plan" },
  "accept a delivery": { verbo: "aceptar", texto: "Aceptar «Avisos al equipo»", label: "Aceptar", kind: "decision" },
  "returned to Taller": null,
  "nothing pending": null,
};

const company = (p: Json, ds: Json[]): Json => ({
  company: { paused: false },
  week: { starts_at: "2026-11-09T06:00:00Z", resets_at: "2026-11-16T06:00:00Z", timezone: TZ },
  asistente: { thread_id: "t-co", usage: { used: 0 }, last_run: null, state: "idle", unread: 0 },
  projects: [{ ...p, next_move: nextMove(p as never, ds as never) }],
  plumbing: { spend: 541_000, running: 0, paused: false },
  decisions: ds,
  inbox: { decisiones: 0, pasos: 0 },
});
const render = (c: Json) =>
  html(
    h(building.Building, {
      company: c,
      decisions: c.decisions,
      now: NOW,
      timeZone: TZ,
      hello: "Buenas noches",
      day: "Viernes 13 de noviembre",
      onNew: noop,
      onFijar: noop,
      onPublish: noop,
      acts: { now: NOW, busy: null, onAct: noop },
      nowActs: { onStart: noop, onPlan: noop },
      askFor: () => h("div", { "data-ask-open": "mia" }, "Pedir"),
    }),
  );
// A green button: the class edi-go (not edi-goal), a data-move mark, or a breathing card.
const GREEN = /edi-go[" ]|data-move="1"|data-breathe/;
const pick = (s: string, re: RegExp) => unq(text(re.exec(s)?.[1] ?? ""));
const buttons = (s: string) => [...s.matchAll(/<(?:button|a)[^>]*class="edi-nact edi-go[^"]*"[^>]*data-now-action="([a-z]+)" data-where="([a-z]+)"[^>]*>([^<]*)</g)].map((m) => ({ kind: m[1], where: m[2], label: m[3] }));

test("I46-3 #4: the move for each state: plan next initiative, accept a delivery, returned to Taller, nothing pending", () => {
  for (const [name, { p, ds }] of Object.entries(STATES)) {
    const m = nextMove(p as never, ds as never);
    const want = EXPECTED[name];
    if (!want) {
      assert.equal(m, null, name);
      continue;
    }
    assert.ok(m, name);
    assert.deepEqual([m!.verbo, m!.texto, m!.accion.label, m!.accion.kind], [want.verbo, want.texto, want.label, want.kind], name);
  }
  // The origin says where it came from.
  assert.deepEqual(nextMove(STATES["plan next initiative"]!.p as never, [])!.origen, { kind: "route", leg: "MIA-I5" });
  assert.deepEqual(nextMove(STATES["accept a delivery"]!.p as never, STATES["accept a delivery"]!.ds as never)!.origen, { kind: "decision", id: "pr-4", decision: "pr" });
  // Paused floors and a paused company have no move; a release is the last move, after any delivery.
  assert.equal(nextMove(project({ paused: true, light: "paused" }) as never, [delivery()] as never), null);
  assert.equal(nextMove(project() as never, [delivery()] as never, { companyPaused: true }), null);
  const release = delivery({ id: "release:mia", kind: "release", actions: [], asker: null, release: { tickets: [{ key: "a", title: "a" }] }, at: "2026-11-13T18:00:00Z" });
  assert.equal(nextMove(project() as never, [release, delivery()] as never)!.texto, "Aceptar «Avisos al equipo»");
  assert.deepEqual(nextMove(project() as never, [release] as never)!.accion, { kind: "publish", label: "Publicar" });
  // While the PO already plans (it runs, or has the order in its queue), planning is not the owner's move.
  assert.equal(nextMove(project({ team: [member("product-owner", { state: "running" })] }) as never, []), null);
  assert.equal(nextMove(project({ team: [member("product-owner", { queue: [{ key: "MIA-20", title: "Planea" }] })] }) as never, []), null);
});

test("I46-3 #1: Ahora, Tú, the roof, the sky and the phone bar say the same sentence with the same button", () => {
  for (const [name, { p, ds }] of Object.entries(STATES)) {
    const want = EXPECTED[name];
    if (!want) continue;
    const out = render(company(p, ds));
    const ahora = pick(out, /data-now-say="true">([^<]*)</);
    const tu = pick(out, /class="edi-win edi-you"[\s\S]*?data-doing="true">([^<]*)</);
    const chip = pick(out, /class="edi-chip"[^>]*data-chip-move="1"[^>]*>([^<]*)</);
    const bar = pick(out, /data-pbar-say="true">([^<]*)</);
    const sky = pick(out, /data-voice="true">([^<]*)</);
    assert.equal(ahora, want.texto, `${name}: Ahora`);
    assert.equal(tu, want.texto, `${name}: Tú`);
    assert.equal(chip, `Mianovia: ${want.texto}`, `${name}: roof`);
    assert.equal(bar, want.texto, `${name}: phone bar`);
    assert.equal(sky, `Te toca: ${want.texto}.`, `${name}: sky`);
    // The same button, in green, on the three surfaces that carry one.
    const b = buttons(out);
    assert.deepEqual(b.map((x) => x.where).sort(), ["ahora", "barra", "tu"], name);
    for (const x of b) assert.deepEqual([x.kind, x.label], [want.kind, want.label], `${name}: ${x.where}`);
    assert.match(out, /class="edi-win edi-you" data-state="you"/, `${name}: Tú takes the orange`);
    assert.match(out, /data-te-toca="1"/);
  }
});

test("I46-3 #2: with no next move, no green button is drawn anywhere on the floor", () => {
  for (const name of ["returned to Taller", "nothing pending"]) {
    const { p, ds } = STATES[name]!;
    const out = render(company(p, ds));
    assert.equal(GREEN.test(out), false, name);
    assert.match(out, /class="edi-win edi-you" data-state="idle"/, name);
    assert.ok(text(out).includes("Nada por ahora"), name);
    assert.equal(pick(out, /data-pbar-say="true">([^<]*)</), "Nada te toca ahora", name);
    assert.match(out, /data-te-toca="0"/, name);
    assert.ok(pick(out, /data-voice="true">([^<]*)</).endsWith("Nada te espera."), name);
  }
  // A resting teammate's «Que empiece ya» stays, as an outline button: it is never the owner's turn.
  const resting = project({ route: legs(2), team: [member("taller", { next_start: { key: "MIA-I4-3", title: "Exportar", hold: "rest", starts_at: "2026-11-13T20:52:00Z", text: "Descansa." } })] });
  const out = render(company(resting, []));
  assert.match(out, /<button type="button" class="edi-btn" data-now-action="start" data-where="ahora"/);
  assert.equal(GREEN.test(out), false);
});

test("I46-3 #3: only the Ahora card breathes (2.4 s), the Tú window is still, nothing moves with reduce-motion", () => {
  const { p, ds } = STATES["accept a delivery"]!;
  const out = render(company(p, ds));
  assert.equal((out.match(/data-breathe="1"/g) ?? []).length, 1);
  assert.match(out, /class="edi-nowb" data-now="you"[^>]*data-breathe="1"/);
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  const start = css.indexOf("/* PLA-I39: the building");
  const edi = css.slice(start, css.indexOf("@keyframes edi-twinkle", start));
  assert.deepEqual([...edi.matchAll(/^\s*(\.[^{]+)\{[^}]*animation:/gm)].map((m) => m[1]!.trim()), [".edi-nowb[data-breathe]"]);
  assert.match(edi, /animation: edi-breathe 2\.4s ease-in-out infinite/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.edi \*, \.edi \*::before, \.edi \*::after \{ animation: none !important; transition: none !important; \}/);
  // Green is #8fe0a4 with dark text; the stars and the antenna no longer blink.
  assert.match(css, /\.edi \.edi-go \{ background: #8fe0a4; color: #10131f;/);
  assert.equal(/\.edi-star \{[^}]*animation/.test(css) || /\.edi-antenna::after \{[^}]*animation/.test(css), false);
});

test("I46-3: at 390 the bar carries the main button and Pedir; Ahora and Tú hide theirs", () => {
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("@media (width < 40rem) {\n    .edi-pbar"));
  assert.match(phone, /\.edi-pbar \{ position: fixed;[^}]*display: grid;/);
  assert.match(phone, /\.edi-nowb \.edi-go\[data-move\], \.edi-tu-go \{ display: none !important; \}/);
  assert.match(css, /\.edi-pbar \{ display: none; \}/, "hidden on a laptop");
  const { p, ds } = STATES["accept a delivery"]!;
  const out = render(company(p, ds));
  assert.match(out, /data-pbar="mia"[\s\S]*data-where="barra"[\s\S]*data-control="barra-pedir"[^>]*>Pedir</);
  // Pedir in the bar opens the plate's own side page (one box, one draft).
  const src = readFileSync(new URL("../ui/src/components/compania/edificio/building.tsx", import.meta.url), "utf8");
  assert.ok(src.includes('[data-control="pedir-abrir"]'));
});
