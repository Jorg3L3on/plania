// Vendored from src/lib/scan for the private scanner repo. No plaintext patterns.
// PLA-I38-1: currency-shaped numbers near money words. Generic code words (balance, amount) only
// count when the number itself looks like money (cents, thousands separators, or a currency marker).

export type LineHit = { rule: string; label: string; value: string };

const RULE = "plania-balance";
const WINDOW = 48;
const ANY_KEYWORD = /\b(?:saldo|monto|importe|balance|amount|mxn|usd|eur|cad|gbp|usdt|usdc)\b/gi;
const MONEY_WORD = /\b(?:saldo|monto|importe)\b/gi;
const SHAPES = [
  String.raw`[$€£]\s?\d{2,}(?:[.,]\d{1,2})?`,
  String.raw`[$€£]\s?\d+\.\d{2}`,
  String.raw`\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b`,
  String.raw`\b\d+\.\d{2}\b`,
  String.raw`\b(?:MXN|USD|EUR|CAD|GBP|USDT|USDC)\s?\$?\s?\d[\d,]*(?:\.\d{1,2})?\b`,
  String.raw`\b\d[\d,]*(?:\.\d{1,2})?\s?(?:MXN|USD|EUR|CAD|GBP|USDT|USDC)\b`,
];

function near(line: string, start: number, end: number, pattern: RegExp): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  for (const match of line.matchAll(new RegExp(pattern.source, flags))) {
    const keywordStart = match.index ?? 0;
    const keywordEnd = keywordStart + match[0].length;
    const gap = keywordStart >= end ? keywordStart - end : start >= keywordEnd ? start - keywordEnd : 0;
    if (gap <= WINDOW) return true;
  }
  return false;
}

/** Money-like amounts in one line. The matched text is for the allowlist only. */
export function balanceHits(line: string): LineHit[] {
  const hits: LineHit[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    hits.push({ rule: RULE, label: "monto", value: trimmed });
  };
  for (const source of SHAPES) {
    for (const match of line.matchAll(new RegExp(source, "gi"))) {
      const start = match.index ?? 0;
      if (!near(line, start, start + match[0].length, ANY_KEYWORD)) continue;
      push(match[0]);
    }
  }
  for (const match of line.matchAll(/\b\d{2,12}\b/g)) {
    const start = match.index ?? 0;
    if (!near(line, start, start + match[0].length, MONEY_WORD)) continue;
    if ([...seen].some((value) => value.includes(match[0]))) continue;
    push(match[0]);
  }
  return hits.filter((hit) => !hits.some((other) => other.value !== hit.value && other.value.includes(hit.value)));
}
