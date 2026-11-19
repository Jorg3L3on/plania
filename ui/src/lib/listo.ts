// NEWPROJ-4: what the readiness list says (GET /api/company/projects/:slug/readiness, src/runner/readiness.ts).
// One sentence per item id and state, and for a missing item what to do about it; the grouping «Falta», «Listo»,
// «No hace falta»; and the Reanudar sheet's words, which depend on whether the project has any step yet.
// Plain Spanish, pure, tested without a browser (test/newproj-4-readiness.test.ts).
import { seatName } from "./corriente.js";

export type ListoEstado = "ready" | "missing" | "not_needed";
// The same shape the server sends. why is a folder check code, "no_code" or absent.
export type ListoItem = { id: string; state: ListoEstado; blocks: boolean; why?: string; seat?: string; path?: string; branch?: string };
export type Listo = { slug: string; title: string; items: ListoItem[]; blocking: number; tasks: number };

const ROLES = ["product-owner", "taller", "research", "artist", "asistente", "qa", "copy", "seguridad", "marketing", "data"] as const;

// nombre: what is missing, as it reads after «falta» in a sentence.
type Palabras = { titulo: (i: ListoItem) => string; nombre: (i: ListoItem) => string; listo: (i: ListoItem) => string; falta: (i: ListoItem) => string; noHaceFalta?: string };

const SIN_CODIGO = "Todavía no hay código: no hace falta por ahora.";

const prompt = (role: string): Palabras => ({
  titulo: () => `Instrucciones de ${seatName(role)}`,
  nombre: () => `el texto de instrucciones de ${seatName(role)}`,
  listo: () => "Tiene su texto de instrucciones.",
  falta: () => `${seatName(role)} no tiene su texto de instrucciones, así que sus corridas fallan al empezar. Agrégalo en los prompts de Plania.`,
});

const carpeta = (i: ListoItem): string => (i.path ? `La carpeta ${i.path}` : "La carpeta del código");

// Every id the server can send (READINESS_IDS in src/runner/readiness.ts). A test fails when one is missing here.
export const PALABRAS: Record<string, Palabras> = {
  ...Object.fromEntries(ROLES.map((r) => [`prompt.${r}`, prompt(r)])),
  "prompt.unknown": {
    titulo: (i) => `Un puesto sin rol${i.seat ? ` (${i.seat})` : ""}`,
    nombre: () => "el rol de un puesto",
    listo: () => "Tiene su rol.",
    falta: () => "Plania no sabe qué hace este puesto, así que sus corridas no arrancan. Revisa el equipo del proyecto.",
  },
  runner_token: {
    titulo: () => "La llave del equipo",
    nombre: () => "la llave del equipo",
    listo: () => "El equipo puede entrar a Plania.",
    // PLA-I2-6: the token is made at first start (PLA-I2-2); nothing is pasted anywhere.
    falta: () => "Plania todavía no tiene la llave con la que entra el equipo, así que ninguna corrida arranca. Se crea al terminar el primer arranque; si ya lo terminaste, reinicia Plania.",
  },
  claude_bin: {
    titulo: () => "Claude en esta Mac",
    nombre: () => "el programa claude",
    listo: () => "Plania encuentra el programa claude.",
    falta: () => "Plania no encuentra el programa claude, así que ninguna corrida arranca. Instala Claude Code con su instalador: Plania lo encuentra solo en su lugar de siempre.",
  },
  code: {
    titulo: () => "El código",
    nombre: () => "la carpeta del código lista",
    listo: (i) => `${carpeta(i)} está lista: existe, tiene git y está conectada a GitHub.`,
    falta: (i) => {
      const c = carpeta(i);
      // PLA-I2-5: each fix is a button in Ajustes («Dónde está el código»), never a terminal.
      if (i.why === "REPO_FOLDER_MISSING") return `${c} no existe en esta máquina, así que Taller no puede trabajar. En Ajustes, «Preparar el código» la crea con su repositorio, o corrige la ruta.`;
      if (i.why === "REPO_NOT_GIT") return `${c} tiene archivos pero no es un repositorio, así que Taller no puede trabajar. Plania no toca una carpeta con archivos: en Ajustes elige la carpeta del código o una vacía.`;
      if (i.why === "REPO_NO_ORIGIN") return `${c} no está conectada a GitHub, así que Taller no puede trabajar. En Ajustes, «Preparar el código» crea su repositorio en GitHub con tu cuenta.`;
      if (i.why === "REPO_ORIGIN_UNREACHABLE") return `No pude leer el repositorio en GitHub de ${c.toLowerCase()}. Revisa en «Qué le falta» (en Máquina) que GitHub tenga la sesión iniciada y pulsa «Revisar de nuevo».`;
      if (i.why === "REPO_NO_START_BRANCH") return `El repositorio en GitHub de ${c.toLowerCase()} no tiene la rama de trabajo, así que Taller no puede empezar. En Ajustes, «Crear la rama de trabajo» la crea desde la rama principal.`;
      return `${c} no está lista, así que Taller no puede trabajar.`;
    },
    noHaceFalta: "Todavía no hay código: el equipo trabaja sin carpeta hasta que la tenga.",
  },
  github: {
    titulo: () => "Repositorio en GitHub",
    nombre: () => "el repositorio de GitHub",
    listo: () => "Plania sabe cuál es su repositorio.",
    falta: (i) => {
      // PLA-I2-5: gh's state, the same as the machine check's (ui/src/lib/falta.ts), with the fix on that page.
      if (i.why === "gh_absent") return "GitHub no está instalado en esta máquina, así que Plania no puede fusionar ni ver las propuestas de cambio. «Qué le falta» (en Máquina) dice cómo instalarlo.";
      if (i.why === "gh_signed_out") return "GitHub no tiene la sesión iniciada en esta máquina, así que Plania no puede fusionar ni ver las propuestas de cambio. «Qué le falta» (en Máquina) dice cómo entrar.";
      if (i.why === "gh_no_write") return "Tu cuenta de GitHub en esta máquina no puede escribir en el repositorio, así que Plania no puede fusionar. «Qué le falta» (en Máquina) dice cómo darle permiso.";
      if (i.why === "no_token") return "Plania no tiene acceso a GitHub para fusionar en esta instalación. «Qué le falta» (en Máquina) dice cómo dárselo.";
      return "Sin repositorio de GitHub, Plania no ve las propuestas de cambio ni sus pruebas.";
    },
    noHaceFalta: SIN_CODIGO,
  },
  capture: {
    titulo: () => "Cómo arranca la app",
    nombre: () => "cómo arranca la app",
    listo: () => "Plania sabe arrancarla y tomarle fotos.",
    falta: () => "Sin esto, las entregas llegan sin fotos de la pantalla.",
    noHaceFalta: SIN_CODIGO,
  },
  verify: {
    titulo: () => "Lo que QA comprueba",
    nombre: () => "la lista de pruebas de QA",
    listo: () => "QA tiene su lista de pruebas.",
    falta: () => "Sin lista, QA no corre pruebas en cada entrega.",
    noHaceFalta: SIN_CODIGO,
  },
  "context.glossary": {
    titulo: () => "Contexto: glosario",
    nombre: () => "el glosario",
    listo: () => "El equipo lee las palabras del proyecto.",
    falta: () => "Sin glosario, el equipo aprende las palabras del proyecto leyendo el código.",
  },
  "context.commands": {
    titulo: () => "Contexto: comandos",
    nombre: () => "la nota de comandos",
    listo: () => "El equipo sabe cómo correr y probar el proyecto.",
    falta: () => "Sin esta nota, el equipo adivina cómo correr y probar el proyecto.",
  },
  "context.map": {
    titulo: () => "Contexto: mapa",
    nombre: () => "el mapa",
    listo: () => "El equipo sabe dónde está cada cosa.",
    falta: () => "Sin mapa, el equipo busca dónde está cada cosa en cada corrida.",
  },
};

export const tienePalabras = (id: string): boolean => id in PALABRAS;

// PLA-I2-6: the Ajustes section where a missing item is set (#ajustes-<section>). Items with no control there (the
// seats' prompts, the runner token, the claude program) have none.
export const LISTO_AJUSTE: Record<string, "codigo" | "arranque" | "pruebas" | "contexto"> = {
  code: "codigo",
  github: "codigo",
  capture: "arranque",
  verify: "pruebas",
  "context.glossary": "contexto",
  "context.commands": "contexto",
  "context.map": "contexto",
};
export const listoAjuste = (id: string): string | null => LISTO_AJUSTE[id] ?? null;
export const LISTO_IR = "Arreglarlo en Ajustes";

export type ListoLinea = { id: string; key: string; estado: ListoEstado; para: boolean; titulo: string; nombre: string; texto: string };

/** One item as a line: its title and the sentence for its state (for a missing one, what to do). */
export function listoLinea(i: ListoItem): ListoLinea {
  const p = PALABRAS[i.id];
  const key = `${i.id}:${i.seat ?? ""}`;
  if (!p) return { id: i.id, key, estado: i.state, para: i.state === "missing" && i.blocks, titulo: "Otra cosa", nombre: "algo más", texto: i.state === "ready" ? "Lista." : i.state === "missing" ? "Falta." : "No hace falta." };
  const texto = i.state === "ready" ? p.listo(i) : i.state === "missing" ? p.falta(i) : (p.noHaceFalta ?? "No hace falta.");
  return { id: i.id, key, estado: i.state, para: i.state === "missing" && i.blocks, titulo: p.titulo(i), nombre: p.nombre(i), texto };
}

export type ListoGrupo = { key: "falta" | "listo" | "no_hace_falta"; titulo: string; lineas: ListoLinea[] };

/** «Falta» (what stops a run first), «Listo», «No hace falta»; empty groups are left out. */
export function listoGrupos(items: ListoItem[]): ListoGrupo[] {
  const lineas = items.map(listoLinea);
  const falta = lineas.filter((l) => l.estado === "missing").sort((a, b) => Number(b.para) - Number(a.para));
  const grupos: ListoGrupo[] = [
    { key: "falta", titulo: "Falta", lineas: falta },
    { key: "listo", titulo: "Listo", lineas: lineas.filter((l) => l.estado === "ready") },
    { key: "no_hace_falta", titulo: "No hace falta", lineas: lineas.filter((l) => l.estado === "not_needed") },
  ];
  return grupos.filter((g) => g.lineas.length > 0);
}

const lista = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);
const paran = (r: Listo): ListoLinea[] => r.items.map(listoLinea).filter((l) => l.para);

/** The one line that says the project cannot work yet, or null when nothing stops a run. */
export function listoAviso(r: Listo): string | null {
  const n = paran(r).length;
  if (n === 0) return null;
  return n === 1 ? "Falta 1 cosa para que el equipo pueda trabajar." : `Faltan ${n} cosas para que el equipo pueda trabajar.`;
}

/** The title of the sheet after creating a project: «está listo» only when nothing stops a run. */
export function creadoTitulo(name: string, r: Listo | null): string {
  if (!r) return `${name} está creado`;
  return paran(r).length === 0 ? `${name} está listo` : `${name} está creado, pero no listo`;
}

/** What happens on Reanudar. A project with no steps yet has nothing to take back up: its PO starts it. Null (the
 * list not read yet, or no project): only what is true either way. */
export function reanudarAlReanudar(r: Pick<Listo, "tasks"> | null): string {
  if (!r) return "Su PO despierta. Nada se perdió.";
  if (r.tasks === 0) return "Su PO despierta por primera vez, lee la meta y arma el primer plan. Todavía no hay pasos.";
  return "Su PO despierta y el equipo retoma lo que estaba Lista o a medias. Nada se perdió.";
}

/** The plain warning on the Reanudar sheet: which missing items make the first run fail. Null when none. */
export function reanudarFalla(r: Listo | null): string | null {
  if (!r) return null;
  const nombres = [...new Set(paran(r).map((l) => l.nombre))];
  if (nombres.length === 0) return null;
  return `Puedes reanudar, pero la primera corrida va a fallar: falta ${lista(nombres)}.`;
}
