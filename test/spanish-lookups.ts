// PLA-I2-10 check 5: finds the places in server code that read stored text back by matching Spanish words: regex
// literals and SQL LIKE patterns. test/i2-10-server.test.ts runs it over src/ and compares with a short allow-list,
// each entry with its reason (a documented fallback for rows written before a field existed, or a one-word marker
// read in both languages). Pure.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Words that only a Spanish sentence written by Plania or its agents would carry.
const SPANISH = /[áéíóúñ¿¡]|\b(?:Pedido|desde|Cambios|pide|[Ee]ntend|Respuesta|Planea|Compañía|Constr[uú]yelo|Descartada|decidi|confirm[oó]|Darle|recomiend|recomendad|opci[oó]n|palabras|orden de)/;

export type Lookup = { file: string; line: number; kind: "regex" | "like"; text: string };

// Comments go first (they name the sentences they document); strings stay.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

// A regex literal starts after an operator or an opening bracket, never after a value.
const REGEX_LITERAL = /(?:^|[=(,:!&|?{;[]|\breturn|\bconst \w+ =)\s*(\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+\/[dgimsuy]*)/g;
const NEW_REGEXP = /new RegExp\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g;
const LIKE = /\blike\s+('(?:[^']|'')*'|\$\{[^}]+\})/gi;

export function lookupsIn(file: string, source: string): Lookup[] {
  const text = stripComments(source);
  const out: Lookup[] = [];
  const lineOf = (i: number) => text.slice(0, i).split("\n").length;
  for (const m of text.matchAll(REGEX_LITERAL)) {
    if (SPANISH.test(m[1]!)) out.push({ file, line: lineOf(m.index! + m[0].indexOf(m[1]!)), kind: "regex", text: m[1]! });
  }
  for (const m of text.matchAll(NEW_REGEXP)) if (SPANISH.test(m[2]!)) out.push({ file, line: lineOf(m.index!), kind: "regex", text: m[2]! });
  for (const m of text.matchAll(LIKE)) {
    let pattern = m[1]!;
    // like ${NAME}: the constant's value, when it is declared in the same file.
    const name = /^\$\{(\w+)\}$/.exec(pattern)?.[1];
    if (name) pattern = new RegExp(`\\b${name}\\s*=\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1`).exec(text)?.[2] ?? pattern;
    if (SPANISH.test(pattern)) out.push({ file, line: lineOf(m.index!), kind: "like", text: pattern });
  }
  return out;
}

export function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs)$/.test(name) ? [p] : [];
  });
}

export function lookupsUnder(root: string, dir = "src"): Lookup[] {
  return walk(path.join(root, dir)).flatMap((f) => lookupsIn(path.relative(root, f).split(path.sep).join("/"), readFileSync(f, "utf8")));
}
