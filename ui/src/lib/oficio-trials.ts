// PLA-I67-6: the pure part of «Probar» and «Traer de un enlace»: the shapes the server sends, the version a run
// carried in words, the status line of a trial, the diff of an update and the error a link shows. Tested without a
// browser (test/i67-trial-import-ui.test.ts). Pure: no "@/" imports.
import { getLanguage, words, type Language } from "./i18n.js";
import { lineDiff, type DiffLine, type SkillCardVersion, type SkillFile } from "./oficio-skills.js";
import { IMPORT_WORDS, TRIAL_WORDS } from "./oficio-trial-words.js";

export type TrialStatus = "queued" | "running" | "done" | "failed" | "skipped" | "stopped";
export type TrialSide = { version: string | null; skills: string[]; output: string | null; diff: string | null };
export type TrialView = {
  id: string;
  skill: string;
  status: TrialStatus;
  summary: string;
  created_at: string;
  finished_at: string | null;
  delivery: { task_key: string; title: string };
  before: TrialSide;
  after: TrialSide & { version: string };
};
export type TrialDelivery = { run_id: string; task_key: string; title: string; ended_at: string | null; skills: string[] };
export type TrialsRead = { deliveries: TrialDelivery[]; trials: TrialView[] };
export type TrialStarted = { trial: TrialView; outcome: { kind: string; summary: string } };

// PLA-I71-5: where it comes from and what Plania checked (optional for older servers).
export type SkillMark = { file: string; line: number; kind: "secret" | "link"; text: string };
export type ImportReview = { words: number; dropped: string[]; marks: SkillMark[]; pinned: string };
export type ImportPreview = { url: string; source_hash: string; slug: string; name: string; description: string; body: string; files: SkillFile[]; taken: boolean; source_kind?: "link" | "github" | "skills.sh"; publisher?: string; commit?: string | null; review?: ImportReview };
export type SkillText = { name: string; description: string; body: string; files: SkillFile[] };
export type UpdateCheck = { url: string; saved_hash: string; source_hash: string; changed: boolean; current: SkillText; fetched: SkillText };

/** Still waiting or running: the screen keeps reading it. */
export const trialLive = (t: Pick<TrialView, "status">): boolean => t.status === "queued" || t.status === "running";

/** «la v2» for a "slug@hash" stamp the card knows, else the short hash; null: the run did not carry the skill. */
export function stampWords(stamp: string | null, versions: Pick<SkillCardVersion, "n" | "hash">[], language: Language = getLanguage()): string {
  const w = words(TRIAL_WORDS, language);
  if (!stamp) return w.noVersion;
  const hash = stamp.split("@")[1] ?? "";
  const n = versions.find((v) => v.hash === hash)?.n ?? null;
  return w.carried(w.versionOf(n, hash));
}

/** How many other skills the run carried besides this one. */
export const othersCount = (skills: string[], slug: string): number => skills.filter((s) => !s.startsWith(`${slug}@`)).length;

/** One line for a trial: its state, and for one that waits or did not start, why. */
export function trialLine(t: Pick<TrialView, "status" | "summary">, language: Language = getLanguage()): string {
  const w = words(TRIAL_WORDS, language);
  const state = w.status[t.status] ?? t.status;
  if (t.status === "queued") return `${state} · ${w.waitWhy(t.summary)}`;
  if (t.status === "skipped") return w.skippedWhy(t.summary);
  return state;
}

/** One text per skill content: the name, «cuándo», the body, then each file under its path. */
export function skillText(s: SkillText): string {
  const files = [...s.files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => `\n── ${f.path}\n${f.content.trimEnd()}`);
  return `# ${s.name}\n${s.description}\n\n${s.body.trimEnd()}${files.join("\n")}`;
}

/** What an update would change, current → fetched. */
export const updateDiff = (u: Pick<UpdateCheck, "current" | "fetched">): DiffLine[] => lineDiff(skillText(u.current), skillText(u.fetched));

/** The host a link names, for «Traída de github.com». */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

/** A refused link or save, in words. */
export function importError(code: string | null, language: Language = getLanguage()): string | null {
  if (!code) return null;
  const w = words(IMPORT_WORDS, language);
  if (code === "SKILL_NOT_ALLOWED") return w.notAllowed;
  if (code === "SKILL_IMPORT_FORMAT" || code === "FETCH_URL_INVALID" || code === "FETCH_SCHEME_REFUSED" || code === "FETCH_TYPE_REFUSED") return w.format;
  if (code === "SKILL_INVALID") return w.invalid;
  if (code === "SKILL_IMPORT_CHANGED") return w.changedSince;
  if (code === "SKILL_EXISTS") return w.taken;
  if (code === "FETCH_ADDRESS_REFUSED") return w.address;
  if (code.startsWith("FETCH_")) return w.unreachable;
  return w.failed(code);
}

/** A trial that could not be made, in words. */
export function trialError(code: string | null, language: Language = getLanguage()): string | null {
  if (!code) return null;
  const w = words(TRIAL_WORDS, language);
  return code === "TRIAL_NO_DELIVERY" ? w.noDelivery : w.failed(code);
}
