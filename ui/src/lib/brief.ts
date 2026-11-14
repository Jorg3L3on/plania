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

export function useBriefLatest() {
  return useQuery({
    queryKey: briefKeys.latest,
    queryFn: briefApi.latest,
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
