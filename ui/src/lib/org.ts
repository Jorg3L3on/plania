// PLA-I33: the words and rules of Compañía como organización (ADR 31c1cead, Design 3a2c3385). Pure: the
// pages and test/compania-org.test.ts read the same functions. Spend is tokens, never money.
// PLA-I2-10: the words are in ORG_WORDS, in both languages; each function takes the language last. The constants
// that hold words (LIGHT, MEMBER_STATE, ACTION_LABEL, ACTION_EFFECT) keep their Spanish for their readers; the screen
// reads lightOf(), actionLabel() and actionEffect().
import { plainWords } from "./plain-words";
import { statusEtapa, statusWord as ticketWord } from "./etapas";
import type { Plumbed, Usage } from "./compania";
import { ago, agoSpan, tokens, type Tone } from "./compania";
import type { MachinePlumbing, OrgLight, OrgMember, OrgMemberState, OrgPlumbing, OrgProduced, ThreadAction, ThreadActionState, ThreadLink, ThreadMessage } from "./api";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import { LOCALE } from "./locale.js";

export const ORG_WORDS = defineWords({
  es: {
    light: { ok: "Bien", needs_owner: "Te necesita", failed: "Falló", blocked: "Bloqueado", late: "Atrasado", quiet: "Quieto", paused: "En pausa" } as Record<OrgLight, string>,
    // Role names stay as they are in English, but for the specialists' plain words and the owner.
    role: {
      "product-owner": "PO",
      po: "PO",
      research: "Research",
      artist: "Artist",
      taller: "Taller",
      qa: "QA",
      copy: "Copy",
      seguridad: "Seguridad",
      marketing: "Marketing",
      data: "Data",
      asistente: "Asistente",
      owner: "Tú",
    } as Record<string, string>,
    // A run's own outcome; a ticket status reads the stage map (lib/etapas.ts, PLA-I53-5).
    run: { ok: "ok", fail: "falló", skipped: "omitida", stopped: "detenida" } as Record<string, string>,
    memberState: { running: "trabajando", idle: "libre", waiting_owner: "te espera", paused: "en pausa" } as Record<OrgMemberState, string>,
    working: "Trabajando",
    since: (span: string) => `desde ${span}`,
    stillSince: (ago: string) => `quieto desde ${ago}`,
    aRun: "Corrida",
    noRuns: "Sin corridas todavía",
    // A link's kind; a ticket shows its key instead.
    kind: { doc: "doc", pr: "PR", idea: "idea", plan: "plan", question: "pregunta", brief_plan: "brief" } as Record<string, string>,
    // the plumbing line: "912k · 1 en marcha"
    stopped: "detenida",
    nothingRuns: "nada corre",
    running: (n: number) => `${n} en marcha`,
    week: (tokens: string, paused: boolean) => `${tokens} esta semana · ${paused ? "en pausa" : "en marcha"}`,
    // PLA-43: an approve button names its effect.
    action: { aceptar: "Aprobar y cerrar", cambios: "Pedir cambios", responder: "Responder", fusionar: "Aprobar y pasar a prueba" } as Record<ThreadAction, string>,
    effect: {
      aceptar: "La entrega pasa a Hecho y arranca el siguiente paso.",
      fusionar: "Se integra a la copia de prueba; lo publicado no cambia. Luego arranca el siguiente paso.",
    } as Partial<Record<ThreadAction, string>>,
    thisDeliveryPr: "esta entrega con su PR",
    thisDelivery: "esta entrega",
    done: { aceptar: "Aprobado · cerrado", cambios: "Cambios pedidos", responder: "Respondido", fusionar: "Aprobado · en la copia de prueba" } as Record<ThreadAction, string>,
    today: "Hoy",
    yesterday: "Ayer",
  },
  en: {
    light: { ok: "Fine", needs_owner: "Needs you", failed: "Failed", blocked: "Blocked", late: "Late", quiet: "Quiet", paused: "Paused" },
    role: {
      "product-owner": "PO",
      po: "PO",
      research: "Research",
      artist: "Artist",
      taller: "Taller",
      qa: "QA",
      copy: "Copy",
      seguridad: "Security",
      marketing: "Marketing",
      data: "Data",
      asistente: "Asistente",
      owner: "You",
    },
    run: { ok: "ok", fail: "failed", skipped: "skipped", stopped: "stopped" },
    memberState: { running: "working", idle: "free", waiting_owner: "waiting on you", paused: "paused" },
    working: "Working",
    since: (span: string) => `for ${span}`,
    stillSince: (ago: string) => `quiet · ${ago}`,
    aRun: "Run",
    noRuns: "No runs yet",
    kind: { doc: "doc", pr: "PR", idea: "idea", plan: "plan", question: "question", brief_plan: "brief" },
    stopped: "stopped",
    nothingRuns: "nothing running",
    running: (n: number) => `${n} running`,
    week: (tokens: string, paused: boolean) => `${tokens} this week · ${paused ? "paused" : "running"}`,
    action: { aceptar: "Approve and close", cambios: "Ask for changes", responder: "Reply", fusionar: "Approve and move to testing" },
    effect: {
      aceptar: "The delivery moves to Done and the next step starts.",
      fusionar: "It goes into the test copy; what is published does not change. Then the next step starts.",
    },
    thisDeliveryPr: "this delivery and its PR",
    thisDelivery: "this delivery",
    done: { aceptar: "Approved · closed", cambios: "Changes asked", responder: "Replied", fusionar: "Approved · in the test copy" },
    today: "Today",
    yesterday: "Yesterday",
  },
});

// ---- the light of a team (card and project header)

const LIGHT_TONE: Record<OrgLight, Tone> = { ok: "ok", needs_owner: "stop", failed: "stop", blocked: "stop", late: "warn", quiet: "warn", paused: "idle" };
const lightsIn = (language: Language) =>
  Object.fromEntries(Object.entries(LIGHT_TONE).map(([k, tone]) => [k, { word: words(ORG_WORDS, language).light[k as OrgLight], tone }])) as Record<
    OrgLight,
    { word: string; tone: Tone }
  >;
/** The Spanish words, kept for their readers; the screen reads lightOf(). */
export const LIGHT: Record<OrgLight, { word: string; tone: Tone }> = lightsIn("es");
export const lightOf = (light: OrgLight, language: Language = getLanguage()) => lightsIn(language)[light] ?? { word: light, tone: "idle" as Tone };

// The worst first (PLA-I36-1), then the rest by name; paused last.
const LIGHT_RANK: Record<OrgLight, number> = { needs_owner: 0, failed: 1, blocked: 2, late: 3, quiet: 4, ok: 5, paused: 6 };
export const byLight = <T extends { light: OrgLight; slug: string }>(a: T, b: T) =>
  (LIGHT_RANK[a.light] ?? 9) - (LIGHT_RANK[b.light] ?? 9) || a.slug.localeCompare(b.slug);

// ---- roles: PO, Research, Artist, Taller, then specialists, in that order

export const roleName = (role: string, language: Language = getLanguage()) =>
  words(ORG_WORDS, language).role[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
const ROLE_ORDER = ["product-owner", "po", "research", "artist", "taller", "qa", "copy", "seguridad", "marketing", "data"];
const rank = (role: string) => {
  const i = ROLE_ORDER.indexOf(role);
  return i === -1 ? ROLE_ORDER.length : i;
};
export const byRole = (a: OrgMember, b: OrgMember) => rank(a.role) - rank(b.role) || a.agent.localeCompare(b.agent);

// ---- one role row: what it does now and since when, or what it did last and when

export const STILL_MS = 48 * 3_600_000;
// A run's own outcome; a ticket status reads the stage map (lib/etapas.ts, PLA-I53-5).
export const statusWord = (s: string, language: Language = getLanguage()) =>
  words(ORG_WORDS, language).run[s] ?? (statusEtapa(s) ? ticketWord(s).toLowerCase() : s);

const MEMBER_TONE: Record<OrgMemberState, Tone> = { running: "ok", idle: "idle", waiting_owner: "stop", paused: "idle" };
const memberStatesIn = (language: Language) =>
  Object.fromEntries(Object.entries(MEMBER_TONE).map(([k, tone]) => [k, { word: words(ORG_WORDS, language).memberState[k as OrgMemberState], tone }])) as Record<
    OrgMemberState,
    { word: string; tone: Tone }
  >;
/** The Spanish words, kept for their readers. */
export const MEMBER_STATE: Record<OrgMemberState, { word: string; tone: Tone }> = memberStatesIn("es");

export type MemberLine = { doing: string; when: string; tone: Tone; still: boolean };
export function memberLine(m: OrgMember, now: number, language: Language = getLanguage()): MemberLine {
  const w = words(ORG_WORDS, language);
  const state = memberStatesIn(language)[m.state] ?? { word: m.state, tone: "idle" as Tone };
  if (m.now) return { doing: m.now.ticket ?? w.working, when: w.since(agoSpan(m.now.since, now, language)), tone: "ok", still: false };
  if (m.last) {
    const age = now - new Date(m.last.at).getTime();
    const still = m.state !== "paused" && age > STILL_MS;
    return {
      doing: `${m.last.ticket ?? w.aRun} · ${statusWord(m.last.status, language)}`,
      when: still ? w.stillSince(ago(m.last.at, now, language)) : ago(m.last.at, now, language),
      tone: still ? "warn" : state.tone,
      still,
    };
  }
  return { doing: w.noRuns, when: "", tone: state.tone, still: false };
}

// ---- where a link goes. Tickets and ideas open in their project; docs in the doc sheet; a PR at its url.

export function linkHref(link: Pick<ThreadLink, "kind" | "ref"> | OrgProduced, project: string | null): string | null {
  if (link.kind === "pr") return /^https?:\/\//.test(link.ref) ? link.ref : null;
  if (link.kind === "doc" || link.kind === "plan") return `/ceo?doc=${encodeURIComponent(link.ref)}`;
  if (link.kind === "question") return project ? `/p/${encodeURIComponent(project)}` : "/inbox";
  // PLA-I43-1: a Send to Plania message links its request; the progress lives in the brief (PLA-I63-5: Compañía).
  if (link.kind === "brief_plan") return "/ceo?v=brief";
  return project ? `/p/${encodeURIComponent(project)}?task=${encodeURIComponent(link.ref)}` : null;
}
export const linkLabel = (link: { kind: string; ref: string; title: string }, language: Language = getLanguage()) => {
  if (link.kind === "pr") return link.title ? plainWords(link.title, language) : "PR";
  if (link.kind === "ticket") return link.title ? `${link.ref} · ${link.title}` : link.ref;
  const kind = words(ORG_WORDS, language).kind[link.kind] ?? link.kind;
  return `${kind} “${link.title || link.ref}”`;
};

// ---- the plumbing line: "912k · 1 en marcha". PLA-21: no budgets, so no limit and no red for tokens.

export function plumbingLine(p: OrgPlumbing, language: Language = getLanguage()): { text: string; tone: Tone } {
  const w = words(ORG_WORDS, language);
  const state = p.paused ? w.stopped : p.running === 0 ? w.nothingRuns : w.running(p.running);
  return { text: `${tokens(p.spend)} · ${state}`, tone: p.paused ? "idle" : "ok" };
}
export function usageLine(u: Usage, opts: { paused: boolean }, language: Language = getLanguage()): { text: string; tone: Tone } {
  return { text: words(ORG_WORDS, language).week(tokens(u.used), opts.paused), tone: opts.paused ? "idle" : "ok" };
}

// ---- threads

export const THREAD_PAGE = 30;

// PLA-43: an approve button names its effect. fusionar is a delivery with a PR (merged into the test copy, never
// main); aceptar is one without (the ticket goes to Done). The server offers exactly one of the two.
/** The Spanish labels, kept for their readers; the screen reads actionLabel(). */
export const ACTION_LABEL: Record<ThreadAction, string> = ORG_WORDS.es.action;
export const actionLabel = (a: ThreadAction, language: Language = getLanguage()): string => words(ORG_WORDS, language).action[a] ?? a;
// What each approve button does, in one line under the buttons.
/** The Spanish lines, kept for their readers; the screen reads actionEffect(). */
export const ACTION_EFFECT: Partial<Record<ThreadAction, string>> = ORG_WORDS.es.effect;
export const actionEffect = (a: ThreadAction, language: Language = getLanguage()): string | undefined => words(ORG_WORDS, language).effect[a];
// title / aria-label: what the button approves («Aprobar y pasar a prueba: Compartir la lista»).
export function actionTitle(a: ThreadAction, m: ThreadMessage, language: Language = getLanguage()): string {
  const w = words(ORG_WORDS, language);
  if (a !== "aceptar" && a !== "fusionar") return w.action[a];
  const ticket = m.links.find((l) => l.kind === "ticket" || l.kind === "idea");
  const what = ticket?.title?.trim() || (a === "fusionar" ? w.thisDeliveryPr : w.thisDelivery);
  return `${w.action[a]}: ${what}`;
}
// "Aprobado · cerrado", "Aprobado · en la copia de prueba", "Cambios pedidos · el PO despierta".
// The server records every approve as action "aceptar"; a merge carries result.merged.
export function actionStateText(s: ThreadActionState, language: Language = getLanguage()): string {
  const done = words(ORG_WORDS, language).done;
  const raw = s.result;
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (s.action === "fusionar" || (s.action === "aceptar" && obj?.merged)) return done.fusionar;
  if (s.action === "aceptar") return done.aceptar;
  const head = done[s.action] ?? s.action;
  // The server records an object ({ticket, status}); never print it raw.
  const result = typeof raw === "string" ? raw.trim() : obj ? String(obj.status ?? "").slice(0, 12) : "";
  if (!result) return head;
  return result.toLowerCase().startsWith(head.toLowerCase()) ? result : `${head} · ${result}`;
}
// Pedir cambios and Responder need words; the approve buttons do not.
export const needsText = (a: ThreadAction) => a === "cambios" || a === "responder";

// A message waits on the owner while it offers an action nobody took yet.
export const waitsOnOwner = (m: ThreadMessage) => m.actions.length > 0 && m.action_state === null;

const dayKey = (iso: string, timeZone?: string) =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(new Date(iso));
export function dayLabel(iso: string, now: number, timeZone?: string, language: Language = getLanguage()): string {
  const w = words(ORG_WORDS, language);
  const key = dayKey(iso, timeZone);
  if (key === dayKey(new Date(now).toISOString(), timeZone)) return w.today;
  if (key === dayKey(new Date(now - 86_400_000).toISOString(), timeZone)) return w.yesterday;
  return new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone })
    .format(new Date(iso))
    .replace(/^./, (l) => l.toUpperCase());
}

// One continuous thread with a separator where the day changes (Design open question 2).
export type ThreadItem = { kind: "day"; key: string; label: string } | { kind: "message"; message: ThreadMessage; last: boolean };
export function threadItems(messages: ThreadMessage[], now: number, timeZone?: string, language: Language = getLanguage()): ThreadItem[] {
  const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));
  const out: ThreadItem[] = [];
  let day = "";
  sorted.forEach((message, i) => {
    const key = dayKey(message.at, timeZone);
    if (key !== day) {
      day = key;
      out.push({ kind: "day", key, label: dayLabel(message.at, now, timeZone, language) });
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
  projects: p.usage.projects,
  runs: p.runs,
  plan: p.plan,
});
