// NEWPROJ-4: what the readiness list says (GET /api/company/projects/:slug/readiness, src/runner/readiness.ts).
// One sentence per item id and state, and for a missing item what to do about it; the grouping «Falta», «Listo»,
// «No hace falta»; and the Reanudar sheet's words, which depend on whether the project has any step yet.
// Pure, tested without a browser (test/newproj-4-readiness.test.ts). PLA-I2-10: the words are in LISTO_WORDS, in
// both languages; each function takes the language last.
import { seatName } from "./corriente.js";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type ListoEstado = "ready" | "missing" | "not_needed";
// The same shape the server sends. why is a folder check code, "no_code" or absent.
export type ListoItem = { id: string; state: ListoEstado; blocks: boolean; why?: string; seat?: string; path?: string; branch?: string };
export type Listo = { slug: string; title: string; items: ListoItem[]; blocking: number; tasks: number };

const ROLES = ["product-owner", "taller", "research", "artist", "asistente", "qa", "copy", "seguridad", "marketing", "data"] as const;

// nombre: what is missing, as it reads after «falta» in a sentence.
type Palabras = { titulo: (i: ListoItem) => string; nombre: (i: ListoItem) => string; listo: (i: ListoItem) => string; falta: (i: ListoItem) => string; noHaceFalta?: string };

type Item4 = { titulo: string; nombre: string; listo: string; falta: string };

export const LISTO_WORDS = defineWords({
  es: {
    noCode: "Todavía no hay código: no hace falta por ahora.",
    prompt: {
      titulo: (seat: string) => `Instrucciones de ${seat}`,
      nombre: (seat: string) => `el texto de instrucciones de ${seat}`,
      listo: "Tiene su texto de instrucciones.",
      falta: (seat: string) => `${seat} no tiene su texto de instrucciones, así que sus corridas fallan al empezar. Agrégalo en los prompts de Plania.`,
    },
    unknownRole: {
      titulo: (seat: string | undefined) => `Un puesto sin rol${seat ? ` (${seat})` : ""}`,
      nombre: "el rol de un puesto",
      listo: "Tiene su rol.",
      falta: "Plania no sabe qué hace este puesto, así que sus corridas no arrancan. Revisa el equipo del proyecto.",
    },
    runnerToken: {
      titulo: "La llave del equipo",
      nombre: "la llave del equipo",
      listo: "El equipo puede entrar a Plania.",
      // PLA-I2-6: the token is made at first start (PLA-I2-2); nothing is pasted anywhere.
      falta: "Plania todavía no tiene la llave con la que entra el equipo, así que ninguna corrida arranca. Se crea al terminar el primer arranque; si ya lo terminaste, reinicia Plania.",
    } as Item4,
    claudeBin: {
      titulo: "Claude en esta máquina",
      nombre: "el programa claude",
      listo: "Plania encuentra el programa claude.",
      falta: "Plania no encuentra el programa claude, así que ninguna corrida arranca. Instala Claude Code con su instalador: Plania lo encuentra solo en su lugar de siempre.",
    } as Item4,
    code: {
      titulo: "El código",
      nombre: "la carpeta del código lista",
      folder: (path: string) => `La carpeta ${path}`,
      folderNone: "La carpeta del código",
      listo: (c: string) => `${c} está lista: existe, tiene git y está conectada a GitHub.`,
      // PLA-I2-5: each fix is a button in Ajustes («Dónde está el código»), never a terminal.
      missing: (c: string) => `${c} no existe en esta máquina, así que Taller no puede trabajar. En Despliegue, «Preparar el código» la crea con su repositorio, o corrige la ruta.`,
      notGit: (c: string) => `${c} tiene archivos pero no es un repositorio, así que Taller no puede trabajar. Plania no toca una carpeta con archivos: en Despliegue elige la carpeta del código o una vacía.`,
      noOrigin: (c: string) => `${c} no está conectada a GitHub, así que Taller no puede trabajar. En Despliegue, «Preparar el código» crea su repositorio en GitHub con tu cuenta.`,
      unreachable: (c: string) => `No pude leer el repositorio en GitHub de ${c.toLowerCase()}. Revisa en «Qué le falta» (en Máquina) que GitHub tenga la sesión iniciada y pulsa «Revisar de nuevo».`,
      noBranch: (c: string) => `El repositorio en GitHub de ${c.toLowerCase()} no tiene la rama de trabajo, así que Taller no puede empezar. En Despliegue, «Crear la rama de trabajo» la crea desde la rama principal.`,
      notReady: (c: string) => `${c} no está lista, así que Taller no puede trabajar.`,
      noHaceFalta: "Todavía no hay código: el equipo trabaja sin carpeta hasta que la tenga.",
    },
    github: {
      titulo: "Repositorio en GitHub",
      nombre: "el repositorio de GitHub",
      listo: "Plania sabe cuál es su repositorio.",
      // PLA-I2-5: gh's state, the same as the machine check's (ui/src/lib/falta.ts), with the fix on that page.
      ghAbsent: "GitHub no está instalado en esta máquina, así que Plania no puede fusionar ni ver las propuestas de cambio. «Qué le falta» (en Máquina) dice cómo instalarlo.",
      ghSignedOut: "GitHub no tiene la sesión iniciada en esta máquina, así que Plania no puede fusionar ni ver las propuestas de cambio. «Qué le falta» (en Máquina) dice cómo entrar.",
      ghNoWrite: "Tu cuenta de GitHub en esta máquina no puede escribir en el repositorio, así que Plania no puede fusionar. «Qué le falta» (en Máquina) dice cómo darle permiso.",
      noToken: "Plania no tiene acceso a GitHub para fusionar en esta instalación. «Qué le falta» (en Máquina) dice cómo dárselo.",
      none: "Sin repositorio de GitHub, Plania no ve las propuestas de cambio ni sus pruebas.",
    },
    capture: {
      titulo: "Cómo arranca la app",
      nombre: "cómo arranca la app",
      listo: "Plania sabe arrancarla y tomarle fotos.",
      falta: "Sin esto, las entregas llegan sin fotos de la pantalla.",
    } as Item4,
    verify: {
      titulo: "Lo que QA comprueba",
      nombre: "la lista de pruebas de QA",
      listo: "QA tiene su lista de pruebas.",
      falta: "Sin lista, QA no corre pruebas en cada entrega.",
    } as Item4,
    glossary: {
      titulo: "Contexto: glosario",
      nombre: "el glosario",
      listo: "El equipo lee las palabras del proyecto.",
      falta: "Sin glosario, el equipo aprende las palabras del proyecto leyendo el código.",
    } as Item4,
    commands: {
      titulo: "Contexto: comandos",
      nombre: "la nota de comandos",
      listo: "El equipo sabe cómo correr y probar el proyecto.",
      falta: "Sin esta nota, el equipo adivina cómo correr y probar el proyecto.",
    } as Item4,
    map: {
      titulo: "Contexto: mapa",
      nombre: "el mapa",
      listo: "El equipo sabe dónde está cada cosa.",
      falta: "Sin mapa, el equipo busca dónde está cada cosa en cada corrida.",
    } as Item4,
    other: { titulo: "Otra cosa", nombre: "algo más", ready: "Lista.", missing: "Falta." },
    notNeeded: "No hace falta.",
    groups: { falta: "Falta", listo: "Listo", no_hace_falta: "No hace falta" },
    goFix: "Arreglarlo en Ajustes",
    goFixCamino: "Arreglarlo en Despliegue",
    // Where missing items are fixed, named in a sentence (PLA-132: the code's folder and repository are in Despliegue).
    lugar: { ajustes: "Ajustes", camino: "Despliegue" } as Record<ListoLugar, string>,
    o: (head: string, last: string) => `${head} o ${last}`,
    // The sheet after adding a project, in three sections (ListoSecciones in components/listo.tsx).
    secciones: { resumen: "Resumen", falta: "Falta", listo: "Listo" } as Record<ListoSeccion, string>,
    resumenFalta: (n: number) => (n === 1 ? "Le falta 1 cosa para trabajar a gusto." : `Le faltan ${n} cosas para trabajar a gusto.`),
    resumenNoPara: (donde: string | null) => (donde ? `Ninguna impide empezar: puedes arreglarlas después, desde ${donde}.` : "Ninguna impide empezar."),
    resumenNada: "No le falta nada: el equipo trabaja en cuanto lo reanudes.",
    resumenListo: (n: number) => (n === 1 ? "1 cosa ya está lista." : `${n} cosas ya están listas.`),
    verFalta: "Ver qué falta",
    verListo: "Ver qué está listo",
    arreglar: "Arreglar",
    and: (head: string, last: string) => `${head} y ${last}`,
    aviso: (n: number) => (n === 1 ? "Falta 1 cosa para que el equipo pueda trabajar." : `Faltan ${n} cosas para que el equipo pueda trabajar.`),
    created: (name: string) => `${name} está creado`,
    ready: (name: string) => `${name} está listo`,
    createdNotReady: (name: string) => `${name} está creado, pero no listo`,
    resumeUnknown: "Su PO despierta. Nada se perdió.",
    resumeFirst: "Su PO despierta por primera vez, lee la meta y arma el primer plan. Todavía no hay pasos.",
    resumeAgain: "Su PO despierta y el equipo retoma lo que estaba Lista o a medias. Nada se perdió.",
    resumeFails: (names: string) => `Puedes reanudar, pero la primera corrida va a fallar: falta ${names}.`,
  },
  en: {
    noCode: "There is no code yet: not needed for now.",
    prompt: {
      titulo: (seat: string) => `${seat}'s instructions`,
      nombre: (seat: string) => `${seat}'s instructions text`,
      listo: "It has its instructions text.",
      falta: (seat: string) => `${seat} has no instructions text, so its runs fail at the start. Add it in Plania's prompts.`,
    },
    unknownRole: {
      titulo: (seat: string | undefined) => `A seat with no role${seat ? ` (${seat})` : ""}`,
      nombre: "a seat's role",
      listo: "It has its role.",
      falta: "Plania does not know what this seat does, so its runs do not start. Check the project's team.",
    },
    runnerToken: {
      titulo: "The team's key",
      nombre: "the team's key",
      listo: "The team can get into Plania.",
      falta: "Plania does not have the key the team gets in with yet, so no run starts. It is made when the first start finishes; if you already finished it, restart Plania.",
    },
    claudeBin: {
      titulo: "Claude on this machine",
      nombre: "the claude program",
      listo: "Plania finds the claude program.",
      falta: "Plania does not find the claude program, so no run starts. Install Claude Code with its installer: Plania finds it by itself in its usual place.",
    },
    code: {
      titulo: "The code",
      nombre: "a ready code folder",
      folder: (path: string) => `The folder ${path}`,
      folderNone: "The code folder",
      listo: (c: string) => `${c} is ready: it exists, it has git and it is connected to GitHub.`,
      missing: (c: string) => `${c} does not exist on this machine, so Taller cannot work. In Deploy, «Prepare the code» creates it with its repository, or fix the path.`,
      notGit: (c: string) => `${c} has files but is not a repository, so Taller cannot work. Plania does not touch a folder with files: in Deploy choose the code folder or an empty one.`,
      noOrigin: (c: string) => `${c} is not connected to GitHub, so Taller cannot work. In Deploy, «Prepare the code» creates its repository on GitHub with your account.`,
      unreachable: (c: string) => `I could not read the GitHub repository of ${c.toLowerCase()}. Check in «What it is missing» (in Machine) that GitHub is signed in and press «Check again».`,
      noBranch: (c: string) => `The GitHub repository of ${c.toLowerCase()} does not have the working branch, so Taller cannot start. In Deploy, «Create the working branch» creates it from the main branch.`,
      notReady: (c: string) => `${c} is not ready, so Taller cannot work.`,
      noHaceFalta: "There is no code yet: the team works without a folder until it has one.",
    },
    github: {
      titulo: "Repository on GitHub",
      nombre: "the GitHub repository",
      listo: "Plania knows which repository is its own.",
      ghAbsent: "GitHub is not installed on this machine, so Plania cannot merge or see the change proposals. «What it is missing» (in Machine) says how to install it.",
      ghSignedOut: "GitHub is not signed in on this machine, so Plania cannot merge or see the change proposals. «What it is missing» (in Machine) says how to sign in.",
      ghNoWrite: "Your GitHub account on this machine cannot write to the repository, so Plania cannot merge. «What it is missing» (in Machine) says how to give it permission.",
      noToken: "Plania has no access to GitHub to merge on this install. «What it is missing» (in Machine) says how to give it.",
      none: "Without a GitHub repository, Plania does not see the change proposals or their tests.",
    },
    capture: {
      titulo: "How the app starts",
      nombre: "how the app starts",
      listo: "Plania knows how to start it and take pictures of it.",
      falta: "Without this, deliveries arrive with no pictures of the screen.",
    },
    verify: {
      titulo: "What QA checks",
      nombre: "QA's test list",
      listo: "QA has its test list.",
      falta: "Without a list, QA does not run tests on each delivery.",
    },
    glossary: {
      titulo: "Context: glossary",
      nombre: "the glossary",
      listo: "The team reads the project's words.",
      falta: "Without a glossary, the team learns the project's words by reading the code.",
    },
    commands: {
      titulo: "Context: commands",
      nombre: "the commands note",
      listo: "The team knows how to run and test the project.",
      falta: "Without this note, the team guesses how to run and test the project.",
    },
    map: {
      titulo: "Context: map",
      nombre: "the map",
      listo: "The team knows where everything is.",
      falta: "Without a map, the team looks for where everything is on every run.",
    },
    other: { titulo: "Something else", nombre: "something more", ready: "Ready.", missing: "Missing." },
    notNeeded: "Not needed.",
    groups: { falta: "Missing", listo: "Ready", no_hace_falta: "Not needed" },
    goFix: "Fix it in Settings",
    goFixCamino: "Fix it in Deploy",
    lugar: { ajustes: "Settings", camino: "Deploy" },
    o: (head: string, last: string) => `${head} or ${last}`,
    secciones: { resumen: "Summary", falta: "Missing", listo: "Ready" },
    resumenFalta: (n: number) => (n === 1 ? "1 thing is missing for the team to work at ease." : `${n} things are missing for the team to work at ease.`),
    resumenNoPara: (donde: string | null) => (donde ? `None of them stops a start: you can fix them later, from ${donde}.` : "None of them stops a start."),
    resumenNada: "Nothing is missing: the team works as soon as you resume it.",
    resumenListo: (n: number) => (n === 1 ? "1 thing is already ready." : `${n} things are already ready.`),
    verFalta: "See what's missing",
    verListo: "See what's ready",
    arreglar: "Fix it",
    and: (head: string, last: string) => `${head} and ${last}`,
    aviso: (n: number) => (n === 1 ? "1 thing is missing before the team can work." : `${n} things are missing before the team can work.`),
    created: (name: string) => `${name} is created`,
    ready: (name: string) => `${name} is ready`,
    createdNotReady: (name: string) => `${name} is created, but not ready`,
    resumeUnknown: "Its PO wakes up. Nothing was lost.",
    resumeFirst: "Its PO wakes up for the first time, reads the goal and makes the first plan. There are no steps yet.",
    resumeAgain: "Its PO wakes up and the team picks up what was Ready or half done. Nothing was lost.",
    resumeFails: (names: string) => `You can resume, but the first run will fail: missing ${names}.`,
  },
});

const fixed = (w: Item4, noHaceFalta?: string): Palabras => ({ titulo: () => w.titulo, nombre: () => w.nombre, listo: () => w.listo, falta: () => w.falta, ...(noHaceFalta ? { noHaceFalta } : {}) });

function palabrasOf(language: Language): Record<string, Palabras> {
  const w = words(LISTO_WORDS, language);
  const prompt = (role: string): Palabras => ({
    titulo: () => w.prompt.titulo(seatName(role)),
    nombre: () => w.prompt.nombre(seatName(role)),
    listo: () => w.prompt.listo,
    falta: () => w.prompt.falta(seatName(role)),
  });
  const carpeta = (i: ListoItem): string => (i.path ? w.code.folder(i.path) : w.code.folderNone);
  return {
    ...Object.fromEntries(ROLES.map((r) => [`prompt.${r}`, prompt(r)])),
    "prompt.unknown": { titulo: (i) => w.unknownRole.titulo(i.seat), nombre: () => w.unknownRole.nombre, listo: () => w.unknownRole.listo, falta: () => w.unknownRole.falta },
    runner_token: fixed(w.runnerToken),
    claude_bin: fixed(w.claudeBin),
    code: {
      titulo: () => w.code.titulo,
      nombre: () => w.code.nombre,
      listo: (i) => w.code.listo(carpeta(i)),
      falta: (i) => {
        const c = carpeta(i);
        if (i.why === "REPO_FOLDER_MISSING") return w.code.missing(c);
        if (i.why === "REPO_NOT_GIT") return w.code.notGit(c);
        if (i.why === "REPO_NO_ORIGIN") return w.code.noOrigin(c);
        if (i.why === "REPO_ORIGIN_UNREACHABLE") return w.code.unreachable(c);
        if (i.why === "REPO_NO_START_BRANCH") return w.code.noBranch(c);
        return w.code.notReady(c);
      },
      noHaceFalta: w.code.noHaceFalta,
    },
    github: {
      titulo: () => w.github.titulo,
      nombre: () => w.github.nombre,
      listo: () => w.github.listo,
      falta: (i) => {
        if (i.why === "gh_absent") return w.github.ghAbsent;
        if (i.why === "gh_signed_out") return w.github.ghSignedOut;
        if (i.why === "gh_no_write") return w.github.ghNoWrite;
        if (i.why === "no_token") return w.github.noToken;
        return w.github.none;
      },
      noHaceFalta: w.noCode,
    },
    capture: fixed(w.capture, w.noCode),
    verify: fixed(w.verify, w.noCode),
    "context.glossary": fixed(w.glossary),
    "context.commands": fixed(w.commands),
    "context.map": fixed(w.map),
  };
}

// Every id the server can send (READINESS_IDS in src/runner/readiness.ts). A test fails when one is missing here.
// PALABRAS is the Spanish; listoLinea reads the screen's language.
export const PALABRAS: Record<string, Palabras> = palabrasOf("es");
const PALABRAS_EN: Record<string, Palabras> = palabrasOf("en");
const palabras = (language: Language) => (language === "en" ? PALABRAS_EN : PALABRAS);

export const tienePalabras = (id: string): boolean => id in PALABRAS;

// PLA-I2-6: the Ajustes section where a missing item is set (#ajustes-<section>). Items with no control there (the
// seats' prompts, the runner token, the claude program) have none.
export const LISTO_AJUSTE: Record<string, "arranque" | "pruebas" | "contexto"> = {
  capture: "arranque",
  verify: "pruebas",
  "context.glossary": "contexto",
  "context.commands": "contexto",
  "context.map": "contexto",
};
export const listoAjuste = (id: string): string | null => LISTO_AJUSTE[id] ?? null;
// PLA-132: the code's folder and repository are set in Despliegue › Repositorio y ramas, not in Ajustes.
export const LISTO_CAMINO: Record<string, "codigo"> = { code: "codigo", github: "codigo" };
/** Where a missing item is set: an Ajustes section or a Despliegue section, or null when the screen has no control. */
export const listoIrA = (id: string): { tab: "ajustes" | "camino"; sec: string } | null =>
  LISTO_CAMINO[id] ? { tab: "camino", sec: LISTO_CAMINO[id] } : LISTO_AJUSTE[id] ? { tab: "ajustes", sec: LISTO_AJUSTE[id] } : null;
export type ListoLugar = "ajustes" | "camino";
/** The places the missing items are fixed in, Ajustes first, each once; items with no control on the screen add none. */
export function listoLugares(items: ListoItem[]): ListoLugar[] {
  const tabs = new Set(items.filter((i) => i.state === "missing").map((i) => listoIrA(i.id)?.tab).filter((t): t is ListoLugar => !!t));
  return (["ajustes", "camino"] as const).filter((t) => tabs.has(t));
}
/** Those places as words for a sentence: «Ajustes», «Despliegue», «Ajustes o Despliegue», or null when there is none. */
export function listoDonde(items: ListoItem[], language: Language = getLanguage()): string | null {
  const w = words(LISTO_WORDS, language);
  const lugares = listoLugares(items).map((l) => w.lugar[l]);
  return lugares.length === 0 ? null : lugares.length === 1 ? lugares[0]! : w.o(lugares[0]!, lugares[1]!);
}
export const LISTO_IR = LISTO_WORDS.es.goFix;
export const listoIr = (language: Language = getLanguage(), tab: "ajustes" | "camino" = "ajustes"): string => (tab === "camino" ? words(LISTO_WORDS, language).goFixCamino : words(LISTO_WORDS, language).goFix);

export type ListoLinea = { id: string; key: string; estado: ListoEstado; para: boolean; titulo: string; nombre: string; texto: string };

/** One item as a line: its title and the sentence for its state (for a missing one, what to do). */
export function listoLinea(i: ListoItem, language: Language = getLanguage()): ListoLinea {
  const w = words(LISTO_WORDS, language);
  const p = palabras(language)[i.id];
  const key = `${i.id}:${i.seat ?? ""}`;
  if (!p) return { id: i.id, key, estado: i.state, para: i.state === "missing" && i.blocks, titulo: w.other.titulo, nombre: w.other.nombre, texto: i.state === "ready" ? w.other.ready : i.state === "missing" ? w.other.missing : w.notNeeded };
  const texto = i.state === "ready" ? p.listo(i) : i.state === "missing" ? p.falta(i) : (p.noHaceFalta ?? w.notNeeded);
  return { id: i.id, key, estado: i.state, para: i.state === "missing" && i.blocks, titulo: p.titulo(i), nombre: p.nombre(i), texto };
}

export type ListoSeccion = "resumen" | "falta" | "listo";

/** The sheet's three sections, counted: what is missing (and how much of it stops a run), and what is done or not
 * needed. «Falta» is left out when nothing is missing. */
export function listoSecciones(r: Listo): { falta: number; para: number; listo: number; secciones: ListoSeccion[] } {
  const falta = r.items.filter((i) => i.state === "missing").length;
  const para = r.items.filter((i) => i.state === "missing" && i.blocks).length;
  const listo = r.items.length - falta;
  return { falta, para, listo, secciones: falta > 0 ? ["resumen", "falta", "listo"] : ["resumen", "listo"] };
}

/** The section's words (tab label, summary lines) in the screen's language. */
export const listoSeccionWords = (language: Language = getLanguage()) => words(LISTO_WORDS, language);

export type ListoGrupo = { key: "falta" | "listo" | "no_hace_falta"; titulo: string; lineas: ListoLinea[] };

/** «Falta» (what stops a run first), «Listo», «No hace falta»; empty groups are left out. */
export function listoGrupos(items: ListoItem[], language: Language = getLanguage()): ListoGrupo[] {
  const w = words(LISTO_WORDS, language);
  const lineas = items.map((i) => listoLinea(i, language));
  const falta = lineas.filter((l) => l.estado === "missing").sort((a, b) => Number(b.para) - Number(a.para));
  const grupos: ListoGrupo[] = [
    { key: "falta", titulo: w.groups.falta, lineas: falta },
    { key: "listo", titulo: w.groups.listo, lineas: lineas.filter((l) => l.estado === "ready") },
    { key: "no_hace_falta", titulo: w.groups.no_hace_falta, lineas: lineas.filter((l) => l.estado === "not_needed") },
  ];
  return grupos.filter((g) => g.lineas.length > 0);
}

const lista = (xs: string[], language: Language): string => (xs.length <= 1 ? (xs[0] ?? "") : words(LISTO_WORDS, language).and(xs.slice(0, -1).join(", "), xs.at(-1)!));
const paran = (r: Listo, language: Language): ListoLinea[] => r.items.map((i) => listoLinea(i, language)).filter((l) => l.para);

/** The one line that says the project cannot work yet, or null when nothing stops a run. */
export function listoAviso(r: Listo, language: Language = getLanguage()): string | null {
  const n = paran(r, language).length;
  if (n === 0) return null;
  return words(LISTO_WORDS, language).aviso(n);
}

/** The title of the sheet after creating a project: «está listo» only when nothing stops a run. */
export function creadoTitulo(name: string, r: Listo | null, language: Language = getLanguage()): string {
  const w = words(LISTO_WORDS, language);
  if (!r) return w.created(name);
  return paran(r, language).length === 0 ? w.ready(name) : w.createdNotReady(name);
}

/** What happens on Reanudar. A project with no steps yet has nothing to take back up: its PO starts it. Null (the
 * list not read yet, or no project): only what is true either way. */
export function reanudarAlReanudar(r: Pick<Listo, "tasks"> | null, language: Language = getLanguage()): string {
  const w = words(LISTO_WORDS, language);
  if (!r) return w.resumeUnknown;
  if (r.tasks === 0) return w.resumeFirst;
  return w.resumeAgain;
}

/** The plain warning on the Reanudar sheet: which missing items make the first run fail. Null when none. */
export function reanudarFalla(r: Listo | null, language: Language = getLanguage()): string | null {
  if (!r) return null;
  const nombres = [...new Set(paran(r, language).map((l) => l.nombre))];
  if (nombres.length === 0) return null;
  return words(LISTO_WORDS, language).resumeFails(lista(nombres, language));
}
