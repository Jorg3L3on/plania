// The Pedir palette (ui/src/lib/paleta.ts, ui/src/components/paleta/paleta.tsx; ADR 0008): ⌘K / Ctrl+K from every
// screen, the project it starts on, its rows, and what the component keeps when a send fails. Pure, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { agrupar, arroba, atajo, atajoTexto, esMac, filasDe, mover, PALETA_WORDS, plano, proyectoDeRuta, proyectoInicial } from "../ui/src/lib/paleta.js";

const cerrada = { abierta: false, otroDialogo: false };

test("the key: ⌘K on a Mac, Ctrl+K elsewhere, from any field; it toggles, and never opens over another dialog", () => {
  assert.equal(esMac("MacIntel"), true);
  assert.equal(esMac("iPad"), true);
  assert.equal(esMac("Win32"), false);
  assert.equal(esMac("Linux x86_64"), false);
  assert.deepEqual([atajoTexto(true), atajoTexto(false)], ["⌘K", "Ctrl K"]);

  assert.equal(atajo({ key: "k", meta: true }, true, cerrada), "abrir");
  assert.equal(atajo({ key: "K", meta: true }, true, cerrada), "abrir", "caps lock on");
  assert.equal(atajo({ key: "k", ctrl: true }, false, cerrada), "abrir");
  assert.equal(atajo({ key: "k", ctrl: true }, true, cerrada), null, "Ctrl+K on a Mac is the system's");
  assert.equal(atajo({ key: "k", meta: true }, false, cerrada), null);
  assert.equal(atajo({ key: "k" }, true, cerrada), null, "a plain k is typing");
  assert.equal(atajo({ key: "k", meta: true, shift: true }, true, cerrada), null);
  assert.equal(atajo({ key: "k", meta: true, alt: true }, true, cerrada), null);
  assert.equal(atajo({ key: "j", meta: true }, true, cerrada), null);

  assert.equal(atajo({ key: "k", meta: true }, true, { abierta: true, otroDialogo: false }), "cerrar", "the same key closes it");
  assert.equal(atajo({ key: "k", meta: true }, true, { abierta: false, otroDialogo: true }), null, "the wizard is open: nothing");
});

test("the project it starts on: the screen's, else the last asked, else the first", () => {
  assert.equal(proyectoDeRuta("/p/zeep", ""), "zeep");
  assert.equal(proyectoDeRuta("/p/zeep/tareas", "?task=Z-1"), "zeep");
  assert.equal(proyectoDeRuta("/p/caf%C3%A9", ""), "café");
  assert.equal(proyectoDeRuta("/ceo", "?piso=micasa&nivel=maquinas"), "micasa", "La corriente's floor");
  assert.equal(proyectoDeRuta("/ceo", ""), null);
  assert.equal(proyectoDeRuta("/", "?piso=x"), null);
  assert.equal(proyectoDeRuta("/inbox", ""), null);

  const slugs = ["a", "b", "c"];
  assert.equal(proyectoInicial(slugs, "b", "c"), "b");
  assert.equal(proyectoInicial(slugs, null, "c"), "c");
  assert.equal(proyectoInicial(slugs, "gone", "also-gone"), "a", "a project that left the list is skipped");
  assert.equal(proyectoInicial([], null, null), null);
});

const proyectos = [
  { slug: "zeep", title: "Zeep" },
  { slug: "micasa", title: "Mi Casa" },
];
const pantallas = [
  { to: "/", label: "Inicio" },
  { to: "/machine", label: "Máquina" },
  { to: "/inbox", label: "Bandeja" },
];

test("the rows: Pedir first, then the projects and screens by name; a long request lists nothing else", () => {
  const vacio = filasDe("", proyectos, pantallas, "zeep");
  assert.deepEqual(vacio[0], { kind: "pedir", slug: "zeep", listo: false }, "Pedir waits for words");
  assert.equal(vacio.length, 1 + 2 + 3, "with nothing typed every project and every page shows");

  const maq = filasDe("maquina", proyectos, pantallas, "zeep");
  assert.deepEqual(maq.map((f) => f.kind), ["pedir", "pantalla"], "accents do not matter");
  assert.equal(maq[0]!.kind === "pedir" && maq[0]!.listo, true);

  const casa = filasDe("casa", proyectos, pantallas, "zeep");
  assert.deepEqual(casa[1], { kind: "proyecto", slug: "micasa", title: "Mi Casa", to: "/p/micasa" });

  const largo = filasDe("Agrega una agenda en línea para que la novia elija sucursal y hora", proyectos, pantallas, "zeep");
  assert.deepEqual(largo.map((f) => f.kind), ["pedir"]);

  assert.deepEqual(filasDe("x", proyectos, pantallas, null).map((f) => f.kind), [], "no project: nothing to ask");
});

test("the rows after @: only projects, to pick where the words go", () => {
  assert.equal(arroba("@"), "");
  assert.equal(arroba("@Casa"), "casa");
  assert.equal(arroba("hola @casa"), null, "an @ inside a request is just text");
  assert.equal(arroba("@mi casa"), null);
  assert.deepEqual(filasDe("@", proyectos, pantallas, "zeep").map((f) => f.kind), ["destino", "destino"]);
  assert.deepEqual(filasDe("@casa", proyectos, pantallas, "zeep"), [{ kind: "destino", slug: "micasa", title: "Mi Casa" }]);
  assert.deepEqual(filasDe("@nada", proyectos, pantallas, "zeep"), []);
  assert.equal(plano("  Máquina "), "maquina");
});

test("the arrows go round the rows", () => {
  assert.equal(mover(0, 3, "ArrowDown"), 1);
  assert.equal(mover(2, 3, "ArrowDown"), 0);
  assert.equal(mover(0, 3, "ArrowUp"), 2);
  assert.equal(mover(0, 3, "Enter"), null);
  assert.equal(mover(0, 0, "ArrowDown"), null);
});

test("the component: the shell's one palette; a failed send keeps the words; no motion on a computer", () => {
  const src = readFileSync(new URL("../ui/src/components/paleta/paleta.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../ui/src/components/app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /useAtajoPaleta\(paleta, setPaleta, hayPaleta\)/);
  assert.match(shell, /<PaletaBoton onAbrir=\{abrirPaleta\} \/>/);
  // It never opens over another dialog: the key reads every dialog but its own.
  assert.match(src, /\[role="dialog"\]:not\(\[data-paleta\]\)/);
  // The send clears the words only once it went; the failure path keeps them and says so.
  const enviar = src.slice(src.indexOf("async function enviar"), src.indexOf("function activar"));
  assert.ok(enviar.indexOf('setTexto("")') > enviar.indexOf("await api.askProject"));
  assert.match(enviar.slice(enviar.indexOf("catch")), /setFallo\(true\)/);
  assert.doesNotMatch(enviar.slice(enviar.indexOf("catch")), /setTexto/);
  // On a computer the overlay and the panel have no animation; only the phone's sheet moves.
  assert.match(src, /data-open:animate-none data-closed:animate-none/);
  assert.doesNotMatch(src.replace(/max-sm:[^\s"]+/g, ""), /data-open:animate-in|slide-in-from/);
  // Both languages carry the same words (the I2-10 guard checks the shape; this checks the key hints exist).
  assert.deepEqual(Object.keys(PALETA_WORDS.es.teclas), Object.keys(PALETA_WORDS.en.teclas));
});

test("the rows come in sections: Pedir untitled, then Proyectos, then Páginas; five projects at most, every page", () => {
  const muchos = Array.from({ length: 8 }, (_, k) => ({ slug: `p${k}`, title: `Proyecto ${k}` }));
  const filas = filasDe("", muchos, pantallas, "p0");
  const grupos = agrupar(filas);
  assert.deepEqual(grupos.map((g) => [g.seccion, g.filas.length]), [[null, 1], ["proyectos", 5], ["paginas", 3]], "the pages are never pushed out");
  // Each row keeps its place in the whole list, so the arrows and aria-activedescendant run across sections.
  assert.deepEqual(grupos.flatMap((g) => g.filas.map((f) => f.n)), filas.map((_, n) => n));
  assert.deepEqual(agrupar(filasDe("@", proyectos, pantallas, "zeep")).map((g) => g.seccion), ["proyectos"]);
  assert.deepEqual([PALETA_WORDS.es.proyectos, PALETA_WORDS.es.paginas], ["Proyectos", "Páginas"]);
  // No «Ir a» on any row: the section title says what the rows are.
  const src = readFileSync(new URL("../ui/src/components/paleta/paleta.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /w\.ir\b/);
  assert.equal("ir" in PALETA_WORDS.es, false);
});
