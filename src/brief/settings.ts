// PLA-I41-2: the brief_settings singleton (spec §9). load returns the stored row, or the defaults when nobody has
// saved yet; save validates a patch, merges it over what is stored and upserts row 1. resolve applies the env
// fallbacks (PLANIA_TZ, PLANIA_CEO_NAME), and briefProjects lays the per-project overrides over the projects table:
// include, ideas, idea letter (§7.1: first letter of key_prefix, else the next free letter of its title; X is
// cross), order and color slot. Never reads or returns a secret.
import { asc, eq } from "drizzle-orm";
import { briefSettings, projects, type Project } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";
import {
  BriefSettings,
  BriefSettingsPatch,
  SLOTS,
  type BriefProject,
  type ResolvedBriefSettings,
  type Slot,
} from "./types.js";

export const DEFAULT_TZ = "America/Mexico_City";
export const DEFAULT_OWNER = "the owner";

export const DEFAULT_SETTINGS: BriefSettings = Object.freeze({
  enabled: true,
  run_at: "07:00",
  timezone: null,
  timezone_label: null,
  language: "en",
  owner_name: null,
  hidden_refs: [],
  max_items_per_app: 5,
  ideas_per_project: 3,
  ideas_enabled: true,
  fallback_at: "11:00",
  model: null,
  pass_timeouts: { brief: 10, ideas: 20, plan: 30 },
  projects: {},
  github_mode: "poller",
}) as BriefSettings;

// Postgres `time` reads back as "HH:MM:SS".
const hhmm = (t: string): string => t.slice(0, 5);

type Row = typeof briefSettings.$inferSelect;
function fromRow(r: Row): BriefSettings {
  return {
    enabled: r.enabled,
    run_at: hhmm(r.runAt),
    timezone: r.timezone,
    timezone_label: r.timezoneLabel,
    language: r.language,
    owner_name: r.ownerName,
    hidden_refs: r.hiddenRefs,
    max_items_per_app: r.maxItemsPerApp,
    ideas_per_project: r.ideasPerProject,
    ideas_enabled: r.ideasEnabled,
    fallback_at: hhmm(r.fallbackAt),
    model: r.model,
    pass_timeouts: { ...DEFAULT_SETTINGS.pass_timeouts, ...r.passTimeouts },
    projects: r.projects,
    github_mode: r.githubMode,
  };
}

export async function loadBriefSettings(db: Q): Promise<BriefSettings> {
  const [row] = await db.select().from(briefSettings).where(eq(briefSettings.id, 1)).limit(1);
  return row ? fromRow(row) : structuredClone({ ...DEFAULT_SETTINGS });
}

export class BriefSettingsError extends Error {
  constructor(public readonly issues: { path: string; message: string }[]) {
    super(`invalid brief settings: ${issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; ")}`);
    this.name = "BriefSettingsError";
  }
}

export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Validates the patch, merges it over the stored settings (projects merge per slug) and upserts row 1. */
export async function saveBriefSettings(db: Q, patch: unknown): Promise<BriefSettings> {
  const parsed = BriefSettingsPatch.safeParse(patch);
  if (!parsed.success) throw new BriefSettingsError(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const p = parsed.data;
  if (p.timezone && !validTimezone(p.timezone)) throw new BriefSettingsError([{ path: "timezone", message: "not an IANA time zone" }]);
  const cur = await loadBriefSettings(db);
  const next: BriefSettings = {
    ...cur,
    ...p,
    hidden_refs: p.hidden_refs ? [...new Set(p.hidden_refs.map((r) => r.trim()).filter(Boolean))] : cur.hidden_refs,
    pass_timeouts: { ...cur.pass_timeouts, ...p.pass_timeouts },
    projects: p.projects ? { ...cur.projects, ...p.projects } : cur.projects,
  };
  const checked = BriefSettings.parse(next);
  const values = {
    id: 1,
    enabled: checked.enabled,
    runAt: checked.run_at,
    timezone: checked.timezone,
    timezoneLabel: checked.timezone_label,
    language: checked.language,
    ownerName: checked.owner_name,
    hiddenRefs: checked.hidden_refs,
    maxItemsPerApp: checked.max_items_per_app,
    ideasPerProject: checked.ideas_per_project,
    ideasEnabled: checked.ideas_enabled,
    fallbackAt: checked.fallback_at,
    model: checked.model,
    passTimeouts: checked.pass_timeouts,
    projects: checked.projects,
    githubMode: checked.github_mode,
    updatedAt: new Date(),
  };
  const { id: _id, ...set } = values;
  await db.insert(briefSettings).values(values).onConflictDoUpdate({ target: briefSettings.id, set });
  return checked;
}

const TZ_LABELS: Record<string, string> = {
  "America/Mexico_City": "CDMX",
  "America/Monterrey": "MTY",
  "America/New_York": "NYC",
  "America/Los_Angeles": "LA",
  "Europe/Madrid": "Madrid",
  UTC: "UTC",
};

/** A short label for the page: the settings label, a small map, else the IANA city ("America/Bogota" → "Bogota"). */
export function timezoneLabel(tz: string, label?: string | null): string {
  if (label) return label;
  return TZ_LABELS[tz] ?? (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}

export function resolveBriefSettings(s: BriefSettings, env: NodeJS.ProcessEnv = process.env): ResolvedBriefSettings {
  const tzCandidate = s.timezone || env.PLANIA_TZ || DEFAULT_TZ;
  const timezone = validTimezone(tzCandidate) ? tzCandidate : DEFAULT_TZ;
  return {
    ...s,
    timezone,
    timezone_label: timezoneLabel(timezone, s.timezone_label),
    owner_name: s.owner_name || env.PLANIA_CEO_NAME?.trim() || DEFAULT_OWNER,
  };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWYZ".split(""); // no X: cross ideas use it

/** The projects table with the brief overrides on top, in brief order (explicit order first, then slug). */
export function briefProjects(all: Pick<Project, "id" | "slug" | "title" | "keyPrefix">[], s: Pick<BriefSettings, "projects">): BriefProject[] {
  const withOrder = all.map((p) => ({ p, o: s.projects[p.slug] ?? {} }));
  withOrder.sort((a, b) => (a.o.order ?? Number.MAX_SAFE_INTEGER) - (b.o.order ?? Number.MAX_SAFE_INTEGER) || a.p.slug.localeCompare(b.p.slug));

  const taken = new Set<string>();
  const letters = new Map<string, string>();
  // Letters set by hand win; the rest take the key prefix's first letter, else the next free letter of the title.
  for (const { p, o } of withOrder) if (o.letter && !taken.has(o.letter)) (taken.add(o.letter), letters.set(p.slug, o.letter));
  for (const { p } of withOrder) {
    if (letters.has(p.slug)) continue;
    const candidates = [...`${p.keyPrefix.slice(0, 1)}${p.title}${p.slug}`.toUpperCase()].filter((c) => LETTERS.includes(c));
    const pick = candidates.find((c) => !taken.has(c)) ?? LETTERS.find((c) => !taken.has(c)) ?? "Z";
    taken.add(pick);
    letters.set(p.slug, pick);
  }

  let slot = 0;
  return withOrder.map(({ p, o }, i) => {
    const include = o.include ?? true;
    const color: Slot = include && slot < SLOTS.length - 1 ? SLOTS[slot++]! : "other";
    return {
      id: p.slug,
      slug: p.slug,
      name: p.title,
      key_prefix: p.keyPrefix,
      letter: letters.get(p.slug)!,
      color,
      order: i,
      include,
      include_ideas: include && (o.include_ideas ?? true),
    };
  });
}

export async function loadBriefProjects(db: Q, s?: BriefSettings): Promise<BriefProject[]> {
  const all = await db.select({ id: projects.id, slug: projects.slug, title: projects.title, keyPrefix: projects.keyPrefix }).from(projects).orderBy(asc(projects.slug));
  return briefProjects(all, s ?? (await loadBriefSettings(db)));
}
