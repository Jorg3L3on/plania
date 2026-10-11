// Inicio's model, apart from the markup: the headline sentence, who is working now, each project's
// tile and the servers en uso (the city of initiatives lives in city.ts). Pure functions over the /api shapes, so
// test/home.test.ts can load this file with node:test.
import { buildLanes, projectProgress, type LaneTask, type StationTone } from "./lanes.js";
import { ago, span } from "./time.js";
import type { EnvSummary, FootprintItem, InitiativeNote, MachineTotals, NextClaimable } from "./types.js";

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
  tasks: HomeTask[];
  next_claimable: NextClaimable | null;
  envs: EnvSummary[];
  activity: number[];
  initiatives?: InitiativeNote[];
};

type Server = Pick<FootprintItem, "kind" | "state" | "task_key" | "session_id" | "project" | "repo" | "locator" | "details" | "first_seen_at">;

const WORDS = ["Ningún", "Un", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve"];
export const numberWord = (n: number) => WORDS[n] ?? String(n);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "A", "A y B", "A, B y C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
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

export type VoicePart = { text: string; tone?: "jorge" };
export type Headline = { title: string; voice: VoicePart[] };

export function headlineOf(input: {
  projects: HomeProject[];
  flights: Flight[];
  inbox: { count: number; by_project: Record<string, number> };
  totals: Pick<MachineTotals, "orphan" | "stale"> | null;
  nowMs?: number;
}): Headline {
  const { projects, flights, inbox, totals } = input;
  const titleOf = (slug: string) => projects.find((p) => p.slug === slug)?.title ?? slug;
  const n = flights.length;
  const title = n === 0 ? "Nadie trabaja ahora." : `${numberWord(n)} ${n === 1 ? "agente trabaja" : "agentes trabajan"} ahora.`;

  // a) who moves, or what got done
  const moving = [...new Set(flights.map((f) => f.slug))].map(titleOf);
  let a: string;
  if (moving.length > 0) a = `${joinNames(moving)} ${moving.length === 1 ? "avanza sola" : "avanzan solas"}`;
  else {
    const done = doneToday(projects, input.nowMs);
    a = done > 0 ? `Hoy ${done === 1 ? "se cerró 1 ticket" : `se cerraron ${done} tickets`}` : "Hoy no se cerró nada";
  }

  // b) what waits on Jorge, by the project with most
  let b: VoicePart;
  if (inbox.count === 0) b = { text: "nada te espera" };
  else {
    const slugs = Object.entries(inbox.by_project)
      .filter(([, c]) => c > 0)
      .sort((x, y) => y[1] - x[1])
      .map(([slug]) => (slug === "machine" ? "la Mac" : titleOf(slug)));
    const shown = slugs.length > 2 ? `${slugs[0]} y ${slugs[1]} y ${slugs.length - 2} más` : joinNames(slugs);
    const verb = slugs.length === 1 ? "te espera" : "te esperan";
    b = { text: `${shown} ${verb} con ${plural(inbox.count, "cosa", "cosas")}`, tone: "jorge" };
  }

  // c) what the Mac carries that nobody owns
  const c: string[] = [];
  if (totals && totals.orphan > 0) c.push(`${totals.orphan} sin dueño`);
  if (totals && totals.stale > 0) c.push(plural(totals.stale, "obsoleto", "obsoletos"));

  const voice: VoicePart[] = [{ text: `${a}; ` }, b, { text: c.length ? `, y la Mac tiene ${c.join(" y ")}.` : "." }];
  return { title, voice };
}

// ---- Project tiles

export type Tile = {
  slug: string;
  title: string;
  state: { word: string; tone: Tone };
  rank: number;
  progress: { closed: number; total: number };
  /** "prod aa5e1ea · hace 2 d · 1 rama adelante", or why there is none. */
  envLine: string;
  nextKey: string | null;
  nextText: string;
  /** 0–100 per day, oldest first. */
  bars: number[];
};

const NO_CARD = "Sin ficha.";

/** The one line a tile says next: the initiative's next_action note the server already chose, else the next ticket. */
export function nextLine(p: Pick<HomeProject, "line" | "next_claimable">): { key: string | null; text: string } {
  const line = p.line;
  const noted = line.match(/^([A-Z][A-Z0-9]*-[A-Z0-9-]+): (.+)$/s);
  if (noted) return { key: noted[1]!, text: noted[2]!.split("\n")[0]!.trim() };
  const next = line.match(/^Siguiente: (\S+) · (.+)$/s);
  if (next) return { key: next[1]!, text: next[2]!.trim() };
  if (p.next_claimable) return { key: p.next_claimable.key, text: p.next_claimable.title };
  if (line.startsWith("En curso:") || line === NO_CARD || !line) return { key: null, text: "nada en cola" };
  return { key: null, text: line };
}

export function envLine(envs: EnvSummary[], nowMs = Date.now()): string {
  const env = envs.find((e) => e.env === "prod") ?? envs[0];
  if (!env) return "sin entornos registrados";
  const parts = [`${env.env} ${env.commit ? env.commit.slice(0, 7) : "?"}`];
  if (env.deployed_at) parts.push(ago(env.deployed_at, nowMs));
  if (env.behind > 0) parts.push(`${env.behind} ${env.behind === 1 ? "rama" : "ramas"} adelante`);
  if (env.flags.db_ahead_of_code) parts.push("DB adelante del código");
  return parts.join(" · ");
}

export function tileOf(p: HomeProject, waiting: number, nowMs = Date.now()): Tile {
  const lanes = buildLanes(p.tasks);
  const moving = lanes.some((l: { state: string }) => l.state === "moving");
  const state =
    moving ? { word: "en marcha", tone: "now" as Tone, rank: 0 }
    : waiting > 0 ? { word: "te espera", tone: "jorge" as Tone, rank: 1 }
    : lanes.length > 0 ? { word: "quieto", tone: "pending" as Tone, rank: 2 }
    : { word: "en pausa", tone: "pending" as Tone, rank: 3 };
  const max = Math.max(1, ...p.activity);
  const next = nextLine(p);
  return {
    slug: p.slug,
    title: p.title,
    state: { word: state.word, tone: state.tone },
    rank: state.rank,
    progress: projectProgress(p.tasks),
    envLine: envLine(p.envs, nowMs),
    nextKey: next.key,
    nextText: next.text,
    bars: p.activity.map((n) => Math.round((n / max) * 100)),
  };
}

// ---- La Mac: servers en uso

export type LiveServer = { port: string; owner: string; slug: string | null; up: string };

export function liveServersOf(items: Server[], nowMs = Date.now()): LiveServer[] {
  return items
    .filter((it) => it.kind === "server" && it.state === "live")
    .map((it) => ({
      port: portOf(it),
      owner: it.project ?? it.repo ?? "sistema",
      slug: it.project,
      up: it.first_seen_at ? span(it.first_seen_at, nowMs) : "",
    }))
    .sort((a, b) => a.owner.localeCompare(b.owner) || a.port.localeCompare(b.port, undefined, { numeric: true }));
}
