// PLA-09: the /ceo greeting follows the hour in the dashboard's timezone, not a fixed "Buenos días".
// PLA-I2-10: the words are in GREETING_WORDS, in both languages.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type DayPart = "morning" | "afternoon" | "night";

/** The hour (0-23) at `now` in `timeZone`. */
export function hourIn(timeZone: string, now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now);
  return Number.parseInt(hour, 10) % 24;
}

/** 05-11 morning, 12-18 afternoon, the rest night. */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 19) return "afternoon";
  return "night";
}

// "mientras dormías" only reads right when the day is starting.
export const GREETING_WORDS = defineWords({
  es: {
    hello: { morning: "Buenos días", afternoon: "Buenas tardes", night: "Buenas noches" },
    subtitle: { morning: "la compañía mientras dormías", afternoon: "la compañía hoy", night: "la compañía hoy" },
  },
  en: {
    hello: { morning: "Good morning", afternoon: "Good afternoon", night: "Good evening" },
    subtitle: { morning: "the company while you slept", afternoon: "the company today", night: "the company today" },
  },
});

export function greeting(timeZone: string, now: Date = new Date(), language: Language = getLanguage()): { hello: string; subtitle: string } {
  const part = dayPart(hourIn(timeZone, now));
  const w = words(GREETING_WORDS, language);
  return { hello: w.hello[part], subtitle: w.subtitle[part] };
}
