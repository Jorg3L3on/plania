// PLA-I58-1 (El timbre): the team's plate in the floor's head and La sala it opens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const h = React.createElement;
const { Timbre, teamLine, stateWord } = (await import(new URL("../ui/src/components/compania/edificio/equipo.tsx", import.meta.url).href)) as Record<string, any>;

const member = (role: string, agent = `${role}-demo`) => ({ agent, role, state: "idle" }) as never;
const view = (state: string, line: string) => ({ data: { "data-state": state }, state, label: `${state} ${line}`, line });
const team = [member("product-owner"), member("research"), member("taller")];
const states: Record<string, string> = { "product-owner-demo": "idle", "research-demo": "ask", "taller-demo": "work" };
const seat = (m: { agent: string }) => view(states[m.agent]!, `línea de ${m.agent}`);
const render = (extra = {}) => renderToStaticMarkup(h(Timbre, { title: "Plania", team, seat, onMember: () => {}, children: h("button", { className: "edi-add" }, "Sumar"), ...extra }));

test("I58-1: the plate has one window per teammate with its state, and the team's line", () => {
  const html = render();
  assert.deepEqual([...html.matchAll(/<i data-state="([a-z]+)"><\/i>/g)].map((m) => m[1]), ["idle", "ask", "work"]);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /1 trabaja · 1 te pregunta/);
  assert.equal(teamLine(["idle", "idle"]), "nadie trabaja");
  assert.equal(teamLine(["work", "back", "ask"]), "2 trabajan · 1 te pregunta");
});

test("I58-1: closed, La sala is hidden and the asker shows beside the plate", () => {
  const html = render();
  assert.match(html, /<section[^>]*class="dark edi-sala"[^>]*hidden=""/);
  assert.match(html, /data-control="timbre-pregunta"[^>]*>[\s\S]*?Research te pregunta</);
});

test("I58-1: open, La sala shows each teammate with its word and line, then Sumar", () => {
  const html = renderToStaticMarkup(h(Timbre, { title: "Plania", team, seat, onMember: () => {}, children: h("button", { className: "edi-add" }, "Sumar"), defaultOpen: true }));
  const sala = html.slice(html.indexOf('class="dark edi-sala"'));
  assert.equal(/class="dark edi-sala"[^>]*hidden/.test(html), false);
  assert.equal(html.includes("timbre-pregunta"), false, "the asker is in La sala, not twice");
  assert.deepEqual([...sala.matchAll(/class="edi-sala-st" data-state="[a-z]+">([^<]+)</g)].map((m) => m[1]), ["Libre", "Te pregunta", "Trabaja"]);
  assert.match(sala, /línea de research-demo/);
  assert.ok(sala.lastIndexOf("edi-sala-mate") < sala.indexOf('class="edi-add"'), "Sumar is the last window");
  assert.equal(stateWord("back"), "Arreglando");
});

test("I58-1: E toggles, Esc closes, and E never fires while the owner types", () => {
  const src = readFileSync(new URL("../ui/src/components/compania/edificio/equipo.tsx", import.meta.url), "utf8");
  assert.match(src, /e\.key !== "Escape"[\s\S]*?e\.stopPropagation\(\)/, "Esc stops at La sala");
  assert.match(src, /window\.addEventListener\("keydown", onKey, true\)/, "caught before the page's own Esc");
  assert.match(src, /e\.key !== "e" && e\.key !== "E"/);
  assert.match(src, /INPUT\|TEXTAREA\|SELECT/);
});
