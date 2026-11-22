// Inicio's model, apart from the markup: the headline sentence, who is working now, each project's
// tile and the servers en uso (the city of initiatives lives in city.ts). Pure functions over the /api shapes, so
// test/home.test.ts can load this file with node:test.
import { buildLanes, projectProgress, type LaneTask, type StationTone } from "./lanes.js";
import { ago, span } from "./time.js";
import type { EnvSummary, FootprintItem, InitiativeNote, MachineTotals, NextClaimable, Readiness } from "./types.js";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

// PLA-I2-10: the words are in HOME_WORDS, in both languages; each function takes the language last.
export const HOME_WORDS = defineWords({
  es: {
    numbers: ["Ningún", "Un", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve"],
    and: "y",
    // the headline
    nobody: "Nadie trabaja ahora.",
    working: (word: string, n: number) => `${word} ${n === 1 ? "agente trabaja" : "agentes trabajan"} ahora.`,
    moving: (names: string, n: number) => `${names} ${n === 1 ? "avanza sola" : "avanzan solas"}`,
    doneToday: (n: number) => `Hoy ${n === 1 ? "se cerró 1 ticket" : `se cerraron ${n} tickets`}`,
    noneToday: "Hoy no se cerró nada",
    nothingWaits: "nada te espera",
    theMachine: "la máquina",
    twoAndMore: (a: string, b: string, n: number) => `${a} y ${b} y ${n} más`,
    waits: (shown: string, places: number, n: number) => `${shown} ${places === 1 ? "te espera" : "te esperan"} con ${n} ${n === 1 ? "cosa" : "cosas"}`,
    orphan: (n: number) => `${n} sin dueño`,
    stale: (n: number) => `${n} ${n === 1 ? "obsoleto" : "obsoletos"}`,
    machineHas: (list: string) => `, y la máquina tiene ${list}.`,
    // a tile
    nothingQueued: "nada en cola",
    noEnvs: "sin entornos registrados",
    branchesAhead: (n: number) => `${n} ${n === 1 ? "rama" : "ramas"} adelante`,
    dbAhead: "DB adelante del código",
    noEnv: "Sin entorno registrado",
    onEnv: (env: string) => ` en ${env}`,
    published: (where: string, ago: string) => `Publicado${where} ${ago}`,
    noPublishDate: (where: string) => `Sin fecha de publicación${where}`,
    unpublished: (n: number) => `${n} ${n === 1 ? "cambio" : "cambios"} sin publicar`,
    baseAhead: "la base va adelante del código",
    state: { moving: "en marcha", waiting: "te espera", quiet: "quieto", paused: "en pausa", upToDate: "al día" },
    system: "sistema",
  },
  en: {
    numbers: ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"],
    and: "and",
    nobody: "Nobody is working now.",
    working: (word: string, n: number) => `${word} ${n === 1 ? "agent is" : "agents are"} working now.`,
    moving: (names: string, n: number) => `${names} ${n === 1 ? "moves on its own" : "move on their own"}`,
    doneToday: (n: number) => `Today ${n === 1 ? "1 ticket was closed" : `${n} tickets were closed`}`,
    noneToday: "Nothing was closed today",
    nothingWaits: "nothing waits on you",
    theMachine: "the machine",
    twoAndMore: (a: string, b: string, n: number) => `${a} and ${b} and ${n} more`,
    waits: (shown: string, places: number, n: number) => `${shown} ${places === 1 ? "has" : "have"} ${n} ${n === 1 ? "thing" : "things"} for you`,
    orphan: (n: number) => `${n} with no owner`,
    stale: (n: number) => `${n} stale`,
    machineHas: (list: string) => `, and the machine has ${list}.`,
    nothingQueued: "nothing queued",
    noEnvs: "no environments registered",
    branchesAhead: (n: number) => `${n} ${n === 1 ? "branch" : "branches"} ahead`,
    dbAhead: "DB ahead of the code",
    noEnv: "No environment registered",
    onEnv: (env: string) => ` on ${env}`,
    published: (where: string, ago: string) => `Published${where} ${ago}`,
    noPublishDate: (where: string) => `No publish date${where}`,
    unpublished: (n: number) => `${n} unpublished ${n === 1 ? "change" : "changes"}`,
    baseAhead: "the database is ahead of the code",
    state: { moving: "running", waiting: "waiting on you", quiet: "quiet", paused: "paused", upToDate: "up to date" },
    system: "system",
  },
});

type Tone = StationTone;

/** ":3069" for a server row (the same name the Máquina gives it). */
function portOf(it: Pick<FootprintItem, "locator" | "details">): string {
  const port = typeof it.details.port === "number" ? it.details.port : it.locator.replace(/^port:/, "");
  return `:${port}`;
}

export type HomeTask = LaneTask & {
  claimed_by?: { agent: string; session_id: string; model?: string } | null;
  claimed_at?: string | null;
  last_seen_at?: string | null;
  branch?: string | null;
};

export type HomeProject = {
  slug: string;
  title: string;
  line: string;
  /** 2.11: the next step (line is the generated headline now). */
  next_line?: string;
  /** 2.11: Orden's count, the last audit run's findings. */
  audit_count?: number;
  tasks: HomeTask[];
  next_claimable: NextClaimable | null;
  envs: EnvSummary[];
  activity: number[];
  initiatives?: InitiativeNote[];
  /** 2.16: the server's readiness. A no_context project has nothing queued. */
  readiness?: Readiness;
};

type Server = Pick<FootprintItem, "kind" | "state" | "task_key" | "session_id" | "project" | "repo" | "locator" | "details" | "first_seen_at">;

export const numberWord = (n: number, language: Language = getLanguage()) => words(HOME_WORDS, language).numbers[n] ?? String(n);

/** "A", "A y B", "A, B y C". */
export function joinNames(names: string[], language: Language = getLanguage()): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${words(HOME_WORDS, language).and} ${names[names.length - 1]}`;
}

// ---- En vuelo: live claims across projects, with the server each one has up

export type Flight = {
  slug: string;
  projectTitle: string;
  key: string;
  title: string;
  agent: string;
  model: string | null;
  branch: string | null;
  /** ":3069" when a live server belongs to the ticket or the session. */
  port: string | null;
  claimedAt: string | null;
  lastSeenAt: string | null;
};

export function flightsOf(projects: HomeProject[], servers: Server[]): Flight[] {
  const live = servers.filter((s) => s.kind === "server" && s.state === "live");
  const flights: Flight[] = [];
  for (const p of projects) {
    for (const t of p.tasks) {
      if (t.kind !== "ticket" || !t.claimed_by) continue;
      const owner = t.claimed_by;
      const server = live.find((s) => s.task_key === t.key || (s.session_id && s.session_id === owner.session_id));
      flights.push({
        slug: p.slug,
        projectTitle: p.title,
        key: t.key,
        title: t.title,
        agent: owner.agent,
        model: owner.model ?? null,
        branch: t.branch ?? null,
        port: server ? portOf(server) : null,
        claimedAt: t.claimed_at ?? null,
        lastSeenAt: t.last_seen_at ?? null,
      });
    }
  }
  // Newest claim first; a claim without a start date goes last.
  return flights.sort((a: Flight, b: Flight) => (b.claimedAt ?? "").localeCompare(a.claimedAt ?? ""));
}

// ---- Counts the headline uses

/** Tickets closed since local midnight. */
export function doneToday(projects: HomeProject[], nowMs = Date.now()): number {
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const since = start.toISOString();
  return projects.reduce((n, p) => n + p.tasks.filter((t) => t.kind === "ticket" && t.status === "Done" && t.updated_at >= since).length, 0);
}

// ---- The headline: one sentence in display type, one line in the voice

export type VoicePart = { text: string; tone?: "owner" };
export type Headline = { title: string; voice: VoicePart[] };

export function headlineOf(input: {
  projects: HomeProject[];
  // Only who and where: Inicio passes its flights, Oficina (PLA-32) the teammates whose run is live.
  flights: Pick<Flight, "slug">[];
  inbox: { count: number; by_project: Record<string, number> };
  totals: Pick<MachineTotals, "orphan" | "stale"> | null;
  nowMs?: number;
}, language: Language = getLanguage()): Headline {
  const w = words(HOME_WORDS, language);
  const { projects, flights, inbox, totals } = input;
  const titleOf = (slug: string) => projects.find((p) => p.slug === slug)?.title ?? slug;
  const n = flights.length;
  const title = n === 0 ? w.nobody : w.working(numberWord(n, language), n);

  // a) who moves, or what got done
  const moving = [...new Set(flights.map((f) => f.slug))].map(titleOf);
  let a: string;
  if (moving.length > 0) a = w.moving(joinNames(moving, language), moving.length);
  else {
    const done = doneToday(projects, input.nowMs);
    a = done > 0 ? w.doneToday(done) : w.noneToday;
  }

  // b) what waits on the owner, by the project with most
  let b: VoicePart;
  if (inbox.count === 0) b = { text: w.nothingWaits };
  else {
    const slugs = Object.entries(inbox.by_project)
      .filter(([, c]) => c > 0)
      .sort((x, y) => y[1] - x[1])
      .map(([slug]) => (slug === "machine" ? w.theMachine : titleOf(slug)));
    const shown = slugs.length > 2 ? w.twoAndMore(slugs[0]!, slugs[1]!, slugs.length - 2) : joinNames(slugs, language);
    b = { text: w.waits(shown, slugs.length, inbox.count), tone: "owner" };
  }

  // c) what the machine carries that nobody owns
  const c: string[] = [];
  if (totals && totals.orphan > 0) c.push(w.orphan(totals.orphan));
  if (totals && totals.stale > 0) c.push(w.stale(totals.stale));

  const voice: VoicePart[] = [{ text: `${a}; ` }, b, { text: c.length ? w.machineHas(c.join(` ${w.and} `)) : "." }];
  return { title, voice };
}

// ---- Project tiles

export type Tile = {
  slug: string;
  title: string;
  state: { word: string; tone: Tone };
  rank: number;
  /** What is left: open initiatives (Planning, Active, Shipping) and tickets not Done (Won't do left out). */
  left: { initiatives: number; tickets: number };
  /** Tickets Done out of all of them, for the bar. */
  progress: { closed: number; total: number };
  /** Decisions in the inbox waiting on the owner for this project. */
  waiting: number;
  /** Initiatives On hold. */
  onHold: number;
  /** 2.11: Orden's count, the last audit run's findings. */
  orden: number;
  /** "Publicado hace 3 d", and what prod still lacks, in plain words. */
  deploy: { text: string; lag: string | null };
};

/** The one line a tile says next: the initiative's next_action note the server already chose, else the next ticket. */
export function nextLine(p: Pick<HomeProject, "line" | "next_line" | "next_claimable" | "readiness">, language: Language = getLanguage()): { key: string | null; text: string } {
  const nothing = words(HOME_WORDS, language).nothingQueued;
  if (p.readiness?.state === "no_context") return { key: null, text: nothing };
  const line = p.next_line ?? p.line;
  const noted = line.match(/^([A-Z][A-Z0-9]*-[A-Z0-9-]+): (.+)$/s);
  if (noted) return { key: noted[1]!, text: noted[2]!.split("\n")[0]!.trim() };
  const next = line.match(/^Siguiente: (\S+) · (.+)$/s);
  if (next) return { key: next[1]!, text: next[2]!.trim() };
  if (p.next_claimable) return { key: p.next_claimable.key, text: p.next_claimable.title };
  if (line.startsWith("En curso:") || !line.trim()) return { key: null, text: nothing };
  return { key: null, text: line };
}

export function envLine(envs: EnvSummary[], nowMs = Date.now(), language: Language = getLanguage()): string {
  const w = words(HOME_WORDS, language);
  const env = envs.find((e) => e.env === "prod") ?? envs[0];
  if (!env) return w.noEnvs;
  const parts = [`${env.env} ${env.commit ? env.commit.slice(0, 7) : "?"}`];
  if (env.deployed_at) parts.push(ago(env.deployed_at, nowMs, language));
  if (env.behind > 0) parts.push(w.branchesAhead(env.behind));
  if (env.flags.db_ahead_of_code) parts.push(w.dbAhead);
  return parts.join(" · ");
}

/** The tile's deploy line, without commit hashes: when prod last got code, and what it still lacks. */
export function deployOf(envs: EnvSummary[], nowMs = Date.now(), language: Language = getLanguage()): Tile["deploy"] {
  const w = words(HOME_WORDS, language);
  const env = envs.find((e) => e.env === "prod") ?? envs[0];
  if (!env) return { text: w.noEnv, lag: null };
  const where = env.env === "prod" ? "" : w.onEnv(env.env);
  const text = env.deployed_at ? w.published(where, ago(env.deployed_at, nowMs, language)) : w.noPublishDate(where);
  const lag: string[] = [];
  if (env.behind > 0) lag.push(w.unpublished(env.behind));
  if (env.flags.db_ahead_of_code) lag.push(w.baseAhead);
  return { text, lag: lag.length ? lag.join(" · ") : null };
}

export function tileOf(p: HomeProject, waiting: number, nowMs = Date.now(), language: Language = getLanguage()): Tile {
  const word = words(HOME_WORDS, language).state;
  const lanes = buildLanes(p.tasks);
  // En marcha means someone is on it now: a live claim, or a PR open for review. Merged or Released
  // with nobody on it is waiting to be closed, not moving.
  const moving = p.tasks.some((t) => t.kind === "ticket" && (t.claimed_by || t.status === "In review"));
  // En pausa is what the owner paused: open work, all of it under initiatives On hold. A project with nothing open is
  // al día, not paused (it used to read "en pausa" beside "Todo hecho", and a paused one read "quieto").
  const paused = lanes.length > 0 && lanes.every((l) => l.initiative?.status === "On hold");
  const state =
    moving ? { word: word.moving, tone: "now" as Tone, rank: 0 }
    : waiting > 0 ? { word: word.waiting, tone: "owner" as Tone, rank: 1 }
    : paused ? { word: word.paused, tone: "pending" as Tone, rank: 3 }
    : lanes.length > 0 ? { word: word.quiet, tone: "pending" as Tone, rank: 2 }
    : { word: word.upToDate, tone: "done" as Tone, rank: 4 };
  const inits = p.tasks.filter((t) => t.kind === "initiative");
  const progress = projectProgress(p.tasks);
  return {
    slug: p.slug,
    title: p.title,
    state: { word: state.word, tone: state.tone },
    rank: state.rank,
    left: {
      initiatives: inits.filter((t) => t.status === "Planning" || t.status === "Active" || t.status === "Shipping").length,
      tickets: progress.total - progress.closed,
    },
    progress,
    waiting,
    onHold: inits.filter((t) => t.status === "On hold").length,
    orden: p.audit_count ?? 0,
    deploy: deployOf(p.envs, nowMs, language),
  };
}

// ---- La máquina: servers en uso

export type LiveServer = { port: string; owner: string; slug: string | null; up: string };

export function liveServersOf(items: Server[], nowMs = Date.now(), language: Language = getLanguage()): LiveServer[] {
  return items
    .filter((it) => it.kind === "server" && it.state === "live")
    .map((it) => ({
      port: portOf(it),
      owner: it.project ?? it.repo ?? words(HOME_WORDS, language).system,
      slug: it.project,
      up: it.first_seen_at ? span(it.first_seen_at, nowMs, language) : "",
    }))
    .sort((a, b) => a.owner.localeCompare(b.owner) || a.port.localeCompare(b.port, undefined, { numeric: true }));
}
