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

test("sections: La máquina comes with the first project at any stage, its figures once it holds something", () => {
  const base = { proyectos: 1, metas: 0, maquinaEnUso: false };
  // During the wizard the block of projects shows (the first project is in it), with no row of zeros and no goals.
  assert.deepEqual(seccionesDe({ ...base, etapa: "guia" }), { metas: false, maquina: true, cifrasMaquina: false });
  // The team's turn: the guide card is gone, so the page is the usual one. The city is not gated at all.
  assert.deepEqual(seccionesDe({ ...base, etapa: "equipo" }), { metas: true, maquina: true, cifrasMaquina: false });
  // Whatever already holds something shows at any stage.
  const lleno = seccionesDe({ ...base, etapa: "guia", metas: 1, maquinaEnUso: true });
  assert.deepEqual([lleno.metas, lleno.maquina, lleno.cifrasMaquina], [true, true, true]);
  // No project: no block, at any stage; goals as Inicio always had them once the guide is done.
  assert.deepEqual(seccionesDe({ ...base, etapa: "normal", proyectos: 0, metas: null }), { metas: true, maquina: false, cifrasMaquina: false });
  assert.equal(seccionesDe({ ...base, etapa: "guia", proyectos: 0 }).maquina, false);
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
  assert.match(src, /<Seccion show=\{ver\.metas\} id="metas"/);
  // Pedir left Inicio for the palette (ADR 0008).
  assert.doesNotMatch(src, /PedirHome/);
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

test("La máquina holds the projects, each tile with its own ports; the block keeps the plan's place", () => {
  const parts = readFileSync(new URL("../ui/src/components/home/parts.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../ui/src/pages/home.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(parts, /export function (LaMac|Proyectos)\b/, "no separate machine card or projects rail");
  const bloque = parts.slice(parts.indexOf("export function LaMaquina"), parts.indexOf('// 2.10: "Próximo"'));
  assert.match(bloque, /<TileCard t=\{x\} puertos=\{porProyecto\.get\(x\.slug\) \?\? \[\]\} \/>/);
  // «Proyectos» is a quiet subheading under the machine's title, with the owner's classes.
  assert.match(bloque, /<h3 id="proyectos-titulo" className="font-medium text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none \[@media\(hover:hover\)_and_\(pointer:fine\)\]:hover:text-foreground">/);
  // The audit's warning (F + D): a quiet chip per kind with its count and colour, then the first finding, under the
  // header; the total rides on «Ver la máquina» as an amber count. The header holds no warning and nothing opens.
  const cabecera = bloque.slice(bloque.indexOf("<header"), bloque.indexOf("</header>"));
  assert.doesNotMatch(cabecera, /<button|aviso/);
  const aviso = bloque.slice(bloque.indexOf("data-aviso-maquina"), bloque.indexOf("</AnimatePresence>", bloque.indexOf("data-aviso-maquina")));
  assert.match(aviso, /tipos\.map\(\(k\) =>/);
  assert.match(aviso, /<Cifra value=\{k\.n\}/);
  assert.match(aviso, /truncate/);
  assert.doesNotMatch(aviso, /<Link|<button/);
  assert.match(bloque, /bg-status-now" \},\s*\{ kind: "orphan"[^}]*bg-status-owner" \},\s*\{ kind: "stale"[^}]*bg-status-pending" \}/, "each kind its own colour");
  assert.equal(bloque.match(/to="\/machine"/g)?.length, 1, "one way to the machine");
  // In the plan's order: Próximo, La máquina, then the goals.
  const orden = ["<Proximo", "<LaMaquina", '<Seccion show={ver.metas}'].map((t) => page.indexOf(t));
  assert.ok(orden.every((n, k) => n > 0 && (k === 0 || n > orden[k - 1]!)), String(orden));
});

test("La máquina and Metas read the same way: a green kicker that is only a title, the way in at the foot in green", () => {
  const parts = readFileSync(new URL("../ui/src/components/home/parts.tsx", import.meta.url), "utf8");
  const goals = readFileSync(new URL("../ui/src/components/goals/goals-board.tsx", import.meta.url), "utf8");
  const tarjeta = readFileSync(new URL("../ui/src/components/home/tarjeta.tsx", import.meta.url), "utf8");
  const bloque = parts.slice(parts.indexOf("export function LaMaquina"), parts.indexOf('// 2.10: "Próximo"'));
  const metas = goals.slice(goals.indexOf("export function GoalsHome"), goals.indexOf("function Barra"));
  assert.match(bloque, /<TituloTarjeta id="la-mac-titulo" icon=\{CpuIcon\}>/);
  assert.match(metas, /<TituloTarjeta id="metas-titulo" icon=\{TargetIcon\}>/);
  assert.match(bloque, /<EnlaceVer to="\/machine" cuenta=\{warn\} etiqueta=\{warn > 0 \? w\.seeMachineWarnings\(warn\) : undefined\}>\{w\.seeMachine\}<\/EnlaceVer>/);
  assert.match(bloque, /<span className="flex justify-end px-1">\s*<EnlaceVer to="\/machine"/, "the machine's way in sits at the foot's right");
  assert.match(metas, /<EnlaceVer to="\/goals">\{w\.seeGoals\}<\/EnlaceVer>/);
  // The title is a heading in the green kicker, never a link; the link is the same green.
  const titulo = tarjeta.slice(tarjeta.indexOf("export function TituloTarjeta"), tarjeta.indexOf("export function EnlaceVer"));
  assert.match(titulo, /<Kicker className="text-ink-done">/);
  assert.doesNotMatch(titulo, /<Link/);
  assert.match(tarjeta.slice(tarjeta.indexOf("export function EnlaceVer")), /font-semibold text-ink-done/);
  // The amber count (La máquina's warnings) shows only when there is one, and the link then says it aloud.
  const enlace = tarjeta.slice(tarjeta.indexOf("export function EnlaceVer"));
  assert.match(enlace, /\{cuenta > 0 \? \(/);
  assert.match(enlace, /aria-label=\{etiqueta\}/);
  assert.match(enlace, /bg-status-now/);
  // Neither card's header links anywhere on its own.
  const cabecera = bloque.slice(bloque.indexOf("<header"), bloque.indexOf("</header>"));
  assert.doesNotMatch(cabecera, /<Link/);
});
