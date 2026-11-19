// PLA-I3-6 «Un solo Pedir»: the project view has one Pedir, the bar at the foot. Its words and keys (lib/corriente.ts)
// and the bar server-rendered with fake data, running, paused and as the stream's global bar. Focus, the key hint and
// the confirmation after sending are checked in a browser and recorded as Plania results.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/corriente.ts");
const bar = await load("components/corriente/pedir-bar.tsx");
const strip = await load("components/corriente/strip.tsx");
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, { initialEntries: ["/ceo"] }, el)));
const pageSrc = readFileSync(new URL("../ui/src/pages/corriente.tsx", import.meta.url), "utf8");
const stripSrc = readFileSync(new URL("../ui/src/components/corriente/strip.tsx", import.meta.url), "utf8");

const project = (over: Record<string, unknown> = {}): any => ({ slug: "filmia", title: "Filmia", paused: false, light: "ok", ...over });
const ask = async () => ({ ok: true });
const pedirTo = (s: string) => `/ceo?v=pedir&p=${s}`;

test("I3-6 #1: the project view has no second Pedir control", () => {
  const out = html(h(strip.ProjectBar, { slug: "filmia", title: "Filmia", lanes: [], tab: "todo", href: () => "/t", projectHref: () => "/p", back: "/c", paused: false, pauseHref: "/pausar" }));
  assert.ok(!out.includes("data-pedir"), "no Pedir link in the top bar");
  assert.ok(!/>Pedir</.test(out));
  assert.ok(!/pedirTo/.test(stripSrc), "the bar takes no Pedir address");
  const use = pageSrc.slice(pageSrc.indexOf("<ProjectBar"), pageSrc.indexOf("/>", pageSrc.indexOf("<ProjectBar")));
  assert.ok(use.length > 20 && !use.includes("pedirTo"), "the page passes none");
  // The foot's bar opens the Pedir page: «Lo pedido» and the picture button.
  const foot = html(h(bar.PedirBar, { projects: [project()], fixed: project(), onAsk: ask, pedirTo }));
  assert.equal((foot.match(/data-pedir-send/g) ?? []).length, 1, "one send button");
  assert.match(foot, /aria-label="Añadir una imagen"[^>]*href="\/ceo\?v=pedir&amp;p=filmia"|href="\/ceo\?v=pedir&amp;p=filmia"[^>]*aria-label="Añadir una imagen"/);
  assert.match(foot, /data-pedir-past="true" href="\/ceo\?v=pedir&amp;p=filmia"[^>]*>.*Lo pedido</);
});

test("I3-6 #2: the placeholder and the send label follow the mode", () => {
  assert.deepEqual(lib.MODES.map((m: any) => m.id), ["forma", "ya", "pregunta"]);
  for (const m of lib.MODES) {
    const p = lib.pedirPlaceholder(m.id);
    assert.ok(p.length > 10 && p.length <= 70, `${m.id}: a short line`);
  }
  assert.notEqual(lib.pedirPlaceholder("forma"), lib.pedirPlaceholder("ya"));
  assert.equal(lib.pedirSendLabel("forma"), "Pedir");
  assert.equal(lib.pedirSendLabel("ya"), "Pedir");
  assert.equal(lib.pedirSendLabel("pregunta"), "Preguntar");
  assert.equal(lib.pedirSendLabel("pregunta", true), "Enviando…");
  // Shift+Tab cycles round.
  assert.equal(lib.nextMode("forma"), "ya");
  assert.equal(lib.nextMode("ya"), "pregunta");
  assert.equal(lib.nextMode("pregunta"), "forma");
  // At rest the bar shows the first mode's line and Pedir; the selected mode is pressed.
  const out = html(h(bar.PedirBar, { projects: [project()], fixed: project(), onAsk: ask, pedirTo }));
  assert.ok(out.includes(`placeholder="${lib.pedirPlaceholder("forma")}"`));
  assert.match(out, /aria-pressed="true"[^>]*data-mode="forma"/);
  // PLA-I3-7: the word sits in a span (a phone shows the arrow alone and the button's label names it).
  assert.match(out, /class="cor-btn primary"[^>]*aria-label="Pedir" data-pedir-send="true"><span class="cor-pedir-send-t">Pedir</);
  // While something waits on the owner, Pedir stays secondary.
  assert.match(html(h(bar.PedirBar, { projects: [project()], fixed: project(), primary: false, onAsk: ask, pedirTo })), /class="cor-btn secondary"[^>]*data-pedir-send/);
  assert.equal(lib.pedirKeyHint(false), "/");
  assert.equal(lib.pedirKeyHint(true), "↵");
});

test("I3-6 #3: / focuses the input, and does nothing while another field has focus or a sheet is open", () => {
  const slash = { key: "/" };
  assert.equal(lib.slashFocuses(slash, null, false), true);
  assert.equal(lib.slashFocuses(slash, { tag: "BUTTON" }, false), true);
  assert.equal(lib.slashFocuses(slash, { tag: "A" }, false), true);
  for (const tag of ["INPUT", "TEXTAREA", "SELECT", "input"]) assert.equal(lib.slashFocuses(slash, { tag }, false), false, tag);
  assert.equal(lib.slashFocuses(slash, { tag: "DIV", editable: true }, false), false, "contenteditable");
  assert.equal(lib.slashFocuses(slash, null, true), false, "a sheet is open");
  assert.equal(lib.slashFocuses({ key: "/", meta: true }, null, false), false);
  assert.equal(lib.slashFocuses({ key: "/", ctrl: true }, null, false), false);
  assert.equal(lib.slashFocuses({ key: "a" }, null, false), false);
});

test("I3-6 #4: paused shows one sentence and «Lo pedido», with no disabled controls", () => {
  const out = html(h(bar.PedirBar, { projects: [project({ paused: true })], fixed: project({ paused: true }), onAsk: ask, pedirTo }));
  assert.ok(out.includes(lib.pedirHeld("Filmia")));
  assert.equal(lib.pedirHeld("Filmia"), "En pausa. Reanuda Filmia para pedir algo nuevo; lo que ya pediste sigue aquí.");
  assert.match(out, /data-held="true"/);
  assert.match(out, /cor-pedir-shell held/);
  assert.match(out, />.*Lo pedido</);
  assert.ok(!out.includes("disabled"), "nothing disabled");
  assert.ok(!/<input|<button|<select/.test(out), "no input, no buttons");
});

test("I3-6 #5: the stream's global bar keeps its project picker, modes and send", () => {
  const projects = [project(), project({ slug: "micasa", title: "Mi casa" }), project({ slug: "off", title: "Off", paused: true })];
  const out = html(h(bar.PedirBar, { projects, initial: "micasa", onAsk: ask, pedirTo }));
  assert.match(out, /<select id="cor-pedir-p"/);
  assert.match(out, /<option value="micasa" selected="">Mi casa<\/option>/);
  assert.ok(!out.includes('value="off"'), "paused projects are not offered");
  assert.equal((out.match(/data-mode=/g) ?? []).length, 3);
  assert.match(out, /data-pedir-text/);
  assert.match(out, /data-pedir-send/);
  assert.match(out, /href="\/ceo\?v=pedir&amp;p=micasa"/, "Lo pedido follows the picked project");
  assert.match(out, /aria-label="Pedir"/);
});
