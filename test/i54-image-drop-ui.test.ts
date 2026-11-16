// PLA-I54-2: ImageDrop and Thumbs, server-rendered (no browser here), plus the pure rules they use: which files fit,
// and the files of a paste. The browser pass (paste, drop, picker, remove) is recorded on the ticket.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const drop = (await import(new URL("../ui/src/components/compania/edificio/image-drop.tsx", import.meta.url).href)) as Record<string, any>;
const h = React.createElement;
const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });
const noop = () => {};

test("I54-2 #3: pickImages keeps PNG, JPEG and WebP up to 5 MB and the room left, and says the first refusal in Spanish", () => {
  const a = file("a.png", "image/png");
  const b = file("b.jpg", "image/jpeg");
  const c = file("c.webp", "image/webp");
  assert.deepEqual(drop.pickImages([a, b, c], [], 6), { files: [a, b, c], error: null });
  const gif = file("d.gif", "image/gif");
  const svg = file("e.svg", "image/svg+xml");
  assert.deepEqual(drop.pickImages([gif, a, svg], [], 6), { files: [a], error: "Solo se aceptan imágenes PNG, JPEG o WebP." });
  const big = file("big.png", "image/png", 5 * 1024 * 1024 + 1);
  assert.deepEqual(drop.pickImages([big], [a], 6), { files: [a], error: "Esa imagen pesa más de 5 MB." });
  const exact = file("exact.png", "image/png", 5 * 1024 * 1024);
  assert.equal(drop.pickImages([exact], [], 6).error, null);
  // Room: six in all, stored ones counted by the caller through max.
  const five = Array.from({ length: 5 }, (_, i) => file(`${i}.png`, "image/png"));
  const r = drop.pickImages([a, b], five, 6);
  assert.equal(r.files.length, 6);
  assert.equal(r.error, "Un pedido admite hasta 6 imágenes.");
  assert.deepEqual(drop.pickImages([a], [a], 6), { files: [a], error: null }, "the same file twice is once");
  assert.deepEqual(drop.pickImages([a], [], 0).files, []);
});

test("I54-2 #3: a paste gives its files (from files or from file items); a text paste gives none", () => {
  const a = file("shot.png", "image/png");
  assert.deepEqual(drop.pastedFiles({ files: [a], items: [] }), [a]);
  assert.deepEqual(drop.pastedFiles({ files: [], items: [{ kind: "string", getAsFile: () => null }, { kind: "file", getAsFile: () => a }] }), [a]);
  assert.deepEqual(drop.pastedFiles({ files: [], items: [{ kind: "string", getAsFile: () => null }] }), []);
  assert.deepEqual(drop.pastedFiles(null), []);
});

test("I54-2 #3: ImageDrop shows the three ways in, the picker for PNG/JPEG/WebP, and a thumbnail with remove per file", () => {
  const empty = renderToStaticMarkup(h(drop.ImageDrop, { files: [], onChange: noop }));
  assert.match(empty, /data-image-drop/);
  assert.match(empty, /Pega una captura con <kbd>⌘V<\/kbd>, arrástrala aquí o/);
  assert.match(empty, /<button type="button" class="pdi-pick"[^>]*>elige un archivo<\/button>/);
  assert.match(empty, /<input[^>]*type="file"[^>]*accept="image\/png,image\/jpeg,image\/webp"[^>]*multiple/);
  assert.doesNotMatch(empty, /pdi-thumbs/, "no list while nothing is chosen");

  const two = renderToStaticMarkup(h(drop.ImageDrop, { files: [file("a.png", "image/png"), file("b.png", "image/png")], onChange: noop }));
  assert.match(two, /<ul class="pdi-thumbs" aria-label="Imágenes elegidas" data-thumbs="2">/);
  assert.match(two, /aria-label="Quitar imagen 1"/);
  assert.match(two, /aria-label="Quitar imagen 2"/);

  const full = renderToStaticMarkup(h(drop.ImageDrop, { files: [file("a.png", "image/png")], onChange: noop, stored: 5 }));
  assert.match(full, /Ya tiene 6 imágenes, el máximo\./);
  const off = renderToStaticMarkup(h(drop.ImageDrop, { files: [file("a.png", "image/png")], onChange: noop, disabled: true }));
  assert.match(off, /data-disabled="true"/);
  assert.doesNotMatch(off, /Quitar imagen/, "no remove while disabled");
});

test("I54-2 #3: Thumbs lists stored pictures with links, and remove only when asked for", () => {
  const imgs = [
    { id: "i1", url: "/api/company/projects/micasa/tasks/MIC-IDEA3/images/i1" },
    { id: "i2", url: "/api/company/projects/micasa/tasks/MIC-IDEA3/images/i2" },
  ];
  const ro = renderToStaticMarkup(h(drop.Thumbs, { images: imgs }));
  assert.match(ro, /aria-label="Imágenes del pedido"/);
  assert.match(ro, /<a href="\/api\/company\/projects\/micasa\/tasks\/MIC-IDEA3\/images\/i1" target="_blank" rel="noreferrer"[^>]*><img src="[^"]+" alt="Imagen 1"/);
  assert.doesNotMatch(ro, /Quitar/);
  const rw = renderToStaticMarkup(h(drop.Thumbs, { images: imgs, onRemove: noop, removing: "i2" }));
  assert.match(rw, /aria-label="Quitar imagen 1"/);
  assert.match(rw, /data-removing="true"[\s\S]*aria-label="Quitar imagen 2" disabled/);
  assert.equal(renderToStaticMarkup(h(drop.Thumbs, { images: [] })), "");
});
