// AUDIT-5: Calidad. The shapes GET /api/scoreboard answers (src/api/scoreboard.ts) and the plain words the page
// shows for them. No React here, so the wording is testable on its own.
import { arranqueLine, arranqueReason } from "./arranque";
import { ApiError } from "@/lib/api";
import { LOCALE } from "./locale.js";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

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
// PLA-I2-10: the words are in CALIDAD_WORDS, in both languages. GROUP_LABEL, GROUP_HINT and KIND_WORD stay the Spanish
// ones (tests read them); the page reads groupLabel(), groupHint() and kindWord(). Each function takes the language last.

export const CALIDAD_WORDS = defineWords({
  es: {
    groupLabel: { role: "Rol", model: "Modelo", prompt_version: "Instrucciones", skills: "Habilidades", resumed: "Sesión" } as Record<GroupBy, string>,
    groupHint: {
      role: "Cada fila es un rol del equipo.",
      model: "Cada fila es el modelo con el que se pidió la corrida.",
      prompt_version: "Cada fila es una versión de las instrucciones del rol. Una sesión retomada no las vuelve a recibir.",
      skills: "Cada fila es un juego de habilidades que la corrida llevaba.",
      resumed: "Compara las corridas que retomaron una sesión con las que empezaron de cero.",
    } as Record<GroupBy, string>,
    roles: {
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
    } as Record<string, string>,
    noRole: "Sin rol",
    noKey: { role: "Sin rol", model: "Modelo por defecto", prompt_version: "Sin versión registrada", skills: "Sin habilidades", resumed: "Sin dato" } as Record<GroupBy, string>,
    resumedYes: "Retomó una sesión",
    resumedNo: "Empezó de cero",
    reasons: {
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
    } as Record<string, string>,
    turns: (n: string) => ` (${n} turnos)`,
    runOk: (tail: string) => `Terminó bien${tail}`,
    runStopped: (tail: string) => `Se detuvo${tail}`,
    runFailed: (reason: string, tail: string) => `Falló: ${reason}${tail}`,
    kind: { failed: "Falló la corrida", returned: "QA la devolvió", sent_back: "La devolviste tú" } as Record<ReadItem["kind"], string>,
    // resumen(): the page's opening lines. The string arguments are numbers already formatted.
    noneLanded: "No se terminó ninguna tarea en este periodo.",
    landed: (n: number, c: string, runs: string, tokens: string) =>
      `${n === 1 ? "Se terminó 1 tarea" : `Se terminaron ${c} tareas`}; cada una tomó en promedio ${runs} corridas y ${tokens} tokens.`,
    qaFirst: (passed: string, n: number, c: string) => `QA aprobó a la primera ${passed} de ${c} ${n === 1 ? "entrega" : "entregas"}.`,
    qaNone: "QA todavía no revisó ninguna entrega.",
    sentBackNone: "No devolviste ninguna entrega que QA hubiera aprobado.",
    sentBack: (sent: string, n: number, c: string) => `Devolviste ${sent} de ${c} ${n === 1 ? "entrega" : "entregas"} que QA había aprobado.`,
    noFailures: "Ninguna corrida falló.",
    noRuns: "Todavía no hay corridas.",
    failures: (n: number, c: string, maxTurns: number, mt: string) =>
      `${n === 1 ? "Falló 1 corrida" : `Fallaron ${c} corridas`}${maxTurns > 0 ? `, ${mt} por llegar al tope de turnos` : ""}.`,
    blocked: (n: number, c: string) => `${n === 1 ? "1 tarea quedó detenida" : `${c} tareas quedaron detenidas`} después de fallar dos veces seguidas.`,
  },
  en: {
    groupLabel: { role: "Role", model: "Model", prompt_version: "Instructions", skills: "Skills", resumed: "Session" },
    groupHint: {
      role: "Each row is a role on the team.",
      model: "Each row is the model the run asked for.",
      prompt_version: "Each row is a version of the role's instructions. A resumed session doesn't get them again.",
      skills: "Each row is a set of skills the run carried.",
      resumed: "Compares the runs that resumed a session with the ones that started from scratch.",
    },
    roles: {
      "product-owner": "Product owner",
      taller: "Taller",
      research: "Research",
      artist: "Artist",
      qa: "QA",
      asistente: "Asistente",
      copy: "Copy",
      seguridad: "Security",
      marketing: "Marketing",
      data: "Data",
    },
    noRole: "No role",
    noKey: { role: "No role", model: "Default model", prompt_version: "No version recorded", skills: "No skills", resumed: "No data" },
    resumedYes: "Resumed a session",
    resumedNo: "Started from scratch",
    reasons: {
      error_max_turns: "Hit the turn limit",
      error_during_execution: "Error while running",
      timeout: "Ran out of time",
      "no result": "Ended without a result",
      "signed out": "No Claude session on this machine",
      start: "Couldn't start",
      "start lost": "Got lost while starting",
      orphaned: "Left half done when Plania restarted",
      "base not allowed": "The starting branch is not allowed",
      "no repo": "Didn't find the repository",
      "pack file in the diff": "Left files from its instructions in the change",
      unknown: "No reason recorded",
    },
    turns: (n: string) => ` (${n} turns)`,
    runOk: (tail: string) => `Finished fine${tail}`,
    runStopped: (tail: string) => `Stopped${tail}`,
    runFailed: (reason: string, tail: string) => `Failed: ${reason}${tail}`,
    kind: { failed: "The run failed", returned: "QA sent it back", sent_back: "You sent it back" },
    noneLanded: "No task was finished in this period.",
    landed: (n: number, c: string, runs: string, tokens: string) =>
      `${n === 1 ? "1 task was finished" : `${c} tasks were finished`}; each one took ${runs} runs and ${tokens} tokens on average.`,
    qaFirst: (passed: string, n: number, c: string) => `QA approved ${passed} of ${c} ${n === 1 ? "delivery" : "deliveries"} the first time.`,
    qaNone: "QA hasn't reviewed any delivery yet.",
    sentBackNone: "You didn't send back any delivery QA had approved.",
    sentBack: (sent: string, n: number, c: string) => `You sent back ${sent} of ${c} ${n === 1 ? "delivery" : "deliveries"} QA had approved.`,
    noFailures: "No run failed.",
    noRuns: "There are no runs yet.",
    failures: (n: number, c: string, maxTurns: number, mt: string) =>
      `${n === 1 ? "1 run failed" : `${c} runs failed`}${maxTurns > 0 ? `, ${mt} by hitting the turn limit` : ""}.`,
    blocked: (n: number, c: string) => `${n === 1 ? "1 task was stopped" : `${c} tasks were stopped`} after failing twice in a row.`,
  },
});

export const GROUP_LABEL: Record<GroupBy, string> = CALIDAD_WORDS.es.groupLabel;
export const GROUP_HINT: Record<GroupBy, string> = CALIDAD_WORDS.es.groupHint;
export const groupLabel = (by: GroupBy, language: Language = getLanguage()): string => words(CALIDAD_WORDS, language).groupLabel[by];
export const groupHint = (by: GroupBy, language: Language = getLanguage()): string => words(CALIDAD_WORDS, language).groupHint[by];

export const roleWord = (role: string | null, language: Language = getLanguage()): string => {
  const w = words(CALIDAD_WORDS, language);
  return role ? (w.roles[role] ?? role) : w.noRole;
};

// "tdd@11111111, review@22222222" → "tdd, review": the hash tells versions apart, the name is what is read.
export function groupName(by: GroupBy, key: string | null, language: Language = getLanguage()): string {
  const w = words(CALIDAD_WORDS, language);
  if (key === null) return w.noKey[by];
  if (by === "role") return roleWord(key, language);
  if (by === "resumed") return key === "resumed" ? w.resumedYes : w.resumedNo;
  if (by === "skills") return key.split(", ").map((s) => s.split("@")[0]).join(", ");
  return key;
}
// The exact key under the name, when the name alone hides something (a skill's hash).
export const groupDetail = (by: GroupBy, key: string | null): string | null => (by === "skills" && key ? key.split(", ").map((s) => s.split("@")[1] ?? "").join(" · ") : null);

// NEWPROJ-5: a start-up failure without a word here takes its words from lib/arranque.ts.
export const reasonWord = (reason: string, language: Language = getLanguage()): string =>
  words(CALIDAD_WORDS, language).reasons[reason] ?? arranqueReason(reason, language)?.por ?? reason.replace(/_/g, " ");

// "fail: error_max_turns (41 turns, session c1)" → "Falló: llegó al tope de turnos (41 turnos)".
// A failure comes back as its reason and tail, so logWords can say it without the «Falló:» lead.
function runParts(summary: string, language: Language): { text: string } | { reason: string; tail: string } {
  const w = words(CALIDAD_WORDS, language);
  const m = /^(ok|fail|stopped):\s*(.*)$/i.exec(summary.trim());
  if (!m) return { text: summary };
  const turns = /(\d+) turns?/.exec(m[2]!)?.[1];
  const tail = turns ? w.turns(turns) : "";
  const state = m[1]!.toLowerCase();
  if (state === "ok") return { text: w.runOk(tail) };
  if (state === "stopped") return { text: w.runStopped(tail) };
  const reason = /after timeout\s*$/i.test(m[2]!) ? "timeout" : m[2]!.split("(")[0]!.trim() || "unknown";
  return { reason: reasonWord(reason, language), tail };
}

export function runWords(summary: string | null, language: Language = getLanguage()): string | null {
  if (!summary) return null;
  const p = runParts(summary, language);
  if ("text" in p) return p.text;
  return words(CALIDAD_WORDS, language).runFailed(`${p.reason.charAt(0).toLowerCase()}${p.reason.slice(1)}`, p.tail);
}

// NEWPROJ-5: a run's summary in a list that already shows its state (Plomería's log): a start-up failure says what
// happened and what to fix, another failure its reason in words, anything else as the run wrote it.
export function logWords(summary: string, language: Language = getLanguage()): string {
  const start = arranqueLine(summary, language);
  if (start) return start;
  if (!/^fail:/i.test(summary.trim())) return summary;
  const p = runParts(summary, language);
  if ("text" in p) return p.text;
  return `${p.reason.charAt(0).toUpperCase()}${p.reason.slice(1)}${p.tail}`;
}

export const KIND_WORD: Record<ReadItem["kind"], string> = CALIDAD_WORDS.es.kind;
export const kindWord = (kind: ReadItem["kind"], language: Language = getLanguage()): string => words(CALIDAD_WORDS, language).kind[kind];

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

// The page's opening lines: what happened in the period, in sentences, before any table.
export function resumen(t: ScoreGroup, language: Language = getLanguage()): string[] {
  const w = words(CALIDAD_WORDS, language);
  const out: string[] = [];
  out.push(t.tickets_landed === 0 ? w.noneLanded : w.landed(t.tickets_landed, count(t.tickets_landed), decimal(t.runs_per_ticket), compact(t.tokens_per_ticket)));
  if (t.qa_first.concluded > 0) out.push(w.qaFirst(count(t.qa_first.passed), t.qa_first.concluded, count(t.qa_first.concluded)));
  else out.push(w.qaNone);
  if (t.sent_back.passed > 0) {
    out.push(t.sent_back.count === 0 ? w.sentBackNone : w.sentBack(count(t.sent_back.count), t.sent_back.passed, count(t.sent_back.passed)));
  }
  if (t.failures.total === 0) out.push(t.runs > 0 ? w.noFailures : w.noRuns);
  else out.push(w.failures(t.failures.total, count(t.failures.total), t.failures.max_turns, count(t.failures.max_turns)));
  if (t.blocked_after_two > 0) out.push(w.blocked(t.blocked_after_two, count(t.blocked_after_two)));
  return out;
}
