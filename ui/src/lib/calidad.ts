// AUDIT-5: Calidad. The shapes GET /api/scoreboard answers (src/api/scoreboard.ts) and the plain words the page
// shows for them. No React here, so the wording is testable on its own.
import { ARRANQUE, arranqueLine } from "./arranque";
import { ApiError } from "@/lib/api";
import { LOCALE } from "./locale.js";

export const GROUPS = ["role", "model", "prompt_version", "skills", "resumed"] as const;
export type GroupBy = (typeof GROUPS)[number];
export const PERIODS = [7, 28, 90] as const;

type Rate = number | null;
export type ScoreGroup = {
  key: string | null;
  runs: number;
  tickets_landed: number;
  runs_per_ticket: Rate;
  tokens_per_ticket: Rate;
  qa_first: { passed: number; concluded: number; rate: Rate };
  sent_back: { count: number; passed: number; rate: Rate };
  failures: { total: number; max_turns: number; other: number; by_reason: { reason: string; count: number }[] };
  blocked_after_two: number;
  resumed: { runs: number; fresh_runs: number; share: Rate; ok_rate_resumed: Rate; ok_rate_fresh: Rate };
  context_tokens_median: number | null;
};
export type ReadItem = {
  kind: "failed" | "returned" | "sent_back";
  project: string;
  key: string | null;
  title: string | null;
  role: string | null;
  at: string;
  summary: string | null;
  qa_notes: string | null;
  attempt: number | null;
  owner_text: string | null;
};
export type Scoreboard = {
  days: number;
  since: string;
  until: string;
  project: string | null;
  by: GroupBy;
  empty: boolean;
  total: ScoreGroup;
  groups: ScoreGroup[];
  to_read: ReadItem[];
};

export const parseBy = (v: string | null): GroupBy => ((GROUPS as readonly string[]).includes(v ?? "") ? (v as GroupBy) : "role");
export const parseDays = (v: string | null): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 28;
};

// Its own small read (cookie only, like every /api call) so the shared client file stays as it is.
export async function fetchScoreboard(input: { by: GroupBy; days: number; project?: string }): Promise<Scoreboard> {
  const q = new URLSearchParams({ by: input.by, days: String(input.days) });
  if (input.project) q.set("project", input.project);
  const res = await fetch(`/api/scoreboard?${q}`, { credentials: "same-origin" });
  if (!res.ok) {
    const { error, ...detail } = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    throw new ApiError(res.status, error ?? `HTTP_${res.status}`, detail);
  }
  return (await res.json()) as Scoreboard;
}

// ---- Words

export const GROUP_LABEL: Record<GroupBy, string> = {
  role: "Rol",
  model: "Modelo",
  prompt_version: "Instrucciones",
  skills: "Habilidades",
  resumed: "Sesión",
};
export const GROUP_HINT: Record<GroupBy, string> = {
  role: "Cada fila es un rol del equipo.",
  model: "Cada fila es el modelo con el que se pidió la corrida.",
  prompt_version: "Cada fila es una versión de las instrucciones del rol. Una sesión retomada no las vuelve a recibir.",
  skills: "Cada fila es un juego de habilidades que la corrida llevaba.",
  resumed: "Compara las corridas que retomaron una sesión con las que empezaron de cero.",
};

const ROLE_WORD: Record<string, string> = {
  "product-owner": "Product owner",
  taller: "Taller",
  research: "Research",
  artist: "Artist",
  qa: "QA",
  asistente: "Asistente",
  copy: "Copy",
  seguridad: "Seguridad",
  marketing: "Marketing",
  data: "Data",
};
export const roleWord = (role: string | null): string => (role ? (ROLE_WORD[role] ?? role) : "Sin rol");

const NO_KEY: Record<GroupBy, string> = {
  role: "Sin rol",
  model: "Modelo por defecto",
  prompt_version: "Sin versión registrada",
  skills: "Sin habilidades",
  resumed: "Sin dato",
};

// "tdd@11111111, review@22222222" → "tdd, review": the hash tells versions apart, the name is what is read.
export function groupName(by: GroupBy, key: string | null): string {
  if (key === null) return NO_KEY[by];
  if (by === "role") return roleWord(key);
  if (by === "resumed") return key === "resumed" ? "Retomó una sesión" : "Empezó de cero";
  if (by === "skills") return key.split(", ").map((s) => s.split("@")[0]).join(", ");
  return key;
}
// The exact key under the name, when the name alone hides something (a skill's hash).
export const groupDetail = (by: GroupBy, key: string | null): string | null => (by === "skills" && key ? key.split(", ").map((s) => s.split("@")[1] ?? "").join(" · ") : null);

const REASON_WORD: Record<string, string> = {
  error_max_turns: "Llegó al tope de turnos",
  error_during_execution: "Error durante la ejecución",
  timeout: "Se acabó el tiempo",
  "no result": "Terminó sin dar resultado",
  // PLA-I2-12: Claude Code signed out on this machine; the machine check page has the fix.
  "signed out": "Sin sesión de Claude en esta máquina",
  start: "No pudo arrancar",
  "start lost": "Se perdió al arrancar",
  orphaned: "Quedó a medias al reiniciar Plania",
  "base not allowed": "La rama de origen no está permitida",
  "no repo": "No encontró el repositorio",
  "pack file in the diff": "Dejó archivos de sus instrucciones en el cambio",
  unknown: "Sin motivo registrado",
};
// NEWPROJ-5: a start-up failure without a word here takes its words from lib/arranque.ts.
export const reasonWord = (reason: string): string => REASON_WORD[reason] ?? ARRANQUE[reason]?.por ?? reason.replace(/_/g, " ");

// "fail: error_max_turns (41 turns, session c1)" → "Falló: llegó al tope de turnos (41 turnos)".
export function runWords(summary: string | null): string | null {
  if (!summary) return null;
  const m = /^(ok|fail|stopped):\s*(.*)$/i.exec(summary.trim());
  if (!m) return summary;
  const turns = /(\d+) turns?/.exec(m[2]!)?.[1];
  const tail = turns ? ` (${turns} turnos)` : "";
  const state = m[1]!.toLowerCase();
  if (state === "ok") return `Terminó bien${tail}`;
  if (state === "stopped") return `Se detuvo${tail}`;
  const reason = /after timeout\s*$/i.test(m[2]!) ? "timeout" : m[2]!.split("(")[0]!.trim() || "unknown";
  const words = reasonWord(reason);
  return `Falló: ${words.charAt(0).toLowerCase()}${words.slice(1)}${tail}`;
}

// NEWPROJ-5: a run's summary in a list that already shows its state (Plomería's log): a start-up failure says what
// happened and what to fix, another failure its reason in words, anything else as the run wrote it.
export function logWords(summary: string): string {
  const start = arranqueLine(summary);
  if (start) return start;
  if (!/^fail:/i.test(summary.trim())) return summary;
  return (runWords(summary) ?? summary).replace(/^Falló: (.)/, (_m, c: string) => c.toUpperCase());
}

export const KIND_WORD: Record<ReadItem["kind"], string> = { failed: "Falló la corrida", returned: "QA la devolvió", sent_back: "La devolviste tú" };

// ---- Numbers

const whole = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
export const NONE = "—";
export const count = (n: number): string => whole.format(n);
export const pct = (rate: Rate): string => (rate === null ? NONE : `${whole.format(rate * 100)} %`);
export const decimal = (n: Rate): string => (n === null ? NONE : oneDecimal.format(n));
export function compact(n: Rate): string {
  if (n === null) return NONE;
  if (n >= 1_000_000) return `${oneDecimal.format(n / 1_000_000)} M`;
  if (n >= 1_000) return `${oneDecimal.format(n / 1_000)} k`;
  return whole.format(n);
}
const plural = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;

// The page's opening lines: what happened in the period, in sentences, before any table.
export function resumen(t: ScoreGroup): string[] {
  const out: string[] = [];
  out.push(
    t.tickets_landed === 0
      ? "No se terminó ninguna tarea en este periodo."
      : `${t.tickets_landed === 1 ? "Se terminó 1 tarea" : `Se terminaron ${count(t.tickets_landed)} tareas`}; cada una tomó en promedio ${decimal(t.runs_per_ticket)} corridas y ${compact(t.tokens_per_ticket)} tokens.`,
  );
  if (t.qa_first.concluded > 0) out.push(`QA aprobó a la primera ${count(t.qa_first.passed)} de ${plural(t.qa_first.concluded, "entrega", "entregas")}.`);
  else out.push("QA todavía no revisó ninguna entrega.");
  if (t.sent_back.passed > 0) {
    out.push(t.sent_back.count === 0 ? "No devolviste ninguna entrega que QA hubiera aprobado." : `Devolviste ${count(t.sent_back.count)} de ${plural(t.sent_back.passed, "entrega", "entregas")} que QA había aprobado.`);
  }
  if (t.failures.total === 0) out.push(t.runs > 0 ? "Ninguna corrida falló." : "Todavía no hay corridas.");
  else out.push(`${t.failures.total === 1 ? "Falló 1 corrida" : `Fallaron ${count(t.failures.total)} corridas`}${t.failures.max_turns > 0 ? `, ${count(t.failures.max_turns)} por llegar al tope de turnos` : ""}.`);
  if (t.blocked_after_two > 0) out.push(`${t.blocked_after_two === 1 ? "1 tarea quedó detenida" : `${count(t.blocked_after_two)} tareas quedaron detenidas`} después de fallar dos veces seguidas.`);
  return out;
}
