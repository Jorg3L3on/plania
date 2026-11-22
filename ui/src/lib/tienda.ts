// PLA-I71-4: the skill store's pure part (board Habilidades): the filters and their counts, the search, the line
// each card says about its use, and the list a seat's switch saves.
import { getLanguage, words, type Language } from "./i18n.js";
import { skillWords } from "./oficio.js";
import { TIENDA_WORDS } from "./tienda-words.js";

export type TiendaSkill = {
  slug: string;
  name: string;
  when: string;
  source: "kit" | "doc" | "owner";
  origin: "factory" | "yours" | "brought";
  version: string;
  scope: string | null;
  carriers: { agent: string; on: boolean }[];
  runs_carried: number;
  runs_used: number;
  upstream?: boolean;
};
export type Tienda = { seats: { agent: string; role: string }[]; skills: TiendaSkill[] };
export const FILTERS = ["todas", "fabrica", "tuyas", "traidas", "nadie"] as const;
export type Filter = (typeof FILTERS)[number];

export const matches = (s: TiendaSkill, f: Filter): boolean =>
  f === "todas" ? true : f === "fabrica" ? s.origin === "factory" : f === "tuyas" ? s.origin === "yours" : f === "traidas" ? s.origin === "brought" : !s.carriers.some((c) => c.on);

export function filterCounts(list: TiendaSkill[]): Record<Filter, number> {
  return Object.fromEntries(FILTERS.map((f) => [f, list.filter((s) => matches(s, f)).length])) as Record<Filter, number>;
}

const fold = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
/** PLA-137: matches what the card shows (its name and line in the owner's language) as well as the stored name, its
 *  description and the slug; every word of the query must appear, in any order. */
export const searchOf = (list: TiendaSkill[], q: string, language: Language = getLanguage()): TiendaSkill[] => {
  const parts = fold(q.trim()).split(/\s+/).filter(Boolean);
  if (!parts.length) return list;
  return list.filter((s) => {
    const shown = skillWords(s, language);
    const hay = fold(`${shown.name} ${shown.line} ${s.name} ${s.when} ${s.slug.replace(/-/g, " ")}`);
    return parts.every((p) => hay.includes(p));
  });
};

/** «usada en 9 de 11», or that no run carried it (never «0 de 0»). */
export const usageLine = (s: Pick<TiendaSkill, "runs_carried" | "runs_used" | "carriers">, language: Language = getLanguage()): string => {
  const w = words(TIENDA_WORDS, language);
  if (s.runs_carried > 0) return w.usedIn(s.runs_used, s.runs_carried);
  return s.carriers.some((c) => c.on) ? w.noRunYet : w.nobodyCarries;
};

/** The factory list a seat saves when one skill is switched (its own list: the factory skills it carries now). */
export const seatListAfter = (store: TiendaSkill[], agent: string, slug: string, on: boolean): string[] => {
  const now = store.filter((s) => s.origin === "factory" && s.carriers.some((c) => c.agent === agent && c.on)).map((s) => s.slug);
  const without = now.filter((x) => x !== slug);
  return on ? [...without, slug] : without;
};
