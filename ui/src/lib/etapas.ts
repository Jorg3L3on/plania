// PLA-I53-3: the stage board (Design doc of PLA-I53). The server gives every ticket one stage (src/api/etapa.ts);
// this file only places it: which station (column) it stands at, the word on its card, its colour, and which
// station windows are lit. Pure; components/plan/stage-board.tsx draws it, the floor and (F5) the project page.
//   Stations  Por hacer (PO) · Taller · QA · Revisión · Te toca (the owner) · Hecho
//   Tracks    one per open initiative, in the server's order, then Sueltos (tickets under no open initiative)
//   Lit       a station is lit while someone works a ticket there (live), or, for Te toca, while something waits on
//             the owner; its colour is the stage's. The window and the cards read the same field, so they agree.
import type { Decision, Etapa, EtapaCi, EtapaHolder, EtapaId, OrgMember, ProjectTicket, Tablero } from "./api";
import { acceptWords } from "./evidencia";
import { ago } from "./time";

export type StationId = "por" | "taller" | "qa" | "rev" | "toca" | "hecho";
export type StageTone = "pending" | "ready" | "blocked" | "now" | "review" | "jorge" | "done";
export type Station = { id: StationId; name: string; who: string; verb: string; on: string; role: string | null };

export const STATIONS: readonly Station[] = [
  { id: "por", name: "Por hacer", who: "PO", verb: "coordina", on: "ordena", role: "product-owner" },
  { id: "taller", name: "Taller", who: "Taller", verb: "construye", on: "trabajando", role: "taller" },
  { id: "qa", name: "QA", who: "QA", verb: "prueba", on: "probando", role: "qa" },
  { id: "rev", name: "Revisión", who: "Revisor", verb: "PR y pruebas", on: "revisando", role: null },
  { id: "toca", name: "Te toca", who: "Tú", verb: "apruebas o devuelves", on: "te espera", role: null },
  { id: "hecho", name: "Hecho", who: "", verb: "integrado y publicado", on: "", role: null },
];
export const OPEN_STATIONS = STATIONS.filter((s) => s.id !== "hecho");

const COLUMN: Record<EtapaId, StationId> = {
  despues: "por",
  lista: "por",
  en_espera: "por",
  pospuesto: "por",
  bloqueado: "por",
  construyendo: "taller",
  devuelto: "taller",
  sin_dueno: "taller",
  en_qa: "qa",
  en_revision: "rev",
  te_toca: "toca",
  integrado: "hecho",
  publicado: "hecho",
  hecho: "hecho",
};
// PLA-I53-5: the app's one map of stage to word and tone. Every other status word (the Lista view, Líneas de trabajo,
// the seats' last ticket, the floor's band) reads it through statusEtapa / statusWord below.
export const ETAPA_TONE: Record<EtapaId, StageTone> = {
  despues: "pending",
  lista: "ready",
  en_espera: "pending",
  pospuesto: "pending",
  bloqueado: "blocked",
  construyendo: "now",
  devuelto: "review",
  sin_dueno: "blocked",
  en_qa: "now",
  en_revision: "review",
  te_toca: "jorge",
  integrado: "done",
  publicado: "done",
  hecho: "done",
};
export const ETAPA_WORD: Record<EtapaId, string> = {
  despues: "Después",
  lista: "Lista para empezar",
  en_espera: "En espera",
  pospuesto: "Pospuesto a propósito",
  bloqueado: "Bloqueado",
  construyendo: "Construyendo",
  devuelto: "Devuelto · arreglando",
  sin_dueno: "Sin dueño",
  en_qa: "En QA · probando",
  en_revision: "En revisión",
  te_toca: "Te toca",
  integrado: "Integrado",
  publicado: "Publicado",
  hecho: "Hecho",
};

export const columnOf = (e: Pick<Etapa, "etapa">): StationId => COLUMN[e.etapa] ?? "por";
export function toneOf(e: Etapa): StageTone {
  if (e.etapa === "en_qa" && e.qa !== "running") return "pending";
  return ETAPA_TONE[e.etapa] ?? "pending";
}
// The word on the card. Devuelto says «arreglando» only while someone is on it; QA says whether it runs or waits.
export function wordOf(e: Etapa): string {
  if (e.etapa === "en_qa") return e.qa === "running" ? "En QA · probando" : "En QA · en cola";
  if (e.etapa === "devuelto" && !e.live) return "Devuelto · espera arreglo";
  return ETAPA_WORD[e.etapa] ?? e.etapa;
}

// A stored status read as a stage, where only the status is known (no lease, run, QA or PR facts): the coarse stage
// of a ticket in that status. Won't do has none.
const STATUS_ETAPA: Record<string, EtapaId> = {
  Backlog: "despues",
  Ready: "lista",
  "In progress": "construyendo",
  "In review": "en_revision",
  Merged: "integrado",
  Released: "publicado",
  Blocked: "bloqueado",
  "Needs Jorge": "te_toca",
  Done: "hecho",
};
export const statusEtapa = (status: string): EtapaId | null => STATUS_ETAPA[status] ?? null;
// An initiative's own status is not a stage: these are its words.
const INITIATIVE_WORD: Record<string, string> = { Planning: "Planeando", Active: "Activa", Shipping: "Saliendo", "On hold": "En pausa", Done: "Hecha", "Won't do": "Descartada" };
export const initiativeWord = (status: string) => INITIATIVE_WORD[status] ?? status;
// A ticket status in words, from the stage map: «En revisión», «Integrado», «Te toca»… Won't do is «Descartado».
export function statusWord(status: string): string {
  const e = statusEtapa(status);
  return e ? ETAPA_WORD[e] : status === "Won't do" ? "Descartado" : status;
}
export const statusStageTone = (status: string): StageTone | null => {
  const e = statusEtapa(status);
  return e ? ETAPA_TONE[e] : null;
};
export const isDone = (e: Etapa) => columnOf(e) === "hecho";

const ROLE_WORD: Record<string, string> = { "product-owner": "PO", taller: "Taller", qa: "QA", research: "Research", artist: "Artist", ceo: "Tú", copy: "Copy", asistente: "Asistente" };
export const holderWord = (h: EtapaHolder | null): string | null => (h ? (ROLE_WORD[h.role] ?? h.agent) : null);
const CI_WORD: Record<Exclude<EtapaCi, "none">, string> = { success: "pruebas en verde", failure: "pruebas en rojo", pending: "pruebas corriendo" };
export const ciWord = (ci: EtapaCi | null): string | null => (ci && ci !== "none" ? CI_WORD[ci] : null);
export const ciTone = (ci: EtapaCi | null): "ok" | "bad" | "wait" | null => (ci === "success" ? "ok" : ci === "failure" ? "bad" : ci === "pending" ? "wait" : null);

// «Taller · hace 12 min»: who has it and since when; only while it is held by someone.
export function whoLine(e: Etapa, now: number): string | null {
  const who = holderWord(e.holder);
  if (!who) return null;
  return e.since ? `${who} · ${ago(e.since, now)}` : who;
}

export type TrackCells = Record<Exclude<StationId, "hecho">, ProjectTicket[]>;
export type Track = {
  // The initiative's key; null is Sueltos.
  key: string | null;
  title: string;
  status: string | null;
  done: number;
  total: number;
  cells: TrackCells;
  // Hecho folds into one stack: how many, and the newest one's title when the read carries it.
  hecho: { count: number; last: string | null; tickets: ProjectTicket[] };
};
export type Board = { tracks: Track[]; lit: Partial<Record<StationId, StageTone>>; tickets: number };

const emptyCells = (): TrackCells => ({ por: [], taller: [], qa: [], rev: [], toca: [] });
const newestFirst = (a: ProjectTicket, b: ProjectTicket) => Date.parse(b.etapa.since ?? "0") - Date.parse(a.etapa.since ?? "0");

function trackOf(key: string | null, title: string, status: string | null, tickets: ProjectTicket[], done: number, total: number): Track {
  const cells = emptyCells();
  const landed: ProjectTicket[] = [];
  for (const t of tickets) {
    const col = columnOf(t.etapa);
    if (col === "hecho") landed.push(t);
    else cells[col].push(t);
  }
  landed.sort(newestFirst);
  return { key, title, status, done, total, cells, hecho: { count: Math.max(done, landed.length), last: landed[0]?.title ?? null, tickets: landed } };
}

// Which windows are lit, and in what colour: QA or Taller at work (now), a returned ticket being fixed (review), an
// item waiting on the owner (jorge). The first live ticket of a station gives its colour, building before fixing.
const LIT_ORDER: StageTone[] = ["now", "review", "jorge"];
export function litOf(tickets: ProjectTicket[]): Partial<Record<StationId, StageTone>> {
  const lit: Partial<Record<StationId, StageTone>> = {};
  for (const t of tickets) {
    const on = t.etapa.live || t.etapa.etapa === "te_toca";
    if (!on) continue;
    const col = columnOf(t.etapa);
    const tone = toneOf(t.etapa);
    const had = lit[col];
    if (!had || LIT_ORDER.indexOf(tone) < LIT_ORDER.indexOf(had)) lit[col] = tone;
  }
  return lit;
}

// sueltos: draw the Sueltos track even when it holds no ticket (the page has cards of its own to put there).
export function boardOf(t: Tablero, opts: { sueltos?: boolean } = {}): Board {
  const tracks = t.initiatives.map((i) => trackOf(i.key, i.title, i.status, i.tickets, i.done, i.total));
  if (t.loose.length > 0 || t.loose_done > 0 || opts.sueltos) {
    const open = t.loose.filter((x) => !isDone(x.etapa)).length;
    const sueltos = trackOf(null, "Sueltos", null, t.loose, t.loose_done, t.loose_done + open);
    // The landed loose tickets are not in the read, only their count and the newest one's title (PLA-I53-6).
    if (!sueltos.hecho.last && t.loose_done > 0) sueltos.hecho.last = t.loose_done_title ?? null;
    tracks.push(sueltos);
  }
  const all = [...t.initiatives.flatMap((i) => i.tickets), ...t.loose];
  return { tracks, lit: litOf(all), tickets: all.length };
}

// «2 de 5», «2 de 5 · en pausa», «sin iniciativa».
export function trackLine(tr: Track): string {
  if (!tr.key) return tr.total > 0 ? `${tr.done} de ${tr.total} · sin iniciativa` : "sin iniciativa";
  return tr.status === "On hold" ? `${tr.done} de ${tr.total} · en pausa` : `${tr.done} de ${tr.total}`;
}
export const trackPct = (tr: Track) => (tr.total > 0 ? Math.round((100 * tr.done) / tr.total) : 0);

// The verb line under a station: «Taller · trabajando» while lit, else «Taller construye».
export function stationLine(s: Station, lit: boolean): string {
  if (lit && s.on) return s.who ? `${s.who} · ${s.on}` : s.on;
  return s.who ? `${s.who} ${s.verb}` : s.verb;
}

// ---- what the owner can do from a card (the calls La fila had)

// The delivery decision that carries this ticket, if one waits on the owner.
export function deliveryFor(key: string, decisions: Decision[]): Decision | null {
  return decisions.find((d) => d.state === null && d.actions.some((a) => a === "fusionar" || a === "aceptar") && (d.ref === key || (d.links ?? []).some((l) => l.kind === "ticket" && l.ref === key))) ?? null;
}
// The run working on this ticket now, from the seats (the only read that carries a run id).
export const runOn = (key: string, team: OrgMember[]): string | null => team.find((m) => m.state === "running" && m.now?.ticket === key)?.now?.run_id ?? null;

export type CardAct = { kind: "primero"; key: string } | { kind: "detener"; runId: string } | { kind: "aceptar"; decision: Decision; action: "fusionar" | "aceptar" } | { kind: "quitar"; key: string };
export const ACT_LABEL: Record<CardAct["kind"], string> = { primero: "Hacer primero", detener: "Detener", aceptar: "Aprobar", quitar: "Quitar" };
// PLA-42: a delivery's Aprobar names its effect and the delivery (lib/evidencia.ts acceptWords).
export const actLabel = (a: CardAct) => (a.kind === "aceptar" ? acceptWords(a.decision).label : ACT_LABEL[a.kind]);
export const actAria = (a: CardAct, title: string) => (a.kind === "aceptar" ? acceptWords({ ...a.decision, title: a.decision.title || title }).aria : `${ACT_LABEL[a.kind]}: ${title}`);
export const actBusyKey = (a: CardAct) => (a.kind === "primero" ? `next-${a.key}` : a.kind === "quitar" ? `cancel-${a.key}` : a.kind === "detener" ? a.runId : `accept-${a.decision.id}`);

// Detener on a ticket a run works on; Aceptar on a delivery that waits; Hacer primero on a ticket ready to start
// (it moves to the front of the runner's order); Quitar on the owner's own open order.
export function cardActs(t: ProjectTicket, ctx: { team: OrgMember[]; decisions: Decision[]; orders?: { key?: string | null; state: string; stage?: string | null }[]; nextFirst?: string | null }): CardAct[] {
  const acts: CardAct[] = [];
  const run = runOn(t.key, ctx.team);
  if (run) acts.push({ kind: "detener", runId: run });
  if (t.etapa.etapa === "te_toca") {
    const d = deliveryFor(t.key, ctx.decisions);
    const action = d?.actions.find((a): a is "fusionar" | "aceptar" => a === "fusionar" || a === "aceptar");
    if (d && action) acts.push({ kind: "aceptar", decision: d, action });
  }
  if (t.etapa.etapa === "lista" && ctx.nextFirst !== t.key) acts.push({ kind: "primero", key: t.key });
  const order = ctx.orders?.find((o) => o.key === t.key);
  if (order && OPEN_ORDER.has(order.state) && order.stage !== "cancelada") acts.push({ kind: "quitar", key: t.key });
  return acts;
}
export const OPEN_ORDER = new Set(["enviada", "entendida", "sin_tomar"]);
