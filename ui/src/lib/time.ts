import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import { LOCALE } from "./locale.js";
// The server sends UTC; the screen shows the browser's local time.
// PLA-I2-10: ago() and span() say it in the screen's language (TIME_WORDS); each takes the language last.
const format = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });

export const TIME_WORDS = defineWords({
  es: {
    moment: "hace un momento",
    minutes: (n: number) => `hace ${n} min`,
    hours: (n: number) => `hace ${n} h`,
    days: (n: number) => `hace ${n} d`,
    spanMoment: "<1 min",
    spanMinutes: (n: number) => `${n} min`,
    spanHours: (n: number) => `${n} h`,
    spanDays: (n: number) => `${n} d`,
  },
  en: {
    moment: "just now",
    minutes: (n: number) => `${n} min ago`,
    hours: (n: number) => `${n} h ago`,
    days: (n: number) => `${n} d ago`,
    spanMoment: "<1 min",
    spanMinutes: (n: number) => `${n} min`,
    spanHours: (n: number) => `${n} h`,
    spanDays: (n: number) => `${n} d`,
  },
});

export const localTime = (iso: string) => format.format(new Date(iso));

function seconds(iso: string, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
}

/** "hace 5 min", "hace 3 h", "hace 2 d" from an ISO time. */
export function ago(iso: string, nowMs = Date.now(), language: Language = getLanguage()): string {
  const w = words(TIME_WORDS, language);
  const s = seconds(iso, nowMs);
  if (s < 90) return w.moment;
  if (s < 3600) return w.minutes(Math.round(s / 60));
  if (s < 86400) return w.hours(Math.round(s / 3600));
  return w.days(Math.round(s / 86400));
}

/** "5 min", "3 h", "2 d": a span without the "hace", for uptime. */
export function span(iso: string, nowMs = Date.now(), language: Language = getLanguage()): string {
  const w = words(TIME_WORDS, language);
  const s = seconds(iso, nowMs);
  if (s < 90) return w.spanMoment;
  if (s < 3600) return w.spanMinutes(Math.round(s / 60));
  if (s < 86400) return w.spanHours(Math.round(s / 3600));
  return w.spanDays(Math.round(s / 86400));
}
