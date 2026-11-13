// PLA-I39: the building (/ceo). Pure functions, so test/edificio-*.test.ts loads them with node:test.
//   windowState  a teammate's window from what the server reported: running is work, waiting_jorge is ask, idle is
//                idle, paused is off. Nothing else lights a window. PLA-21: no budgets, so no "hold".
//   caption      under a window: the role with its verb, then what it is on (with since when), else the first of
//                its queue, else its last delivery. Never a ticket key, null or money.
//   floorOrder   the floors: those that need the owner first, then by light; paused ones go to the basement.
//   skyAt        the sky's colours for an hour; floorHue one of six fixed hues from the slug.
import type { AskResult, Decision, DecisionAction, OrgMember, OrgMemberState, OrgNextStart, OrgProject } from "./api";
import { byLight, byRole, roleName } from "./org";
import { pending } from "./v2";

export type WindowState = "work" | "ask" | "idle" | "off";
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
export function hangingFor(decisions: Decision[], project: string, agent: string): Hanging | null {
  const mine = decisions.filter((d) => d.project === project && d.asker?.agent === agent && (pending(d) || !!d.state)).sort((a, b) => a.at.localeCompare(b.at));
  const open = mine.filter((d) => !d.state);
  const shown = open[0] ?? mine.at(-1);
  if (!shown) return null;
  return { decision: shown, more: open.filter((d) => d.id !== shown.id) };
}
// What goes on the roof as a chip: every pending decision; those with no asker on its floor's team open their row.
export function roofChips(decisions: Decision[], projects: OrgProject[]): { decision: Decision; onTeam: boolean }[] {
  const team = new Map(projects.map((p) => [p.slug, new Set(p.team.map((m) => m.agent))]));
  return decisions.filter(pending).map((d) => ({
    decision: d,
    onTeam: !!(d.project && d.asker && team.get(d.project)?.has(d.asker.agent) && !isPaused(projects.find((p) => p.slug === d.project)!)),
  }));
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

export type NowState = "work" | "rest" | "you" | "stuck" | "done" | "off" | "idle";
export const NOW_WORD: Record<NowState, string> = { work: "Trabajando", rest: "Pausa corta", you: "Te toca", stuck: "Atorado", done: "Plan terminado", off: "En pausa", idle: "Sin trabajo en curso" };
export type NowAction =
  | { kind: "start"; agent: string; pastGuard: boolean; label: string }
  | { kind: "decision"; id: string; action: DecisionAction; label: string }
  | { kind: "reveal"; label: string }
  | { kind: "publish"; label: string }
  | { kind: "fijar"; label: string }
  | { kind: "plan"; text: string; label: string };
export type NowLine = {
  state: NowState;
  word: string;
  say: string;
  why: string;
  // Who holds the work: a teammate's agent, "owner" when it waits on Jorge, null when nobody does.
  holder: string | null;
  starts_at: string | null;
  action: NowAction | null;
};

const DOES: Record<string, string> = { taller: "construye", research: "investiga", artist: "diseña", qa: "prueba", copy: "escribe" };
const q = (s: string | null | undefined, n = 80) => (s ? `«${clip(s, n)}»` : "lo siguiente");
// Actions the band can take in one click: they need no words and no choice from the owner.
const ONE_CLICK: Partial<Record<DecisionAction, string>> = { aceptar: "Aceptar", fusionar: "Aceptar", empezar: "Sí, empiecen", hecho: "Ya lo hice" };
const HOLD_ORDER = ["rest", "soon", "usage", "no_goal", "unqueued", "slot", "waiting_owner", "waiting_step"];

export function nowLine(p: OrgProject, decisions: Decision[], now: number, opts: { companyPaused?: boolean; timeZone?: string } = {}): NowLine {
  const line = (state: NowState, x: Partial<NowLine> & { say: string }): NowLine => ({ state, word: NOW_WORD[state], why: "", holder: null, starts_at: null, action: null, ...x });
  if (opts.companyPaused) return line("off", { say: "La compañía está en pausa.", why: "Nada arranca hasta que la reanudes en Máquina." });
  if (isPaused(p)) return line("off", { say: "Este proyecto está en pausa.", why: "Nada arranca hasta que lo reanudes." });

  const team = [...p.team].sort(byRole);
  const working = team.find((m) => m.state === "running");
  if (working) {
    const who = roleName(working.role);
    return line("work", {
      say: working.now?.title ? `${who} ${DOES[working.role] ?? "trabaja en"} ${q(working.now.title)}.` : `${who} está trabajando.`,
      why: working.now ? (since(working.now.since, now) === "recién empezó" ? "Recién empezó." : `Trabaja ${since(working.now.since, now)}.`) : "",
      holder: working.agent,
    });
  }

  const mine = decisions.filter((d) => d.project === p.slug && pending(d)).sort((a, b) => a.at.localeCompare(b.at));
  const d = mine.find((x) => x.kind !== "release") ?? mine[0];
  if (d) {
    const more = mine.length > 1 ? ` Hay ${mine.length - 1} más.` : "";
    if (d.kind === "release") {
      const n = d.release?.tickets?.length ?? 0;
      return line("you", { say: n === 1 ? "1 cambio listo espera que lo publiques." : `${n} cambios listos esperan que los publiques.`, why: `Publicar es tuyo.${more}`, holder: "owner", action: { kind: "publish", label: "Publicar" } });
    }
    const who = d.asker ? roleName(d.asker.role) : "El equipo";
    const delivery = d.kind === "pr" || d.kind === "deliverable";
    const first = d.actions.find((a) => ONE_CLICK[a]);
    return line("you", {
      say: delivery ? `${who} te entrega ${q(d.title)}.` : d.kind === "plan" ? `${who} te propone un plan: ${q(d.title)}.` : `${who} te pregunta: ${clip(d.title, 100)}`,
      why: `${d.hold ? `${d.hold} ` : ""}${delivery ? "Mientras no la aceptes, el paso siguiente no arranca." : "El equipo espera tu respuesta para seguir."}${more}`,
      holder: "owner",
      action: first && !d.hold ? { kind: "decision", id: d.id, action: first, label: ONE_CLICK[first]! } : { kind: "reveal", label: "Ver y responder" },
    });
  }
  if (p.light === "needs_jorge" && p.light_reason) {
    const publish = p.light_reason.action?.href === "#publicar";
    return line("you", { say: p.light_reason.text, why: "", holder: "owner", action: publish ? { kind: "publish", label: "Publicar" } : null });
  }

  const next = team
    .filter((m) => m.next_start)
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
        return line("stuck", { say: `${who} no puede arrancar: falta la meta del proyecto.`, why: "Fíjala y sigue solo.", holder: "owner", action: { kind: "fijar", label: "Fijar meta" } });
      case "unqueued":
        return line("stuck", { say: `Nadie ha despertado a ${who} para ${what}.`, why: "Está listo para empezar.", holder: next.agent, action: start("Que empiece ya") });
      case "waiting_owner":
        return line("you", { say: `${what} espera que aceptes la entrega anterior.`, why: "", holder: "owner", action: { kind: "reveal", label: "Ver la entrega" } });
      default:
        return line("idle", { say: `${what} espera un paso anterior.`, why: n.text, holder: null });
    }
  }

  const legs = p.route?.legs ?? [];
  const at = legs.findIndex((l) => l.state === "here");
  const here = legs[at];
  if (here && here.total > 0 && here.done === here.total) {
    const after = legs.slice(at + 1).find((l) => l.state !== "done");
    if (!after) return line("done", { say: `${q(here.title)} está completo.`, why: "No queda nada más en el plan." });
    const unplanned = after.state === "unplanned";
    return line("done", {
      say: `${q(here.title)} está completo. Sigue ${unplanned ? "planear " : ""}${q(after.title)}.`,
      why: unplanned ? "El PO arma los pasos y Taller empieza sin que lo pidas." : "",
      holder: team.find((m) => m.role === "product-owner")?.agent ?? null,
      action: unplanned ? { kind: "plan", text: `Planea «${after.title}»: sus pasos y qué significa hecho en cada uno.`, label: "Que PO lo planee" } : null,
    });
  }
  return line("idle", { say: "Nadie tiene trabajo ahora.", why: "Pide algo en la caja de la izquierda y el PO lo reparte." });
}

// What the owner's own figure says: what waits on him here, else nothing.
export function ownerCaption(l: NowLine): { doing: string; lit: boolean } {
  if (l.holder !== "owner") return { doing: "Nada pendiente", lit: false };
  return { doing: l.action && l.action.kind !== "reveal" ? l.action.label : "Te esperan", lit: true };
}
