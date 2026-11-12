// PLA-I36 phase 1 on screen, rendered with fake data (react-dom/server; no browser, no database).
// The light's reason under the name (PLA-I36-1), Te toca's steps, releases and evidence (PLA-I36-2), Tus órdenes
// (PLA-I36-3). Fake names and numbers only.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const v2 = await load("components/compania/v2.tsx");
const lib = await load("lib/v2.ts");
const org = await load("lib/org.ts");

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const NOW = new Date("2026-11-10T18:00:00Z").getTime();
const clean = (s: string) => {
  assert.equal(/\bnull\b|\bundefined\b|NaN|\[object Object\]/.test(s), false, "never a null key");
  assert.equal(/\$|USD/.test(s), false, "tokens, never money");
};

const member = (role: string, patch: Record<string, unknown> = {}) => ({ agent: `${role}-x`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, ...patch });
const project = (patch: Record<string, unknown> = {}) => ({
  slug: "workia",
  title: "Workia",
  paused: false,
  light: "ok",
  light_reason: null,
  goal: null,
  budget: { used: 100_000, limit: 5_000_000, pct: 2, state: "ok", reason: null },
  team: ["product-owner", "research", "artist", "taller"].map((r) => member(r)),
  thread: { id: "t-workia", unread: 0, last: null },
  plan: null,
  this_week: { done: 1, docs: 0, prs: 0, last_at: "2026-11-10T17:00:00Z" },
  next: null,
  work: { open: 2, in_progress: 0 },
  orders: [],
  ...patch,
});
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
// PLA-I39: the reason sits on the floor's plate; each decision renders with Te toca's body under its asker.
const plate = await load("components/compania/edificio/plate.tsx");
const card = (p: Record<string, unknown>) => html(h(plate.Plate, { project: p }));
const teToca = (decisions: Record<string, unknown>[], opened?: string) =>
  html(h("ul", null, ...decisions.map((d) => h("li", { key: d.id as string, "data-kind": d.kind }, h(v2.DecisionBody, { d, now: NOW, busy: null, onAct: noop, opened: opened === d.id })))));
const row = (patch: Record<string, unknown>) => ({
  id: "b-00000000-0000-4000-8000-000000000001",
  project: "workia",
  title: "Crear la cuenta de la tienda",
  kind: "step",
  options: null,
  actions: ["hecho"],
  state: null,
  at: "2026-11-10T12:00:00Z",
  ref: "WRK-4",
  detail: null,
  links: [],
  body: null,
  checks: null,
  release: null,
  ...patch,
});

// ---- PLA-I36-1

test("I36-1 #1: Te necesita shows its reason and points to the question on the floor", () => {
  const out = card(project({ light: "needs_jorge", light_reason: { text: "Lo siguiente es tuyo: «Kickoff con la boutique».", action: { label: "Ver en Te toca", href: "#te-toca" } } }));
  assert.ok(out.includes("Lo siguiente es tuyo: «Kickoff con la boutique».") && out.includes('href="#pregunta-workia"') && out.includes("Ver la pregunta"));
  clean(out);
});

test("I36-1 #2: Falló shows the reason, a link to Máquina, and Ahora says the run failed", () => {
  const out = card(
    project({
      light: "failed",
      light_reason: { text: "La última corrida del PO falló: spawn claude ENOENT", action: { label: "Ver en Máquina", href: "/machine" } },
      team: [member("product-owner", { last: { ticket: "WRK-3", status: "fail", at: "2026-11-10T17:30:00Z" } }), member("taller")],
    }),
  );
  assert.ok(out.includes("spawn claude ENOENT"));
  assert.ok(/<a[^>]*href="\/machine"[^>]*>|<a[^>]*data-light-action[^>]*href="\/machine"/.test(out) && out.includes("Ver en Máquina"));
  assert.equal(org.lightOf("failed").tone, "stop");
  clean(out);
});

test("I36-1 #3: Bloqueado shows the blocking reason in one sentence", () => {
  const out = card(project({ light: "blocked", light_reason: { text: "Las pruebas de «Galería» fallaron.", action: { label: "Abrir", href: "/p/workia" } } }));
  assert.ok(out.includes("Las pruebas de «Galería» fallaron."));
  assert.equal(count(out, /data-light-reason/g), 1);
  clean(out);
});

test("I36-1 #4: Bien has no reason line; the worst light sorts first", () => {
  const out = card(project());
  assert.equal(out.includes("data-light-reason"), false);
  const sorted = [project({ slug: "a", light: "ok" }), project({ slug: "b", light: "late" }), project({ slug: "c", light: "failed" }), project({ slug: "d", light: "needs_jorge" })].sort(org.byLight);
  assert.deepEqual(sorted.map((p) => p.light), ["needs_jorge", "failed", "late", "ok"]);
});

// ---- PLA-I36-2

test("I36-2 #2: a step row has Hecho and names the ticket it holds", () => {
  const out = teToca([row({ detail: "Lo espera: Publicar la tienda" })]);
  assert.ok(out.includes('data-kind="step"') && out.includes("Crear la cuenta de la tienda") && out.includes("Lo espera: Publicar la tienda"));
  assert.ok(out.includes('data-action="hecho"'));
  clean(out);
});

test("I36-2 #1: a release row shows commits, changes, open checks and goes to Bandeja to publish", () => {
  const out = teToca([
    row({
      id: "r-workia",
      kind: "release",
      title: "2 cambios listos para publicar",
      actions: [],
      ref: null,
      checks: { open: 1, ci: null },
      release: { from: "sandbox", into: "main", env: "prod", ahead: 4, tickets: [{ key: "WRK-1", title: "Uno" }, { key: "WRK-2", title: "Dos" }], open_checks: 1, before: 0 },
    }),
  ]);
  assert.ok(out.includes("4 commits · 2 cambios · 1 check abierto"));
  assert.ok(/data-action="publicar"[^>]*>Publicar en Bandeja|href="\/inbox"[^>]*data-action="publicar"/.test(out));
  clean(out);
});

test("I36-2 #3: Nada te espera only when Bandeja is empty too", () => {
  assert.equal(lib.teTocaEmpty({ decisiones: 0, pasos: 0 }), lib.TE_TOCA_EMPTY);
  assert.equal(lib.teTocaEmpty({ decisiones: 1, pasos: 1 }), "Nada urgente aquí · 2 cosas te esperan en Bandeja.");
  assert.equal(lib.teTocaEmpty(undefined), lib.TE_TOCA_EMPTY);
});

test("I36-2 #4: a proposal row has Ver mensaje and its doc link; the message opens in place", () => {
  const body = "Leí el borrador.\nTres caminos:\n1. Corto\n2. Largo";
  const d = row({
    id: "m-00000000-0000-4000-8000-000000000009",
    kind: "proposal",
    title: "Tres caminos",
    options: [
      { n: 1, label: "Corto", recommended: true },
      { n: 2, label: "Largo", recommended: false },
    ],
    actions: ["elegir", "responder"],
    ref: null,
    body,
    links: [{ kind: "doc", ref: "d0c00000-0000-4000-8000-000000000001", title: "Campos y flujos" }],
  });
  const out = teToca([d]);
  assert.ok(out.includes('data-control="ver-mensaje"') && out.includes("Ver mensaje"));
  assert.ok(out.includes('href="/ceo?doc=d0c00000-0000-4000-8000-000000000001"') && out.includes("Campos y flujos"));
  assert.equal(out.includes("data-body"), false, "folded until opened");
  // Opened (?decision=<id>): the full message in place.
  const opened = teToca([d], d.id);
  assert.ok(opened.includes("data-body") && opened.includes("Tres caminos:\n1. Corto") && opened.includes("Ocultar mensaje"));
  clean(out);
});

test("I36-2 #5: a PR row shows its link and open checks before Fusionar", () => {
  const out = teToca([
    row({
      id: "m-00000000-0000-4000-8000-000000000010",
      kind: "pr",
      title: "Galería",
      actions: ["fusionar", "cambios"],
      checks: { open: 1, ci: "failure" },
      links: [
        { kind: "ticket", ref: "WRK-9", title: "Galería" },
        { kind: "pr", ref: "https://github.com/x/w/pull/9", title: "PR de WRK-9" },
      ],
    }),
  ]);
  assert.ok(out.includes('data-checks="open"') && out.includes("1 check abierto · pruebas fallando"));
  assert.ok(out.includes('href="https://github.com/x/w/pull/9"'));
  assert.ok(out.indexOf("data-checks") < out.indexOf('data-action="fusionar"'), "checks before Fusionar");
  assert.deepEqual(lib.checksText({ checks: { open: 0, ci: "success" } }), { text: "pruebas en verde", tone: "ok", open: false });
});

// ---- PLA-I36-3

const order = (patch: Record<string, unknown>) => ({ id: "t-1", kind: "order", title: "Agrega un botón de WhatsApp", at: "2026-11-10T16:00:00Z", state: "enviada", understood: null, who: null, link: null, age_h: null, ...patch });

test("I36-3 #1-#4: each order's state reads in words; sin tomar is amber with its age (the plan's side page lists them)", () => {
  assert.equal(lib.orderText(order({ state: "sin_tomar", age_h: 30 }), NOW).tone, "warn");
  assert.ok(lib.orderText(order({ state: "sin_tomar", age_h: 30 }), NOW).text.includes("sin tomar · 30 h"));
  assert.ok(lib.orderText(order({ state: "en_curso", who: "taller" }), NOW).text.includes("en curso · Taller"));
});
