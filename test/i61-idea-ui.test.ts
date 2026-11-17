// PLA-I61 (La idea abierta): the view, server-rendered and handler-level; no browser, no database. Fake names only.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const ui = await load("components/compania/edificio/idea.tsx");
const fichaUi = await load("components/compania/edificio/ficha.tsx");
const fichaLib = await load("lib/ficha.ts");

type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-17T06:00:00Z").getTime();
const TZ = "America/Mexico_City";
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const stop = (s: string, patch: Json = {}): Json => ({ stop: s, state: "done", by: null, at: null, delivered: false, doc: null, seen: true, answer: null, ...patch });
const frame = (id: string, name: string, patch: Json = {}): Json => ({ id: `f-${id}`, frame: id, name, group: "Panel", hace: `${name} hace`, porque: `${name} porque`, url: `/f/${id}.png`, width: 1180, height: 800, ...patch });
const idea = (patch: Json = {}): Json => ({
  key: "DEM-IDEA1",
  title: "Usar shadcn en toda la app",
  summary: "Toda la app con piezas shadcn",
  stop: "plan",
  state: "quieta",
  who: "product-owner",
  images: 0,
  understood: "Entendí: toda la app con piezas shadcn.",
  question: null,
  guardada: false,
  at: "2026-11-17T04:00:00Z",
  text: "Usar shadcn en toda la app",
  status: "Open",
  stage: "planning",
  promoted_to: null,
  pedido: true,
  question_options: [],
  stops: [
    stop("buzon", { by: "jorge", at: "2026-11-17T04:00:00Z", delivered: true }),
    stop("entendido", { by: "product-owner", at: "2026-11-17T04:56:00Z", delivered: true, doc: { id: "d1", title: "Idea", version: 1, markdown: "## Problem\nx" }, seen: false }),
    stop("investigacion", { by: "research", at: "2026-11-17T05:01:00Z", delivered: true, doc: { id: "d2", title: "Research", version: 1, markdown: "| A | B |\n|---|---|\n| 1 | 2 |" }, seen: false }),
    stop("diseno", { by: "artist", at: "2026-11-17T05:08:00Z", delivered: true, doc: { id: "d3", title: "Design", version: 1, markdown: "## Approach\nx" }, seen: false }),
    stop("plan", { state: "here" }),
    stop("lista", { state: "todo" }),
  ],
  ficha: { problema: "Piezas a mano", tamano: "Mediano", solucion: "shadcn", riesgos: null, fuera: null },
  research: { recommendation: "Opción 1.", options: [{ n: 1, title: "Radix", text: "La de siempre" }, { n: 2, title: "Base UI", text: "Nueva" }], unknown: ["El peso del JS"] },
  plan_steps: [],
  frames: [frame("T", "Tema", { group: "Tema" }), frame("B1", "Listado")],
  unseen: 3,
  quiet_since: "2026-11-17T05:08:00Z",
  queued: null,
  trail: [
    { at: "2026-11-17T04:00:00Z", who: "jorge", kind: "pedido", text: "Lo pediste." },
    { at: "2026-11-17T05:01:00Z", who: "research", kind: "doc", text: "Escribió «Research».", doc: { id: "d2", title: "Research" } },
    { at: "2026-11-17T05:08:00Z", who: "artist", kind: "marcos", text: "Subió 2 marcos del diseño.", stop: "diseno" },
  ],
  pictures: [],
  ...patch,
});
const view = (d: Json, uiPatch: Json = {}, acts: Json = {}) =>
  renderToStaticMarkup(h(ui.IdeaView, { d, now: NOW, timeZone: TZ, from: "Pedido", acts: { onRespuesta: () => {}, onDespertar: () => {}, onBack: () => {}, ...acts }, ui: { ...ui.initialUi(d), ...uiPatch }, set: () => {} }));

test("I61-3: it opens on the newest delivery not seen, else where the idea is", () => {
  assert.equal(ui.firstStop(idea()), "diseno");
  const seen = idea();
  seen.stops.forEach((s: Json) => (s.seen = true));
  assert.equal(ui.firstStop(seen), "plan");
});

test("I61-3: the tube says who, when and seen; the header the summary and his words", () => {
  const html = view(idea());
  const t = text(html);
  assert.ok(["← Pedido", "DEM-IDEA1", "Dándole forma", "3 entregas sin ver", "Toda la app con piezas shadcn", "«Usar shadcn en toda la app»"].every((x) => t.includes(x)), t);
  assert.ok(["Pedido 22:00", "Entendido Sin ver · 22:56", "Investigación Sin ver · 23:01", "Diseño Sin ver · 23:08", "Plan Quieta · 23:08", "Lista Falta"].every((x) => t.includes(x)), t);
  assert.equal((html.match(/data-unseen=""/g) ?? []).length, 3);
  assert.match(html, /data-stop="diseno"/);
  // Diseño: the frame, the strip, what it does and why, the answer bar
  assert.ok(["T · Tema", "1 de 2", "Tema hace", "Tema porque", "Abrir la mesa", "Me gusta, sigue", "Pide cambios…", "Doc completo"].every((x) => t.includes(x)), t);
  assert.equal((html.match(/data-control="idea-marco"/g) ?? []).length, 2);
});

test("I61-3: each stop's drawer: the PO's reading, Research's options, a quiet plan with Despertar", () => {
  const ent = text(view(idea(), { stop: "entendido" }));
  assert.ok(["toda la app con piezas shadcn.", "Problema", "Piezas a mano", "Tamaño", "Mediano", "Riesgos", "Pendiente", "Así es", "Corregir"].every((x) => ent.includes(x)), ent);
  const inv = text(view(idea(), { stop: "investigacion" }));
  assert.ok(["Recomienda", "Opción 1.", "Las 2 opciones", "1. Radix", "La de siempre", "2. Base UI", "El peso del JS", "Va con la recomendada"].every((x) => inv.includes(x)), inv);
  assert.ok(text(view(idea(), { stop: "investigacion", pick: 2 })).includes("Pedir la opción 2"));
  const plan = text(view(idea(), { stop: "plan" }));
  assert.ok(["Quieta desde las 23:08", "Nadie arma el plan todavía.", "Despertar"].every((x) => plan.includes(x)), plan);
  assert.ok(text(view(idea({ queued: "product-owner", quiet_since: null }), { stop: "plan" })).includes("En la fila de PO"));
});

test("I61-4: an answer shows in its bar; only a «me gusta» can be undone", () => {
  const ok = idea();
  ok.stops[3].answer = { verdict: "ok", text: null, option: null, notes: [], at: "2026-11-17T05:30:00Z" };
  ok.stops[3].seen = true;
  const a = text(view(ok, { stop: "diseno" }));
  assert.ok(a.includes("Te gustó el diseño.") && a.includes("Deshacer"), a);
  const back = idea({ stop: "diseno", stage: "design", queued: "artist", quiet_since: null });
  back.stops[3] = { ...back.stops[3], state: "here", seen: true, answer: { verdict: "cambios", text: null, option: null, notes: [{ frame: "B1", x: 1, y: 2, text: "x" }], at: "2026-11-17T05:30:00Z" } };
  back.stops[4].state = "todo";
  const b = text(view(back, { stop: "diseno" }));
  assert.ok(b.includes("Pediste cambios con 1 nota.") && b.includes("Volvió a Diseño") && !b.includes("Deshacer"), b);
  assert.ok(b.includes("En la fila de Artist"), b);
});

test("I61-4: the handlers send the answer the owner chose", () => {
  const sent: Json[] = [];
  let set: Json = {};
  const el = ui.IdeaView({ d: idea(), now: NOW, timeZone: TZ, from: "Pedido", acts: { onRespuesta: (x: Json) => sent.push(x) }, ui: { ...ui.initialUi(idea()), stop: "entendido", text: "Solo el registro" }, set: (p: Json) => (set = p) });
  const find = (node: any, pred: (n: any) => boolean): any => {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const c of node) {
        const hit = find(c, pred);
        if (hit) return hit;
      }
      return null;
    }
    if (pred(node)) return node;
    if (typeof node.type === "function") return find(node.type(node.props), pred);
    for (const c of [].concat(node.props?.children ?? [])) {
      const hit = find(c, pred);
      if (hit) return hit;
    }
    return null;
  };
  find(el, (n) => n.props?.["data-control"] === "idea-ok").props.onClick();
  find(el, (n) => n.type === "form" && n.props?.className === "ia-vbar").props.onSubmit({ preventDefault: () => {} });
  assert.deepEqual(sent, [{ stop: "entendido", verdict: "ok" }, { stop: "entendido", verdict: "corregir", text: "Solo el registro" }]);
  find(el, (n) => n.props?.["data-control"] === "idea-parada-diseno").props.onClick();
  assert.equal(set.stop, "diseno");
});

test("I61-3: the full doc opens inside the idea, draws tables and goes back to it", () => {
  const html = view(idea(), { stop: "investigacion", doc: "investigacion" });
  assert.ok(text(html).includes("← DEM-IDEA1 · Investigación"));
  assert.match(html, /<table>/);
});

test("I61-4: La mesa lists the frames by group, pins the notes and counts what it sends", () => {
  const html = renderToStaticMarkup(h(ui.Mesa, { d: idea(), ui: { ...ui.initialUi(idea()), frame: 1, mesa: true, pins: [{ frame: "B1", x: 50, y: 20, text: "Más aire" }, { frame: "T", x: 1, y: 1, text: "" }] }, set: () => {}, acts: { onRespuesta: () => {} } }));
  const t = text(html);
  assert.ok(["Mesa de revisión", "Tema", "Panel", "B1 · Listado", "Tus notas para Artist · 2", "Mandar 1 nota a Artist", "Me gusta, sigue"].every((x) => t.includes(x)), t);
  assert.equal((html.match(/class="ia-pin"/g) ?? []).length, 1, "only the shown frame's pins");
  assert.match(html, /role="dialog"/);
});

test("I61-3: La ficha opens a request and an idea in the same view, each going back where it came from", () => {
  const project = { slug: "dem", title: "Demo", pedidos: [], tablero: null };
  const ok = (data: unknown) => ({ status: "ok", data });
  const render = (fref: Json) =>
    renderToStaticMarkup(
      h(fichaUi.Ficha, { project, fref, rows: { status: "idle" }, task: { status: "idle" }, doc: { status: "idle" }, idea: ok(idea()), ideaActs: {}, slots: {}, now: NOW, timeZone: TZ, onRef: () => {}, onClose: () => {} }),
    );
  assert.ok(text(render({ kind: "pedido", key: "DEM-IDEA1" })).includes("← Pedido"));
  assert.ok(text(render({ kind: "idea", key: "DEM-IDEA1" })).includes("← Ideas"));
  assert.ok(text(render({ kind: "idea", key: "DEM-IDEA1", from: "diseno" })).includes("← Diseño"));
  assert.equal((render({ kind: "idea", key: "DEM-IDEA1" }).match(/data-control="ficha-volver"/g) ?? []).length, 1, "one way back");
  assert.deepEqual(fichaLib.fichaOf("?f=idea:DEM-IDEA1~diseno").ref, { kind: "idea", key: "DEM-IDEA1", from: "diseno" });
  assert.equal(fichaLib.fichaParam({ kind: "idea", key: "DEM-IDEA1", from: "diseno" }), "idea:DEM-IDEA1~diseno");
  assert.equal(fichaLib.tabOf({ kind: "idea", key: "DEM-IDEA1", from: "diseno" }), "diseno");
  assert.equal(fichaLib.needsIdea({ kind: "pedido", key: "DEM-IDEA1" }), "DEM-IDEA1");
  assert.equal(fichaLib.needsTask({ kind: "idea", key: "DEM-IDEA1" }), null);
});
