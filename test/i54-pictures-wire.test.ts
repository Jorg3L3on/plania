// PLA-I54-5: the pictures wired into the Pedido tab. Each picture hangs under the owner's trail item it was sent with;
// a picture sent alone gets a note of its own; the trail renders the thumbnails. Pure functions, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { PedidoTab, imageNote, picturesByItem } = (await import(new URL("../ui/src/components/compania/edificio/pedido.tsx", import.meta.url).href)) as Record<string, any>;
type Item = { at: string; who: string; kind: string; text: string };
type Pic = { id: string; url: string; at: string };

const trail = [
  { at: "2026-11-16T15:00:00Z", who: "jorge", kind: "pedido", text: "Lo pediste" },
  { at: "2026-11-16T15:03:00Z", who: "product-owner", kind: "entendi", text: "Entendí: x" },
  { at: "2026-11-16T15:10:00Z", who: "jorge", kind: "nota", text: "Añadí una imagen." },
] satisfies Item[];
const pic = (id: string, at: string): Pic => ({ id, url: `/api/x/${id}`, at });

test("I54-5 #1: a picture hangs under the owner's item it was sent with", () => {
  const by = picturesByItem(trail, [pic("a", "2026-11-16T15:00:02Z"), pic("b", "2026-11-16T15:00:03Z"), pic("c", "2026-11-16T15:10:01Z")]);
  assert.deepEqual(by.get(0)?.map((p: Pic) => p.id), ["a", "b"]);
  assert.deepEqual(by.get(2)?.map((p: Pic) => p.id), ["c"]);
  assert.equal(by.get(1), undefined, "never under the PO's item");
});

test("I54-5 #1: a picture older than every item of the owner's goes to the first item", () => {
  const by = picturesByItem(trail, [pic("z", "2026-11-16T14:00:00Z")]);
  assert.deepEqual(by.get(0)?.map((p: Pic) => p.id), ["z"]);
});

test("I54-5 #1: a picture sent alone says so", () => {
  assert.equal(imageNote(1), "Añadí una imagen.");
  assert.equal(imageNote(3), "Añadí 3 imágenes.");
});

test("I54-5 #1: the Pedido tab renders the thumbnails in the trail and the picker in the note box", () => {
  const d = {
    key: "MIA-IDEA1", title: "Con foto", stop: "buzon", state: "cola", who: "product-owner", images: 1, understood: null, question: null, guardada: false,
    mode: "forma", text: "Con foto", status: "Open", stage: "idea", promoted_to: null, question_options: [], trail,
    ficha: { problema: null, tamano: null, solucion: null, riesgos: null, fuera: null },
    pictures: [pic("a", "2026-11-16T15:00:02Z")],
  };
  const html = renderToStaticMarkup(React.createElement(PedidoTab, { d, now: Date.parse("2026-11-16T16:00:00Z"), acts: { onNote: () => {} } }));
  assert.match(html, /data-slot="imagenes-recorrido"><ul class="pdi-thumbs"[^>]*data-thumbs="1"/);
  assert.match(html, /data-slot="imagenes-nota"><div class="pdi-drop"/);
  const none = renderToStaticMarkup(React.createElement(PedidoTab, { d, now: Date.now(), acts: {} }));
  assert.doesNotMatch(none, /pdi-drop/, "no picker when the tab cannot send a note");
});
