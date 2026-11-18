// PLA-109 (guided test PLA-86): the delivery card and the floor at a narrow pane. F-36: the two button groups wrap
// instead of running into the decision column. F-37: a photo still on its way says «Cargando la foto…» instead of an
// empty dark box. F-41: the stops' header shows three letters when its own width is small. PLA-93: the initiative
// ficha opens a delivery; Aceptar lives on the delivery's card. No browser: source and pure words.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const src = (f: string) => readFile(new URL(`../ui/src/${f}`, import.meta.url), "utf8");

test("PLA-109 F-36: the side and size groups sit in a wrapping row, not an inline flex that overflows", async () => {
  const entrega = await src("components/corriente/entrega.tsx");
  assert.match(entrega, /<span className="cor-entrega-modes">/);
  assert.doesNotMatch(entrega, /style=\{\{ display: "flex", gap: 10 \}\}/);
  assert.match(await src("corriente.css"), /\.cor-entrega-modes \{ display: flex; flex-wrap: wrap; gap: 10px; min-width: 0; \}/);
});

test("PLA-109 F-37: a still says it is loading until its image arrives", async () => {
  const entrega = await src("components/corriente/entrega.tsx");
  assert.match(entrega, /<Still src=\{f\.src\} alt=\{f\.alt\} \/>/);
  assert.match(entrega, /onLoad=\{\(\) => setLoaded\(src\)\}/);
  assert.match(await src("lib/probador.ts"), /cargando: "Cargando la foto…",/);
  assert.match(await src("corriente.css"), /\.cor-stage-fit:has\(> \.cor-still-loading\) \{ min-height: 240px; \}/);
});

test("PLA-109 F-41: the header's three-letter names, without accents, switched by a container query", async () => {
  const hilo = await src("components/corriente/hilo.tsx");
  assert.match(hilo, /<span className="t">\{TINY\(p\)\}<\/span>/);
  // The same rule as TINY, on the stops' names: three letters without accents, none of them alike.
  const tiny = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 3);
  assert.match(hilo, /normalize\("NFD"\)\.replace\(\/\[\\u0300-\\u036f\]\/g, ""\)\.slice\(0, 3\)/);
  const names = ["Buzón", "Entendido", "Investigación", "Diseño", "Plan", "Lista", "Construcción", "Publicado"].map(tiny);
  assert.deepEqual(names, ["Buz", "Ent", "Inv", "Dis", "Pla", "Lis", "Con", "Pub"]);
  assert.equal(new Set(names).size, names.length);
  const css = await src("corriente.css");
  assert.match(css, /\.cor-hilo-wrap \{ display: block; min-width: 0; container-type: inline-size; \}/);
  assert.match(css, /@container \(max-width: 520px\) \{ \.cor-hilo\.head \.l, \.cor-hilo\.head \.s \{ display: none; \} \.cor-hilo\.head \.t \{ display: inline; \} \}/);
});

test("PLA-93: the ficha's «Te toca» opens a delivery instead of accepting it", async () => {
  const ficha = await src("components/corriente/ficha.tsx");
  assert.match(ficha, /\{accept && !dl && \(/);
});
