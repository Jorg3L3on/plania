// AUDIT-8: la ficha (PLA-I65) shows the stage data: the PO's decisions on Entendido, each plan step's done-when and
// what to try, and Research's own recommended option. Rendered with react-dom/server on a seeded read, like
// test/i65-ficha-ui.test.ts (the fixture below is that file's, kept apart so the two do not collide).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
type Json = Record<string, any>;
const STOPS = ["buzon", "entendido", "investigacion", "diseno", "plan", "lista"];
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const fichaMod = await load("components/corriente/ficha.tsx");
const h = React.createElement;
const acts = new Proxy({ busy: null, decisions: { busy: null, decide: () => undefined } } as Json, { get: (t, k: string) => (k in t ? t[k] : () => undefined) });
const proj: Json = { slug: "mianovia", title: "Mianovia", team: [], orders: [], next_first: null, tablero: { initiatives: [], loose: [], loose_done: 0 } };
const links = { doc: (id: string) => `/doc/${id}`, paso: (k: string) => `/paso/${k}`, entrega: (d: Json) => `/e/${d.id}`, pedir: "/pedir" };
function ficha(d: Json) {
  const qc = new QueryClient();
  qc.setQueryData(["idea", "mianovia", d.key], d);
  return renderToStaticMarkup(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(fichaMod.Ficha, { p: proj, k: d.key, now: Date.parse("2026-11-17T22:00:00Z"), timeZone: "America/Mexico_City", acts, decisions: [], links, onClose: () => undefined }))));
}
const stopRow = (stop: string, i: number, here: number, over: Json = {}) => ({ stop, state: i < here ? "done" : i === here ? "here" : "todo", by: i === 0 ? "owner" : "product-owner", at: "2026-11-17T21:00:00Z", delivered: i < here || (i === here && i < 5) || i === 0, doc: null, seen: true, answer: null, ...over });
const detail = (stop: string, over: Json = {}): Json => {
  const here = STOPS.indexOf(stop);
  return {
    key: "MIA-IDEA5",
    title: "Si quieres manejar cuentas sin terminal",
    short: "Cuentas sin terminal",
    stop,
    state: stop === "lista" ? "quieta" : "espera",
    who: "product-owner",
    images: 0,
    understood: "Entendí: quieres una pantalla",
    understood_text: "quieres una pantalla de usuarios",
    question: null,
    guardada: false,
    at: "2026-11-17T21:00:00Z",
    summary: "Cuentas sin terminal",
    text: "Una pantalla de usuarios",
    status: "Open",
    stage: "planning",
    promoted_to: null,
    pedido: true,
    question_options: [],
    stops: STOPS.map((s, i) => stopRow(s, i, here)),
    ficha: { problema: "Sin **lista**", tamano: "Chico", solucion: "Pantalla", riesgos: null, fuera: null },
    research: { recommendation: "La opción 2", options: [{ n: 1, title: "Una página", text: "x" }, { n: 2, title: "Lista con acciones", text: "y" }], unknown: [] },
    plan_steps: ["Ruta", "Lista", "Crear"],
    frames: [{ id: "f1", frame: "1", name: "Lista", url: "/f1.png", width: 480, height: 300, hace: "Muestra", porque: "Ver" }],
    unseen: 0,
    quiet_since: null,
    queued: null,
    trail: [],
    pictures: [],
    kind: "idea",
    gist: { buzon: "Una pantalla", entendido: "quieres una pantalla", investigacion: "Recomienda: Lista", diseno: "1 marco de Artist", plan: "3 pasos", lista: null },
    built: null,
    ...over,
  };
};

test("AUDIT-8: la ficha shows the PO's decisions on Entendido, each plan step's done-when and what to try, and Research's own recommended option", () => {
  const dec = { n: 1, question: "¿El aviso sale por WhatsApp o por correo?", options: ["WhatsApp", "Correo"], recommended: 1, why: "Casi todas contestan por WhatsApp.", state: "assumed", chosen: 1, at: null };
  const ent = ficha(detail("entendido", { decisions: [dec] }));
  assert.match(ent, /data-decisiones="1"/);
  assert.match(ent, /Se aplica «WhatsApp» si no la cambias\./);
  assert.match(ent, /data-control="idea-decision-confirmar"/);
  assert.doesNotMatch(ficha(detail("entendido")), /data-decisiones/, "an idea without data looks as before");
  const plan = ficha(detail("plan", { plan: { steps: [{ title: "Ruta", done_when: "La lista abre", try_it: "Entra a /usuarios" }], risks: [], size: null } }));
  assert.match(plan, /data-plan="pasos"[\s\S]*Listo cuando: La lista abre[\s\S]*Para probarlo: Entra a \/usuarios/);
  assert.doesNotMatch(ficha(detail("plan")), /data-plan="pasos"/);
  const options = [{ n: 1 }, { n: 2 }];
  assert.equal(fichaMod.recommended({ research: { recommendation: "La opción 2", options, recommended: 1 } }), 1, "the data wins over the prose");
  assert.equal(fichaMod.recommended({ research: { recommendation: "La opción 2", options } }), 2);
});
