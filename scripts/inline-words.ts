// PLA-I2-10: finds Spanish sentences written inline in the screen's components and pages, so the words live in
// wording modules (ui/src/lib/, defineWords) and the screen can be shown in a second language.
// What counts as a sentence: a string literal, a template literal's text or JSX text that holds an accented letter,
// ¿ ¡ « », or at least two Spanish stop-words. Comments are skipped. A file that still holds one is listed in
// test/inline-words-allow.txt until its words move; test/i2-10-language.test.ts fails on any other.
// Run `node --import tsx scripts/inline-words.ts` to list the files and their first finding.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const SCANNED_DIRS = ["ui/src/components", "ui/src/pages"];

const MARKS = /[áéíóúüñÁÉÍÓÚÜÑ¿¡«»]/;
const STOP = new Set(
  "que los las del para con una por sus tus pero como cuando hay nada todo aquí solo sin este esta hasta desde puede más ningún ninguna otra otro cada están está son fue ser tiene tienen corre corrida corridas aún también dónde qué cuál quién pudo pudieron puedes falta faltan todavía ninguno ahora vuelve intenta abre revisa elige escribe entra ver proyecto proyectos tarea tareas agente agentes cambios guardar borrar mostrar ocultar cargar nuevo nueva tu el la de en se lo le al es y o un".split(" "),
);
const ENGLISH_GUARD = new Set(["a", "an", "the", "of", "to", "is", "in", "on", "and", "or", "for", "with", "it"]);

/** True when a piece of text reads as a Spanish sentence. */
export function isSpanish(text: string): boolean {
  if (MARKS.test(text)) return true;
  const words = text.toLowerCase().match(/[a-zñ]+/g) ?? [];
  if (words.length < 2) return false;
  // "de la", "que", "para los"… two stop-words; but text with English function words is English.
  const hits = words.filter((w) => STOP.has(w) && !["el", "la", "de", "en", "se", "lo", "le", "al", "es", "y", "o", "un", "tu"].includes(w)).length;
  const weak = words.filter((w) => ["el", "la", "de", "en", "se", "lo", "le", "al", "es", "y", "un", "tu"].includes(w)).length;
  const english = words.filter((w) => ENGLISH_GUARD.has(w)).length;
  if (english > 0 && english >= hits + weak) return false;
  return hits >= 2 || (hits >= 1 && weak >= 1) || weak >= 3;
}

export type Finding = { line: number; text: string };

/** The texts of a TS/TSX source: string literals, template text and JSX text, with their line. Comments are skipped. */
export function texts(src: string): Finding[] {
  const out: Finding[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const push = (t: string, at: number) => {
    const s = t.trim();
    if (s) out.push({ line: at, text: s });
  };
  // Open template literals: when a `${` closes, we are back inside the template, and its text goes on (a template
  // is judged as one sentence, with "…" where each placeholder was).
  const templates: { depth: number; text: string; at: number }[] = [];
  let depth = 0;
  const readString = (q: string) => {
    const at = line;
    let s = "";
    // A module path (`from "@/lib/nuevo-proyecto"`, `import("…")`) or a data-* attribute's value is code, not words.
    const before = src.slice(Math.max(0, i - 40), i);
    const code = /(?:\bfrom\s*|\bimport\s*\(?\s*|\bdata-[\w-]+=)$/.test(before);
    i++;
    while (i < n && src[i] !== q) {
      if (src[i] === "\\") {
        s += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (src[i] === "\n") line++;
      s += src[i];
      i++;
    }
    i++;
    if (!code) push(s, at);
  };
  const readTemplate = (s = "", at = line) => {
    // i is just after ` or after the } that closes a ${
    while (i < n) {
      const c = src[i]!;
      if (c === "\\") {
        s += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === "`") {
        i++;
        push(s, at);
        return;
      }
      if (c === "$" && src[i + 1] === "{") {
        i += 2;
        templates.push({ depth, text: `${s} … `, at });
        depth++;
        return;
      }
      if (c === "\n") line++;
      s += c;
      i++;
    }
  };
  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      readString(c);
      continue;
    }
    if (c === "`") {
      i++;
      readTemplate();
      continue;
    }
    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      depth--;
      i++;
      if (templates.length && templates[templates.length - 1]!.depth === depth) {
        const t = templates.pop()!;
        readTemplate(t.text, t.at);
      }
      continue;
    }
    if (c === ">" && src[i - 1] !== "=") {
      // JSX text: up to the next < or {. Code after a comparison ends at once or holds no Spanish.
      const at = line;
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== "<" && src[j] !== "{" && src[j] !== "}" && src[j] !== ";" && src[j] !== "(" && src[j] !== ")" && src[j] !== '"' && src[j] !== "'" && src[j] !== "`") {
        s += src[j];
        j++;
      }
      if (j < n && (src[j] === "<" || src[j] === "{")) {
        push(s.replace(/\s+/g, " "), at);
        for (const ch of s) if (ch === "\n") line++;
        i = j;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return out;
}

/** The Spanish sentences of one file. */
export const spanishIn = (src: string): Finding[] => texts(src).filter((f) => isSpanish(f.text));

/** Every .ts/.tsx file under the scanned folders, relative to root, with forward slashes. */
export function scannedFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(path.join(root, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
    }
  };
  for (const d of SCANNED_DIRS) walk(d);
  return out.sort();
}

export function findInline(root: string): Map<string, Finding[]> {
  const found = new Map<string, Finding[]>();
  for (const f of scannedFiles(root)) {
    const hits = spanishIn(readFileSync(path.join(root, f), "utf8"));
    if (hits.length) found.set(f, hits);
  }
  return found;
}

// ---- ui/src/lib: words live inside defineWords
// A module under ui/src/lib may hold Spanish only inside a defineWords({ es, en }) call, where the English twin is
// checked by the type and by test/i2-10-language.test.ts. A Spanish sentence anywhere else there is a word the English
// screen would still show in Spanish. test/lib-words-allow.txt lists the exceptions, each with its reason.
// Known limit, as above: a single-word label («Guardar», «Hoy») is not detected.

export const LIB_DIR = "ui/src/lib";

/** The line ranges of every defineWords( … ) call in a source, found by matching its parentheses. */
export function wordsRanges(src: string): [number, number][] {
  const out: [number, number][] = [];
  const lineAt = (at: number) => src.slice(0, at).split("\n").length;
  for (let k = src.indexOf("defineWords("); k >= 0; k = src.indexOf("defineWords(", k + 1)) {
    let i = k + "defineWords".length;
    let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (c === '"' || c === "'" || c === "`") {
        // Skip the literal. Parentheses inside a template's ${} are balanced, so skipping them with it is harmless.
        for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
    }
    out.push([lineAt(k), lineAt(i)]);
  }
  return out;
}

/** Spanish sentences in ui/src/lib outside every defineWords call, by file (relative, forward slashes). */
export function findLibSpanish(root: string): Map<string, Finding[]> {
  const found = new Map<string, Finding[]>();
  for (const name of readdirSync(path.join(root, LIB_DIR)).sort()) {
    if (!/\.tsx?$/.test(name) || name === "i18n.ts") continue;
    const rel = `${LIB_DIR}/${name}`;
    const src = readFileSync(path.join(root, rel), "utf8");
    const ranges = wordsRanges(src);
    const hits = spanishIn(src).filter((f) => !ranges.some(([a, b]) => f.line >= a && f.line <= b));
    if (hits.length) found.set(rel, hits);
  }
  return found;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  // --lib: the ui/src/lib check instead of the components and pages.
  const found = process.argv.includes("--lib") ? findLibSpanish(process.cwd()) : findInline(process.cwd());
  let total = 0;
  for (const [f, hits] of found) {
    total += hits.length;
    console.log(`${f}\t${hits.length}\t${hits[0]!.line}: ${hits[0]!.text.slice(0, 70)}`);
  }
  console.log(`${found.size} files, ${total} sentences`);
}
