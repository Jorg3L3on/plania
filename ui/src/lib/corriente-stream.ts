// PLA-I62-2: the stream (board A1). One lane per project, seven columns by stage. Pure: test/i62-corriente-ui.test.ts
// calls it with fixtures. What goes where:
//   ideas      (GET /api/projects tasks, kind idea, open, not promoted) by stage: idea, research, design, planning,
//              ready → Idea, Investigación, Diseño, Plan, Lista.
//   pasos      the company read's board (tablero, each ticket's etapa) when it has one, else the ticket's status:
//              ready, waiting or blocked → Lista; building or sent back → Construcción; QA, review, te toca and
//              merged-not-published → Revisión. Published and done leave the stream; postponed ones are not drawn.
//              A paso that waits on a teammate or on publication is a grey dot.
//   agents     a teammate whose run is live (state running), on the column of what it works on.
//   te toca    each pending decision of the project, on the column of what it is about.
import type { Decision, OrgMember, OrgProject, ProjectTicket } from "./api";
import type { StreamSummary, StreamTask } from "./types";
import { pending } from "./v2";
import { seatName } from "./corriente";

export const COLUMNS = ["idea", "investigacion", "diseno", "plan", "lista", "construccion", "revision"] as const;
export type Column = (typeof COLUMNS)[number];
export const COLUMN_NAME: Record<Column, string> = {
  idea: "Idea",
  investigacion: "Investigación",
  diseno: "Diseño",
  plan: "Plan",
  lista: "Lista",
  construccion: "Construcción",
  revision: "Revisión",
};

const STAGE_COL: Record<string, Column> = { idea: "idea", research: "investigacion", design: "diseno", planning: "plan", ready: "lista" };
const ETAPA_COL: Record<string, Column | null> = {
  lista: "lista",
  en_espera: "lista",
  bloqueado: "lista",
  sin_dueno: "lista",
  construyendo: "construccion",
  devuelto: "construccion",
  en_qa: "revision",
  en_revision: "revision",
  te_toca: "revision",
  integrado: "revision",
  despues: null,
  pospuesto: null,
  publicado: null,
  hecho: null,
};
const STATUS_COL: Record<string, Column | null> = { Ready: "lista", Blocked: "lista", "In progress": "construccion", "In review": "revision", "Needs Jorge": "revision" };
const ROLE_COL: Record<string, Column> = { "product-owner": "plan", research: "investigacion", artist: "diseno", taller: "construccion", qa: "revision" };
const GREY_ETAPAS = new Set(["en_espera", "bloqueado", "integrado", "en_qa"]);
export const CLOSED = new Set(["Done", "Released", "Merged", "Won't do", "Cancelled"]);

export type Work = { key: string; title: string; grey: boolean };
export type LaneAgent = { agent: string; seat: string; key: string | null; doing: string; col: Column };
export type LaneYou = { decision: Decision; col: Column; verb: string };
export type Lane = {
  slug: string;
  title: string;
  paused: boolean;
  next: string | null;
  cells: Record<Column, Work[]>;
  agents: LaneAgent[];
  you: LaneYou[];
  /** Why nobody works here, when nobody does and the server says why. */
  idle: { text: string; action: { label: string; href: string } | null } | null;
  /** How fast its light moves: quick while someone works, slow when it is quiet, none when paused. */
  pace: "live" | "still" | "off";
};

const emptyCells = (): Record<Column, Work[]> => ({ idea: [], investigacion: [], diseno: [], plan: [], lista: [], construccion: [], revision: [] });

function ticketsOf(p: OrgProject): ProjectTicket[] {
  const t = p.tablero;
  if (!t) return [];
  return [...t.initiatives.flatMap((i) => i.tickets), ...t.loose];
}

/** The verb on a te toca rhombus: what the owner does there. */
export function youVerb(d: Decision): string {
  switch (d.kind) {
    case "deliverable":
    case "pr":
      return d.ref ? `Aceptar ${d.ref}` : "Aceptar";
    case "plan":
      return "Aprobar el plan";
    case "proposal":
      return "Elegir";
    case "question":
      return "Responder";
    case "step":
    case "action":
      return d.file_step ? "Revisar el archivo" : "Hacer un paso";
    case "release":
      return "Publicar";
  }
}

export function laneOf(p: OrgProject, summary: StreamSummary | undefined, decisions: Decision[], companyPaused = false): Lane {
  const cells = emptyCells();
  const where = new Map<string, Column>();
  // Ideas by stage.
  for (const t of summary?.tasks ?? []) {
    if (t.kind !== "idea" || t.status !== "Open" || t.promoted_to) continue;
    const col = STAGE_COL[t.stage ?? "idea"] ?? "idea";
    cells[col].push({ key: t.key, title: t.title, grey: false });
    where.set(t.key, col);
  }
  // Pasos: the board's stage when the company read has it, else the status.
  const board = ticketsOf(p);
  if (board.length) {
    for (const t of board) {
      const col = ETAPA_COL[t.etapa.etapa];
      if (!col) continue;
      cells[col].push({ key: t.key, title: t.title, grey: GREY_ETAPAS.has(t.etapa.etapa) });
      where.set(t.key, col);
    }
  } else {
    for (const t of summary?.tasks ?? ([] as StreamTask[])) {
      if (t.kind !== "ticket" || CLOSED.has(t.status)) continue;
      const col = STATUS_COL[t.status];
      if (!col) continue;
      cells[col].push({ key: t.key, title: t.title, grey: t.status === "Blocked" });
      where.set(t.key, col);
    }
  }
  const paused = p.paused || p.light === "paused";
  const live = !paused && !companyPaused;
  const agents: LaneAgent[] = live
    ? p.team
        .filter((m: OrgMember) => m.state === "running")
        .map((m) => {
          const key = m.now?.ticket ?? null;
          const col: Column = (key ? where.get(key) : undefined) ?? ROLE_COL[m.role] ?? "construccion";
          return { agent: m.agent, seat: seatName(m.role), key, doing: m.now?.title ?? "", col };
        })
    : [];
  const you: LaneYou[] = decisions
    .filter((d) => d.project === p.slug && pending(d))
    .map((d) => {
      const col: Column =
        d.kind === "deliverable" || d.kind === "pr" || d.kind === "release"
          ? "revision"
          : d.kind === "plan" || d.kind === "proposal"
            ? "plan"
            : d.kind === "question"
              ? ((d.ref ? where.get(d.ref) : undefined) ?? "plan")
              : ((d.ref ? where.get(d.ref) : undefined) ?? "construccion");
      return { decision: d, col, verb: youVerb(d) };
    });
  // Te toca already speaks for a project that waits on the owner.
  const idle = live && agents.length === 0 && p.light_reason && p.light !== "ok" && p.light !== "needs_jorge" && !you.length ? p.light_reason : null;
  return {
    slug: p.slug,
    title: p.title,
    paused,
    next: p.next?.key ?? null,
    cells,
    agents,
    you,
    idle,
    pace: !live ? "off" : agents.length ? "live" : "still",
  };
}

export type Totals = { revision: number; open: number; done: number };
/** The company's three totals, from the per-project counts that already arrive. */
export function totalsOf(projects: OrgProject[], summaries: StreamSummary[] | undefined): Totals {
  const all = summaries ?? [];
  return {
    revision: all.reduce((n, s) => n + revisionOf(s), 0),
    open: projects.reduce((n, p) => n + p.work.open, 0),
    done: all.reduce((n, s) => n + doneOf(s), 0),
  };
}

// PLA-74: the slim read brings the counts (closed tickets are not in it); a full row list is counted.
const tickets = (s: StreamSummary) => s.tasks.filter((t) => t.kind === "ticket");
export const doneOf = (s: StreamSummary): number => s.done ?? tickets(s).filter((t) => t.status === "Done" || t.status === "Released" || t.status === "Merged").length;
const revisionOf = (s: StreamSummary): number => s.revision ?? tickets(s).filter((t) => t.status === "In review").length;

const NUM = ["Ningún", "Un", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"];
const NUMF = ["Ninguna", "Una", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"];
const word = (n: number, fem: boolean) => (n <= 10 ? (fem ? NUMF : NUM)[n]! : String(n));

/** The headline: what moves now, then (amber) what waits on the owner. */
export function headlineOf(lanes: Lane[], decisions: Decision[], companyPaused: boolean): { now: string; you: string | null } {
  const working = lanes.reduce((n, l) => n + l.agents.length, 0);
  const now = companyPaused
    ? "La compañía está detenida."
    : working === 0
      ? "Nadie trabaja ahora."
      : `${word(working, false)} ${working === 1 ? "agente trabajando" : "agentes trabajando"}.`;
  const waiting = decisions.filter(pending);
  if (!waiting.length) return { now, you: null };
  const deliveries = waiting.filter((d) => d.kind === "deliverable" || d.kind === "pr").length;
  const n = waiting.length;
  if (deliveries === n) return { now, you: `${word(n, true)} ${n === 1 ? "entrega te espera" : "entregas te esperan"}.` };
  return { now, you: `${word(n, true)} ${n === 1 ? "cosa te espera" : "cosas te esperan"}.` };
}

/** Lanes stay put (by name) so the stream does not jump while it moves; paused projects go last. */
export function lanesOf(projects: OrgProject[], summaries: StreamSummary[] | undefined, decisions: Decision[], companyPaused = false): Lane[] {
  const bySlug = new Map((summaries ?? []).map((s) => [s.slug, s]));
  const lanes = projects.map((p) => laneOf(p, bySlug.get(p.slug), decisions, companyPaused));
  return lanes.sort((a, b) => Number(a.paused) - Number(b.paused) || a.title.localeCompare(b.title, "es"));
}

/** The project a key belongs to: the one whose tasks hold it, else the one whose keys share its prefix. */
export function projectOfKey(key: string, summaries: StreamSummary[] | undefined): string | null {
  const all = summaries ?? [];
  const exact = all.find((s) => s.tasks.some((t) => t.key === key));
  if (exact) return exact.slug;
  const prefix = key.split("-")[0];
  return all.find((s) => s.prefix === prefix || s.tasks.some((t) => t.key.split("-")[0] === prefix))?.slug ?? null;
}
