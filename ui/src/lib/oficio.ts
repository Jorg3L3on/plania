// PLA-I67-1: «Oficio», the pure part: which rows the drawing has, how thick each thread is, where each delivery
// sits on the line, the sentence under the seat switcher and the list a shelf switch saves. Tested without a
// browser (test/i67-oficio-ui.test.ts). Pure: no "@/" imports.
import { getLanguage, words, type Language } from "./i18n.js";
import { FALLBACK_LOCALES } from "./locale.js";
import { KIT_SKILL_WORDS, OFICIO_WORDS, type SkillWords } from "./oficio-words.js";

export type Outcome = "primera" | "devuelta" | "espera" | "trabajando" | "en_curso" | "descartada";
export type OficioSkill = {
  slug: string;
  name: string;
  when: string;
  source: "kit" | "doc" | "owner";
  version: string;
  on: boolean;
  factory: boolean;
  // PLA-I67-2: the owner's skill (or copy of a factory one) in this agent's scope; null for the factory kit.
  owner: { scope: string; state: string; origin: string; n: number } | null;
  runs_carried: number;
  runs_used: number;
  deliveries_carried: number;
  deliveries_used: number;
};
export type OficioDelivery = {
  key: string;
  title: string;
  kind: string;
  status: string;
  outcome: Outcome;
  closed: boolean;
  sent_back: number;
  words: string | null;
  at: string;
  runs: number;
  carried: string[];
  used: string[];
};
export type Oficio = {
  project: string;
  agent: string;
  role: string;
  own: boolean;
  skills: OficioSkill[];
  deliveries: OficioDelivery[];
  counts: { closed: number; first_time: number; last_five: number; last_five_first: number };
  runs: { total: number; with_kit: number; used_any: number };
  live: { key: string | null; since: string } | null;
  window_days: number;
  too_many?: boolean;
};

/** A skill in the owner's language: Plania's own skills by slug, anything else by its own name and description. */
export function skillWords(s: { slug: string; name: string; when: string; source?: string }, language: Language = getLanguage()): SkillWords {
  // PLA-I67-2: the owner's own skill (or a copy they renamed) reads by its own name.
  const known = s.source === "owner" && s.name !== s.slug ? undefined : (words(KIT_SKILL_WORDS, language) as Record<string, SkillWords | undefined>)[s.slug];
  if (known) return known;
  const line = s.when.length > 120 ? `${s.when.slice(0, 119).trimEnd()}…` : s.when;
  return { name: s.name, line };
}

/** PLA-141: a skill named by its slug alone (a team's list, a role's suggested set), as the owner reads it. */
export const skillName = (slug: string, language: Language = getLanguage()): string => skillWords({ slug, name: slug, when: "" }, language).name;

/** «una», «dos»… up to ten (feminine: habilidad, entrega), capitalised on request; digits after. */
const NUM: Record<Language, string[]> = {
  es: ["ninguna", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"],
  en: ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"],
};
export const numWord = (n: number, language: Language = getLanguage(), cap = false): string => {
  const w = n <= 10 ? NUM[language][n]! : String(n);
  return cap ? w.charAt(0).toUpperCase() + w.slice(1) : w;
};

/** «Taller: cinco habilidades.» and «Nueve entregas en tres meses, cuatro a la primera.» */
export function headline(o: Pick<Oficio, "skills" | "deliveries" | "counts">, seat: string, language: Language = getLanguage()): { lead: string; rest: string } {
  const w = words(OFICIO_WORDS, language);
  const on = o.skills.filter((s) => s.on).length;
  const lead = `${seat}: ${on ? w.skillsWord(numWord(on, language), on) : w.noSkillsWord}.`;
  const n = o.deliveries.length;
  const rest = n ? w.deliveriesLine(numWord(n, language, true), n, o.counts.closed ? numWord(o.counts.first_time, language) : null) : w.noDeliveriesLine;
  return { lead, rest };
}

export type Row = { kind: "post" } | { kind: "skill"; skill: OficioSkill } | { kind: "off"; skill: OficioSkill };

/** The drawing's rows: its seat first, then every skill it carries, then the factory ones it no longer carries
 *  (so a switched-off skill stays listed as off), cut to fit maxRows. */
export function rowsOf(skills: OficioSkill[], maxRows: number): Row[] {
  const rows: Row[] = [{ kind: "post" }];
  for (const s of skills) if (s.on) rows.push({ kind: "skill", skill: s });
  for (const s of skills) if (!s.on && (s.factory || s.runs_carried > 0)) rows.push({ kind: "off", skill: s });
  return rows.slice(0, Math.max(1, maxRows));
}

/** A thread's width: thicker the more the seat used the skill (1.2 px when never, 4.5 px for the most used). */
export function threadWidth(used: number, maxUsed: number): number {
  if (used <= 0 || maxUsed <= 0) return 1.2;
  return Math.round((1.6 + (2.9 * used) / maxUsed) * 10) / 10;
}

/** Where each delivery sits on the line from x0 to x1, oldest on the left (the list comes newest first). */
export function dotsX<T>(deliveries: T[], x0: number, x1: number): { d: T; x: number }[] {
  const list = [...deliveries].reverse();
  if (list.length === 0) return [];
  if (list.length === 1) return [{ d: list[0]!, x: x1 }];
  const step = (x1 - x0) / (list.length - 1);
  return list.map((d, i) => ({ d, x: Math.round(x0 + i * step) }));
}

/** Whether every dot can carry its date under it (else every other one does). */
export const labelEvery = (count: number, width: number, minGap = 52): number => (count <= 1 ? 1 : width / (count - 1) >= minGap ? 1 : 2);

/** «28 oct», or «hoy» for today, in the screen's time zone. */
export function dayLabel(iso: string, now: number, timeZone?: string, language: Language = getLanguage()): string {
  const locale = FALLBACK_LOCALES[language];
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(new Date(t));
  if (day(Date.parse(iso)) === day(now)) return words(OFICIO_WORDS, language).today;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone }).format(new Date(iso)).replace(".", "");
}

/** The delivery the readout opens on: the newest one that ended (landed or came back), else the newest. */
export function firstPick(deliveries: OficioDelivery[]): string | null {
  return (deliveries.find((d) => d.closed || d.outcome === "devuelta") ?? deliveries[0])?.key ?? null;
}

/** The list a shelf switch saves: what the seat carries now, with slug turned on (at the end) or off. */
export function shelfNext(carried: string[], slug: string, on: boolean): string[] {
  const rest = carried.filter((s) => s !== slug);
  return on ? [...rest, slug] : rest;
}

/** The readout's last line: what it carried and used, by the skills' names. */
export function carriedLine(d: OficioDelivery, skills: OficioSkill[], language: Language = getLanguage()): string {
  const w = words(OFICIO_WORDS, language);
  const nameOf = (slug: string) => {
    const s = skills.find((x) => x.slug === slug);
    return s ? skillWords(s, language).name : null;
  };
  // Only skills on the shelf count as used (a run may call a skill of the machine's own, outside the kit).
  const used = d.used.map(nameOf).filter((x): x is string => !!x);
  const list = used.length <= 1 ? (used[0] ?? "") : `${used.slice(0, -1).join(", ")} ${language === "es" ? "y" : "and"} ${used[used.length - 1]}`;
  return `${w.carried(d.carried.length)} ${used.length ? w.used(list) : w.usedNone}`;
}

/** Which dots carry their date: every one when there is room (else every other one), the newest always (the one
 *  before it gives way), and never the same date twice in a row (seen live: twelve deliveries on one day read
 *  «18 nov» six times). */
export function dayMarks(labels: string[], every: number): boolean[] {
  const n = labels.length;
  const out: boolean[] = [];
  let last: string | null = null;
  for (let i = 0; i < n; i++) {
    const room = i === n - 1 || (i % every === 0 && !(every > 1 && i === n - 2));
    const show = room && (labels[i] !== last || i === n - 1) && !(i < n - 1 && labels[i] === labels[n - 1]);
    if (show) last = labels[i]!;
    out.push(show);
  }
  return out;
}
