// PLA-I71: Equipo de verdad on the screen, without a browser. Step 1: the org chart from reports_to (owner root, PO,
// seats; a seat with no valid manager listed apart), the order the arrow keys walk, the layout at 1440/1280 widths
// with 2, 5 and 8 seats, the rendered chart (a nested list, no task, queue, delivery or run text), and the levers on
// the work reachable from the work pages (Dile algo, Reanudar corrida on the step; Que empiece ya in Motores; Detener
// stays the step's own lever). Clicks, axe and the measured fit run in the browser pass, recorded in Plania.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const org = await load("lib/organigrama.ts");
const equipo = await load("components/corriente/equipo.tsx");
const trabajo = await load("components/corriente/trabajo.tsx");
const motores = await load("components/corriente/motores.tsx");
const etapas = await load("lib/etapas.ts");
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, { initialEntries: ["/ceo"] }, el)));

type M = Record<string, any>;
const seat = (agent: string, role: string, reports_to: string | null, over: M = {}): M => ({
  agent,
  role,
  template: role,
  state: "idle",
  now: null,
  last: null,
  produced: null,
  waiting: null,
  queue: [],
  next_start: null,
  packs: [],
  skills_on: 3,
  motor: { model: "opus", effort: "medium", own_model: true, own_effort: false },
  consulta_motor: null,
  used_week: null,
  name: `${role} Tienda`,
  reports_to,
  lessons: { active: 2, proposed: 0 },
  ...over,
});
const core = () => [seat("po-t", "product-owner", "ceo"), seat("research-t", "research", "po-t"), seat("artist-t", "artist", "po-t"), seat("taller-t", "taller", "po-t")];
const extra = ["qa", "copy", "seguridad", "marketing", "data"];
const teamOf = (n: number) => [...core(), ...extra.map((r) => seat(`${r}-t`, r, "po-t"))].slice(0, n);
const links = { member: (a: string) => `/m/${a}`, equipo: "/eq", motor: "/mot", sumar: "/sumar", oficio: (a: string) => `/of/${a}`, work: "/todo" };
const project = (team: M[], over: M = {}) => ({ slug: "tienda", title: "Tienda", paused: false, team, tablero: null, ...over });

test("I71-1 #2: the tree hangs the PO from the owner and the seats from their manager", () => {
  const t = org.treeOf(core());
  assert.deepEqual(
    t.top.map((n: M) => n.m.agent),
    ["po-t"],
  );
  assert.deepEqual(
    t.top[0].children.map((n: M) => n.m.agent),
    ["research-t", "artist-t", "taller-t"],
  );
  assert.equal(t.loose.length, 0);
  // A seat that reports to a teammate below the PO hangs from it.
  const deep = org.treeOf([...core(), seat("qa-t", "qa", "taller-t")]);
  assert.deepEqual(deep.top[0].children[2].children.map((n: M) => n.m.agent), ["qa-t"]);
  // Reporting to nobody is the owner's too.
  assert.deepEqual(org.treeOf([seat("po-t", "product-owner", null)]).top.map((n: M) => n.m.agent), ["po-t"]);
});

test("I71-1 #2: a seat with no valid manager is listed apart with a warning, never dropped (gone manager or a loop)", () => {
  const gone = org.treeOf([...core(), seat("qa-t", "qa", "taller-retirado")]);
  assert.deepEqual(gone.loose.map((n: M) => n.m.agent), ["qa-t"]);
  const loop = org.treeOf([seat("po-t", "product-owner", "ceo"), seat("a-t", "research", "b-t"), seat("b-t", "artist", "a-t")]);
  assert.deepEqual(loop.loose.map((n: M) => n.m.agent).sort(), ["a-t", "b-t"]);
  const out = html(h(equipo.Equipo, { p: project([...core(), seat("qa-t", "qa", "nadie")]), companyPaused: false, focus: null, links }));
  assert.match(out, /Sin jefe en el equipo/);
  assert.match(out, /data-org="qa-t"/);
});

test("I71-1 #4: the arrow keys walk the tree; Home and End jump to the first and last card", () => {
  const t = org.treeOf([...core(), seat("qa-t", "qa", "taller-t")]);
  assert.deepEqual(org.walkOrder(t), ["po-t", "research-t", "artist-t", "taller-t", "qa-t"]);
  assert.equal(org.moveFrom(t, "po-t", "ArrowDown"), "research-t");
  assert.equal(org.moveFrom(t, "research-t", "ArrowUp"), "po-t");
  assert.equal(org.moveFrom(t, "po-t", "ArrowRight"), "research-t");
  assert.equal(org.moveFrom(t, "qa-t", "ArrowLeft"), "taller-t");
  assert.equal(org.moveFrom(t, "taller-t", "ArrowLeft"), "po-t");
  assert.equal(org.moveFrom(t, "po-t", "ArrowLeft"), "po-t");
  assert.equal(org.moveFrom(t, "artist-t", "Home"), "po-t");
  assert.equal(org.moveFrom(t, "artist-t", "End"), "qa-t");
  assert.equal(org.moveFrom(t, "artist-t", "x"), null);
});

test("I71-1 #5: the layout keeps every card inside the chart's width, none overlapping, with 2, 5 and 8 seats", () => {
  // The chart's width at 1440 and 1280 with the 360 px panel beside it (page padding and gaps taken off), and the
  // height left under the headline: about 480 and 400 px.
  for (const [width, room] of [[992, 480], [832, 400]] as const) {
    for (const n of [2, 5, 8, 9]) {
      // 9: eight seats plus one under Taller (the stack).
      const team = n === 9 ? [...teamOf(7), seat("qa2-t", "qa", "taller-t")] : teamOf(n);
      const lay = org.layoutOf(org.treeOf(team), width, { maxH: room });
      const boxes = [...lay.boxes.values()] as { id: string; x: number; y: number; w: number; h: number }[];
      assert.equal(boxes.filter((b) => !b.id.startsWith("__")).length, n === 9 ? 8 : n, `${n} seats at ${width}`);
      for (const b of boxes) assert.ok(b.x >= 0 && b.x + b.w <= width + 0.5, `${b.id} inside ${width}`);
      for (const a of boxes)
        for (const b of boxes) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} and ${b.id} overlap at ${width}/${n}`);
      assert.ok(lay.height <= room, `${n} seats fit at ${width}: ${lay.height}`);
      // No line runs through a card: vertical segments only cross gaps (a card's own top edge is where its line ends).
      for (const l of lay.lines as { d: string }[]) {
        const m = /^M([\d.-]+) ([\d.-]+)V([\d.-]+)$/.exec(l.d);
        if (!m) continue;
        const [x, y1, y2] = [Number(m[1]), Math.min(Number(m[2]), Number(m[3])), Math.max(Number(m[2]), Number(m[3]))];
        for (const b of boxes) assert.ok(!(x > b.x + 1 && x < b.x + b.w - 1 && y1 < b.y + b.h - 1 && y2 > b.y + 1), `line ${l.d} crosses ${b.id} at ${width}/${n}`);
      }
    }
  }
});

test("I71-1 #2 #4: Equipo renders one nested list with the owner at the root; no task, queue, delivery or run text", () => {
  const busy = core().map((m) =>
    m.role === "taller"
      ? { ...m, state: "running", now: { ticket: "TND-42", title: "Arreglar el carrito", since: "2026-11-20T10:00:00Z", run_id: "r1" }, queue: [{ key: "TND-43", title: "Pagar con tarjeta" }], produced: { kind: "pr", ref: "7", title: "PR del carrito" }, last: { ticket: "TND-41", title: "Lo anterior", status: "stopped", at: "2026-11-20T09:00:00Z", run_id: "r0" } }
      : m,
  );
  const out = html(h(equipo.Equipo, { p: project(busy), companyPaused: false, focus: "taller-t", links }));
  for (const gone of ["TND-42", "TND-43", "TND-41", "Arreglar el carrito", "Pagar con tarjeta", "PR del carrito", "Lo anterior", "En fila", "Lo último que entregó", "Su última corrida", "Detener", "Reanudar corrida", "Dile algo", "Que empiece ya"]) assert.ok(!out.includes(gone), `no «${gone}» in Equipo`);
  assert.match(out, /Cuatro agentes en Tienda\./);
  // Owner → PO → the three seats, as nested lists.
  assert.match(out, /<ul class="org-ul org-root" aria-label="Organigrama de Tienda"><li class="org-li"><div class="org-card owner"[^]*?<ul class="org-ul"><li class="org-li"><button[^>]*data-org="po-t"[^]*?<ul class="org-ul"><li class="org-li"><button[^>]*data-org="research-t"/);
  // One card is in the tab order (the selected one); the rest are reached with the arrows.
  assert.equal(out.match(/tabindex="0"/g)?.length, 1);
  assert.match(out, /aria-pressed="true"[^>]*data-org="taller-t"/);
  assert.match(out, /<span class="sr-only">Trabajando<\/span>/);
  // The selected seat's card: who it reports to, who reports to it, and the door to its page.
  assert.match(out, /data-ficha="taller-t"/);
  assert.match(out, /href="\/of\/taller-t"/);
});

test("I71-1: an empty team says so and offers Sumar; nothing selected asks to pick someone", () => {
  const out = html(h(equipo.Equipo, { p: project([]), companyPaused: false, focus: null, links }));
  assert.match(out, /Este proyecto todavía no tiene equipo\./);
  assert.match(out, /href="\/sumar"/);
  assert.match(html(h(equipo.Equipo, { p: project(core()), companyPaused: false, focus: null, links })), /Elige a alguien del organigrama/);
});

test("I71-1 #3: Dile algo and Reanudar corrida live on the step; Detener stays the step's lever; Que empiece ya is in Motores", () => {
  const stopped = core().map((m) => (m.role === "taller" ? { ...m, last: { ticket: "TND-7", title: "x", status: "stopped", at: "2026-11-20T09:00:00Z", run_id: "r9" } } : m));
  assert.deepEqual(trabajo.workOn({ team: stopped }, "TND-7").stopped?.run, "r9");
  const live = core().map((m) => (m.role === "taller" ? { ...m, state: "running", now: { ticket: "TND-7", since: "2026-11-20T10:00:00Z", run_id: "r10" } } : m));
  assert.equal(trabajo.workOn({ team: live }, "TND-7").live?.agent, "taller-t");
  assert.equal(trabajo.workOn({ team: live }, "TND-7").stopped, null);
  const calls: unknown[][] = [];
  const acts = { busy: null, note: (...a: unknown[]) => calls.push(["note", ...a]), resumeRun: (...a: unknown[]) => calls.push(["resume", ...a]), start: (...a: unknown[]) => calls.push(["start", ...a]) };
  const step = html(h(trabajo.Trabajo, { p: project(stopped), k: "TND-7", acts }));
  assert.match(step, /Dile algo a Taller/);
  assert.match(step, /data-control="decir"/);
  assert.match(step, /data-control="reanudar-corrida"/);
  // Detener: the step's card levers still offer it while a run is live on it.
  assert.ok(etapas.cardActs({ key: "TND-7", status: "In progress", etapa: { etapa: "construyendo" } }, { team: live, decisions: [] }).some((a: M) => a.kind === "detener"));
  // Que empiece ya: Motores lists the seats a nudge would start.
  const held = core().map((m) => (m.role === "research" ? { ...m, next_start: { key: "TND-8", title: "y", hold: "unqueued", starts_at: null, text: "Nada lo detiene" } } : m.role === "artist" ? { ...m, next_start: { key: "TND-9", title: "z", hold: "usage", starts_at: null, text: "El plan va alto" } } : m));
  const q = html(h(motores.PorArrancar, { p: project(held), acts, now: Date.parse("2026-11-20T10:00:00Z") }));
  assert.match(q, /Que empiece ya/);
  assert.match(q, /Seguir de todos modos/);
  assert.equal(q.match(/data-control="arrancar"/g)?.length, 2);
  assert.equal(html(h(motores.PorArrancar, { p: project(held, { paused: true }), acts })), "");
});
