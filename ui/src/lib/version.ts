// PLA-I2-17: the words for which release of Plania this is (GET /api/release): the small line in Plomería and the
// Novedades page, which shows the release notes (CHANGELOG.md, written by the owner). No commit or branch names.
// PLA-I2-10: in both languages (lib/i18n.ts). Pure: no "@/" imports, the server and node tests import this file.
import type { UpdateReport } from "./actualizar.js";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import { FALLBACK_LOCALES, LOCALE } from "./locale.js";

export type ReleaseReading = {
  version: string;
  commit: string | null;
  built_at: string | null;
  // true when the server runs from a release package, false in a working copy of the code.
  packaged: boolean;
  notes: string;
  // PLA-I2-8: what the update to this version kept of the owner's kit; null when it was not updated.
  last_update: UpdateReport | null;
};

// PLA-I2-10: the page's locale when the language is the page's, else that language's fallback.
const localeFor = (language: Language) => (language === getLanguage() ? LOCALE : FALLBACK_LOCALES[language]);

export function builtOn(iso: string | null, language: Language = getLanguage()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(localeFor(language), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

export const VERSION_WORDS = defineWords({
  es: {
    workingCopy: (version: string) => `Versión ${version}, copia de trabajo`,
    built: (version: string, on: string) => `Versión ${version}, armada el ${on}`,
    plain: (version: string) => `Versión ${version}`,
  },
  en: {
    workingCopy: (version: string) => `Version ${version}, working copy`,
    built: (version: string, on: string) => `Version ${version}, built on ${on}`,
    plain: (version: string) => `Version ${version}`,
  },
});

/** «Versión 0.2.0, armada el 18 de noviembre de 2026» for a release; a working copy says so. */
export function versionLine(r: Pick<ReleaseReading, "version" | "built_at" | "packaged">, language: Language = getLanguage()): string {
  const w = words(VERSION_WORDS, language);
  if (!r.packaged) return w.workingCopy(r.version);
  const on = builtOn(r.built_at, language);
  return on ? w.built(r.version, on) : w.plain(r.version);
}

export const NOVEDADES = defineWords({
  es: {
    link: "Novedades",
    kicker: "Esta versión",
    title: "Novedades",
    empty: "Esta versión no trae notas.",
    error: "No se pudieron leer las novedades.",
  },
  en: {
    link: "Novedades",
    kicker: "This version",
    title: "Novedades",
    empty: "This version has no notes.",
    error: "The release notes could not be read.",
  },
});
