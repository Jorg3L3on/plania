// PLA-I3-2: the project view's one bar, the list's head (meta above the sentence, Reanudar under it while paused, the
// pulse's figure) and Borrar in Ajustes. Words from ui/src/lib/barra.ts; components server-rendered with fake data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const words = await load("lib/barra.ts");
const ajustesWords = await load("lib/ajustes.ts");
const todo = await load("components/corriente/todo.tsx");
const ajustes = await load("components/corriente/ajustes.tsx");
const h = React.createElement;
const html = (el: React.ReactElement, client = new QueryClient()) => renderToStaticMarkup(h(QueryClientProvider, { client }, h(MemoryRouter, { initialEntries: ["/ceo"] }, el)));
const page = readFileSync(new URL("../ui/src/pages/corriente.tsx", import.meta.url), "utf8");
const strip = readFileSync(new URL("../ui/src/components/corriente/strip.tsx", import.meta.url), "utf8");

test("I3-2: the bar's words", () => {
  assert.deepEqual(words.barState(false), { label: "En marcha", pausar: "Pausar" });
  assert.deepEqual(words.barState(true), { label: "En pausa", pausar: null });
  assert.equal(words.reanudarLabel("Filmia"), "Reanudar Filmia");
  assert.equal(words.REANUDAR_LINE, "Nada arranca hasta que lo reanudes.");
  assert.equal(words.todoCount(0), null);
  assert.equal(words.todoCount(1), "1 ABIERTA");
  assert.equal(words.todoCount(7), "7 ABIERTAS");
  // PLA-135: Archivo and its count are gone.
  assert.equal((words as Record<string, unknown>).archivoCount, undefined);
  // PLA-I71-1: the door counts agents, not who works (that shows on the list).
  assert.equal(words.teamWord(4), "4 AGENTES");
  assert.equal(words.teamWord(1), "1 AGENTE");
  assert.equal(words.teamWord(4, "en"), "4 AGENTS");
  assert.deepEqual(words.metaLine(null, null, true), { text: "Sin meta todavía", missing: true, link: "Fijar meta" });
  assert.deepEqual(words.metaLine("Primera venta", null, false), { text: "Primera venta · sin fecha", missing: false, link: "Cambiar meta" });
  assert.deepEqual(words.metaLine("Primera venta", "15 DIC", false), { text: "Primera venta · 15 DIC", missing: false, link: "Cambiar meta" });
  assert.equal(words.pulsoLabel(14), "Pasos hechos en 14 días");
});

const frase = { mueve: "Taller construye el registro.", toca: null, falta: "Faltan 3 pasos para la meta." };
const pulso = { days: Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(5 + i).padStart(2, "0")}`, n: i % 3 })), total: 13, tz: "UTC" };
const withPulso = () => {
  const c = new QueryClient();
  c.setQueryData(["pulso", "filmia"], pulso);
  return c;
};

test("I3-2: the head: the meta line above the sentence, the sentence at the title size, the pulse's count a figure", () => {
  const out = html(h(todo.Cabeza, { f: frase, slug: "filmia", meta: { m: words.metaLine(null, null, true), href: "/meta" } }), withPulso());
  const meta = out.indexOf("data-pmeta");
  const sentence = out.indexOf("data-frase");
  assert.ok(meta > 0 && meta < sentence, "the meta line comes before the sentence");
  assert.match(out, />Meta<\/span><span class="cor-pmeta-tx">Sin meta todavía<\/span><a [^>]*href="\/meta"[^>]*>Fijar meta</);
  assert.match(out, /<h2 class="cor-frase-h cor-h1">/);
  assert.match(out, /<b class="cor-figure">13<\/b><span class="cor-label">Pasos hechos en 14 días<\/span>/);
  assert.equal((out.match(/<i /g) ?? []).length, 14, "the pulse keeps its 14 bars");
  assert.ok(!out.includes("data-reanudar"), "running: no Reanudar");
});

test("I3-2: paused, Reanudar <project> is the one white button under the sentence, beside its line", () => {
  const nudge = h("a", { className: "cor-btn secondary", href: "/x" }, "Sumar a alguien");
  const out = html(h(todo.Cabeza, { f: frase, slug: "filmia", nudge, reanudar: { title: "Filmia", href: "/ceo?proyecto=filmia&hoja=reanudar:filmia" } }), withPulso());
  assert.ok(out.indexOf("data-reanudar") > out.indexOf("data-frase"), "under the sentence");
  assert.match(out, /<a class="cor-btn primary" data-control="reanudar" href="\/ceo\?proyecto=filmia&amp;hoja=reanudar:filmia"[^>]*>Reanudar Filmia<\/a><span class="cor-text">Nada arranca hasta que lo reanudes\.<\/span>/);
  assert.equal((out.match(/cor-btn primary/g) ?? []).length, 1, "one white primary");
  assert.ok(!out.includes("Sumar a alguien"), "Reanudar takes the nudge's place");
  // The page passes it only while the project is paused, and keeps the other primaries off then.
  // F6: with the company stopped too, the banner's one button resumes both, so the head shows no second Reanudar.
  assert.match(page, /reanudar=\{pausaDe\(paused, p\.paused\) === "proyecto" \? \{ title: p\.title, href: hojaHref\("reanudar", p\.slug\) \} : undefined\}/);
  assert.match(page, /primary=\{!p\.paused && c\.grupo === "toca"/);
  assert.match(page, /primary=\{!p\.paused && !cosas\.grupos\[0\]\?\.cosas\.length\}/);
});

test("I3-2: Borrar opens from Ajustes (the same ?hoja=borrar sheet), not from the bar", () => {
  const out = html(h(ajustes.AjustesBorrar, { title: "Café Lindo", to: "/ceo?proyecto=cafe-lindo&t=ajustes&hoja=borrar:cafe-lindo" }));
  assert.ok(out.includes(ajustesWords.SECCIONES.borrar.titulo));
  assert.match(out, /<a class="cor-btn danger" data-control="borrar" href="\/ceo\?proyecto=cafe-lindo&amp;t=ajustes&amp;hoja=borrar:cafe-lindo"[^>]*>Borrar Café Lindo<\/a>/);
  assert.equal(ajustesWords.borrarBoton("Café Lindo"), "Borrar Café Lindo");
  assert.match(page, /<Ajustes p=\{p\} borrarTo=\{hojaHref\("borrar", p\.slug\)\} docTo=/);
  assert.ok(!/data-control="borrar"/.test(strip), "the bar has no Borrar");
  assert.ok(!/deleteHref/.test(page));
});

test("I3-2: the page draws one bar for a project and keeps its keys", () => {
  assert.ok(!/\bStrip\b/.test(page.replace(/cor-strip-back/g, "")), "the strip is gone");
  assert.equal((page.match(/<ProjectBar\b/g) ?? []).length, 1);
  // ↑/↓ walk the lanes, E/M open doors, Esc steps out. PLA-135: A opened Archivo, which is gone.
  assert.match(page, /e\.key === "ArrowUp" \|\| e\.key === "ArrowDown"/);
  assert.match(page, /const door: Tab \| null = k === "e" \? "equipo" : k === "m" \? "maquinas" : null;/);
  assert.match(page, /go\(escFrom\(at\), true\)/);
  // PLA-129: no project menu in the bar any more (nothing to close on Esc): the name links to Todo.
  assert.ok(!/aria-haspopup/.test(strip), "no menu");
  assert.match(strip, /data-control="abrir-todo"/);
});
