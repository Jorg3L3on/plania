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
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type StationId = "por" | "taller" | "qa" | "rev" | "toca" | "hecho";
export type StageTone = "pending" | "ready" | "blocked" | "now" | "review" | "owner" | "done";
export type Station = { id: StationId; name: string; who: string; verb: string; on: string; role: string | null };

// PLA-I2-10: the board's words in both languages. The Spanish constants (STATIONS, ETAPA_WORD, ACT_LABEL) stay for
// callers that read them; the functions take the language last.
type StationWords = { name: string; who?: string; verb: string; on?: string };
export const ETAPAS_WORDS = defineWords({
  es: {
    stations: {
      por: { name: "Por hacer", who: "PO", verb: "coordina", on: "ordena" },
      taller: { name: "Taller", who: "Taller", verb: "construye", on: "trabajando" },
      qa: { name: "QA", who: "QA", verb: "prueba", on: "probando" },
      rev: { name: "Revisión", who: "Revisor", verb: "PR y pruebas", on: "revisando" },
      toca: { name: "Te toca", who: "Tú", verb: "apruebas o devuelves", on: "te espera" },
      hecho: { name: "Hecho", verb: "integrado y publicado" },
    } as Record<StationId, StationWords>,
    qaRunning: "En QA · probando",
    qaQueued: "En QA · en cola",
    backWaiting: "Devuelto · espera arreglo",
    initiative: { Planning: "Planeando", Active: "Activa", Shipping: "Saliendo", "On hold": "En pausa", Done: "Hecha", "Won't do": "Descartada" } as Record<string, string>,
    wontDo: "Descartado",
    roles: { "product-owner": "PO", taller: "Taller", qa: "QA", research: "Research", artist: "Artist", ceo: "Tú", copy: "Copy", asistente: "Asistente" } as Record<string, string>,
    ci: { success: "pruebas en verde", failure: "pruebas en rojo", pending: "pruebas corriendo" } as Record<Exclude<EtapaCi, "none">, string>,
    loose: "Sueltos",
    readyToClose: "lista para cerrar",
    toRelease: (n: number) => `${n} por lanzar`,
    toClose: (n: number) => `${n} por cerrar`,
    of: (done: number, total: number) => `${done} de ${total}`,
    noInitiative: "sin iniciativa",
    onHold: "en pausa",
    acts: { primero: "Hacer primero", detener: "Detener", aceptar: "Aprobar", quitar: "Quitar" } as Record<CardAct["kind"], string>,
  },
  en: {
    stations: {
      por: { name: "To do", who: "PO", verb: "coordinates", on: "ordering" },
      taller: { name: "Taller", who: "Taller", verb: "builds", on: "working" },
      qa: { name: "QA", who: "QA", verb: "tests", on: "testing" },
      rev: { name: "Review", who: "Reviewer", verb: "PR and tests", on: "reviewing" },
      toca: { name: "Your turn", who: "You", verb: "approve or send back", on: "waiting for you" },
      hecho: { name: "Done", verb: "merged and published" },
    },
    qaRunning: "In QA · testing",
    qaQueued: "In QA · queued",
    backWaiting: "Sent back · waiting for a fix",
    initiative: { Planning: "Planning", Active: "Active", Shipping: "Shipping", "On hold": "On hold", Done: "Done", "Won't do": "Dropped" },
    wontDo: "Dropped",
    roles: { "product-owner": "PO", taller: "Taller", qa: "QA", research: "Research", artist: "Artist", ceo: "You", copy: "Copy", asistente: "Asistente" },
    ci: { success: "tests green", failure: "tests red", pending: "tests running" },
    loose: "Loose",
    readyToClose: "ready to close",
    toRelease: (n: number) => `${n} to release`,
    toClose: (n: number) => `${n} to close`,
    of: (done: number, total: number) => `${done} of ${total}`,
    noInitiative: "no initiative",
    onHold: "on hold",
    acts: { primero: "Do first", detener: "Stop", aceptar: "Approve", quitar: "Remove" },
  },
});

const STATION_ROLE: Record<StationId, string | null> = { por: "product-owner", taller: "taller", qa: "qa", rev: null, toca: null, hecho: null };
const STATION_IDS: readonly StationId[] = ["por", "taller", "qa", "rev", "toca", "hecho"];
/** The stations in the given language. */
export function stationsOf(language: Language = getLanguage()): Station[] {
  const w = words(ETAPAS_WORDS, language).stations;
  return STATION_IDS.map((id) => ({ id, name: w[id].name, who: w[id].who ?? "", verb: w[id].verb, on: w[id].on ?? "", role: STATION_ROLE[id] }));
}
export const openStationsOf = (language: Language = getLanguage()): Station[] => stationsOf(language).filter((s) => s.id !== "hecho");
export const STATIONS: readonly Station[] = stationsOf("es");
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
  te_toca: "owner",
  integrado: "done",
  publicado: "done",
  hecho: "done",
};
export const ETAPA_WORDS = defineWords({
  es: {
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
  } as Record<EtapaId, string>,
  en: {
    despues: "Later",
    lista: "Ready to start",
    en_espera: "Waiting",
    pospuesto: "Postponed on purpose",
    bloqueado: "Blocked",
    construyendo: "Building",
    devuelto: "Sent back · fixing",
    sin_dueno: "No owner",
    en_qa: "In QA · testing",
    en_revision: "In review",
    te_toca: "Your turn",
    integrado: "Merged",
    publicado: "Published",
    hecho: "Done",
  },
});
/** The Spanish stage words, for callers that read the constant; etapaWord() follows the screen's language. */
export const ETAPA_WORD = ETAPA_WORDS.es;
export const etapaWord = (e: EtapaId, language: Language = getLanguage()): string => words(ETAPA_WORDS, language)[e];

export const columnOf = (e: Pick<Etapa, "etapa">): StationId => COLUMN[e.etapa] ?? "por";
export function toneOf(e: Etapa): StageTone {
  if (e.etapa === "en_qa" && e.qa !== "running") return "pending";
  return ETAPA_TONE[e.etapa] ?? "pending";
}
// The word on the card. Devuelto says «arreglando» only while someone is on it; QA says whether it runs or waits.
export function wordOf(e: Etapa, language: Language = getLanguage()): string {
  const w = words(ETAPAS_WORDS, language);
  if (e.etapa === "en_qa") return e.qa === "running" ? w.qaRunning : w.qaQueued;
  if (e.etapa === "devuelto" && !e.live) return w.backWaiting;
  return words(ETAPA_WORDS, language)[e.etapa] ?? e.etapa;
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
  "Needs owner": "te_toca",
  Done: "hecho",
};
export const statusEtapa = (status: string): EtapaId | null => STATUS_ETAPA[status] ?? null;
// An initiative's own status is not a stage: these are its words.
export const initiativeWord = (status: string, language: Language = getLanguage()) => words(ETAPAS_WORDS, language).initiative[status] ?? status;
// A ticket status in words, from the stage map: «En revisión», «Integrado», «Te toca»… Won't do is «Descartado».
export function statusWord(status: string, language: Language = getLanguage()): string {
  const e = statusEtapa(status);
  return e ? words(ETAPA_WORDS, language)[e] : status === "Won't do" ? words(ETAPAS_WORDS, language).wontDo : status;
}
export const statusStageTone = (status: string): StageTone | null => {
  const e = statusEtapa(status);
  return e ? ETAPA_TONE[e] : null;
};
export const isDone = (e: Etapa) => columnOf(e) === "hecho";

export const holderWord = (h: EtapaHolder | null, language: Language = getLanguage()): string | null => (h ? (words(ETAPAS_WORDS, language).roles[h.role] ?? h.agent) : null);
export const ciWord = (ci: EtapaCi | null, language: Language = getLanguage()): string | null => (ci && ci !== "none" ? words(ETAPAS_WORDS, language).ci[ci] : null);
export const ciTone = (ci: EtapaCi | null): "ok" | "bad" | "wait" | null => (ci === "success" ? "ok" : ci === "failure" ? "bad" : ci === "pending" ? "wait" : null);

// «Taller · hace 12 min»: who has it and since when; only while it is held by someone.
export function whoLine(e: Etapa, now: number, language: Language = getLanguage()): string | null {
  const who = holderWord(e.holder, language);
  if (!who) return null;
  return e.since ? `${who} · ${ago(e.since, now, language)}` : who;
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
  // PLA-I56-2: of the landed (done), how many are closed (Done); the rest shipped and wait: Merged on the test copy
  // (por lanzar), Released and held by a check (por cerrar). canClose: every ticket is Done, Cerrar is accepted.
  closed: number;
  shipped: { merged: number; released: number };
  canClose: boolean;
  version: number | null;
};
export type Board = { tracks: Track[]; lit: Partial<Record<StationId, StageTone>>; tickets: number };

const emptyCells = (): TrackCells => ({ por: [], taller: [], qa: [], rev: [], toca: [] });
const newestFirst = (a: ProjectTicket, b: ProjectTicket) => Date.parse(b.etapa.since ?? "0") - Date.parse(a.etapa.since ?? "0");

type CloseFacts = { closed?: number; can_close?: boolean; version?: number };
function trackOf(key: string | null, title: string, status: string | null, tickets: ProjectTicket[], done: number, total: number, close: CloseFacts = {}): Track {
  const cells = emptyCells();
  const landed: ProjectTicket[] = [];
  for (const t of tickets) {
    const col = columnOf(t.etapa);
    if (col === "hecho") landed.push(t);
    else cells[col].push(t);
  }
  landed.sort(newestFirst);
  // An older read without closed: landed counts as closed, as before.
  const split = close.closed !== undefined;
  const shipped = split ? { merged: landed.filter((t) => t.status === "Merged").length, released: landed.filter((t) => t.status === "Released").length } : { merged: 0, released: 0 };
  return {
    key,
    title,
    status,
    done,
    total,
    cells,
    hecho: { count: Math.max(done, landed.length), last: landed[0]?.title ?? null, tickets: landed },
    closed: split ? Math.min(close.closed!, done) : done,
    shipped,
    canClose: !!close.can_close && !!key && total > 0,
    version: close.version ?? null,
  };
}

// Which windows are lit, and in what colour: QA or Taller at work (now), a returned ticket being fixed (review), an
// item waiting on the owner (owner). The first live ticket of a station gives its colour, building before fixing.
const LIT_ORDER: StageTone[] = ["now", "review", "owner"];
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
export function boardOf(t: Tablero, opts: { sueltos?: boolean } = {}, language: Language = getLanguage()): Board {
  const tracks = t.initiatives.map((i) => trackOf(i.key, i.title, i.status, i.tickets, i.done, i.total, { closed: i.closed, can_close: i.can_close, version: i.version }));
  if (t.loose.length > 0 || t.loose_done > 0 || opts.sueltos) {
    const open = t.loose.filter((x) => !isDone(x.etapa)).length;
    const sueltos = trackOf(null, words(ETAPAS_WORDS, language).loose, null, t.loose, t.loose_done, t.loose_done + open);
    // The landed loose tickets are not in the read, only their count and the newest one's title (PLA-I53-6).
    if (!sueltos.hecho.last && t.loose_done > 0) sueltos.hecho.last = t.loose_done_title ?? null;
    tracks.push(sueltos);
  }
  const all = [...t.initiatives.flatMap((i) => i.tickets), ...t.loose];
  return { tracks, lit: litOf(all), tickets: all.length };
}

// PLA-I56-2: what is left between landed and closed, in words: «lista para cerrar» once every step is Done,
// else «2 por lanzar» (merged on the test copy) and «1 por cerrar» (released, held by a check). null: nothing.
export function closeLine(tr: Track, language: Language = getLanguage()): string | null {
  const w = words(ETAPAS_WORDS, language);
  if (!tr.key) return null;
  if (tr.canClose) return w.readyToClose;
  const parts = [tr.shipped.merged ? w.toRelease(tr.shipped.merged) : null, tr.shipped.released ? w.toClose(tr.shipped.released) : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// «2 de 5», «2 de 5 · en pausa», «4 de 4 · lista para cerrar», «4 de 4 · 3 por lanzar», «sin iniciativa».
export function trackLine(tr: Track, language: Language = getLanguage()): string {
  const w = words(ETAPAS_WORDS, language);
  if (!tr.key) return tr.total > 0 ? `${w.of(tr.done, tr.total)} · ${w.noInitiative}` : w.noInitiative;
  const close = closeLine(tr, language);
  return [w.of(tr.done, tr.total), tr.status === "On hold" ? w.onHold : null, close].filter(Boolean).join(" · ");
}
// PLA-I56-2: the share that is closed (Done), apart from trackPct (landed).
export const closedPct = (tr: Track) => (tr.total > 0 ? Math.round((100 * tr.closed) / tr.total) : 0);
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
export const ACT_LABEL: Record<CardAct["kind"], string> = ETAPAS_WORDS.es.acts;
// PLA-42: a delivery's Aprobar names its effect and the delivery (lib/evidencia.ts acceptWords).
export const actLabel = (a: CardAct, language: Language = getLanguage()) => (a.kind === "aceptar" ? acceptWords(a.decision, {}, language).label : words(ETAPAS_WORDS, language).acts[a.kind]);
export const actAria = (a: CardAct, title: string, language: Language = getLanguage()) =>
  a.kind === "aceptar" ? acceptWords({ ...a.decision, title: a.decision.title || title }, {}, language).aria : `${words(ETAPAS_WORDS, language).acts[a.kind]}: ${title}`;
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
