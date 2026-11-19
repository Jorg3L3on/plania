// PLA-I46-13: the Sumar sheet (Design PLA-I46 screen 7). Two choices, role and skill packs; the engine is one line
// while Claude Code is the only one. Roles: QA, Escritura, Seguridad, Research, and Otro for the remaining templates.
// The packs come from GET /api/company/packs (Plania docs), never from this file; only the suggestion names slugs.
import type { HireRole, PackRef } from "@/lib/api";
import { roleName } from "@/lib/org";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

// PLA-I2-10: the sheet's words in both languages.
export const SUMAR_WORDS = defineWords({
  es: {
    roles: { qa: "QA", copy: "Escritura", seguridad: "Seguridad", research: "Research" } as Record<string, string>,
    stateNote: { free: null, taken: "Ya está", no_doc: "Falta su doc" } as Record<HireRole["state"], string | null>,
  },
  en: {
    roles: { qa: "QA", copy: "Writing", seguridad: "Security", research: "Research" },
    stateNote: { free: null, taken: "Already there", no_doc: "Its doc is missing" },
  },
});

export const MOTOR = "Claude Code";
export const OTRO = "otro";

/** The four named roles, in order (their labels are words: SUMAR_WORDS.roles). */
const MAIN = ["qa", "copy", "seguridad", "research"] as const;

export type RoleChoice = { slug: string; label: string; state: HireRole["state"] };

export const hireLabel = (slug: string, language: Language = getLanguage()): string => ((MAIN as readonly string[]).includes(slug) ? words(SUMAR_WORDS, language).roles[slug] : undefined) ?? roleName(slug, language);

// The four named roles in order (a template the server does not know shows as no_doc), then the rest under Otro.
export function roleChoices(hire: HireRole[], language: Language = getLanguage()): { main: RoleChoice[]; otros: RoleChoice[] } {
  const by = new Map(hire.map((h) => [h.slug, h]));
  const main = MAIN.map((slug) => ({ slug, label: hireLabel(slug, language), state: by.get(slug)?.state ?? ("no_doc" as const) }));
  const named = new Set<string>(MAIN);
  const otros = hire.filter((h) => !named.has(h.slug)).map((h) => ({ slug: h.slug, label: hireLabel(h.slug, language), state: h.state }));
  return { main, otros };
}

// The first role that can be added: a named one, else one under Otro.
export function firstFree(choices: { main: RoleChoice[]; otros: RoleChoice[] }): string | null {
  return choices.main.find((c) => c.state === "free")?.slug ?? choices.otros.find((c) => c.state === "free")?.slug ?? null;
}

const SUGGESTED: Record<string, string[]> = {
  qa: ["pruebas-primero", "qa-visual-con-capturas"],
  copy: ["espanol-claro"],
  seguridad: ["revision-de-seguridad"],
  research: ["preguntas-antes-de-construir"],
  taller: ["pruebas-primero", "preguntas-antes-de-construir"],
};

// The packs ticked when a role is picked: its suggestion, kept only where Plania has that pack.
export const suggestedPacks = (role: string | null, packs: PackRef[]): string[] => {
  const have = new Set(packs.map((p) => p.slug));
  return (role ? (SUGGESTED[role] ?? []) : []).filter((s) => have.has(s));
};

/** The note beside a role that cannot be added. */
export const stateNote = (state: HireRole["state"], language: Language = getLanguage()): string | null => words(SUMAR_WORDS, language).stateNote[state];
/** The notes in the language this page loaded with (it is fixed for the life of the page). */
export const STATE_NOTE: Record<HireRole["state"], string | null> = words(SUMAR_WORDS).stateNote;
