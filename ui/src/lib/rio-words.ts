// PLA-I2-10: the words of a thing's current (components/corriente/rio-geo.ts), in both languages (lib/i18n.ts).
// The stops are names (Buzón… Lista) and «Constrúyelo» is the owner's button: both keep their Spanish form.
// No "@/" imports: a test reads this file with node directly.
import { defineWords } from "./i18n.js";

export const RIO_WORDS = defineWords({
  es: {
    stops: ["Buzón", "Entendido", "Investigación", "Diseño", "Plan", "Lista"],
    front: { you: "te toca", live: "alguien la trabaja", quiet: "nadie la trabaja ahora" },
    atStop: (stop: string) => `parada ${stop}`,
    building: "en construcción",
    published: "publicada",
    valve: "; dijiste «Constrúyelo» y pasa al tablero",
    damWaits: "; la presa «Constrúyelo» espera tu sí",
    stepsDone: (done: number, total: number) => `; ${done} de ${total} pasos hechos`,
    planSteps: (n: number) => `; ${n} pasos en el plan`,
    nothingPending: "nada pendiente",
    label: (where: string, state: string, dam: string, steps: string) => `Corriente: ${where}, ${state}${dam}${steps}.`,
  },
  en: {
    stops: ["Buzón", "Entendido", "Investigación", "Diseño", "Plan", "Lista"],
    front: { you: "your turn", live: "someone is working on it", quiet: "nobody is working on it now" },
    atStop: (stop: string) => `stop ${stop}`,
    building: "being built",
    published: "published",
    valve: "; you said «Constrúyelo» and it moves to the Tablero",
    damWaits: "; the «Constrúyelo» dam waits for your yes",
    stepsDone: (done: number, total: number) => `; ${done} of ${total} steps done`,
    planSteps: (n: number) => `; ${n} steps in the plan`,
    nothingPending: "nothing pending",
    label: (where: string, state: string, dam: string, steps: string) => `Current: ${where}, ${state}${dam}${steps}.`,
  },
});
