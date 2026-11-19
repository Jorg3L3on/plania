// PLA-82 (F-32): a release that carries database changes says so, and who migrates the app's own database.
// PLA-I2-10: its words in both languages.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export const PUBLICAR_WORDS = defineWords({
  es: {
    andMore: (shown: string, more: number) => `${shown} y ${more} más`,
    carries: (n: number, list: string) => `Lleva ${n === 1 ? "un cambio" : `${n} cambios`} a la base de datos (${list}).`,
    auto: (title: string) => `Al publicar, Plania respalda la base de ${title} y la migra.`,
    manual: (title: string) => `Después de publicar hay que migrar la base de ${title}: Plania no sabe cómo en este proyecto.`,
  },
  en: {
    andMore: (shown: string, more: number) => `${shown} and ${more} more`,
    carries: (n: number, list: string) => `Carries ${n === 1 ? "one change" : `${n} changes`} to the database (${list}).`,
    auto: (title: string) => `On release, Plania backs up ${title}'s database and migrates it.`,
    manual: (title: string) => `After releasing, ${title}'s database has to be migrated: Plania doesn't know how in this project.`,
  },
});

export function migrationLine(files: string[], how: "auto" | "manual" | null, title: string, language: Language = getLanguage()): string {
  const w = words(PUBLICAR_WORDS, language);
  const list = files.length > 3 ? w.andMore(files.slice(0, 3).join(", "), files.length - 3) : files.join(", ");
  const what = w.carries(files.length, list);
  return how === "auto" ? `${what} ${w.auto(title)}` : `${what} ${w.manual(title)}`;
}
