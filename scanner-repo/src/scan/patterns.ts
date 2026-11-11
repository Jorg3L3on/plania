// Vendored from src/lib/scan for the private scanner repo. No plaintext patterns.
// PLA-04 / PLA-I38-1: what scan-diff looks for in added lines. Output is rule, file, and line.
// The in-memory finding still carries the value so the allowlist can match it, and a mask for
// callers that need a preview. The CLI does not print either. The allowlist lives outside the
// scanned repo (~/.config/plania/scan-allowlist): literal values, /regex/, and path: entries.

import { balanceHits } from "./balance.ts";
import { walletHits } from "./wallets.ts";

export type Confidence = "high" | "hint";
export type Kind = "token" | "private_key" | "credential_url" | "clabe" | "card" | "curp" | "rfc" | "email" | "env_file" | "wallet" | "balance";
export type Finding = { rule: string; kind: Kind; confidence: Confidence; label: string; masked: string; value: string };

/** First 2 and last 4 characters kept, the rest starred; short values keep 1 and 1. The full value never survives. */
export function mask(value: string): string {
  const v = value.trim();
  if (v.length <= 6) return `${v.slice(0, 1)}${"*".repeat(Math.max(1, v.length - 2))}${v.length > 2 ? v.slice(-1) : ""}`;
  const keepEnd = v.length >= 12 ? 4 : 2;
  return `${v.slice(0, 2)}${"*".repeat(v.length - 2 - keepEnd)}${v.slice(-keepEnd)}`;
}

/** CLABE: 18 digits whose last is the check digit of the first 17 with weights 3, 7, 1. */
export function validClabe(digits: string): boolean {
  if (!/^\d{18}$/.test(digits)) return false;
  const weights = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (Number(digits[i]) * weights[i % 3]!) % 10;
  return (10 - (sum % 10)) % 10 === Number(digits[17]);
}

/** Luhn over 13 to 19 digits. */
export function luhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const TOKENS: { re: RegExp; label: string; rule: string }[] = [
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, label: "token de GitHub", rule: "github-pat" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, label: "token de GitHub", rule: "github-fine-grained-pat" },
  { re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g, label: "clave de API (sk-)", rule: "openai-api-key" },
  { re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g, label: "clave live de Stripe", rule: "stripe-live-key" },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, label: "token de Slack", rule: "slack-token" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: "llave de AWS", rule: "aws-access-key" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: "llave de Google", rule: "google-api-key" },
];

const PRIVATE_KEY = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g;
const CREDENTIAL_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:[^\s@/'"]+@[^\s'"]+/gi;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const DIGIT_RUN = /(?<![\dA-Za-z])\d(?:[ -]?\d){12,18}(?![\dA-Za-z])/g;
const CURP = /\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z\d]\d\b/g;
const RFC = /\b[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}\b/g;

// Domains that are never real people: RFC 2606 / 6761 names and GitHub's noreply addresses.
const SAFE_EMAIL = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|[a-z0-9-]+\.(?:test|invalid|example|localhost)|users\.noreply\.github\.com)$/i;

export type Allowlist = { exact: Set<string>; patterns: RegExp[]; paths: string[]; pathPatterns: RegExp[] };

/** One entry per line: a literal value, /regex/, or path:<prefix or /regex/>. Blank lines and # comments are ignored. */
export function parseAllowlist(text: string): Allowlist {
  const exact = new Set<string>();
  const patterns: RegExp[] = [];
  const paths: string[] = [];
  const pathPatterns: RegExp[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("path:")) {
      const body = line.slice("path:".length).trim();
      const asRegex = /^\/(.+)\/([a-z]*)$/.exec(body);
      if (asRegex) pathPatterns.push(new RegExp(asRegex[1]!, asRegex[2]));
      else if (body) paths.push(body.replace(/\\/g, "/").replace(/^\.\//, ""));
      continue;
    }
    const re = /^\/(.+)\/([a-z]*)$/.exec(line);
    if (re) patterns.push(new RegExp(re[1]!, re[2]));
    else exact.add(line);
  }
  return { exact, patterns, paths, pathPatterns };
}

export const EMPTY_ALLOWLIST: Allowlist = { exact: new Set(), patterns: [], paths: [], pathPatterns: [] };

export function valueAllowed(value: string, allow: Allowlist): boolean {
  if (allow.exact.has(value)) return true;
  return allow.patterns.some((re) => new RegExp(re.source, re.flags).test(value));
}

/** A path entry matches the path itself, a directory under it, or a suffix (`path:.env` matches `apps/web/.env`). */
export function pathAllowed(file: string, allow: Allowlist): boolean {
  const norm = file.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const raw of allow.paths) {
    const path = raw.replace(/\/$/, "");
    if (!path) continue;
    if (norm === path || norm.startsWith(`${path}/`) || norm.endsWith(`/${path}`)) return true;
  }
  return allow.pathPatterns.some((re) => new RegExp(re.source, re.flags).test(norm));
}

/** Findings in one added line. */
export function scanLine(line: string, allow: Allowlist = EMPTY_ALLOWLIST): Finding[] {
  const out: Finding[] = [];
  const add = (kind: Kind, confidence: Confidence, label: string, value: string, rule: string) => {
    if (valueAllowed(value, allow)) return;
    out.push({ kind, confidence, label, value, masked: mask(value), rule });
  };
  for (const { re, label, rule } of TOKENS) for (const m of line.matchAll(re)) add("token", "high", label, m[0], rule);
  for (const m of line.matchAll(PRIVATE_KEY)) add("private_key", "high", "llave privada", m[0], "private-key");
  for (const m of line.matchAll(CREDENTIAL_URL)) add("credential_url", "high", "URL con credenciales", m[0], "credential-url");
  for (const m of line.matchAll(DIGIT_RUN)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length === 18 && validClabe(digits)) add("clabe", "high", "CLABE válida", digits, "clabe");
    else if (luhn(digits)) add("card", "high", "número de tarjeta (Luhn)", digits, "payment-card");
  }
  for (const m of line.matchAll(CURP)) add("curp", "high", "CURP", m[0], "curp");
  const curps = new Set(out.filter((f) => f.kind === "curp").map((f) => f.value));
  for (const m of line.matchAll(RFC)) if (![...curps].some((c) => c.includes(m[0]))) add("rfc", "hint", "forma de RFC", m[0], "rfc");
  for (const m of line.matchAll(EMAIL)) {
    if (SAFE_EMAIL.test(m[0])) continue;
    // The user part of a credential URL is not an email of its own.
    if (out.some((f) => f.kind === "credential_url" && f.value.includes(m[0]))) continue;
    add("email", "hint", "correo", m[0], "plania-email");
  }
  for (const hit of walletHits(line)) add("wallet", "high", hit.label, hit.value, hit.rule);
  for (const hit of balanceHits(line)) add("balance", "high", hit.label, hit.value, hit.rule);
  return out;
}

/** A committed env file (not an example or template). */
export function envFile(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  return /^\.env(?:\.[A-Za-z0-9_-]+)?$/.test(name) && !/\.(?:example|sample|template|dist)$/i.test(name);
}
