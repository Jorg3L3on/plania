// PLA-I41-5: the Morning brief merge (spec §7.1 server rules, §11). Pure functions: no DB, no clock, no network.
// pipeline.ts loads what they need and stores what mergeBrief() returns. The rules are enforced here, not only in
// the prompts: stable ids, server-assigned idea codes, hidden refs dropped, unknown apps -> cross, caps by status
// order, color slots (never a hex), http(s) URLs only, deterministic items when pass A failed, fallback ideas when
// there are none, one cross item per failure, and the D7 "Turn on runs for <Project>" items.
import { createHash } from "node:crypto";
import type { Facts } from "./facts.js";
import {
  BriefData,
  CROSS,
  IDEA_FLAG,
  STATUSES,
  type BriefApp,
  type BriefProject,
  type BriefSource,
  type Idea,
  type Item,
  type ResolvedBriefSettings,
  type Status,
} from "./types.js";

type Lang = "en" | "es";
export const CROSS_NAME = "Cross-app";
export const CROSS_LETTER = "X";
export const MAX_CROSS_IDEAS = 2;
const TITLE_MAX = 90;
const IDEA_TITLE_MAX = 70;
const DETAIL_MAX = 600;
const WHY_MAX = 400;
const REF_MAX = 120;

// ---- Ids

/** Lowercase, collapse spaces, trim. */
export const norm = (s: string | null | undefined): string => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const sha12 = (s: string): string => createHash("sha1").update(s).digest("hex").slice(0, 12);

/** "i|" + app + "|" + sha1(norm(ref) + "|" + norm(title))[:12]: the same thing keeps its id across days. */
export const itemId = (app: string, ref: string | null | undefined, title: string): string => `i|${app}|${sha12(`${norm(ref)}|${norm(title)}`)}`;
/** "d|" + app + "|" + sha1(norm(title))[:12]. */
export const ideaId = (app: string, title: string): string => `d|${app}|${sha12(norm(title))}`;

// ---- Hidden refs

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when text holds one of the hidden refs as a whole token, ignoring case. A token ends at anything that is not a
 * letter or digit, so "PLA-I16" hides "PLA-I16" and its tickets "PLA-I16-2", but not "PLA-I160" or "XPLA-I16".
 */
export function hasHiddenRef(text: string | null | undefined, hidden: readonly string[]): boolean {
  if (!text || !hidden.length) return false;
  return hidden.some((h) => {
    const ref = h.trim();
    return ref ? new RegExp(`(^|[^A-Za-z0-9])${escapeRe(ref)}($|[^A-Za-z0-9])`, "i").test(text) : false;
  });
}

// ---- Small helpers

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const httpUrl = (u: unknown): string | undefined => (typeof u === "string" && /^https?:\/\/\S+$/i.test(u.trim()) ? u.trim() : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const STATUS_ORDER: Record<Status, number> = { blocker: 0, needs_you: 1, next: 2, open_pr: 3 };
const isStatus = (s: unknown): s is Status => typeof s === "string" && (STATUSES as readonly string[]).includes(s);

/** Ticket keys mentioned in a ref ("ABC-I12-3 · #45" -> ["ABC-I12-3"]). */
export const refKeys = (ref: string | null | undefined): string[] => (ref ?? "").toUpperCase().match(/\b[A-Z][A-Z0-9]*-[A-Z0-9-]*[0-9]\b/g) ?? [];

// ---- Server-made texts (the brief's language)

const T = {
  en: {
    briefFailed: (why: string) => ({
      title: "The brief pass failed: items come from Plania facts",
      detail: `Claude's brief pass did not finish (${why}). These items are built from Plania data only. Press Generate now to try again.`,
    }),
    ideasFailed: (why: string) => ({
      title: "The ideas pass failed: ideas come from Plania",
      detail: `Claude's ideas pass did not finish (${why}). Today's ideas are open Plania ideas and yesterday's unchecked ones.`,
    }),
    factsOnly: (why: string) => ({ title: "This brief is facts only", detail: why }),
    github: (project: string, detail: string, fix: string) => ({ title: clip(`GitHub data missing for ${project}`, TITLE_MAX), detail: `${detail} ${fix}`.trim() }),
    turnOn: (project: string, codes: string[]) => ({
      title: `Turn on runs for ${project} to plan ${codes.join(", ")}`,
      detail: `${project} runs are paused, so its product owner has not planned ${codes.join(", ")}. Turn its runs on in Compañía and it starts on the next tick.`,
    }),
    review: (key: string) => `Review ${key}`,
    answer: (what: string) => `Answer: ${what}`,
    fix: (what: string) => `Fix: ${what}`,
    start: (key: string, title: string) => `Start ${key}: ${title}`,
    noIdeas: { title: "Write one idea per project in Plania", why: "No ideas came from Claude or Plania today. One open idea per project gives tomorrow's brief something to build on." },
    openIdea: (key: string) => `Open idea in Plania (${key}).`,
    nothing: "Nothing needs you today.",
  },
  es: {
    briefFailed: (why: string) => ({
      title: "Falló el paso del brief: los puntos salen de Plania",
      detail: `El paso del brief de Claude no terminó (${why}). Estos puntos salen solo de los datos de Plania. Pulsa Generar ahora para intentarlo otra vez.`,
    }),
    ideasFailed: (why: string) => ({
      title: "Falló el paso de ideas: las ideas salen de Plania",
      detail: `El paso de ideas de Claude no terminó (${why}). Las ideas de hoy son ideas abiertas de Plania y las de ayer sin marcar.`,
    }),
    factsOnly: (why: string) => ({ title: "Este brief es solo de datos", detail: why }),
    github: (project: string, detail: string, fix: string) => ({ title: clip(`Faltan datos de GitHub de ${project}`, TITLE_MAX), detail: `${detail} ${fix}`.trim() }),
    turnOn: (project: string, codes: string[]) => ({
      title: `Activa las corridas de ${project} para planear ${codes.join(", ")}`,
      detail: `Las corridas de ${project} están en pausa, así que su product owner no ha planeado ${codes.join(", ")}. Actívalas en Compañía y arranca en el siguiente tick.`,
    }),
    review: (key: string) => `Revisa ${key}`,
    answer: (what: string) => `Responde: ${what}`,
    fix: (what: string) => `Corrige: ${what}`,
    start: (key: string, title: string) => `Empieza ${key}: ${title}`,
    noIdeas: { title: "Escribe una idea por proyecto en Plania", why: "Hoy no llegaron ideas de Claude ni de Plania. Una idea abierta por proyecto le da material al brief de mañana." },
    openIdea: (key: string) => `Idea abierta en Plania (${key}).`,
    nothing: "Hoy nada te necesita.",
  },
} as const;
export const textsFor = (lang: string) => T[(lang === "es" ? "es" : "en") as Lang];

// ---- Inputs

/** What a pass gave: its raw output (validated again here, item by item) or why it failed. */
export type PassResult<T> = { ok: true; data: T } | { ok: false; summary: string; factsOnly?: boolean } | null;

/** An Open Plania idea (kind idea, not promoted) the fallback can show. */
export type OpenIdea = { app: string; key: string; title: string; summary: string | null };

/** A Send to Plania target waiting because its project's runs are paused (D7). */
export type WaitingPaused = { slug: string; codes: string[] };

export type MergeInput = {
  settings: ResolvedBriefSettings;
  projects: BriefProject[];
  facts: Pick<Facts, "projects" | "source_errors"> | null;
  generatedAt: string; // ISO with the zone's offset
  window: { from: string; to: string };
  // Pass A (items) and pass B (ideas). null = not run (ideas off, or this run skipped it).
  brief: PassResult<{ items: unknown[] }>;
  ideas: PassResult<{ ideas: unknown[] }>;
  // Whole brief is facts only (ceiling, no token, plan guard): the plain reason, shown in one cross item.
  factsOnly?: string | null;
  // buildBrief() lines, added to the facts-only item's detail.
  serverLines?: string[];
  openIdeas?: OpenIdea[];
  // The previous day's ideas the owner did not check.
  yesterdayIdeas?: Idea[];
  waitingPaused?: WaitingPaused[];
  // Ticket keys that are settled (Done, Won't do): an item whose every key is settled is dropped.
  settledKeys?: ReadonlySet<string>;
};

// ---- Items

type Ctx = { apps: Map<string, BriefApp>; projects: Map<string, BriefProject>; hidden: string[] };

function appOf(ctx: Ctx, app: unknown): string {
  return typeof app === "string" && ctx.apps.has(app) ? app : CROSS;
}

/** One raw item (from Claude or the server) cleaned to the BriefData shape, or null when it must be dropped. */
export function cleanItem(raw: unknown, ctx: Ctx, settled?: ReadonlySet<string>): Item | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isStatus(r.status)) return null;
  const title = str(r.title);
  if (!title) return null;
  const ref = str(r.ref) ? clip(str(r.ref)!, REF_MAX) : undefined;
  if (hasHiddenRef(title, ctx.hidden) || hasHiddenRef(ref, ctx.hidden)) return null;
  const keys = refKeys(ref);
  if (settled && keys.length && keys.every((k) => settled.has(k))) return null;
  const app = appOf(ctx, r.app);
  const t = clip(title, TITLE_MAX);
  const item: Item = { id: itemId(app, ref, t), app, status: r.status, title: t };
  if (ref) item.ref = ref;
  const detail = str(r.detail);
  if (detail) item.detail = clip(detail, DETAIL_MAX);
  const url = httpUrl(r.url);
  if (url) item.url = url;
  const action = str(r.action);
  if (action) item.action = clip(action, 40);
  return item;
}

/** Keeps the first of each id, then at most `max` per app: blockers, then needs_you, then next, then open_pr. */
export function capItems(items: Item[], max: number): Item[] {
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  const byApp = new Map<string, Item[]>();
  for (const i of unique) byApp.set(i.app, [...(byApp.get(i.app) ?? []), i]);
  const keep = new Set<Item>();
  for (const list of byApp.values()) {
    const sorted = list.map((it, n) => ({ it, n })).sort((a, b) => STATUS_ORDER[a.it.status] - STATUS_ORDER[b.it.status] || a.n - b.n);
    for (const { it } of sorted.slice(0, Math.max(0, max))) keep.add(it);
  }
  return unique.filter((i) => keep.has(i)).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

/** Pass A failed: the items Plania already knows (inbox -> needs_you, reviews, audit and Ready work -> next). */
export function factsItems(facts: Pick<Facts, "projects"> | null, lang: string): Record<string, unknown>[] {
  if (!facts) return [];
  const t = textsFor(lang);
  const out: Record<string, unknown>[] = [];
  for (const p of facts.projects) {
    for (const q of p.inbox) {
      out.push({ app: p.slug, status: "needs_you", ref: q.key ?? undefined, title: t.answer(q.title ?? q.why), detail: q.why, url: q.pr_url ?? undefined, action: "Decide" });
    }
    for (const r of p.tickets_in_review) {
      if (!r.pr) continue;
      out.push({ app: p.slug, status: "needs_you", ref: `${r.key} · #${r.pr.number}`, title: t.review(`${r.key}: ${r.title}`), url: r.pr.url, action: "Review" });
    }
    for (const f of p.audit?.findings ?? []) {
      out.push({ app: p.slug, status: "next", ref: f.key ?? undefined, title: t.fix(f.detail), detail: f.fix_hint, action: "Open" });
    }
    const first = p.ready.find((r) => r.first) ?? p.ready[0];
    if (first) out.push({ app: p.slug, status: "next", ref: first.key, title: t.start(first.key, first.title), action: "Open" });
  }
  return out;
}

// ---- Ideas

type DraftIdea = { app: string; title: string; why: string; source: string; flags?: string[] };

function cleanIdea(raw: unknown, ctx: Ctx, sourceOf: (app: string) => string): DraftIdea | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title);
  const why = str(r.why);
  if (!title || !why) return null;
  if (hasHiddenRef(title, ctx.hidden) || hasHiddenRef(why, ctx.hidden)) return null;
  const app = appOf(ctx, r.app);
  if (app !== CROSS && !ctx.projects.get(app)?.include_ideas) return null;
  const flags = Array.isArray(r.flags) ? [...new Set(r.flags.filter((f): f is string => typeof f === "string" && IDEA_FLAG.test(f)))] : [];
  const idea: DraftIdea = { app, title: clip(title, IDEA_TITLE_MAX), why: clip(why, WHY_MAX), source: str(r.source) ?? sourceOf(app) };
  if (flags.length) idea.flags = flags;
  return idea;
}

/**
 * Dedupes by id, caps per app (ideas_per_project; cross at most 2) and gives each idea its code: the project's
 * letter + a 1-based index, X for cross. Codes restart with every brief. Apps follow the brief order.
 */
export function codeIdeas(drafts: DraftIdea[], ctx: Ctx, perProject: number): Idea[] {
  const seen = new Set<string>();
  const byApp = new Map<string, Idea[]>();
  for (const d of drafts) {
    const id = ideaId(d.app, d.title);
    if (seen.has(id)) continue;
    const list = byApp.get(d.app) ?? [];
    if (list.length >= (d.app === CROSS ? Math.min(MAX_CROSS_IDEAS, perProject) : perProject)) continue;
    seen.add(id);
    const letter = d.app === CROSS ? CROSS_LETTER : ctx.projects.get(d.app)!.letter;
    const idea: Idea = { id, code: `${letter}${list.length + 1}`, app: d.app, title: d.title, why: d.why, source: d.source };
    if (d.flags?.length) idea.flags = d.flags;
    list.push(idea);
    byApp.set(d.app, list);
  }
  const order = [...ctx.apps.keys()];
  return order.flatMap((app) => byApp.get(app) ?? []);
}

/** §11: open Plania ideas per project, then yesterday's unchecked ones; one cross idea when there are none at all. */
export function fallbackIdeas(input: Pick<MergeInput, "openIdeas" | "yesterdayIdeas" | "settings">, ctx: Ctx): DraftIdea[] {
  const t = textsFor(input.settings.language);
  const per = input.settings.ideas_per_project;
  const out: DraftIdea[] = [];
  const count = (app: string) => out.filter((d) => d.app === app).length;
  for (const o of input.openIdeas ?? []) {
    if (!ctx.projects.get(o.app)?.include_ideas || count(o.app) >= per) continue;
    if (hasHiddenRef(o.key, ctx.hidden) || hasHiddenRef(o.title, ctx.hidden)) continue;
    out.push({ app: o.app, title: clip(o.title, IDEA_TITLE_MAX), why: clip(str(o.summary) ?? t.openIdea(o.key), WHY_MAX), source: "Plania" });
  }
  for (const y of input.yesterdayIdeas ?? []) {
    const app = appOf(ctx, y.app);
    if (app !== CROSS && !ctx.projects.get(app)?.include_ideas) continue;
    if (count(app) >= (app === CROSS ? MAX_CROSS_IDEAS : per)) continue;
    if (hasHiddenRef(y.title, ctx.hidden) || hasHiddenRef(y.why, ctx.hidden)) continue;
    if (out.some((d) => ideaId(d.app, d.title) === ideaId(app, y.title))) continue;
    out.push({ app, title: y.title, why: y.why, source: y.source, ...(y.flags?.length ? { flags: y.flags } : {}) });
  }
  if (!out.length) out.push({ app: CROSS, title: t.noIdeas.title, why: t.noIdeas.why, source: "Plania" });
  return out;
}

// ---- Apps

/** Included projects in brief order with their color slot, then cross ("other"). No hex anywhere. */
export function briefApps(projects: BriefProject[]): BriefApp[] {
  return [...projects.filter((p) => p.include).map((p) => ({ id: p.slug, name: p.name, color: p.color })), { id: CROSS, name: CROSS_NAME, color: "other" as const }];
}

// ---- The merge

export function mergeBrief(input: MergeInput): BriefData {
  const s = input.settings;
  const t = textsFor(s.language);
  const apps = briefApps(input.projects);
  const ctx: Ctx = {
    apps: new Map(apps.map((a) => [a.id, a])),
    projects: new Map(input.projects.filter((p) => p.include).map((p) => [p.slug, p])),
    hidden: s.hidden_refs,
  };
  const nameOf = (slug: string) => ctx.projects.get(slug)?.name ?? input.projects.find((p) => p.slug === slug)?.name ?? slug;
  const homeName = "Plania";
  const sourceOf = (app: string) => (app === CROSS ? homeName : nameOf(app));

  const factsOnly = input.factsOnly ?? (input.brief && !input.brief.ok && input.brief.factsOnly ? input.brief.summary : null);
  const briefOk = !factsOnly && !!input.brief?.ok;
  const ideasOk = !factsOnly && !!input.ideas?.ok;

  // Server items first inside their status, so the cap keeps them: failures, then the D7 items.
  const server: Record<string, unknown>[] = [];
  if (factsOnly) {
    const lines = (input.serverLines ?? []).join(" ");
    const f = t.factsOnly(lines ? `${factsOnly} ${lines}` : factsOnly);
    server.push({ app: CROSS, status: "needs_you", title: f.title, detail: f.detail, action: "Open" });
  } else {
    if (input.brief && !input.brief.ok) server.push({ app: CROSS, status: "needs_you", ...t.briefFailed(input.brief.summary), action: "Open" });
    if (input.ideas && !input.ideas.ok) server.push({ app: CROSS, status: "needs_you", ...t.ideasFailed(input.ideas.summary), action: "Open" });
  }
  for (const e of input.facts?.source_errors ?? []) server.push({ app: CROSS, status: "needs_you", ...t.github(nameOf(e.project), e.detail, e.fix), action: "Open" });
  const paused = new Map<string, string[]>();
  for (const w of input.waitingPaused ?? []) paused.set(w.slug, [...new Set([...(paused.get(w.slug) ?? []), ...w.codes])]);
  for (const [slug, codes] of paused) {
    if (!codes.length) continue;
    server.push({ app: ctx.apps.has(slug) ? slug : CROSS, status: "needs_you", ...t.turnOn(nameOf(slug), codes), action: "Open" });
  }

  const fromClaude = briefOk && input.brief?.ok ? input.brief.data.items : factsItems(input.facts, s.language);
  const cleaned = [...server, ...fromClaude].map((r) => cleanItem(r, ctx, input.settledKeys)).filter((i): i is Item => !!i);
  const items = capItems(cleaned, s.max_items_per_app);

  const drafts = ideasOk && input.ideas?.ok ? input.ideas.data.ideas.map((r) => cleanIdea(r, ctx, sourceOf)).filter((d): d is DraftIdea => !!d) : [];
  let ideas = codeIdeas(drafts, ctx, s.ideas_per_project);
  if (!ideas.length) ideas = codeIdeas(fallbackIdeas(input, ctx), ctx, s.ideas_per_project);

  const githubOk = !(input.facts?.source_errors.length ?? 0);
  const sources: BriefSource[] = [
    { name: "plania", ok: !!input.facts },
    { name: "github", ok: githubOk, ...(githubOk ? {} : { note: input.facts!.source_errors.map((e) => e.project).join(", ") }) },
    { name: "claude_brief", ok: briefOk, ...(briefOk ? {} : { note: factsOnly ?? (input.brief && !input.brief.ok ? input.brief.summary : "not run") }) },
    { name: "claude_ideas", ok: ideasOk, ...(ideasOk ? {} : { note: factsOnly ?? (input.ideas && !input.ideas.ok ? input.ideas.summary : "not run") }) },
  ];
  const ideasFailed = !!input.ideas && !input.ideas.ok;
  const mode = factsOnly ? "facts_only" : !briefOk || ideasFailed ? "partial" : "full";

  return BriefData.parse({
    version: 1,
    generatedAt: input.generatedAt,
    timezone: s.timezone,
    timezoneLabel: s.timezone_label,
    window: input.window,
    reply: { prefix: "yes", destination: "Plania" },
    apps,
    items,
    ideas,
    sources,
    mode,
    language: s.language,
  });
}

// ---- Brief de hoy (Compañía), 0 tokens

/** Up to 5 lines: blockers, then Needs you titles, each with its app's name. */
export function projectionLines(data: Pick<BriefData, "items" | "apps" | "language">, max = 5): string[] {
  const name = new Map(data.apps.map((a) => [a.id, a.name]));
  const lines = (["blocker", "needs_you"] as const).flatMap((st) => data.items.filter((i) => i.status === st)).slice(0, max);
  if (!lines.length) return [textsFor(data.language).nothing];
  return lines.map((i) => `${name.get(i.app) ?? i.app}: ${i.title}`);
}
