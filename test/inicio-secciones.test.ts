// Inicio's sections by the first-delivery guide's stage (ui/src/lib/inicio-secciones.ts): while the wizard runs the
// page is the guide and whatever already holds something; once the guide is gone every section shows as before.
// Pure, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { etapaDe, maquinaEnUso, seccionesDe } from "../ui/src/lib/inicio-secciones.js";
import type { GuiaRead } from "../ui/src/lib/primera-entrega.js";
import type { Machine } from "../ui/src/lib/types.js";

const guia: GuiaRead = {
  visible: true,
  proyecto: null,
  maquina: "sin_revisar",
  company_paused: true,
  project_paused: true,
  pedido: false,
  plan: "nada",
  entrega: "nada",
  fallo: null,
  est_pct_per_run: 3,
};
const proyecto = { slug: "zeep", title: "zeep" };
const corre = { company_paused: false, project_paused: false };

test("stage: the wizard's steps, then the team's turn, then no guide; no reading counts as no guide", () => {
  assert.equal(etapaDe(guia), "guia");
  assert.equal(etapaDe({ ...guia, maquina: "lista", proyecto, ...corre }), "guia", "started, the first task not sent");
  assert.equal(etapaDe({ ...guia, maquina: "lista", proyecto, ...corre, pedido: true }), "equipo");
  assert.equal(etapaDe({ ...guia, visible: false }), "normal");
  assert.equal(etapaDe(undefined), "normal", "a failed /api/guia never hides an established owner's page");
});

test("sections: during the wizard only what holds something; once it is done, everything as before", () => {
  const base = { proyectos: 1, metas: 0, maquinaEnUso: false };
  assert.deepEqual(seccionesDe({ ...base, etapa: "guia" }), { pedir: false, metas: false, maquina: false, proyectos: true });
  // The team's turn: the guide card is gone, so the page is the usual one. The city is not gated at all.
  assert.deepEqual(seccionesDe({ ...base, etapa: "equipo" }), { pedir: true, metas: true, maquina: true, proyectos: true });
  // Whatever already holds something shows at any stage.
  const lleno = seccionesDe({ ...base, etapa: "guia", metas: 1, maquinaEnUso: true });
  assert.deepEqual([lleno.metas, lleno.maquina, lleno.pedir], [true, true, false]);
  // No guide: every section, empty or not, as Inicio always was.
  assert.deepEqual(seccionesDe({ ...base, etapa: "normal", proyectos: 0, metas: null }), { pedir: false, metas: true, maquina: true, proyectos: false });
  assert.equal(seccionesDe({ ...base, etapa: "guia", proyectos: 0 }).proyectos, false, "no tile rail with no tiles");
});

test("machine: in use once it runs, stores or found anything", () => {
  const m = (over: Partial<Machine["totals"]> = {}, findings = 0): Machine =>
    ({ machine: "mac", totals: { servers: 0, databases: 0, worktree_kb: 0, orphan: 0, stale: 0, ...over }, findings: Array.from({ length: findings }, () => ({ code: "x", key: null, detail: "", fix_hint: "" })), items: [] }) as Machine;
  assert.equal(maquinaEnUso(undefined, 0), false);
  assert.equal(maquinaEnUso(m(), 0), false);
  assert.equal(maquinaEnUso(m(), 1), true, "a live port");
  assert.equal(maquinaEnUso(m({ databases: 1 }), 0), true);
  assert.equal(maquinaEnUso(m({ worktree_kb: 10 }), 0), true);
  assert.equal(maquinaEnUso(m({}, 1), 0), true);
});

test("the page reads the rules; the city is never gated", () => {
  const src = readFileSync(new URL("../ui/src/pages/home.tsx", import.meta.url), "utf8");
  assert.match(src, /seccionesDe\(\{/);
  for (const id of ["pedir", "metas"]) assert.match(src, new RegExp(`<Seccion show=\\{ver\\.${id}\\} id="${id}">`));
  assert.doesNotMatch(src, /ver\.ciudad/);
  // Same cache as the card: no request of its own.
  assert.match(src, /queryKey: \["guia"\]/);
});

test("the guide card shows only while the wizard has a step left; the wizard stays mounted outside it", () => {
  const card = readFileSync(new URL("../ui/src/components/home/guia-primera-entrega.tsx", import.meta.url), "utf8");
  assert.match(card, /\{t\.enAsistente \? \(\s*<motion\.div/);
  // The dialog sits after the card's presence, so hiding the card never cuts the dialog's close short.
  assert.ok(card.indexOf("<GuiaWizard") > card.lastIndexOf("</AnimatePresence>"));
});
