// PLA-I3-7: the project page on a phone (639 px and under). The words (lib/barra.ts, lib/tramo.ts, lib/corriente.ts),
// the card's steps control, the steps' sheet and the Pedir bar server-rendered with fake data, and the 639 px rule read
// from corriente.css. Scrolling, the sheet's Esc and focus, and the measures at 390 px are checked in a browser and
// recorded as Plania results.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const barra = await load("lib/barra.ts");
const tramo = await load("lib/tramo.ts");
const lib = await load("lib/corriente.ts");
const cosasLib = await load("lib/cosas.ts");
const todo = await load("components/corriente/todo.tsx");
const tramos = await load("components/corriente/tramos.tsx");
const bar = await load("components/corriente/pedir-bar.tsx");
const strip = await load("components/corriente/strip.tsx");
const h = React.createElement;
const html = (el: React.ReactElement, client = new QueryClient()) => renderToStaticMarkup(h(QueryClientProvider, { client }, h(MemoryRouter, { initialEntries: ["/ceo"] }, el)));
const css = readFileSync(new URL("../ui/src/corriente.css", import.meta.url), "utf8");
const hojasSrc = readFileSync(new URL("../ui/src/components/corriente/hojas.tsx", import.meta.url), "utf8");

const NOW = Date.parse("2026-11-18T12:12:00Z");
const SINCE = "2026-11-18T12:00:00Z";
const taller = { agent: "taller-filmia", role: "taller" };
const etapa = (e: string, live = false, holder: any = null) => ({ etapa: e, qa: null, holder, live, since: SINCE, ci: null, reason: null });
const tk = (key: string, e: string, phase: number, live = false, holder: any = null) => ({ key, title: `Paso ${key}`, status: "Ready", phase, parent_key: "FIL-I1", etapa: etapa(e, live, holder) });
const ini = (key: string, tickets: any[]) => ({ key, title: `Iniciativa ${key}`, status: "Active", done: 0, total: tickets.length, tickets });
const project = (over: Record<string, unknown> = {}): any => ({
  slug: "filmia",
  title: "Filmia",
  paused: false,
  light: "ok",
  goal: null,
  usage: { used: 0 },
  team: [],
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  work: { open: 0, in_progress: 0 },
  tablero: { initiatives: [], loose: [], loose_done: 0, done_initiatives: [] },
  pedidos: [],
  ...over,
});
const steps = [tk("FIL-1", "hecho", 1), tk("FIL-2", "hecho", 2), tk("FIL-3", "construyendo", 3, true, taller), tk("FIL-4", "lista", 4), tk("FIL-5", "despues", 5)];
const idea = { key: "FIL-IDEA1", title: "Una idea quieta", stop: "diseno", state: "quieta", who: "po", images: 0, understood: null, question: null, guardada: false, at: SINCE };
const p = project({ tablero: { initiatives: [ini("FIL-I1", steps)], loose: [], loose_done: 0, done_initiatives: [] }, pedidos: [idea] });
const cosas = cosasLib.cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [] } });
const all = cosas.grupos.flatMap((g: any) => g.cosas);
const iniciativa = all.find((c: any) => c.key === "FIL-I1");
const links = { open: (c: any) => `/x/${c.key}`, hecha: (k: string) => `/h/${k}`, idea: (k: string) => `/i/${k}`, hecho: "/hecho", paso: (k: string) => `/ceo?proyecto=filmia&ver=paso%3A${k}` };

/** The body of the 639 px rule that PLA-I3-7 adds (the last one in the file). */
const phase = css.slice(css.lastIndexOf("/*", css.indexOf("---- PLA-I3-7")));
const phone = (() => {
  const at = phase.indexOf("@media (max-width: 639px) {");
  let depth = 0;
  for (let i = phase.indexOf("{", at); i < phase.length; i++) {
    if (phase[i] === "{") depth++;
    if (phase[i] === "}" && --depth === 0) return phase.slice(at, i + 1);
  }
  return "";
})();
const rule = (sel: string) => {
  const i = phone.indexOf(`\n  ${sel} {`);
  assert.ok(i >= 0, `the phone rule has ${sel}`);
  return phone.slice(i, phone.indexOf("}", i));
};

test("I3-7: the phone's words", () => {
  assert.equal(barra.pulsoLine(13, 14), "13 pasos hechos en 14 días");
  assert.equal(barra.pulsoLine(1, 14), "1 paso hecho en 14 días");
  assert.equal(barra.pulsoLine(0, 14), "0 pasos hechos en 14 días");
  const ts = iniciativa.hilo.tramos;
  assert.equal(tramo.tramosHechos(ts), 2);
  assert.equal(tramo.tramosCuenta(ts), "2 de 5");
  assert.equal(tramo.tramosPos(ts), "2 DE 5 PASOS");
  assert.equal(tramo.tramosPos([{ tono: "vivo" }]), "0 DE 1 PASO");
  assert.equal(tramo.tramosAria("Iniciativa FIL-I1", ts), "Ver los pasos de «Iniciativa FIL-I1»: 2 de 5 hechos.");
  assert.equal(lib.pedirChipAria("forma"), "Cómo: Darle forma");
  assert.equal(lib.pedirChipAria("pregunta"), "Cómo: Preguntar");
  assert.equal(lib.PEDIR_MENU, "Cómo pedirlo");
});

test("I3-7 #1: the bar keeps back, the switcher and the state on one row; the doors and the counts alone scroll sideways", () => {
  const out = html(h(strip.ProjectBar, { slug: "filmia", title: "Filmia", lanes: [], tab: "todo", href: (t: string) => `/t/${t}`, projectHref: () => "/p", back: "/c", paused: false, pauseHref: "/pausar" }));
  // Back keeps its word as its name; a phone shows the chevron alone.
  assert.match(out, /data-control="corriente" href="\/c"[^>]*><svg[^]*?<\/svg><span class="cor-strip-back-t">Corriente<\/span><\/a>/);
  assert.match(rule(".cor-topbar"), /display: grid; grid-template-columns: auto minmax\(0, 1fr\) auto; grid-template-areas: "back switch end" "doors doors doors";/);
  assert.match(rule(".cor-topbar .cor-strip-back-t"), /position: absolute; width: 1px; height: 1px;/);
  assert.match(rule(".cor-topbar .cor-doors"), /grid-area: doors;[^]*flex-wrap: nowrap; overflow-x: auto;/);
  assert.match(rule(".cor-topbar .cor-door"), /min-height: 44px;/);
  assert.match(rule(".cor-cuentas"), /flex-wrap: nowrap; overflow-x: auto; margin: 0 -16px; padding: 6px 16px;/);
  assert.match(rule(".cor-cuenta"), /flex: none; height: 44px;/);
  // Nothing else scrolls sideways: the only overflow-x in the rule is the doors' and the counts'.
  assert.deepEqual([...phone.matchAll(/\n  ([^{\n]+) \{[^}]*overflow-x: auto/g)].map((m) => m[1]), [".cor-topbar .cor-doors", ".cor-cuentas"]);
  // The list scrolls with the page; the card's grid never grows past the screen.
  assert.match(rule(".cor-todo-scroll"), /overflow: visible;/);
  assert.match(rule(".cor-cosa, .cor-cosa.you, .cor-cosa.liv, .cor-cosa.ghost"), /grid-template-columns: minmax\(0, 1fr\);/);
  // The sentence at 34 px; the pulse as one small line.
  assert.match(rule(".cor-frase-h.cor-h1"), /font-size: 34px;/);
  assert.match(rule(".cor-pulso-n, .cor-pulso-chart"), /display: none;/);
  assert.match(rule(".cor-pulso-line"), /display: block;/);
  const c = new QueryClient();
  c.setQueryData(["pulso", "filmia"], { days: Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(5 + i).padStart(2, "0")}`, n: i % 3 })), total: 13, tz: "UTC" });
  const head = html(h(todo.Cabeza, { f: { mueve: "Taller construye el registro.", toca: null, falta: "Faltan 3 pasos." }, slug: "filmia" }), c);
  assert.match(head, /<p class="cor-pulso-line" data-pulso-line="true">13 pasos hechos en 14 días<\/p>/);
  assert.match(head, /<b class="cor-figure">13<\/b>/, "a wide screen keeps the figure and the bars");
});

test("I3-7 #2: each thing is a card; an initiative's steps are one 44 px control, an idea keeps its small thread", () => {
  const out = html(h(todo.TodoList, { p, cosas, links, companyPaused: false, lado: { open: null, onPaso: () => {} } }));
  const controls = out.match(/<button type="button" class="cor-tramos"[^>]*>/g) ?? [];
  assert.equal(controls.length, 1, "one control, on the initiative");
  assert.match(controls[0]!, /aria-haspopup="dialog" aria-expanded="false" aria-label="Ver los pasos de «Iniciativa FIL-I1»: 2 de 5 hechos\." data-tramos="FIL-I1"/);
  const card = out.slice(out.indexOf('data-cosa="FIL-I1"'), out.indexOf("</li>", out.indexOf('data-cosa="FIL-I1"')));
  assert.match(card, /<span class="cor-tramos-sg" aria-hidden="true"><i class="hecho"><\/i><i class="hecho"><\/i><i class="vivo"><\/i><i class="fila"><\/i><i class="quieto"><\/i><\/span><span class="cor-tramos-n" aria-hidden="true">2 de 5<\/span><svg/);
  // A wide screen keeps one button per step (the control is not drawn there).
  assert.equal((card.match(/class="cor-paso[ "]/g) ?? []).length, 5);
  assert.ok(card.indexOf("cor-hilo") < card.indexOf("cor-tramos") && card.indexOf("cor-tramos") < card.indexOf("cor-cosa-que"), "the control sits where the thread is");
  // The idea: its thread, decorative, and no control.
  const ideaCard = out.slice(out.indexOf('data-cosa="FIL-IDEA1"'), out.indexOf("</li>", out.indexOf('data-cosa="FIL-IDEA1"')));
  assert.ok(ideaCard.length > 0 && !ideaCard.includes("cor-tramos") && !ideaCard.includes("<button"));
  assert.match(ideaCard, /<span class="cor-hilo" aria-hidden="true"/);
  // Without a step link there is nothing to open: no control.
  const { paso: _, ...sin } = links;
  assert.ok(!html(h(todo.TodoList, { p, cosas, links: sin, companyPaused: false })).includes("cor-tramos"));
  // The card's look: kind, key and tokens on one line, the title at 17 px, the steps in place of the thread, the lever.
  assert.match(rule(".cor-cosa-nm:not(.row)"), /grid-template-areas: "ids tok" "t t";/);
  assert.match(rule(".cor-cosa-nm:not(.row) > b"), /font-size: 17px;/);
  assert.match(rule(".cor-cosa:has(> .cor-tramos) > .cor-hilo"), /display: none;/);
  assert.match(rule(".cor-tramos"), /display: flex;/);
  assert.match(css, /\.cor-tramos \{ display: none;[^}]*min-height: 44px;/);
  assert.match(css, /\.cor-tramos-sg i \{[^}]*height: 10px;/);
  assert.match(rule(".cor-palanca-btns > .cor-btn"), /flex: 1 1 auto; min-height: 48px;/);
  assert.match(rule(".cor-palanca"), /width: 100%;/);
  // Te toca and Se mueve keep their borders (they win over the quiet card's hairline).
  assert.match(rule(".cor-cosa"), /border: 1px solid var\(--cor-line\); border-radius: 14px; background: var\(--cor-surface\);/);
  assert.match(css, /\.cor-cosa\.you \{[^}]*border: 1px solid rgba\(255, 180, 84, 0\.38\)/);
  assert.match(css, /\.cor-cosa\.liv \{[^}]*border: 1px solid rgba\(167, 139, 250, 0\.32\)/);
});

test("I3-7 #3: the steps' sheet: key, «N DE M PASOS», the title, one row per step that opens it; the live one tinted", () => {
  const out = html(h(tramos.TramosHoja, { c: iniciativa, paso: links.paso, onClose: () => {}, now: NOW }));
  assert.match(out, /<div class="cor-hoja-back"><div class="cor-hoja abajo" role="dialog" aria-modal="true" aria-labelledby="hoja-t">/);
  const order = ['<span class="cor-key">FIL-I1</span> · 2 DE 5 PASOS', '<h2 id="hoja-t" class="cor-h2">Iniciativa FIL-I1</h2>', 'aria-label="Cerrar los pasos"', 'data-tramo="FIL-1"', 'data-tramo="FIL-5"'];
  let at = -1;
  for (const s of order) {
    const i = out.indexOf(s, at + 1);
    assert.ok(i > at, `${s} comes after the one before it`);
    at = i;
  }
  const rows = out.match(/<a class="cor-tramo[^"]*"[^>]*>/g) ?? [];
  assert.equal(rows.length, 5);
  assert.match(rows[2]!, /class="cor-tramo vivo" aria-label="Paso 3 de 5, «Paso FIL-3»: construyendo, Taller, 12 min\." data-tramo="FIL-3" data-tono="vivo" href="\/ceo\?proyecto=filmia&amp;ver=paso%3AFIL-3"/);
  assert.equal(rows.filter((r) => r.includes("cor-tramo vivo")).length, 1, "only the live step is tinted");
  // A row: the square in the step's tone, the title, the state line under it, a chevron.
  assert.match(out, /data-tramo="FIL-4"[^>]*><i class="cor-lado-sq fila" aria-hidden="true"><\/i><span class="cor-tramo-tx"><b>Paso FIL-4<\/b><span class="cor-tramo-st">Lista para empezar<\/span><\/span><svg/);
  assert.match(css, /\.cor-tramo \{[^}]*min-height: 56px;/);
  assert.match(css, /\.cor-tramo\.vivo \{ background: rgba\(139, 92, 246, 0\.14\);/);
  assert.match(css, /\.cor-lado-sq \{ width: 10px; height: 10px;/);
  assert.match(css, /\.cor-tramo-tx b \{[^}]*-webkit-line-clamp: 2;/);
  // Cerrar is 44 px (the panel's icon button) and Esc closes (the sheet's own handler, before the page's).
  assert.match(out, /<button type="button" class="cor-lado-ic cor-hoja-x" aria-label="Cerrar los pasos"/);
  assert.match(css, /\.cor-lado-ic \{[^}]*width: 44px; height: 44px;/);
  assert.match(hojasSrc, /if \(e\.key === "Escape"\) \{\s*e\.stopPropagation\(\);\s*onClose\(\);/);
  // From the foot, above the app's tab bar.
  assert.match(css, /\.cor-hoja-back:has\(> \.cor-hoja\.abajo\) \{ place-items: end stretch; padding: 0; \}/);
  assert.match(rule(".cor-hoja.abajo"), /margin-bottom: calc\(57px \+ env\(safe-area-inset-bottom\)\);/);
});

test("I3-7 #4: Pedir is the mode as one chip, the input and a 44 px send with an arrow; paused keeps its sentence", () => {
  const out = html(h(bar.PedirBar, { projects: [p], fixed: p, onAsk: async () => ({ ok: true }), pedirTo: (s: string) => `/ceo?v=pedir&p=${s}` }));
  assert.match(out, /<button type="button" class="cor-pedir-chip" aria-haspopup="menu" aria-expanded="false" aria-label="Cómo: Darle forma" data-pedir-chip="forma"><span class="cor-ellipsis">Darle forma<\/span><svg/);
  assert.ok(!out.includes("data-pedir-menu"), "the menu starts closed");
  assert.match(out, /aria-label="Pedir" data-pedir-send="true"><span class="cor-pedir-send-t">Pedir<\/span><svg class="cor-pedir-send-i"/);
  assert.equal((out.match(/data-pedir-send/g) ?? []).length, 1);
  assert.match(rule(".cor-pedir-modes, .cor-pedir-shell > .cor-pedir-icon, .cor-pedir-shell > .cor-pedir-past, .cor-pedir-key"), /display: none;/);
  assert.match(rule(".cor-pedir-chip-box"), /display: inline-flex;/);
  assert.match(rule(".cor-pedir-shell > .cor-btn[data-pedir-send]"), /width: 44px; min-width: 44px; padding: 0;/);
  assert.match(rule(".cor-pedir-send-t"), /display: none;/);
  assert.match(rule(".cor-pedir-text"), /font-size: 16px;/);
  assert.match(css, /\.cor-pedir-chip \{[^}]*min-height: 44px;/);
  assert.match(css, /\.cor-pedir-mi \{[^}]*min-height: 44px;/);
  // The menu holds the modes, the picture button and «Lo pedido» (drawn when the chip opens it).
  const src = readFileSync(new URL("../ui/src/components/corriente/pedir-bar.tsx", import.meta.url), "utf8");
  const chip = src.slice(src.indexOf("const ModoChip"), src.indexOf("/** The two links to the Pedir page"));
  // PLA-I2-10: the words come through pedirPicture() / pedirPast(), in the screen's language.
  for (const s of ['role="menuitemradio"', "{pedirPicture()}", "{pedirPast()}", "stopImmediatePropagation()"]) assert.ok(chip.includes(s), s);
  // Paused: the one sentence and «Lo pedido», which a phone keeps (under it).
  const held = html(h(bar.PedirBar, { projects: [project({ paused: true })], fixed: project({ paused: true }), onAsk: async () => ({ ok: true }), pedirTo: (s: string) => `/p/${s}` }));
  assert.ok(held.includes(lib.pedirHeld("Filmia")) && !/<button|<input/.test(held));
  assert.match(rule(".cor-pedir-shell.held > .cor-pedir-past"), /display: inline-flex;/);
  // It stays at the foot of the page, above the tab bar.
  assert.match(rule(".cor-todo .cor-pedir"), /position: sticky; bottom: calc\(57px \+ env\(safe-area-inset-bottom\)\);/);
});

test("I3-7: no hover tooltips on touch; every control on the phone is 44 px or more", () => {
  assert.match(css, /@media \(hover: none\) \{\n  \.cor-tip \{ display: none; \}\n  \.cor-paso:hover i, \.cor-paso\.on i \{ transform: none; \}/);
  assert.match(rule(".cor-pmeta .cor-btn.link"), /min-height: 44px;/, "Fijar meta was 32 px");
  assert.match(rule(".cor-pedir-said a"), /min-height: 44px;/);
  for (const sel of [".cor-cuenta", ".cor-topbar .cor-door"]) assert.match(rule(sel), /(height|min-height): 44px;/, sel);
  // The phone keeps room for the app's tab bar (the .cor rule is unchanged).
  assert.match(css, /@media \(max-width: 639px\) \{\n  \/\* The phone keeps room for the app's tab bar; pages scroll there\. \*\/\n  \.cor \{ height: auto; min-height: calc\(100svh - var\(--cor-shell\) - 4\.5rem\); overflow: visible; \}/);
});

test("I3-7: above 639 px the layout does not change: outside the phone rule only the new pieces get styles", () => {
  // Drop the @media blocks from the phase's section; what is left must touch only classes this phase adds.
  let rest = "";
  let depth = 0;
  let inMedia = false;
  for (let i = 0; i < phase.length; i++) {
    if (!inMedia && phase.startsWith("@media", i)) inMedia = true;
    if (inMedia) {
      if (phase[i] === "{") depth++;
      if (phase[i] === "}" && --depth === 0) inMedia = false;
      continue;
    }
    rest += phase[i];
  }
  const selectors = [...rest.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}]+)\{[^}]*\}/g)].flatMap((m) => m[1]!.split(",").map((s) => s.trim()));
  assert.ok(selectors.length > 20, "the section's rules are read");
  const NEW = /^cor-(tramos(-\w+)?|tramo(-\w+)?|hoja-x|pulso-line|pedir-chip(-box)?|pedir-menu(-sep)?|pedir-mi|pedir-send-i)$/;
  for (const s of selectors) {
    const classes = [...s.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
    const known = classes.filter((c) => !NEW.test(c) && c !== "vivo" && c !== "toca" && c !== "hecho" && c !== "fila" && c !== "fin" && c !== "row");
    // The bottom sheet is a new variant of Hoja: .cor-hoja.abajo (and its background when it holds one).
    const hoja = s.includes(".cor-hoja.abajo");
    assert.ok(known.length === 0 || hoja, `${s} only styles what this phase adds`);
  }
  // And each new piece is not drawn above 639 px.
  for (const c of ["cor-tramos", "cor-pulso-line", "cor-pedir-chip-box", "cor-pedir-send-i"]) assert.match(rest, new RegExp(`\\.${c} \\{[^}]*display: none;`), c);
});
