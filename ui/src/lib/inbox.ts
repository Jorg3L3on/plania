// Words the Bandeja and Inicio share for what waits on Jorge.

/** What an agent asks permission for, in the words of the approval row. */
export const ACTION_WORD: Record<string, string> = {
  done: "marcar Done",
  wont_do: "marcar Won't do",
  reopen: "reabrir",
  waive_check: "eximir un punto del Done when",
  runbook_step: "ejecutar un paso",
  lease_resource: "tomar un recurso",
};

export const actionWord = (action: string | undefined) => ACTION_WORD[action ?? ""] ?? action ?? "";

// Gate answers are stored as pursue, drop, later, proceed, rework and ready. The screen says them
// in Spanish; the click still sends the stored word, which is what moves the idea on.
const GATE_OPTION_ES: Record<string, string> = {
  pursue: "Seguir",
  drop: "Soltar",
  later: "Después",
  proceed: "Adelante",
  rework: "Rehacer",
  ready: "Lista",
};

export function optionLabel(option: string): string {
  return GATE_OPTION_ES[option] ?? option;
}

export function questionMarkLabels(gate: string | null | undefined, humanOnly: boolean | undefined): string[] {
  const labels: string[] = [];
  if (gate === "A" || gate === "B" || gate === "C") labels.push(`Compuerta ${gate}`);
  if (humanOnly) labels.push("Solo tú");
  return labels;
}

/** "3 min", "2 h", "1 d" from seconds waited. */
export function waitText(s: number): string {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}
