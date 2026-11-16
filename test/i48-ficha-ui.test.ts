// PLA-I48-5: drawers, the map and La ficha's Máquinas kinds, with fake F2 data. Server-rendered and handler-level.
//   #1  each kind (servidor, base, tabla, llaves, pruebas) in its loaded, loading, error and empty state
//   #2  fichaOf parses every new ?f= kind and the old kinds still open
//   #3  the confirm button names the row count from the read and sends it; Cancelar leaves the base alone
//   #4  a long table name and a long column name do not overlap: the type moves to its own line (markup)
//   and: a drawer lays its rows over the window (paged, «datos de muestra»); «Ver el mapa» lays the tables there
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { read, base, server, tables } from "./i48-fixtures.js";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const fi = await load("components/compania/edificio/maquinas-ficha.tsx");
const ui = await load("components/compania/edificio/maquinas.tsx");
const ficha = await load("components/compania/edificio/ficha.tsx");
const lib = await load("lib/ficha.ts");

type Json = Record<string, any>;
const h = React.createElement;
const ok = (data: unknown) => ({ status: "ok", data, retry: () => {} });
const loading = { status: "loading" };
const error = { status: "error", retry: () => {} };
const r = (el: unknown) => renderToStaticMarkup(h(MemoryRouter, null, el as React.ReactElement));
const state = (out: string) => /data-state="(\w+)"/.exec(out)?.[1] ?? "loaded";
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

const LIVE = server({ phase: "live", managed: true, port: 3000, url: "http://localhost:3000", started_by: "Plania, desde el piso", commit: "4c4d49fabc", worktree: "/wt/lumen/_prueba" });
const LONG_TABLE = "registro_de_novias_con_su_vestido_y_su_presupuesto_de_boda";
const LONG_COLUMN = "fecha_estimada_de_la_boda_civil_y_religiosa_en_la_ciudad";
const bigTables: Json = {
  ...tables,
  tables: [
    ...tables.tables,
    {
      name: LONG_TABLE,
      rows: 0,
      columns: [
        { name: "id", type: "integer", not_null: true, key: true, unique: false, default: null, references: null, hidden: false },
        { name: LONG_COLUMN, type: "timestamp with time zone", not_null: false, key: false, unique: false, default: null, references: null, hidden: false },
        { name: "sucursal_id", type: "integer", not_null: true, key: false, unique: false, default: null, references: { table: "sucursal", column: "id" }, hidden: false },
        { name: "password_hash", type: "text", not_null: true, key: false, unique: false, default: null, references: null, hidden: true },
      ],
      indexes: [{ name: "registro_pkey", definition: "CREATE UNIQUE INDEX…" }],
      relations: [{ column: "sucursal_id", table: "sucursal", foreign: "id" }],
    },
  ],
};
const llaves: Json = { env_file: ".env.local", where: "prueba", example_file: ".env.example", llaves: [{ name: "RESEND_API_KEY", set: false, from: ["código", "ejemplo"], public: false }, { name: "DATABASE_URL", set: true, from: ["ejemplo"], public: false }], set: 1, missing: 1 };
const pruebas: Json = { running: null, commands: [{ name: "test", command: "npm test" }], can: true, reason: null, last: { ok: false, started_at: "x", ended_at: "y", duration_ms: 41_000, passed: 174, failed: 1, steps: [{ name: "test", command: "npm test", ok: false, code: 1, ms: 41_000, passed: 174, failed: 1, tail: ["FAIL registro.test.ts", "expected 2 got 3"] }] } };

test("I48-5 #1: Servidor in its four states", () => {
  const loaded = r(h(fi.FichaServidor, { read: ok(read({ server: LIVE })), log: ok({ lines: ["▲ Next.js ready", "GET /registro 200"] }), acts: {} }));
  assert.match(loaded, /<code>http:\/\/localhost:3000<\/code>/);
  assert.match(loaded, /<code>copia de prueba @ 4c4d49f<\/code>/);
  assert.match(loaded, /Plania, desde el piso/);
  assert.match(loaded, /data-bitacora="true">▲ Next.js ready\nGET \/registro 200</);
  assert.match(loaded, /data-control="maq-reiniciar"/);
  assert.equal(state(r(h(fi.FichaServidor, { read: loading, log: loading, acts: {} }))), "loading");
  assert.equal(state(r(h(fi.FichaServidor, { read: error, log: loading, acts: {} }))), "error");
  const empty = r(h(fi.FichaServidor, { read: ok(read()), log: ok({ lines: [] }), acts: {} }));
  assert.match(empty, /data-state="empty"[^>]*>Sin salida todavía/);
  // Started outside Plania: only looking, no Reiniciar.
  const out = r(h(fi.FichaServidor, { read: ok(read({ server: server({ phase: "running", port: 3000, url: "http://localhost:3000", started_by: "fuera de Plania" }) })), log: ok({ lines: [] }), acts: {} }));
  assert.match(out, /La encendiste fuera de Plania: aquí solo se mira/);
  assert.ok(!out.includes("maq-reiniciar"));
});

test("I48-5 #1: Base de datos: loaded (databases, connection without password, migrations, data), loading, error, empty, off", () => {
  const loaded = r(h(fi.FichaBase, { read: ok(read()), tables: ok(tables), acts: {} }));
  assert.match(loaded, /data-db="lumen_dev"/);
  assert.match(loaded, /<code>127\.0\.0\.1:5433<\/code>/);
  assert.match(loaded, /Sin contraseña/);
  assert.match(loaded, /data-applied="false"[\s\S]*?pendiente/);
  assert.match(loaded, /data-control="maq-aplicar"[^>]*>Aplicar la pendiente</);
  assert.match(loaded, /15 filas en 2 tablas · datos de muestra/);
  assert.match(loaded, /también lo usan faro/);
  assert.equal(state(r(h(fi.FichaBase, { read: loading, tables: loading, acts: {} }))), "loading");
  assert.equal(state(r(h(fi.FichaBase, { read: error, tables: loading, acts: {} }))), "error");
  assert.equal(state(r(h(fi.FichaBase, { read: ok(read()), tables: error, acts: {} }))), "error");
  const none = r(h(fi.FichaBase, { read: ok(read({ base: base({ state: "none", databases: [], lever: { can: false, reason: "x" } }) })), tables: loading, acts: {} }));
  assert.match(none, /data-state="empty"[^>]*>Este piso no tiene una base/);
  const off = r(h(fi.FichaBase, { read: ok(read({ base: base({ state: "off" }) })), tables: { status: "idle" }, acts: {} }));
  assert.match(off, /data-base-off="true"[^>]*>La base está apagada/);
  assert.ok(!off.includes("maq-vaciar"), "nothing to empty while it is off");
});

test("I48-5 #3: Vaciar y sembrar asks first, the button names the count from the read and sends it; Cancelar leaves the base alone", () => {
  const calls: Json[] = [];
  const acts = { onVaciarPedir: () => calls.push({ ask: true }), onVaciar: (n: number) => calls.push({ vaciar: n }), onVaciarCancelar: () => calls.push({ cancel: true }) };
  const first = walk(fi.FichaBase({ read: ok(read()), tables: ok(tables), acts }));
  assert.ok(!first.some((e) => e.props?.["data-control"] === "maq-vaciar-si"), "no destructive button before asking");
  first.find((e) => e.props?.["data-control"] === "maq-vaciar").props.onClick();
  const out = r(h(fi.FichaBase, { read: ok(read()), tables: ok(tables), confirming: true, acts }));
  assert.match(out, /role="alertdialog"/);
  assert.match(out, /data-control="maq-vaciar-si"[^>]*>Vaciar 15 filas y sembrar</);
  assert.match(out, /Se borran las 15 filas de <code>lumen_dev<\/code>/);
  const confirm = walk(fi.FichaBase({ read: ok(read()), tables: ok(tables), confirming: true, acts }));
  confirm.find((e) => e.props?.["data-control"] === "maq-vaciar-no").props.onClick();
  assert.deepEqual(calls, [{ ask: true }, { cancel: true }], "Cancelar sends nothing to the base");
  confirm.find((e) => e.props?.["data-control"] === "maq-vaciar-si").props.onClick();
  assert.deepEqual(calls.at(-1), { vaciar: 15 }, "the count the screen showed");
});

test("I48-5 #1 #4: a table: columns, keys, relations, indexes; a long name keeps its line and the type moves to its own", () => {
  const out = r(h(fi.FichaTabla, { name: LONG_TABLE, tables: ok(bigTables), acts: {} }));
  assert.match(out, new RegExp(`class="edi-fi-title" title="${LONG_TABLE}">${LONG_TABLE}<`));
  const col = new RegExp(`<li data-col="${LONG_COLUMN}"><code class="edi-maq-cname" title="${LONG_COLUMN}">${LONG_COLUMN}</code><span class="edi-maq-ctype" data-type="true">timestamp with time zone · opcional</span>`);
  assert.match(out, col, "name and type are separate lines in the column's grid");
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.ok(css.includes(".edi-maq-cols li { display: grid; grid-template-columns: minmax(0, 1fr);"), "one column: the type sits under the name");
  assert.ok(css.includes(".edi-maq-cname { font-size: 12.5px; color: var(--e-fg); overflow-wrap: anywhere; }"));
  assert.match(out, /<em>llave<\/em>/);
  assert.match(out, /data-control="maq-ref"[^>]*>→ sucursal\.id</);
  assert.match(out, /se muestra \(oculto\)/);
  assert.match(out, /registro_pkey/);
  assert.equal(state(r(h(fi.FichaTabla, { name: "registro", tables: loading, acts: {} }))), "loading");
  assert.equal(state(r(h(fi.FichaTabla, { name: "registro", tables: error, acts: {} }))), "error");
  assert.match(r(h(fi.FichaTabla, { name: "nota", tables: ok(tables), acts: {} })), /data-state="empty"[^>]*>No hay una tabla nota/);
  // A long name on its drawer: ellipsis, the whole name in title.
  const drawer = renderToStaticMarkup(h(ui.Maquinas, { read: ok(read()), tables: ok(bigTables), acts: {} }));
  assert.match(drawer, new RegExp(`title="${LONG_TABLE} · 0 filas" data-drawer="${LONG_TABLE}"><code>${LONG_TABLE}</code>`));
  assert.ok(css.includes(".edi-maq-drawer code { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }"));
});

test("I48-5 #1: Llaves and Pruebas in their states", () => {
  const k = r(h(fi.FichaLlaves, { llaves: ok(llaves) }));
  assert.match(k, /data-set="false"[\s\S]*?RESEND_API_KEY[\s\S]*?falta/);
  assert.match(k, /Solo nombres\. Plania nunca muestra ni guarda un valor/);
  assert.equal(state(r(h(fi.FichaLlaves, { llaves: loading }))), "loading");
  assert.equal(state(r(h(fi.FichaLlaves, { llaves: error }))), "error");
  assert.match(r(h(fi.FichaLlaves, { llaves: ok({ ...llaves, llaves: [], set: 0, missing: 0 }) })), /data-state="empty"/);
  const p = r(h(fi.FichaPruebas, { pruebas: ok(pruebas), acts: {} }));
  assert.match(p, /data-last="fail"[^>]*>Fallaron · 174 pasan · 1 fallan · 41 s/);
  assert.match(p, /FAIL registro\.test\.ts\nexpected 2 got 3/);
  assert.match(p, /data-control="maq-correr-pruebas"[^>]*>Correr las pruebas</);
  assert.equal(state(r(h(fi.FichaPruebas, { pruebas: loading, acts: {} }))), "loading");
  assert.equal(state(r(h(fi.FichaPruebas, { pruebas: error, acts: {} }))), "error");
  assert.match(r(h(fi.FichaPruebas, { pruebas: ok({ ...pruebas, last: null }), acts: {} })), /data-state="empty"[^>]*>Todavía no se han corrido/);
  const running = r(h(fi.FichaPruebas, { pruebas: ok({ ...pruebas, running: { started_at: "x", step: "test" } }), acts: {} }));
  assert.match(running, /disabled=""[^>]*data-control="maq-correr-pruebas"[^>]*>Corriendo test…</);
});

test("I48-5: a drawer lays its rows over the window, paged with the total, «datos de muestra»; the map lays the tables", () => {
  const rows = { table: "registro", columns: ["id", "nombre", "password_hash"], hidden: ["password_hash"], rows: Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1), nombre: `Novia Ejemplo ${i + 1}`, password_hash: "(oculto)" })), offset: 0, limit: 50, total: 120 };
  const out = renderToStaticMarkup(h(ui.Maquinas, { read: ok(read()), tables: ok(tables), rows: ok(rows), drawer: "registro", acts: {} }));
  assert.match(out, /data-sheet="rows"/);
  assert.match(out, /aria-pressed="true"[^>]*data-drawer="registro"/);
  assert.match(out, /data-sample="true">datos de muestra</);
  assert.match(out, /data-paging="true"><span>1–50 de 120<\/span>/);
  assert.match(out, /<td data-hidden="true" title="\(oculto\)">\(oculto\)<\/td>/);
  const empty = renderToStaticMarkup(h(ui.Maquinas, { read: ok(read()), tables: ok(tables), rows: ok({ ...rows, rows: [], total: 0 }), drawer: "sucursal", acts: {} }));
  assert.match(empty, /data-state="empty"[^>]*>La tabla está vacía/);
  const map = renderToStaticMarkup(h(ui.Maquinas, { read: ok(read()), tables: ok(bigTables), mapa: true, acts: {} }));
  assert.match(map, /data-sheet="map"/);
  assert.match(map, /3 tablas · 1 relaciones/);
  assert.match(map, /data-ref="sucursal\.id"/);
  // Paging calls back with the next offset.
  const calls: number[] = [];
  walk(ui.Maquinas({ read: ok(read()), tables: ok(tables), rows: ok(rows), drawer: "registro", acts: { onRows: (o: number) => calls.push(o) } }))
    .find((e) => e.props?.["data-control"] === "maq-filas-despues")
    .props.onClick();
  assert.deepEqual(calls, [50]);
});

test("I48-5 #2: fichaOf parses every new ?f= kind, refuses bad ones, and the old kinds still open", () => {
  for (const what of ["servidor", "base", "llaves", "pruebas", "probar"]) {
    assert.deepEqual(lib.fichaOf(`?f=maq:${what}`), { ref: { kind: "maq", what }, slug: null });
    assert.equal(lib.fichaParam({ kind: "maq", what }), `maq:${what}`);
  }
  assert.deepEqual(lib.fichaOf("?f=maq:tabla:registro"), { ref: { kind: "maq-tabla", name: "registro" }, slug: null });
  assert.equal(lib.fichaSearch("lumen", { kind: "maq-tabla", name: "registro" }, "maquinas"), "?piso=lumen&nivel=maquinas&f=maq%3Atabla%3Aregistro");
  assert.equal(lib.fichaOf("?f=maq:tabla:drop table x"), null);
  assert.equal(lib.fichaOf("?f=maq:nada"), null);
  assert.equal(lib.tabOf({ kind: "maq", what: "base" }), "resumen");
  assert.equal(lib.escStep({ kind: "maq-tabla", name: "registro" }).kind, "tab");
  // The old kinds.
  assert.deepEqual(lib.fichaOf("?f=tab:prs"), { ref: { kind: "tab", tab: "prs" }, slug: null });
  assert.deepEqual(lib.fichaOf("?f=step:LUM-2"), { ref: { kind: "step", key: "LUM-2" }, slug: null });
  assert.deepEqual(lib.fichaOf("?f=app"), { ref: { kind: "app" }, slug: null });
  assert.deepEqual(lib.fichaOf("?m=lumen:taller-lumen"), { ref: { kind: "member", agent: "taller-lumen" }, slug: "lumen" });
  // La ficha draws a Máquinas kind from the page's slot.
  const project = { slug: "lumen", title: "Lumen", light: "ok", light_reason: null, rumbo: { goal: "x" }, team: [], stale_requests: [], this_week: { done: 0, docs: 0, prs: 0, last_at: null } };
  const out = r(h(ficha.Ficha, { project, fref: { kind: "maq", what: "base" }, rows: { status: "idle" }, task: { status: "idle" }, doc: { status: "idle" }, slots: { maq: h("p", null, "BASE AQUI") }, now: 0, onRef: () => {}, onClose: () => {} }));
  assert.match(out, /data-ficha="maq"/);
  assert.match(out, /BASE AQUI/);
});
