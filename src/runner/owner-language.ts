// PLA-I2-20: the language the owner reads, told to each run instead of written into the role prompts (kit/roles/).
// One value for now; the second language (PLA-I2-10) replaces it with the install's setting.
export const OWNER_LANGUAGE = "Spanish";

export const languageLine = (language: string = OWNER_LANGUAGE): string =>
  `Write everything the owner reads (thread lines, questions, notes, docs, titles) in plain ${language}. Code, commands and paths stay as they are.`;
