// PLA-I2-10: the PO's «Entendí: …» note is a marker its instructions ask for, written in the owner's language:
// «Entendí:» in Spanish, «Understood:» in English. Both are read whatever the install's language, so switching the
// language never hides an older note. It is a one-word marker, not a sentence (test/i2-10-server.test.ts lists it).
import type { Language } from "../language.js";

export const UNDERSTOOD_MARK = /^\s*(?:entend[ií]|understood)\s*[:：-]\s*/i;
export const isUnderstood = (text: string): boolean => UNDERSTOOD_MARK.test(text);
export const stripUnderstood = (text: string): string => text.replace(UNDERSTOOD_MARK, "");
/** The word the PO is asked to start the line with. */
export const understoodWord = (language: Language): string => (language === "en" ? "Understood" : "Entendí");
