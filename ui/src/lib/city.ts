// Inicio's city: every open initiative is a tower in its project's district. Windows are its
// tickets, lit from the ground up as work closes; a crane means agents are on it; a red beacon
// means it is shipping; scaffolding means it is still being planned; a searchlight means it waits
// on the owner. Pure functions over the /api shapes, so test/city.test.ts can load this file.
import type { InboxItem, InitiativeNote } from "./types.js";

export type CityTask = {
  key: string;
  kind: "initiative" | "ticket" | "idea";
  title: string;
  status: string;
  parent_key: string | null;
  claimed_by?: { agent: string; session_id: string; model?: string } | null;
};

export type CityProject = {
  slug: string;
  title: string;
  tasks: CityTask[];
  initiatives?: InitiativeNote[];
};

/** One window per ticket. lit: Done; the rest by where the ticket stands. */
export type WindowTone = "lit" | "review" | "now" | "owner" | "blocked" | "ready" | "dark";

/** planning: scaffolding. building: Active. shipping: beacon on top. paused: On hold, lights off. */
export type Stage = "planning" | "building" | "shipping" | "paused";

export type Agent = { key: string; title: string; agent: string; model: string | null };

export type Tower = {
  key: string;
  slug: string;
  title: string;
  status: string;
  stage: Stage;
  /** Bottom-up: the first window is the lowest. */
  windows: WindowTone[];
  /** How many windows per floor: wider towers for long initiatives, so none outgrows the sky. */
  columns: number;
  closed: number;
  total: number;
  agents: Agent[];
  /** A ticket is En curso or En revisión: only these stand in the skyline. */
  working: boolean;
  /** Something here waits on the owner: an inbox item, a ticket in Needs owner, or a next step addressed to them with nobody working. */
  waits: boolean;
  /** Still on paper and waiting for the owner's go: planning, and no ticket started yet. */
  awaitsGo: boolean;
  /** The inbox items that belong to this initiative or its tickets. */
  inbox: InboxItem[];
  /** What it needs next, else what it is doing. */
  note: string;
  inProgress: string;
};

export type District = { slug: string; title: string; towers: Tower[] };

const OPEN_INITIATIVE = new Set(["Planning", "Active", "Shipping", "On hold"]);

// Lowest floors first: what is finished, then what is being finished, then what is still ahead.
const WINDOW_OF: Record<string, WindowTone> = {
  Done: "lit",
  Released: "review",
  Merged: "review",
  "In review": "review",
  "In progress": "now",
  "Needs owner": "owner",
  Blocked: "blocked",
  Ready: "ready",
  Backlog: "dark",
};
const FLOOR_ORDER: WindowTone[] = ["lit", "review", "now", "owner", "blocked", "ready", "dark"];

const STAGE_OF: Record<string, Stage> = { Planning: "planning", Active: "building", Shipping: "shipping", "On hold": "paused" };

/** Two windows a floor up to 20 tickets, then three, then four: the tallest tower stays about ten floors. */
export const columnsFor = (n: number) => (n <= 20 ? 2 : n <= 45 ? 3 : 4);

/**
 * A next step that is the owner's now, as agents write them: "Owner: …", "The owner to …",
 * "Esperar el OK del dueño …". Each sentence counts only up to its "then" / "luego", so
 * "Get CI green, then the owner merges" is still the agent's; "skipped by the owner" is history, not a request.
 * PLA-I2-14: the owner's display name (name) counts too, and the first owner's name until protocol 2.25.
 */
export function addressedToOwner(note: string, name?: string | null): boolean {
  const named = name?.trim() ? String.raw`|${name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\p{L}\p{N}])` : "";
  const who = new RegExp(String.raw`(?<!\b(?:by|por)\s)(?:\bOwner\b|\b[Tt]he owner\b|\b(?:[Ee]l|de)l? due[ñn]o|\bJorge\b${named})`, "u");
  return note
    .split(/[.;\n]+/)
    .map((sentence) => sentence.split(/\b(?:then|luego|después|al día siguiente)\b/i)[0]!)
    .some((now) => who.test(now));
}

const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key, undefined, { numeric: true });

export function towerOf(p: CityProject, initiative: CityTask, inbox: InboxItem[]): Tower {
  const tickets = p.tasks.filter((t) => t.kind === "ticket" && t.parent_key === initiative.key && t.status !== "Won't do");
  const windows = tickets
    .map((t) => WINDOW_OF[t.status] ?? "dark")
    .sort((a, b) => FLOOR_ORDER.indexOf(a) - FLOOR_ORDER.indexOf(b));
  const agents = tickets
    .filter((t) => t.claimed_by)
    .sort(byKey)
    .map((t) => ({ key: t.key, title: t.title, agent: t.claimed_by!.agent, model: t.claimed_by!.model ?? null }));
  const notes = p.initiatives?.find((n) => n.key === initiative.key);
  const next = notes?.next_action ?? "";
  const keys = new Set([initiative.key, ...tickets.map((t) => t.key)]);
  const mine = inbox.filter((i) => i.project === p.slug && ((i.key && keys.has(i.key)) || i.parent_key === initiative.key));
  const stage = STAGE_OF[initiative.status] ?? "building";
  const waits = mine.length > 0 || windows.includes("owner") || (agents.length === 0 && stage !== "paused" && addressedToOwner(next));
  return {
    key: initiative.key,
    slug: p.slug,
    title: initiative.title,
    status: initiative.status,
    stage,
    windows,
    columns: columnsFor(windows.length),
    closed: windows.filter((w) => w === "lit").length,
    total: windows.length,
    agents,
    working: tickets.some((t) => t.status === "In progress" || t.status === "In review"),
    waits,
    awaitsGo: waits && stage === "planning" && agents.length === 0 && windows.every((w) => w === "lit" || w === "ready" || w === "dark"),
    inbox: mine,
    note: next || notes?.in_progress || "",
    inProgress: notes?.in_progress ?? "",
  };
}

/** One district per project with open initiatives, in slug order; towers in key order. Order never depends on state, so nothing jumps while agents write. */
export function cityOf(projects: CityProject[], inbox: InboxItem[]): District[] {
  return [...projects]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      towers: p.tasks
        .filter((t) => t.kind === "initiative" && OPEN_INITIATIVE.has(t.status))
        .sort(byKey)
        .map((i) => towerOf(p, i, inbox)),
    }))
    .filter((d) => d.towers.length > 0);
}

/**
 * The skyline: only towers with a ticket En curso or En revisión. The rest stay in Proyectos below;
 * count what waits on the owner on the full city, so a hidden tower still reaches the headline.
 */
export function workingCity(districts: District[]): District[] {
  return districts.map((d) => ({ ...d, towers: d.towers.filter((t) => t.working) })).filter((d) => d.towers.length > 0);
}

/**
 * PLA-32: Oficina's skyline with its cranes from Compañía's reading (who is running now), the same one its headline and
 * plates use. A teammate's crane stands on the initiative its ticket belongs to (MIA-I3-2 → MIA-I3); one whose ticket
 * names no open tower goes on the district's first tower. A tower stands if it is working or has a crane.
 */
export function crewCity(districts: District[], crew: { slug: string; agent: string; ticket: string | null; title: string | null }[]): District[] {
  return districts
    .map((d) => {
      const mine = crew.filter((c) => c.slug === d.slug);
      const home = (c: (typeof mine)[number]) => d.towers.find((t) => !!c.ticket && (c.ticket === t.key || c.ticket.startsWith(`${t.key}-`)));
      const towers = d.towers.map((t) => ({ ...t, agents: mine.filter((c) => home(c) === t).map((c) => ({ key: c.ticket ?? t.key, title: c.title ?? t.title, agent: c.agent, model: null })) }));
      const shown = towers.filter((t) => t.working || t.agents.length > 0);
      const loose = mine.filter((c) => !home(c));
      if (loose.length > 0) {
        const first = shown[0] ?? towers[0];
        if (first) {
          first.agents = [...first.agents, ...loose.map((c) => ({ key: c.ticket ?? first.key, title: c.title ?? first.title, agent: c.agent, model: null }))];
          if (!shown.includes(first)) shown.unshift(first);
        }
      }
      return { ...d, towers: shown };
    })
    .filter((d) => d.towers.length > 0);
}

/** Inbox items that belong to no open initiative: they still wait on the owner, outside the skyline. */
export function looseInbox(districts: District[], inbox: InboxItem[]): InboxItem[] {
  const placed = new Set(districts.flatMap((d) => d.towers.flatMap((t) => t.inbox.map((i) => i.id))));
  return inbox.filter((i) => !placed.has(i.id));
}

const STAGE_WORD: Record<Stage, string> = { planning: "Planeando", building: "En obra", shipping: "Estreno", paused: "En pausa" };

/** "Estreno · 4/5", a tower's stage and count. */
export const stageLabel = (t: Pick<Tower, "stage" | "closed" | "total">) => `${STAGE_WORD[t.stage]} · ${t.closed}/${t.total}`;

/** Spoken name for a tower, for screen readers. */
export function towerLabel(t: Tower, projectTitle: string): string {
  const parts = [`${t.key}, ${t.title}, ${projectTitle}`, `${STAGE_WORD[t.stage].toLowerCase()}`, `${t.closed} de ${t.total} hechos`];
  if (t.agents.length) parts.push(`${t.agents.length} ${t.agents.length === 1 ? "agente trabaja" : "agentes trabajan"}`);
  if (t.waits) parts.push("te toca");
  return parts.join(", ");
}

/**
 * What waits on the owner, for the headline and the project tiles: the inbox, plus each tower with a ticket
 * in Needs owner and nothing in the inbox. A next step that only names him lights the tower's
 * searchlight but is not counted: it is a guess from the text, not a request.
 */
export function waitingOf(districts: District[], inbox: InboxItem[]): { count: number; by_project: Record<string, number> } {
  const by_project: Record<string, number> = {};
  for (const i of inbox) by_project[i.project] = (by_project[i.project] ?? 0) + 1;
  for (const t of districts.flatMap((d) => d.towers)) {
    if (t.windows.includes("owner") && t.inbox.length === 0) by_project[t.slug] = (by_project[t.slug] ?? 0) + 1;
  }
  return { count: Object.values(by_project).reduce((a, b) => a + b, 0), by_project };
}
