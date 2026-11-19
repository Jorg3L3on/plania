// PLA-I2-3: the one place the screen takes its locale from (the server's twin is src/locale.ts). The screen's
// words are Spanish, so dates and numbers are written in the browser's own Spanish when it has one (es-ES, es-AR…),
// else in the Spanish the wording is written in. The time zone is the server's (it sends timezone where it matters).
// No "@/" imports: tests read lib files with node directly.

export const FALLBACK_LOCALE = "es-MX";

export function pickLocale(language: string | undefined | null): string {
  const lang = (language ?? "").trim();
  if (!/^es(-|$)/i.test(lang)) return FALLBACK_LOCALE;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([lang]).length ? lang : FALLBACK_LOCALE;
  } catch {
    return FALLBACK_LOCALE;
  }
}

const browserLanguage = (): string | undefined => (typeof navigator === "undefined" ? undefined : navigator.language);

export const LOCALE = pickLocale(browserLanguage());
