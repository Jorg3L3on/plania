// PLA-I2-9: the words for the migrations agents wrote in deliveries of Plania itself and the live database has not
// applied. No agent applies them (the deny rules stop it); the owner does, after accepting the delivery.
// Pure, tested without a browser.
// PLA-I2-10: in both languages (lib/i18n.ts); the MIGRACIONES_* constants stay the Spanish.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type AgentMigration = { key: string; title: string; branch: string; files: string[] };
export type AgentMigrations = { self: boolean; deliveries: AgentMigration[] };

export const MIGRACIONES = defineWords({
  es: {
    title: "Migraciones que escribió el equipo",
    lead: "Estas entregas de Plania cambian la base de datos. Ningún agente las aplica: las aplicas tú, después de aceptar la entrega y antes de reiniciar Plania.",
    how: "Para aplicarlas: pnpm db:migrate",
    line: (title: string, n: number, files: string) => `${title}: ${n} migraci${n === 1 ? "ón" : "ones"} (${files})`,
  },
  en: {
    title: "Migrations the team wrote",
    lead: "These deliveries of Plania change the database. No agent applies them: you do, after accepting the delivery and before restarting Plania.",
    how: "To apply them: pnpm db:migrate",
    line: (title: string, n: number, files: string) => `${title}: ${n} migration${n === 1 ? "" : "s"} (${files})`,
  },
});

export const MIGRACIONES_TITLE = MIGRACIONES.es.title;
export const MIGRACIONES_LEAD = MIGRACIONES.es.lead;
export const MIGRACIONES_HOW = MIGRACIONES.es.how;

/** One line per delivery: «Título: 1 migración (0063_x.sql)». */
export function migracionLine(d: AgentMigration, language: Language = getLanguage()): string {
  return words(MIGRACIONES, language).line(d.title, d.files.length, d.files.join(", "));
}

/** Null when there is nothing to show (not Plania itself, or nothing pending). */
export function migracionesView(r: AgentMigrations | null | undefined, language: Language = getLanguage()): { title: string; lead: string; how: string; lines: { key: string; text: string }[] } | null {
  if (!r?.self || r.deliveries.length === 0) return null;
  const w = words(MIGRACIONES, language);
  return { title: w.title, lead: w.lead, how: w.how, lines: r.deliveries.map((d) => ({ key: d.key, text: migracionLine(d, language) })) };
}
