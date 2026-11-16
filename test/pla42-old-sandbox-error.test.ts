// PLA-42: a pictures error saved before the wording fix («la copia de sandbox no arrancó») never shows «sandbox».
import assert from "node:assert/strict";
import { test } from "node:test";
import { probadorGate } from "../src/captures/probador.js";

test("PLA-42: an old saved error reads «copia de prueba» on screen", () => {
  const p = { settings: { capture: true } } as never;
  const t = { muestra: { views: [] }, probador: { state: "lista", commit: null, error: "Sin antes: la copia de sandbox no arrancó" } } as never;
  const g = probadorGate(p, t, null);
  assert.equal(g.hold, "Faltan fotos: Sin antes: la copia de prueba no arrancó");
});
