// PLA-I2-10: the words of Archivo and Hecho (ui/src/components/corriente/archivo.tsx).
import { defineWords } from "./i18n.js";

const NUM_ES = ["Cero", "Una", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"];
const NUM_EN = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const numEs = (n: number) => (n <= 10 ? NUM_ES[n]! : String(n));
const numEn = (n: number) => (n <= 10 ? NUM_EN[n]! : String(n));

export type HechoSummary = { total: number; today: boolean; from: string; to: string; initiatives: number; fromPedido: number };

export const ARCHIVO_WORDS = defineWords({
  es: {
    // ---- Archivo
    readWhat: "el archivo",
    reading: "Leyendo el archivo",
    title: (project: string) => `Archivo de ${project}`,
    lead: "Lo que se escribió, se dibujó y se fusionó. Cada papel vive dentro de su cosa; aquí están todos juntos.",
    openPage: "Abrir la página del proyecto ↗",
    own: (n: number) => `Del proyecto · ${n}`,
    showLess: "Ver menos",
    showOthers: (n: number) => `Ver los otros ${n}`,
    showOthersThings: (n: number) => `Ver las otras ${n}`,
    noOwnDocs: "El proyecto no tiene docs propios todavía.",
    perThing: (docs: number, things: number) => `De cada cosa · ${docs} en ${things} ${things === 1 ? "cosa" : "cosas"}`,
    designs: "Diseños",
    designsCount: (n: number) => `Diseños · ${n}`,
    noDesigns: "Ningún diseño todavía: Artist dibuja cuando una idea llega a Diseño.",
    frames: (n: number, unseen: number) => `${n} ${n === 1 ? "MARCO" : "MARCOS"} DE ARTIST${unseen ? ` · ${unseen} SIN VER` : ""}`,
    canvasOnClaude: "LIENZO EN CLAUDE.AI",
    openPrs: (n: number) => (n ? `${n} ${n === 1 ? "abierto" : "abiertos"}` : "Ninguno abierto"),
    noPrs: "Ningún PR todavía.",
    prOpen: "ABIERTO",
    prClosed: "CERRADO",
    // ---- Hecho
    readDone: "lo hecho",
    readingDone: "Leyendo lo hecho",
    doneTitle: (project: string) => `Lo que pasó en ${project}`,
    summary: (s: HechoSummary) =>
      [
        `${s.total === 1 ? "Un paso hecho" : `${s.total} pasos hechos`} ${s.today ? "en 14 días" : `del ${s.from} al ${s.to}`}.`,
        s.initiatives
          ? `${numEs(s.initiatives)} ${s.initiatives === 1 ? "iniciativa cerrada" : "iniciativas cerradas"}${s.fromPedido ? `; ${s.fromPedido === 1 ? "una nació" : `${numEs(s.fromPedido).toLowerCase()} nacieron`} de un pedido tuyo` : ""}.`
          : "Ninguna iniciativa cerrada.",
      ].join(" "),
    perDay: "Pasos hechos por día",
    perDayAria: (days: string) => `Pasos hechos por día: ${days}`,
    today: "HOY",
    closed: "Iniciativas cerradas",
    closedCount: (n: number) => `Iniciativas cerradas · ${n}`,
    noneClosed: "Ninguna en estos días.",
    steps: (n: number) => `${n} ${n === 1 ? "PASO" : "PASOS"}`,
    wasYourRequest: (idea: string) => `ERA TU PEDIDO ${idea}`,
    was: (idea: string) => `ERA ${idea}`,
    dayByDay: "Día por día",
    nothingLanded: "Nada aterrizó en estos días.",
    dayHead: (day: string, n: number) => `${day} · ${n} ${n === 1 ? "PASO" : "PASOS"}`,
    closedThatDay: (titles: string[]) => (titles.length === 1 ? `Se cerró «${titles[0]}». ` : `Se cerraron ${numEs(titles.length).toLowerCase()} iniciativas: ${titles.join(", ")}. `),
    more: (n: number) => ` y ${n} más`,
    prsMerged: (n: number) => ` ${n === 1 ? "Un PR fusionado." : `${numEs(n)} PRs fusionados.`}`,
    before: (day: string) => `Ver antes del ${day}`,
    backToLatest: "Volver a los últimos 14 días",
  },
  en: {
    readWhat: "the archive",
    reading: "Reading the archive",
    title: (project: string) => `${project} archive`,
    lead: "What was written, drawn and merged. Each paper lives inside its thing; here they are all together.",
    openPage: "Open the project's page ↗",
    own: (n: number) => `The project's · ${n}`,
    showLess: "Show less",
    showOthers: (n: number) => `Show the other ${n}`,
    showOthersThings: (n: number) => `Show the other ${n}`,
    noOwnDocs: "The project has no docs of its own yet.",
    perThing: (docs: number, things: number) => `Per thing · ${docs} in ${things} ${things === 1 ? "thing" : "things"}`,
    designs: "Designs",
    designsCount: (n: number) => `Designs · ${n}`,
    noDesigns: "No designs yet: Artist draws when an idea reaches Design.",
    frames: (n: number, unseen: number) => `${n} ARTIST ${n === 1 ? "FRAME" : "FRAMES"}${unseen ? ` · ${unseen} UNSEEN` : ""}`,
    canvasOnClaude: "CANVAS ON CLAUDE.AI",
    openPrs: (n: number) => (n ? `${n} open` : "None open"),
    noPrs: "No PRs yet.",
    prOpen: "OPEN",
    prClosed: "CLOSED",
    readDone: "what was done",
    readingDone: "Reading what was done",
    doneTitle: (project: string) => `What happened in ${project}`,
    summary: (s: HechoSummary) =>
      [
        `${s.total === 1 ? "One step done" : `${s.total} steps done`} ${s.today ? "in 14 days" : `from ${s.from} to ${s.to}`}.`,
        s.initiatives
          ? `${numEn(s.initiatives)} ${s.initiatives === 1 ? "initiative closed" : "initiatives closed"}${s.fromPedido ? `; ${s.fromPedido === 1 ? "one came" : `${numEn(s.fromPedido).toLowerCase()} came`} from a request of yours` : ""}.`
          : "No initiatives closed.",
      ].join(" "),
    perDay: "Steps done per day",
    perDayAria: (days: string) => `Steps done per day: ${days}`,
    today: "TODAY",
    closed: "Closed initiatives",
    closedCount: (n: number) => `Closed initiatives · ${n}`,
    noneClosed: "None in these days.",
    steps: (n: number) => `${n} ${n === 1 ? "STEP" : "STEPS"}`,
    wasYourRequest: (idea: string) => `WAS YOUR REQUEST ${idea}`,
    was: (idea: string) => `WAS ${idea}`,
    dayByDay: "Day by day",
    nothingLanded: "Nothing landed in these days.",
    dayHead: (day: string, n: number) => `${day} · ${n} ${n === 1 ? "STEP" : "STEPS"}`,
    closedThatDay: (titles: string[]) => (titles.length === 1 ? `«${titles[0]}» was closed. ` : `${numEn(titles.length)} initiatives were closed: ${titles.join(", ")}. `),
    more: (n: number) => ` and ${n} more`,
    prsMerged: (n: number) => ` ${n === 1 ? "One PR merged." : `${numEn(n)} PRs merged.`}`,
    before: (day: string) => `Show before ${day}`,
    backToLatest: "Back to the last 14 days",
  },
});
