// PLA-I2-10: the words of Hecho (ui/src/components/corriente/hecho.tsx). PLA-135: Archivo's words left with its door.
import { defineWords } from "./i18n.js";

const NUM_ES = ["Cero", "Una", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"];
const NUM_EN = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const numEs = (n: number) => (n <= 10 ? NUM_ES[n]! : String(n));
const numEn = (n: number) => (n <= 10 ? NUM_EN[n]! : String(n));

export type HechoSummary = { total: number; today: boolean; from: string; to: string; initiatives: number; fromPedido: number };

export const HECHO_WORDS = defineWords({
  es: {
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
