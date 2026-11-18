// PLA-101 (guided test PLA-86): a phone photo is shown at a phone's width in a scrolling stage (F-23), and Pedir's
// confirmation says «al PO» (F-26).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const { askedLine } = (await import(new URL("../ui/src/lib/edificio.ts", import.meta.url).href)) as { askedLine: (r: Record<string, unknown>, p?: string) => string };

test("PLA-101 #1: the phone stage scrolls a phone-wide photo; pins sit on the image's own box", async () => {
  const css = await readFile(new URL("../ui/src/corriente.css", import.meta.url), "utf8");
  assert.match(css, /\.cor-stage\[data-width="phone"\] \.cor-stage-img \{ overflow-y: auto;/);
  assert.match(css, /\.cor-stage\[data-width="phone"\] \.cor-stage-fit \{ width: min\(390px, 100%\);/);
  assert.doesNotMatch(css, /max-height: 100%; margin: 0 auto; \}/);
  const src = await readFile(new URL("../ui/src/components/corriente/entrega.tsx", import.meta.url), "utf8");
  assert.match(src, /<div className="cor-stage-fit">/);
});

test("PLA-101 #2: «Le llegó al PO de Mianovia», never «a el»", () => {
  const base = { key: "MIA-40", title: "x", po: "po-mianovia", mode: "ya", woke: null };
  assert.equal(askedLine({ ...base, wake: "queued" }, "Mianovia"), "Le llegó al PO de Mianovia; lo toma en su turno.");
  assert.equal(askedLine({ ...base, wake: "busy" }), "Le llegó al PO; lo toma al terminar lo que corre.");
  assert.equal(askedLine({ ...base, wake: "off", woke: { woke: true, reason: "", ticket: null, summary: "" } }, "Mianovia"), "Le llegó al PO de Mianovia y ya está en ello.");
});
