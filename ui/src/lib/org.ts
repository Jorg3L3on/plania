// PLA-I33: the words and rules of Compañía como organización (ADR 31c1cead, Design 3a2c3385). Pure: the
// pages and test/compania-org.test.ts read the same functions. Spend is tokens, never money.
import type { Budget, Plumbed } from "./compania";
import { ago, tokens, type Tone } from "./compania";
import type { MachinePlumbing, OrgLight, OrgMember, OrgMemberState, OrgPlumbing, OrgProduced, ThreadAction, ThreadActionState, ThreadLink, ThreadMessage } from "./api";

// ---- the light of a team (card and project header)

export const LIGHT: Record<OrgLight, { word: string; tone: Tone }> = {
  ok: { word: "Bien", tone: "ok" },
  needs_jorge: { word: "Te necesita", tone: "stop" },
  quiet: { word: "Quieto", tone: "warn" },
  paused: { word: "En pausa", tone: "idle" },
  no_budget: { word: "Sin presupuesto", tone: "stop" },
};
export const lightOf = (light: OrgLight) => LIGHT[light] ?? { word: light, tone: "idle" as Tone };

// Needs Jorge first, then the rest by name; paused last.
const LIGHT_RANK: Record<OrgLight, number> = { needs_jorge: 0, no_budget: 1, quiet: 2, ok: 3, paused: 4 };
export const byLight = <T extends { light: OrgLight; slug: string }>(a: T, b: T) =>
  (LIGHT_RANK[a.light] ?? 9) - (LIGHT_RANK[b.light] ?? 9) || a.slug.localeCompare(b.slug);

// ---- roles: PO, Research, Artist, Taller, then specialists, in that order

const ROLE_WORDS: Record<string, string> = {
  "product-owner": "PO",
  po: "PO",
  research: "Research",
  artist: "Artist",
  taller: "Taller",
  qa: "QA",
  copy: "Copy",
  marketing: "Marketing",
  data: "Data",
  asistente: "Asistente",
  jorge: "Jorge",
};
export const roleName = (role: string) => ROLE_WORDS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
const ROLE_ORDER = ["product-owner", "po", "research", "artist", "taller", "qa", "copy", "marketing", "data"];
const rank = (role: string) => {
  const i = ROLE_ORDER.indexOf(role);
  return i === -1 ? ROLE_ORDER.length : i;
};
export const byRole = (a: OrgMember, b: OrgMember) => rank(a.role) - rank(b.role) || a.agent.localeCompare(b.agent);

// ---- one role row: what it does now and since when, or what it did last and when

export const STILL_MS = 48 * 3_600_000;
const STATUS_WORD: Record<string, string> = {
  Done: "hecho",
  "In review": "en revisión",
  Merged: "fusionado",
  Released: "publicado",
  Ready: "listo",
  Blocked: "bloqueado",
  ok: "ok",
  fail: "falló",
  skipped: "omitida",
  stopped: "detenida",
};
export const statusWord = (s: string) => STATUS_WORD[s] ?? s;

export const MEMBER_STATE: Record<OrgMemberState, { word: string; tone: Tone }> = {
  running: { word: "trabajando", tone: "ok" },
  idle: { word: "libre", tone: "idle" },
  waiting_jorge: { word: "te espera", tone: "stop" },
  paused: { word: "en pausa", tone: "idle" },
  no_budget: { word: "sin presupuesto", tone: "stop" },
};

export type MemberLine = { doing: string; when: string; tone: Tone; still: boolean };
export function memberLine(m: OrgMember, now: number): MemberLine {
  const state = MEMBER_STATE[m.state] ?? { word: m.state, tone: "idle" as Tone };
  if (m.now) return { doing: m.now.ticket, when: `desde ${ago(m.now.since, now).replace(/^hace /, "")}`, tone: "ok", still: false };
  if (m.last) {
    const age = now - new Date(m.last.at).getTime();
    const still = m.state !== "paused" && age > STILL_MS;
    return {
      doing: `${m.last.ticket} · ${statusWord(m.last.status)}`,
      when: still ? `quieto desde ${ago(m.last.at, now)}` : ago(m.last.at, now),
      tone: still ? "warn" : state.tone,
      still,
    };
  }
  return { doing: "Sin corridas todavía", when: "", tone: state.tone, still: false };
}

// ---- where a link goes. Tickets and ideas open in their project; docs in the doc sheet; a PR at its url.

export function linkHref(link: Pick<ThreadLink, "kind" | "ref"> | OrgProduced, project: string | null): string | null {
  if (link.kind === "pr") return /^https?:\/\//.test(link.ref) ? link.ref : null;
  if (link.kind === "doc" || link.kind === "plan") return `/ceo?doc=${encodeURIComponent(link.ref)}`;
  if (link.kind === "question") return project ? `/p/${encodeURIComponent(project)}` : "/inbox";
  return project ? `/p/${encodeURIComponent(project)}?task=${encodeURIComponent(link.ref)}` : null;
}
const KIND_WORD: Record<string, string> = { ticket: "", doc: "doc", pr: "PR", idea: "idea", plan: "plan", question: "pregunta" };
export const linkLabel = (link: { kind: string; ref: string; title: string }) => {
  const kind = KIND_WORD[link.kind] ?? link.kind;
  if (link.kind === "pr") return link.title || "PR";
  if (link.kind === "ticket") return link.title ? `${link.ref} · ${link.title}` : link.ref;
  return `${kind} “${link.title || link.ref}”`;
};

// ---- the plumbing line: "912k / 6M · en marcha", amber at 80%, red at 100% or paused budget

export function plumbingTone(spend: number, limit: number | null): Tone {
  if (limit == null || limit <= 0) return "idle";
  const p = (spend / limit) * 100;
  if (p >= 100) return "stop";
  if (p >= 80) return "warn";
  return "ok";
}
export function plumbingLine(p: OrgPlumbing): { text: string; tone: Tone } {
  const used = p.limit == null ? `${tokens(p.spend)} · sin límite` : `${tokens(p.spend)} / ${tokens(p.limit)}`;
  const state = p.paused ? "detenida" : p.running === 0 ? "nada corre" : p.running === 1 ? "1 en marcha" : `${p.running} en marcha`;
  return { text: `${used} · ${state}`, tone: p.paused ? "idle" : plumbingTone(p.spend, p.limit) };
}
export function budgetLine(b: Budget, opts: { paused: boolean }): { text: string; tone: Tone } {
  const used = b.limit == null ? `${tokens(b.used)} · sin límite` : `${tokens(b.used)} / ${tokens(b.limit)}`;
  const state = opts.paused ? "en pausa" : b.state === "stopped" && b.reason === null ? "sin presupuesto" : "en marcha";
  const tone: Tone = opts.paused ? "idle" : b.reason === "unset" ? "warn" : b.state === "stopped" ? "stop" : b.state === "warn" ? "warn" : "ok";
  return { text: `${used} · ${state}`, tone };
}

// ---- threads

export const THREAD_PAGE = 30;

export const ACTION_LABEL: Record<ThreadAction, string> = {
  aceptar: "Aceptar",
  cambios: "Pedir cambios",
  responder: "Responder",
  fusionar: "Fusionar",
};
const ACTION_DONE: Record<ThreadAction, string> = {
  aceptar: "Aceptado",
  cambios: "Cambios pedidos",
  responder: "Respondido",
  fusionar: "Fusionado a sandbox",
};
// "Aceptado · Done", "Fusionado a sandbox · 1abb07d", "Cambios pedidos · el PO despierta".
export function actionStateText(s: ThreadActionState): string {
  const head = ACTION_DONE[s.action] ?? s.action;
  const result = s.result?.trim();
  if (!result) return head;
  return result.toLowerCase().startsWith(head.toLowerCase()) ? result : `${head} · ${result}`;
}
// Pedir cambios and Responder need words; Aceptar and Fusionar do not.
export const needsText = (a: ThreadAction) => a === "cambios" || a === "responder";

// A message waits on Jorge while it offers an action nobody took yet.
export const waitsOnJorge = (m: ThreadMessage) => m.actions.length > 0 && m.action_state === null;

const dayKey = (iso: string, timeZone?: string) =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(new Date(iso));
export function dayLabel(iso: string, now: number, timeZone?: string): string {
  const key = dayKey(iso, timeZone);
  if (key === dayKey(new Date(now).toISOString(), timeZone)) return "Hoy";
  if (key === dayKey(new Date(now - 86_400_000).toISOString(), timeZone)) return "Ayer";
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone })
    .format(new Date(iso))
    .replace(/^./, (l) => l.toUpperCase());
}

// One continuous thread with a separator where the day changes (Design open question 2).
export type ThreadItem = { kind: "day"; key: string; label: string } | { kind: "message"; message: ThreadMessage; last: boolean };
export function threadItems(messages: ThreadMessage[], now: number, timeZone?: string): ThreadItem[] {
  const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));
  const out: ThreadItem[] = [];
  let day = "";
  sorted.forEach((message, i) => {
    const key = dayKey(message.at, timeZone);
    if (key !== day) {
      day = key;
      out.push({ kind: "day", key, label: dayLabel(message.at, now, timeZone) });
    }
    out.push({ kind: "message", message, last: i === sorted.length - 1 });
  });
  return out;
}

// The thread opens on its last THREAD_PAGE messages, with "Ver anteriores" for the rest (open question 1).
export const visibleMessages = (messages: ThreadMessage[], shown: number) => {
  const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));
  return { messages: sorted.slice(Math.max(0, sorted.length - shown)), hidden: Math.max(0, sorted.length - shown) };
};

// A bare link (only a url) is saved to the design library by Asistente.
export const isBareLink = (text: string) => {
  const t = text.trim();
  return /^https?:\/\/./.test(t) && !/\s/.test(t);
};

export const MESSAGE_MAX = 4000;

// ---- Máquina: the plumbing blocks reuse the PLA-I30 pieces, which read this shape.
export const plumbedOf = (p: MachinePlumbing): Plumbed => ({
  company: p.company,
  settings: p.settings,
  week: p.week,
  projects: p.budgets.projects,
  runs: p.runs,
  plan: p.plan,
});
