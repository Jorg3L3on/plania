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
const card = (p: Record<string, unknown>, decisions: unknown[] = []) => html(h(v2.ProjectReport, { project: p, decisions, now: NOW, companyPaused: false, timeZone: "America/Mexico_City" }));
const teToca = (decisions: unknown[], inbox?: unknown) => html(h(v2.TeToca, { decisions, inbox, titles: { workia: "Workia" }, now: NOW, busy: null, onAct: noop }));
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

test("I36-1 #1: Te necesita shows its reason and Ver en Te toca", () => {
  const out = card(project({ light: "needs_jorge", light_reason: { text: "Lo siguiente es tuyo: «Kickoff con la boutique».", action: { label: "Ver en Te toca", href: "#te-toca" } } }));
  assert.match(out, /data-light="needs_jorge"/);
  assert.ok(out.includes("Te necesita"));
  assert.ok(out.includes("Lo siguiente es tuyo: «Kickoff con la boutique».") && out.includes('href="#te-toca"'));
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
  assert.ok(out.includes("Falló") && out.includes("spawn claude ENOENT"));
  assert.ok(/<a[^>]*href="\/machine"[^>]*>|<a[^>]*data-light-action[^>]*href="\/machine"/.test(out) && out.includes("Ver en Máquina"));
  assert.ok(out.includes("su última corrida falló"), "Ahora has words for a failed run");
  assert.equal(org.lightOf("failed").tone, "stop");
  clean(out);
});

test("I36-1 #3: Bloqueado shows the blocking reason in one sentence", () => {
  const out = card(project({ light: "blocked", light_reason: { text: "Las pruebas de «Galería» fallaron.", action: { label: "Abrir", href: "/p/workia" } } }));
  assert.ok(out.includes("Bloqueado") && out.includes("Las pruebas de «Galería» fallaron."));
  assert.equal(count(out, /data-light-reason/g), 1);
  clean(out);
});

test("I36-1 #4: Bien has no reason line; the worst light sorts first", () => {
  const out = card(project());
  assert.ok(out.includes("Bien"));
  assert.equal(out.includes("data-light-reason"), false);
  const sorted = [project({ slug: "a", light: "ok" }), project({ slug: "b", light: "late" }), project({ slug: "c", light: "failed" }), project({ slug: "d", light: "needs_jorge" })].sort(org.byLight);
  assert.deepEqual(sorted.map((p) => p.light), ["needs_jorge", "failed", "late", "ok"]);
});

test("I36-1 #5: phone at 390: the reason wraps (break-words, no truncate) and its action never splits", () => {
  const long = "La última corrida del PO falló: " + "una razón muy larga sin espacios-".repeat(6);
  const out = card(project({ light: "failed", light_reason: { text: long, action: { label: "Ver en Máquina", href: "/machine" } } }));
  const line = /<p class="([^"]*)" data-light-reason/.exec(out)![1]!;
  assert.ok(line.includes("break-words") && line.includes("min-w-0"), line);
  assert.equal(line.includes("truncate"), false);
  assert.ok(/class="[^"]*whitespace-nowrap[^"]*"[^>]*data-light-action/.test(out));
});

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

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
  assert.match(out, /data-te-toca="1"/, "a release still waits on Jorge");
  clean(out);
});

test("I36-2 #3: Nada te espera only when Bandeja is empty too", () => {
  assert.ok(teToca([], { decisiones: 0, pasos: 0 }).includes("Nada te espera"));
  const out = teToca([], { decisiones: 1, pasos: 1 });
  assert.equal(out.includes("Nada te espera"), false);
  assert.ok(out.includes("Nada urgente aquí · 2 cosas te esperan en Bandeja."));
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
  const opened = html(h(v2.TeToca, { decisions: [d], titles: { workia: "Workia" }, now: NOW, busy: null, onAct: noop, open: d.id }));
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

test("I36-3 #1-#4: Tus órdenes lists each with its state; entregada links what came out; sin tomar is amber with its age", () => {
  const out = card(
    project({
      orders: [
        order({ id: "t-1" }),
        order({ id: "t-2", title: "Cambia el logo", state: "entendida", understood: "logo nuevo en el encabezado" }),
        order({ id: "t-3", title: "Galería", state: "en_curso", who: "taller" }),
        order({ id: "t-4", title: "Formulario", state: "entregada", link: { kind: "pr", ref: "https://github.com/x/w/pull/3", title: "PR" } }),
        order({ id: "m-5", kind: "choice", title: "Elegiste 1: Formulario corto", state: "sin_tomar", age_h: 30 }),
      ],
    }),
  );
  assert.ok(out.includes("Tus pedidos") && out.includes('data-orders="5"'));
  assert.ok(out.includes("enviada · hace"));
  assert.ok(out.includes("El PO entendió: logo nuevo en el encabezado"));
  assert.ok(out.includes("en curso · Taller"));
  assert.ok(out.includes('href="https://github.com/x/w/pull/3"') && out.includes("Ver lo que salió"));
  assert.ok(/data-order="sin_tomar"[\s\S]*text-ink-warn[\s\S]*sin tomar · 30 h/.test(out) || out.includes("sin tomar · 30 h"));
  assert.deepEqual(lib.orderText(order({ state: "sin_tomar", age_h: 30 }), NOW).tone, "warn");
  assert.ok(out.includes('data-order-kind="choice"'));
  clean(out);
});

test("I36-3: no orders, no block", () => {
  assert.equal(card(project()).includes("Tus pedidos"), false);
});
