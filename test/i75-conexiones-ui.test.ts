// PLA-I75 (Conexiones): a seat's fifth tab without a browser. The catalog's order (its role's first, then by kind,
// connected ones out, login-only ones last in their kind), the tab with an agent's amber request, a cable with its
// usage, its blocked calls, its write switches off, a paid label and a version to accept, and the wide catalog.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/conexiones.ts");
const comp = await load("components/corriente/conexiones.tsx");
const h = React.createElement;
type M = Record<string, any>;

const item = (id: string, group: string, over: M = {}): M => ({ id, group, recommended: false, price: "gratis", version: "1.0.0", keys: [], reads: 3, writes: [], never: [], unattended: true, needs: null, connected: false, ...over });
const catalog = [
  item("shadcn", "interfaz", { recommended: true }),
  item("context7", "interfaz", { keys: [{ env: "CONTEXT7_API_KEY", name: "CONTEXT7_API_KEY", optional: true }] }),
  item("figma", "errores", { recommended: true, unattended: false, price: "pago", version: "remota" }),
  item("vercel", "errores", { unattended: false, version: "remota" }),
  item("sentry", "errores", { price: "por-confirmar" }),
  item("github", "codigo", { connected: true }),
];

test("I75 UI #1: the catalog lists its role's first, then by kind; connected ones are out; login-only ones go last", () => {
  const s = lib.catalogSections(catalog);
  assert.deepEqual(s.map((x: M) => x.id), ["recomendadas", "interfaz", "errores"]);
  assert.deepEqual(s[0].items.map((x: M) => x.id), ["shadcn"]);
  assert.deepEqual(s[2].items.map((x: M) => x.id), ["sentry", "figma", "vercel"]);
  assert.ok(lib.isPaid("pago") && lib.isPaid("por-confirmar") && !lib.isPaid("gratis-limite"));
});

const cable = (server: string, over: M = {}): M => ({
  server,
  version: "v2.2.0",
  custom: null,
  reviewed: true,
  paid: false,
  price: "gratis",
  keys: [{ env: "GITHUB_PERSONAL_ACCESS_TOKEN", name: "GH_TOKEN", optional: false, set: true }],
  reads: ["get_issue"],
  writes: [
    { tool: "create_issue", on: false },
    { tool: "push_files", on: false },
  ],
  never: ["merge_pull_request"],
  change: null,
  usage: { calls: 7, failed: 1, blocked: 2, runs: 3, tools: [{ tool: "get_issue", ok: 5, failed: 0, blocked: 0 }] },
  problem: null,
  ...over,
});
const read = (over: M = {}): M => ({ agent: "taller-t", role: "taller", catalog, connections: [], requests: [], blocked: [], llaves: ["GH_TOKEN"], ...over });
const render = (el: React.ReactElement, data: M) => {
  const client = new QueryClient();
  client.setQueryData(["conexiones", "tienda", "taller-t"], data);
  return renderToStaticMarkup(h(QueryClientProvider, { client }, h(MemoryRouter, {}, el)));
};
const p = { slug: "tienda", team: [] };
const m = { agent: "taller-t", role: "taller" };

test("I75 UI #2: a new seat has only Plania; QA adds the browser", () => {
  assert.match(render(h(comp.ConexionesTab, { p, m, onCatalog: () => undefined }), read()), /Solo Plania\. Sus corridas no tienen otra herramienta\./);
  assert.match(render(h(comp.ConexionesTab, { p, m, onCatalog: () => undefined }), read({ role: "qa" })), /y el navegador cuando recorre la copia de prueba/);
});

test("I75 UI #3: a cable shows its use, what failed and was blocked, its writes off, what is never on; a request is amber", () => {
  const out = render(
    h(comp.ConexionesTab, { p, m, onCatalog: () => undefined }),
    read({
      connections: [cable("github"), cable("sentry", { version: "0.40.0", price: "por-confirmar", paid: true, writes: [], never: [], keys: [], change: { from: "0.40.0", to: "0.50.0", added: ["get_doc"], removed: [], nowWrites: [] } })],
      requests: [{ id: "r1", server: "context7", reason: "Para la librería de fechas.", at: "2026-11-24T10:00:00Z" }],
      blocked: [{ run: "x", at: "2026-11-24T10:00:00Z", server: "github", tool: "create_issue", n: 2, task: "TND-1" }],
    }),
  );
  assert.match(out, /Pide Context7/);
  assert.match(out, /cor-label amber/);
  assert.match(out, /data-control="pedido-si-context7"/);
  assert.match(out, /7 llamadas en 3 corridas · 7 días/);
  assert.match(out, /1 falló/);
  assert.match(out, /2 bloqueadas/);
  assert.match(out, /role="switch" aria-checked="false"[^>]*data-control="escribe-github-create_issue"/);
  assert.match(out, /Nunca: merge_pull_request\./);
  assert.match(out, /GH_TOKEN/);
  assert.match(out, /tiene valor/);
  // The paid one says so; the new version waits.
  assert.match(out, /Precio por confirmar/);
  assert.match(out, /Versión nueva: 0\.40\.0 → 0\.50\.0/);
  assert.match(out, /Trae: get_doc\./);
  assert.match(out, /data-control="aceptar-version-sentry"/);
  assert.match(out, /Lo que se le bloqueó/);
  assert.match(out, /data-control="conectar-otra"/);
  // Never a key value: the read carries none, and nothing invents one.
  assert.doesNotMatch(out, /ghp_/);
});

test("I75 UI #4: the wide catalog: its role's first, a login-only entry cannot be connected, expert mode is there", () => {
  const out = render(h(comp.CatalogPanel, { p, m, seat: "Taller", onClose: () => undefined }), read());
  assert.match(out, /Para su puesto/);
  assert.ok(out.indexOf('data-entrada="shadcn"') < out.indexOf('data-entrada="context7"'));
  assert.doesNotMatch(out, /data-entrada="github"/, "already connected");
  assert.match(out, /data-control="conectar-shadcn"/);
  assert.doesNotMatch(out, /data-control="conectar-figma"/);
  assert.match(out, /Pide iniciar sesión/);
  assert.match(out, /De pago/);
  assert.match(out, /Llave \(opcional\)/);
  assert.match(out, /Una propia \(modo experto\)/);
});
