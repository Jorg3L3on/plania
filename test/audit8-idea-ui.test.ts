// AUDIT-8: the idea view draws the PO's decisions as closed questions, the recommended option already chosen.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const ideaMod = await load("components/corriente/decisiones.tsx");
const h = React.createElement;
const noop = () => undefined;
const q = (over: Record<string, unknown> = {}) => ({ n: 1, question: "¿El aviso sale por WhatsApp o por correo?", options: ["WhatsApp", "Correo", "Los dos"], recommended: 1, why: "Casi todas contestan por WhatsApp.", state: "assumed", chosen: 1, at: null, ...over });
const draw = (decisions: unknown[], over: Record<string, unknown> = {}) => renderToStaticMarkup(h(ideaMod.Decisiones, { decisions, dec: {}, why: {}, open: true, busy: false, onMark: noop, onWhy: noop, onSend: noop, ...over }));
const checked = (html: string) => [...html.matchAll(/aria-checked="true"[^>]*data-option="(\d)"/g)].map((m) => Number(m[1]));

test("a decision says which option applies, what a change does, and what he decided", () => {
  assert.deepEqual(ideaMod.decisionWords(q(), 1), { line: "Se aplica «WhatsApp» si no la cambias. Casi todas contestan por WhatsApp.", act: "confirm", label: "Así está bien" });
  assert.deepEqual(ideaMod.decisionWords(q(), 2), { line: "Si cambias a «Correo», la idea vuelve al PO para rehacerla con tu respuesta.", act: "change", label: "Cambiar a «Correo»" });
  assert.deepEqual(ideaMod.decisionWords(q({ state: "decided", chosen: 3 }), 3), { line: "Tú decidiste «Los dos». El PO recomendaba «WhatsApp».", act: null, label: "" });
  assert.equal(ideaMod.decisionWords(q({ state: "decided" }), 1).line, "Tú decidiste «WhatsApp».");
  assert.equal(ideaMod.decisionWords(q({ state: "decided", chosen: 3 }), 1).act, "change", "going back to the recommended one is a change too");
  // PLA-88: past the idea stage the change goes to whoever has the idea, and it stays on its stop.
  assert.equal(ideaMod.decisionWords(q(), 2, ideaMod.forwardOf("design")).line, "Si cambias a «Correo», se lo pasamos a Artist y la idea sigue en Diseño.");
  assert.equal(ideaMod.decisionWords(q(), 2, ideaMod.forwardOf("planning")).line, "Si cambias a «Correo», se lo pasamos al PO y la idea sigue en Plan.");
  assert.equal(ideaMod.forwardOf("idea"), null);
});

test("the recommended option comes chosen, with one line saying it applies unless he changes it", () => {
  const html = draw([q(), q({ n: 2, question: "¿Se avisa a la acompañante?", options: ["No", "Sí"], state: "decided", chosen: 2 })]);
  assert.match(html, /data-decisiones="2"/);
  assert.match(html, /La marcada se aplica si no la cambias; nada te espera\./);
  assert.deepEqual(checked(html), [1, 2], "the recommended one, and the one he decided");
  assert.equal(html.match(/<small>recomendada<\/small>/g)?.length, 2);
  assert.match(html, /Se aplica «WhatsApp» si no la cambias\./);
  assert.match(html, /data-control="idea-decision-confirmar"[^>]*>Así está bien</);
  assert.match(html, /data-decision="2" data-state="decided"[\s\S]*Tú decidiste «Sí»\. El PO recomendaba «No»\./);
  assert.equal(html.match(/idea-decision-confirmar/g)?.length, 1, "a decided one asks for nothing");
  assert.doesNotMatch(html, /idea-decision-cambiar/);
  assert.doesNotMatch(html, /[A-Z]{2,}-\d+|deliver_stage|stage/, "no keys or tool names on screen");
});

test("marking another option offers the change with room for his words; a closed idea only shows them", () => {
  const html = draw([q()], { dec: { 1: 2 }, why: { 1: "Casi nadie lee el WhatsApp" } });
  assert.deepEqual(checked(html), [2]);
  assert.match(html, /Si cambias a «Correo», la idea vuelve al PO/);
  assert.match(html, /value="Casi nadie lee el WhatsApp"/);
  assert.match(html, /data-control="idea-decision-cambiar"[^>]*>Cambiar a «Correo»</);
  assert.doesNotMatch(html, /idea-decision-confirmar/);
  const closed = draw([q()], { open: false });
  assert.doesNotMatch(closed, /idea-decision-/);
  assert.equal(closed.match(/<button[^>]*disabled=""/g)?.length, 3);
});
