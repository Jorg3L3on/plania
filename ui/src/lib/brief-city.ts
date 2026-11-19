// PLA-I51: what the city at dawn shows, as pure functions (tests call them without a browser). One station (tower)
// per app of the brief, in brief order, "Entre apps" last. A station holds the app's rows (blockers first, then brief
// order, at most max_items_per_app) and its new ideas; each row and idea is one window. Counts are the open rows by
// kind; the sky's progress is handled / total, the same numbers as V2's deskCounts.
import { CROSS, type BriefApp, type BriefData, type BriefStateReply, type Idea, type IdeaInMotion, type Item, type Status } from "@/lib/brief";
import type { CityCounts } from "@/lib/brief-i18n";

export type WindowTone = "blocked" | "owner" | "ready" | "review" | "lit";
export type CityCard = { kind: "item"; id: string; item: Item; open: boolean } | { kind: "idea"; id: string; idea: Idea; open: boolean };
export type Station = {
  slug: string;
  app: BriefApp;
  items: Extract<CityCard, { kind: "item" }>[];
  ideas: Extract<CityCard, { kind: "idea" }>[];
  /** Ideas of this project already in Plania and not planned yet, and how many are planned. */
  inPlania: IdeaInMotion[];
  planned: number;
  windows: { id: string; tone: WindowTone }[];
  counts: CityCounts;
  open: number;
  total: number;
};

const RANK: Record<Status, number> = { blocker: 0, needs_you: 1, next: 2, open_pr: 3 };
const TONE: Record<Status, WindowTone> = { blocker: "blocked", needs_you: "owner", next: "ready", open_pr: "ready" };

export const itemOpen = (item: Item, state: BriefStateReply | undefined) => (state?.items[item.id]?.state ?? "open") === "open";
/** An idea card is open until it has a fate, was sent to Plania (V1) or checked. */
export const ideaOpen = (idea: Idea, state: BriefStateReply | undefined, checks: readonly string[], sentCodes: ReadonlySet<string>) =>
  (state?.ideas?.[idea.id]?.state ?? "open") === "open" && !checks.includes(idea.id) && !sentCodes.has(idea.code);

export function stations(
  data: BriefData,
  state: BriefStateReply | undefined,
  o: { checks?: readonly string[]; sentCodes?: ReadonlySet<string>; maxItems?: number } = {},
): Station[] {
  const checks = o.checks ?? [];
  const sent = o.sentCodes ?? new Set<string>();
  const max = o.maxItems ?? Infinity;
  const apps = [...data.apps.filter((a) => a.id !== CROSS), ...data.apps.filter((a) => a.id === CROSS)];
  const known = new Set(apps.map((a) => a.id));
  // A row whose app is not listed goes to Entre apps (the brief's own rule for cross rows).
  const appOf = (id: string) => (known.has(id) ? id : CROSS);
  if (!known.has(CROSS) && [...data.items, ...data.ideas].some((x) => !known.has(x.app))) apps.push({ id: CROSS, name: "", color: "other" });
  const motion = state?.in_motion ?? [];
  return apps
    .map((app) => {
      const items = data.items
        .map((item, i) => ({ item, i }))
        .filter(({ item }) => appOf(item.app) === app.id)
        .sort((a, b) => RANK[a.item.status] - RANK[b.item.status] || a.i - b.i)
        .slice(0, max)
        .map(({ item }) => ({ kind: "item" as const, id: item.id, item, open: itemOpen(item, state) }));
      const ideas = data.ideas.filter((i) => appOf(i.app) === app.id).map((idea) => ({ kind: "idea" as const, id: idea.id, idea, open: ideaOpen(idea, state, checks, sent) }));
      const mine = motion.filter((m) => m.project === app.id);
      const counts: CityCounts = {
        blocked: items.filter((c) => c.open && c.item.status === "blocker").length,
        needs: items.filter((c) => c.open && c.item.status === "needs_you").length,
        next: items.filter((c) => c.open && (c.item.status === "next" || c.item.status === "open_pr")).length,
        ideas: ideas.filter((c) => c.open).length,
      };
      const windows = [
        ...items.map((c) => ({ id: c.id, tone: c.open ? TONE[c.item.status] : ("lit" as const) })),
        ...ideas.map((c) => ({ id: c.id, tone: c.open ? ("review" as const) : ("lit" as const) })),
      ];
      return {
        slug: app.id,
        app,
        items,
        ideas,
        inPlania: mine.filter((m) => !m.promoted_to && m.next !== "planned"),
        planned: mine.filter((m) => !!m.promoted_to || m.next === "planned").length,
        windows,
        counts,
        open: counts.blocked + counts.needs + counts.next + counts.ideas,
        total: items.length + ideas.length,
      };
    })
    .filter((s) => s.slug !== CROSS || s.total > 0);
}

/** The sky: what is left and what was handled, over every station. */
export function skyCounts(list: Station[]) {
  const total = list.reduce((n, s) => n + s.total, 0);
  const left = list.reduce((n, s) => n + s.open, 0);
  return { left, handled: total - left, total, p: total ? (total - left) / total : 0 };
}

/** The station the page opens on: the first with an open blocker, else the first with something open, else the first. */
export function firstStation(list: Station[]): number {
  const b = list.findIndex((s) => s.counts.blocked > 0);
  if (b >= 0) return b;
  const o = list.findIndex((s) => s.open > 0);
  return o >= 0 ? o : 0;
}

/** The next station with something open after i (wrapping), or -1. */
export function nextWithWork(list: Station[], i: number): number {
  for (let k = 1; k <= list.length; k++) {
    const j = (i + k) % list.length;
    if (list[j]!.open > 0 && j !== i) return j;
  }
  return -1;
}

/** A station's cards in the order the keys walk them: rows, then new ideas. */
export const cardsOf = (s: Station): CityCard[] => [...s.items, ...s.ideas];

/** The card in hand: the picked one if it is still on the station, else the first open card, else the first. */
export function pickCard(s: Station, picked: string | null | undefined): CityCard | undefined {
  const cards = cardsOf(s);
  return (picked ? cards.find((c) => c.id === picked) : undefined) ?? cards.find((c) => c.open) ?? cards[0];
}

/** After a card is handled: the next open card of the station after it (wrapping), or undefined when none is open. */
export function nextOpenCard(s: Station, afterId: string): CityCard | undefined {
  const cards = cardsOf(s);
  const i = cards.findIndex((c) => c.id === afterId);
  const order = [...cards.slice(i + 1), ...cards.slice(0, Math.max(i, 0))];
  return order.find((c) => c.open && c.id !== afterId);
}

/** One step through the station's cards (d = 1 or -1), wrapping. */
export function stepCard(s: Station, currentId: string | undefined, d: number): CityCard | undefined {
  const cards = cardsOf(s);
  if (!cards.length) return undefined;
  const i = Math.max(0, cards.findIndex((c) => c.id === currentId));
  return cards[(i + d + cards.length) % cards.length];
}

export type KeyCommand = "next" | "prev" | "nextProject" | "prevProject" | "primary" | "later" | "dismiss" | "undo" | "escape";

/** What a key does on the page; null while typing in a field, with a modifier, or for any other key. */
export function keyCommand(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null }): KeyCommand | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const t = e.target;
  const tag = (t?.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return e.key === "Escape" ? "escape" : null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (k) {
    case "ArrowDown":
    case "j":
      return "next";
    case "ArrowUp":
    case "k":
      return "prev";
    case "ArrowRight":
      return "nextProject";
    case "ArrowLeft":
      return "prevProject";
    // Enter on a focused button or link presses that control, not the ficha's first action.
    case "Enter":
      return tag === "BUTTON" || tag === "A" ? null : "primary";
    case "l":
      return "later";
    case "x":
      return "dismiss";
    case "z":
      return "undo";
    case "Escape":
      return "escape";
    default:
      return null;
  }
}

/** The idea stages in order, and how far a stage is along them (-1 when unknown). */
export const STAGES = ["idea", "research", "design", "planning", "ready"] as const;
export const stageIndex = (stage: string | null | undefined): number => STAGES.indexOf((stage ?? "idea") as (typeof STAGES)[number]);

/** Which part of the brief is missing, from its mode and sources. */
export function missingPart(data: BriefData): "brief" | "ideas" | "both" | "github" | null {
  if (data.mode === "full") return null;
  if (data.mode === "facts_only") return "both";
  const bad = new Set(data.sources.filter((s) => !s.ok).map((s) => s.name));
  if (bad.has("claude_brief") && bad.has("claude_ideas")) return "both";
  if (bad.has("claude_brief")) return "brief";
  if (bad.has("claude_ideas")) return "ideas";
  return bad.has("github") ? "github" : "brief";
}
