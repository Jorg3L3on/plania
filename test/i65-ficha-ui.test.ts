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

// ---- PLA-I65-3/4/5: the ficha and the rows, rendered on the server with a seeded read.
import { readdirSync, readFileSync, statSync } from "node:fs";
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
const primaries = (out: string) => (out.match(/cor-btn primary/g) ?? []).length;

test("I65-3: an idea at each stop opens the ficha on its delivery, with at most one white button and the stops as tabs", () => {
  const panels: Record<string, RegExp> = { buzon: /«Una pantalla de usuarios»/, entendido: /quieres una pantalla de usuarios[\s\S]*<strong>lista<\/strong>/, investigacion: /Recomienda · opción 2[\s\S]*Lista con acciones/, diseno: /Marco 1: Lista/, plan: /data-pasos="3"/, lista: /Tres pasos esperan|3 pasos esperan/ };
  for (const s of STOPS) {
    const out = ficha(detail(s));
    assert.match(out, new RegExp(`data-sel="${s}"`), s);
    assert.match(out, panels[s]!, s);
    assert.ok(primaries(out) <= 1, `${s}: ${primaries(out)} primaries`);
    assert.equal((out.match(/role="tab"/g) ?? []).length, 8, "six stops, Construcción and Publicado");
    assert.equal((out.match(/tabindex="0" class="cor-ficha-tab/g) ?? []).length, 1, "one tab in the Tab order (arrows move between them)");
    assert.match(out, /role="tabpanel"/);
    assert.match(out, /role="img" aria-label="Corriente: parada/);
  }
  assert.match(ficha(detail("lista")), /data-control="ficha-construir"[^>]*>Constrúyelo</);
  assert.match(ficha(detail("entendido")), /data-control="ficha-ok"[^>]*>Así es</);
  // A stop with nothing delivered says «Todavía no» and what unlocks it, never the doc's title.
  // PLA-67: a stop being worked on (nobody quiet) is «en curso»; quiet, it «no ha empezado».
  const empty = ficha({ ...detail("entendido"), quiet_since: "2026-11-17T20:00:00Z", stops: STOPS.map((s, i) => stopRow(s, i, 1, i === 1 ? { delivered: false } : {})) });
  assert.match(empty, /Todavía no[\s\S]*Entendido no ha empezado/);
  const working = ficha({ ...detail("entendido"), stops: STOPS.map((s, i) => stopRow(s, i, 1, i === 1 ? { delivered: false } : {})) });
  assert.match(working, /Entendido en curso/);
  // PLA-82 (F-10): Entendido shows only the fields the PO wrote; no «Pendiente» filler.
  const und = ficha(detail("entendido"));
  assert.match(und, /<dt>Problema<\/dt>[\s\S]*<dt>Solución<\/dt>[\s\S]*<dt>Tamaño<\/dt>/);
  assert.doesNotMatch(und, /<dt>Fuera<\/dt>|<dt>Riesgos<\/dt>|Pendiente/);
  assert.doesNotMatch(ficha({ ...detail("entendido"), ficha: { problema: null, solucion: null, fuera: null, tamano: null, riesgos: null } }), /cor-ficha-cells/);
  // PLA-82 (F-16): after «Constrúyelo» the plan's steps no longer «esperan tu sí».
  const built = ficha({ ...detail("lista"), state: "valvula" });
  assert.match(built, /Dijiste «Constrúyelo»\. El PO está subiendo/);
  assert.doesNotMatch(built, /esperan? tu sí/);
  // His question takes «Ahora»; PLA-63: it is read once (the bar), and the panel repeats it only when too long for the bar.
  const q = ficha({ ...detail("investigacion"), question: { id: "q1", text: "¿Un día antes o el mismo día? Una pregunta corta." }, question_options: ["Un día antes", "El mismo día"] });
  assert.equal((q.match(/Una pregunta corta/g) ?? []).length, 2, "the bar's text and its title attribute, not the panel");
  assert.ok(!/data-pregunta-texto/.test(q));
  const long = ficha({ ...detail("investigacion"), question: { id: "q2", text: `¿${"Una pregunta larga que no se corta, ".repeat(4)}?` }, question_options: [] });
  assert.match(long, /data-pregunta-texto[\s\S]*Una pregunta larga que no se corta/);
  assert.match(q, /data-control="ficha-contestar"/);
  assert.ok(primaries(q) <= 1);
  // Saved: Restaurar is «Ahora»'s button.
  assert.match(ficha({ ...detail("plan"), guardada: true }), /data-control="ficha-restaurar-ahora"[^>]*>Restaurar/);
});

test("I65-4: an initiative opens on Construcción with a channel per step; one with no idea opens too", () => {
  const steps = [
    { key: "MIA-I1-1", title: "Botón Cobrar", status: "Done", phase: 1, etapa: "hecho", pr: { number: 41, state: "merged", url: "u" } },
    { key: "MIA-I1-2", title: "Recibo", status: "In review", phase: 2, etapa: "te_toca", pr: { number: 44, state: "open", url: "u" } },
    { key: "MIA-I1-3", title: "Reembolso", status: "In progress", phase: 3, etapa: "construyendo", pr: null },
  ];
  const built = { key: "MIA-I1", title: "Cobro", status: "Active", version: 3, done: 1, total: 3, can_close: false, steps, prs: [{ number: 41, state: "merged", url: "u", key: "MIA-I1-1" }, { number: 44, state: "open", url: "u", key: "MIA-I1-2" }], published_at: null, evidence: [] };
  const out = ficha({ ...detail("lista"), promoted_to: "MIA-I1", built });
  assert.match(out, /data-ficha="MIA-I1"/);
  assert.match(out, /data-sel="construccion"/);
  assert.match(out, />Iniciativa</);
  assert.match(out, /nació de[\s\S]*MIA-IDEA5/);
  assert.match(out, /data-rio-dam="open"/);
  assert.match(out, /Te toca<\/span>[\s\S]*Recibo/);
  assert.match(out, /El paso 2, «Recibo», espera que lo aceptes/);
  assert.match(out, /href="\/paso\/MIA-I1-2"/);
  assert.ok(primaries(out) <= 1);
  // The old stops still open their delivery.
  assert.match(out, /data-control="ficha-parada-diseno"/);
  const alone = ficha({ ...detail("lista"), key: "MIA-I3", kind: "initiative", pedido: false, stops: STOPS.map((s) => ({ ...stopRow(s, 0, 9), delivered: false })), built: { ...built, key: "MIA-I3", steps: [steps[0]], total: 1, done: 1 } });
  assert.match(alone, /data-ficha="MIA-I3"/);
  // PLA-63: its idea stops are empty and quiet, as its row in the list draws them.
  assert.ok(!/Sin entrega/.test(alone));
  assert.equal((alone.match(/class="cor-ficha-tab none"/g) ?? []).length, 6);
  const pub = ficha({ ...detail("lista"), promoted_to: "MIA-I2", built: { ...built, key: "MIA-I2", steps: steps.map((s) => ({ ...s, status: "Released", etapa: "publicado" })), published_at: "2026-11-17T21:00:00Z", evidence: [{ key: "MIA-I2-3", kind: "test", cite: "38 de 38", commit: "4c1e9a2abc", env: "prod", at: "x" }] } });
  assert.match(pub, /data-sel="publicado"/);
  assert.match(pub, /38 de 38 · 4c1e9a2/);
  assert.match(pub, /Pedir un ajuste/);
});

test("I65-5, PLA-61: the old open panel, both copies of Journey and the retired Fila row are gone", () => {
  // PLA-I64 made the project's list the place a thing's row lives (components/corriente/todo.tsx).
  // The old open panel and both copies of Journey are gone.
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = `${d}/${f}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(f)) files.push(p);
    }
  };
  walk(new URL("../ui/src", import.meta.url).pathname);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.ok(!src.includes("cor-opened"), `${f} still has cor-opened`);
    assert.ok(!src.includes("const Journey"), `${f} still has Journey`);
    assert.ok(!/cor-rail\b|cor-railstop|cor-stops-grid/.test(src), `${f} still has the rail`);
  }
});

test("PLA-63: an initiative that never was an idea is drawn born (no water before the dam); one from an idea is not", () => {
  const built = { key: "MIA-I3", steps: [{ status: "Done", etapa: "hecho" }], published_at: null, done: 1, total: 1 };
  const none = at("lista", { kind: "initiative", built, stops: at("lista").stops.map((s: Json) => ({ ...s, delivered: false })) });
  assert.equal(geo.rioOf(none).born, true);
  assert.equal(geo.rioOf(at("lista", { kind: "idea", built })).born, false);
});

test("PLA-I74-8: a failed production build opens on Publicado with the host's log and a red bar with «Pedir arreglo»; building and checking say so; a fix asked links to it", () => {
  const steps = [{ key: "MIA-I4-1", title: "Lista", status: "Merged", phase: 1, etapa: "integrado", pr: { number: 51, state: "merged", url: "u" } }];
  const deploy = { state: "error", sha: "abcdef1", url: "https://vercel.com/o/p/dpl_1", probe_url: null, log: "Type error: Property 'precio' does not exist", at: "2026-11-17T21:00:00Z", fix_key: null };
  const built = { key: "MIA-I4", title: "Lista", status: "Active", version: 2, done: 1, total: 1, can_close: false, steps, prs: [{ number: 51, state: "merged", url: "u", key: "MIA-I4-1" }], published_at: null, evidence: [], deploy };
  const out = ficha({ ...detail("lista"), promoted_to: "MIA-I4", built });
  assert.match(out, /data-sel="publicado"/);
  assert.match(out, /data-deploy-log[\s\S]*Property &#x27;precio&#x27; does not exist/);
  assert.match(out, /data-ahora="bad"[\s\S]*Falló la publicación[\s\S]*El servicio no pudo construir la versión de producción/);
  assert.match(out, /data-control="ficha-pedir-arreglo"[^>]*>Pedir arreglo</);
  assert.match(out, /href="https:\/\/vercel.com\/o\/p\/dpl_1"/);
  assert.ok(!/espera publicarse/.test(out));
  const asked = ficha({ ...detail("lista"), promoted_to: "MIA-I4", built: { ...built, deploy: { ...deploy, fix_key: "MIA-I4-2" } } });
  assert.match(asked, /Taller lo está arreglando[\s\S]*href="\/paso\/MIA-I4-2"[^>]*>Ver el arreglo/);
  const checking = ficha({ ...detail("lista"), promoted_to: "MIA-I4", built: { ...built, deploy: { ...deploy, state: "checking", log: null } } });
  assert.match(checking, /data-sel="construccion"/);
  assert.match(checking, /data-ahora="live"[\s\S]*Comprobando[\s\S]*falta que la dirección de producción conteste/);
  assert.ok(!/En producción/.test(checking), "not in production before the live answer");
  const building = ficha({ ...detail("lista"), promoted_to: "MIA-I4", built: { ...built, deploy: { ...deploy, state: "building", log: null } } });
  assert.match(building, /Publicando[\s\S]*construye la versión de producción/);
  const live = ficha({ ...detail("lista"), promoted_to: "MIA-I4", built: { ...built, steps: steps.map((s) => ({ ...s, status: "Released" })), published_at: "2026-11-17T21:00:00Z", deploy: null } });
  assert.match(live, /En producción · /);
});
