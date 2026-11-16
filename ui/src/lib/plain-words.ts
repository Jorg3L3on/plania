// PLA-45: words a person reads that come from agents or Claude (the Brief, thread messages) name the branch
// («sandbox») and the old verbs («Aceptar», «fusionar»). On screen the branch is «la copia de prueba» / «the test
// copy» and the verb is «aprobar» (PLA-42). Applied when the text is drawn or served; what was stored stays.
const ES: [RegExp, string][] = [
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
];
const EN: [RegExp, string][] = [
  [/\b(against|into|to|on|in|from) (the )?(branch )?`?sandbox`?\b/gi, "$1 the test copy"],
  [/\b(the )?(branch )?`?sandbox`?\b/gi, "the test copy"],
];

export function plainWords(s: string, lang: string = "es"): string {
  let out = s;
  for (const [re, to] of lang === "es" ? ES : EN) out = out.replace(re, to);
  return out;
}
