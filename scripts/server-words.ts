// PLA-I2-10: the server's twin of scripts/inline-words.ts. Finds Spanish sentences in string literals under src/
// that sit outside a wording module (the argument of a defineWords call), so every sentence the server makes for the
// owner has both languages. Sentence detection is the screen's (isSpanish, texts). A finding that is meant to stay
// (Spanish that is data: a parser fallback for old rows, a stored value, a word list read in both languages) is listed
// in test/server-words-allow.txt with its reason; test/i2-10-server.test.ts fails on anything else.
// Run `node --import tsx scripts/server-words.ts` to list what is left.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isSpanish, texts, type Finding } from "./inline-words.js";

/** [start, end] offsets of every defineWords(...) argument list, skipping strings, templates and comments. */
export function wordingSpans(src: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /\bdefineWords\s*(?:<[^>(]*>)?\s*\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let i = m.index + m[0].length;
    let depth = 1;
    const stack: string[] = []; // open template literals inside ${ }
    while (i < src.length && depth > 0) {
      const c = src[i]!;
      if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        i = src.indexOf("*/", i + 2) + 2 || src.length;
        continue;
      }
      if (c === '"' || c === "'") {
        i++;
        while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
        i++;
        continue;
      }
      if (c === "`") {
        // A template: skip to its end, entering ${ } as code.
        i++;
        while (i < src.length && src[i] !== "`") {
          if (src[i] === "\\") i += 2;
          else if (src[i] === "$" && src[i + 1] === "{") {
            let d = 1;
            i += 2;
            while (i < src.length && d > 0) {
              if (src[i] === "{") d++;
              else if (src[i] === "}") d--;
              else if (src[i] === "`") {
                i++;
                while (i < src.length && src[i] !== "`") i += src[i] === "\\" ? 2 : 1;
              }
              i++;
            }
          } else i++;
        }
        i++;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    out.push([m.index, i]);
    void stack;
  }
  return out;
}

const lineStarts = (src: string): number[] => {
  const out = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") out.push(i + 1);
  return out;
};

/** Spanish sentences in a source file, outside its wording modules. */
export function serverSpanishIn(src: string): Finding[] {
  const spans = wordingSpans(src);
  const starts = lineStarts(src);
  const inWords = (line: number) => {
    const at = starts[line - 1] ?? 0;
    const end = starts[line] ?? src.length;
    // A line that overlaps a defineWords argument list belongs to the wording module.
    return spans.some(([a, b]) => at <= b && end - 1 >= a);
  };
  return texts(src).filter((f) => isSpanish(f.text) && !inWords(f.line));
}

export function serverFiles(root: string, dir = "src"): string[] {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((name) => {
      const p = path.join(d, name);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|mts)$/.test(name) ? [p] : [];
    });
  return walk(path.join(root, dir)).map((f) => path.relative(root, f).split(path.sep).join("/"));
}

export function findServerSpanish(root: string): Map<string, Finding[]> {
  const out = new Map<string, Finding[]>();
  for (const f of serverFiles(root)) {
    const found = serverSpanishIn(readFileSync(path.join(root, f), "utf8"));
    if (found.length) out.set(f, found);
  }
  return out;
}

/** The allow-list: `path | reason` per line; # starts a comment. */
export function readAllow(file: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.replace(/#.*$/, "").trim();
    if (!t) continue;
    const [p, ...why] = t.split("|");
    out.set(p!.trim(), why.join("|").trim());
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const root = path.resolve(import.meta.dirname, "..");
  const found = findServerSpanish(root);
  let n = 0;
  for (const [f, list] of [...found].sort((a, b) => b[1].length - a[1].length)) {
    n += list.length;
    console.log(`${String(list.length).padStart(3)} ${f}`);
    if (process.argv.includes("--all")) for (const x of list) console.log(`      ${x.line}: ${x.text.slice(0, 120)}`);
  }
  console.log(`${n} sentences in ${found.size} files`);
}
