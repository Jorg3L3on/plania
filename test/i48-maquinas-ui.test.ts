// PLA-I48-4: the floor's two levels, the window and the machines, with fake F1 data. Server-rendered and
// handler-level; no browser, no database. The size check runs in headless Chrome on the demo server, outside the repo.
//   #1  the five states of the sketch (on, off, failed, base down, not configured): the state word, each lever's
//       label and the window's content
//   #2  without Máquinas the floor's markup is v6's (the v6 tests run unchanged next to this file)
//   #4  Tab order: the level switch, the window's controls, both levers, the drawers; the inactive level is inert
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { nextMove } from "../src/api/company-move.js";
import { base, read, server, tables } from "./i48-fixtures.js";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const ui = await load("components/compania/edificio/maquinas.tsx");
const live = await load("components/compania/edificio/maquinas-live.tsx");
const lib = await load("lib/maquinas.ts");
const building = await load("components/compania/edificio/building.tsx");

type Json = Record<string, any>;
const h = React.createElement;
const ok = (data: unknown) => ({ status: "ok", data, retry: () => {} });

const LIVE = server({ phase: "live", managed: true, port: 3000, url: "http://localhost:3000", started_at: "2026-11-14T18:00:00Z", started_by: "Plania, desde el piso", detail: "▲ Next.js ready on :3000", worktree: "/wt/lumen/_prueba", commit: "4c4d49fabc" });
const still = { id: "s1", image_url: "/api/projects/lumen/captures/s1.png", width: 1280, height: 800, url: null, commit: null, branch: null, task_key: null, taken_at: "2026-11-14T18:01:00Z" };

const STATES: Record<string, Json> = {
  on: read({ server: LIVE }),
  off: read(),
  failed: read({ server: server({ phase: "failed", managed: true, port: 3000, error: "La copia de prueba se cerró al arrancar (código 1)", detail: "Error: falta DATABASE_URL" }) }),
  "base-down": read({ server: LIVE, base: base({ state: "off" }) }),
  unconfigured: read({
    configured: false,
    server: server({ command: null, branch: null }),
    pages: [],
    found: { manager: "npm", scripts: [{ name: "dev", command: "next dev" }], dev: "npm run dev -- --port {port}", port: null, migrate: "npm run db:migrate", seed: "npm run db:seed", test: "npm run test", missing: [] },
  }),
};

const room = (r: Json, extra: Json = {}) =>
  renderToStaticMarkup(h(ui.Maquinas, { read: ok(r), tables: ok(tables), captures: { desktop: still, phone: null }, acts: { onServer: () => {}, onBase: () => {}, onOpen: () => {} }, ...extra }));
const attr = (out: string, control: string, name: string) => new RegExp(`<[^>]*data-control="${control}"[^>]*>`).exec(out)?.[0].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("I48-4 #1: on: Encendida, the server lever says Apagar, the window shows the app with Abrir", () => {
  const out = room(STATES.on!);
  assert.match(out, /data-maq="on"/);
  assert.match(out, /data-mach="servidor"[\s\S]*?data-state-word="true">Encendida</);
  assert.equal(attr(out, "maq-palanca-servidor", "data-next"), "Apagar");
  assert.equal(attr(out, "maq-palanca-servidor", "aria-checked"), "true");
  assert.equal(attr(out, "maq-palanca-base", "data-next"), "Apagar");
  assert.match(out, /data-window="live"/);
  assert.match(out, /<img class="edi-maq-shot" src="\/api\/projects\/lumen\/captures\/s1.png"/, "captures first while framing is not allowed");
  assert.match(out, /data-control="maq-abrir"[^>]*>Abrir ↗</);
  assert.match(out, /href="http:\/\/localhost:3000\/registro"/);
  assert.ok(!out.includes("edi-maq-blinds"), "blinds up");
  assert.match(out, /data-s="lit"/, "the pipes are lit");
  assert.match(text(out), /Este Postgres es de toda la Mac\. La comparten faro\./, "the base lever warns that the server is shared");
  // A frameable app is framed live.
  const framed = room(read({ server: { ...LIVE, frameable: true } }));
  assert.match(framed, /<iframe class="edi-maq-frame" src="http:\/\/localhost:3000\/registro"/);
});

test("I48-4 #1: off: Apagada, the lever says Encender, the blinds are down with «Encender la app»", () => {
  const out = room(STATES.off!);
  assert.match(out, /data-maq="off"/);
  assert.match(out, /data-state-word="true">Apagada</);
  assert.equal(attr(out, "maq-palanca-servidor", "data-next"), "Encender");
  assert.equal(attr(out, "maq-palanca-servidor", "aria-checked"), "false");
  assert.match(out, /data-blinds="off"/);
  assert.match(out, /data-control="maq-encender-app"[^>]*>Encender la app</);
  assert.match(attr(out, "maq-abrir", "disabled") ?? "", /^$/, "Abrir is off while the app is");
});

test("I48-4 #1: failed: No arrancó with the reason, Reintentar, Ver las llaves, Ver la bitácora", () => {
  const out = room(STATES.failed!);
  assert.match(out, /data-maq="failed"/);
  assert.match(out, /data-state-word="true">No arrancó</);
  assert.equal(attr(out, "maq-palanca-servidor", "data-next"), "Reintentar");
  assert.match(out, /data-blinds="failed"/);
  assert.match(out, /data-reason="true">La copia de prueba se cerró al arrancar \(código 1\)</);
  for (const c of ["maq-reintentar", "maq-ver-llaves", "maq-ver-bitacora"]) assert.match(out, new RegExp(`data-control="${c}"`));
  assert.match(out, /class="edi-maq-log" data-bad="true"[^>]*>Error: falta DATABASE_URL</);
});

test("I48-4 #1: base down: the app is on but cannot reach its base; red pipe, a banner with «Encender la base»", () => {
  const out = room(STATES["base-down"]!);
  assert.match(out, /data-maq="base-down"/);
  assert.match(out, /data-mach="base"[\s\S]*?data-state-word="true">Apagada</);
  assert.equal(attr(out, "maq-palanca-base", "data-next"), "Encender");
  assert.match(out, /data-warn="true"[^>]*>La app está encendida, pero no llega a su base\./);
  assert.match(out, /data-control="maq-warn-base"[^>]*>Encender la base</);
  assert.match(out, /edi-maq-pipe-v" data-s="red"/);
  assert.match(out, /data-dnote="true">Enciende la base para abrir sus tablas\.</, "drawers do not open while the base is off");
  assert.ok(!out.includes('data-drawer="registro"'));
  assert.equal(lib.maqView(STATES["base-down"]).word, "Base caída");
});

test("I48-4 #1: not configured: «Este piso no sabe cómo encenderse» with the scripts found and «Usar estos comandos»", () => {
  const out = room(STATES.unconfigured!);
  assert.match(out, /data-maq="unconfigured"/);
  assert.match(out, /data-state-word="true">Sin configurar</);
  assert.equal(attr(out, "maq-palanca-servidor", "disabled"), "");
  assert.match(out, /data-blinds="setup"[\s\S]*?Este piso no sabe cómo encenderse/);
  assert.match(out, /<code>npm run dev -- --port 3000<\/code>/);
  assert.match(out, /data-control="maq-configurar"[^>]*>Usar estos comandos</);
  assert.ok(!out.includes('data-control="maq-probar"'), "no walkthrough before it can start");
});

test("I48-4 #1: the lever clicks run the action they name", () => {
  const calls: string[] = [];
  const el = ui.Maquinas({ read: ok(STATES.on), tables: ok(tables), acts: { onServer: (a: string) => calls.push(`server:${a}`), onBase: (a: string) => calls.push(`base:${a}`) } });
  const all: any[] = [];
  const walk = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    all.push(n);
    if (typeof n.type === "function") return walk(n.type(n.props));
    walk(n.props?.children);
  };
  walk(el);
  all.find((e) => e.props?.["data-control"] === "maq-palanca-servidor").props.onClick();
  all.find((e) => e.props?.["data-control"] === "maq-palanca-base").props.onClick();
  assert.deepEqual(calls, ["server:apagar", "base:apagar"]);
});

test("I48-4: the level switch carries the server's and the base's lights", () => {
  const out = renderToStaticMarkup(h(live.NivelSwitch, { nivel: "trabajo", lights: lib.maqView(STATES["base-down"]).lights }));
  assert.match(out, /data-light="server" data-s="on"|data-s="on" data-light="server"/);
  assert.match(out, /data-s="off" data-light="base"/);
  assert.match(out, /aria-selected="true"[^>]*data-control="nivel-trabajo"/);
  assert.match(out, /aria-label="Servidor encendido, base apagado"/);
  assert.equal(lib.nivelOf("?piso=lumen&nivel=maquinas"), "maquinas");
  assert.equal(lib.nivelOf("?piso=lumen"), "trabajo");
  assert.equal(lib.nivelSearch("?piso=lumen&f=maq:base", "maquinas"), "?piso=lumen&f=maq%3Abase&nivel=maquinas");
});

// ---- the floor with both levels

const member = (slug: string, role: string): Json => ({ agent: `${role}-${slug}`, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, queue: [] });
const project: Json = {
  slug: "lumen",
  title: "Lumen",
  paused: false,
  light: "ok",
  light_reason: null,
  goal: null,
  rumbo: { goal_id: null, goal: "Una meta de prueba", why: "", target_on: "2026-12-05", forecast_on: "2026-12-05", weeks_behind: 0, missing: false },
  usage: { used: 0 },
  team: ["product-owner", "taller"].map((r) => member("lumen", r)),
  thread: { id: "t-lumen", unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  ready: [],
  work: { open: 0, in_progress: 0 },
  orders: [],
};
const company: Json = {
  company: { paused: false },
  week: { starts_at: "2026-11-09T06:00:00Z", resets_at: "2026-11-16T06:00:00Z", timezone: "America/Mexico_City" },
  asistente: { thread_id: "t-co", usage: { used: 0 }, last_run: null, state: "idle", unread: 0 },
  projects: [{ ...project, next_move: nextMove(project as never, [], { companyPaused: false }) }],
  plumbing: { spend: 0, running: 0, paused: false },
  decisions: [],
  inbox: { decisiones: 0, pasos: 0 },
};
const floor = (nivel: string, extra: Json = {}) =>
  renderToStaticMarkup(
    h(
      MemoryRouter,
      null,
      h(building.Building, {
        company,
        decisions: [],
        now: Date.parse("2026-11-10T18:00:00Z"),
        hello: "Hola",
        day: "Martes",
        onNew: () => {},
        nivel,
        askFor: () => h("div", { "data-ask": "1" }, "PEDIR"),
        liftFor: () => h(live.NivelSwitch, { nivel, lights: lib.maqView(STATES.on).lights }),
        maquinasFor: (_p: Json, ask: unknown) => h(ui.Maquinas, { read: ok(STATES.on), tables: ok(tables), acts: {}, ask }),
        ...extra,
      }),
    ),
  );

test("I48-4 #4: Tab reaches the level switch, the window's controls, both levers and the drawers, in that order", () => {
  const out = floor("maquinas");
  const at = (c: string) => out.indexOf(`data-control="${c}"`);
  const order = ["nivel-trabajo", "nivel-maquinas", "maq-computadora", "maq-captura", "maq-abrir", "maq-palanca-servidor", "maq-palanca-base"];
  for (const c of order) assert.ok(at(c) > 0, `${c} is on the floor`);
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]!) < at(order[i]!), `${order[i - 1]} before ${order[i]}`);
  assert.ok(at("maq-palanca-base") < out.indexOf('data-drawer="registro"'), "the drawers after the levers");
  assert.ok(!/tabindex="[1-9]/.test(out), "document order only, no positive tabindex");
  // The inactive level takes no focus.
  assert.match(out, /data-level="trabajo" inert=""/);
  assert.ok(!/data-level="maquinas" inert/.test(out));
  // Pedir lives in the shown level only.
  assert.equal((out.match(/data-ask="1"/g) ?? []).length, 1);
  assert.ok(out.indexOf('data-ask="1"') > out.indexOf('data-level="maquinas"'));
  const up = floor("trabajo");
  assert.match(up, /data-level="maquinas" inert=""/);
  assert.ok(!/data-level="trabajo" inert/.test(up));
  assert.ok(up.indexOf('data-ask="1"') < up.indexOf('data-level="maquinas"'));
});

test("I48-4 #2: without Máquinas the floor's markup is v6's", () => {
  const out = floor("trabajo", { liftFor: undefined, maquinasFor: undefined });
  assert.ok(!out.includes("edi-levels"));
  assert.ok(!out.includes("edi-maq"));
  assert.match(out, /<div class="edi-fbody" data-ventanal="home">/);
});

test("I48-4: the page wires ?nivel=, the M key and the switch; the CSS slides the levels and keeps no new tokens", () => {
  const page = readFileSync(new URL("../ui/src/pages/ceo.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("nivelOf(location.search)"));
  assert.ok(page.includes('(e.key === "m" || e.key === "M")'));
  assert.ok(page.includes("<NivelSwitch"));
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  const mine = css.slice(css.indexOf("/* PLA-I48: Cuarto de máquinas."), css.indexOf("/* PLA-I47-7: a part that failed to draw"));
  assert.ok(mine.includes('.edi-levels[data-nivel="maquinas"] > [data-level="trabajo"] { transform: translateY(-104%)'));
  assert.ok(!/--[a-z-]+\s*:/.test(mine.replace(/var\(--[a-z-]+/g, "")), "no new custom properties (tokens)");
});
