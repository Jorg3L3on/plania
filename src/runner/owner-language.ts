// PLA-I2-20: the language the owner reads, told to each run instead of written into the role prompts (kit/roles/).
// PLA-I2-10: it is the install's language (src/language.ts): Spanish unless the owner chose English.
import { installLanguage, type Language } from "../language.js";

const NAMES: Record<Language, string> = { es: "Spanish", en: "English" };

/** The owner's language by name, as a run's prompt says it ("Spanish", "English"). */
export const ownerLanguage = (language: Language = installLanguage()): string => NAMES[language];

/** @deprecated the default install's language; use ownerLanguage(), which follows the setting. */
export const OWNER_LANGUAGE = NAMES.es;

export const languageLine = (language: string = ownerLanguage()): string =>
  `Write everything the owner reads (thread lines, questions, notes, docs, titles) in plain ${language}. Code, commands and paths stay as they are.`;
