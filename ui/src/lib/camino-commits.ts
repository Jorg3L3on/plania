// PLA-I68-4: Camino's «Commits y propuestas». One pure module the screen, the runner and the hook share:
//   classify / historyMix  the project's real style, from its last 200 non-merge commits (share per style, the last
//                          50, language, median subject length, AI co-author trailers); the dominant style is proposed
//                          when it holds 60 % or more.
//   preview                a commit in the chosen convention, built from the project's own recent subject.
//   instructions           the text every run receives (the role prompt's context), shown verbatim on the page.
//   lintRules / lint       the rules Plania checks before a run pushes (a PreToolUse hook, scripts/camino-commit-hook.mjs,
//                          reads the same rules as JSON), with the reason the agent gets to rewrite.
//   prTitleWorkflow        the optional CI check on PR titles, proposed by PR (the only way anything reaches the repo).
// No "@/" imports: the server and the runner import this file.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import type { CommitSettings, ConventionId } from "./camino-types.js";

export type StyleKey = "conventional" | "area" | "ticket" | "gitmoji" | "classic" | "plain";
export const STYLE_KEYS: StyleKey[] = ["conventional", "area", "ticket", "gitmoji", "classic", "plain"];
export const ALL_TYPES = ["feat", "fix", "docs", "refactor", "perf", "test", "build", "ci", "chore", "style", "revert"];
const TYPE_RE = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: \S/;
const TICKET_RE = /^[A-Z][A-Z0-9]+-[A-Z0-9-]*\d[A-Z0-9-]*:? \S/;
const EMOJI_RE = /^(:[a-z0-9_+-]+:|\p{Extended_Pictographic})/u;
const AREA_RE = /^[\p{Lu}][\p{L}\d .&/-]{0,40}: \S/u;
export const AI_TRAILER_RE = /^(co-authored-by|assisted-by|generated-by):.*\b(claude|anthropic|copilot|chatgpt|openai|gpt|cursor|codex|gemini|devin)\b/im;

export const subjectOf = (message: string): string => message.split("\n")[0]!.trim();

/** The style of one commit, by its first line. */
export function classify(message: string): StyleKey {
  const s = subjectOf(message);
  if (TYPE_RE.test(s)) return "conventional";
  if (TICKET_RE.test(s)) return "ticket";
  if (EMOJI_RE.test(s)) return "gitmoji";
  if (AREA_RE.test(s)) return "area";
  if (/^\p{Lu}/u.test(s) && s.length <= 72 && !/[.:]$/.test(s) && !/\s{2}/.test(s)) return "classic";
  return "plain";
}

const ES = /[áéíóúñ¿¡]|\b(el|la|los|las|del|para|que|con|una|sin|por|cuando|ahora|ya|se)\b/i;
const langOf = (s: string): "es" | "en" => (ES.test(s) ? "es" : "en");

export type HistoryMix = {
  n: number;
  share: Record<StyleKey, number>;
  recent: { n: number; share: Record<StyleKey, number> };
  dominant: StyleKey | null;
  recentDominant: StyleKey | null;
  lang: "es" | "en";
  median: number;
  ai: number;
  /** The convention to propose: the dominant style when it holds 60 % or more and maps to one. */
  propose: ConventionId | null;
};

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
function shares(msgs: string[]): Record<StyleKey, number> {
  const out = Object.fromEntries(STYLE_KEYS.map((k) => [k, 0])) as Record<StyleKey, number>;
  for (const m of msgs) out[classify(m)]++;
  for (const k of STYLE_KEYS) out[k] = pct(out[k], msgs.length);
  return out;
}
const top = (s: Record<StyleKey, number>): StyleKey | null => {
  const best = STYLE_KEYS.reduce((a, b) => (s[b] > s[a] ? b : a));
  return s[best] > 0 ? best : null;
};

export function historyMix(messages: string[]): HistoryMix {
  const msgs = messages.slice(0, 200);
  const share = shares(msgs);
  const recentMsgs = msgs.slice(0, 50);
  const recent = { n: recentMsgs.length, share: shares(recentMsgs) };
  const lens = msgs.map((m) => subjectOf(m).length).sort((a, b) => a - b);
  const median = lens.length ? lens[Math.floor((lens.length - 1) / 2)]! : 0;
  const es = msgs.filter((m) => langOf(subjectOf(m)) === "es").length;
  const dominant = top(share);
  const map: Partial<Record<StyleKey, ConventionId>> = { conventional: "conventional", area: "area", ticket: "ticket", gitmoji: "gitmoji", classic: "classic" };
  return {
    n: msgs.length,
    share,
    recent,
    dominant,
    recentDominant: top(recent.share),
    lang: es * 2 > msgs.length ? "es" : "en",
    median,
    ai: msgs.filter((m) => AI_TRAILER_RE.test(m)).length,
    propose: dominant && share[dominant] >= 60 ? (map[dominant] ?? null) : null,
  };
}

/** How many of the recent commits already follow a convention (0–100), when the history can say. */
export function followShare(mix: HistoryMix, c: ConventionId): number | null {
  const k: Partial<Record<ConventionId, StyleKey>> = { conventional: "conventional", area: "area", ticket: "ticket", gitmoji: "gitmoji", classic: "classic" };
  const key = k[c];
  return key ? mix.recent.share[key] : null;
}

// ---- the sample the preview is built from: the project's own last subject
export type Sample = { area: string; scope: string; key: string; desc: string; body: string };
export function sampleOf(subjects: string[], folders: string[], fallbackKey: string): Sample {
  const s = subjects.find((x) => x.trim()) ?? "";
  const key = s.match(/\b([A-Z][A-Z0-9]+-[A-Z0-9-]*\d[A-Z0-9-]*)\b/)?.[1] ?? fallbackKey;
  const desc =
    s
      .replace(/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?:\s*/, "")
      .replace(/^[A-Z][A-Z0-9]+-[A-Z0-9-]*\d[A-Z0-9-]*:?\s*/, "")
      .replace(/^(:[a-z0-9_+-]+:|\p{Extended_Pictographic})\s*/u, "")
      .replace(/^[\p{Lu}][\p{L}\d .&/-]{0,40}:\s*/u, "")
      .replace(/\s*\([A-Z][A-Z0-9]+-[^)]*\)$/, "")
      .replace(/[.]$/, "")
      .trim() || "add the first screen";
  const scope = (folders[0] ?? "app").split("/").pop()!.toLowerCase();
  return { area: scope.charAt(0).toUpperCase() + scope.slice(1), scope, key, desc: desc.charAt(0).toLowerCase() + desc.slice(1), body: "" };
}

/** A commit in the chosen convention and settings, from the sample. */
export function preview(c: ConventionId, st: CommitSettings, s: Sample, language: Language = getLanguage()): string {
  const w = words(COMMITS_WORDS, language);
  const sc = st.scope !== "no" ? `(${s.scope})` : "";
  const withKey = (t: string) => (st.ticket === "prefijo" && c !== "ticket" ? `${s.key}: ${t}` : st.ticket === "final" && c !== "area" && c !== "ticket" ? `${t} (${s.key})` : t);
  let subject: string;
  switch (c) {
    case "conventional":
      subject = withKey(`feat${sc}: ${s.desc}`);
      break;
    case "area":
      subject = `${s.area}: ${s.desc} (${s.key})`;
      break;
    case "ticket":
      subject = `${s.key}: ${s.desc}`;
      break;
    case "gitmoji":
      subject = withKey(`${st.emoji ? ":sparkles:" : "✨"} ${s.desc}`);
      break;
    case "classic":
      subject = withKey(s.desc.charAt(0).toUpperCase() + s.desc.slice(1));
      break;
    case "kernel":
      subject = `${s.scope}: ${s.desc}`;
      break;
    default:
      subject = withKey(s.desc);
  }
  const body = st.body && (c === "conventional" || c === "gitmoji") ? `\n\n${s.body || w.sampleBody}` : "";
  const trailer = st.ticket === "trailer" ? `\n\nRefs: ${s.key}` : "";
  const ai = st.ai ? `\n${body || trailer ? "" : "\n"}Assisted-by: <agente>` : "";
  return `${subject}${body}${trailer}${ai}`;
}

// ---- lint rules: plain data the hook (a .mjs with no build step) applies the same way
export type LintRule = { id: string; on: "subject" | "message" | "title"; re: string; flags: string; must: boolean; why: string; only?: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEY = "[A-Z][A-Z0-9]+-[A-Z0-9-]*\\d[A-Z0-9-]*";

/** The first-line pattern a convention asks for (null for none), with the ticket key placed as the settings say. */
export function subjectPattern(c: ConventionId, st: CommitSettings): string | null {
  const types = (st.types.length ? st.types : ALL_TYPES).map(esc).join("|");
  const scope = st.scope === "obligatorio" ? "\\([a-z0-9._/-]+\\)" : st.scope === "opcional" ? "(\\([a-z0-9._/-]+\\))?" : "";
  const pre = st.ticket === "prefijo" && c !== "ticket" ? `${KEY}: ` : "";
  const post = st.ticket === "final" && c !== "ticket" && c !== "area" ? ` \\(${KEY}\\)` : "";
  const core: Record<ConventionId, string | null> = {
    conventional: `(${types})${scope}!?: \\S.*`,
    area: `[\\p{Lu}][\\p{L}\\d .&/-]{0,40}: \\S.*`,
    ticket: `${KEY}: \\S.*`,
    gitmoji: `(:[a-z0-9_+-]+:|\\p{Extended_Pictographic}) \\S.*`,
    classic: `[\\p{Lu}][^\\n]*`,
    kernel: `[a-z0-9_/.-]+: \\S.*`,
    custom: st.custom_regex?.trim() ? st.custom_regex.trim().replace(/^\^/, "").replace(/\$$/, "") : null,
  };
  const body = core[c];
  if (!body) return null;
  return `^${pre}${body}${post}$`;
}

export function lintRules(st: CommitSettings, language: Language = getLanguage()): LintRule[] {
  const w = words(COMMITS_WORDS, language).lint;
  const rules: LintRule[] = [];
  const c = st.convention;
  const pat = c ? subjectPattern(c, st) : null;
  if (c && pat) {
    rules.push({ id: "format", on: "subject", re: pat, flags: "u", must: true, why: w.format(formatOf(c, language)) });
    if (st.pr_title) rules.push({ id: "pr-format", on: "title", re: pat, flags: "u", must: true, why: w.prFormat(formatOf(c, language)) });
  }
  rules.push({ id: "max", on: "subject", re: `^.{1,${st.max}}$`, flags: "u", must: true, why: w.max(st.max) });
  rules.push({ id: "period", on: "subject", re: "\\.$", flags: "", must: false, why: w.period });
  rules.push({ id: "vague", on: "subject", re: "^(update( files?)?|misc|wip|fix(es)?|changes|cambios( varios)?|this commit\\b.*)$", flags: "i", must: false, why: w.vague });
  if (!st.emoji && c !== "gitmoji") rules.push({ id: "emoji", on: "subject", re: "\\p{Extended_Pictographic}", flags: "u", must: false, why: w.emoji });
  if (!st.ai) rules.push({ id: "ai", on: "message", re: AI_TRAILER_RE.source, flags: "im", must: false, why: w.ai });
  rules.push({ id: "signed", on: "message", re: "^signed-off-by:", flags: "im", must: false, why: w.signed });
  if (st.ticket === "trailer") rules.push({ id: "refs", on: "message", re: `^Refs: ${KEY}$`, flags: "m", must: true, why: w.refs });
  if (st.body && c === "conventional") rules.push({ id: "body", on: "message", re: "^[^\\n]+\\n\\n(?!(Refs|Assisted-by|Co-authored-by):)[^\\n]+", flags: "i", must: true, why: w.body, only: "^(feat|fix)(\\(|!|:)" });
  return rules;
}

/** The problems of one commit message (or a PR title with on: "title"), each a sentence for the agent. */
export function lint(text: string, rules: LintRule[], on: "commit" | "title" = "commit"): string[] {
  const out: string[] = [];
  const subject = subjectOf(text);
  for (const r of rules) {
    if (on === "title" ? r.on !== "title" && r.id !== "max" && r.id !== "period" && r.id !== "vague" : r.on === "title") continue;
    const target = r.on === "message" ? text : subject;
    if (r.only && !new RegExp(r.only).test(subject)) continue;
    const hit = new RegExp(r.re, r.flags).test(target);
    if (hit !== r.must) out.push(r.why);
  }
  return out;
}

/** The message without AI co-author trailers (the owner's rule), the rest kept. */
export const stripAi = (message: string): string =>
  message
    .split("\n")
    .filter((l) => !new RegExp(AI_TRAILER_RE.source, "i").test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

// ---- the instructions every run receives
/** How each convention's first line looks, in words. */
export const formatOf = (c: ConventionId, language: Language = getLanguage()): string => words(COMMITS_WORDS, language).formats[c];

export function instructions(st: CommitSettings, folders: string[], language: Language = getLanguage()): string {
  const w = words(COMMITS_WORDS, language).instr;
  const c = st.convention ?? "conventional";
  const lines = [c === "custom" ? w.formatCustom : w.format(formatOf(c, language))];
  if (c === "conventional") lines.push(w.types(st.types.join(", "), st.scope, folders.slice(0, 8).join(", ")));
  if (c === "custom" && st.custom_regex) lines.push(w.custom(st.custom_regex));
  lines.push(w.desc(st.lang, st.max));
  if (st.body && (c === "conventional" || c === "gitmoji")) lines.push(w.body);
  lines.push(st.ticket === "trailer" ? w.trailer : st.ticket === "prefijo" ? w.prefix : st.ticket === "final" ? w.final : w.noKey);
  lines.push(st.emoji ? w.emoji : w.noEmoji);
  lines.push(st.ai ? w.assisted : w.noAi);
  if (st.pr_title) lines.push(w.prTitle);
  lines.push(w.never);
  const ex = st.examples.split("\n").map((l) => l.trim()).filter(Boolean);
  const good = ex.filter((l) => !l.startsWith("✗"));
  const bad = ex.filter((l) => l.startsWith("✗")).map((l) => l.slice(1).trim());
  if (good.length) lines.push(`${w.good}\n${good.map((l) => `  ${l}`).join("\n")}`);
  if (bad.length) lines.push(`${w.bad}\n${bad.map((l) => `  ${l}`).join("\n")}`);
  lines.push(w.check);
  return lines.join("\n");
}

// ---- the PR-title check, proposed by PR when the owner picks it. No action to pin, no permissions, two minutes.
/** The first-line pattern as a POSIX ERE grep -E understands (no \p classes: letters are spelled out). */
export function eres(pattern: string): string {
  // PLA-I70-1: a class shorthand is a bare range inside [...] and a bracket expression outside it.
  const classes: Record<string, string> = {
    "\\p{Lu}": "A-ZÁÉÍÓÚÑ",
    "\\p{L}": "A-Za-zÁÉÍÓÚÑáéíóúñ",
    "\\d": "0-9",
  };
  const src = pattern.replace(/\[\^\\n\]/g, ".").replace(/\(\?:/g, "(");
  let out = "";
  let inClass = false;
  for (let i = 0; i < src.length; ) {
    const rest = src.slice(i);
    const hit = Object.keys(classes).find((k) => rest.startsWith(k));
    if (hit) {
      out += inClass ? classes[hit] : `[${classes[hit]}]`;
      i += hit.length;
    } else if (rest.startsWith("\\p{Extended_Pictographic}")) {
      out += inClass ? " -~" : "[^ -~]";
      i += "\\p{Extended_Pictographic}".length;
    } else if (rest.startsWith("\\S")) {
      out += inClass ? "!-~" : "[^ ]";
      i += 2;
    } else if (src[i] === "\\") {
      out += src.slice(i, i + 2);
      i += 2;
    } else {
      if (src[i] === "[" && !inClass) inClass = true;
      else if (src[i] === "]" && inClass) inClass = false;
      out += src[i];
      i++;
    }
  }
  return out;
}
export function prTitleWorkflow(c: ConventionId, st: CommitSettings, language: Language = getLanguage()): string | null {
  const pat = subjectPattern(c, st);
  if (!pat) return null;
  const re = eres(pat).replace(/'/g, "'\\''");
  return [
    "name: PR title",
    "",
    "# Proposed by Plania (Camino › Commits y propuestas): the PR title is the commit a squash merge keeps.",
    "on:",
    "  pull_request:",
    "    types: [opened, edited, synchronize, reopened]",
    "",
    "permissions: {}",
    "",
    "concurrency:",
    "  group: pr-title-${{ github.event.pull_request.number }}",
    "  cancel-in-progress: true",
    "",
    "jobs:",
    "  title:",
    "    name: pr-title",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 2",
    "    steps:",
    "      - name: Check the PR title",
    "        env:",
    "          TITLE: ${{ github.event.pull_request.title }}",
    "        run: |",
    `          if ! printf '%s' "$TITLE" | grep -Eq '${re}'; then`,
    `            echo "::error::${words(COMMITS_WORDS, language).prError(formatOf(c, language)).replace(/"/g, "'")}"`,
    "            exit 1",
    "          fi",
    "",
  ].join("\n");
}

export const COMMITS_WORDS = defineWords({
  es: {
    formats: {
      conventional: "tipo(alcance): descripción",
      area: "Área: descripción (CLAVE)",
      ticket: "CLAVE: descripción",
      gitmoji: "✨ descripción",
      classic: "Imperativo, 50 caracteres, sin punto",
      kernel: "área: resumen",
      custom: "tu patrón",
    } as Record<ConventionId, string>,
    prError: (f: string) => `El título de la propuesta debe verse así: ${f}`,
    sampleBody: "Antes no pasaba esto; ahora sí, y por qué importa.",
    lint: {
      format: (f: string) => `La primera línea no sigue el formato del proyecto: ${f}.`,
      prFormat: (f: string) => `El título de la propuesta no sigue el formato del proyecto: ${f}.`,
      max: (n: number) => `La primera línea pasa de ${n} caracteres.`,
      period: "La primera línea termina en punto.",
      vague: "La primera línea no dice qué cambió («update», «misc», «WIP»…).",
      emoji: "Este proyecto no usa emoji en los commits.",
      ai: "Lleva una línea de coautor o ayuda de IA, y la regla del proyecto no lo permite.",
      signed: "Lleva «Signed-off-by»: solo una persona puede firmar.",
      refs: "Falta la clave del ticket al final, como «Refs: CLAVE».",
      body: "Un feat o fix explica el porqué en el cuerpo, después de una línea en blanco.",
    },
    instr: {
      format: (f: string) => `Escribe cada commit con el formato ${f}.`,
      formatCustom: "Escribe cada commit con el patrón propio de este proyecto.",
      types: (types: string, scope: string, folders: string) => `Tipos permitidos, en inglés: ${types}. Alcance ${scope}${scope !== "no" && folders ? `, de estas carpetas: ${folders}` : ""}.`,
      custom: (re: string) => `La primera línea debe cumplir esta expresión: ${re}`,
      desc: (lang: "es" | "en", max: number) => `La descripción en ${lang === "es" ? "español" : "inglés"}, en imperativo, sin punto final, de ${max} caracteres o menos en la primera línea.`,
      body: "Para feat y fix: deja una línea en blanco y explica el porqué en el cuerpo.",
      trailer: "La clave del ticket va al final como «Refs: CLAVE».",
      prefix: "Empieza con la clave del ticket y dos puntos.",
      final: "La clave del ticket va entre paréntesis al final de la primera línea.",
      noKey: "No pongas la clave del ticket.",
      emoji: "Usa el emoji del tipo como código (:sparkles:).",
      noEmoji: "Sin emoji.",
      assisted: "Agrega «Assisted-by: <agente>» al final.",
      noAi: "No agregues líneas de coautor ni de asistencia de IA, ni «Signed-off-by».",
      prTitle: "El título de la propuesta sigue el mismo formato: es el commit que queda al fusionar.",
      never: "Nunca: «Update files», «misc», «WIP», ni frases como «This commit…».",
      good: "Ejemplos buenos:",
      bad: "Ejemplos malos:",
      check: "Antes de hacer el commit, revisa que cumpla todo esto. Plania lo revisa antes de subir y te pide reescribirlo si no.",
    },
  },
  en: {
    formats: {
      conventional: "type(scope): description",
      area: "Area: description (KEY)",
      ticket: "KEY: description",
      gitmoji: "✨ description",
      classic: "Imperative, 50 characters, no period",
      kernel: "area: summary",
      custom: "your pattern",
    } as Record<ConventionId, string>,
    prError: (f: string) => `The PR title must look like: ${f}`,
    sampleBody: "This did not happen before; now it does, and why it matters.",
    lint: {
      format: (f: string) => `The first line does not follow the project's format: ${f}.`,
      prFormat: (f: string) => `The PR title does not follow the project's format: ${f}.`,
      max: (n: number) => `The first line is longer than ${n} characters.`,
      period: "The first line ends with a period.",
      vague: "The first line does not say what changed («update», «misc», «WIP»…).",
      emoji: "This project uses no emoji in commits.",
      ai: "It carries an AI co-author or assistance line, and the project's rule does not allow it.",
      signed: "It carries «Signed-off-by»: only a person can sign.",
      refs: "The ticket key is missing at the end, as «Refs: KEY».",
      body: "A feat or fix explains why in the body, after a blank line.",
    },
    instr: {
      format: (f: string) => `Write every commit in the format ${f}.`,
      formatCustom: "Write every commit with this project's own pattern.",
      types: (types: string, scope: string, folders: string) => `Allowed types, in English: ${types}. Scope ${scope}${scope !== "no" && folders ? `, from these folders: ${folders}` : ""}.`,
      custom: (re: string) => `The first line must match this expression: ${re}`,
      desc: (lang: "es" | "en", max: number) => `The description in ${lang === "es" ? "Spanish" : "English"}, imperative, no final period, ${max} characters or fewer on the first line.`,
      body: "For feat and fix: leave a blank line and explain why in the body.",
      trailer: "The ticket key goes at the end as «Refs: KEY».",
      prefix: "Start with the ticket key and a colon.",
      final: "The ticket key goes in parentheses at the end of the first line.",
      noKey: "Do not add the ticket key.",
      emoji: "Use the type's emoji as a shortcode (:sparkles:).",
      noEmoji: "No emoji.",
      assisted: "Add «Assisted-by: <agent>» at the end.",
      noAi: "Add no co-author or AI assistance lines, and no «Signed-off-by».",
      prTitle: "The PR title follows the same format: it is the commit that stays after merging.",
      never: "Never: «Update files», «misc», «WIP», or sentences like «This commit…».",
      good: "Good examples:",
      bad: "Bad examples:",
      check: "Before committing, check it meets all of this. Plania checks it before pushing and asks you to rewrite it if not.",
    },
  },
});
