// Vendored from src/lib/scan for the private scanner repo. No plaintext patterns.
// PLA-I38-1: machine and human reports. Findings are rule, file, and line. No matched text.

export type ScanEngine = "plania" | "gitleaks";

export type ScanFinding = {
  rule: string;
  file: string;
  line: number;
  engine: ScanEngine;
};

export type GitleaksInfo = {
  ran: boolean;
  version: string | null;
  pinned: string;
  skipped: boolean;
  error: string | null;
};

export type ScanReport = {
  version: 1;
  ok: boolean;
  mode: "diff" | "path";
  repo: string | null;
  base: string | null;
  head: string | null;
  diff: string | null;
  gitleaksRange: string | null;
  findings: ScanFinding[];
  gitleaks: GitleaksInfo;
  error: string | null;
};

export function dedupeFindings(findings: ScanFinding[]): ScanFinding[] {
  const plania = new Set(findings.filter((finding) => finding.engine === "plania").map((finding) => `${finding.rule}\0${finding.file}\0${finding.line}`));
  const seen = new Set<string>();
  const out: ScanFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.rule}\0${finding.file}\0${finding.line}`;
    if (finding.engine === "gitleaks" && plania.has(key)) continue;
    const full = `${finding.engine}\0${key}`;
    if (seen.has(full)) continue;
    seen.add(full);
    out.push(finding);
  }
  out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule) || a.engine.localeCompare(b.engine));
  return out;
}

export function renderText(report: ScanReport): string {
  const lines = report.findings.map((finding) => `${finding.file}:${finding.line} ${finding.rule}`);
  const noun = report.findings.length === 1 ? "finding" : "findings";
  lines.push(`scan: ${report.findings.length} ${noun}`);
  return `${lines.join("\n")}\n`;
}

export function renderJson(report: ScanReport): string {
  return `${JSON.stringify(report)}\n`;
}
