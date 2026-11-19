// Words the Bandeja and Inicio share for what waits on the owner.
// PLA-I2-10: the words are in INBOX_LIB_WORDS, in both languages; ACTION_WORD keeps the Spanish for its readers.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export const INBOX_LIB_WORDS = defineWords({
  es: {
    /** Words for a logged move the Bandeja shows in the delegated list. */
    action: {
      done: "marcar Done",
      wont_do: "marcar Won't do",
      reopen: "reabrir",
      waive_check: "eximir un punto del Done when",
      runbook_step: "ejecutar un paso",
      lease_resource: "tomar un recurso",
    } as Record<string, string>,
    minutes: (n: number) => `${n} min`,
    hours: (n: number) => `${n} h`,
    days: (n: number) => `${n} d`,
  },
  en: {
    action: {
      done: "mark Done",
      wont_do: "mark Won't do",
      reopen: "reopen",
      waive_check: "waive a Done when item",
      runbook_step: "run a step",
      lease_resource: "take a resource",
    },
    minutes: (n: number) => `${n} min`,
    hours: (n: number) => `${n} h`,
    days: (n: number) => `${n} d`,
  },
});

/** Words for a logged move the Bandeja shows in the delegated list (Spanish; the screen reads actionWord). */
export const ACTION_WORD: Record<string, string> = INBOX_LIB_WORDS.es.action;

export const actionWord = (action: string | undefined, language: Language = getLanguage()) =>
  words(INBOX_LIB_WORDS, language).action[action ?? ""] ?? action ?? "";

/** "3 min", "2 h", "1 d" from seconds waited. */
export function waitText(s: number, language: Language = getLanguage()): string {
  const w = words(INBOX_LIB_WORDS, language);
  if (s < 3600) return w.minutes(Math.max(1, Math.round(s / 60)));
  if (s < 86400) return w.hours(Math.round(s / 3600));
  return w.days(Math.round(s / 86400));
}
