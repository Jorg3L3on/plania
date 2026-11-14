// PLA-I41-2: the Morning brief's shapes (spec "Spec: Morning brief" §7.1, §9). zod is the source; the TS types are
// inferred from it. The page copies these to ui/src/lib/brief.ts (PLA-I42), so keep this file free of server imports.
import { z } from "zod";

export const SLOTS = ["c0", "c1", "c2", "c3", "c4", "c5", "other"] as const;
export const Slot = z.enum(SLOTS);
export type Slot = z.infer<typeof Slot>;

export const STATUSES = ["blocker", "needs_you", "next", "open_pr"] as const;
export const Status = z.enum(STATUSES);
export type Status = z.infer<typeof Status>;

export const ACTIONS = ["Review", "Open PR", "Open compare", "Decide", "Open"] as const;
export const ItemAction = z.enum(ACTIONS);
export type ItemAction = z.infer<typeof ItemAction>;

export const IDEA_FLAG = /^(cost|outside_service|legal|repo_change|big|overlap:[A-Z0-9-]+)$/;
export const CROSS = "cross" as const;

const httpUrl = z.string().regex(/^https?:\/\//);

export const BriefApp = z.object({ id: z.string().min(1), name: z.string().min(1), color: Slot });
export type BriefApp = z.infer<typeof BriefApp>;

export const Item = z.object({
  id: z.string().min(1),
  app: z.string().min(1),
  status: Status,
  ref: z.string().max(120).optional(),
  title: z.string().min(1).max(90),
  detail: z.string().max(600).optional(),
  url: httpUrl.optional(),
  action: z.string().optional(),
});
export type Item = z.infer<typeof Item>;

export const Idea = z.object({
  id: z.string().min(1),
  code: z.string().regex(/^[A-Z]\d+$/),
  app: z.string().min(1),
  title: z.string().min(1).max(70),
  why: z.string().min(1).max(400),
  source: z.string(),
  flags: z.array(z.string().regex(IDEA_FLAG)).optional(),
});
export type Idea = z.infer<typeof Idea>;

export const SOURCE_NAMES = ["plania", "github", "claude_brief", "claude_ideas"] as const;
export const BriefSource = z.object({ name: z.enum(SOURCE_NAMES), ok: z.boolean(), note: z.string().optional() });
export type BriefSource = z.infer<typeof BriefSource>;

export const BRIEF_MODES = ["full", "partial", "facts_only"] as const;
export const BRIEF_LANGUAGES = ["en", "es"] as const;
export const BriefLanguage = z.enum(BRIEF_LANGUAGES);

export const BriefData = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  timezone: z.string().min(1),
  timezoneLabel: z.string().min(1),
  window: z.object({ from: z.string().min(1), to: z.string().min(1) }),
  reply: z.object({ prefix: z.string().min(1), destination: z.literal("Plania") }),
  apps: z.array(BriefApp),
  items: z.array(Item),
  ideas: z.array(Idea).min(1),
  sources: z.array(BriefSource),
  mode: z.enum(BRIEF_MODES),
  language: BriefLanguage,
});
export type BriefData = z.infer<typeof BriefData>;

// What Claude returns (prompts/morning-brief/*.schema.json): the server adds ids, codes and source in merge.ts.
export const PassItem = Item.omit({ id: true }).extend({ action: ItemAction.optional() });
export type PassItem = z.infer<typeof PassItem>;
export const PassIdea = Idea.omit({ id: true, code: true, source: true });
export type PassIdea = z.infer<typeof PassIdea>;
export const BriefPassOutput = z.object({ items: z.array(PassItem).max(60), notes: z.array(z.string()).max(5).optional() });
export const IdeasPassOutput = z.object({ ideas: z.array(PassIdea).min(1).max(40) });

// ---- Settings (brief_settings, §9)

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, e.g. 07:00");
const letter = z.string().regex(/^[A-WYZ]$/, "one capital letter; X is for cross ideas");

export const BriefProjectSetting = z.object({
  include: z.boolean().optional(),
  include_ideas: z.boolean().optional(),
  letter: letter.optional(),
  order: z.number().int().min(0).max(999).optional(),
});
export type BriefProjectSetting = z.infer<typeof BriefProjectSetting>;

export const PassTimeouts = z.object({
  brief: z.number().int().min(1).max(120),
  ideas: z.number().int().min(1).max(120),
  plan: z.number().int().min(1).max(240),
});
export type PassTimeouts = z.infer<typeof PassTimeouts>;

/** The stored settings, with times as HH:MM. Nulls fall back to the environment (see settings.ts). */
export const BriefSettings = z.object({
  enabled: z.boolean(),
  run_at: hhmm,
  timezone: z.string().min(1).max(64).nullable(),
  timezone_label: z.string().min(1).max(40).nullable(),
  language: BriefLanguage,
  owner_name: z.string().min(1).max(80).nullable(),
  hidden_refs: z.array(z.string().min(1).max(60)).max(200),
  max_items_per_app: z.number().int().min(1).max(20),
  ideas_per_project: z.number().int().min(1).max(10),
  ideas_enabled: z.boolean(),
  fallback_at: hhmm,
  model: z.string().min(1).max(80).nullable(),
  pass_timeouts: PassTimeouts,
  projects: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/), BriefProjectSetting),
  github_mode: z.enum(["poller", "gh", "off"]),
});
export type BriefSettings = z.infer<typeof BriefSettings>;

/** PUT /api/brief/settings: any subset; unknown keys are refused. */
export const BriefSettingsPatch = BriefSettings.partial().strict();
export type BriefSettingsPatch = z.infer<typeof BriefSettingsPatch>;

/** Settings with the env fallbacks applied: what the pipeline and prompts use. */
export type ResolvedBriefSettings = BriefSettings & { timezone: string; timezone_label: string; owner_name: string };

/** One project as the brief sees it, in brief order. */
export type BriefProject = {
  id: string;
  slug: string;
  name: string;
  key_prefix: string;
  letter: string;
  color: Slot;
  order: number;
  include: boolean;
  include_ideas: boolean;
};
