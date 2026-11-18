// PLA-I65-2: the current's model and geometry, pure (no canvas, no DOM) so they can be tested.
// A thing (pedido, idea, initiative) is one current: thin at Buzón, one notch thicker for every stop that delivered,
// a dry bed where nothing came yet, a dam at «Constrúyelo» (closed, waiting on the owner, open), then one channel per
// step of the initiative that rejoins at Publicado. Nothing in it is decorative: the thickness is the number of
// deliveries, each channel is a real step, its colour is that step's state.
// Coordinates are logical: 1374 wide (the ficha in the sketch, PLA-IDEA27 pass 3); the component scales them.
import type { EtapaId, IdeaDetail, PedidoState, PedidoStop } from "@/lib/api";

export const STOP_IDS: PedidoStop[] = ["buzon", "entendido", "investigacion", "diseno", "plan", "lista"];
export const STOP_NAMES = ["Buzón", "Entendido", "Investigación", "Diseño", "Plan", "Lista"];

/** done: landed; you: waits on the owner; live: someone builds it now; todo: ahead; fin: published. */
export type Chan = "done" | "you" | "live" | "todo" | "fin";
export type Dam = "closed" | "wait" | "open";
export type RioModel = {
  // 0..5 a stop, 6 Construcción, 7 Publicado.
  here: number;
  // Which of the six stops delivered something (thickness).
  delivered: boolean[];
  dam: Dam;
  // The light at the front: the owner's turn, someone working, or nobody (in the queue, saved, quiet).
  front: "you" | "live" | "quiet";
  chans: Chan[];
  // Steps per drawn channel (more than MAX_CHANS steps are grouped).
  per: number;
  steps: { done: number; total: number };
};

export const W = 1374;
export const X0 = 26;
export const SX = (i: number) => 66 + i * 112;
export const VX = 768;
export const FX0 = 792;
export const CX0 = 862;
export const CX1 = 1188;
export const FX1 = 1258;
export const PX = 1300;
export const XE = 1350;
export const MAX_CHANS = 16;

const BASE = 2;
const NOTCH = 4;
const sm = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** Thickness after each stop: one notch per delivered stop up to it. */
export function widths(delivered: boolean[]): number[] {
  const out: number[] = [];
  let n = 0;
  for (let i = 0; i < 6; i++) {
    if (delivered[i]) n++;
    out.push(BASE + 1 + n * NOTCH);
  }
  return out;
}

/** The current's width at x (logical), easing up after each stop. */
export function widthAt(x: number, ws: number[]): number {
  let w = BASE;
  for (let i = 0; i < 6; i++) {
    const d = x - SX(i);
    if (d <= 0) break;
    const prev = i ? ws[i - 1]! : BASE;
    w = prev + (ws[i]! - prev) * sm(d / 46);
  }
  return w;
}

/** Where the water reaches: the stop it is at, the dam, or past it. */
export const frontOf = (m: Pick<RioModel, "here">) => (m.here <= 4 ? SX(m.here) : m.here === 5 ? VX - 7 : FX0);

/** A channel's vertical offset from the centre line (fanned out in the delta, joined at both ends). */
export function chanOffset(k: number, n: number, span = 92): number {
  const gap = Math.min(8, span / Math.max(1, n - 1));
  return (k - (n - 1) / 2) * gap;
}
export function chanPoint(k: number, n: number, s: number, cy: number, span = 92): [number, number] {
  const x = FX0 + s * (FX1 - FX0);
  const off = chanOffset(k, n, span);
  let e = 1;
  if (x < CX0) e = sm((x - FX0) / (CX0 - FX0));
  else if (x > CX1) e = sm((FX1 - x) / (FX1 - CX1));
  return [x, cy + off * e];
}

const LANDED_ETAPAS: EtapaId[] = ["integrado", "publicado", "hecho"];
const LIVE_ETAPAS: EtapaId[] = ["construyendo", "en_qa", "en_revision", "devuelto"];
export function chanOf(step: { status: string; etapa: EtapaId | null }, published: boolean): Chan {
  if (published) return "fin";
  if (["Merged", "Released", "Done"].includes(step.status) || (step.etapa && LANDED_ETAPAS.includes(step.etapa))) return "done";
  if (step.etapa === "te_toca") return "you";
  if (step.etapa && LIVE_ETAPAS.includes(step.etapa)) return "live";
  return "todo";
}

// A grouped channel takes its most urgent step: the owner's turn, then work, then what is left, then done.
const RANK: Record<Chan, number> = { you: 4, live: 3, todo: 2, done: 1, fin: 0 };
export function groupChans(list: Chan[], max = MAX_CHANS): { chans: Chan[]; per: number } {
  if (list.length <= max) return { chans: list, per: 1 };
  const per = Math.ceil(list.length / max);
  const out: Chan[] = [];
  for (let i = 0; i < list.length; i += per) {
    const g = list.slice(i, i + per);
    out.push(g.every((c) => c === "done") ? "done" : g.every((c) => c === "fin") ? "fin" : g.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)));
  }
  return { chans: out, per };
}

type Thing = Pick<IdeaDetail, "stop" | "state" | "guardada" | "stops" | "promoted_to" | "question"> & Partial<Pick<IdeaDetail, "built" | "plan_steps">>;

/** The model of a thing, from the idea read (PLA-I65-1). */
export function rioOf(d: Thing): RioModel {
  const built = d.built ?? null;
  const delivered = STOP_IDS.map((s) => d.stops.find((x) => x.stop === s)?.delivered ?? false);
  if (built) {
    const published = !!built.published_at;
    const list = built.steps.map((s) => chanOf(s, published));
    const { chans, per } = groupChans(list);
    const you = list.includes("you");
    const live = list.includes("live");
    return {
      here: published ? 7 : 6,
      delivered,
      dam: "open",
      front: you ? "you" : live ? "live" : "quiet",
      chans,
      per,
      steps: { done: list.filter((c) => c === "done" || c === "fin").length, total: list.length },
    };
  }
  const here = Math.max(0, STOP_IDS.indexOf(d.stop));
  const waits = !d.guardada && (d.state === "espera" || (d.stop === "lista" && d.state === "quieta"));
  const front: RioModel["front"] = waits ? "you" : !d.guardada && (d.state === "trabajando" || d.state === "valvula") ? "live" : "quiet";
  // Before it is built the delta is the plan's steps, dry (a dozen dry beds when there is no plan yet).
  const n = d.plan_steps?.length ?? 0;
  const { chans, per } = groupChans(Array.from({ length: n || 12 }, () => "todo" as Chan));
  return { here, delivered, dam: here === 5 && !d.guardada ? "wait" : "closed", front, chans, per, steps: { done: 0, total: n } };
}

const STATE_WORD: Record<RioModel["front"], string> = { you: "te toca", live: "alguien la trabaja", quiet: "nadie la trabaja ahora" };

/** What the drawing says, for role="img" (the canvas is never the only source of the state). */
export function rioLabel(m: RioModel): string {
  const where = m.here <= 5 ? `parada ${STOP_NAMES[m.here]}` : m.here === 6 ? "en construcción" : "publicada";
  const dam = m.dam === "wait" ? "; la presa «Constrúyelo» espera tu sí" : "";
  const steps = m.here >= 6 ? `; ${m.steps.done} de ${m.steps.total} pasos hechos` : m.steps.total ? `; ${m.steps.total} pasos en el plan` : "";
  return `Corriente: ${where}, ${m.here === 7 ? "nada pendiente" : STATE_WORD[m.front]}${dam}${steps}.`;
}

/** Whether anything moves: work in progress somewhere (never on a quiet or published thing). */
export const isAlive = (m: RioModel) => m.here !== 7 && (m.front !== "quiet" || m.dam === "wait" || m.chans.some((c) => c === "live" || c === "you"));

/** A closed row's model, from what the lists carry: where it is and how; once built, its initiative's steps. */
export function rioOfRow(x: { stop: PedidoStop; state: PedidoState; guardada: boolean }, init?: { steps: { status: string; etapa: EtapaId | null }[]; published: boolean } | null): RioModel {
  const here = STOP_IDS.indexOf(x.stop);
  const stops = STOP_IDS.map((stop, i) => ({ stop, delivered: i < here || (i === here && i < 5 && x.state !== "trabajando" && x.state !== "cola") || i === 0 }));
  return rioOf({ stop: x.stop, state: x.state, guardada: x.guardada, stops: stops as never, promoted_to: null, question: null, built: init ? { steps: init.steps, published_at: init.published ? "1" : null } as never : null });
}
