// PLA-I46-13: the Sumar sheet (Design PLA-I46 screen 7). Two choices, role and skill packs; the engine is one line
// while Claude Code is the only one. Roles: QA, Escritura, Seguridad, Research, and Otro for the remaining templates.
// The packs come from GET /api/company/packs (Plania docs), never from this file; only the suggestion names slugs.
import type { HireRole, PackRef } from "@/lib/api";
import { roleName } from "@/lib/org";

export const MOTOR = "Claude Code";
export const OTRO = "otro";

const MAIN: { slug: string; label: string }[] = [
  { slug: "qa", label: "QA" },
  { slug: "copy", label: "Escritura" },
  { slug: "seguridad", label: "Seguridad" },
  { slug: "research", label: "Research" },
];

export type RoleChoice = { slug: string; label: string; state: HireRole["state"] };

export const hireLabel = (slug: string): string => MAIN.find((m) => m.slug === slug)?.label ?? roleName(slug);

// The four named roles in order (a template the server does not know shows as no_doc), then the rest under Otro.
export function roleChoices(hire: HireRole[]): { main: RoleChoice[]; otros: RoleChoice[] } {
  const by = new Map(hire.map((h) => [h.slug, h]));
  const main = MAIN.map((m) => ({ slug: m.slug, label: m.label, state: by.get(m.slug)?.state ?? ("no_doc" as const) }));
  const named = new Set(MAIN.map((m) => m.slug));
  const otros = hire.filter((h) => !named.has(h.slug)).map((h) => ({ slug: h.slug, label: hireLabel(h.slug), state: h.state }));
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

export const STATE_NOTE: Record<HireRole["state"], string | null> = { free: null, taken: "Ya está", no_doc: "Falta su doc" };
