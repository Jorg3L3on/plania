// PLA-I69-5, PLA-130: how the project addresses people (tú, usted or vos). Voz y nombre left Marca; what remains is
// this one choice, made in Estilo → Trato. It is kept in Plania with versions in <captures dir>/_marca/<project>/
// voice.json and rides in every run of the project as a one-line guide (src/runner/runner.ts), so Taller, Artist and
// the product owner write the app's texts with it. Older files may hold the removed fields (tone, words, names); they
// are read past and dropped on the next save.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects } from "../db/schema.js";
import { capturesDir } from "../captures/store.js";
import { bus } from "../events.js";
import { say } from "../words.js";
import { LogoError } from "./upload.js";
import { record } from "./versions.js";
import { VOZ_WORDS } from "./words.js";

export type Trato = "tu" | "usted" | "vos";
export type Voice = { trato: Trato };
type VoiceFile = { current: number; versions: { v: number; at: string; from?: string; keep?: boolean; voice: Voice }[] };

const fileOf = (slug: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad project slug ${slug}`);
  return path.join(capturesDir(), "_marca", slug, "voice.json");
};
function load(slug: string): VoiceFile | null {
  const f = fileOf(slug);
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, "utf8")) as VoiceFile;
    return Array.isArray(j.versions) && j.versions.length ? j : null;
  } catch {
    return null;
  }
}
function save(slug: string, s: VoiceFile): void {
  const f = fileOf(slug);
  mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, f);
}
const TRATOS = ["tu", "usted", "vos"] as const;
/** A voice made whole and safe from what the screen sends: only the form of address, anything else dropped. */
export function soundVoice(input: Partial<Voice> | null | undefined, base: Voice): Voice {
  return { trato: TRATOS.includes(input?.trato as Trato) ? (input!.trato as Trato) : base.trato };
}
export const START_VOICE: Voice = { trato: "tu" };
export const voiceOf = (slug: string): Voice | null => {
  const f = load(slug);
  const v = f?.versions.find((x) => x.v === f.current)?.voice;
  return v ? soundVoice(v, START_VOICE) : null;
};
export const voiceVersions = (slug: string): { v: number; at: string; current: boolean }[] => {
  const f = load(slug);
  return (f?.versions ?? []).map((v) => ({ v: v.v, at: v.at, current: v.v === f!.current })).reverse();
};

/** The guide every run gets: how to address people. */
export const guideOf = (v: Voice): string => say(VOZ_WORDS).guide(v.trato);
/** The block a run of the project gets; empty while the owner has not chosen. */
export function voiceBlock(slug: string): string {
  const v = voiceOf(slug);
  return v ? `${say(VOZ_WORDS).blockTitle}\n${guideOf(v)}` : "";
}

export type VoiceRead = { voice: Voice | null; base: Voice; guide: string; versions: number };
export async function voiceRead(db: Db, slug: string): Promise<VoiceRead | null> {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const current = voiceOf(slug);
  const base = current ?? START_VOICE;
  return { voice: current, base, guide: guideOf(base), versions: load(slug)?.versions.length ?? 0 };
}

export async function saveVoice(db: Db, slug: string, patch: Partial<Voice>, opts: { keep?: boolean } = {}): Promise<VoiceRead | null> {
  const r = await voiceRead(db, slug);
  if (!r) return null;
  const next = soundVoice(patch, r.base);
  const f = load(slug) ?? { current: 0, versions: [] };
  const last = f.versions.find((v) => v.v === f.current)?.voice;
  if (last && JSON.stringify(soundVoice(last, START_VOICE)) === JSON.stringify(next) && !opts.keep) return r;
  // PLA-130: a change right after the last one joins its version (see versions.ts); going back is kept.
  record(f, (base) => ({ ...base, voice: next }), { keep: opts.keep });
  save(slug, f);
  bus.publish({ type: "project", project: slug });
  return voiceRead(db, slug);
}
export async function goBackVoice(db: Db, slug: string, v: number): Promise<VoiceRead | null> {
  const old = load(slug)?.versions.find((x) => x.v === v)?.voice;
  if (!old) throw new LogoError("LOGO_NOT_FOUND", 404, "version not found");
  return saveVoice(db, slug, old, { keep: true });
}

/** PLA-I69-6: every version with its value, newest first, for Marca → Historial. */
export const voiceHistory = (slug: string): { v: number; at: string; current: boolean; voice: Voice }[] => {
  const f = load(slug);
  return (f?.versions ?? []).map((v) => ({ ...v, voice: soundVoice(v.voice, START_VOICE), current: v.v === f!.current })).reverse();
};
