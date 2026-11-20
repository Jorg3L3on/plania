#!/usr/bin/env node
// PLA-I68-4: Plania checks a run's commits (and its PR title) before they leave the machine. A Claude Code hook in the
// run's own settings file (never in the product repo) calls this script with the rules the owner chose in Camino
// (written by src/camino/commits.ts into the run's temp folder):
//   PreToolUse  on `git push` and `gh pr create|edit`: every commit since the base branch, and the PR title.
//   PostToolUse on `git commit`, when the owner picked «Revisión al hacer commit»: the commit just made.
// A commit that breaks a rule blocks the call (exit 2) and the agent reads why and how to rewrite it. The rules are
// plain data (pattern, flags, must), applied here exactly as ui/src/lib/camino-commits.ts lint() applies them.
// usage: node camino-commit-hook.mjs <rules.json>   (the hook's JSON arrives on stdin)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const rulesFile = process.argv[2];
let cfg;
try {
  cfg = JSON.parse(readFileSync(rulesFile, "utf8"));
} catch {
  process.exit(0); // no rules, nothing to check
}
let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}
const command = String(input?.tool_input?.command ?? "");
const cwd = String(input?.cwd ?? process.cwd());
const event = String(input?.hook_event_name ?? "PreToolUse");

const subjectOf = (m) => m.split("\n")[0].trim();
export function lint(text, rules, on) {
  const out = [];
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

// The words of a shell command, quotes respected (enough for -m "…" and --title "…").
function words(cmd) {
  const out = [];
  let cur = "";
  let q = null;
  let any = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) {
      if (ch === q) q = null;
      else if (ch === "\\" && q === '"' && i + 1 < cmd.length) cur += cmd[++i];
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      q = ch;
      any = true;
    } else if (/\s/.test(ch)) {
      if (cur || any) out.push(cur);
      cur = "";
      any = false;
    } else cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}

const git = (args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 * 1024 * 1024 });
function commitsSince(base) {
  for (const range of [`origin/${base}..HEAD`, "@{upstream}..HEAD", "HEAD~1..HEAD"]) {
    try {
      const raw = git(["log", "--format=%h%x1f%B%x1e", range]);
      return raw
        .split("\x1e")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const [sha, ...rest] = x.split("\x1f");
          return { sha, message: rest.join("\x1f").trim() };
        });
    } catch {
      // try the next range
    }
  }
  return [];
}

const isPush = /(^|[;&|]\s*|\s)git(\s+-C\s+\S+)?\s+push(\s|$)/.test(command);
const isPr = /(^|[;&|]\s*|\s)gh\s+pr\s+(create|edit)(\s|$)/.test(command);
const isCommit = /(^|[;&|]\s*|\s)git(\s+-C\s+\S+)?\s+commit(\s|$)/.test(command);

const problems = [];
if (event === "PostToolUse" && isCommit && cfg.on_commit) {
  const [last] = commitsSince(cfg.base).slice(0, 1);
  if (last) {
    const p = lint(last.message, cfg.rules, "commit");
    if (p.length) problems.push(`- ${last.sha} «${subjectOf(last.message)}»: ${p.join(" ")}`);
  }
} else if (event === "PreToolUse" && (isPush || isPr)) {
  for (const c of commitsSince(cfg.base)) {
    const p = lint(c.message, cfg.rules, "commit");
    if (p.length) problems.push(`- ${c.sha} «${subjectOf(c.message)}»: ${p.join(" ")}`);
  }
  if (isPr) {
    const w = words(command);
    const i = w.findIndex((x) => x === "--title" || x === "-t" || x.startsWith("--title="));
    const title = i < 0 ? null : w[i].startsWith("--title=") ? w[i].slice(8) : w[i + 1];
    if (title) {
      const p = lint(title, cfg.rules, "title");
      if (p.length) problems.push(`- PR title «${title}»: ${p.join(" ")}`);
    }
  }
}

if (problems.length) {
  process.stderr.write(
    [
      cfg.words?.head ?? "Plania: these do not follow the project's commit rules (Camino › Commits). Rewrite them before pushing:",
      ...problems,
      cfg.words?.how?.replace("{base}", cfg.base) ?? `How: for the last commit, git commit --amend; for several, git reset --soft origin/${cfg.base} and commit again. Do not push until they pass.`,
    ].join("\n") + "\n",
  );
  process.exit(2);
}
process.exit(0);
