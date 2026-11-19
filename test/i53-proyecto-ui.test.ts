// PLA-I53-5: /p/<slug> draws the floor's stage board, one stage-to-word map for the whole app, and a link back to the
// floor. Pure, server-rendered and source checks; no browser, no database. Fake names only.
//   #1  En paralelo is the shared StageBoard fed by the project read's tablero; Merged and Released are Hecho
//   #2  one stage-to-word map (lib/etapas.ts ETAPA_WORD); NOW_WORD, the Lista view, Líneas de trabajo and the seats'
//       status words read it; visuals.tsx has no WORD of its own
//   #3  /p/<slug> links to /ceo?piso=<slug>
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const etapas = await load("lib/etapas.ts");
const status = await load("lib/status.ts");
const org = await load("lib/org.ts");
const edificio = await load("lib/edificio.ts");
const stageWord = await load("components/plan/stage-word.tsx");
const board = await load("components/plan/stage-board.tsx");
const src = (p: string) => readFileSync(new URL(`../ui/src/${p}`, import.meta.url), "utf8");
const h = React.createElement;
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("I53-5 #1: En paralelo on /p/<slug> is the shared stage board from the project read; the lane grid is gone", () => {
  const page = src("pages/project.tsx");
  assert.match(page, /<StageBoard\s+tablero=\{tablero!\}/);
  assert.match(page, /const tablero = project\.data\?\.tablero/);
  assert.doesNotMatch(page, /LaneGrid|lane-grid/);
  assert.equal(existsSync(new URL("../ui/src/components/plan/lane-grid.tsx", import.meta.url)), false);
  assert.doesNotMatch(src("lib/lanes.ts"), /LANE_COLUMNS|emptyColumns|waitsLabel/, "the column code went with the grid");
  // Merged and Released stand under Hecho, never under Revisión.
  for (const id of ["integrado", "publicado"]) assert.equal(etapas.columnOf({ etapa: id }), "hecho");
  assert.equal(etapas.statusEtapa("Merged"), "integrado");
  assert.equal(status.statusTone("Merged"), "done");
  assert.equal(status.statusTone("Released"), "done");
  assert.equal(status.statusTone("Active"), "now", "an initiative keeps its own tone");
});

test("I53-5 #2: one stage-to-word map; every other word reads it", () => {
  // The only Record of stage words is ETAPA_WORD.
  const maps = ["lib/etapas.ts", "lib/status.ts", "lib/edificio.ts", "lib/org.ts", "components/plan/visuals.tsx", "components/plan/project-parts.tsx", "components/task-row.tsx"]
    .map((f) => [f, (src(f).match(/"In review":\s*"/g) ?? []).length + (src(f).match(/\bdevuelto:\s*"/g) ?? []).length] as const)
    .filter(([, n]) => n > 0)
    .map(([f]) => f);
  assert.deepEqual(maps, ["lib/etapas.ts"], "one file spells the stage words");
  assert.equal((src("lib/etapas.ts").match(/Record<EtapaId, string>/g) ?? []).length, 1, "and in it, one stage-to-word map");
  assert.doesNotMatch(src("components/plan/visuals.tsx"), /const WORD\b|statusWord/);
  assert.match(src("lib/edificio.ts"), /BACK_WORD = ETAPA_WORD\.devuelto/);
  assert.equal(edificio.NOW_WORD.back, etapas.ETAPA_WORD.devuelto);
  assert.equal(edificio.NOW_WORD.you, etapas.ETAPA_WORD.te_toca);
  assert.equal(org.statusWord("Merged"), "integrado");
  assert.equal(org.statusWord("stopped"), "detenida", "a run's own outcome keeps its word");
  assert.equal(etapas.statusWord("In review"), "En revisión");
  assert.equal(etapas.initiativeWord("Active"), "Activa");
});

test("I53-5 #2: the Lista view and Líneas de trabajo show the card's word for each stage", () => {
  const e = (id: string, patch: Record<string, unknown> = {}) => ({ etapa: id, qa: null, holder: null, live: false, since: null, ci: null, reason: null, ...patch });
  const cases = [e("lista"), e("construyendo", { live: true }), e("devuelto", { live: true }), e("devuelto"), e("en_qa", { qa: "queued" }), e("en_qa", { qa: "running", live: true }), e("te_toca"), e("integrado")];
  for (const x of cases) {
    const chip = text(renderToStaticMarkup(h(stageWord.StageWord, { etapa: x, status: "x" })));
    const card = renderToStaticMarkup(h(board.StageBoard, { tablero: { initiatives: [], loose: [{ key: "D-1", title: "Uno", status: "x", phase: null, parent_key: null, etapa: x }], loose_done: 0 }, now: 0 }));
    const word = /data-word="true">.*?<\/i>([^<]+)</.exec(card)?.[1];
    if (x.etapa === "integrado") assert.equal(chip, "Integrado");
    else assert.equal(chip, word, `${x.etapa}: list «${chip}» vs card «${word}»`);
  }
  assert.match(src("components/task-row.tsx"), /<StageWord etapa=\{task\.etapa\} status=\{task\.status\} \/>/);
  assert.match(src("components/plan/project-parts.tsx"), /<StageWord etapa=/);
});

test("I53-5 #3: /p/<slug> has a visible link to its floor", () => {
  const page = src("pages/project.tsx");
  assert.match(page, /to=\{`\/ceo\?piso=\$\{encodeURIComponent\(slug\)\}`\}/);
  // PLA-I2-10: the words live in the page's wording module.
  assert.match(page, /w\.seeFloor/);
  assert.match(src("lib/project-page-words.ts"), /Ver el piso/);
});
