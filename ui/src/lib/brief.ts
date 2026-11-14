// PLA-I42-1: the Morning brief page's data. The shapes are copied from src/brief/types.ts (the server's zod source;
// keep them in step) and the hooks follow the API in spec "Spec: Morning brief" §7.3 (src/api/brief.ts).
// latest polls every 5 s only while a run is waiting or running; otherwise it uses the normal TanStack cache.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

// ---- Shapes (src/brief/types.ts)

export const SLOTS = ["c0", "c1", "c2", "c3", "c4", "c5", "other"] as const;
export type Slot = (typeof SLOTS)[number];
export type Status = "blocker" | "needs_you" | "next" | "open_pr";
export type ItemAction = "Review" | "Open PR" | "Open compare" | "Decide" | "Open";
export const CROSS = "cross" as const;

export type BriefApp = { id: string; name: string; color: Slot };
export type Item = { id: string; app: string; status: Status; ref?: string; title: string; detail?: string; url?: string; action?: string };
export type Idea = { id: string; code: string; app: string; title: string; why: string; source: string; flags?: string[] };
export type BriefSource = { name: "plania" | "github" | "claude_brief" | "claude_ideas"; ok: boolean; note?: string };
export type BriefMode = "full" | "partial" | "facts_only";
export type BriefLanguage = "en" | "es";

export type BriefData = {
  version: 1;
  generatedAt: string;
  timezone: string;
  timezoneLabel: string;
  window: { from: string; to: string };
  reply: { prefix: string; destination: "Plania" };
  apps: BriefApp[];
  items: Item[];
  ideas: Idea[];
  sources: BriefSource[];
  mode: BriefMode;
  language: BriefLanguage;
};

export type BriefProjectSetting = { include?: boolean; include_ideas?: boolean; letter?: string; order?: number };
export type PassTimeouts = { brief: number; ideas: number; plan: number };
export type BriefSettings = {
  enabled: boolean;
  run_at: string;
  timezone: string | null;
  timezone_label: string | null;
  language: BriefLanguage;
  owner_name: string | null;
  hidden_refs: string[];
  max_items_per_app: number;
  ideas_per_project: number;
  ideas_enabled: boolean;
  fallback_at: string;
  model: string | null;
  pass_timeouts: PassTimeouts;
  projects: Record<string, BriefProjectSetting>;
  github_mode: "poller" | "gh" | "off";
};
export type BriefSettingsPatch = Partial<BriefSettings>;

// ---- API replies (§7.3)

/** One stored brief: the row's fields plus the page data. */
export type StoredBrief = { id: string; local_date: string; generated_at: string; trigger: string; mode: BriefMode; data: BriefData };
export type BriefRun = { id: string; status: "waiting" | "running"; started_at: string; waiting_for_build: boolean };
export type BriefLatest = { brief: StoredBrief | null; checks: string[]; run: BriefRun | null };
export type BriefByDate = { brief: StoredBrief; checks: string[] };
export type BriefHistoryRow = { id: string; local_date: string; generated_at: string; mode: BriefMode; needs: number; next: number; ideas: number };
export type BriefSettingsReply = {
  settings: BriefSettings;
  resolved: { timezone: string; timezone_label: string; owner_name: string };
  personas: { project: string; doc_id: string }[];
};
export type BriefPass = "brief" | "ideas";
export type BriefCheckReply = { item_id: string; checked: boolean };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/brief${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const { error, ...detail } = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    throw new ApiError(res.status, error ?? `HTTP_${res.status}`, detail);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const briefApi = {
  latest: () => call<BriefLatest>("GET", "/latest"),
  history: (days = 14) => call<BriefHistoryRow[]>("GET", `/history?days=${days}`),
  byDate: (date: string) => call<BriefByDate>("GET", `/${encodeURIComponent(date)}`),
  run: (passes?: BriefPass[]) => call<{ run_id: string }>("POST", "/run", passes ? { passes } : {}),
  check: (itemId: string) => call<BriefCheckReply>("PUT", `/checks/${encodeURIComponent(itemId)}`),
  uncheck: (itemId: string) => call<BriefCheckReply>("DELETE", `/checks/${encodeURIComponent(itemId)}`),
  settings: () => call<BriefSettingsReply>("GET", "/settings"),
  saveSettings: (patch: BriefSettingsPatch) => call<BriefSettingsReply>("PUT", "/settings", patch),
};

export const briefKeys = {
  latest: ["brief", "latest"] as const,
  history: (days: number) => ["brief", "history", days] as const,
  date: (date: string) => ["brief", "date", date] as const,
  settings: ["brief", "settings"] as const,
};

export const BRIEF_POLL_MS = 5_000;

/** latest's poll interval: every 5 s while a run is waiting or running, else none. Pure, for tests. */
export const latestPollInterval = (data: BriefLatest | undefined): number | false => (data?.run ? BRIEF_POLL_MS : false);

// ---- Hooks

// PLA-I42-2: the last good latest reply is kept per device, so a reload while the API is down still shows the brief
// with "Couldn't refresh". It holds no secrets (the same JSON the page renders).
export const LATEST_CACHE_KEY = "plania.brief.latest";

function readLatestCache(): BriefLatest | undefined {
  try {
    const raw = localStorage.getItem(LATEST_CACHE_KEY);
    const v = raw ? (JSON.parse(raw) as BriefLatest) : undefined;
    return v && typeof v === "object" && "brief" in v && Array.isArray(v.checks) ? { ...v, run: null } : undefined;
  } catch {
    return undefined;
  }
}

function writeLatestCache(v: BriefLatest) {
  try {
    localStorage.setItem(LATEST_CACHE_KEY, JSON.stringify(v));
  } catch {
    // Private mode or a full quota: the in-memory cache still works.
  }
}

export function useBriefLatest() {
  return useQuery({
    queryKey: briefKeys.latest,
    queryFn: async () => {
      const v = await briefApi.latest();
      writeLatestCache(v);
      return v;
    },
    // The device copy shows at once and is refetched right away (updated at 0 = stale).
    initialData: readLatestCache,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    refetchInterval: (q) => latestPollInterval(q.state.data),
  });
}

export function useBriefHistory(days = 14) {
  return useQuery({ queryKey: briefKeys.history(days), queryFn: () => briefApi.history(days), staleTime: 60_000 });
}

/** A past day's brief (read-only); null date means today, so nothing is fetched. */
export function useBriefByDate(date: string | null) {
  return useQuery({ queryKey: briefKeys.date(date ?? ""), queryFn: () => briefApi.byDate(date!), enabled: !!date, staleTime: 5 * 60_000 });
}

/** Generate now. 409 BRIEF_RUNNING comes back as an ApiError; either way latest refetches and starts polling. */
export function useRunBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (passes?: BriefPass[]) => briefApi.run(passes),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: briefKeys.latest });
    },
  });
}

const toggled = (checks: string[], id: string, checked: boolean) =>
  checked ? (checks.includes(id) ? checks : [...checks, id].sort()) : checks.filter((c) => c !== id);

/** Check or uncheck an item or idea by its stable id, optimistically on every cached brief that lists it. */
export function useBriefCheck() {
  const qc = useQueryClient();
  type Snapshot = [readonly unknown[], { checks: string[] } | undefined][];
  return useMutation({
    mutationFn: ({ id, checked }: { id: string; checked: boolean }) => (checked ? briefApi.check(id) : briefApi.uncheck(id)),
    onMutate: async ({ id, checked }): Promise<{ before: Snapshot }> => {
      await qc.cancelQueries({ queryKey: ["brief"] });
      const before = qc.getQueriesData<{ checks: string[] }>({ queryKey: ["brief"] }) as Snapshot;
      for (const [key, data] of before) {
        if (data && Array.isArray(data.checks)) qc.setQueryData(key, { ...data, checks: toggled(data.checks, id, checked) });
      }
      return { before };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.before ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: briefKeys.latest });
    },
  });
}

export function useBriefSettings() {
  return useQuery({ queryKey: briefKeys.settings, queryFn: briefApi.settings, staleTime: 60_000 });
}

export function useSaveBriefSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: BriefSettingsPatch) => briefApi.saveSettings(patch),
    onSuccess: (reply) => {
      qc.setQueryData(briefKeys.settings, reply);
    },
  });
}

/** The CSS variable of an app slot (theme vars in index.css; other = muted foreground). */
export const slotVar = (slot: Slot) => `var(--brief-${slot})`;

// ---- PLA-I42-2: what the page shows (pure, for tests)

/** Needs you = blockers and needs_you; Up next = next and open PRs. */
export const NEEDS: readonly Status[] = ["blocker", "needs_you"];
export const UP_NEXT: readonly Status[] = ["next", "open_pr"];
export type BriefView = "open" | "all";
export type SectionId = "needs" | "next";

const RANK: Record<Status, number> = { blocker: 0, needs_you: 1, next: 2, open_pr: 3 };

/** A section's rows: its statuses, the app filter, checked rows hidden in "open"; blockers first, else brief order. */
export function sectionItems(items: Item[], statuses: readonly Status[], o: { app: string | null; view: BriefView; checks: string[] }): Item[] {
  const checked = new Set(o.checks);
  return items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => statuses.includes(it.status) && (!o.app || it.app === o.app) && (o.view === "all" || !checked.has(it.id)))
    .sort((a, b) => RANK[a.it.status] - RANK[b.it.status] || a.i - b.i)
    .map(({ it }) => it);
}

export type BriefCounts = { needs: number; blockers: number; next: number; ideas: number; checked: number };

/** The summary line's counts for the app filter (null = every app). needs/blockers/next/ideas count what is not checked. */
export function briefCounts(data: BriefData, checks: string[], app: string | null = null): BriefCounts {
  const checked = new Set(checks);
  const mine = <T extends { app: string }>(xs: T[]) => xs.filter((x) => !app || x.app === app);
  const items = mine(data.items);
  const ideas = mine(data.ideas);
  const open = items.filter((i) => !checked.has(i.id));
  return {
    needs: open.filter((i) => NEEDS.includes(i.status)).length,
    blockers: open.filter((i) => i.status === "blocker").length,
    next: open.filter((i) => UP_NEXT.includes(i.status)).length,
    ideas: ideas.filter((i) => !checked.has(i.id)).length,
    checked: items.filter((i) => checked.has(i.id)).length + ideas.filter((i) => checked.has(i.id)).length,
  };
}

/** Open (not checked) items per app, in the brief's app order; apps with none are kept (count 0). */
export function openPerApp(data: BriefData, checks: string[]): { app: BriefApp; open: number }[] {
  const checked = new Set(checks);
  return data.apps.map((app) => ({ app, open: data.items.filter((i) => i.app === app.id && !checked.has(i.id)).length }));
}

/** Only http(s) links are rendered (the server already drops others; this is the second fence). */
export const safeUrl = (url: string | undefined): string | null => (url && /^https?:\/\//i.test(url) ? url : null);

// Collapse state per device (spec §8): {"needs": true} means collapsed; idea groups use "ideas:<app>" keys.
export const COLLAPSED_KEY = "plania.brief.collapsed";

export function readCollapsed(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function writeCollapsed(v: Record<string, boolean>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(v));
  } catch {
    // Private mode: the state lasts for this visit only.
  }
}

/** Minutes a run has been going, at least 1, for "Generating… 3 min". */
export const runMinutes = (startedAt: string, now: number): number => Math.max(1, Math.round((now - new Date(startedAt).getTime()) / 60_000));

// ---- PLA-I42-3: Today's ideas and the send bar (spec §8 items 4 and 6; pure, for tests)

/**
 * Send to Plania (PLA-I43) is not shipped yet: the bar's Send button and its progress stay hidden until it is.
 * PLA-I43 flips this to true when POST /api/brief/plan exists.
 */
export const BRIEF_SEND_ENABLED = false;

export type IdeaGroup = { app: BriefApp; ideas: Idea[] };

/** Ideas grouped per app in the brief's app order (apps without ideas left out), the app filter applied, checked ideas hidden in "open". */
export function ideaGroups(data: BriefData, o: { app: string | null; view: BriefView; checks: string[] }): IdeaGroup[] {
  const checked = new Set(o.checks);
  const known = new Set(data.apps.map((a) => a.id));
  const appOf = (id: string) => (known.has(id) ? id : CROSS);
  const groups = data.apps.map((app) => ({
    app,
    ideas: data.ideas.filter((i) => appOf(i.app) === app.id && (o.view === "all" || !checked.has(i.id))),
  }));
  return groups.filter((g) => g.ideas.length > 0 && (!o.app || g.app.id === o.app));
}

/** The reply for the selected ideas in the brief's order, e.g. "yes W1 Z3". */
export function replyText(data: BriefData, selected: ReadonlySet<string>): string {
  const codes = data.ideas.filter((i) => selected.has(i.id)).map((i) => i.code);
  return [data.reply.prefix || "yes", ...codes].join(" ");
}

/** One idea flag as a caption key and its argument: "overlap:FIL-IDEA12" → ["overlap", "FIL-IDEA12"]. Unknown flags are dropped. */
export type FlagKey = "cost" | "outside_service" | "legal" | "repo_change" | "big" | "overlap";
export function parseFlag(flag: string): { key: FlagKey; ref?: string } | null {
  const m = /^overlap:([A-Z0-9-]+)$/.exec(flag);
  if (m) return { key: "overlap", ref: m[1] };
  return (["cost", "outside_service", "legal", "repo_change", "big"] as const).includes(flag as never) ? { key: flag as FlagKey } : null;
}

/** "from {source}" shows only when the source is not the app's own name. */
export const showSource = (idea: Idea, app: BriefApp | undefined): boolean =>
  !!idea.source && idea.source.trim().toLowerCase() !== (app?.name ?? "").trim().toLowerCase();
