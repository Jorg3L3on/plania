// PLA-45: the Brief's words are Claude's, written from facts that name the branch («sandbox»). On screen the branch
// is «la copia de prueba» (Spanish) or «the test copy» (English), so the text is cleaned when it is served; the
// stored brief keeps what Claude wrote. Only the words a person reads change: ids, refs and targets stay.
import { plainWords } from "../../ui/src/lib/plain-words.js";

type Text = { title?: unknown; detail?: unknown; why?: unknown };

export { plainWords };

const clean = <T extends Text>(x: T, lang: string): T => {
  const o = { ...x } as Record<string, unknown>;
  for (const k of ["title", "detail", "why"] as const) if (typeof o[k] === "string") o[k] = plainWords(o[k] as string, lang);
  return o as T;
};

/** The brief's data with its readable text cleaned (items and ideas); anything else passes through. */
export function plainBrief(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const d = data as Record<string, unknown>;
  const lang = typeof d.language === "string" ? d.language : "es";
  return {
    ...d,
    ...(Array.isArray(d.items) ? { items: d.items.map((i) => (i && typeof i === "object" ? clean(i as Text, lang) : i)) } : {}),
    ...(Array.isArray(d.ideas) ? { ideas: d.ideas.map((i) => (i && typeof i === "object" ? clean(i as Text, lang) : i)) } : {}),
  };
}
