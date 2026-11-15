// PLA-I48-6: Cómo probarla, the idle floor and the first setup, with fake F3 data. Server-rendered and handler-level.
//   #1  the walkthrough from a doc and from capture pages; «Ir» changes the window's page; «Algo falló» fills Pedir
//   #2  the idle state's two buttons are in test/i40-floor-ui.test.ts (I40-4 #1, PLA-I48-6)
//   #3  the setup state calls the configurar route, and the read that comes back shows the off state
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { read, server } from "./i48-fixtures.js";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const fi = await load("components/compania/edificio/maquinas-ficha.tsx");
const ui = await load("components/compania/edificio/maquinas.tsx");
const lib = await load("lib/maquinas.ts");

type Json = Record<string, any>;
const h = React.createElement;
const ok = (data: unknown) => ({ status: "ok", data, retry: () => {} });
const walk = (el: any) => {
  const all: any[] = [];
  const go = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(go);
    all.push(n);
    if (typeof n.type === "function") return go(n.type(n.props));
    go(n.props?.children);
  };
  go(el);
  return all;
};

const fromDoc: Json = {
  from: "doc",
  doc_id: "11111111-2222-4333-8444-555555555555",
  user: "prueba@example.com",
  can_password: true,
  steps: [
    { n: 1, text: "Abre el formulario en /registro", page: "formulario", path: "/registro" },
    { n: 2, text: "Entra al panel con el usuario de prueba", page: "panel", path: "/panel" },
    { n: 3, text: "Revisa que llegue el correo de bienvenida", page: null, path: null },
  ],
};
const fromPages: Json = {
  from: "pages",
  doc_id: null,
  user: "prueba@example.com",
  can_password: true,
  steps: [
    { n: 1, text: "Abre Formulario de bienvenida", page: "formulario", path: "/registro" },
    { n: 2, text: "Abre Panel del equipo (con la sesión de prueba)", page: "panel", path: "/panel" },
  ],
};

test("I48-6 #1: the walkthrough from the doc: steps, the test user, ticks, Ir only where the step names a page", () => {
  const out = renderToStaticMarkup(h(fi.FichaProbar, { recorrido: ok(fromDoc), ticks: [1], page: "formulario", acts: {} }));
  assert.match(out, /data-walk="doc"/);
  assert.match(out, /1 de 3 hechos/);
  assert.match(out, /<code>prueba@example\.com<\/code>/);
  assert.match(out, /data-control="maq-contrasena"[^>]*>Copiar una nueva</);
  assert.equal((out.match(/data-control="maq-ir"/g) ?? []).length, 2, "the third step names no page");
  assert.match(out, /<li data-done="true" data-here="true">/);
  assert.equal((out.match(/data-control="maq-fallo"/g) ?? []).length, 3);
  const pw = renderToStaticMarkup(h(fi.FichaProbar, { recorrido: ok(fromDoc), ticks: [], password: "Nueva-Clave-123", acts: {} }));
  assert.match(pw, /data-password="true">Contraseña nueva: <code>Nueva-Clave-123<\/code> \(solo se muestra esta vez\)/);
});

test("I48-6 #1: without the doc, one step per capture page, and it says the PO writes the real one", () => {
  const out = renderToStaticMarkup(h(fi.FichaProbar, { recorrido: ok(fromPages), ticks: [], acts: {} }));
  assert.match(out, /data-walk="pages"/);
  assert.match(out, /Todavía no hay un «Recorrido de prueba»: el PO lo escribe con lo aceptado/);
  assert.match(out, /Abre Panel del equipo \(con la sesión de prueba\)/);
  assert.match(renderToStaticMarkup(h(fi.FichaProbar, { recorrido: ok({ ...fromPages, steps: [], from: "none" }), ticks: [], acts: {} })), /data-state="empty"/);
  assert.match(renderToStaticMarkup(h(fi.FichaProbar, { recorrido: { status: "loading" }, ticks: [], acts: {} })), /data-state="loading"/);
  assert.match(renderToStaticMarkup(h(fi.FichaProbar, { recorrido: { status: "error", retry: () => {} }, ticks: [], acts: {} })), /data-state="error"/);
});

test("I48-6 #1: Ir moves the window to the step's page; Algo falló fills Pedir with the step; a tick is kept per browser", () => {
  let page = "formulario";
  const asked: string[] = [];
  const ticked: [number, boolean][] = [];
  const acts = { onIr: (p: Json) => (page = p.page), onFallo: (p: Json) => asked.push(lib.pedirFallo(p)), onTick: (n: number, d: boolean) => ticked.push([n, d]) };
  const all = walk(fi.FichaProbar({ recorrido: ok(fromDoc), ticks: [], page, acts }));
  all.filter((e) => e.props?.["data-control"] === "maq-ir")[1].props.onClick();
  assert.equal(page, "panel");
  // The window shows that page now: its tab is pressed and the address bar names it.
  const win = renderToStaticMarkup(h(ui.Maquinas, { read: ok(read({ server: server({ phase: "live", managed: true, port: 3000, url: "http://localhost:3000" }) })), page, acts: {} }));
  assert.match(win, /aria-pressed="true" title="Panel del equipo" data-page="panel"/);
  assert.match(win, /<code title="http:\/\/localhost:3000\/panel">localhost:3000\/panel<\/code>/);
  all.filter((e) => e.props?.["data-control"] === "maq-fallo")[2].props.onClick();
  assert.deepEqual(asked, ["Al probar la app, el paso 3 falló: «Revisa que llegue el correo de bienvenida». "]);
  all.find((e) => e.props?.["data-control"] === "maq-paso").props.onChange();
  assert.deepEqual(ticked, [[1, true]]);
  assert.equal(lib.tickKey("lumen", fromDoc.doc_id), `edi-probar:lumen:${fromDoc.doc_id}`);
  // The page wires «Algo falló» to the floor's Pedir prefill.
  const live = readFileSync(new URL("../ui/src/components/compania/edificio/maquinas-live.tsx", import.meta.url), "utf8");
  assert.ok(live.includes("onFallo: (p: Paso) => onPedir(s, pedirFallo(p))"));
  const page2 = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page2.includes("onPedir: (slug, text) => setPrefill((x) => ({ ...x, [slug]: text }))"));
});

test("I48-6 #3: the setup state calls configurar, and the read that comes back shows the off state", () => {
  const unconfigured = read({
    configured: false,
    pages: [],
    server: server({ command: null, branch: null }),
    found: { manager: "pnpm", scripts: [{ name: "dev", command: "vite" }], dev: "pnpm dev --port {port}", port: 5180, migrate: null, seed: null, test: "pnpm test", missing: [] },
  });
  const calls: string[] = [];
  const all = walk(ui.Maquinas({ read: ok(unconfigured), acts: { onConfigurar: () => calls.push("configurar") } }));
  const html = renderToStaticMarkup(h(ui.Maquinas, { read: ok(unconfigured), acts: {} }));
  assert.match(html, /Este piso no sabe cómo encenderse/);
  assert.match(html, /<code>pnpm dev --port 5180<\/code>/);
  all.find((e) => e.props?.["data-control"] === "maq-configurar").props.onClick();
  assert.deepEqual(calls, ["configurar"]);
  // What configurar answers: the floor configured and off.
  const after = renderToStaticMarkup(h(ui.Maquinas, { read: ok(read({ server: server({ command: "pnpm dev --port 5180" }) })), acts: {} }));
  assert.match(after, /data-maq="off"/);
  assert.match(after, /data-control="maq-encender-app"[^>]*>Encender la app</);
  // A repo with nothing to start says what is missing.
  const nothing = renderToStaticMarkup(h(ui.Maquinas, { read: ok(read({ configured: false, pages: [], found: { manager: null, scripts: [], dev: null, port: null, migrate: null, seed: null, test: null, missing: ["package.json"] } })), acts: {} }));
  assert.match(nothing, /data-missing="true">Falta package\.json/);
  assert.ok(!nothing.includes("maq-configurar"));
});
