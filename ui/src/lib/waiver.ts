// PLA-I74-11: a waived check says who waived it and why. «No aplica» alone hid that the builder had waived its own
// visual checks.
import { defineWords, words, type Language } from "./i18n.js";

export const WAIVER_WORDS = defineWords({
  es: {
    state: "Eximido",
    line: (who: string, reason: string) => (reason ? `Eximido por ${who}: ${reason}` : `Eximido por ${who}`),
    you: "ti",
    qa: "QA",
    someone: "alguien",
  },
  en: {
    state: "Waived",
    line: (who: string, reason: string) => (reason ? `Waived by ${who}: ${reason}` : `Waived by ${who}`),
    you: "you",
    qa: "QA",
    someone: "someone",
  },
});

type By = { agent?: string | null; session_id?: string | null } | null | undefined;

/** Who waived it, as the owner reads it: you (the screen), QA (the lane), else the agent's name. */
export function waivedByName(by: By, language?: Language): string {
  const w = words(WAIVER_WORDS, language);
  if (!by) return w.someone;
  if (by.agent === "owner" || by.session_id === "web") return w.you;
  if (by.session_id === "qa-lane") return w.qa;
  return by.agent?.trim() || w.someone;
}

/** The line under a waived check. */
export const waiverLine = (waived: { by: By; reason: string | null }, language?: Language): string =>
  words(WAIVER_WORDS, language).line(waivedByName(waived.by, language), waived.reason?.trim() ?? "");
