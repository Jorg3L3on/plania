// PLA-I53-4: la línea de Ahora, one true answer to «who is working on this floor now». Pure, so
// test/i53-ahora-ui.test.ts loads it with node:test. The floor (/ceo?piso=) and the project page (/p/<slug>) build it
// from the same company card (GET /api/company), so both say the same words.
//   obrasOf     who works now: the server's ahora list (src/api/etapa.ts, the same etapa the cards read), plus any
//               live run that list cannot show (a run with no ticket, or on a ticket whose stage is not a working
//               one), so a lit window is always named in the line
//   seatOf      the one obra a teammate's window shows; the seat caption and the lit window read it (edificio.ts)
//   litOf       which seat stations light, and in what colour, from the same obras
//   quietReason why nobody works, first match wins: something waits on the owner (the item), everything is blocked
//               (what), nothing is Ready, the project is paused, or the work is queued for the next round
//   ahoraView   the line itself: the working form (a sentence per obra, newest first, and who is idle) or the quiet
//               form («Nadie trabaja en este piso ahora.» and the reason)
import type { EtapaId, OrgMember, OrgNextStart, OrgProject, ProjectTicket } from "./api";
import { columnOf, isDone, toneOf, type StageTone, type StationId } from "./etapas";
import { byRole, roleName } from "./org";
import { ago } from "./time";
import { getLanguage, words, type Language } from "./i18n.js";
import { AHORA_PISO_WORDS } from "./ahora-piso-words";
// PLA-I2-10: the words are in AHORA_PISO_WORDS (lib/ahora-piso-words.ts), in both languages; the functions that
// return words take the language last, the screen's by default.
const W = (language: Language) => words(AHORA_PISO_WORDS, language);

// One piece of work someone is on this minute.
export type Obra = {
  // The ticket, null for a run that has none (an order the PO works through, say).
  key: string | null;
  title: string | null;
  // The ticket's stage; null for a run the server's ahora does not list.
  etapa: EtapaId | null;
  agent: string;
  role: string;
  since: string | null;
  // The station it lights (Por hacer, Taller, QA), null for a teammate who has none (Research, Artist…).
  station: StationId | null;
  tone: StageTone;
};

const STATION_OF_ROLE: Record<string, StationId> = { "product-owner": "por", po: "por", taller: "taller", qa: "qa" };

const clip = (s: string, n = 80) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};
const q = (s: string | null | undefined, language: Language) => (s ? W(language).quote(clip(s)) : W(language).nextThing);
const newest = (a: { since: string | null }, b: { since: string | null }) => Date.parse(b.since ?? "0") - Date.parse(a.since ?? "0");

// Who on the team a holder is: the same agent, else the teammate of that role (a session's lease names its client,
// not the roster slug).
function memberOf(team: OrgMember[], h: { agent: string; role: string }): OrgMember | null {
  return team.find((m) => m.agent === h.agent) ?? team.find((m) => m.role === h.role) ?? null;
}

type Card = Pick<OrgProject, "team" | "ahora">;
export function obrasOf(p: Card, opts: { companyPaused?: boolean } = {}): Obra[] {
  if (opts.companyPaused) return [];
  const out: Obra[] = [];
  const taken = new Set<string>();
  for (const a of p.ahora ?? []) {
    if (!a.live || !a.holder) continue;
    const m = memberOf(p.team, a.holder);
    const agent = m?.agent ?? a.holder.agent;
    const e = { etapa: a.etapa, qa: a.qa, holder: a.holder, live: a.live, since: a.since, ci: null, reason: a.reason };
    out.push({ key: a.key, title: a.title, etapa: a.etapa, agent, role: m?.role ?? a.holder.role, since: a.since, station: columnOf(e), tone: toneOf(e) });
    taken.add(agent);
  }
  // A live run the list above does not name: its window is lit, so the line names it too.
  for (const m of p.team) {
    if (m.state !== "running" || taken.has(m.agent)) continue;
    if (m.now?.ticket && out.some((o) => o.key === m.now!.ticket)) continue;
    out.push({ key: m.now?.ticket ?? null, title: m.now?.title ?? null, etapa: null, agent: m.agent, role: m.role, since: m.now?.since ?? null, station: STATION_OF_ROLE[m.role] ?? null, tone: "now" });
  }
  return out.sort(newest);
}

export const seatOf = (m: Pick<OrgMember, "agent">, obras: Obra[]): Obra | null => obras.find((o) => o.agent === m.agent) ?? null;

// The seat stations' light: building and testing before fixing, as the board's own rule (etapas.ts litOf).
const LIT_ORDER: StageTone[] = ["now", "review", "owner"];
export function litOf(obras: Obra[]): Partial<Record<StationId, StageTone>> {
  const lit: Partial<Record<StationId, StageTone>> = {};
  for (const o of obras) {
    if (!o.station) continue;
    const had = lit[o.station];
    if (!had || LIT_ORDER.indexOf(o.tone) < LIT_ORDER.indexOf(had)) lit[o.station] = o.tone;
  }
  return lit;
}

// «Taller construye «título» · hace 12 min», «QA prueba «título»», «Taller arregla «título» (devuelto)».
export function obraLine(o: Obra, now: number, language: Language = getLanguage()): string {
  const w = W(language);
  const who = roleName(o.role, language);
  const what =
    o.etapa === "devuelto"
      ? w.fixesBack(who, q(o.title, language))
      : o.etapa === "en_qa"
        ? w.tests(who, q(o.title, language))
        : o.title
          ? w.does(who, w.verb[o.role] ?? w.verbOther, q(o.title, language))
          : w.isWorking(who);
  return o.since ? `${what} · ${ago(o.since, now, language)}` : what;
}

// ---- why nobody works

export type QuietKind = "owner" | "blocked" | "nothing_ready" | "paused" | "queued";
export type QuietFacts = {
  // What waits on the owner: tickets at Te toca, by title, and the floor's move (the server's next_move texto).
  owner: string[];
  move: string | null;
  // Open tickets held by a blocker or by another ticket, with the reason the server gave.
  blocked: { title: string; reason: string | null }[];
  // Tickets Ready to start, and how many are left for later.
  ready: string[];
  later: number;
  // PLA-47: the tickets left for later, by title, and why each waits (the server's reason; an older server sends none).
  laterOnes?: { title: string; reason: string | null }[];
  paused: "company" | "project" | null;
  // The teammate who takes the next Ready ticket, when, and what holds the runner back, if it said.
  queued: { who: string; at: string | null; hold?: string | null } | null;
};
export type Quiet = { kind: QuietKind; text: string };

const more = (n: number, language: Language) => (n > 0 ? W(language).more(n) : "");
const end = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

// What holds the runner back (the server's next_start.hold), said after «la próxima ronda».
export function quietReason(f: QuietFacts, language: Language = getLanguage()): Quiet {
  const w = W(language);
  if (f.owner.length > 0) return { kind: "owner", text: w.yourTurn(`${q(f.owner[0], language)}${more(f.owner.length - 1, language)}.`) };
  if (f.move) return { kind: "owner", text: w.yourTurn(end(f.move.charAt(0).toLowerCase() + f.move.slice(1))) };
  if (f.ready.length === 0 && f.blocked.length > 0) {
    const b = f.blocked[0]!;
    return { kind: "blocked", text: w.allBlocked(`${q(b.title, language)}${b.reason ? ` (${b.reason.replace(/[.\s]+$/, "")})` : ""}${more(f.blocked.length - 1, language)}`) };
  }
  if (f.ready.length === 0) {
    if (f.later === 0) return { kind: "nothing_ready", text: w.nothingReadyAsk };
    const head = f.later === 1 ? w.laterOne : w.laterMany(f.later);
    // PLA-47: name up to two of them and why each waits, so the owner sees what is next without opening the board.
    const named = (f.laterOnes ?? []).slice(0, 2).map((t) => `${q(t.title, language)}${t.reason ? ` (${t.reason.replace(/[.\s]+$/, "").replace(/^./, (c) => c.toLowerCase())})` : ""}`);
    const list = named.length ? `: ${named.join("; ")}${more(f.later - named.length, language)}` : "";
    return { kind: "nothing_ready", text: w.nothingReady(`${head}${list}`) };
  }
  if (f.paused) return { kind: "paused", text: f.paused === "company" ? w.companyPaused : w.projectPaused };
  const who = f.queued?.who ?? w.theTeam;
  const rest = f.ready.length - 1;
  const hold = w.hold[f.queued?.hold ?? ""] ?? "";
  return { kind: "queued", text: `${w.queued(q(f.ready[0], language), who, f.queued?.at ?? null, hold)}${rest > 0 ? w.moreInLine(rest) : ""}` };
}

const clockAt = (iso: string, timeZone?: string) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone })
    .format(new Date(iso))
    .replace(/\s?([AP])M$/, (_, x: string) => ` ${x.toLowerCase()}m`);

const openTickets = (p: Pick<OrgProject, "tablero">): ProjectTicket[] => {
  const t = p.tablero;
  if (!t) return [];
  return [...t.initiatives.flatMap((i) => i.tickets), ...t.loose].filter((x) => !isDone(x.etapa));
};

export function quietFacts(p: Pick<OrgProject, "team" | "tablero" | "next_move" | "paused" | "light">, now: number, opts: { companyPaused?: boolean; timeZone?: string } = {}): QuietFacts {
  const open = openTickets(p);
  const of = (ids: EtapaId[]) => open.filter((t) => ids.includes(t.etapa.etapa));
  const ready = of(["lista"]);
  // Who takes the next Ready ticket: the teammate whose next start names it, else the first who has a next start.
  const starts = [...p.team].sort(byRole).filter((m) => m.next_start);
  const next = starts.find((m) => ready.some((t) => t.key === m.next_start!.key)) ?? starts[0];
  const ns: OrgNextStart | null = next?.next_start ?? null;
  return {
    owner: of(["te_toca"]).map((t) => t.title),
    move: p.next_move?.texto ?? null,
    blocked: of(["bloqueado", "en_espera"]).map((t) => ({ title: t.title, reason: t.etapa.reason })),
    ready: ready.map((t) => t.title),
    later: of(["despues", "pospuesto"]).length,
    laterOnes: of(["despues", "pospuesto"]).map((t) => ({ title: t.title, reason: t.etapa.reason })),
    paused: opts.companyPaused ? "company" : p.paused || p.light === "paused" ? "project" : null,
    queued: next ? { who: roleName(next.role), at: ns?.starts_at && Date.parse(ns.starts_at) > now ? clockAt(ns.starts_at, opts.timeZone) : null, hold: ns?.hold ?? null } : null,
  };
}

// ---- the line

export type AhoraView = {
  working: boolean;
  // The dot's colour: the newest obra's stage, else grey.
  tone: StageTone | "idle";
  // One sentence per obra, newest first.
  lines: { key: string; agent: string; station: StationId | null; tone: StageTone; text: string }[];
  // The second line: in the working form, what waits on the owner and who is idle; in the quiet form, the reason.
  why: string;
  quiet: Quiet | null;
  // A ticket sent back that nobody has picked up yet (the server lists it in ahora, not live).
  returned: string | null;
  obras: Obra[];
};
/** The quiet form's sentence in Spanish (kept for the tests); words(AHORA_PISO_WORDS).quietSay is the screen's. */
export const QUIET_SAY = AHORA_PISO_WORDS.es.quietSay;

type ViewCard = Pick<OrgProject, "team" | "ahora" | "tablero" | "next_move" | "paused" | "light">;
export function ahoraView(p: ViewCard, now: number, opts: { companyPaused?: boolean; timeZone?: string } = {}, language: Language = getLanguage()): AhoraView {
  const w = W(language);
  const obras = obrasOf(p, opts);
  const facts = quietFacts(p, now, opts);
  const back = (p.ahora ?? []).filter((a) => a.etapa === "devuelto" && !a.live && !obras.some((o) => o.key === a.key));
  const returned = back.length ? w.returned(q(back[0]!.title, language), roleName(back[0]!.holder?.role ?? "taller", language), more(back.length - 1, language)) : null;
  if (obras.length === 0) {
    const quiet = quietReason(facts, language);
    return { working: false, tone: "idle", lines: [], why: quiet.text, quiet, returned, obras };
  }
  const busy = new Set(obras.map((o) => o.agent));
  const idle = opts.companyPaused || p.paused ? [] : [...p.team].sort(byRole).filter((m) => !busy.has(m.agent) && m.state !== "paused");
  const owner = facts.owner.length || facts.move ? quietReason(facts, language).text : null;
  const why = [owner, idle.length ? w.idleNow(idle.map((m) => roleName(m.role, language)).join(", ")) : null].filter(Boolean).join(" ");
  return {
    working: true,
    tone: obras[0]!.tone,
    lines: obras.map((o, i) => ({ key: o.key ?? `run-${o.agent}-${i}`, agent: o.agent, station: o.station, tone: o.tone, text: obraLine(o, now, language) })),
    why,
    quiet: null,
    returned,
    obras,
  };
}
