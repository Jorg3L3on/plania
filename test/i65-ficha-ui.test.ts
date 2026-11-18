// PLA-I65 (Una sola ficha), the screen side: the current's model and geometry, its still frame, and the ficha and
// rows rendered with react-dom/server. Clicks, measures and axe run in the real-browser pass (PLA-I65-6).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const geo = await load("components/corriente/rio-geo.ts");
const rio = await load("components/corriente/rio.tsx");

type Json = Record<string, any>;
const STOPS = ["buzon", "entendido", "investigacion", "diseno", "plan", "lista"];
// An idea read at a stop: everything before it delivered.
const at = (stop: string, extra: Json = {}): Json => {
  const i = STOPS.indexOf(stop);
  return {
    stop,
    state: "quieta",
    guardada: false,
    promoted_to: null,
    question: null,
    plan_steps: i >= 4 ? Array.from({ length: 12 }, (_, k) => `Paso ${k + 1}`) : [],
    stops: STOPS.map((s, k) => ({ stop: s, delivered: k < i || (k === i && k < 5) || s === "buzon", state: k < i ? "done" : k === i ? "here" : "todo" })),
    built: null,
    ...extra,
  };
};
const step = (status: string, etapa: string | null) => ({ key: "K", title: "t", status, phase: 1, etapa, pr: null });

test("I65-2: the thickness grows one notch per delivered stop; what is missing stays dry", () => {
  const ws = (stop: string) => geo.widths(geo.rioOf(at(stop)).delivered);
  assert.deepEqual(ws("buzon"), [7, 7, 7, 7, 7, 7], "only his words");
  assert.deepEqual(ws("entendido"), [7, 11, 11, 11, 11, 11]);
  assert.deepEqual(ws("plan"), [7, 11, 15, 19, 23, 23]);
  // A stop that delivered nothing adds nothing.
  const gap = at("diseno");
  gap.stops[2].delivered = false;
  assert.deepEqual(geo.widths(geo.rioOf(gap).delivered), [7, 11, 11, 15, 15, 15]);
  // Width before the first stop is the thread, and it eases up after each stop.
  const w = geo.widths([true, true, false, false, false, false]);
  assert.equal(geo.widthAt(geo.X0, w), 2);
  assert.ok(geo.widthAt(geo.SX(1) + 60, w) === 11);
});

test("I65-2: the front, the dam and each channel for an idea at each stop, building and published", () => {
  for (const [i, s] of STOPS.entries()) {
    const m = geo.rioOf(at(s));
    assert.equal(m.here, i, s);
    assert.equal(m.dam, s === "lista" ? "wait" : "closed", s);
    assert.ok(m.chans.every((c: string) => c === "todo"), "dry delta before it is built");
  }
  assert.equal(geo.rioOf(at("lista")).front, "you", "Lista waits on his Constrúyelo");
  assert.equal(geo.rioOf(at("investigacion", { state: "trabajando" })).front, "live");
  assert.equal(geo.rioOf(at("entendido", { state: "espera" })).front, "you");
  assert.equal(geo.rioOf(at("buzon", { state: "cola" })).front, "quiet");
  // Constrúyelo said: the PO is creating the initiative, the dam still waits.
  const valve = geo.rioOf(at("lista", { state: "valvula" }));
  assert.equal(valve.dam, "wait");
  assert.equal(valve.front, "live");
  // Saved: no dam waiting.
  assert.equal(geo.rioOf(at("lista", { guardada: true })).dam, "closed");
  // Building: the dam is open and each step has its channel.
  const steps = [step("Done", "hecho"), step("Merged", "integrado"), step("In review", "te_toca"), step("In progress", "construyendo"), step("Ready", "lista"), step("Backlog", "despues")];
  const b = geo.rioOf(at("lista", { promoted_to: "MIA-I8", built: { steps, published_at: null } }));
  assert.equal(b.here, 6);
  assert.equal(b.dam, "open");
  assert.deepEqual(b.chans, ["done", "done", "you", "live", "todo", "todo"]);
  assert.equal(b.front, "you");
  assert.deepEqual(b.steps, { done: 2, total: 6 });
  const pub = geo.rioOf(at("lista", { built: { steps: steps.map(() => step("Released", "publicado")), published_at: "2026-11-17T21:00:00Z" } }));
  assert.equal(pub.here, 7);
  assert.ok(pub.chans.every((c: string) => c === "fin"));
  assert.equal(geo.isAlive(pub), false, "nothing moves once published");
  // An initiative with no idea: no stop delivered, the delta complete.
  const alone = geo.rioOf({ ...at("lista"), stops: STOPS.map((s) => ({ stop: s, delivered: false, state: "done" })), built: { steps, published_at: null } });
  assert.deepEqual(alone.delivered, [false, false, false, false, false, false]);
  assert.equal(alone.chans.length, 6);
});

test("I65-2: more than sixteen steps are grouped, the most urgent state wins", () => {
  const list = [...Array(18).fill("done"), "you", ...Array(9).fill("todo")];
  const g = geo.groupChans(list);
  assert.equal(g.per, 2);
  assert.equal(g.chans.length, 14);
  assert.equal(g.chans[9], "you");
  assert.equal(g.chans[0], "done");
  assert.deepEqual(geo.groupChans(["done", "live"]), { chans: ["done", "live"], per: 1 });
});

test("I65-2: the text says the stop, the state and the steps done", () => {
  assert.equal(geo.rioLabel(geo.rioOf(at("diseno", { state: "espera" }))), "Corriente: parada Diseño, te toca.");
  assert.equal(geo.rioLabel(geo.rioOf(at("lista"))), "Corriente: parada Lista, te toca; la presa «Constrúyelo» espera tu sí; 12 pasos en el plan.");
  const b = geo.rioOf(at("lista", { built: { steps: [step("Done", "hecho"), step("In progress", "construyendo")], published_at: null } }));
  assert.equal(geo.rioLabel(b), "Corriente: en construcción, alguien la trabaja; 1 de 2 pasos hechos.");
  const pub = geo.rioOf(at("lista", { built: { steps: [step("Released", "publicado")], published_at: "x" } }));
  assert.equal(geo.rioLabel(pub), "Corriente: publicada, nada pendiente; 1 de 1 pasos hechos.");
});

// A 2D context that records what is drawn.
function recorder() {
  const ops: string[] = [];
  const rec = (name: string) => (...a: unknown[]) => void ops.push(`${name}(${a.map((x) => (typeof x === "number" ? x.toFixed(2) : typeof x === "string" ? x : "·")).join(",")})`);
  const g: Json = { ops };
  for (const f of ["clearRect", "beginPath", "lineTo", "closePath", "fill", "stroke", "fillRect", "arc", "setTransform"]) g[f] = rec(f);
  g.createLinearGradient = () => ({ addColorStop: () => undefined });
  g.createRadialGradient = () => ({ addColorStop: () => undefined });
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "shadowColor", "shadowBlur", "lineCap"])
    Object.defineProperty(g, p, { set: (v: unknown) => void ops.push(`${p}=${typeof v === "object" ? "grad" : v}`), get: () => undefined });
  return g;
}
const TOK = { violet: "#8b5cf6", violet2: "#a78bfa", amber: "#ffb454", green: "#6ee7a0", surface: "#0c0c10", text: "#f4f4f6" };

test("I65-2: the still frame is the same at any time (reduced motion shows the final state, quiet)", () => {
  const steps = [step("Done", "hecho"), step("In progress", "construyendo")];
  for (const m of [geo.rioOf(at("lista")), geo.rioOf(at("investigacion", { state: "trabajando" })), geo.rioOf(at("lista", { built: { steps, published_at: null } }))]) {
    const a = recorder();
    const b = recorder();
    rio.drawRio(a, m, "ficha", 1374, TOK, 0, null);
    rio.drawRio(b, m, "ficha", 1374, TOK, 37.5, null);
    assert.deepEqual(a.ops, b.ops);
    assert.ok(a.ops.length > 50);
  }
  // The row size draws the same model, smaller.
  const r = recorder();
  rio.drawRio(r, geo.rioOf(at("plan")), "fila", 220, TOK, 0, null);
  assert.ok(r.ops.some((o: string) => o.startsWith("arc(")));
});
