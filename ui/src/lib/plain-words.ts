// PLA-45: words a person reads that come from agents or Claude (the Brief, thread messages) name the branch
// («sandbox») and the old verbs («Aceptar», «fusionar»). On screen the branch is «la copia de prueba» / «the test
// copy» and the verb is «aprobar» (PLA-42). Applied when the text is drawn or served; what was stored stays.
// PLA-I2-10: the rules of each language live in PLAIN_WORDS. The server (src/brief/plain.ts) passes its language; on
// the screen the default is the screen's language (in node, with no stored language, that is Spanish, as before).
import { defineWords, getLanguage, words } from "./i18n.js";

const apply = (s: string, rules: [RegExp, string][]): string => rules.reduce((out, [re, to]) => out.replace(re, to), s);

export const PLAIN_WORDS = defineWords({
  es: {
    plain: (s: string) =>
      apply(s, [
        [/\bcopia de sandbox\b/gi, "copia de prueba"],
        [/\b(contra|a|en|de|desde|hacia) (la rama )?`?sandbox`?\b/gi, "$1 la copia de prueba"],
        [/\b(la rama )?`?sandbox`?\b/gi, "la copia de prueba"],
        [/\bfusiónalo(?!\p{L})/gu, "apruébalo"],
        [/\bFusiónalo(?!\p{L})/gu, "Apruébalo"],
        [/\bfusionar(lo)?\b/g, "aprobar$1"],
        // The old button name and the PO's «acepta(r/s)» ask: the button says Aprobar now.
        [/\bAceptar o Pedir cambios\b/g, "Aprobar o Pedir cambios"],
        [/\bAceptar\b/g, "Aprobar"],
        [/\baceptes\b/g, "apruebes"],
        [/\bAcepté(?!\p{L})/gu, "Aprobé"],
        [/\bacepté(?!\p{L})/gu, "aprobé"],
        [/\blo aceptes\b/g, "lo apruebes"],
      ]),
  },
  en: {
    plain: (s: string) =>
      apply(s, [
        [/\b(against|into|to|on|in|from) (the )?(branch )?`?sandbox`?\b/gi, "$1 the test copy"],
        [/\b(the )?(branch )?`?sandbox`?\b/gi, "the test copy"],
      ]),
  },
});

export function plainWords(s: string, lang: string = getLanguage()): string {
  return words(PLAIN_WORDS, lang === "es" ? "es" : "en").plain(s);
}
