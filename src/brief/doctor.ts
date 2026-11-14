// PLA-I41-6: pnpm brief:doctor, the Morning brief setup check (spec §9). One ✓ or ✗ line per check: claude found and
// its version; claude logged in (a short `claude -p` with the pass-A flag set and --json-schema, which also confirms
// the structured-output field name); read token set; runner token set; GitHub token readable; each project's repo
// path exists; prompts folder present; migration 0045 applied. It never prints a value: no token, no env value, no
// path, no model output. Only the claude version number is shown.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { readTokenFile } from "../jobs/gh-token.js";
import { repoPathOf } from "../runner/worktree.js";
import { StreamReader } from "../runner/stream.js";
import { briefArgs, briefChildEnv, briefSettings, commandOf } from "./claude.js";
import { PROMPTS_DIR, PROMPT_FILES } from "./prompts.js";
import { loadBriefProjects } from "./settings.js";

export type DoctorLine = { ok: boolean; text: string };
export type ExecResult = { code: number | null; stdout: string; stderr: string };
export type ExecFn = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number }) => Promise<ExecResult>;

export type DoctorDeps = {
  env?: NodeJS.ProcessEnv;
  exec?: ExecFn;
  // Skip the claude dry run (the one check that uses the owner's plan).
  skipClaudeRun?: boolean;
  promptsDir?: string;
  exists?: (p: string) => boolean;
};

export const BRIEF_TABLES = ["morning_briefs", "brief_runs", "brief_plan_requests", "brief_checks", "brief_settings"] as const;
const DRY_SCHEMA = JSON.stringify({ type: "object", properties: { reply: { type: "string" } }, required: ["reply"], additionalProperties: false });

export const defaultExec: ExecFn = (cmd, args, opts) =>
  new Promise((resolve) => {
    execFile(cmd, args, { env: opts.env, cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : null) : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

const line = (ok: boolean, text: string): DoctorLine => ({ ok, text });

/** The dry run: pass A's flags, no MCP server, 2 turns (the StructuredOutput tool call takes one). */
async function claudeDryRun(cmd: string, env: NodeJS.ProcessEnv, exec: ExecFn): Promise<DoctorLine> {
  const dir = mkdtempSync(path.join(tmpdir(), "plania-brief-doctor-"));
  try {
    const systemPromptPath = path.join(dir, "system.md");
    writeFileSync(systemPromptPath, "This is a setup check. Answer with reply set to ok.", { mode: 0o600 });
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify(briefSettings()), { mode: 0o600 });
    const mcpConfigPath = path.join(dir, "mcp.json");
    writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
    const args = briefArgs({ pass: "brief", prompt: "reply ok", systemPromptPath, jsonSchema: DRY_SCHEMA, mcpConfigPath, settingsPath, maxTurns: 2 });
    const res = await exec(cmd, args, { env: briefChildEnv(env, ""), cwd: dir, timeoutMs: 120_000 });
    const reader = new StreamReader();
    reader.feed(res.stdout);
    reader.end();
    const r = reader.result;
    if (!r) return line(false, "claude logged in: no result from a 1-turn run (run `claude` once and log in with your subscription)");
    if (r.isError) {
      const why = /log ?in|auth|credential|api key/i.test(`${r.resultText ?? ""} ${res.stderr}`) ? "not logged in (run `claude` and log in)" : `the run ended with ${r.subtype}`;
      return line(false, `claude logged in: ${why}`);
    }
    const so = r.structuredOutput;
    if (so && typeof so === "object" && !Array.isArray(so)) return line(true, "claude logged in; the result event carries structured_output");
    return line(false, "claude logged in, but the result event has no structured_output (the brief would fall back to parsing result)");
  } catch {
    return line(false, "claude logged in: the dry run could not start");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function runDoctor(db: Db | null, deps: DoctorDeps = {}): Promise<DoctorLine[]> {
  const env = deps.env ?? process.env;
  const exec = deps.exec ?? defaultExec;
  const exists = deps.exists ?? existsSync;
  const out: DoctorLine[] = [];

  // 1-2. claude
  const cmd = commandOf(env);
  let found = false;
  try {
    const v = await exec(cmd, ["--version"], { env: briefChildEnv(env, ""), cwd: tmpdir(), timeoutMs: 20_000 });
    const version = v.stdout.match(/\d+\.\d+\.\d+/)?.[0];
    found = v.code === 0 && !!version;
    out.push(found ? line(true, `claude found (version ${version})`) : line(false, "claude found: not at CLAUDE_CODE_BIN or ~/.local/bin/claude"));
  } catch {
    out.push(line(false, "claude found: not at CLAUDE_CODE_BIN or ~/.local/bin/claude"));
  }
  if (deps.skipClaudeRun) out.push(line(true, "claude logged in: skipped (--skip-claude)"));
  else if (!found) out.push(line(false, "claude logged in: skipped, claude was not found"));
  else out.push(await claudeDryRun(cmd, env, exec));

  // 3-4. tokens (set or not; never the value)
  if (env.PLANIA_BRIEF_TOKEN?.trim()) out.push(line(true, "read token set (PLANIA_BRIEF_TOKEN)"));
  else if (env.MCP_READ_TOKEN?.trim()) out.push(line(true, "read token set (MCP_READ_TOKEN fallback; issue a morning-brief read token on /tokens)"));
  else out.push(line(false, "read token set: add PLANIA_BRIEF_TOKEN (read scope, issued on /tokens) to .env"));
  out.push(env.PLANIA_RUNNER_TOKEN?.trim() ? line(true, "runner token set (PLANIA_RUNNER_TOKEN, for Send to Plania)") : line(false, "runner token set: add PLANIA_RUNNER_TOKEN to .env (Send to Plania needs it)"));

  // 5. GitHub token: the env var the poller reads first, then the token file.
  let gh = !!env.GITHUB_TOKEN?.trim();
  if (!gh) {
    try {
      gh = !!readTokenFile(undefined, env).token;
    } catch {
      gh = false;
    }
  }
  out.push(gh ? line(true, "GitHub token readable") : line(false, "GitHub token readable: put a token in ~/.config/plania/github-token (mode 0600) or GITHUB_TOKEN"));

  // 6. repos, 8. migration (need the database)
  let dbOk = false;
  if (db) {
    try {
      let missing = 0;
      for (const t of BRIEF_TABLES) {
        const res = await db.execute<{ present: boolean }>(sql`select to_regclass(${`public.${t}`}) is not null as present`);
        if (!res.rows[0]?.present) missing += 1;
      }
      dbOk = true;
      if (missing === 0) {
        const projects = (await loadBriefProjects(db)).filter((p) => p.include);
        const rows = await db.execute<{ slug: string; settings: { local?: { repo_path?: string } } | null }>(sql`select slug, settings from projects order by slug`);
        const settingsOf = new Map(rows.rows.map((r) => [r.slug, r.settings]));
        if (!projects.length) out.push(line(false, "repo paths: no project is included in the brief"));
        for (const p of projects) {
          const dir = repoPathOf(p.slug, settingsOf.get(p.slug) ?? null, env);
          out.push(exists(dir) ? line(true, `repo for ${p.slug} exists`) : line(false, `repo for ${p.slug} exists: not found (set settings.local.repo_path or PLANIA_PROJECTS_ROOT)`));
        }
      } else {
        out.push(line(false, "repo paths: skipped until migration 0045 is applied"));
      }
      out.push(missing === 0 ? line(true, "migration 0045 applied") : line(false, `migration 0045 applied: ${missing} of ${BRIEF_TABLES.length} tables missing (apply drizzle/migrations/0045_morning_brief.sql)`));
    } catch {
      dbOk = false;
    }
  }
  if (!dbOk) {
    out.push(line(false, "repo paths: skipped, the database is not reachable (DATABASE_URL)"));
    out.push(line(false, "migration 0045 applied: the database is not reachable (DATABASE_URL)"));
  }

  // 7. prompts
  const dir = deps.promptsDir ?? fileURLToPath(PROMPTS_DIR);
  const files = [...PROMPT_FILES, "brief.schema.json", "ideas.schema.json"];
  const missing = files.filter((f) => !exists(path.join(dir, f)));
  out.push(missing.length === 0 ? line(true, "prompts folder present (prompts/morning-brief)") : line(false, `prompts folder present: missing ${missing.join(", ")}`));

  return out;
}

export const formatDoctor = (lines: DoctorLine[]): string => lines.map((l) => `${l.ok ? "✓" : "✗"} ${l.text}`).join("\n");
