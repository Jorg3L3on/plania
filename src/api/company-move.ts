// PLA-I46-3: la siguiente jugada. One object per floor that says what is the owner's to do next, so Ahora, the Tú
// window, the roof chip, the sky line and the phone bar read the same thing and cannot disagree. Null when nothing
// on this floor waits on him: then no surface draws a green button.
//   verbo   the move's verb: aceptar, publicar, responder, fijar, arrancar, planear
//   texto   the one short sentence every surface shows («Planear «Ajustes finales y entrega»»)
//   accion  what the one button does, with its label
//   origen  where the move comes from (a decision, the light, a teammate's hold, the route)
// Pure: companyRead calls it once the decisions are read; test/compania-move.test.ts feeds it plain objects.
import type { Decision, DecisionAction } from "./company-decisions.js";

export type MoveVerb = "aceptar" | "publicar" | "responder" | "fijar" | "arrancar" | "planear" | "ver";
export type MoveAction =
  | { kind: "decision"; id: string; action: DecisionAction; label: string }
  | { kind: "reveal"; id: string | null; label: string }
  | { kind: "publish"; label: string }
  | { kind: "fijar"; label: string }
  | { kind: "plan"; text: string; label: string }
  | { kind: "start"; agent: string; label: string }
  | { kind: "link"; href: string; label: string };
export type MoveOrigin =
  | { kind: "decision"; id: string; decision: Decision["kind"] }
  | { kind: "light" }
  | { kind: "hold"; agent: string; hold: string }
  | { kind: "route"; leg: string };
export type NextMove = { verbo: MoveVerb; texto: string; accion: MoveAction; origen: MoveOrigin };

// The parts of a floor the move reads (a ProjectCard is one).
type Member = { agent: string; role: string; state: string; next_start: { key: string | null; title: string | null; hold: string } | null; queue?: { key: string }[] };
type Leg = { key: string; title: string; done: number; total: number; state: string };
export type MoveFloor = {
  slug: string;
  paused: boolean;
  light: string;
  light_reason: { text: string; action: { label: string; href: string } | null } | null;
  team: Member[];
  route: { legs: Leg[] } | null;
};

const ROLE: Record<string, string> = { "product-owner": "PO", po: "PO", research: "Research", artist: "Artist", taller: "Taller", qa: "QA", copy: "Copy", asistente: "Asistente" };
const who = (role: string | undefined) => (role ? (ROLE[role] ?? role.charAt(0).toUpperCase() + role.slice(1)) : "El equipo");
const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};
const q = (s: string | null | undefined, n = 70) => (s ? `«${clip(s, n)}»` : "lo siguiente");

// Same rule as the screen's Te toca (ui/src/lib/v2.ts pending).
// PLA-I46-11: a plan the owner left for later (Después) waits, but is not his move until he opens it again.
export const waitingPlan = (d: Pick<Decision, "state" | "kind" | "plan">) => d.state === null && d.kind === "plan" && !!d.plan?.later_at;
export const pendingDecision = (d: Pick<Decision, "state" | "actions" | "kind"> & { plan?: Decision["plan"] }) => d.state === null && !waitingPlan({ ...d, plan: d.plan ?? null }) && (d.actions.length > 0 || d.kind === "release");
// Actions a single click can take: no words and no choice.
const ONE_CLICK: Partial<Record<DecisionAction, string>> = { aceptar: "Aceptar", fusionar: "Aceptar", empezar: "Sí, empiecen", hecho: "Ya lo hice" };
const HOLD_ORDER = ["no_goal", "waiting_owner", "unqueued"];

export const PLAN_LEG = (title: string) => `Planea «${title}»: sus pasos y qué significa hecho en cada uno.`;

export function nextMove(p: MoveFloor, decisions: Decision[], opts: { companyPaused?: boolean } = {}): NextMove | null {
  if (opts.companyPaused || p.paused || p.light === "paused") return null;

  // 1. A decision on this floor: a delivery or a question first, the publish last.
  const mine = decisions.filter((d) => d.project === p.slug && pendingDecision(d)).sort((a, b) => a.at.localeCompare(b.at));
  const d = mine.find((x) => x.kind !== "release") ?? mine[0];
  if (d) {
    const origen: MoveOrigin = { kind: "decision", id: d.id, decision: d.kind };
    if (d.kind === "release") {
      const n = d.release?.tickets?.length ?? 0;
      return { verbo: "publicar", texto: n === 1 ? "Publicar 1 cambio" : n > 1 ? `Publicar ${n} cambios` : "Publicar los cambios", accion: { kind: "publish", label: "Publicar" }, origen };
    }
    const first = d.actions.find((a) => ONE_CLICK[a]);
    const accion: MoveAction = first && !d.hold ? { kind: "decision", id: d.id, action: first, label: ONE_CLICK[first]! } : { kind: "reveal", id: d.id, label: "Ver y responder" };
    if (d.kind === "pr" || d.kind === "deliverable") return { verbo: "aceptar", texto: `Aceptar ${q(d.title)}`, accion, origen };
    if (d.kind === "plan" && d.plan?.leg) return { verbo: "aceptar", texto: `Aceptar el plan de ${q(d.plan.leg.title)}`, accion: { kind: "decision", id: d.id, action: "empezar", label: "Aceptar plan" }, origen };
    if (d.kind === "plan") return { verbo: "aceptar", texto: `Aceptar el plan ${q(d.title)}`, accion, origen };
    return { verbo: "responder", texto: `Responder a ${who(d.asker?.role)}: ${q(d.title, 60)}`, accion, origen };
  }

  // 2. The light says something is the owner's, without a decision behind it.
  if (p.light === "needs_jorge" && p.light_reason) {
    const href = p.light_reason.action?.href ?? "";
    if (href === "#publicar") return { verbo: "publicar", texto: clip(p.light_reason.text, 90), accion: { kind: "publish", label: "Publicar" }, origen: { kind: "light" } };
    if (p.light_reason.action) return { verbo: "ver", texto: clip(p.light_reason.text, 90), accion: { kind: "link", href, label: p.light_reason.action.label }, origen: { kind: "light" } };
  }

  // Anything running or about to start is the team's: only a hold that needs the owner is a move.
  const held = p.team
    .filter((m) => m.next_start && HOLD_ORDER.includes(m.next_start.hold))
    .sort((a, b) => HOLD_ORDER.indexOf(a.next_start!.hold) - HOLD_ORDER.indexOf(b.next_start!.hold))[0];
  const running = p.team.some((m) => m.state === "running");
  if (held && !running) {
    const n = held.next_start!;
    const origen: MoveOrigin = { kind: "hold", agent: held.agent, hold: n.hold };
    if (n.hold === "no_goal") return { verbo: "fijar", texto: "Fijar la meta del proyecto", accion: { kind: "fijar", label: "Fijar meta" }, origen };
    if (n.hold === "waiting_owner") return { verbo: "aceptar", texto: `Aceptar la entrega antes de ${q(n.title)}`, accion: { kind: "reveal", id: null, label: "Ver la entrega" }, origen };
    return { verbo: "arrancar", texto: `Arrancar ${q(n.title)}`, accion: { kind: "start", agent: held.agent, label: "Que empiece ya" }, origen };
  }

  // 3. The leg we stand on is complete and the next one has no steps: planning it is the owner's call.
  const busy = running || p.team.some((m) => m.next_start || (m.queue ?? []).length > 0);
  const legs = p.route?.legs ?? [];
  const at = legs.findIndex((l) => l.state === "here");
  const here = legs[at];
  if (!busy && here && here.total > 0 && here.done === here.total) {
    const after = legs.slice(at + 1).find((l) => l.state !== "done");
    // A plan for it that the owner left for later is waiting: asking the PO again would make a second one.
    const waiting = decisions.some((x) => x.project === p.slug && waitingPlan(x) && x.plan?.leg?.key === after?.key);
    if (after?.state === "unplanned" && !waiting) return { verbo: "planear", texto: `Planear ${q(after.title)}`, accion: { kind: "plan", text: PLAN_LEG(after.title), label: "Que PO lo planee" }, origen: { kind: "route", leg: after.key } };
  }
  return null;
}
