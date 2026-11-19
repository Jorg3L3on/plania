// PLA-I2-10: the server's sentences in the install's language. A wording module is made with defineWords (the
// screen's ui/src/lib/i18n.ts: the English must carry every key the Spanish has) and read with say(), which picks
// installLanguage() (src/language.ts) at the moment the sentence is made. Words stored in the database stay as they
// were written; only new text follows the language.
import { installLanguage, type Language } from "./language.js";
import { defineWords, words, type Words } from "../ui/src/lib/i18n.js";
import { ownerEs, ownerName } from "./owner.js";

export { defineWords, type Words };

/** The words of a wording module in the install's language (or the one given). */
export const say = <T>(w: Words<T>, language: Language = installLanguage()): T => words(w, language);

/** The owner as a sentence names them: Spanish with its preposition («del dueño», «a Ana»), English plain. */
export const ownerIn = (language: Language, prep?: "de" | "a" | "por", opts: { capital?: boolean } = {}): string =>
  language === "es" ? ownerEs(prep, opts) : ownerName("en", opts);

/** The owner's display name in English with a possessive: "Ana's", "the owner's". */
export const ownersEn = (opts: { capital?: boolean } = {}): string => `${ownerName("en", opts)}'s`;
