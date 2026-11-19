// PLA-I2-3: the one place the screen takes its locale from (the server's twin is src/locale.ts).
// PLA-I2-10: the locale follows the install's language (lib/i18n.ts). Dates and numbers are written in the browser's
// own variant of that language when it has one (es-AR, en-GB…), else in the language's fallback: es-MX, en-US.
// The time zone is the server's (it sends timezone where it matters).
// No "@/" imports: tests read lib files with node directly.
import { getLanguage, type Language } from "./i18n.js";

/** The locale each language falls back to. */
export const FALLBACK_LOCALES: Record<Language, string> = { es: "es-MX", en: "en-US" };
export const FALLBACK_LOCALE = FALLBACK_LOCALES.es;

export function pickLocale(browser: string | undefined | null, language: Language = "es"): string {
  const lang = (browser ?? "").trim();
  const fallback = FALLBACK_LOCALES[language] ?? FALLBACK_LOCALE;
  if (!new RegExp(`^${language}(-|$)`, "i").test(lang)) return fallback;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([lang]).length ? lang : fallback;
  } catch {
    return fallback;
  }
}

const browserLanguage = (): string | undefined => (typeof navigator === "undefined" ? undefined : navigator.language);

/** The locale for this page load (the language is fixed for its life). */
export const LOCALE = pickLocale(browserLanguage(), getLanguage());
