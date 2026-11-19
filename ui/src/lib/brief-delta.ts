// PLA-I63: the Morning brief as Compañía's delta (PLA-IDEA26, sketch 2 «la desembocadura»). Pure, so the tests call
// it directly: the words of the page (the date line, the headline that rewrites itself) and the delta's model. One
// stream per project of the brief (stations() of brief-city.ts, «Entre apps» last): its lights in order (new ideas
// near the source, what follows, what waits on the owner, a blocker last as a dam), the stream's width (what is open), the
// line under its name; every stream meets at «Tú»; what is settled leaves by the river of Resuelto.
import { CROSS, type BriefStateReply, type IdeaFate, type Item, type ItemState, type ActionId } from "@/lib/brief";
import type { Ink } from "@/lib/brief-row";
import { cardsOf, type CityCard, type Station } from "@/lib/brief-city";
import { BRIEF_LABELS } from "@/lib/brief-i18n";
import { LOCALE } from "./locale.js";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

// PLA-I2-10: the delta's words in both languages (the brief's own labels stay in brief-i18n.ts).
export const DELTA_WORDS = defineWords({
  es: {
    num: ["cero", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuna", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve", "treinta"],
    kickToday: (day: string, time: string) => `Brief · ${day} · generado ${time}`,
    kickPast: (day: string) => `Brief del ${day} · solo lectura`,
    waitingBuild: "Esperando la construcción en curso",
    generating: (min: number) => `Generando… ${min} min`,
    stillShowing: (what: string, time: string) => `${what} · sigues viendo el de las ${time}`,
    kickNone: (day: string) => `Brief · ${day}`,
    allDone: "Todo resuelto por hoy.",
    tomorrow: (runAt: string) => `El brief de mañana llega a las ${runAt}.`,
    nothing: "Nada en el brief de hoy.",
    tomorrowShort: (runAt: string) => `El de mañana llega a las ${runAt}.`,
    left: (open: string, total: string) => `Quedan ${open} de ${total}.`,
    things: (n: number, word: string) => `${word} ${n === 1 ? "cosa" : "cosas"} esta mañana.`,
    blocks: (n: number, word: string) => `${word} bloquea${n > 1 ? "n" : ""}`,
    waits: (n: number, word: string) => `${word} te espera${n > 1 ? "n" : ""}`,
    both: (b: string, n: string) => `${b} y ${n}.`,
    quiet: "Nada te espera: lo demás puede seguir solo.",
    noBrief: {
      empty: (runAt: string) => ({ l1: "Aún no hay brief.", l2: `Corre a las ${runAt}, o genéralo ahora.` }),
      off: { l1: "El brief está apagado.", l2: "Enciéndelo en Ajustes." },
      failed: { l1: "No se pudo leer el brief.", l2: "Si la máquina está dormida, intenta al despertar." },
      loading: { l1: "Leyendo el brief…" },
    },
    dayNeeds: (n: number) => (n === 1 ? "1 te tocaba" : `${n} te tocaban`),
    dayIdeas: (n: number) => (n === 1 ? "1 idea" : `${n} ideas`),
    verbs: { question: "Responder", step: "Tu paso", release: "Publicar", start: "Empezar", accept: "Aceptar", fix: "Corregir", runs: "Activar", initiative: "Construir", idea: "Decidir", see: "Ver" },
    stopsStream: "detiene el cauce",
    stopped: "detenido: tu paso",
    toca: (n: number) => `${n} te toca${n > 1 ? "n" : ""}`,
    canGoOn: "puede seguir solo",
    upToDate: "al día",
  },
  en: {
    num: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "twenty-one", "twenty-two", "twenty-three", "twenty-four", "twenty-five", "twenty-six", "twenty-seven", "twenty-eight", "twenty-nine", "thirty"],
    kickToday: (day: string, time: string) => `Brief · ${day} · generated ${time}`,
    kickPast: (day: string) => `Brief for ${day} · read only`,
    waitingBuild: "Waiting for the build in progress",
    generating: (min: number) => `Generating… ${min} min`,
    stillShowing: (what: string, time: string) => `${what} · still showing the one from ${time}`,
    kickNone: (day: string) => `Brief · ${day}`,
    allDone: "All settled for today.",
    tomorrow: (runAt: string) => `Tomorrow's brief arrives at ${runAt}.`,
    nothing: "Nothing in today's brief.",
    tomorrowShort: (runAt: string) => `Tomorrow's arrives at ${runAt}.`,
    left: (open: string, total: string) => `${open.charAt(0).toUpperCase()}${open.slice(1)} of ${total} left.`,
    things: (n: number, word: string) => `${word} ${n === 1 ? "thing" : "things"} this morning.`,
    blocks: (n: number, word: string) => `${word} block${n > 1 ? "" : "s"}`,
    waits: (n: number, word: string) => `${word} wait${n > 1 ? "" : "s"} on you`,
    both: (b: string, n: string) => `${b} and ${n}.`,
    quiet: "Nothing waits on you: the rest can go on alone.",
    noBrief: {
      empty: (runAt: string) => ({ l1: "No brief yet.", l2: `It runs at ${runAt}, or generate it now.` }),
      off: { l1: "The brief is off.", l2: "Turn it on in Settings." },
      failed: { l1: "The brief could not be read.", l2: "If the machine is asleep, try again when it wakes." },
      loading: { l1: "Reading the brief…" },
    },
    dayNeeds: (n: number) => (n === 1 ? "1 waited on you" : `${n} waited on you`),
    dayIdeas: (n: number) => (n === 1 ? "1 idea" : `${n} ideas`),
    verbs: { question: "Answer", step: "Your step", release: "Publish", start: "Start", accept: "Accept", fix: "Fix", runs: "Turn on", initiative: "Build", idea: "Decide", see: "See" },
    stopsStream: "stops the stream",
    stopped: "stopped: your step",
    toca: (n: number) => `${n} ${n > 1 ? "wait" : "waits"} on you`,
    canGoOn: "can go on alone",
    upToDate: "up to date",
  },
});

/** A count in words up to thirty, then digits (Spanish is feminine: «una cosa», «una bloquea»). */
export const numWord = (n: number, language: Language = getLanguage()): string => words(DELTA_WORDS, language).num[n] ?? String(n);
export const cap = (s: string): string => (s ? s.charAt(0).toLocaleUpperCase(LOCALE) + s.slice(1) : s);

/** «mar 17 nov» for an instant (in the brief's zone) or a local date «2026-11-16». */
export function dayShort(when: string | number, timeZone?: string): string {
  const isDate = typeof when === "string" && /^\d{4}-\d{2}-\d{2}$/.test(when);
  const d = isDate ? new Date(`${when}T12:00:00Z`) : new Date(when);
  try {
    return new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", timeZone: isDate ? "UTC" : timeZone })
      .formatToParts(d)
      .filter((p) => p.type !== "literal")
      .map((p) => p.value.replace(".", "").toLocaleLowerCase(LOCALE))
      .join(" ");
  } catch {
    return typeof when === "string" ? when.slice(0, 10) : "";
  }
}

/** «07:00» for an instant in the brief's zone. */
export function hhmm(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

export type KickInput =
  | { kind: "today"; generatedAt: string; timeZone?: string }
  | { kind: "past"; localDate: string }
  | { kind: "generating"; minutes: number; waitingBuild?: boolean; generatedAt: string | null; timeZone?: string }
  | { kind: "none"; now: number; timeZone?: string };

/** The date line over the headline. */
export function kickOf(k: KickInput, language: Language = getLanguage()): string {
  const w = words(DELTA_WORDS, language);
  switch (k.kind) {
    case "today":
      return w.kickToday(dayShort(k.generatedAt, k.timeZone), hhmm(k.generatedAt, k.timeZone));
    case "past":
      return w.kickPast(dayShort(k.localDate));
    case "generating": {
      const what = k.waitingBuild ? w.waitingBuild : w.generating(Math.max(1, k.minutes));
      return k.generatedAt ? w.stillShowing(what, hhmm(k.generatedAt, k.timeZone)) : what;
    }
    case "none":
      return w.kickNone(dayShort(k.now, k.timeZone));
  }
}

/** a: the second line is amber (something waits on the owner); q: it is quiet grey. */
export type Headline = { l1: string; l2: string; tone: "a" | "q" };
export type HeadCounts = { total: number; open: number; blocked: number; needs: number };

/** The headline: one sentence for the morning that rewrites itself as things are settled. */
export function headlineOf(c: HeadCounts, runAt = "07:00", language: Language = getLanguage()): Headline {
  const w = words(DELTA_WORDS, language);
  const num = (n: number) => numWord(n, language);
  if (c.total > 0 && c.open === 0) return { l1: w.allDone, l2: w.tomorrow(runAt), tone: "q" };
  if (c.total === 0) return { l1: w.nothing, l2: w.tomorrowShort(runAt), tone: "q" };
  const done = c.total - c.open;
  const l1 = done ? w.left(num(c.open), num(c.total)) : w.things(c.total, cap(num(c.total)));
  const b = c.blocked ? w.blocks(c.blocked, cap(num(c.blocked))) : "";
  const n = c.needs ? w.waits(c.needs, num(c.needs)) : "";
  if (b && n) return { l1, l2: w.both(b, n), tone: "a" };
  if (b) return { l1, l2: `${b}.`, tone: "a" };
  if (n) return { l1, l2: `${cap(n)}.`, tone: "a" };
  return { l1, l2: w.quiet, tone: "q" };
}

/** The headline when no brief is on screen. */
export function noBriefHeadline(kind: "empty" | "off" | "failed" | "loading", runAt = "07:00", language: Language = getLanguage()): Headline {
  const w = words(DELTA_WORDS, language).noBrief;
  // The loading line has no second line.
  return { l2: "", ...(kind === "empty" ? w.empty(runAt) : w[kind]), tone: "q" };
}

/** One earlier day in «Días anteriores»: «lun 16 nov» and «3 te tocaban · 4 ideas». */
export function dayLine(row: { local_date: string; needs: number; ideas: number }, language: Language = getLanguage()): { day: string; line: string } {
  const w = words(DELTA_WORDS, language);
  const toca = w.dayNeeds(row.needs);
  const ideas = w.dayIdeas(row.ideas);
  return { day: cap(dayShort(row.local_date)), line: `${toca} · ${ideas}` };
}

// ---- I63-2: the delta's model

export type LightKind = "idea" | "next" | "toca" | "block";
/** tag: an amber label (verb and key); key: the key beside a violet light; bare: the light alone (title in its label). */
export type LightLabel = "tag" | "key" | "bare";
export type Light = { id: string; kind: LightKind; label: LightLabel; x: number; y: number; title: string; key: string; verb: string; sub: string; card: CityCard };
export type Stream = {
  slug: string;
  name: string;
  y: number;
  lights: Light[];
  /** «+N»: the open lights past the cap, and the first of them (the button picks it). */
  more: { n: number; x: number; first: string } | null;
  /** The dam's x when an open blocker stops the stream. */
  dam: number | null;
  /** Stroke width: what the stream carries. */
  width: number;
  open: number;
  sub: string;
  amber: boolean;
};
export type Geo = { w: number; h: number; x0: number; xc: number; gx: number; gy: number; oy: number; y0: number; step: number; card: number; riverX: number; scroll: boolean };
export type DeltaCounts = { ideas: number; next: number; toca: number; blocked: number; needs: number; done: number; total: number };
export type Delta = { geo: Geo; streams: Stream[]; river: Light[]; riverMore: number; counts: DeltaCounts };

/** The cap per stream: three ideas and five rows (max_items_per_app is 5 by default; Ajustes can raise it). */
export const CAP = { ideas: 3, rows: 5, tags: 2 } as const;
const W = { idea: 32, nextKey: 88, nextBare: 34, tag: 170, bare: 36, more: 46, block: 160 } as const;

/** Where things sit for a stage of w × h (the page's main area). The card in hand takes the right. */
export function geoOf(w: number, h: number, streams: number): Geo {
  const card = w <= 1100 ? 360 : 423;
  const cardLeft = w - 32 - card;
  const gx = Math.max(560, cardLeft - 60);
  const xc = gx - 185;
  const y0 = 170;
  let oy = h - 22;
  const gy = Math.round(Math.min(oy - 120, Math.max(y0 + 120, h * 0.57)));
  const room = oy - 58 - y0;
  let step = streams > 1 ? Math.min(80, room / (streams - 1)) : 80;
  let scroll = false;
  if (step < 64) {
    step = 64;
    scroll = true;
    oy = y0 + (streams - 1) * step + 58;
  }
  return { w, h: scroll ? oy + 22 : h, x0: 198, xc, gx, gy, oy, y0, step: Math.floor(step), card: cardLeft, riverX: gx + 115, scroll };
}

/** The curve from a stream's straight run into Tú. */
export const tail = (g: Geo, y: number) => `L ${g.xc} ${y} C ${g.xc + 92} ${y}, ${g.xc + 82} ${g.gy}, ${g.gx - 20} ${g.gy} L ${g.gx} ${g.gy}`;
/** The river of Resuelto, from Tú down and out to the right. */
export const outPath = (g: Geo) => `M ${g.gx} ${g.gy} C ${g.gx} ${g.gy + 150}, ${g.gx + 25} ${g.oy}, ${g.gx + 125} ${g.oy} L ${g.w} ${g.oy}`;

/** The verb on an amber label, from what the row is about. */
export function verbOf(item: Item, st: ItemState | undefined, language: Language = getLanguage()): string {
  const v = words(DELTA_WORDS, language).verbs;
  const kind = st?.live && st.live.kind !== "gone" ? st.live.kind : item.targets?.[0]?.kind;
  switch (kind) {
    case "question":
      return v.question;
    case "step":
      return v.step;
    case "release":
      return v.release;
    case "pr":
    case "ticket":
      return item.status === "next" || item.status === "open_pr" ? v.start : v.accept;
    case "finding":
    case "env":
      return v.fix;
    case "runs":
      return v.runs;
    case "initiative":
      return v.initiative;
    case "idea":
      return v.idea;
    default:
      return v.see;
  }
}

const kindOfCard = (c: CityCard): LightKind => (c.kind === "idea" ? "idea" : c.item.status === "blocker" ? "block" : c.item.status === "needs_you" ? "toca" : "next");

function lightOf(c: CityCard, st: ItemState | undefined, name: string, language: Language): Omit<Light, "x" | "y" | "label"> {
  if (c.kind === "idea") return { id: c.id, kind: "idea", title: c.idea.title, key: c.idea.code, verb: BRIEF_LABELS[language].c.newIdea, sub: c.idea.title, card: c };
  const kind = kindOfCard(c);
  const key = c.item.ref || c.item.targets?.[0]?.key || "";
  const verb = verbOf(c.item, st, language);
  const head = kind === "block" ? `${verb}${key ? ` · ${key}` : ""}` : `${verb} ${key || name}`;
  const sub = kind === "block" ? words(DELTA_WORDS, language).stopsStream : c.item.title;
  return { id: c.id, kind, title: c.item.title, key, verb: head, sub, card: c };
}

export function countsOf(list: Station[]): DeltaCounts {
  let ideas = 0, next = 0, blocked = 0, needs = 0, done = 0, total = 0;
  for (const s of list)
    for (const c of cardsOf(s)) {
      total++;
      if (!c.open) {
        done++;
        continue;
      }
      const k = kindOfCard(c);
      if (k === "idea") ideas++;
      else if (k === "next") next++;
      else if (k === "block") blocked++;
      else needs++;
    }
  return { ideas, next, toca: blocked + needs, blocked, needs, done, total };
}

/** The line under a stream's name. */
export function streamSub(o: { blocked: boolean; toca: number; open: number }, language: Language = getLanguage()): string {
  const w = words(DELTA_WORDS, language);
  if (o.blocked) return w.stopped;
  if (o.toca) return w.toca(o.toca);
  return o.open ? w.canGoOn : w.upToDate;
}

export type DeltaInput = {
  list: Station[];
  w: number;
  h: number;
  states?: Record<string, ItemState | undefined>;
  /** The names to show (Entre apps has none of its own). */
  name?: (s: Station) => string;
  /** Settled ids in the order they were settled (the river's order); the rest follow in brief order. */
  settled?: string[];
  /** The language of the words (the screen's by default). */
  language?: Language;
};

export function deltaOf(d: DeltaInput): Delta {
  const language = d.language ?? getLanguage();
  const g = geoOf(d.w, d.h, d.list.length);
  const name = d.name ?? ((s: Station) => (s.slug === CROSS ? BRIEF_LABELS[language].c.cross : s.app.name || s.slug));
  const limit = g.xc + 30;
  const streams: Stream[] = d.list.map((s, i) => {
    const y = g.y0 + i * g.step;
    const nm = name(s);
    const open = cardsOf(s).filter((c) => c.open);
    const ideasAll = open.filter((c) => c.kind === "idea");
    const rowsAll = open.filter((c) => c.kind === "item");
    const blocks = rowsAll.filter((c) => kindOfCard(c) === "block");
    const tocas = rowsAll.filter((c) => kindOfCard(c) === "toca");
    const nexts = rowsAll.filter((c) => kindOfCard(c) === "next");
    // The cap: blockers always (they are the dam), then what waits on the owner, then what follows.
    const keepRows = [...blocks, ...tocas, ...nexts].slice(0, Math.max(CAP.rows, blocks.length));
    const ideas = ideasAll.slice(0, CAP.ideas);
    const hidden = [...ideasAll.slice(CAP.ideas), ...[...blocks, ...tocas, ...nexts].filter((c) => !keepRows.includes(c))];
    const kNext = nexts.filter((c) => keepRows.includes(c));
    const kToca = tocas.filter((c) => keepRows.includes(c));
    // Labels: next with its key, the first two «te toca» with a tag; they lose labels until the run fits.
    let nextLabel: LightLabel = "key";
    let tags = Math.min(CAP.tags, kToca.length);
    const widthOf = () =>
      28 + ideas.length * W.idea + kNext.length * (nextLabel === "key" ? W.nextKey : W.nextBare) + tags * W.tag + (kToca.length - tags) * W.bare + (hidden.length ? W.more : 0) + (blocks.length ? 20 : 0);
    const room = limit - g.x0 - (blocks.length ? W.block : 0);
    if (widthOf() > room) nextLabel = "bare";
    while (widthOf() > room && tags > 0) tags--;
    const lights: Light[] = [];
    let x = g.x0 + 28;
    for (const c of ideas) {
      lights.push({ ...lightOf(c, d.states?.[c.id], nm, language), label: "bare", x, y });
      x += W.idea;
    }
    // The sketch's columns: what follows starts at 312, what waits at 420 (when there is room).
    x = Math.max(x, Math.min(g.x0 + 114, x + 10));
    for (const c of kNext) {
      lights.push({ ...lightOf(c, d.states?.[c.id], nm, language), label: nextLabel, x, y });
      x += nextLabel === "key" ? W.nextKey : W.nextBare;
    }
    x = Math.max(x, Math.min(g.x0 + 222, room + g.x0 - (tags * W.tag + (kToca.length - tags) * W.bare)));
    kToca.forEach((c, k) => {
      const lab: LightLabel = k < tags ? "tag" : "bare";
      lights.push({ ...lightOf(c, d.states?.[c.id], nm, language), label: lab, x, y });
      x += lab === "tag" ? W.tag : W.bare;
    });
    let more: Stream["more"] = null;
    if (hidden.length) {
      more = { n: hidden.length, x, first: hidden[0]!.id };
      x += W.more;
    }
    let dam: number | null = null;
    if (blocks.length) {
      dam = Math.max(x + 20, Math.min(g.x0 + 392, limit - W.block));
      blocks.forEach((c, k) => lights.push({ ...lightOf(c, d.states?.[c.id], nm, language), label: k === 0 ? "tag" : "bare", x: dam! + k * W.bare, y }));
    }
    const toca = blocks.length + tocas.length;
    return { slug: s.slug, name: nm, y, lights, more, dam, width: open.length ? Math.min(9, 1.4 + open.length * 0.9) : 1, open: open.length, sub: streamSub({ blocked: blocks.length > 0, toca, open: open.length }, language), amber: toca > 0 };
  });
  // The river: what was settled, in the order it was settled.
  const all = d.list.flatMap((s) => cardsOf(s).map((c) => ({ c, s })));
  const settled = all.filter(({ c }) => !c.open);
  const order = d.settled ?? [];
  settled.sort((a, b) => {
    const ia = order.indexOf(a.c.id);
    const ib = order.indexOf(b.c.id);
    return (ia < 0 ? -1 : ia) - (ib < 0 ? -1 : ib);
  });
  const start = g.riverX + 190;
  const fit = Math.max(1, Math.floor((g.w - 16 - start) / 16));
  const shown = settled.slice(-fit);
  const river: Light[] = shown.map(({ c, s }, k) => ({ ...lightOf(c, d.states?.[c.id], name(s), language), label: "bare", x: start + k * 16, y: g.oy }));
  return { geo: g, streams, river, riverMore: settled.length - shown.length, counts: countsOf(d.list) };
}

/** The keys' walk: stream by stream, what waits first (blocker, te toca), then what follows, then ideas, then the river. */
export function walkOf(delta: Delta): string[] {
  const rank: Record<LightKind, number> = { block: 0, toca: 1, next: 2, idea: 3 };
  const out: string[] = [];
  for (const s of delta.streams) out.push(...[...s.lights].sort((a, b) => rank[a.kind] - rank[b.kind] || a.x - b.x).map((l) => l.id));
  return out;
}

/** The light the page starts on: the first open blocker, else the first «te toca», else the first open light. */
export function firstLight(delta: Delta): string | null {
  const ls = delta.streams.flatMap((s) => s.lights);
  return (ls.find((l) => l.kind === "block") ?? ls.find((l) => l.kind === "toca") ?? ls[0] ?? delta.river[delta.river.length - 1])?.id ?? null;
}

/** ← →: the first light of the next stream (d = 1) or the previous one (d = -1) that has one. */
export function hopStream(delta: Delta, current: string | null, d: 1 | -1): string | null {
  const n = delta.streams.length;
  if (!n) return null;
  const at = Math.max(0, delta.streams.findIndex((s) => s.lights.some((l) => l.id === current)));
  for (let k = 1; k <= n; k++) {
    const s = delta.streams[(at + d * k + n * 2) % n]!;
    const walk = walkOf({ ...delta, streams: [s] });
    if (walk.length) return walk[0]!;
  }
  return null;
}

/** J K: one step along the walk (and the river after it), wrapping. */
export function stepLight(delta: Delta, current: string | null, d: number): string | null {
  const walk = [...walkOf(delta), ...delta.river.map((l) => l.id)];
  if (!walk.length) return null;
  const i = current ? walk.indexOf(current) : -1;
  if (i < 0) return d > 0 ? walk[0]! : walk[walk.length - 1]!;
  return walk[(i + d + walk.length) % walk.length]!;
}

// ---- I63-3: what was settled in this visit, shown at once (the state poll catches up). From city.tsx (PLA-I51).
export type Local = { word: string; ink: Ink; at: string; actionId: string | null; undo: boolean; fate?: IdeaFate; line?: string; action?: ActionId };

/** The state with this visit's settled cards laid over it, so a light leaves its stream at once. */
export function mergeLocal(state: BriefStateReply | undefined, local: Record<string, Local>): BriefStateReply | undefined {
  if (!state || !Object.keys(local).length) return state;
  const items = { ...state.items };
  const ideas = { ...(state.ideas ?? {}) };
  for (const [id, l] of Object.entries(local)) {
    if (id.startsWith("d|")) {
      const was = ideas[id];
      if (!was || was.state === "open") ideas[id] = { state: l.fate ?? "kept", line: l.line ?? null, key: null, action_id: l.actionId, undo: l.undo, at: l.at, project: was?.project ?? "", paused: was?.paused ?? false };
    } else {
      const was = items[id];
      if (was && was.state === "open") items[id] = { ...was, state: l.action === "later" ? "later" : l.action === "dismiss" ? "dismissed" : "handled", line: l.line ?? was.line, action_id: l.actionId, undo: l.undo, at: l.at, action: l.action ?? null };
    }
  }
  return { ...state, items, ideas };
}

/** After a light is settled: the next open light of the same stream, else the next open one anywhere. */
export function nextAfter(delta: Delta, settledId: string): string | null {
  const walk = walkOf(delta);
  const s = delta.streams.find((x) => x.lights.some((l) => l.id === settledId));
  const same = s ? walkOf({ ...delta, streams: [s] }).filter((id) => id !== settledId) : [];
  if (same.length) return same[0]!;
  const i = walk.indexOf(settledId);
  const order = [...walk.slice(i + 1), ...walk.slice(0, Math.max(i, 0))].filter((id) => id !== settledId);
  return order[0] ?? null;
}
