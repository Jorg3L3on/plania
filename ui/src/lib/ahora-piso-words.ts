// PLA-I2-10: the words of la línea de Ahora (ui/src/lib/ahora-piso.ts), in both languages. The Spanish is the text
// ahora-piso.ts always said; tests assert it word for word.
import { defineWords } from "./i18n.js";

type ByKey = Record<string, string>;

export const AHORA_PISO_WORDS = defineWords({
  es: {
    // What a teammate does to a title; any other role "trabaja en".
    verb: { taller: "construye", research: "investiga", artist: "diseña", qa: "prueba", "product-owner": "prepara", po: "prepara", copy: "escribe" } as ByKey,
    verbOther: "trabaja en",
    quote: (s: string) => `«${s}»`,
    nextThing: "lo siguiente",
    fixesBack: (who: string, what: string) => `${who} arregla ${what} (devuelto)`,
    tests: (who: string, what: string) => `${who} prueba ${what}`,
    does: (who: string, verb: string, what: string) => `${who} ${verb} ${what}`,
    isWorking: (who: string) => `${who} está trabajando`,
    more: (n: number) => ` y ${n === 1 ? "1 más" : `${n} más`}`,
    // What holds the runner back, said after «la próxima ronda».
    hold: { usage: "; por ahora el uso lo detiene", slot: "; espera un lugar libre", rest: "; ahora descansa", no_goal: "; falta la meta del proyecto", unqueued: "; nadie lo ha despertado" } as ByKey,
    yourTurn: (what: string) => `Te toca: ${what}`,
    allBlocked: (what: string) => `Todo está bloqueado: ${what}.`,
    nothingReadyAsk: "Nada está listo para empezar. Pide algo con Pedir y el PO lo reparte.",
    laterOne: "Queda 1 para después",
    laterMany: (n: number) => `Quedan ${n} para después`,
    nothingReady: (rest: string) => `Nada está listo para empezar. ${rest}.`,
    companyPaused: "La compañía está en pausa: nada arranca hasta que la reanudes.",
    projectPaused: "El proyecto está en pausa: nada arranca hasta que lo reanudes.",
    theTeam: "El equipo",
    queued: (what: string, who: string, at: string | null, hold: string) => `${what} está listo: ${who} lo toma en la próxima ronda${at ? `, a las ${at}` : ""}${hold}.`,
    moreInLine: (n: number) => ` ${n === 1 ? "Hay 1 más en fila" : `Hay ${n} más en fila`}.`,
    returned: (what: string, who: string, more: string) => `Devuelto: ${what} espera que ${who} lo tome${more}.`,
    quietSay: "Nadie trabaja en este piso ahora.",
    idleNow: (who: string) => `Sin trabajo ahora: ${who}.`,
  },
  en: {
    verb: { taller: "builds", research: "researches", artist: "designs", qa: "tests", "product-owner": "prepares", po: "prepares", copy: "writes" },
    verbOther: "works on",
    quote: (s: string) => `“${s}”`,
    nextThing: "the next thing",
    fixesBack: (who: string, what: string) => `${who} fixes ${what} (sent back)`,
    tests: (who: string, what: string) => `${who} tests ${what}`,
    does: (who: string, verb: string, what: string) => `${who} ${verb} ${what}`,
    isWorking: (who: string) => `${who} is working`,
    more: (n: number) => ` and ${n === 1 ? "1 more" : `${n} more`}`,
    hold: { usage: "; usage holds it back for now", slot: "; waiting for a free slot", rest: "; resting now", no_goal: "; the project has no goal", unqueued: "; nobody has woken it" },
    yourTurn: (what: string) => `Your turn: ${what}`,
    allBlocked: (what: string) => `Everything is blocked: ${what}.`,
    nothingReadyAsk: "Nothing is ready to start. Ask for something with Ask and the PO hands it out.",
    laterOne: "1 left for later",
    laterMany: (n: number) => `${n} left for later`,
    nothingReady: (rest: string) => `Nothing is ready to start. ${rest}.`,
    companyPaused: "The company is paused: nothing starts until you resume it.",
    projectPaused: "The project is paused: nothing starts until you resume it.",
    theTeam: "The team",
    queued: (what: string, who: string, at: string | null, hold: string) => `${what} is ready: ${who} takes it in the next round${at ? `, at ${at}` : ""}${hold}.`,
    moreInLine: (n: number) => ` ${n === 1 ? "1 more in line" : `${n} more in line`}.`,
    returned: (what: string, who: string, more: string) => `Sent back: ${what} waits for ${who} to take it${more}.`,
    quietSay: "Nobody is working on this floor now.",
    idleNow: (who: string) => `No work now: ${who}.`,
  },
});
