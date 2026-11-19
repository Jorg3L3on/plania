// PLA-I2-10: the screen's words in the install's language. No i18n library: a wording module holds one object per
// language, made with defineWords so the English must have every key the Spanish has (type-checked, and
// test/i2-10-language.test.ts checks it again at run time). A component reads them with words():
//
//   // ui/src/lib/login-words.ts
//   export const LOGIN = defineWords({
//     es: { title: "Entrar", tries: (n: number) => `Te quedan ${n} intentos.` },
//     en: { title: "Sign in", tries: (n: number) => `${n} tries left.` },
//   });
//   // ui/src/pages/login.tsx
//   const w = words(LOGIN);   …   <h1>{w.title}</h1>
//
// The language is fixed for the life of the page: it is read once, at load, from what the server last said (kept in
// localStorage), and LanguageSync (ui/src/components/language-sync.tsx) reloads the page when the server's differs.
// So module-level formatters (lib/locale.ts) and words() calls anywhere see the same language.
// Pure: no "@/" imports, because the server and node tests import this file.

export const LANGUAGES = ["es", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "es";

export const isLanguage = (v: unknown): v is Language => typeof v === "string" && (LANGUAGES as readonly string[]).includes(v);

/** The name of each language, in itself (for the switch). */
export const LANGUAGE_NAMES: Record<Language, string> = { es: "Español", en: "English" };

const STORE_KEY = "plania.language";
const WORDS_MARK = Symbol.for("plania.words");

export type Words<T> = { readonly es: T; readonly en: T; readonly [WORDS_MARK]: true };

/** A wording module: the Spanish sets the shape; the English must match it. */
export function defineWords<T>(w: { es: T; en: NoInfer<T> }): Words<T> {
  return Object.assign(Object.create(null) as object, { es: w.es, en: w.en, [WORDS_MARK]: true as const }) as Words<T>;
}

/** True for an object made by defineWords (the test finds every wording module this way). */
export const isWords = (v: unknown): v is Words<unknown> => typeof v === "object" && v !== null && (v as Record<symbol, unknown>)[WORDS_MARK] === true;

function stored(): Language | null {
  try {
    const v = typeof localStorage === "undefined" ? null : localStorage.getItem(STORE_KEY);
    return isLanguage(v) ? v : null;
  } catch {
    return null;
  }
}

let current: Language = stored() ?? DEFAULT_LANGUAGE;
// PLA-I2-10: the page says which language it is in (screen readers, the browser's translate offer).
if (typeof document !== "undefined") document.documentElement.lang = current;

/** The screen's language for this page load. */
export const getLanguage = (): Language => current;

/** The words of a wording module in the screen's language, or in the one given (the server passes its own). */
export const words = <T>(w: Words<T>, language: Language = current): T => w[language];

/**
 * What the server says the language is. Returns true when it differs from the one this page loaded with: the caller
 * reloads, so every module starts again in the new language.
 */
export function adoptLanguage(language: unknown): boolean {
  if (!isLanguage(language) || language === current) return false;
  try {
    localStorage.setItem(STORE_KEY, language);
  } catch {
    current = language; // no storage: switch in memory; a reload would come back in the old one
    return false;
  }
  return true;
}

/** Tests: set the language for this process. */
export function setLanguageForTests(language: Language): void {
  current = language;
}
