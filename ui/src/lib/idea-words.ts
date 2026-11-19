// PLA-I2-10: the words of an idea's stops (ui/src/components/corriente/idea.tsx).
import { defineWords } from "./i18n.js";

type StopId = "buzon" | "entendido" | "investigacion" | "diseno" | "plan" | "lista";

export const IDEA_WORDS = defineWords({
  es: {
    stops: { buzon: "Buzón", entendido: "Entendido", investigacion: "Investigación", diseno: "Diseño", plan: "Plan", lista: "Lista" } as Record<StopId, string>,
    you: "Tú",
    works: (who: string) => `${who || "Alguien"} la trabaja`,
    inQueue: (who: string) => `En la fila de ${who}`,
    asksYou: "Te pregunta",
    waitsBuild: "Espera «Constrúyelo»",
    quiet: "Quieta",
    todo: "Por hacer",
    notYet: "Todavía no",
    redone: "Se rehace",
    ok: (who: string, entendido: boolean) => `${who} · ${entendido ? "así es" : "te gustó"}`,
    changes: (who: string) => `${who} · pediste cambios`,
    unseen: (who: string) => `${who} · sin ver`,
    seen: (who: string) => `${who} · visto`,
  },
  en: {
    stops: { buzon: "Inbox", entendido: "Understood", investigacion: "Research", diseno: "Design", plan: "Plan", lista: "Ready" },
    you: "You",
    works: (who: string) => `${who || "Someone"} is on it`,
    inQueue: (who: string) => `In ${who}'s queue`,
    asksYou: "Asks you",
    waitsBuild: "Waits for “Build it”",
    quiet: "Idle",
    todo: "To do",
    notYet: "Not yet",
    redone: "Being redone",
    ok: (who: string, entendido: boolean) => `${who} · ${entendido ? "that's right" : "you liked it"}`,
    changes: (who: string) => `${who} · you asked for changes`,
    unseen: (who: string) => `${who} · not seen`,
    seen: (who: string) => `${who} · seen`,
  },
});
