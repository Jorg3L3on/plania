// PLA-I46-3: la siguiente jugada. One object per floor that says what is the owner's to do next, so Ahora, the Tú
// window, the roof chip, the sky line and the phone bar read the same thing and cannot disagree. Null when nothing
// on this floor waits on him: then no surface draws a green button.
//   verbo   the move's verb: aceptar, publicar, responder, fijar, arrancar, planear
//   texto   the one short sentence every surface shows («Planear «Ajustes finales y entrega»»)
//   accion  what the one button does, with its label
//   origen  where the move comes from (a decision, the light, a teammate's hold, the route)
// Pure: companyRead calls it once the decisions are read; test/compania-move.test.ts feeds it plain objects.
import type { Decision, DecisionAction } from "./company-decisions.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: the next move's words in the install's language; the Spanish is unchanged.
// legTitleOf (src/mcp/proposals.ts) reads planLeg back in both languages.
export const MOVE_WORDS = defineWords({
  es: {
    team: "El equipo",
    next: "lo siguiente",
    oneClick: { aceptar: "Aprobar y cerrar", fusionar: "Aprobar y pasar a prueba", empezar: "Aprobar el plan", hecho: "Ya lo hice" } as Partial<Record<DecisionAction, string>>,
    planLeg: (title: string) => `Planea «${title}»: sus pasos y qué significa hecho en cada uno.`,
    publishN: (n: number) => (n === 1 ? "Publicar 1 cambio" : n > 1 ? `Publicar ${n} cambios` : "Publicar los cambios"),
    publish: "Publicar",
    seeAnswer: "Ver y responder",
    seeDelivery: "Ver la entrega",
    approve: (t: string) => `Aprobar ${t}`,
    approveLegPlan: (t: string) => `Aprobar el plan de ${t}`,
    approvePlanLabel: "Aprobar el plan",
    approvePlan: (t: string) => `Aprobar el plan ${t}`,
    answer: (who: string, t: string) => `Responder a ${who}: ${t}`,
    setGoal: "Fijar la meta del proyecto",
    setGoalLabel: "Fijar meta",
    approveBefore: (t: string) => `Aprobar la entrega antes de ${t}`,
    start: (t: string) => `Arrancar ${t}`,
    startNow: "Que empiece ya",
    plan: (t: string) => `Planear ${t}`,
    poPlans: "Que PO lo planee",
  },
  en: {
    team: "The team",
    next: "what comes next",
    oneClick: { aceptar: "Approve and close", fusionar: "Approve and send to testing", empezar: "Approve the plan", hecho: "I did it" } as Partial<Record<DecisionAction, string>>,
    planLeg: (title: string) => `Plan «${title}»: its steps and what done means in each.`,
    publishN: (n: number) => (n === 1 ? "Publish 1 change" : n > 1 ? `Publish ${n} changes` : "Publish the changes"),
    publish: "Publish",
    seeAnswer: "See and answer",
    seeDelivery: "See the delivery",
    approve: (t: string) => `Approve ${t}`,
    approveLegPlan: (t: string) => `Approve the plan for ${t}`,
    approvePlanLabel: "Approve the plan",
    approvePlan: (t: string) => `Approve the plan ${t}`,
    answer: (who: string, t: string) => `Answer ${who}: ${t}`,
    setGoal: "Set the project's goal",
    setGoalLabel: "Set goal",
    approveBefore: (t: string) => `Approve the delivery before ${t}`,
    start: (t: string) => `Start ${t}`,
    startNow: "Start now",
    plan: (t: string) => `Plan ${t}`,
    poPlans: "Have the PO plan it",
  },
});

export type MoveVerb = "aceptar" | "publicar" | "responder" | "fijar" | "arrancar" | "planear" | "ver";
export type MoveAction =
  | { kind: "decision"; id: string; action: DecisionAction; label: string }
  | { kind: "reveal"; id: string | null; label: string }
  | { kind: "publish"; label: string }
  | { kind: "fijar"; label: string }
  | { kind: "plan"; text: string; label: string }
  // PLA-165: key is the step the move names; «Que empiece ya» starts that one, never «whatever comes next».
  | { kind: "start"; agent: string; label: string; key?: string | null }
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
const who = (role: string | undefined) => (role ? (ROLE[role] ?? role.charAt(0).toUpperCase() + role.slice(1)) : say(MOVE_WORDS).team);
const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};
const q = (s: string | null | undefined, n = 70) => (s ? `«${clip(s, n)}»` : say(MOVE_WORDS).next);

// Same rule as the screen's Te toca (ui/src/lib/v2.ts pending).
// PLA-I46-11: a plan the owner left for later (Después) waits, but is not his move until he opens it again.
export const waitingPlan = (d: Pick<Decision, "state" | "kind" | "plan">) => d.state === null && d.kind === "plan" && !!d.plan?.later_at;
export const pendingDecision = (d: Pick<Decision, "state" | "actions" | "kind"> & { plan?: Decision["plan"] }) => d.state === null && !waitingPlan({ ...d, plan: d.plan ?? null }) && (d.actions.length > 0 || d.kind === "release");
// Actions a single click can take: no words and no choice.
// PLA-42: approving a delivery names its effect. With a PR it is merged into the test copy (sandbox, never main:
// src/api/thread-actions.ts); without one its ticket is closed (Hecho). Same words as ui/src/lib/evidencia.ts acceptWords.
// ONE_CLICK says which actions are one click; its words are MOVE_WORDS.oneClick.
const ONE_CLICK: Partial<Record<DecisionAction, true>> = { aceptar: true, fusionar: true, empezar: true, hecho: true };
export const withPr = (d: Pick<Decision, "kind"> & { links?: { kind: string }[] | null }) => d.kind === "pr" || (d.links ?? []).some((l) => l.kind === "pr");
const oneClick = (d: Decision, a: DecisionAction) => (a === "aceptar" || a === "fusionar" ? say(MOVE_WORDS).oneClick[withPr(d) ? "fusionar" : "aceptar"]! : say(MOVE_WORDS).oneClick[a]!);
const HOLD_ORDER = ["no_goal", "waiting_owner", "unqueued"];

// PLA-I46-10: a delivery sent back to Taller (Devolver a Taller, or QA's own return) that has not come back yet.
// While it stands, nothing on that floor is the owner's: no green button anywhere, Taller's window is violet.
export const returnedDelivery = <D extends Pick<Decision, "project" | "kind" | "state" | "ref" | "actions" | "plan" | "at">>(slug: string, decisions: D[]): D | null => {
  const open = new Set(decisions.filter((d) => d.project === slug && d.ref && pendingDecision(d)).map((d) => d.ref));
  return (
    decisions
      .filter((d) => d.project === slug && (d.kind === "pr" || d.kind === "deliverable") && d.state?.action === "cambios" && !(d.ref && open.has(d.ref)))
      .sort((a, b) => b.state!.at.localeCompare(a.state!.at))[0] ?? null
  );
};

// PLA-I2-10: in the install's language; legTitleOf (src/mcp/proposals.ts) reads both.
export const PLAN_LEG = (title: string) => say(MOVE_WORDS).planLeg(title);

export function nextMove(p: MoveFloor, decisions: Decision[], opts: { companyPaused?: boolean } = {}): NextMove | null {
  if (opts.companyPaused || p.paused || p.light === "paused") return null;

  // 1. A decision on this floor: a delivery or a question first, the publish last.
  const mine = decisions.filter((d) => d.project === p.slug && pendingDecision(d)).sort((a, b) => a.at.localeCompare(b.at));
  const d = mine.find((x) => x.kind !== "release") ?? mine[0];
  if (d) {
    const w = say(MOVE_WORDS);
    const origen: MoveOrigin = { kind: "decision", id: d.id, decision: d.kind };
    if (d.kind === "release") {
      const n = d.release?.tickets?.length ?? 0;
      return { verbo: "publicar", texto: w.publishN(n), accion: { kind: "publish", label: w.publish }, origen };
    }
    const first = d.actions.find((a) => ONE_CLICK[a]);
    const accion: MoveAction = first && !d.hold ? { kind: "decision", id: d.id, action: first, label: oneClick(d, first) } : { kind: "reveal", id: d.id, label: w.seeAnswer };
    // PLA-93 (guided test PLA-86, F-13): a delivery is never accepted from the floor. Its row opens the card, where the
    // before/after, the live copy and the checks are; Aceptar lives only there (PLA-IDEA18, no blind approvals).
    if (d.kind === "pr" || d.kind === "deliverable") return { verbo: "aceptar", texto: w.approve(q(d.title)), accion: { kind: "reveal", id: d.id, label: w.seeDelivery }, origen };
    if (d.kind === "plan" && d.plan?.leg) return { verbo: "aceptar", texto: w.approveLegPlan(q(d.plan.leg.title)), accion: { kind: "decision", id: d.id, action: "empezar", label: w.approvePlanLabel }, origen };
    if (d.kind === "plan") return { verbo: "aceptar", texto: w.approvePlan(q(d.title)), accion, origen };
    return { verbo: "responder", texto: w.answer(who(d.asker?.role), q(d.title, 60)), accion, origen };
  }

  // PLA-I46-10: a delivery he (or QA) sent back is Taller's now; the floor asks nothing until it comes back.
  if (returnedDelivery(p.slug, decisions)) return null;

  // 2. The light says something is the owner's, without a decision behind it.
  if (p.light === "needs_owner" && p.light_reason) {
    const href = p.light_reason.action?.href ?? "";
    if (href === "#publicar") return { verbo: "publicar", texto: clip(p.light_reason.text, 90), accion: { kind: "publish", label: say(MOVE_WORDS).publish }, origen: { kind: "light" } };
    if (p.light_reason.action) return { verbo: "ver", texto: clip(p.light_reason.text, 90), accion: { kind: "link", href, label: p.light_reason.action.label }, origen: { kind: "light" } };
  }

  // Anything running or about to start is the team's: only a hold that needs the owner is a move.
  const held = p.team
    .filter((m) => m.next_start && HOLD_ORDER.includes(m.next_start.hold))
    .sort((a, b) => HOLD_ORDER.indexOf(a.next_start!.hold) - HOLD_ORDER.indexOf(b.next_start!.hold))[0];
  const running = p.team.some((m) => m.state === "running");
  if (held && !running) {
    const n = held.next_start!;
    const w = say(MOVE_WORDS);
    const origen: MoveOrigin = { kind: "hold", agent: held.agent, hold: n.hold };
    if (n.hold === "no_goal") return { verbo: "fijar", texto: w.setGoal, accion: { kind: "fijar", label: w.setGoalLabel }, origen };
    if (n.hold === "waiting_owner") return { verbo: "aceptar", texto: w.approveBefore(q(n.title)), accion: { kind: "reveal", id: null, label: w.seeDelivery }, origen };
    return { verbo: "arrancar", texto: w.start(q(n.title)), accion: { kind: "start", agent: held.agent, label: w.startNow, key: n.key }, origen };
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
    if (after?.state === "unplanned" && !waiting) return { verbo: "planear", texto: say(MOVE_WORDS).plan(q(after.title)), accion: { kind: "plan", text: PLAN_LEG(after.title), label: say(MOVE_WORDS).poPlans }, origen: { kind: "route", leg: after.key } };
  }
  return null;
}
