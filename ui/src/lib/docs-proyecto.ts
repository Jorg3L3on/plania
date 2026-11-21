// PLA-135: «Docs del proyecto» in Ajustes and the doc reader (ui/src/components/corriente/docs-proyecto.tsx). Archivo
// is gone; the project's own docs live here, drawn as what they are to the team:
//   the three context notes  every run reads them before it starts (src/runner/runner.ts CONTEXT_DOCS)
//   the library               every other doc of the project; the team looks one up when a task asks (get_memory)
// A doc opens across the whole page (the reader), and «Editar» splits it: the text on the left, how it reads on the
// right. Pure, so the tests call it directly.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import { LOCALE } from "./locale.js";
import { seatName } from "./corriente.js";
import type { AjustesContextoId } from "./ajustes.js";

/** What a doc address names: a doc by id, a context note not written yet (from its template), or a new library doc. */
export type DocRef = { kind: "doc"; id: string } | { kind: "ctx"; id: AjustesContextoId } | { kind: "nuevo" };

const CTX_IDS: readonly AjustesContextoId[] = ["glossary", "commands", "map"];

export function docRefOf(id: string): DocRef {
  if (id === "nuevo") return { kind: "nuevo" };
  if (id.startsWith("ctx-") && (CTX_IDS as readonly string[]).includes(id.slice(4))) return { kind: "ctx", id: id.slice(4) as AjustesContextoId };
  return { kind: "doc", id };
}

/** The address id of a context note: its doc's id once it exists, else ctx-<id> (it opens from the template). */
export const ctxRef = (c: { id: AjustesContextoId; doc_id: string | null }): string => c.doc_id ?? `ctx-${c.id}`;

/** A thing's address from its key: an idea opens its ficha as an idea, anything else as an initiative or a step. */
export const thingVer = (key: string): { kind: "idea" | "iniciativa"; key: string } => ({ kind: /-IDEA\d+$/i.test(key) ? "idea" : "iniciativa", key });

/** «19 nov»: the day a doc changed, in the screen's language. */
export const docDay = (iso: string | null, timeZone?: string): string => (iso ? new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone }).format(new Date(iso)).replace(".", "") : "");

/** A seat's name as the owner reads it: «product-owner» → «Product owner», «research» → «Research». */
export const seatLabel = (role: string): string => (role === "product-owner" ? "Product owner" : seatName(role));

/** A thing's leading heading repeats the title shown above it: the reader drops it. */
export const sinTitulo = (markdown: string): string => markdown.replace(/^\s*#\s+[^\n]*\n+/, "");

/** How many library pages the band shows before «Ver todos». */
export const LIB_SHOWN = 8;

/** Two letters for a teammate's seat: «Product owner» → PO, «Research» → RE. */
export function initials(role: string): string {
  const parts = role.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

/** The library pages a search keeps: by title or first line, ignoring case and accents. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const docMatches = (d: { title: string; first: string }, q: string): boolean => !q.trim() || fold(`${d.title} ${d.first}`).includes(fold(q.trim()));

/** The wires between the notes, the seats and the library: y centres for n cards of height h with gap g, centred in
 *  a column of height H. */
export function centres(n: number, h: number, g: number, H: number): number[] {
  const total = n * h + Math.max(0, n - 1) * g;
  const top = Math.max(0, (H - total) / 2);
  return Array.from({ length: n }, (_, i) => Math.round(top + i * (h + g) + h / 2));
}

export const DOCS_WORDS = defineWords({
  es: {
    titulo: "Docs del proyecto",
    texto: (project: string) => `Lo que el equipo sabe de ${project}, y quién lo lee. Los papeles de cada cosa siguen en su ficha, en Todo.`,
    buscar: "Buscar un doc",
    notas: "Cada corrida los lee al empezar",
    equipo: "El equipo",
    sinEquipo: "Todavía no hay nadie en el equipo.",
    biblioteca: (n: number) => `La biblioteca · la consultan cuando la necesitan · ${n}`,
    nuevo: "Nuevo doc",
    verTodos: (n: number) => `Ver los ${n}`,
    verMenos: "Ver menos",
    vacia: "La biblioteca está vacía. Un doc aquí vale para todo el proyecto: reglas, notas de la clienta, decisiones.",
    ninguno: (q: string) => `Ningún doc se llama así ni empieza con «${q}».`,
    leyendaNotas: "lo leen en cada corrida, antes de empezar",
    leyendaBiblio: "lo buscan cuando la tarea lo pide",
    lineas: (n: number) => (n === 1 ? "1 LÍNEA" : `${n} LÍNEAS`),
    noExiste: "NO EXISTE TODAVÍA",
    vacio: "VACÍA: NADIE LA LEE",
    // The reader.
    volver: (where: string) => `Volver a ${where}`,
    ajustes: "Ajustes",
    todo: "Todo",
    leen: "Cada corrida lo lee al empezar",
    consultan: "La biblioteca · lo consultan cuando lo necesitan",
    papel: "Papel de una cosa",
    papeles: "Sus papeles",
    quien: "Quién lo lee",
    quienNotas: "Cada corrida, antes de empezar",
    quienBiblio: "El equipo, cuando una tarea lo pide",
    quienPapel: (thing: string) => `Quien trabaja en «${thing}»`,
    cambio: "Cambió",
    cambioEl: (day: string, version: number) => `El ${day} · versión ${version}`,
    deLaPlantilla: "Todavía no existe: empieza de la plantilla.",
    editar: "Editar",
    crear: "Crear desde la plantilla",
    cerrar: "Cerrar",
    verla: "Verla en Todo",
    escribes: "Escribes aquí",
    asi: "Así se lee",
    tituloCampo: "Título",
    tituloEjemplo: "Por ejemplo: Reglas del proyecto",
    textoCampo: "Texto",
    textoEjemplo: "Escribe en texto simple. # para un título, - para una lista.",
    guardar: "Guardar",
    guardando: "Guardando…",
    cancelar: "Cancelar",
    notaNotas: "Cada corrida leerá el texto nuevo la próxima vez que empiece.",
    notaBiblio: "Se guarda con la fecha de hoy. El equipo lee la versión nueva la próxima vez que lo consulte.",
    notaNuevo: "Queda en la biblioteca: el equipo lo busca cuando una tarea lo pide.",
    tituloMal: "Ponle un título de hasta 120 letras. Los nombres «Context:», «Prompt:» y «Pack:» son de Plania.",
    sinTexto: "El doc está vacío.",
    leyendo: "Leyendo el doc",
    elDoc: "el doc",
    nuevoTitulo: "Doc nuevo",
    paginaVieja: "Abrir la página anterior del proyecto ↗",
  },
  en: {
    titulo: "Project docs",
    texto: (project: string) => `What the team knows about ${project}, and who reads it. Each thing's papers stay on its card, in All.`,
    buscar: "Find a doc",
    notas: "Every run reads them before it starts",
    equipo: "The team",
    sinEquipo: "Nobody is on the team yet.",
    biblioteca: (n: number) => `The library · looked up when needed · ${n}`,
    nuevo: "New doc",
    verTodos: (n: number) => `Show all ${n}`,
    verMenos: "Show less",
    vacia: "The library is empty. A doc here holds for the whole project: rules, the client's notes, decisions.",
    ninguno: (q: string) => `No doc is called that or starts with «${q}».`,
    leyendaNotas: "read on every run, before it starts",
    leyendaBiblio: "looked up when the task asks",
    lineas: (n: number) => (n === 1 ? "1 LINE" : `${n} LINES`),
    noExiste: "DOES NOT EXIST YET",
    vacio: "EMPTY: NOBODY READS IT",
    volver: (where: string) => `Back to ${where}`,
    ajustes: "Settings",
    todo: "All",
    leen: "Every run reads it before it starts",
    consultan: "The library · looked up when needed",
    papel: "A thing's paper",
    papeles: "Its papers",
    quien: "Who reads it",
    quienNotas: "Every run, before it starts",
    quienBiblio: "The team, when a task asks",
    quienPapel: (thing: string) => `Whoever works on «${thing}»`,
    cambio: "Changed",
    cambioEl: (day: string, version: number) => `On ${day} · version ${version}`,
    deLaPlantilla: "It does not exist yet: start from the template.",
    editar: "Edit",
    crear: "Create from the template",
    cerrar: "Close",
    verla: "See it in All",
    escribes: "You write here",
    asi: "How it reads",
    tituloCampo: "Title",
    tituloEjemplo: "For example: Project rules",
    textoCampo: "Text",
    textoEjemplo: "Write plain text. # for a heading, - for a list.",
    guardar: "Save",
    guardando: "Saving…",
    cancelar: "Cancel",
    notaNotas: "Every run will read the new text the next time it starts.",
    notaBiblio: "Saved with today's date. The team reads the new version the next time it looks it up.",
    notaNuevo: "It goes to the library: the team looks it up when a task asks.",
    tituloMal: "Give it a title of up to 120 letters. The names «Context:», «Prompt:» and «Pack:» are Plania's.",
    sinTexto: "The doc is empty.",
    leyendo: "Reading the doc",
    elDoc: "the doc",
    nuevoTitulo: "New doc",
    paginaVieja: "Open the project's previous page ↗",
  },
});

export const docsWords = (language: Language = getLanguage()) => words(DOCS_WORDS, language);

/** The state line under a context note: «14 LÍNEAS · 19 NOV», «VACÍA: NADIE LA LEE», «NO EXISTE TODAVÍA». */
export function notaEstado(c: { doc_id: string | null; markdown: string }, day: string, language: Language = getLanguage()): string {
  const w = docsWords(language);
  if (!c.doc_id) return w.noExiste;
  const text = c.markdown.trim();
  if (!text) return w.vacio;
  const n = text.split("\n").length;
  return day ? `${w.lineas(n)} · ${day.toUpperCase()}` : w.lineas(n);
}

/** A title the library takes: not empty, at most 120 letters, not one of Plania's own names. */
export const tituloOk = (t: string): boolean => {
  const s = t.trim();
  return !!s && s.length <= 120 && !/^(Context|Prompt|Pack): /.test(s);
};
