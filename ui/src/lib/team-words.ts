// PLA-I2-10: the words of an agent's presence on the team roster (components/team/types.ts), in both languages.
import { defineWords } from "./i18n.js";

export const TEAM_WORDS = defineWords({
  es: {
    status: { alive: "activo", idle: "en espera", stuck: "atascado" } as Record<string, string>,
  },
  en: {
    status: { alive: "active", idle: "waiting", stuck: "stuck" },
  },
});
