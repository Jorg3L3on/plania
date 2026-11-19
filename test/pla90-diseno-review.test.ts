// PLA-90 (guided test PLA-86, F-10..F-12): the Diseño preview fits each frame whole in one fixed box, so a phone
// frame is not 45 px wide and picking a frame does not reflow the thumbnails; the lightbox has the pin's note field.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as React from "react";

(globalThis as { React?: unknown }).React = React;
const ficha = (await import(new URL("../ui/src/components/corriente/ficha.tsx", import.meta.url).href)) as Record<string, any>;

test("PLA-90 #1: fitIn keeps the frame's shape inside the 220×124 box", () => {
  assert.deepEqual(ficha.fitIn(375, 1000, 220, 124), { width: 47, height: 124 }, "a phone frame is as tall as the box");
  assert.deepEqual(ficha.fitIn(1440, 900, 220, 124), { width: 198, height: 124 });
  assert.deepEqual(ficha.fitIn(2250, 840, 220, 124), { width: 220, height: 82 }, "a wide table is as wide as the box");
  assert.deepEqual(ficha.fitIn(null, null, 220, 124), { width: 198, height: 124 }, "unknown size reads as 16:10");
});

test("PLA-90 #2: the preview column is fixed and the lightbox carries the note fields", async () => {
  const css = await readFile(new URL("../ui/src/corriente.css", import.meta.url), "utf8");
  assert.match(css, /\.cor-ficha-frames \{ display: grid; grid-template-columns: 220px /);
  const src = await readFile(new URL("../ui/src/components/corriente/ficha.tsx", import.meta.url), "utf8");
  assert.match(src, /cor-lightbox-notes/);
  assert.match(src, /autoFocus=\{p\.n === ui\.pins\.length && !p\.text\}/);
  assert.match(src, /ref=\{focusOnOpen\}/, "a stable ref: the lightbox does not take the focus back on every render");
  assert.doesNotMatch(src, /ref=\{\(el\) => el\?\.focus\(\)\}/);
});

test("PLA-114 (F-10): a phone frame fills the preview's width and scrolls; other frames are fitted whole as before", async () => {
  assert.deepEqual(ficha.previewOf(563, 1562, 220, 124), { size: { width: 220, height: 610 }, tall: true });
  assert.deepEqual(ficha.previewOf(1440, 900, 220, 124), { size: { width: 198, height: 124 }, tall: false });
  assert.deepEqual(ficha.previewOf(2250, 840, 220, 124), { size: { width: 220, height: 82 }, tall: false });
  assert.deepEqual(ficha.previewOf(null, null, 220, 124).tall, false);
  const css = await readFile(new URL("../ui/src/corriente.css", import.meta.url), "utf8");
  assert.match(css, /\.cor-ficha-frame-big\[data-tall\] \{ display: block; overflow-y: auto; overscroll-behavior: contain; \}/);
});
