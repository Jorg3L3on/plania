// AUDIT-5: Calidad, the scoreboard's page. The words (ui/src/lib/calidad.ts) and what the view renders from one
// answer of GET /api/scoreboard: the designed empty state, the summary first, the table with dashes for what could
// not be measured, and the reading list. Fake data, no browser, no server.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/calidad.ts");
const { CalidadView } = await load("pages/calidad.tsx");

const h = React.createElement;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

const group = (key: string | null, patch: Record<string, unknown> = {}) => ({
  key,
  runs: 0,
  tickets_landed: 0,
  runs_per_ticket: null,
  tokens_per_ticket: null,
  qa_first: { passed: 0, concluded: 0, rate: null },
  sent_back: { count: 0, passed: 0, rate: null },
  failures: { total: 0, max_turns: 0, other: 0, by_reason: [] },
  blocked_after_two: 0,
  resumed: { runs: 0, fresh_runs: 0, share: null, ok_rate_resumed: null, ok_rate_fresh: null },
  context_tokens_median: null,
  ...patch,
});
const board = (patch: Record<string, unknown> = {}) => ({ days: 28, since: "2026-10-20T00:00:00.000Z", until: "2026-11-17T00:00:00.000Z", project: null, by: "model", empty: false, total: group(null), groups: [], to_read: [], ...patch });

const TOTAL = group(null, {
  runs: 10,
  tickets_landed: 3,
  runs_per_ticket: 7 / 3,
  tokens_per_ticket: 3607,
  qa_first: { passed: 1, concluded: 2, rate: 0.5 },
  sent_back: { count: 1, passed: 3, rate: 1 / 3 },
  failures: { total: 3, max_turns: 1, other: 2, by_reason: [{ reason: "error_max_turns", count: 1 }, { reason: "timeout", count: 1 }, { reason: "something_new", count: 1 }] },
  blocked_after_two: 1,
  resumed: { runs: 3, fresh_runs: 6, share: 1 / 3, ok_rate_resumed: 2 / 3, ok_rate_fresh: 2 / 3 },
  context_tokens_median: 85_000,
});

test("words: group names, failure reasons and run summaries read as plain Spanish", () => {
  assert.equal(lib.groupName("role", "taller"), "Taller");
  assert.equal(lib.groupName("role", "product-owner"), "Product owner");
  assert.equal(lib.groupName("resumed", "resumed"), "Retomó una sesión");
  assert.equal(lib.groupName("resumed", "fresh"), "Empezó de cero");
  assert.equal(lib.groupName("skills", "review@22222222, tdd@11111111"), "review, tdd");
  assert.equal(lib.groupDetail("skills", "review@22222222, tdd@11111111"), "22222222 · 11111111");
  assert.equal(lib.groupName("model", null), "Modelo por defecto");
  assert.equal(lib.groupName("prompt_version", null), "Sin versión registrada");
  assert.equal(lib.groupName("skills", null), "Sin habilidades");
  assert.equal(lib.reasonWord("error_max_turns"), "Llegó al tope de turnos");
  assert.equal(lib.reasonWord("something_new"), "something new");
  assert.equal(lib.runWords("fail: error_max_turns (41 turns, session c1)"), "Falló: llegó al tope de turnos (41 turnos)");
  assert.equal(lib.runWords("fail: no result after timeout"), "Falló: se acabó el tiempo");
  assert.equal(lib.runWords("ok: success, 8 turns, session b1"), "Terminó bien (8 turnos)");
  assert.equal(lib.runWords("stopped: company paused (success, 2 turns)"), "Se detuvo (2 turnos)");
  assert.equal(lib.runWords(null), null);
});

test("numbers: a missing rate is a dash, never a zero", () => {
  assert.equal(lib.pct(null), "—");
  assert.equal(lib.pct(0), "0 %");
  assert.equal(lib.pct(0.5), "50 %");
  assert.equal(lib.decimal(7 / 3), "2.3");
  assert.equal(lib.compact(null), "—");
  assert.equal(lib.compact(20), "20");
  assert.equal(lib.compact(6700), "6.7 k");
  assert.equal(lib.compact(1_250_000), "1.3 M");
  assert.equal(lib.parseBy("skills"), "skills");
  assert.equal(lib.parseBy("nope"), "role");
  assert.equal(lib.parseDays("90"), 90);
  assert.equal(lib.parseDays("0"), 28);
});

test("resumen: the period in sentences, and nothing invented when there is no data", () => {
  assert.deepEqual(lib.resumen(TOTAL), [
    "Se terminaron 3 tareas; cada una tomó en promedio 2.3 corridas y 3.6 k tokens.",
    "QA aprobó a la primera 1 de 2 entregas.",
    "Devolviste 1 de 3 entregas que QA había aprobado.",
    "Fallaron 3 corridas, 1 por llegar al tope de turnos.",
    "1 tarea quedó detenida después de fallar dos veces seguidas.",
  ]);
  assert.deepEqual(lib.resumen(group(null, { runs: 2 })), ["No se terminó ninguna tarea en este periodo.", "QA todavía no revisó ninguna entrega.", "Ninguna corrida falló."]);
});

test("empty: a designed state that says what will appear, with no table and no ticket keys", () => {
  const html = renderToStaticMarkup(h(CalidadView, { data: board({ empty: true }) }));
  const t = text(html);
  assert.match(t, /Todavía no hay nada que medir/);
  assert.match(t, /En cuanto haya corridas, aquí vas a ver/);
  for (const line of ["Tareas terminadas y lo que costaron", "QA a la primera", "Lo que devolviste tú", "Por qué fallan las corridas", "La lectura de la semana"]) assert.ok(t.includes(line), line);
  assert.ok(!html.includes("<table"));
  // A narrowed read says so instead of promising.
  assert.match(text(renderToStaticMarkup(h(CalidadView, { data: board({ empty: true, project: "workia" }) }))), /prueba con un periodo más largo o con todos los proyectos/);
});

test("seeded: summary first, then the groups with tabular figures, the reasons and the reading list", () => {
  const data = board({
    total: TOTAL,
    groups: [
      group("opus", { runs: 5, tickets_landed: 1, runs_per_ticket: 2, tokens_per_ticket: 6700, qa_first: { passed: 1, concluded: 1, rate: 1 }, sent_back: { count: 0, passed: 1, rate: 0 }, failures: { total: 3, max_turns: 1, other: 2, by_reason: [{ reason: "error_max_turns", count: 1 }] }, blocked_after_two: 1, resumed: { runs: 1, fresh_runs: 3, share: 0.25, ok_rate_resumed: 0, ok_rate_fresh: 1 / 3 }, context_tokens_median: 50_000 }),
      group("haiku", { runs: 1, tickets_landed: 1, runs_per_ticket: 1, tokens_per_ticket: 20, resumed: { runs: 0, fresh_runs: 1, share: 0, ok_rate_resumed: null, ok_rate_fresh: 1 } }),
      group(null, { runs: 4 }),
    ],
    to_read: [
      { kind: "failed", project: "zigzag", key: "ZIG-3", title: "Arreglar el login", role: "taller", at: "2026-11-15T10:00:00.000Z", summary: "fail: error_max_turns (41 turns, session c1)", qa_notes: null, attempt: null, owner_text: null },
      { kind: "sent_back", project: "zigzag", key: "ZIG-2", title: "Botón de pago", role: "taller", at: "2026-11-13T10:00:00.000Z", summary: "ok: success, 8 turns", qa_notes: "Pasa: el login ya responde.", attempt: 2, owner_text: "El botón no se ve en el teléfono." },
      { kind: "returned", project: "zigzag", key: "ZIG-2", title: "Botón de pago", role: "taller", at: "2026-11-11T10:00:00.000Z", summary: "ok: success, 30 turns", qa_notes: "Falla el test de login.", attempt: 1, owner_text: null },
    ],
  });
  const html = renderToStaticMarkup(h(CalidadView, { data, now: Date.parse("2026-11-17T10:00:00.000Z") }));
  const t = text(html);

  // Summary before the table, the table before the reading list.
  const at = (s: string) => {
    const i = t.indexOf(s);
    assert.ok(i >= 0, `missing: ${s}`);
    return i;
  };
  assert.ok(at("Se terminaron 3 tareas") < at("Por modelo"));
  assert.ok(at("Por modelo") < at("Por qué fallaron"));
  assert.ok(at("Por qué fallaron") < at("Para leer esta semana"));

  // The four numbers.
  assert.match(t, /QA a la primera 50 % 1 de 2 entregas/);
  assert.match(t, /Devueltas por ti 33 % 1 de 3 que QA aprobó/);
  assert.match(t, /Corridas con error 3 de 10; 1 por tope de turnos/);

  // The table: one row per group, a total row, numbers in tabular figures, dashes where nothing could be measured.
  assert.equal((html.match(/<tr/g) ?? []).length, 1 + 3 + 1);
  assert.match(t, /opus 5 1 2 6\.7 k 100 % 1 de 1 0 % 0 de 1 3 1 por tope de turnos 1 25 % 1 de 4 0 % \/ 33 % 50 k/);
  assert.match(t, /haiku 1 1 1 20 — — 0 0 0 % 0 de 1 — \/ 100 % —/);
  assert.match(t, /Modelo por defecto 4 0 — — — —/);
  assert.match(t, /Todo 10 3 2\.3 3\.6 k 50 % 1 de 2 33 % 1 de 3/);
  for (const cell of html.match(/<td[^>]*>/g) ?? []) assert.ok(cell.includes("tabular-nums"), cell);

  // Reasons in plain words; an unknown one still shows.
  assert.match(t, /Llegó al tope de turnos/);
  assert.match(t, /Se acabó el tiempo/);
  assert.match(t, /something new/);

  // The reading list: who said what, in order, with the run in plain words.
  assert.match(t, /Falló la corrida Arreglar el login zigzag · ZIG-3 · Taller hace 2 d La corrida Falló: llegó al tope de turnos \(41 turnos\)/);
  assert.match(t, /La devolviste tú Botón de pago .* Tú pediste El botón no se ve en el teléfono\. QA dijo Pasa: el login ya responde\. La corrida Terminó bien \(8 turnos\)/);
  assert.match(t, /QA la devolvió Botón de pago .* QA dijo Falla el test de login\./);
  assert.ok(!t.includes("fail:") && !t.includes("session c1"));
});

test("one group: no total row; nothing to read says so", () => {
  const html = renderToStaticMarkup(h(CalidadView, { data: board({ by: "role", total: group(null, { runs: 2 }), groups: [group("taller", { runs: 2 })] }) }));
  assert.equal((html.match(/<tr/g) ?? []).length, 2);
  assert.match(text(html), /Nada falló ni se devolvió en este periodo\./);
  assert.ok(!text(html).includes("Por qué fallaron"));
});
