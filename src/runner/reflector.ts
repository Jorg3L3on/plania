// PLA-I67-3: the reflector's process. One short `claude -p` pass per owner correction: no tools at all (--tools ""),
// no MCP server, no session kept, a cheap model (PLANIA_REFLECTOR_MODEL, default haiku), in a temp folder outside every
// repo, its role and skill (kit/reflector/) as the system prompt, the answer as validated JSON (--json-schema). It
// cannot write anything: Plania reads its answer and applyVerdict (src/runner/lessons.ts) only ever proposes.
// It waits while the company is paused or the plan guard stops runs. Tests inject spawn; nothing here runs a real
// claude in a test.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { resolveClaudeBin } from "../lib/claude-bin.js";
import { frontmatter, kitRoot } from "./kit.js";
import { lastReading, loadSettings, planView } from "./limits.js";
import { captureFeedback, expireProposals, reflectPrompt, reflectQueued, VERDICT_SCHEMA, type Reflect, type ReflectInput } from "./lessons.js";
import { defaultKill, defaultSpawn, supervise, type KillFn, type SpawnFn } from "./process.js";
import { runEnv } from "./run-env.js";
import { StreamReader } from "./stream.js";

export const REFLECTOR_TIMEOUT_MS = 3 * 60_000;

export function reflectorSystemPrompt(env: NodeJS.ProcessEnv = process.env): string {
  const root = path.join(kitRoot(env), "reflector");
  const role = readFileSync(path.join(root, "role.md"), "utf8").trim();
  const skill = frontmatter(readFileSync(path.join(root, "skills", "reflect-on-correction", "SKILL.md"), "utf8")).body.trim();
  return `${role}\n\n${skill}\n`;
}

export function reflectorArgs(input: { prompt: string; systemPromptPath: string; settingsPath: string; mcpConfigPath: string; model: string }): string[] {
  return [
    "-p",
    input.prompt,
    "--append-system-prompt-file",
    input.systemPromptPath,
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    JSON.stringify(VERDICT_SCHEMA),
    "--tools",
    "",
    "--mcp-config",
    input.mcpConfigPath,
    "--strict-mcp-config",
    "--settings",
    input.settingsPath,
    "--max-turns",
    "3",
    "--no-session-persistence",
    "--model",
    input.model,
  ];
}

export type ReflectorDeps = { env?: NodeJS.ProcessEnv; spawn?: SpawnFn; kill?: KillFn; tmpDir?: string; timeoutMs?: number };

// The default reflect: one process, its structured output (or the result text parsed as JSON).
export function claudeReflect(deps: ReflectorDeps = {}): Reflect {
  return async (input: ReflectInput) => {
    const env = deps.env ?? process.env;
    const dir = path.join(deps.tmpDir ?? path.join(tmpdir(), "plania-reflector"), randomUUID());
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      const systemPromptPath = path.join(dir, "system.md");
      writeFileSync(systemPromptPath, reflectorSystemPrompt(env), { mode: 0o600 });
      const settingsPath = path.join(dir, "settings.json");
      writeFileSync(settingsPath, JSON.stringify({ permissions: { deny: ["Bash", "Edit", "Write", "Read", "WebFetch", "WebSearch", "mcp__*"] } }), { mode: 0o600 });
      const mcpConfigPath = path.join(dir, "mcp.json");
      writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
      const reader = new StreamReader(() => undefined);
      const proc = supervise({
        command: resolveClaudeBin(env),
        args: reflectorArgs({ prompt: reflectPrompt(input), systemPromptPath, settingsPath, mcpConfigPath, model: env.PLANIA_REFLECTOR_MODEL?.trim() || "haiku" }),
        cwd: dir,
        env: runEnv(env),
        logPath: null,
        timeoutMs: deps.timeoutMs ?? REFLECTOR_TIMEOUT_MS,
        graceMs: 5_000,
        spawn: deps.spawn ?? defaultSpawn,
        kill: deps.kill ?? defaultKill,
        onStdout: (chunk) => reader.feed(chunk),
      });
      const exit = await proc.done;
      reader.end();
      const r = reader.result;
      if (exit.timedOut) throw new Error("reflector timed out");
      if (!r || r.isError) throw new Error(`reflector failed: ${r?.subtype ?? exit.code ?? "no result"}`);
      if (r.structuredOutput !== undefined) return r.structuredOutput;
      return JSON.parse(r.resultText ?? "null");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

// One tick: read new corrections, expire old proposals, and reflect on a few, unless runs are held.
export async function lessonsTick(db: Db, now: Date = new Date(), reflect: Reflect = claudeReflect()): Promise<{ captured: number; expired: number; done: number; failed: number; held: boolean }> {
  const captured = await captureFeedback(db, now);
  const expired = await expireProposals(db, now);
  const settings = await loadSettings(db);
  const plan = planView(await lastReading(db), settings.planGuardPct, now, settings.guardOverride);
  if (settings.companyPaused || plan.state === "stopped") return { captured, expired, done: 0, failed: 0, held: true };
  const out = await reflectQueued(db, reflect);
  return { captured, expired, ...out, held: false };
}
