// PLA-I54-3: La ficha's «Pedido» tab. Server-rendered and handler-level; no browser, no database. Fake names only.
//   #1  a capsule opens ?f=pedido:<key>; the tab shows key, mode, stop, who has it, the trail and the idea's ficha
//   #2  the PO's question is answered in place (an option or typed words)
//   #3  the note box sends its words
//   #4  Guardar / Volver al tubo, and Descartar needs two clicks
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const pedidoUi = await load("components/compania/edificio/pedido.tsx");
const fichaUi = await load("components/compania/edificio/ficha.tsx");
const fichaLib = await load("lib/ficha.ts");

type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-16T20:00:00Z").getTime();
const TZ = "America/Mexico_City";
const noop = () => {};
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const detail = (patch: Json = {}): Json => ({
  key: "DEM-IDEA5",
  title: "Que el registro pida menos datos",
  stop: "entendido",
  state: "espera",
  who: "product-owner",
  images: 0,
  understood: "el registro tiene demasiados campos.",
  question: { id: "q1", text: "¿Quitamos el segundo teléfono?" },
  guardada: false,
  at: "2026-11-16T18:50:00Z",
  mode: "forma",
  text: "Que el registro pida menos datos\nHoy son nueve campos.",
  status: "Open",
  stage: "idea",
  promoted_to: null,
  question_options: ["Quitarlo", "Opcional"],
  trail: [
    { at: "2026-11-16T18:50:00Z", who: "jorge", kind: "pedido", text: "Lo pediste." },
    { at: "2026-11-16T18:53:00Z", who: "product-owner", kind: "entendi", text: "Entendí: el registro tiene demasiados campos." },
    { at: "2026-11-15T18:54:00Z", who: "research", kind: "doc", text: "Escribió «Research».", doc: { id: "d1", title: "Research" } },
    { at: "2026-11-16T18:54:00Z", who: "product-owner", kind: "pregunta", text: "Preguntó: ¿Quitamos el segundo teléfono?" },
  ],
  ficha: { problema: "El registro pide nueve datos.", tamano: null, solucion: null, riesgos: null, fuera: null },
  pictures: [],
  ...patch,
});
const view = (d: Json, patch: Json = {}) =>
  h(pedidoUi.PedidoView, { d, now: NOW, timeZone: TZ, acts: {}, sub: "recorrido", setSub: noop, answer: "", setAnswer: noop, note: "", setNote: noop, confirmDrop: false, setConfirmDrop: noop, ...patch });
// Every element of a pure view, with its props, to call handlers the way a click would.
function els(node: unknown): React.ReactElement<Json>[] {
  const out: React.ReactElement<Json>[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const el = n as React.ReactElement<Json>;
    if (typeof el.type === "function") return walk((el.type as (p: Json) => unknown)(el.props));
    out.push(el);
    walk(el.props?.children);
  };
  walk(node);
  return out;
}
const byControl = (node: unknown, c: string) => els(node).filter((e) => e.props?.["data-control"] === c);

test("I54-3 #1: a capsule's address is f=pedido:<key>, under the Pedido tab; Guardadas is f=guardadas", () => {
  assert.deepEqual(fichaLib.FICHA_TABS, ["resumen", "pedido", "ideas", "diseno", "prs", "docs"]);
  assert.deepEqual(fichaLib.fichaOf("?piso=demo&f=pedido:DEM-IDEA5"), { ref: { kind: "pedido", key: "DEM-IDEA5" }, slug: null });
  assert.equal(fichaLib.fichaSearch("demo", { kind: "pedido", key: "DEM-IDEA5" }), "?piso=demo&f=pedido%3ADEM-IDEA5");
  assert.deepEqual(fichaLib.fichaOf("?f=guardadas")!.ref, { kind: "guardadas" });
  assert.equal(fichaLib.tabOf({ kind: "pedido", key: "DEM-IDEA5" }), "pedido");
  assert.equal(fichaLib.tabOf({ kind: "guardadas" }), "pedido");
  assert.equal(fichaLib.needsRows({ kind: "tab", tab: "pedido" }), false, "the tab reads the floor's pedidos, nothing new");
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('onOpen: (slug, key, el) => showFicha({ kind: "pedido", key }, el, slug)'));
  assert.ok(page.includes('onGuardadas: (slug, el) => showFicha({ kind: "guardadas" }, el, slug)'));
});

test("I54-3 #1: the tab shows key, mode, stop, who has it, the trail and the idea's ficha", () => {
  const html = renderToStaticMarkup(view(detail()));
  const t = text(html);
  assert.match(t, /DEM-IDEA5 Dándole forma Entendido Te espera/);
  assert.match(t, /El PO no sigue hasta que contestes\./);
  assert.match(t, /Tú · Lo pediste: «Que el registro pida menos datos Hoy son nueve campos\.»/);
  assert.match(t, /PO · Entendí: el registro/);
  assert.match(t, /15 nov\.? 12:54 Research · Escribió «Research»/, "another day shows its date");
  assert.match(html, /data-slot="imagenes-recorrido"/);
  assert.match(html, /data-slot="imagenes-nota"/);
  const ficha = text(renderToStaticMarkup(view(detail(), { sub: "ficha" })));
  assert.match(ficha, /Problema El registro pide nueve datos\. Tamaño Pendiente Solución Pendiente Riesgos Pendiente Fuera Pendiente/);
  // The sub-tabs switch.
  const subs: string[] = [];
  for (const b of byControl(view(detail(), { setSub: (s: string) => subs.push(s) }), "pedido-ficha")) b.props.onClick();
  assert.deepEqual(subs, ["ficha"]);
  // A doc in the trail opens in La ficha.
  const docs: string[] = [];
  for (const b of byControl(view(detail(), { acts: { onDoc: (id: string) => docs.push(id) } }), "pedido-doc")) b.props.onClick();
  assert.deepEqual(docs, ["d1"]);
  // Lines for each state.
  assert.equal(pedidoUi.pedidoLine({ state: "trabajando", stop: "diseno", who: "artist", guardada: false }), "Artist la trabaja ahora.");
  assert.equal(pedidoUi.pedidoLine({ state: "quieta", stop: "lista", who: "product-owner", guardada: false }), "Tiene forma. No sube al tablero hasta que digas «Constrúyelo».");
  assert.equal(pedidoUi.pedidoLine({ state: "cola", stop: "buzon", who: "product-owner", guardada: false }), "En el buzón. El PO la abre en su turno.");
  assert.equal(pedidoUi.pedidoLine({ state: "quieta", stop: "plan", who: "product-owner", guardada: true }), "Guardada. Nadie la trabaja.");
});

test("I54-3 #2 #3: the PO's question is answered in place, by an option or typed; the note box sends its words", () => {
  const sent: string[] = [];
  const acts = { onAnswer: (q: string, t: string) => sent.push(`${q}:${t}`), onNote: (t: string) => sent.push(`nota:${t}`) };
  const v = view(detail(), { acts, answer: "  Opcional, con aviso  ", note: " A las 6 " });
  byControl(v, "pedido-opcion")[0]!.props.onClick();
  const forms = els(v).filter((e) => e.type === "form");
  for (const f of forms) f.props.onSubmit({ preventDefault: noop });
  assert.deepEqual(sent, ["q1:Quitarlo", "q1:Opcional, con aviso", "nota:A las 6"]);
  // No question, no box; nothing typed, nothing sent.
  const none = renderToStaticMarkup(view(detail({ question: null, state: "quieta" })));
  assert.equal(none.includes("El PO pregunta"), false);
  const quiet: string[] = [];
  for (const f of els(view(detail(), { acts: { onAnswer: () => quiet.push("a"), onNote: () => quiet.push("n") } })).filter((e) => e.type === "form")) f.props.onSubmit({ preventDefault: noop });
  assert.deepEqual(quiet, []);
});

test("I54-3 #4: Guardar and Volver al tubo; Descartar asks once more before it acts", () => {
  const calls: string[] = [];
  const acts = { onGuardar: () => calls.push("guardar"), onRestaurar: () => calls.push("restaurar"), onDescartar: () => calls.push("descartar") };
  byControl(view(detail(), { acts }), "pedido-guardar")[0]!.props.onClick();
  byControl(view(detail({ guardada: true }), { acts }), "pedido-restaurar")[0]!.props.onClick();
  assert.equal(byControl(view(detail({ guardada: true }), { acts }), "pedido-guardar").length, 0);
  // Two clicks: the first only arms it.
  let armed = false;
  const first = byControl(view(detail(), { acts, setConfirmDrop: (b: boolean) => (armed = b) }), "pedido-descartar")[0]!;
  first.props.onClick();
  assert.equal(armed, true);
  assert.deepEqual(calls, ["guardar", "restaurar"]);
  const second = byControl(view(detail(), { acts, confirmDrop: true, setConfirmDrop: (b: boolean) => (armed = b) }), "pedido-descartar")[0]!;
  assert.match(text(renderToStaticMarkup(view(detail(), { confirmDrop: true }))), /¿Seguro\? Descartar/);
  second.props.onClick();
  assert.deepEqual(calls, ["guardar", "restaurar", "descartar"]);
  assert.equal(armed, false);
  // Closed or promoted: no actions.
  const done = renderToStaticMarkup(view(detail({ status: "Won't do", question: null })));
  assert.equal(/data-control="pedido-(guardar|descartar|nota)"/.test(done), false);
  assert.match(text(done), /Descartada\. No vuelve al tubo\./);
});

test("I54-3: the Pedido tab lists what takes shape; the shelf lists the saved ones", () => {
  const project = {
    slug: "demo",
    title: "Demo",
    pedidos: [
      { key: "DEM-IDEA5", title: "Menos datos", stop: "entendido", state: "espera", who: "product-owner", images: 0, guardada: false },
      { key: "DEM-IDEA3", title: "Sin conexión", stop: "investigacion", state: "quieta", who: "research", images: 0, guardada: true },
    ],
    this_week: { done: 0, docs: 0, prs: 0 },
  };
  const idle = { status: "idle" };
  const draw = (fref: Json) => renderToStaticMarkup(h(fichaUi.Ficha, { project, fref, rows: idle, task: idle, doc: idle, slots: {}, now: NOW, onRef: noop, onClose: noop }));
  const tab = draw({ kind: "tab", tab: "pedido" });
  assert.match(tab, /data-control="ficha-tab-pedido"[^>]*>Pedido<small>1<\/small>/);
  assert.match(text(tab), /Menos datos Te espera · Entendido/);
  assert.equal(text(tab).includes("Sin conexión"), false);
  assert.match(tab, /data-control="ficha-guardadas"/);
  const shelf = draw({ kind: "guardadas" });
  assert.match(text(shelf), /Sin conexión Guardada · Investigación/);
  assert.match(text(draw({ kind: "pedido", key: "DEM-IDEA5" })), /← Pedido/);
});

test("I54-4: Constrúyelo is the tab's main button from any stop; while the PO promotes it, it says so and waits", () => {
  const calls: string[] = [];
  const acts = { onConstruir: () => calls.push("construir"), onGuardar: noop };
  for (const stop of ["buzon", "lista"]) {
    const b = byControl(view(detail({ stop, state: "quieta", question: null }), { acts }), "pedido-construir")[0]!;
    assert.match(String(b.props.className), /edi-btn-primary/);
    b.props.onClick();
  }
  assert.deepEqual(calls, ["construir", "construir"]);
  const passing = view(detail({ state: "valvula", question: null }), { acts });
  const b = byControl(passing, "pedido-construir")[0]!;
  assert.equal(b.props.disabled, true);
  assert.match(text(renderToStaticMarkup(passing)), /Pasando la válvula… .*Pasando la válvula: el PO termina lo que falta y crea la iniciativa\.|Pasando la válvula: el PO termina lo que falta y crea la iniciativa\.[^]*Pasando la válvula…/);
  assert.equal(byControl(passing, "pedido-guardar")[0]!.props.disabled, true);
  assert.equal(byControl(passing, "pedido-descartar")[0]!.props.disabled, true);
  // A saved one offers Volver al tubo instead.
  assert.equal(byControl(view(detail({ guardada: true }), { acts }), "pedido-construir").length, 0);
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes('onConstruir: () => pedidoDo("construir", () => api.pedidoAct(fslug, pedidoKey, "construir"))'));
});
