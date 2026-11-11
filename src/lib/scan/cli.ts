// PLA-I38-1: argument parsing for scripts/scan-diff.ts. Flags and positionals may be mixed.

import { type ScanOptions } from "./run.js";

export const SCAN_USAGE = `usage: pnpm scan:diff [--json] [--no-gitleaks] [--gitleaks-bin <bin>] [--hashes <file>] [--allowlist <file>] [--base <ref>] [--head <ref>] <repo> [base]
       pnpm scan:diff --path <dir> [--json] [--no-gitleaks] [--gitleaks-bin <bin>] [--hashes <file>] [--allowlist <file>]`;

export type ParsedCli =
  | { ok: false; message: string; json: boolean }
  | { ok: true; json: boolean; options: ScanOptions };

export function parseArgs(argv: string[]): ParsedCli {
  let json = false;
  let noGitleaks = false;
  let gitleaksBin: string | undefined;
  let hashesPath: string | undefined;
  let allowlistPath: string | undefined;
  let base: string | undefined;
  let head: string | undefined;
  let path: string | undefined;
  let help = false;
  const positionals: string[] = [];
  const take = (index: number): string | null => {
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) return null;
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--json") json = true;
    else if (arg === "--no-gitleaks") noGitleaks = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--gitleaks-bin" || arg === "--hashes" || arg === "--allowlist" || arg === "--base" || arg === "--head" || arg === "--path") {
      const next = take(i);
      if (!next) return { ok: false, message: `${arg} needs a value`, json };
      i++;
      if (arg === "--gitleaks-bin") gitleaksBin = next;
      else if (arg === "--hashes") hashesPath = next;
      else if (arg === "--allowlist") allowlistPath = next;
      else if (arg === "--base") base = next;
      else if (arg === "--head") head = next;
      else path = next;
    } else if (arg.startsWith("-")) return { ok: false, message: SCAN_USAGE, json };
    else positionals.push(arg);
  }
  if (help) return { ok: false, message: SCAN_USAGE, json };
  if (path && positionals.length > 0) return { ok: false, message: SCAN_USAGE, json };
  const repo = path ?? positionals[0];
  if (!repo) return { ok: false, message: SCAN_USAGE, json };
  const positionalBase = positionals[1];
  if (base && positionalBase && base !== positionalBase) return { ok: false, message: SCAN_USAGE, json };
  if (positionals.length > 2) return { ok: false, message: SCAN_USAGE, json };
  const mode = path ? "path" : "diff";
  return {
    ok: true,
    json,
    options: {
      repo,
      mode,
      base: base ?? positionalBase ?? "main",
      head: head ?? "HEAD",
      noGitleaks,
      gitleaksBin,
      hashesPath,
      allowlistPath,
    },
  };
}
