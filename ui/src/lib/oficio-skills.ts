// PLA-I67-2: the skill card's pure part: its types, the line diff between two versions, the «Para quién» choices
// and the error a save shows. Tested without a browser (test/i67-skills-ui.test.ts). Pure: no "@/" imports.
import { getLanguage, words, type Language } from "./i18n.js";
import { SKILL_CARD_WORDS } from "./oficio-skill-words.js";

export type SkillScope = "agent" | "project" | "seat" | "company";
export type SkillFile = { path: string; content: string };
export type SkillCardVersion = { n: number; hash: string; at: string; author: string; note: string | null; name: string; description: string; body: string };
export type SkillCard = {
  slug: string;
  name: string;
  when: string;
  body: string;
  files: SkillFile[];
  source: "owner" | "kit" | "doc";
  origin: "owner" | "factory-copy" | "imported" | null;
  scope: SkillScope | null;
  state: "on" | "off" | "archived" | null;
  on: boolean;
  version: string;
  n: number | null;
  versions: SkillCardVersion[];
  factory_changed: boolean;
  archived_at: string | null;
  carried: number;
  // PLA-I67-6: an imported skill's link and the content hash it is pinned to.
  link?: { url: string; hash: string; checked_at: string | null; kind?: "link" | "github" | "skills.sh" | null; commit?: string | null; publisher?: string | null; dropped?: string[]; review?: { words: number; dropped: string[]; marks: { file: string; line: number; kind: "secret" | "link"; text: string }[]; pinned: string } | null; upstream_hash?: string | null } | null;
};
export type Puesto = {
  project: string;
  agent: string;
  role: string;
  // PLA-I71-2: the role prompt its runs carry, shown read-only in the wide panel.
  role_text?: string | null;
  manner: string | null;
  manner_version: string | null;
  manner_at: string | null;
  motor: { model: string | null; effort: string | null };
  archived: { slug: string; name: string; archived_at: string }[];
};
export type SkillDraft = { name: string; description: string; body: string; scope: SkillScope };

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** Line diff of a → b (longest common subsequence). The body is at most 500 lines, so the table stays small. */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const m = x.length;
  const n = y.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (x[i] === y[j]) {
      out.push({ kind: "same", text: x[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: "del", text: x[i++]! });
    else out.push({ kind: "add", text: y[j++]! });
  }
  while (i < m) out.push({ kind: "del", text: x[i++]! });
  while (j < n) out.push({ kind: "add", text: y[j++]! });
  return out;
}

/** What changed from one version to the next: name, «cuándo» and body, as one text each. */
export function versionDiff(prev: Pick<SkillCardVersion, "name" | "description" | "body"> | null, next: Pick<SkillCardVersion, "name" | "description" | "body">): DiffLine[] {
  const text = (v: Pick<SkillCardVersion, "name" | "description" | "body">) => `# ${v.name}\n${v.description}\n\n${v.body}`;
  return lineDiff(prev ? text(prev) : "", text(next));
}

/** Only the changed lines and one line around each, so a long body reads in the card. */
export function changedOnly(diff: DiffLine[], around = 1): (DiffLine | { kind: "gap" })[] {
  const keep = diff.map((d, i) => d.kind !== "same" || diff.slice(Math.max(0, i - around), i + around + 1).some((x) => x.kind !== "same"));
  const out: (DiffLine | { kind: "gap" })[] = [];
  diff.forEach((d, i) => {
    if (keep[i]) out.push(d);
    else if (out[out.length - 1]?.kind !== "gap") out.push({ kind: "gap" });
  });
  if (out[out.length - 1]?.kind === "gap") out.pop();
  return out;
}

/** «Para quién», narrowest first. */
export function scopeOptions(seat: string, language: Language = getLanguage()): { value: SkillScope; label: string }[] {
  const w = words(SKILL_CARD_WORDS, language);
  return [
    { value: "agent", label: w.scopeAgent(seat) },
    { value: "project", label: w.scopeProject },
    { value: "seat", label: w.scopeSeat(seat) },
    { value: "company", label: w.scopeCompany },
  ];
}

/** The card's top line: «Habilidad tuya · v3», «Tu versión · v2» (a factory copy) or «De fábrica». */
export function cardHead(c: Pick<SkillCard, "source" | "origin" | "n">, language: Language = getLanguage()): string {
  const w = words(SKILL_CARD_WORDS, language);
  if (c.source !== "owner") return w.factory;
  return `${c.origin === "factory-copy" ? w.yoursCopy : w.yours} · ${w.version(c.n ?? 1)}`;
}

/** A version's note in words: a roll back, the factory text, or nothing. */
export function versionNote(v: Pick<SkillCardVersion, "note">, language: Language = getLanguage()): string | null {
  const w = words(SKILL_CARD_WORDS, language);
  if (!v.note) return null;
  if (v.note === "factory") return w.fromFactory;
  // PLA-I67-6: a version brought from a link.
  if (v.note.startsWith("link:")) return w.fromLink;
  const m = /^rollback:(\d+)$/.exec(v.note);
  return m ? w.rolledBack(Number(m[1])) : null;
}

/** A refused save, in words. */
export function saveError(code: string | null, field?: string | null, language: Language = getLanguage()): string | null {
  if (!code) return null;
  const w = words(SKILL_CARD_WORDS, language);
  if (code === "SKILL_NOT_ALLOWED") return w.notAllowed;
  if (code === "SKILL_EXISTS") return w.exists;
  if (code === "SKILL_NOT_FOUND") return w.notFound;
  if (code === "SKILL_INVALID") {
    const f = field === "name" || field === "slug" ? w.fieldName : field === "description" ? w.fieldWhen : field === "files" ? w.fieldFiles : w.fieldWhat;
    return w.invalid(f);
  }
  return w.failed(code);
}

/** Whether a draft differs from the card it was opened from. */
export const draftChanged = (c: Pick<SkillCard, "name" | "when" | "body" | "scope">, d: SkillDraft): boolean =>
  c.name !== d.name.trim() || c.when !== d.description.replace(/\s+/g, " ").trim() || c.body !== d.body.trim() || (c.scope ?? "agent") !== d.scope;
