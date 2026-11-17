// PLA-I54-1: the floor's tube and Pedir's two modes. Server-rendered and handler-level; no browser, no database.
// Fake names only.
//   #3  the tube sits between the stage board and the Pedir bar, on the board's grid, a capsule under its stop,
//       coloured by state, with the valve; folded to one line when empty; no tube from an older server
//   #4  Pedir's side page: a textarea (2000), the pictures' slot, and the two modes with Darle forma by default
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const floorUi = await load("components/compania/edificio/floor.tsx");
const tuboUi = await load("components/compania/edificio/tubo.tsx");
const askUi = await load("components/compania/edificio/ask.tsx");
const edificio = await load("lib/edificio.ts");

type Json = Record<string, any>;
const h = React.createElement;
const NOW = new Date("2026-11-16T20:00:00Z").getTime();
const TZ = "America/Mexico_City";
const noop = () => {};
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const pedido = (key: string, title: string, stop: string, state: string, patch: Json = {}): Json => ({ key, title, stop, state, who: "product-owner", images: 0, understood: null, question: null, guardada: false, at: "2026-11-16T19:00:00Z", ...patch });
const PEDIDOS = [
  pedido("DEM-IDEA5", "Que el registro pida menos datos", "entendido", "espera", { question: { id: "q1", text: "¿Quitamos el segundo teléfono?" } }),
  pedido("DEM-IDEA6", "Recordatorio por WhatsApp un día antes", "diseno", "trabajando", { who: "artist", images: 2 }),
  pedido("DEM-IDEA4", "Compartir la ficha por enlace", "lista", "quieta"),
  pedido("DEM-IDEA7", "Una nueva", "buzon", "cola"),
  pedido("DEM-IDEA3", "Usar el panel sin conexión", "investigacion", "quieta", { guardada: true }),
];
const project = (patch: Json = {}): Json => ({
  slug: "demo",
  title: "Demo",
  paused: false,
  light: "ok",
  goal: "Tienda lista",
  team: [
    { agent: "product-owner-demo", role: "product-owner", state: "idle", now: null, queue: [] },
    { agent: "taller-demo", role: "taller", state: "idle", now: null, queue: [] },
  ],
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  work: { open: 0, in_progress: 0 },
  usage: { tokens: 0 },
  route: null,
  orders: [],
  latest: [],
  stale_requests: [],
  tablero: { initiatives: [], loose: [], loose_done: 0 },
  ahora: [],
  pedidos: PEDIDOS,
  ...patch,
});
const floorHtml = (p: Json, extra: Json = {}) =>
  renderToStaticMarkup(h(MemoryRouter, null, h(floorUi.Floor, { project: p, now: NOW, timeZone: TZ, decisions: [], ventanal: (parts: Json) => h(React.Fragment, null, parts.home.body, parts.board, parts.tubo), ask: h("button", { "data-control": "pedir-abrir" }, "Pedir"), ...extra })));

test("I54-1 #3: the tube sits between the board and Pedir, each capsule under its stop, coloured by state, with the valve", () => {
  const html = floorHtml(project(), { tubo: { onOpen: noop, onGuardadas: noop } });
  // PLA-I55-1: the tube is a part of the ventanal (the Pedido tab draws it); the index carries it in small.
  const tube = html.indexOf('class="tubo"');
  const idx = html.indexOf('class="edi-idx"');
  const pedir = html.indexOf('class="edi-askbar"');
  assert.ok(tube > 0 && idx > tube && pedir > idx, "the ventanal (tube), then the index, then Pedir");
  assert.match(html, /data-control="indice-ideas" data-live="4"/);
  assert.equal((html.match(/class="edi-ix-tube"[\s\S]*?<\/span>/)?.[0].match(/<i /g) ?? []).length, 4, "a dot per idea taking shape");
  assert.match(text(html), /Ideas tomando forma · 4/);
  assert.match(html, /aria-label="Pedidos de Demo"/);
  // The six stops in the board's order, and the valve.
  assert.deepEqual([...html.matchAll(/data-stop="([a-z]+)"/g)].map((m) => m[1]), ["buzon", "entendido", "investigacion", "diseno", "plan", "lista"]);
  assert.match(html, /class="tubo-valve"/);
  assert.match(text(html), /Tomando forma · 4/);
  assert.match(text(html), /Guardadas · 1/);
  // Each capsule stands at its stop; the shelved one is not in the tube.
  const at: Record<string, string> = {};
  for (const cell of html.split('class="tubo-stop"').slice(1)) {
    const stop = /data-stop="([a-z]+)"/.exec(cell)![1]!;
    for (const m of cell.matchAll(/data-cap="([^"]+)"/g)) at[m[1]!] = stop;
  }
  assert.deepEqual(at, { "DEM-IDEA7": "buzon", "DEM-IDEA5": "entendido", "DEM-IDEA6": "diseno", "DEM-IDEA4": "lista" });
  // State words and colours.
  assert.match(html, /data-cap="DEM-IDEA5" data-state="espera"[^>]*--sc:var\(--status-jorge\)/);
  assert.match(html, /data-cap="DEM-IDEA6" data-state="trabajando" data-live=""[^>]*--sc:var\(--status-now\)/);
  assert.deepEqual(
    ["espera", "trabajando", "quieta", "cola", "valvula"].map((s) => tuboUi.pedidoWord({ state: s, who: "artist" })),
    ["Te espera", "Artist la trabaja", "Quieta", "En el buzón", "Pasando la válvula"],
  );
  assert.match(text(html), /▣ 2/, "the image count, once F5 fills it");
  assert.match(html, /aria-label="Recordatorio por WhatsApp un día antes: Artist la trabaja, en Diseño, 2 imágenes"/);
});

test("I54-1 #3: a capsule and Guardadas call their handlers; without handlers they are plain", () => {
  const calls: string[] = [];
  const acts = { onOpen: (slug: string, key: string) => calls.push(`open ${slug} ${key}`), onGuardadas: (slug: string) => calls.push(`shelf ${slug}`), selected: "DEM-IDEA4" };
  const tree = tuboUi.Tubo({ slug: "demo", title: "Demo", pedidos: PEDIDOS, acts }) as React.ReactElement;
  const found: React.ReactElement[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const el = n as React.ReactElement<Json>;
    if (typeof el.type === "function") return walk((el.type as (p: Json) => unknown)(el.props));
    if (el.props?.["data-control"]) found.push(el);
    walk(el.props?.children);
  };
  walk(tree);
  for (const el of found) (el.props as Json).onClick({ currentTarget: {} });
  assert.deepEqual(calls.sort(), ["open demo DEM-IDEA4", "open demo DEM-IDEA5", "open demo DEM-IDEA6", "open demo DEM-IDEA7", "shelf demo"].sort());
  const html = renderToStaticMarkup(tree);
  assert.match(html, /aria-current="true"[^>]*title="Compartir la ficha por enlace"/, "the open one is marked");
  const plain = renderToStaticMarkup(h(tuboUi.Tubo, { slug: "demo", title: "Demo", pedidos: PEDIDOS }));
  assert.equal(/<button/.test(plain), false);
});

test("I54-1 #3: an empty tube folds to one line; an older server draws no tube", () => {
  const folded = floorHtml(project({ pedidos: [] }));
  assert.match(folded, /data-tubo="folded"/);
  assert.equal(/tubo-stop|tubo-valve/.test(folded), false);
  assert.match(text(folded), /Nada tomando forma/);
  const shelfOnly = floorHtml(project({ pedidos: [PEDIDOS[4]] }), { tubo: { onGuardadas: noop } });
  assert.match(shelfOnly, /data-tubo="folded"/);
  assert.match(shelfOnly, /data-control="tubo-guardadas"/);
  const old = floorHtml(project({ pedidos: undefined }));
  assert.equal(old.includes('class="tubo"'), false);
  // On the board's grid: the same 150 px label and six columns, never under 780 px.
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  const grid = (sel: string) => new RegExp(`\\.${sel} \\{[^}]*grid-template-columns: 150px repeat\\(6, minmax\\(0, 1fr\\)\\)[^}]*min-width: 780px`).test(css);
  assert.ok(grid("sb-grid") && grid("tubo-grid"), "the tube uses the board's columns");
  assert.match(css, /\.tubo\[data-tubo="folded"\] \{ flex: none; \}/);
});

test("I54-1 #4: Pedir's side page has the textarea, the pictures' slot and the two modes, Darle forma by default", () => {
  const sent: Json[] = [];
  const view = (patch: Json = {}) => h(askUi.AskView, { project: project(), text: "", setText: noop, onSubmit: (i: Json) => sent.push(i), ...patch });
  const html = renderToStaticMarkup(view());
  assert.match(html, /<textarea[^>]*id="ask-demo"[^>]*maxLength="2000"|<textarea[^>]*maxLength="2000"[^>]*id="ask-demo"/);
  assert.equal(/type="checkbox"|Que empiece ya/.test(html), false, "the old switch is gone");
  assert.match(html, /data-slot="imagenes"/);
  assert.ok(html.indexOf('data-slot="imagenes"') < html.indexOf('data-mode="forma"'), "pictures above the modes");
  const radio = (v: string) => new RegExp(`<input[^>]*value="${v}"[^>]*>`).exec(html)![0];
  assert.match(radio("forma"), /checked=""/);
  assert.equal(/checked=""/.test(radio("ya")), false);
  assert.match(text(html), /Darle forma .* Nadie escribe código hasta que digas «Constrúyelo»/);
  assert.match(text(html), /Hacerlo ya Un cambio pequeño y claro/);
  // The slot takes the picker.
  assert.match(renderToStaticMarkup(view({ images: h("div", { id: "drop" }) })), /data-slot="imagenes"><div id="drop">/);
  // Submitting sends the text and the chosen mode.
  const submit = (patch: Json) => {
    const form = (askUi.AskView({ project: project(), text: "", setText: noop, onSubmit: (i: Json) => sent.push(i), ...patch }) as React.ReactElement<Json>).props;
    form.onSubmit({ preventDefault: noop });
  };
  submit({ text: "  un recordatorio  " });
  submit({ text: "corrige el botón", mode: "ya" });
  submit({ text: "ok" });
  assert.deepEqual(sent, [
    { text: "un recordatorio", mode: "forma" },
    { text: "corrige el botón", mode: "ya" },
  ]);
  // Where it landed, in plain words.
  assert.equal(edificio.askedLine({ key: "DEM-IDEA8", title: "x", po: "po", mode: "forma", wake: "queued", woke: null }, "Demo"), "Entró al tubo como DEM-IDEA8; el PO de Demo le da forma ahora.");
  assert.equal(edificio.askedLine({ key: "DEM-IDEA8", title: "x", po: "po", mode: "forma", wake: "busy", woke: null }, "Demo"), "Entró al tubo como DEM-IDEA8; el PO de Demo la abre en su turno.");
  // The page sends the mode, and Que PO lo planee stays a ticket that starts now.
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("steer.onAsk(slug, { text: input.text, mode: input.mode, consulta: input.consulta })"));
  assert.ok(page.includes('.askProject(slug, { text, mode: "ya" })'));
});
