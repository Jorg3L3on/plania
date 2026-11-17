// PLA-I57-1: Preguntar in Pedir's side page. Server-rendered; no browser, no database.
//   #1  the third mode: Preguntar, unchecked by default; picked, the button says Preguntar
//   #2  the thread: waiting shows the trail; the answer shows short, why, sources, how sure and the fix's two Pedirlo
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;

type Json = Record<string, any>;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const askUi = await load("components/compania/edificio/ask.tsx");
const cq = await load("components/compania/edificio/consulta.tsx");
const h = React.createElement as (...a: unknown[]) => React.ReactElement;
const noop = () => undefined;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const project = { slug: "demo", title: "Demo" } as Json;

test("I57-1 UI #1: Pedir has a third mode, Preguntar; picked, the button says Preguntar", () => {
  const view = (patch: Json = {}) => renderToStaticMarkup(h(askUi.AskView, { project, text: "¿Por qué?", setText: noop, onSubmit: noop, onPast: noop, pastCount: 2, ...patch }));
  const html = view();
  const radio = (v: string) => new RegExp(`<input[^>]*value="${v}"[^>]*>`).exec(html)![0];
  assert.equal(/checked=""/.test(radio("pregunta")), false, "Darle forma stays the default");
  assert.match(text(html), /Preguntar Solo quieres saber algo\. El PO lee el código y te contesta aquí\. No crea idea ni ticket\./);
  assert.match(text(html), /Preguntas anteriores · 2/);
  assert.match(text(view()), /Pedir$/);
  const asking = view({ mode: "pregunta" });
  assert.match(asking, /data-control="pedir"[^>]*>Preguntar</);
  assert.match(text(asking), /Preguntar no deja nada en el tablero ni en el tubo/);
  assert.match(text(view({ mode: "ya", fromAnswer: true })), /Viene de tu pregunta\. La respuesta va adjunta para el PO\./);
});

test("I57-1 UI #2: the thread shows the trail while the PO reads, then the answer and Pedirlo", () => {
  const base = { id: "c1", text: "¿Por qué se recarga?", asked_at: "2026-11-16T22:51:00Z", started_at: "2026-11-16T22:51:05Z", answered_at: null, answer: null } as Json;
  const thread = (c: Json) => renderToStaticMarkup(h(cq.ConsultaThread, { c, po: "PO de Demo", onBack: noop, onPedirlo: noop, onAgain: noop, onMore: noop }));
  const reading = text(thread({ ...base, state: "leyendo", trail: ["Abrió src/a.tsx", "Buscó «layout»"] }));
  assert.match(reading, /Lee el código\. Puedes cerrar esto/);
  assert.match(reading, /Abrió src\/a\.tsx Buscó «layout»/);
  assert.equal(/Pedirlo/.test(reading), false);
  const answer = { short: "No es una recarga completa.", why: ["El menú vive en cada página."], sources: [{ path: "src/menu.tsx", line: 12, missing: false }, { path: "src/layout.tsx", line: null, missing: true }], branch: "jl/mia-35", commit: "0a6b89c", sure: "seen", tried: false, fix: "Mover el menú a un layout.", by: "po-demo" };
  const done = thread({ ...base, state: "lista", trail: ["Abrió src/a.tsx"], answered_at: "2026-11-16T22:52:45Z", answer });
  const t = text(done);
  assert.match(t, /Leyó jl\/mia-35 · 0a6b89c/);
  assert.match(t, /1 min 40 s/);
  assert.match(t, /No es una recarga completa\. Por qué El menú vive en cada página\./);
  assert.match(t, /src\/menu\.tsx:12 src\/layout\.tsx · no existe/);
  assert.match(t, /✓ Lo vio en el código No lo probó en vivo/);
  assert.match(t, /Si quieres arreglarlo Mover el menú a un layout\. Pedirlo · Hacerlo ya Pedirlo · Darle forma/);
  assert.match(t, /No creó idea ni ticket/);
  assert.match(text(thread({ ...base, state: "sin_respuesta", trail: [] })), /Su corrida terminó sin contestar\. Preguntar otra vez/);
});
