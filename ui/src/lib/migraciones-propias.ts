// PLA-I2-9: the words for the migrations agents wrote in deliveries of Plania itself and the live database has not
// applied. No agent applies them (the deny rules stop it); the owner does, after accepting the delivery.
// Pure, tested without a browser.

export type AgentMigration = { key: string; title: string; branch: string; files: string[] };
export type AgentMigrations = { self: boolean; deliveries: AgentMigration[] };

export const MIGRACIONES_TITLE = "Migraciones que escribió el equipo";
export const MIGRACIONES_LEAD =
  "Estas entregas de Plania cambian la base de datos. Ningún agente las aplica: las aplicas tú, después de aceptar la entrega y antes de reiniciar Plania.";
export const MIGRACIONES_HOW = "Para aplicarlas: pnpm db:migrate";

/** One line per delivery: «Título: 1 migración (0063_x.sql)». */
export function migracionLine(d: AgentMigration): string {
  const n = d.files.length;
  return `${d.title}: ${n} migraci${n === 1 ? "ón" : "ones"} (${d.files.join(", ")})`;
}

/** Null when there is nothing to show (not Plania itself, or nothing pending). */
export function migracionesView(r: AgentMigrations | null | undefined): { title: string; lead: string; how: string; lines: { key: string; text: string }[] } | null {
  if (!r?.self || r.deliveries.length === 0) return null;
  return { title: MIGRACIONES_TITLE, lead: MIGRACIONES_LEAD, how: MIGRACIONES_HOW, lines: r.deliveries.map((d) => ({ key: d.key, text: migracionLine(d) })) };
}
