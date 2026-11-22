// PLA-I74-1: the run report on an initiative's ficha (src/api/run-report.ts), in the owner's words: Plania's own
// fixes, his clicks beyond the decisions, the turns Plania freed by itself, time per stop, the longest stretch with
// nobody's turn and the tokens per agent. Pure, tested without a browser (test/i74-run-report.test.ts).
import { defineWords, words } from "./i18n.js";
import { duracion } from "./cronometro.js";

export type ReportStop = "entendido" | "investigacion" | "diseno" | "plan" | "lista" | "construccion" | "publicado";
export type DecisionControl = "pedir" | "respuesta" | "asi_es" | "me_gusta" | "construyelo" | "aceptar" | "ajuste" | "publicar";
export type RunReport = {
  start: string;
  end: string | null;
  open: boolean;
  fixes: { count: number; items: { key: string; title: string; status: string }[] };
  clicks: { decisions: number; extra: number; estimated: boolean; by_decision: Partial<Record<DecisionControl, number>>; extra_by_control: { control: string; n: number }[] };
  heals: number;
  stops: { stop: ReportStop; ms: number | null; open: boolean }[];
  gap: { ms: number; from: string; to: string } | null;
  tokens: { agent: string; tokens: number; runs: number }[];
};

export const INFORME_WORDS = defineWords({
  es: {
    title: "Informe de la corrida",
    titleOpen: "Informe de la corrida, hasta ahora",
    fixes: (n: number) => (n === 0 ? "Plania no necesitó arreglos" : n === 1 ? "1 arreglo a Plania mientras corría" : `${n} arreglos a Plania mientras corría`),
    decisions: (n: number) => (n === 1 ? "1 decisión tuya" : `${n} decisiones tuyas`),
    extra: (n: number) => (n === 0 ? "ningún clic de más" : n === 1 ? "1 clic de más" : `${n} clics de más`),
    estimated: "contado de lo que ya quedó escrito, antes de que cada clic se anotara",
    heals: (n: number) => (n === 0 ? "Plania no tuvo que destrabar ningún turno" : n === 1 ? "Plania destrabó 1 turno sola" : `Plania destrabó ${n} turnos sola`),
    stopsTitle: "Tiempo por parada",
    stop: { entendido: "Entendido", investigacion: "Investigación", diseno: "Diseño", plan: "Plan", lista: "Esperando «Constrúyelo»", construccion: "Construcción", publicado: "Publicación" } as Record<ReportStop, string>,
    stopNone: "—",
    stopOpen: (t: string) => `${t}, sigue`,
    gap: (t: string) => `El rato más largo sin turno de nadie: ${t}`,
    noGap: "Siempre le tocó a alguien",
    tokensTitle: "Tokens por agente",
    noTokens: "Ninguna corrida anotó tokens",
    runs: (n: number) => (n === 1 ? "1 corrida" : `${n} corridas`),
    control: {
      "ideas.despertar": "Despertar",
      "ideas.respuesta": "Deshacer una respuesta",
      "tasks.note": "Nota al equipo",
      "pedidos.guardar": "Guardar",
      "pedidos.restaurar": "Restaurar",
      "pedidos.descartar": "Descartar",
      "runs.stop": "Parar una corrida",
      "runs.resume": "Reanudar una corrida",
      "team.start": "Arrancar a alguien",
      "probador.tomar": "Tomar las fotos otra vez",
      "probador.preguntar": "Preguntar al Probador",
      "decisions.verificar": "Revisar otra vez",
      "decisions.despues": "Dejar para después",
      "decisions.aplazar": "Dejar para después",
      "decisions.cancelar": "Cancelar",
      "decisions.hecho": "Hecho",
      "decisions.empezar": "Empezar",
      "requests.resend": "Reenviar el pedido",
      "orders.cancel": "Cerrar el pedido",
      next: "Elegir lo siguiente",
      switch: "Pausar o seguir",
      tasks: "Mover un paso",
      "tasks.release": "Soltar un paso",
      "tasks.checks.waive": "Saltar una revisión",
      "blockers.resolve": "Quitar un bloqueo",
      "release.recheck": "Revisar la publicación otra vez",
      "threads.messages": "Mensaje en un hilo",
      "threads.actions": "Botón en un hilo",
      "task.status": "Mover un paso",
      "note": "Nota al equipo",
      "idea.despertar": "Despertar",
    } as Record<string, string>,
    area: { maquinas: "Máquinas", captures: "Fotos", camino: "Camino", settings: "Ajustes", logo: "Marca", marca: "Marca", team: "Equipo", seats: "Equipo" } as Record<string, string>,
    other: "Otros botones",
  },
  en: {
    title: "Run report",
    titleOpen: "Run report, so far",
    fixes: (n: number) => (n === 0 ? "Plania needed no fixes" : n === 1 ? "1 Plania fix while it ran" : `${n} Plania fixes while it ran`),
    decisions: (n: number) => (n === 1 ? "1 decision of yours" : `${n} decisions of yours`),
    extra: (n: number) => (n === 0 ? "no extra clicks" : n === 1 ? "1 extra click" : `${n} extra clicks`),
    estimated: "counted from what was already written, before each click was recorded",
    heals: (n: number) => (n === 0 ? "Plania freed no stuck turn" : n === 1 ? "Plania freed 1 turn by itself" : `Plania freed ${n} turns by itself`),
    stopsTitle: "Time per stop",
    stop: { entendido: "Understood", investigacion: "Research", diseno: "Design", plan: "Plan", lista: "Waiting for «Build it»", construccion: "Building", publicado: "Publishing" } as Record<ReportStop, string>,
    stopNone: "—",
    stopOpen: (t: string) => `${t}, still going`,
    gap: (t: string) => `Longest stretch with nobody's turn: ${t}`,
    noGap: "It was always somebody's turn",
    tokensTitle: "Tokens per agent",
    noTokens: "No run recorded tokens",
    runs: (n: number) => (n === 1 ? "1 run" : `${n} runs`),
    control: {
      "ideas.despertar": "Wake up",
      "ideas.respuesta": "Undo an answer",
      "tasks.note": "Note to the team",
      "pedidos.guardar": "Save",
      "pedidos.restaurar": "Restore",
      "pedidos.descartar": "Discard",
      "runs.stop": "Stop a run",
      "runs.resume": "Resume a run",
      "team.start": "Start someone",
      "probador.tomar": "Take the photos again",
      "probador.preguntar": "Ask the Tester",
      "decisions.verificar": "Check again",
      "decisions.despues": "Leave for later",
      "decisions.aplazar": "Leave for later",
      "decisions.cancelar": "Cancel",
      "decisions.hecho": "Done",
      "decisions.empezar": "Start",
      "requests.resend": "Send the request again",
      "orders.cancel": "Close the request",
      next: "Pick the next one",
      switch: "Pause or go on",
      tasks: "Move a step",
      "tasks.release": "Release a step",
      "tasks.checks.waive": "Skip a check",
      "blockers.resolve": "Remove a blocker",
      "release.recheck": "Check the release again",
      "threads.messages": "Message in a thread",
      "threads.actions": "Button in a thread",
      "task.status": "Move a step",
      "note": "Note to the team",
      "idea.despertar": "Wake up",
    } as Record<string, string>,
    area: { maquinas: "Machines", captures: "Photos", camino: "Path", settings: "Settings", logo: "Brand", marca: "Brand", team: "Team", seats: "Team" } as Record<string, string>,
    other: "Other buttons",
  },
});
const w = () => words(INFORME_WORDS);

/** A control's name for the owner: the button's own, else its area's, else «Otros botones». */
export function controlName(control: string): string {
  const x = w();
  return x.control[control] ?? x.area[control.split(".")[0] ?? ""] ?? x.other;
}

/** 1,2 M · 340 k · 900 */
export function tokensText(n: number): string {
  if (n >= 1_000_000) return `${(Math.round(n / 100_000) / 10).toLocaleString("es")} M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} k`;
  return String(n);
}

export type InformeView = {
  title: string;
  fixes: string;
  fixItems: string[];
  clicks: string;
  estimated: string | null;
  extra: { label: string; n: number }[];
  heals: string;
  stopsTitle: string;
  stops: { label: string; text: string }[];
  gap: string;
  tokensTitle: string;
  tokens: { agent: string; text: string }[];
  noTokens: string;
} | null;

export function informeView(r: RunReport | null | undefined): InformeView {
  if (!r) return null;
  const x = w();
  // Extra clicks by the name he knows; two controls with one name are one row.
  const extra = new Map<string, number>();
  for (const c of r.clicks.extra_by_control) extra.set(controlName(c.control), (extra.get(controlName(c.control)) ?? 0) + c.n);
  return {
    title: r.open ? x.titleOpen : x.title,
    fixes: x.fixes(r.fixes.count),
    fixItems: r.fixes.items.map((f) => f.title),
    clicks: `${x.decisions(r.clicks.decisions)} · ${x.extra(r.clicks.extra)}`,
    estimated: r.clicks.estimated && r.clicks.decisions + r.clicks.extra > 0 ? x.estimated : null,
    extra: [...extra].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)),
    heals: x.heals(r.heals),
    stopsTitle: x.stopsTitle,
    stops: r.stops.map((s) => ({ label: x.stop[s.stop], text: s.ms === null ? x.stopNone : s.open ? x.stopOpen(duracion(s.ms)) : duracion(s.ms) })),
    gap: r.gap && r.gap.ms > 0 ? x.gap(duracion(r.gap.ms)) : x.noGap,
    tokensTitle: x.tokensTitle,
    tokens: r.tokens.map((t) => ({ agent: t.agent, text: `${tokensText(t.tokens)} · ${x.runs(t.runs)}` })),
    noTokens: x.noTokens,
  };
}
