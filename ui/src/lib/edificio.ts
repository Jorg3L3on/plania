// PLA-I39: the building (/ceo). Pure functions, so test/edificio-*.test.ts loads them with node:test.
//   windowState  a teammate's window from what the server reported: running is work, waiting_jorge is ask, idle is
//                idle, no_budget is hold, paused is off. Nothing else lights a window.
//   caption      under a window: the role with its verb, then what it is on (with since when), else the first of
//                its queue, else its last delivery. Never a ticket key, null or money.
//   floorOrder   the floors: those that need the owner first, then by light; paused ones go to the basement.
//   skyAt        the sky's colours for an hour; floorHue one of six fixed hues from the slug.
//   The clock (PLA-I39-8): litAt, marksOf, stepEvent.
import type { AskResult, Decision, OrgHistory, OrgHistoryEvent, OrgMember, OrgMemberState, OrgProject } from "./api";
import { byLight, roleName } from "./org";
import { pending } from "./v2";

export type WindowState = "work" | "ask" | "idle" | "hold" | "off";
const STATE: Record<OrgMemberState, WindowState> = {
  running: "work",
  waiting_jorge: "ask",
  idle: "idle",
  no_budget: "hold",
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
export function caption(m: OrgMember, now: number, opts: { companyPaused?: boolean } = {}): Caption {
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
  if (state === "hold")
    return {
      ...base,
      doing: "Sin presupuesto",
      sub: queue[0] ? `espera: ${clip(queue[0].title, 60)}` : "",
    };
  if (queue[0])
    return {
      ...base,
      doing: `Sigue: ${clip(queue[0].title)}`,
      sub: rest || "en fila",
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
  hold: "sin presupuesto",
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

// ---- the clock (PLA-I39-8)

export const HOUR = 3_600_000;
// Lit at t when a run of that teammate covers t, the first and last minute included. A live run reaches now.
export function litAt(history: OrgHistory, project: string, agent: string, t: number, now: number = Date.parse(history.to)): boolean {
  const p = history.projects.find((x) => x.slug === project);
  if (!p) return false;
  return p.runs.some((r) => r.agent === agent && Date.parse(r.from) <= t && t <= (r.to ? Date.parse(r.to) : now));
}
export type Mark = {
  at: number;
  pct: number;
  kind: OrgHistoryEvent["kind"];
  project: string;
  title: string;
  role: string;
};
export function marksOf(history: OrgHistory): Mark[] {
  const from = Date.parse(history.from);
  const span = Math.max(1, Date.parse(history.to) - from);
  return history.projects
    .flatMap((p) =>
      p.events.map((e) => ({
        at: Date.parse(e.at),
        kind: e.kind,
        project: p.slug,
        title: e.title,
        role: e.role,
      })),
    )
    .sort((a, b) => a.at - b.at)
    .map((m) => ({
      ...m,
      pct: Math.min(100, Math.max(0, ((m.at - from) / span) * 100)),
    }));
}
// The next (dir 1) or previous (dir -1) event time from t, or null at the ends.
export function stepEvent(marks: Mark[], t: number, dir: 1 | -1): number | null {
  if (dir === 1) return marks.find((m) => m.at > t)?.at ?? null;
  return [...marks].reverse().find((m) => m.at < t)?.at ?? null;
}
// The bar never goes past now, nor before the window.
export const clampTime = (t: number, history: OrgHistory) => Math.min(Date.parse(history.to), Math.max(Date.parse(history.from), t));
export const lastBefore = (marks: Mark[], t: number): Mark | null => [...marks].reverse().find((m) => m.at <= t) ?? null;
const EVENT_WORD: Record<OrgHistoryEvent["kind"], string> = {
  delivered: "entregó",
  asked: "preguntó",
  answered: "respondiste",
  ordered: "pediste",
};
export const eventText = (m: Mark) =>
  m.kind === "answered" || m.kind === "ordered" ? `${EVENT_WORD[m.kind]}: ${m.title}` : `${roleName(m.role)} ${EVENT_WORD[m.kind]}: ${m.title}`;

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

// The run of a teammate that covers t, if any (what it was on at that hour).
export function runAt(history: OrgHistory, project: string, agent: string, t: number) {
  const now = Date.parse(history.to);
  return history.projects.find((x) => x.slug === project)?.runs.find((r) => r.agent === agent && Date.parse(r.from) <= t && t <= (r.to ? Date.parse(r.to) : now)) ?? null;
}
// The time a position on the bar (0..1000) stands for, and back. The bar ends at now.
export const RANGE = 1000;
export const timeAt = (v: number, history: OrgHistory) => clampTime(Date.parse(history.from) + (Math.min(RANGE, Math.max(0, v)) / RANGE) * (Date.parse(history.to) - Date.parse(history.from)), history);
export const valueAt = (t: number, history: OrgHistory) => Math.round(((clampTime(t, history) - Date.parse(history.from)) / Math.max(1, Date.parse(history.to) - Date.parse(history.from))) * RANGE);
