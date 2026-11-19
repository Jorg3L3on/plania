// NEWPROJ-7: Borrar proyecto's words (ui/src/lib/borrar.ts) and its sheet, server-rendered with fake data. No DB.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const words = await load("lib/borrar.ts");
const { BorrarProyecto } = await load("components/corriente/hoja-borrar.tsx");
const { hojaOf } = await load("pages/corriente.tsx");

test("NEWPROJ-7: the sheet's words name the project, say what goes and that its code and repo stay", () => {
  assert.equal(words.borrarTitle("Café Lindo"), "¿Borrar Café Lindo?");
  const rows = words.borrarRows("Café Lindo", 0) as [string, string][];
  assert.deepEqual(rows.map(([k]) => k), ["Se detiene", "Se borra", "Y además", "Se queda"]);
  const text = Object.fromEntries(rows);
  assert.equal(text["Se detiene"], "Nada está corriendo ahora.");
  assert.match(text["Se borra"]!, /^Café Lindo en Plania: .*su equipo/);
  assert.match(text["Y además"]!, /copias de trabajo.*se pierde/);
  assert.equal(text["Se queda"], "El código de Café Lindo y su repositorio, tal cual. Nada se borra en GitHub.");
  assert.equal(Object.fromEntries(words.borrarRows("X", 1))["Se detiene"], "El agente que está trabajando se detiene antes de borrar.");
  assert.equal(Object.fromEntries(words.borrarRows("X", 3))["Se detiene"], "Los 3 agentes que están trabajando se detienen antes de borrar.");
  assert.equal(words.borrarButton("Café Lindo", false), "Borrar Café Lindo");
  assert.equal(words.borrarButton("Café Lindo", true), "Borrando…");
  for (const [, v] of rows) assert.doesNotMatch(v, /sandbox|NEWPROJ|jl\//i);
});

test("NEWPROJ-7: it cannot be confirmed by accident: the project's name and a six-digit code are both needed", () => {
  assert.equal(words.canBorrar("", "Café Lindo", "123456"), false);
  assert.equal(words.canBorrar("Café", "Café Lindo", "123456"), false);
  assert.equal(words.canBorrar("Café Lindo", "Café Lindo", ""), false);
  assert.equal(words.canBorrar("Café Lindo", "Café Lindo", "12345"), false);
  assert.equal(words.canBorrar("Café Lindo", "Café Lindo", "123456"), true);
  assert.equal(words.canBorrar("  cafe   lindo ", "Café Lindo", "123456"), true, "accents, case and spaces do not matter");
});

test("NEWPROJ-7: each owner-code refusal has its own Spanish sentence", () => {
  const unset = words.borrarError("OWNER_CODE_UNSET");
  const required = words.borrarError("OWNER_CODE_REQUIRED");
  const invalid = words.borrarError("OWNER_CODE_INVALID");
  assert.equal(new Set([unset, required, invalid, words.borrarError("HTTP_500")]).size, 4);
  assert.match(unset, /Plomería/);
  assert.match(required, /Falta el código del dueño/);
  assert.match(invalid, /no sirve o ya se usó/);
  for (const s of [unset, required, invalid]) assert.doesNotMatch(s, /OWNER_CODE|_/);
});

test("NEWPROJ-7: the sheet renders the project's name, the code field and a button that starts off; ?hoja=borrar:<slug> opens it", () => {
  const p = { slug: "cafe-lindo", title: "Café Lindo", team: [{ state: "running" }, { state: "idle" }] };
  const html = renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      React.createElement(MemoryRouter, null, React.createElement(BorrarProyecto, { p, onClose: () => {}, onDone: () => {} })),
    ),
  );
  assert.ok(html.includes("¿Borrar Café Lindo?"));
  assert.ok(html.includes("Escribe «Café Lindo» para confirmar."));
  assert.ok(html.includes('aria-label="Código del dueño"'));
  assert.ok(html.includes("El agente que está trabajando se detiene antes de borrar."));
  assert.match(html, /<button[^>]*disabled=""[^>]*data-control="borrar-si"|<button[^>]*data-control="borrar-si"[^>]*disabled=""/);
  assert.deepEqual(hojaOf("?hoja=borrar:cafe-lindo"), { kind: "borrar", slug: "cafe-lindo" });
});
