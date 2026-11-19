// PLA-I2-6: the company limits each run meets (runner_settings: max_turns, timeout_minutes, cooldown_minutes), set from
// Plomería (PUT /api/company/settings). Plain Spanish, pure, tested without a browser (test/settings-registry.test.ts).
// The bounds are the route's own (src/api/company.ts Settings); the defaults are the table's (src/db/schema.ts).

export type LimiteCorrida = "max_turns" | "timeout_minutes" | "cooldown_minutes";

export const LIMITES_CORRIDA: Record<LimiteCorrida, { label: string; texto: string; unidad: string; min: number; max: number; defecto: number }> = {
  max_turns: { label: "Turnos por corrida", texto: "Cuántas veces puede actuar un agente en una corrida antes de que Plania la corte.", unidad: "turnos", min: 1, max: 500, defecto: 40 },
  timeout_minutes: { label: "Minutos por corrida", texto: "Cuánto puede durar una corrida antes de que Plania la detenga.", unidad: "minutos", min: 1, max: 600, defecto: 45 },
  cooldown_minutes: { label: "Descanso entre corridas", texto: "Cuántos minutos espera un agente antes de su siguiente corrida. 0: sin descanso.", unidad: "minutos", min: 0, max: 1440, defecto: 30 },
};

export const LIMITES_TITULO = "Cada corrida";
export const LIMITES_TEXTO = "Los topes de cada corrida de cualquier agente. Los valores de fábrica sirven para empezar.";

/** The number to send, or null while the field is not a whole number in range. */
export function limiteValor(k: LimiteCorrida, text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  const l = LIMITES_CORRIDA[k];
  return n >= l.min && n <= l.max ? n : null;
}

export const limiteAviso = (k: LimiteCorrida): string => {
  const l = LIMITES_CORRIDA[k];
  return `Un número entero de ${l.min} a ${l.max} ${l.unidad}.`;
};

export const deFabrica = (k: LimiteCorrida): string => `De fábrica: ${LIMITES_CORRIDA[k].defecto} ${LIMITES_CORRIDA[k].unidad}.`;
