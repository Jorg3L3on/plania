// PLA-I2-6: the words and checks of Ajustes' «Cómo arranca la app» and «Avanzado» sections (PUT …/settings/capture and
// …/settings/advanced, src/api/project-settings.ts). Each advanced field's sentence and default come from the server's
// one list of settings (src/mcp/settings-registry.ts); its label is here. Plain Spanish, pure, tested without a
// browser (test/settings-registry.test.ts). The server checks everything again.
// PLA-I2-10: the words are in AVANZADO_WORDS, in Spanish and English; ARRANQUE, AVANZADO_SECCION, AVANZADO_ETIQUETAS,
// OPCIONES and AUTOMATICO stay the Spanish ones (tests read them), and the view reads avanzadoWords().
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type AvanzadoEditor = "text" | "select" | "switch" | "number" | "env" | "json";
export type AvanzadoRead = { field: string; key: string; editor: AvanzadoEditor; options?: string[]; value: unknown; defecto: string; frase: string };
export type ArranqueRead = { start_command: string; port: number; install_command: string | null; ready_path: string | null; pages: { path: string; label: string }[] };

export const AVANZADO_WORDS = defineWords({
  es: {
    arranque: {
      titulo: "Cómo arranca la app",
      texto: "Plania arranca una copia de la app para probar cada entrega y tomarle fotos. Corrige aquí lo que adivinó mal.",
      vacio: "Todavía no sabe cómo arrancarla. Llénalo aquí, o usa «Configurar su app» en Máquinas para que lo adivine.",
      comando: { label: "Comando para arrancarla", hint: "{port} se cambia por el puerto libre." },
      puerto: { label: "Puerto", hint: "El primero que prueba; si está ocupado, usa el siguiente." },
      instalar: { label: "Comando para instalar (opcional)", hint: "Vacío: el que pida su archivo de dependencias." },
      lista: { label: "Dirección que responde cuando ya arrancó (opcional)", hint: "Vacía: /" },
      paginas: { label: "Páginas para las fotos", hint: "Una por línea: la dirección, un espacio y su nombre. Por ejemplo: /carrito Carrito" },
    },
    seccion: {
      titulo: "Avanzado",
      texto: "Lo que casi nunca hace falta tocar. Cada ajuste dice qué pasa si lo dejas como está.",
    },
    /** The label for each «Avanzado» field. A field the server sends with no label here shows its key. */
    etiquetas: {
      branch_pattern: "Forma de los nombres de rama",
      claim_from: "De dónde toman trabajo los agentes",
      auto_done: "Cerrar solo lo publicado",
      team: "Minutos para «atorado»",
      identity: "Orden en las listas",
      resources: "Recursos por turnos",
      quotas: "Límites diarios",
      maquinas: "Comandos de la base de la app",
      qa: "Otros ajustes de QA",
      velocidad: "Velocidad al construir",
    } as Record<string, string>,
    opciones: {
      backlog: "De lo pendiente",
      ready: "Solo de lo listo",
      env: "El entorno corre el cambio",
      branch: "La rama publicada lo tiene",
    } as Record<string, string>,
    automatico: "Automático",
    porDefecto: (defecto: string) => `Si lo dejas vacío: ${defecto}`,
    minutos: "Un número entero de minutos, de 1 a 1440.",
    variable: "Va el NOMBRE de la variable (mayúsculas, números y _), nunca la llave.",
    objeto: "Va un objeto entre llaves { }.",
    objetoMalo: "No es un objeto válido: revisa comas y comillas.",
    paginaInicial: "/ Inicio",
    sinComando: "Falta el comando para arrancarla.",
    puertoMalo: "El puerto va de 1024 a 65535.",
    direccionMala: "La dirección empieza con /.",
    paginasMalas: "Entre 1 y 12 páginas, una por línea: la dirección (empieza con /), un espacio y su nombre.",
    secreto: "No se guardó: eso parece una llave o una contraseña. Aquí nunca va su valor; guárdala en una variable y escribe su nombre.",
    noVariable: "No se guardó: va el nombre de la variable (mayúsculas, números y _), nunca la llave.",
    capturaMala: "No se guardó: revisa el comando, el puerto y las páginas (cada dirección empieza con /).",
  },
  en: {
    arranque: {
      titulo: "How the app starts",
      texto: "Plania starts a copy of the app to test each delivery and take pictures of it. Fix here what it guessed wrong.",
      vacio: "It doesn't know how to start it yet. Fill it in here, or use «Set up its app» in Machines so it guesses.",
      comando: { label: "Command to start it", hint: "{port} is replaced by the free port." },
      puerto: { label: "Port", hint: "The first one it tries; if it is taken, it uses the next." },
      instalar: { label: "Command to install (optional)", hint: "Empty: the one its dependency file asks for." },
      lista: { label: "Address that answers once it has started (optional)", hint: "Empty: /" },
      paginas: { label: "Pages for the pictures", hint: "One per line: the address, a space and its name. For example: /cart Cart" },
    },
    seccion: {
      titulo: "Advanced",
      texto: "What almost never needs touching. Each setting says what happens if you leave it as it is.",
    },
    etiquetas: {
      branch_pattern: "Shape of branch names",
      claim_from: "Where agents take work from",
      auto_done: "Close only what is published",
      team: "Minutes until «stuck»",
      identity: "Order in the lists",
      resources: "Resources by turns",
      quotas: "Daily limits",
      maquinas: "Commands for the app's database",
      qa: "Other QA settings",
      velocidad: "Building speed",
    },
    opciones: {
      backlog: "From what is pending",
      ready: "Only from what is ready",
      env: "The environment runs the change",
      branch: "The published branch has it",
    },
    automatico: "Automatic",
    porDefecto: (defecto: string) => `If you leave it empty: ${defecto}`,
    minutos: "A whole number of minutes, from 1 to 1440.",
    variable: "It takes the variable's NAME (capitals, numbers and _), never the key.",
    objeto: "It takes an object between braces { }.",
    objetoMalo: "It is not a valid object: check commas and quotes.",
    paginaInicial: "/ Home",
    sinComando: "The command to start it is missing.",
    puertoMalo: "The port goes from 1024 to 65535.",
    direccionMala: "The address starts with /.",
    paginasMalas: "Between 1 and 12 pages, one per line: the address (starts with /), a space and its name.",
    secreto: "Not saved: that looks like a key or a password. Its value never goes here; keep it in a variable and write its name.",
    noVariable: "Not saved: it takes the variable's name (capitals, numbers and _), never the key.",
    capturaMala: "Not saved: check the command, the port and the pages (each address starts with /).",
  },
});

/** These sections' words in the screen's language (or the one given). */
export const avanzadoWords = (language: Language = getLanguage()) => words(AVANZADO_WORDS, language);

export const ARRANQUE = AVANZADO_WORDS.es.arranque;
export const AVANZADO_SECCION = AVANZADO_WORDS.es.seccion;
/** The label for each «Avanzado» field. A field the server sends with no label here shows its key. */
export const AVANZADO_ETIQUETAS: Record<string, string> = AVANZADO_WORDS.es.etiquetas;
export const OPCIONES: Record<string, string> = AVANZADO_WORDS.es.opciones;
export const AUTOMATICO = AVANZADO_WORDS.es.automatico;

/** What holds while the field is empty, in the server's words. */
export const porDefecto = (f: Pick<AvanzadoRead, "defecto">, language: Language = getLanguage()): string => words(AVANZADO_WORDS, language).porDefecto(f.defecto);

/** What the field shows: a JSON value as indented text, a number or text as itself, nothing as empty. */
export function avanzadoTexto(f: Pick<AvanzadoRead, "editor" | "value">): string {
  if (f.value === null || f.value === undefined) return "";
  if (f.editor === "json") return JSON.stringify(f.value, null, 2);
  return String(f.value);
}

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The value to send for what the field holds, or an error line. Empty is null: the default comes back. */
export function avanzadoValor(editor: AvanzadoEditor, text: string, language: Language = getLanguage()): { ok: true; value: unknown } | { ok: false; aviso: string } {
  const w = words(AVANZADO_WORDS, language);
  const t = text.trim();
  if (!t) return { ok: true, value: null };
  switch (editor) {
    case "number": {
      const n = Number(t);
      return Number.isInteger(n) && n >= 1 && n <= 1440 ? { ok: true, value: n } : { ok: false, aviso: w.minutos };
    }
    case "env":
      return ENV_NAME.test(t) ? { ok: true, value: t } : { ok: false, aviso: w.variable };
    case "json":
      try {
        const v = JSON.parse(t) as unknown;
        return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, value: v } : { ok: false, aviso: w.objeto };
      } catch {
        return { ok: false, aviso: w.objetoMalo };
      }
    case "switch":
      return { ok: true, value: t === "true" };
    default:
      return { ok: true, value: t };
  }
}

/** The pages field: one per line, «/path Label». */
export const paginasTexto = (pages: ArranqueRead["pages"]): string => pages.map((p) => `${p.path} ${p.label}`).join("\n");
export function paginas(text: string): { path: string; label: string }[] | null {
  const out: { path: string; label: string }[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const m = /^(\/\S*)\s+(.+)$/.exec(l);
    if (!m) return null;
    out.push({ path: m[1]!, label: m[2]!.trim().slice(0, 60) });
  }
  return out.length >= 1 && out.length <= 12 ? out : null;
}

export type ArranqueForm = { start_command: string; port: string; install_command: string; ready_path: string; pages: string };
export const arranqueForm = (c: ArranqueRead | null, language: Language = getLanguage()): ArranqueForm => ({
  start_command: c?.start_command ?? "",
  port: c ? String(c.port) : "3000",
  install_command: c?.install_command ?? "",
  ready_path: c?.ready_path ?? "",
  pages: c ? paginasTexto(c.pages) : words(AVANZADO_WORDS, language).paginaInicial,
});

/** The body to send, or the line that says what is not right yet. */
export function arranqueBody(f: ArranqueForm, language: Language = getLanguage()): { ok: true; capture: ArranqueRead } | { ok: false; aviso: string } {
  const w = words(AVANZADO_WORDS, language);
  const start = f.start_command.trim();
  if (!start || start.length > 300) return { ok: false, aviso: w.sinComando };
  const port = Number(f.port.trim());
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, aviso: w.puertoMalo };
  const ready = f.ready_path.trim();
  if (ready && !/^\/\S*$/.test(ready)) return { ok: false, aviso: w.direccionMala };
  const pages = paginas(f.pages);
  if (!pages) return { ok: false, aviso: w.paginasMalas };
  return { ok: true, capture: { start_command: start, port, install_command: f.install_command.trim() || null, ready_path: ready || null, pages } };
}

/** The refusal lines these sections add to ajustesError; null for a code they do not own. */
export function avanzadoError(code: string | null, detail: Record<string, unknown> = {}, language: Language = getLanguage()): string | null {
  const w = words(AVANZADO_WORDS, language);
  if (code === "SECRET_VALUE") return w.secreto;
  if (code === "NOT_A_VARIABLE_NAME") return w.noVariable;
  if (code === "INVALID_FILTER" && typeof detail.field === "string" && detail.field.startsWith("settings.capture")) return w.capturaMala;
  return null;
}
