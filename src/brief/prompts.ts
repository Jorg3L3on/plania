// PLA-I41-4: the Morning brief prompts (spec §6). The committed files live in prompts/morning-brief/; render()
// fills their {{NAME}} placeholders. Two owner overrides are Plania docs, the same pattern as PROMPT_DOCS in
// src/runner/limits.ts: the project doc "Prompt: Morning brief" on the prompts project is appended to system.md,
// and a project doc "Idea persona" on any project is that project's persona in pass B ({{PERSONAS}}).
import { readFileSync } from "node:fs";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { docs, projects } from "../db/schema.js";
import type { Q } from "../mcp/tx.js";

export const PROMPTS_DIR = new URL("../../prompts/morning-brief/", import.meta.url);

export const BRIEF_PROMPT_DOC = "Prompt: Morning brief";
export const IDEA_PERSONA_DOC = "Idea persona";
// Spec §7.2: a persona is at most 2,000 characters.
export const PERSONA_MAX_CHARS = 2000;

export const PROMPT_FILES = ["system.md", "brief.md", "ideas.md", "po-plan-ideas.md"] as const;
export type PromptFile = (typeof PROMPT_FILES)[number];
export type BriefPass = "brief" | "ideas";

const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

export function readPrompt(name: PromptFile): string {
  return readFileSync(new URL(name, PROMPTS_DIR), "utf8");
}

// The schema text for --json-schema, and the parsed object for checks. PLA-I44-2: the "$schema" key is left out of
// what goes to claude: CLI 2.1.302 refuses "https://json-schema.org/draft/2020-12/schema" ("no schema with key or
// ref") and the pass ends with exit 1 before a single turn. The file keeps it for editors.
export function readSchemaText(pass: BriefPass): string {
  const { $schema: _draft, ...schema } = JSON.parse(readFileSync(new URL(`${pass}.schema.json`, PROMPTS_DIR), "utf8")) as Record<string, unknown>;
  return JSON.stringify(schema);
}
export function readSchema(pass: BriefPass): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`${pass}.schema.json`, PROMPTS_DIR), "utf8")) as Record<string, unknown>;
}

export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

// One pass over the template: a value that itself holds "{{X}}" (a persona, a title) is never expanded again.
// A placeholder with no value throws, so a prompt never reaches Claude with a hole in it.
export function render(template: string, vars: Record<string, string>): string {
  const missing = placeholders(template).filter((name) => !Object.hasOwn(vars, name));
  if (missing.length) throw new Error(`render: no value for ${missing.map((n) => `{{${n}}}`).join(", ")}`);
  return template.replace(PLACEHOLDER, (_, name: string) => vars[name]!);
}

// ---- Formatters for the multi-line placeholders

export type PromptProject = {
  id: string; // the app id items and ideas use (the project slug)
  name: string;
  keyPrefix: string;
  repoPath: string | null;
  githubRepo: string | null;
};

export function projectsTable(rows: PromptProject[]): string {
  if (!rows.length) return "  (no projects)";
  return rows
    .map((p) => `  ${[p.id, p.name, p.keyPrefix, p.repoPath ?? "no repo", p.githubRepo ?? "no GitHub repo"].join(" | ")}`)
    .join("\n");
}

export function hiddenRefsText(refs: string[]): string {
  const clean = refs.map((r) => r.trim()).filter(Boolean);
  return clean.length ? clean.join(", ") : "(none)";
}

export function languageName(code: string): string {
  return code === "es" ? "Spanish" : "English";
}

export type Persona = { id: string; name: string; markdown: string };

// Indented under step 3 of ideas.md.
export function personasBlock(personas: Persona[]): string {
  if (!personas.length) return "   (No project has a persona. Think as each project's product owner.)";
  return personas
    .map((p) => {
      const body = p.markdown.trim().slice(0, PERSONA_MAX_CHARS).split("\n").map((l) => `     ${l}`.trimEnd());
      return [`   - ${p.id} (${p.name}):`, ...body].join("\n");
    })
    .join("\n");
}

export type PlanIdea = { code: string; title: string; why: string; flags?: string[]; source: string };

export function ideasBlock(ideas: PlanIdea[]): string {
  return ideas
    .map((i) =>
      [
        `### ${i.code}: ${i.title}`,
        `- Why: ${i.why}`,
        `- Flags: ${i.flags?.length ? i.flags.join(", ") : "none"}`,
        `- Source: ${i.source}`,
      ].join("\n"),
    )
    .join("\n\n");
}

// ---- Owner overrides (Plania docs)

const promptsProject = (env: NodeJS.ProcessEnv) => env.PLANIA_PROMPTS_PROJECT || "plania";

// The project doc "Prompt: Morning brief" on the prompts project, or null.
export async function loadSystemOverride(db: Q, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const rows = await db
    .select({ markdown: docs.markdown })
    .from(docs)
    .innerJoin(projects, eq(projects.id, docs.projectId))
    .where(and(eq(projects.slug, promptsProject(env)), isNull(docs.taskId), eq(docs.title, BRIEF_PROMPT_DOC)))
    .limit(1);
  const md = rows[0]?.markdown.trim();
  return md ? md : null;
}

// Each project's "Idea persona" doc, keyed by slug. Projects without one (or with an empty one) are absent.
export async function loadPersonas(db: Q, slugs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!slugs.length) return out;
  const rows = await db
    .select({ slug: projects.slug, markdown: docs.markdown })
    .from(docs)
    .innerJoin(projects, eq(projects.id, docs.projectId))
    .where(and(inArray(projects.slug, slugs), isNull(docs.taskId), eq(docs.title, IDEA_PERSONA_DOC)));
  for (const r of rows) {
    const md = r.markdown.trim();
    if (md) out.set(r.slug, md.slice(0, PERSONA_MAX_CHARS));
  }
  return out;
}

export function withOverride(system: string, override: string | null): string {
  if (!override) return system;
  return `${system.trimEnd()}\n\nOwner additions (from the Plania doc "${BRIEF_PROMPT_DOC}")\n${override.trim()}\n`;
}

// ---- The rendered prompts

export type SystemVars = {
  ownerName: string;
  language: string; // "en" | "es"
  timezone: string; // IANA
  timezoneLabel: string;
  hiddenRefs: string[];
  projects: PromptProject[];
  localDate: string;
  windowStart: string;
  now: string;
};

export function systemPrompt(v: SystemVars, override: string | null = null): string {
  const text = render(readPrompt("system.md"), {
    OWNER_NAME: v.ownerName,
    LANGUAGE: languageName(v.language),
    TIMEZONE: v.timezone,
    TIMEZONE_LABEL: v.timezoneLabel,
    HIDDEN_REFS: hiddenRefsText(v.hiddenRefs),
    PROJECTS_TABLE: projectsTable(v.projects),
    LOCAL_DATE: v.localDate,
    WINDOW_START: v.windowStart,
    NOW: v.now,
  });
  return withOverride(text, override);
}

export function briefPrompt(v: { factsPath: string; maxItemsPerApp: number }): string {
  return render(readPrompt("brief.md"), { FACTS_PATH: v.factsPath, MAX_ITEMS_PER_APP: String(v.maxItemsPerApp) });
}

export function ideasPrompt(v: { ideasPerProject: number | string; personas: Persona[] }): string {
  return render(readPrompt("ideas.md"), { IDEAS_PER_PROJECT: String(v.ideasPerProject), PERSONAS: personasBlock(v.personas) });
}

export function poPlanIdeasPrompt(v: { briefDate: string; requestId: string; projectSlug: string; ideas: PlanIdea[] }): string {
  if (!v.ideas.length) throw new Error("poPlanIdeasPrompt: no ideas");
  return render(readPrompt("po-plan-ideas.md"), {
    BRIEF_DATE: v.briefDate,
    REQUEST_ID: v.requestId,
    PROJECT_SLUG: v.projectSlug,
    IDEAS: ideasBlock(v.ideas),
    FIRST_CODE: v.ideas[0]!.code,
  });
}

// What one pass needs: the system prompt (with the owner's doc appended) and the user prompt.
// Pass B also loads each project's persona doc.
export async function loadPassPrompts(
  db: Q,
  pass: BriefPass,
  v: SystemVars & { factsPath: string; maxItemsPerApp: number; ideasPerProject: number | string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ system: string; prompt: string }> {
  const system = systemPrompt(v, await loadSystemOverride(db, env));
  if (pass === "brief") return { system, prompt: briefPrompt(v) };
  const found = await loadPersonas(db, v.projects.map((p) => p.id));
  const personas = v.projects.flatMap((p) => (found.has(p.id) ? [{ id: p.id, name: p.name, markdown: found.get(p.id)! }] : []));
  return { system, prompt: ideasPrompt({ ideasPerProject: v.ideasPerProject, personas }) };
}
