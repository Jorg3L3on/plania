// PLA-I39: the building (/ceo). Pure functions, so test/edificio-*.test.ts loads them with node:test.
//   windowState  a teammate's window from what the server reported: running is work, waiting_jorge is ask, idle is
//                idle, paused is off. Nothing else lights a window. PLA-21: no budgets, so no "hold".
//   caption      under a window: the role with its verb, then what it is on (with since when), else the first of
//                its queue, else its last delivery. Never a ticket key, null or money.
//   floorOrder   the floors: those that need the owner first, then by light; paused ones go to the basement.
//   skyAt        the sky's colours for an hour; floorHue one of six fixed hues from the slug.
import type { AskResult, Decision, OrgMember, OrgMemberState, OrgMoveAction, OrgNextMove, OrgNextStart, OrgProject, OrgRoute, OrgRouteLeg, OrgRouteStep } from "./api";
import { byLight, byRole, roleName } from "./org";
import { pending, waitingPlan } from "./v2";

// PLA-I46-10: back is violet, a delivery sent back that Taller is fixing (never from the server's state alone).
export type WindowState = "work" | "ask" | "idle" | "off" | "back";
const STATE: Record<OrgMemberState, WindowState> = {
  running: "work",
  waiting_jorge: "ask",
  idle: "idle",
  paused: "off",
};
// The company switch puts every blind down: nothing starts and live runs are stopped.
export const windowState = (m: Pick<OrgMember, "state">, companyPaused = false): WindowState => (companyPaused ? "off" : (STATE[m.state] ?? "idle"));

// role → [name, verb]. Any other role gets its name and "trabaja".
const VERB: Record<string, string> = {
  "product-owner": "coordina",
  po: "coordina",
  research: "investiga",
  artist: "diseña",
  taller: "construye",
  qa: "prueba",
  copy: "escribe",
  seguridad: "revisa",
  marketing: "difunde",
  data: "mide",
};
export const roleVerb = (role: string) => VERB[role] ?? "trabaja";
// The prop on the silhouette: PO headset, Research glasses, Artist beret, Taller hard hat, QA magnifier.
export type Prop = "headset" | "glasses" | "beret" | "hardhat" | "magnifier" | "none";
const PROPS: Record<string, Prop> = {
  "product-owner": "headset",
  po: "headset",
  research: "glasses",
  artist: "beret",
  taller: "hardhat",
  qa: "magnifier",
};
export const propOf = (role: string): Prop => PROPS[role] ?? "none";

const MIN = 60_000;
const since = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / MIN));
  if (m < 1) return "recién empezó";
  if (m < 60) return `desde hace ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `desde hace ${h} h` : `desde hace ${Math.round(h / 24)} días`;
};
const agoShort = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / MIN));
  if (m < 60) return `hace ${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
};
const clip = (s: string, n = 90) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};

export type Caption = { who: string; verb: string; doing: string; sub: string };
export function caption(m: OrgMember, now: number, opts: { companyPaused?: boolean; timeZone?: string } = {}): Caption {
  const state = windowState(m, opts.companyPaused);
  const base = { who: roleName(m.role), verb: roleVerb(m.role) };
  const queue = m.queue ?? [];
  const rest = queue.length > 1 ? `${queue.length - 1} más en fila` : "";
  if (state === "work")
    return {
      ...base,
      doing: m.now?.title ? clip(m.now.title) : "Trabajando",
      sub: m.now ? since(m.now.since, now) : "",
    };
  if (state === "ask")
    return {
      ...base,
      doing: "Te pregunta algo",
      sub: m.waiting ? clip(m.waiting, 80) : "te espera",
    };
  if (state === "off") return { ...base, doing: "En pausa", sub: "" };
  if (queue[0])
    return {
      ...base,
      // PLA-23: next, not now: it has not started (a live run is "work" above).
      doing: `Siguiente: ${clip(queue[0].title)}`,
      // PLA-I40-4: the server's reason when it sent one, not just "not yet".
      sub: [m.next_start ? startsLine(m.next_start, now, opts.timeZone) : "aún no empieza", rest].filter(Boolean).join(" · "),
    };
  if (m.produced)
    return {
      ...base,
      doing: `Entregó: ${clip(m.produced.title)}`,
      sub: m.last ? agoShort(m.last.at, now) : "",
    };
  if (m.last?.title)
    return {
      ...base,
      doing: `Último: ${clip(m.last.title)}`,
      sub: agoShort(m.last.at, now),
    };
  return { ...base, doing: "Sin trabajo", sub: "" };
}

// The accessible name of a window: role, state and what it is on.
const STATE_WORD: Record<WindowState, string> = {
  back: "devuelto",
  work: "trabajando",
  ask: "te espera",
  idle: "libre",
  off: "en pausa",
};
export const windowLabel = (m: OrgMember, project: string, now: number, companyPaused = false) => {
  const c = caption(m, now, { companyPaused });
  const state = windowState(m, companyPaused);
  return `${c.who} de ${project}, ${STATE_WORD[state]}: ${c.doing}${c.sub ? `, ${c.sub}` : ""}`;
};

// ---- floors

export const isPaused = (p: OrgProject) => p.paused || p.light === "paused";
export const waitsOnOwner = (p: OrgProject, decisions: Decision[]) => p.light === "needs_jorge" || decisions.some((d) => d.project === p.slug && pending(d));
export function floorOrder(projects: OrgProject[], decisions: Decision[]): { floors: OrgProject[]; basement: OrgProject[] } {
  const live = projects.filter((p) => !isPaused(p));
  const floors = [...live].sort((a, b) => Number(!waitsOnOwner(a, decisions)) - Number(!waitsOnOwner(b, decisions)) || byLight(a, b));
  const basement = projects.filter(isPaused).sort((a, b) => a.slug.localeCompare(b.slug));
  return { floors, basement };
}

// Six fixed hues; the slug picks one (projects have no colour of their own).
export const HUES = ["#ff6f9f", "#a290ff", "#45cad6", "#ffd166", "#7bd88f", "#ff8f6b"] as const;
export function floorHue(slug: string): string {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length]!;
}

// The sky for an hour (0-23 in the screen's time zone): deep night, dawn and dusk lighter, day a pale night.
export type Sky = {
  top: string;
  bottom: string;
  stars: number;
  orb: "moon" | "sun";
};
export function skyAt(hour: number): Sky {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 21 || h < 5) return { top: "#070a18", bottom: "#171d3d", stars: 1, orb: "moon" };
  if (h < 7) return { top: "#1b2150", bottom: "#4a3b6b", stars: 0.4, orb: "sun" };
  if (h < 18) return { top: "#1d2f63", bottom: "#33508a", stars: 0, orb: "sun" };
  return { top: "#14183a", bottom: "#41305e", stars: 0.5, orb: "moon" };
}
export const hourIn = (iso: string | number, timeZone?: string) =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(new Date(iso)),
  );

// ---- decisions on the building

// The decision under a teammate's window: the asker must be on that floor's team. The oldest shows; the rest count.
export type Hanging = { decision: Decision; more: Decision[] };
export function hangingFor(decisions: Decision[], project: string, agent: string, inAhora: string | null = null): Hanging | null {
  // PLA-I40-6: only what still waits hangs under a window; an answered one is a line under Lo último (lastLines).
  // PLA-I46-11: the decision Ahora already carries (a leg's plan to accept) does not hang a second time.
  const open = decisions.filter((d) => d.project === project && d.asker?.agent === agent && pending(d) && d.id !== inAhora).sort((a, b) => a.at.localeCompare(b.at));
  const shown = open[0];
  if (!shown) return null;
  return { decision: shown, more: open.slice(1) };
}
// PLA-I46-3: the roof, one chip per floor whose move waits (its texto, word for word), then any pending decision no
// floor can show (no project, or a project in the basement). A chip whose decision has no asker on that floor's team
// opens its row in place (onTeam false); the rest jump to their floor.
export type RoofChip = { key: string; project: OrgProject | null; move: OrgNextMove | null; decision: Decision | null; onTeam: boolean };
export function roofChips(decisions: Decision[], projects: OrgProject[]): RoofChip[] {
  const { floors } = floorOrder(projects, decisions);
  const live = new Set(floors.map((p) => p.slug));
  const out: RoofChip[] = [];
  for (const p of floors) {
    const m = moveOf(p);
    if (!m) continue;
    const o = m.origen;
    const d = o.kind === "decision" ? (decisions.find((x) => x.id === o.id) ?? null) : null;
    const team = new Set(p.team.map((x) => x.agent));
    out.push({ key: d?.id ?? `move-${p.slug}`, project: p, move: m, decision: d, onTeam: !d || !!(d.asker && team.has(d.asker.agent)) });
  }
  for (const d of decisions.filter(pending))
    if (!d.project || !live.has(d.project)) out.push({ key: d.id, project: projects.find((p) => p.slug === d.project) ?? null, move: null, decision: d, onTeam: false });
  return out;
}

export const HOUR = 3_600_000;

// ---- the side page (PLA-I39-6)

// "Dile algo": a note on the teammate's current ticket, or, with none, an order to the PO that names the role.
export type Say = { kind: "note"; key: string; text: string } | { kind: "order"; text: string };
export function sayTo(m: Pick<OrgMember, "role" | "now">, text: string): Say | null {
  const t = text.trim();
  if (t.length < 2) return null;
  if (m.now?.ticket) return { kind: "note", key: m.now.ticket, text: t };
  return { kind: "order", text: m.role === "product-owner" ? t : `Para ${roleName(m.role)}: ${t}` };
}

// ---- asking from the floor (PLA-I39-7)

// Where the order landed, in plain words: the PO of that project, and whether it woke.
export function askedLine(r: AskResult, project?: string): string {
  const who = project ? `el PO de ${project}` : "el PO";
  if (r.woke?.woke) return `Le llegó a ${who} y ya está en ello.`;
  if (r.woke) return `Le llegó a ${who}; ${r.woke.reason === "busy" ? "termina lo que corre y sigue con esto" : r.woke.reason === "queued" ? "arranca en cuanto haya lugar" : "lo toma en su turno"}.`;
  return r.wake === "busy" ? `Le llegó a ${who}; lo toma al terminar lo que corre.` : r.wake === "queued" ? `Le llegó a ${who}; lo toma en su turno.` : `Le llegó a ${who}; lo ve en su próximo turno.`;
}
export const RECIBIRIA = "Recibiría tu pedido";

// ---- Ahora (PLA-I40-4): what is happening on a floor, why, until when, and the one thing the owner can do

export const clockAt = (iso: string | number, timeZone?: string) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone })
    .format(new Date(iso))
    .replace(/\s?([AP])M$/, (_, x: string) => ` ${x.toLowerCase()}m`);
// mm:ss until a time, never negative.
export const countdown = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m}:${String(s % 60).padStart(2, "0")}`;
};
// Under a window: the hold in a few words, with the time when there is one.
export function startsLine(n: OrgNextStart, now: number, timeZone?: string): string {
  const at = n.starts_at && Date.parse(n.starts_at) > now ? clockAt(n.starts_at, timeZone) : null;
  if (n.hold === "rest") return at ? `descansa · arranca ${at}` : "descansa un momento";
  if (n.hold === "soon") return "arranca en un momento";
  if (n.hold === "usage") return at ? `detenido por el uso · reintenta ${at}` : "detenido por el uso";
  if (n.hold === "slot") return "espera un lugar";
  if (n.hold === "paused") return "en pausa";
  if (n.hold === "no_goal") return "falta la meta";
  if (n.hold === "waiting_owner") return "espera tu visto bueno";
  if (n.hold === "waiting_step") return "espera un paso anterior";
  return "nadie lo ha despertado";
}

export type NowState = "work" | "rest" | "you" | "stuck" | "done" | "off" | "idle" | "back";
export const BACK_WORD = "Devuelto · arreglando";
export const NOW_WORD: Record<NowState, string> = { back: BACK_WORD, work: "Trabajando", rest: "Pausa corta", you: "Te toca", stuck: "Atorado", done: "Plan terminado", off: "En pausa", idle: "Sin trabajo en curso" };
// PLA-I46-3: the band's action is the floor's move (OrgMoveAction, green), or a secondary nudge that is never the
// owner's turn (start a resting teammate now, or past the usage guard).
export type NowAction = OrgMoveAction | { kind: "start"; agent: string; pastGuard: boolean; label: string };
export type NowLine = {
  state: NowState;
  word: string;
  say: string;
  why: string;
  // Who holds the work: a teammate's agent, "owner" when it waits on Jorge, null when nobody does.
  holder: string | null;
  starts_at: string | null;
  action: NowAction | null;
  // PLA-I46-3: the floor's siguiente jugada when it has one: then say is its texto and action its accion.
  move: OrgNextMove | null;
  // PLA-I46-10: a returned delivery's note, behind «Ver nota» (grey, never green).
  note?: string | null;
};

// PLA-I46-10: the delivery on this floor that went back to Taller (the owner's Devolver, or QA's own return) and has
// not come back yet. Same rule as the server's returnedDelivery (src/api/company-move.ts), which drops the move.
export type Returned = { d: Decision; agent: string | null; role: string; text: string; by: "qa" | "owner" };
export function returnedOf(slug: string, decisions: Decision[]): Returned | null {
  const open = new Set(decisions.filter((d) => d.project === slug && d.ref && pending(d)).map((d) => d.ref));
  const d = decisions
    .filter((x) => x.project === slug && (x.kind === "pr" || x.kind === "deliverable") && x.state?.action === "cambios" && !(x.ref && open.has(x.ref)))
    .sort((a, b) => b.state!.at.localeCompare(a.state!.at))[0];
  if (!d) return null;
  const r = d.state!.result ?? {};
  return { d, agent: d.asker?.agent ?? null, role: d.asker?.role ?? "taller", text: typeof r.text === "string" ? r.text : "", by: r.by === "qa" ? "qa" : "owner" };
}

const DOES: Record<string, string> = { taller: "construye", research: "investiga", artist: "diseña", qa: "prueba", copy: "escribe" };
const q = (s: string | null | undefined, n = 80) => (s ? `«${clip(s, n)}»` : "lo siguiente");
const HOLD_ORDER = ["rest", "soon", "usage", "no_goal", "unqueued", "slot", "waiting_owner", "waiting_step"];

// PLA-I46-3: the floor's move as the server sent it; an older server sends none.
export const moveOf = (p: Pick<OrgProject, "next_move">): OrgNextMove | null => p.next_move ?? null;

// The second line under a move: why it is the owner's. The sentence itself is the move's texto, unchanged.
function moveWhy(m: OrgNextMove, p: OrgProject, decisions: Decision[]): string {
  const o = m.origen;
  if (o.kind === "decision") {
    const mine = decisions.filter((d) => d.project === p.slug && pending(d));
    const d = mine.find((x) => x.id === o.id);
    const more = mine.length > 1 ? ` Hay ${mine.length - 1} más.` : "";
    const hold = d?.hold ? `${d.hold} ` : "";
    if (o.decision === "release") return `Publicar es tuyo.${more}`;
    if (o.decision === "pr" || o.decision === "deliverable") return `${hold}Mientras no la aceptes, el paso siguiente no arranca.${more}`;
    // PLA-I46-11: a leg's plan says what the PO proposes.
    if (o.decision === "plan" && d?.plan?.leg) {
      const n = d.plan.steps.length;
      const k = d.plan.questions?.length ?? 0;
      return `El PO propone ${n === 1 ? "1 paso" : `${n} pasos`}${k ? ` y ${k === 1 ? "1 pregunta" : `${k} preguntas`}, con su respuesta sugerida ya marcada` : ""}.${more}`;
    }
    return `${hold}El equipo espera tu respuesta para seguir.${more}`;
  }
  if (o.kind === "hold") return o.hold === "no_goal" ? "Sin meta nadie arranca. Fíjala y sigue solo." : o.hold === "waiting_owner" ? "Mientras no la aceptes, el paso siguiente no arranca." : "Está listo para empezar y nadie lo ha despertado.";
  if (o.kind === "route") {
    const here = p.route?.legs.find((l) => l.state === "here");
    return `${here ? `${q(here.title)} está completo. ` : ""}El PO arma los pasos y tú los aceptas.`;
  }
  return "";
}

export function nowLine(p: OrgProject, decisions: Decision[], now: number, opts: { companyPaused?: boolean; timeZone?: string } = {}): NowLine {
  const line = (state: NowState, x: Partial<NowLine> & { say: string }): NowLine => ({ state, word: NOW_WORD[state], why: "", holder: null, starts_at: null, action: null, move: null, ...x });
  if (opts.companyPaused) return line("off", { say: "La compañía está en pausa.", why: "Nada arranca hasta que la reanudes en Máquina." });
  if (isPaused(p)) return line("off", { say: "Este proyecto está en pausa.", why: "Nada arranca hasta que lo reanudes." });

  // PLA-I46-3: one source. What is the owner's comes from the server's move; nothing below offers him a turn.
  const m = moveOf(p);
  if (m) return line("you", { say: m.texto, why: moveWhy(m, p, decisions), holder: "owner", action: m.accion, move: m });

  // PLA-I46-10: sent back: Taller's to fix. No button but «Ver nota»; it comes back to him with the next delivery.
  const back = returnedOf(p.slug, decisions);
  if (back) {
    const qa = p.team.some((x) => x.role === "qa");
    return line("back", {
      say: `${roleName(back.role)} arregla ${q(back.d.title)}.`,
      why: `${back.by === "qa" ? "QA lo devolvió. " : ""}Vuelve a ti ${qa ? "cuando QA lo pase otra vez" : "con la próxima entrega"}.`,
      holder: back.agent,
      note: back.text || null,
    });
  }

  const team = [...p.team].sort(byRole);
  const working = team.find((x) => x.state === "running");
  if (working) {
    const who = roleName(working.role);
    return line("work", {
      say: working.now?.title ? `${who} ${DOES[working.role] ?? "trabaja en"} ${q(working.now.title)}.` : `${who} está trabajando.`,
      why: working.now ? (since(working.now.since, now) === "recién empezó" ? "Recién empezó." : `Trabaja ${since(working.now.since, now)}.`) : "",
      holder: working.agent,
    });
  }

  const next = team
    .filter((x) => x.next_start)
    .sort((a, b) => HOLD_ORDER.indexOf(a.next_start!.hold) - HOLD_ORDER.indexOf(b.next_start!.hold))[0];
  if (next) {
    const n = next.next_start!;
    const who = roleName(next.role);
    const what = q(n.title);
    const at = n.starts_at && Date.parse(n.starts_at) > now ? clockAt(n.starts_at, opts.timeZone) : null;
    const start = (label: string, pastGuard = false): NowAction => ({ kind: "start", agent: next.agent, pastGuard, label });
    switch (n.hold) {
      case "rest":
        return line("rest", { say: at ? `${who} arranca ${what} a las ${at}.` : `${who} arranca ${what} en un momento.`, why: `${n.text} No tienes que hacer nada.`, holder: next.agent, starts_at: at ? n.starts_at : null, action: start("Que empiece ya") });
      case "soon":
        return line("rest", { say: `${who} arranca ${what} en un momento.`, why: "Ya está en fila; no tienes que hacer nada.", holder: next.agent });
      case "slot":
        return line("rest", { say: `${who} arranca ${what} en cuanto haya lugar.`, why: n.text, holder: next.agent });
      case "usage":
        return line("stuck", { say: `${who} no arrancó ${what}.`, why: `${n.text} ${at ? `Vuelve a intentarlo solo a las ${at}.` : "Vuelve a intentarlo solo cuando el uso baje."}`, holder: next.agent, starts_at: at ? n.starts_at : null, action: start("Seguir de todos modos", true) });
      case "no_goal":
        return line("stuck", { say: `${who} no puede arrancar: falta la meta del proyecto.`, why: n.text, holder: next.agent });
      case "unqueued":
        return line("stuck", { say: `Nadie ha despertado a ${who} para ${what}.`, why: "Está listo para empezar.", holder: next.agent });
      case "waiting_owner":
        return line("idle", { say: `${what} espera una entrega anterior.`, why: n.text, holder: null });
      default:
        return line("idle", { say: `${what} espera un paso anterior.`, why: n.text, holder: null });
    }
  }

  // PLA-I46-11: a leg's plan the owner left for later waits here; nothing starts until he accepts it.
  const later = decisions.find((d) => d.project === p.slug && waitingPlan(d) && d.plan?.leg);
  if (later) return line("rest", { word: "En pausa", say: `El plan de ${q(later.plan!.leg!.title)} te espera.`, why: "Nadie empieza hasta que lo aceptes." });

  const legs = p.route?.legs ?? [];
  const at = legs.findIndex((l) => l.state === "here");
  const here = legs[at];
  if (here && here.total > 0 && here.done === here.total) {
    const after = legs.slice(at + 1).find((l) => l.state !== "done");
    if (!after) return line("done", { say: `${q(here.title)} está completo.`, why: "No queda nada más en el plan." });
    return line("done", { say: `${q(here.title)} está completo. Sigue ${q(after.title)}.`, why: "" });
  }
  return line("idle", { say: "Nadie tiene trabajo ahora.", why: "Pide algo con Pedir y el PO lo reparte." });
}

// What the owner's own window says: the floor's move, word for word, else nothing for now.
export function ownerCaption(l: NowLine): { doing: string; lit: boolean } {
  if (!l.move) return { doing: "Nada por ahora", lit: false };
  return { doing: l.move.texto, lit: true };
}

// PLA-I46-3: the sky reads the first floor whose move waits (the floors' order puts those first).
export function skyMove(projects: OrgProject[], decisions: Decision[]): { project: OrgProject; move: OrgNextMove; more: number } | null {
  const { floors } = floorOrder(projects, decisions);
  const withMove = floors.filter((p) => moveOf(p));
  const first = withMove[0];
  return first ? { project: first, move: moveOf(first)!, more: withMove.length - 1 } : null;
}
export function skyLine(projects: OrgProject[], decisions: Decision[], base: string): string {
  const s = skyMove(projects, decisions);
  if (!s) return `${base}. Nada te espera.`;
  return `Te toca: ${s.move.texto}${s.more ? ` · y ${s.more === 1 ? "1 piso más" : `${s.more} pisos más`}` : ""}.`;
}

// ---- the route (PLA-I40-5): the delivery as legs, the current one with its named steps

const DAY_MS = 86_400_000;
const dayKey = (t: number, timeZone?: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(t));
// "hoy 2:35 pm", "ayer", else "el 12 nov".
export function whenWord(iso: string, now: number, timeZone?: string): string {
  const t = Date.parse(iso);
  if (dayKey(t, timeZone) === dayKey(now, timeZone)) return `hoy ${clockAt(t, timeZone)}`;
  if (dayKey(t, timeZone) === dayKey(now - DAY_MS, timeZone)) return "ayer";
  return `el ${new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone }).format(new Date(t)).replace(".", "")}`;
}
export function legLine(l: OrgRouteLeg): string {
  if (l.state === "unplanned") return "sin planear";
  if (l.state === "done") return "completo";
  const count = `${l.done} de ${l.total}`;
  if (l.state === "here") return `${count} · aquí`;
  return l.note ? `${count} · ${l.note.charAt(0).toLowerCase()}${l.note.slice(1)}` : count;
}
export function routeCount(r: OrgRoute): string {
  const done = r.legs.reduce((n, l) => n + l.done, 0);
  const total = r.legs.reduce((n, l) => n + l.total, 0);
  const open = r.legs.filter((l) => l.state === "unplanned").length;
  const steps = total === 0 ? "Aún no hay pasos" : `${done} de ${total} pasos`;
  return [steps, open ? (open === 1 ? "1 entregable sin planear" : `${open} entregables sin planear`) : "", r.more_legs ? `+${r.more_legs} más` : ""].filter(Boolean).join(" · ");
}
export type StepMark = "done" | "now" | "later";
export const stepMark = (s: OrgRouteStep): StepMark => (s.state === "done" || s.state === "published" ? "done" : s.state === "later" ? "later" : "now");
// One line of state per step. The step that comes next reads from the same next_start the band reads.
export function stepLine(s: OrgRouteStep, team: OrgMember[], now: number, timeZone?: string): string {
  const who = s.who ? roleName(s.who) : "El equipo";
  if (s.state === "published") return s.at ? `Publicado ${whenWord(s.at, now, timeZone)}` : "Publicado";
  if (s.state === "done") return s.at ? `Aceptado ${whenWord(s.at, now, timeZone)}` : "Aceptado";
  if (s.state === "delivered") return "Entregado · espera que lo aceptes";
  if (s.state === "working") {
    const m = team.find((x) => x.state === "running" && x.now?.ticket === s.key);
    return m?.now ? `En curso · ${who}, ${since(m.now.since, now)}` : `En curso · ${who}`;
  }
  if (s.state === "next") {
    const n = team.find((x) => x.next_start?.key === s.key)?.next_start;
    if (!n) return `Sigue · ${who}`;
    const at = n.starts_at && Date.parse(n.starts_at) > now ? clockAt(n.starts_at, timeZone) : null;
    return n.hold === "rest" && at ? `Sigue · ${who} arranca a las ${at}` : `Sigue · ${who}: ${startsLine(n, now, timeZone)}`;
  }
  return "Después · espera el paso anterior";
}

// ---- under the route (PLA-I40-6): what runs without the owner, what only he does, and the last things that happened

const TO_DO: Record<string, string> = { taller: "construye", research: "investiga", artist: "diseña", qa: "prueba", copy: "escribe", "product-owner": "prepara" };
export function sinTi(p: OrgProject): string {
  if (isPaused(p)) return "Nada: el proyecto está en pausa.";
  const steps = p.route?.legs.find((l) => l.state === "here")?.steps ?? [];
  const at = steps.find((s) => s.state === "working") ?? steps.find((s) => s.state === "next");
  if (at) {
    const who = at.who ? roleName(at.who) : "El equipo";
    const then = steps[steps.indexOf(at) + 1];
    return `${who} ${at.state === "working" ? "termina" : (TO_DO[at.who ?? ""] ?? "hace")} ${q(at.title)} y te lo entrega.${then ? ` Después sigue ${q(then.title)}.` : ""}`;
  }
  if (steps.some((s) => s.state === "delivered")) return "En cuanto aceptes la entrega, el equipo toma el paso siguiente.";
  const queued = [...p.team].sort(byRole).find((m) => m.state === "running" || m.next_start || (m.queue ?? []).length > 0);
  if (queued) return `${roleName(queued.role)} sigue con lo que tiene en fila.`;
  return "Nada en fila. Lo que pidas lo reparte el PO.";
}
export const SOLO_TU = "Aceptar cada entrega para que el paso siguiente arranque, y publicar.";
// PLA-I40-7: with the switch on, accepting is the team's when the tests pass; publishing stays the owner's.
export const SOLO_TU_AUTO = "Publicar. Las entregas con pruebas en verde se aceptan solas en la copia de prueba.";
export const AUTO_LABEL = "Aceptar sola en la copia de prueba si las pruebas pasan";

const DID: Record<string, string> = { aceptar: "Aceptaste", fusionar: "Aceptaste", cambios: "Pediste cambios en", elegir: "Respondiste", responder: "Respondiste", hecho: "Marcaste hecho", aplazar: "Aplazaste", empezar: "Aprobaste el plan", cambiar: "Pediste cambiar", cancelar: "Cancelaste", despues: "Dejaste para después" };
export type LastLine = { id: string; text: string; at: string; decision: Decision | null };
// The newest three: the owner's answers (a decision's state) and what the server saw (a publish, a delivery).
export function lastLines(p: OrgProject, decisions: Decision[], max = 3): LastLine[] {
  const answered = decisions
    .filter((d) => d.project === p.slug && d.state)
    .map((d) => {
      // PLA-I40-7: an accept the project's switch made says so, with the test counts it stood on.
      const auto = d.state!.result?.by === "auto";
      const counts = auto && d.evidence?.pass != null ? ` · ${d.evidence.pass} pruebas pasan` : "";
      return { id: `d-${d.id}`, text: auto ? `Se aceptó sola ${q(d.title, 70)}${counts}` : `${DID[d.state!.action] ?? "Respondiste"} ${q(d.title, 70)}`, at: d.state!.at, decision: d };
    });
  const seen = (p.latest ?? []).map((l, i) => ({
    id: `l-${i}-${l.at}`,
    text: l.kind === "published" ? (l.n ? `Publicaste ${l.n === 1 ? "1 cambio" : `${l.n} cambios`}` : "Publicaste los cambios") : `El equipo entregó ${q(l.title, 70)}`,
    at: l.at,
    decision: null,
  }));
  return [...answered, ...seen].sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}
// "lleva 16 h" / "lleva 3 días".
export const staleAge = (sinceIso: string, now: number) => {
  const h = Math.max(1, Math.round((now - Date.parse(sinceIso)) / HOUR));
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} días`;
};

// ---- the plate (PLA-I46-4): one status line, in plain words

// Where the delivery stands, what is postponed on purpose, and the forecast when late. Never a token, never a key.
export function plateStatus(p: OrgProject): string {
  const legs = p.route?.legs ?? [];
  const here = legs.find((l) => l.state === "here");
  const parts: string[] = [];
  if (here) parts.push(here.total > 0 && here.done === here.total ? `${here.title} completo` : here.total > 0 ? `${here.title}: ${here.done} de ${here.total} pasos` : `${here.title}: sin pasos todavía`);
  else if (p.plan && p.plan.total > 0) parts.push(`${p.plan.done} de ${p.plan.total} pasos hechos`);
  else if (!legs.length) parts.push("Aún no hay pasos");
  const postponed = legs.filter((l) => l.note && /^pospuesto|pospuestos$/i.test(l.note));
  const one = postponed.length === 1 ? /^Pospuesto: (.+)$/i.exec(postponed[0]!.note!) : null;
  if (one) parts.push(`${q(one[1], 50)} sigue pospuesto a propósito`);
  else if (postponed.length) parts.push("hay pasos pospuestos a propósito");
  const r = p.rumbo;
  if (r && !r.missing && (r.weeks_behind ?? 0) > 0 && r.forecast_on) parts.push(`va ${r.weeks_behind === 1 ? "1 semana" : `${r.weeks_behind} semanas`} tarde`);
  return parts.join(" · ");
}
