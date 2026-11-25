// The Pedir palette (ui/src/components/paleta/paleta.tsx): one field, from any screen, to ask a project for something
// or go to a project or a screen. ⌘K / Ctrl+K opens it; the header's button does the same on a phone. Its keys, which
// project it starts on and its rows, tested without a browser (test/paleta.test.ts). ADR 0008: La corriente's bar stays
// the Pedir inside a project; this is the Pedir for the whole app.
// Pure and relative imports only, so the node tests load it.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export const PALETA_WORDS = defineWords({
  es: {
    abrir: "Pedir",
    titulo: "Pedir o ir a…",
    campo: "Qué necesitas, o adónde ir",
    placeholder: "Pide algo, o escribe un proyecto o una pantalla…",
    placeholderDestino: "Elige el proyecto…",
    proyecto: "Proyecto",
    cambiarProyecto: (p: string) => `Proyecto: ${p}. Cambiar con @`,
    como: "Cómo",
    pedirEn: (p: string) => `Pedir en ${p}`,
    preguntarEn: (p: string) => `Preguntar en ${p}`,
    escribe: "Escribe lo que necesitas",
    usar: "Pedir aquí",
    proyectos: "Proyectos",
    paginas: "Páginas",
    nada: "Nada con ese nombre",
    enviando: "Enviando…",
    fallo: "No se pudo enviar. Tu texto sigue aquí; inténtalo de nuevo. Si la máquina está dormida, espera a que despierte.",
    teclas: { enter: "Enter envía o abre", flechas: "↑↓ elige", modo: "Shift+Tab cambia el modo", arroba: "@ cambia de proyecto", esc: "Esc cierra" },
    inicio: "Inicio",
  },
  en: {
    abrir: "Ask",
    titulo: "Ask or go to…",
    campo: "What you need, or where to go",
    placeholder: "Ask for something, or type a project or a screen…",
    placeholderDestino: "Pick the project…",
    proyecto: "Project",
    cambiarProyecto: (p: string) => `Project: ${p}. Change it with @`,
    como: "How",
    pedirEn: (p: string) => `Ask ${p}`,
    preguntarEn: (p: string) => `Ask ${p} a question`,
    escribe: "Type what you need",
    usar: "Ask here",
    proyectos: "Projects",
    paginas: "Pages",
    nada: "Nothing by that name",
    enviando: "Sending…",
    fallo: "Could not send. Your text is still here; try again. If the machine is asleep, wait until it wakes up.",
    teclas: { enter: "Enter sends or opens", flechas: "↑↓ choose", modo: "Shift+Tab changes the mode", arroba: "@ changes the project", esc: "Esc closes" },
    inicio: "Home",
  },
});

export const paletaWords = (language: Language = getLanguage()) => words(PALETA_WORDS, language);

// ---- The key

export type Tecla = { key: string; meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean };

/** A Mac (or an iPad with a keyboard) uses ⌘; everything else Ctrl. */
export function esMac(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The hint shown on the header's button. */
export function atajoTexto(mac: boolean): string {
  return mac ? "⌘K" : "Ctrl K";
}

/**
 * What ⌘K / Ctrl+K does now: open the palette, close it (the same key toggles), or nothing. It works from inside any
 * field (it is a chord, nothing anyone types), but never over another dialog (the wizard, a sheet): the palette would
 * stack on it. Alt or Shift held, or the other platform's modifier, is someone else's shortcut.
 */
export function atajo(e: Tecla, mac: boolean, estado: { abierta: boolean; otroDialogo: boolean }): "abrir" | "cerrar" | null {
  if (e.key.toLowerCase() !== "k" || e.alt || e.shift) return null;
  const mod = mac ? e.meta && !e.ctrl : e.ctrl && !e.meta;
  if (!mod) return null;
  if (estado.abierta) return "cerrar";
  return estado.otroDialogo ? null : "abrir";
}

// ---- Which project it starts on

/** The project the screen is on: /p/<slug>, or La corriente's floor (/ceo?piso=<slug>). */
export function proyectoDeRuta(pathname: string, search: string): string | null {
  const p = pathname.match(/^\/p\/([^/?#]+)/);
  if (p) return decodeURIComponent(p[1]!);
  if (pathname === "/ceo") return new URLSearchParams(search).get("piso");
  return null;
}

/** The screen's project when there is one, else the one asked last on this device, else the first. */
export function proyectoInicial(slugs: readonly string[], ruta: string | null, ultimo: string | null): string | null {
  if (ruta && slugs.includes(ruta)) return ruta;
  if (ultimo && slugs.includes(ultimo)) return ultimo;
  return slugs[0] ?? null;
}

// ---- The rows

export type Lugar = { to: string; label: string };
export type ProyectoLista = { slug: string; title: string };
export type Fila =
  | { kind: "pedir"; slug: string; listo: boolean }
  | { kind: "destino"; slug: string; title: string }
  | { kind: "proyecto"; slug: string; title: string; to: string }
  | { kind: "pantalla"; to: string; label: string };

/** Lower case, no accents: «Máquina» is found by «maquina». */
export function plano(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const coincide = (q: string, ...campos: string[]) => !q || campos.some((c) => plano(c).includes(q));

/** Text that starts with @ picks the destination project; what follows the @ filters them. */
export function arroba(texto: string): string | null {
  const m = texto.match(/^@(\S*)$/);
  return m ? plano(m[1]!) : null;
}

/** Projects listed under the field at most; the pages (a handful) always all show. */
const MAX_PROYECTOS = 5;

/**
 * The rows under the field. After an @: only projects, and choosing one makes it the destination. Otherwise the first
 * row is always «Pedir en <project>» (Enter sends; it waits for words), then the projects (five at most) and the pages
 * whose name has what was typed, to go to; each kind is its own section. A long request names no page, so nothing
 * else shows under it.
 */
export function filasDe(texto: string, proyectos: readonly ProyectoLista[], pantallas: readonly Lugar[], destino: string | null): Fila[] {
  const q = arroba(texto);
  if (q !== null) return proyectos.filter((p) => coincide(q, p.title, p.slug)).map((p) => ({ kind: "destino", slug: p.slug, title: p.title }));
  const filas: Fila[] = destino ? [{ kind: "pedir", slug: destino, listo: texto.trim().length > 0 }] : [];
  const buscado = plano(texto);
  if (buscado.length > 40) return filas;
  const enProyectos = proyectos
    .filter((p) => coincide(buscado, p.title, p.slug))
    .slice(0, MAX_PROYECTOS)
    .map((p): Fila => ({ kind: "proyecto", slug: p.slug, title: p.title, to: `/p/${encodeURIComponent(p.slug)}` }));
  const enPaginas = pantallas.filter((s) => coincide(buscado, s.label)).map((s): Fila => ({ kind: "pantalla", to: s.to, label: s.label }));
  return [...filas, ...enProyectos, ...enPaginas];
}

export type Seccion = "proyectos" | "paginas";

/** The section a row belongs to: projects (to ask or to go to) or the app's pages. Pedir heads the list, untitled. */
export function seccionDe(f: Fila): Seccion | null {
  return f.kind === "pedir" ? null : f.kind === "pantalla" ? "paginas" : "proyectos";
}

/** The rows grouped by section in their order, so each section is drawn under its own title. */
export function agrupar(filas: readonly Fila[]): { seccion: Seccion | null; filas: { fila: Fila; n: number }[] }[] {
  const grupos: { seccion: Seccion | null; filas: { fila: Fila; n: number }[] }[] = [];
  filas.forEach((fila, n) => {
    const seccion = seccionDe(fila);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.seccion === seccion) ultimo.filas.push({ fila, n });
    else grupos.push({ seccion, filas: [{ fila, n }] });
  });
  return grupos;
}

/** Arrow keys move the choice round the rows; Home and End jump. Any other key: no move. */
export function mover(actual: number, total: number, key: string): number | null {
  if (total === 0) return null;
  if (key === "ArrowDown") return (actual + 1) % total;
  if (key === "ArrowUp") return (actual - 1 + total) % total;
  return null;
}
