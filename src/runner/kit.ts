// AUDIT-2 / AUDIT-3: the agents' kit lives in this repo, and a run gets exactly the part its role carries.
//   kit/skills/<slug>/SKILL.md   a skill in Claude's own format: frontmatter (name, description) and a body, with any
//                                supporting files next to it. The description says when to use it (what `Cuándo:` was
//                                on a pack doc).
//   kit/kits.json                {"<role>": ["<slug>", ...]}: the skills a role carries when its seat lists none.
//   kit/roles/<role>.md          the role prompt, exported from the live docs (scripts/kit.ts).
// For a run the runner writes a throwaway plugin (KIT_PLUGIN) in the run's own temp folder, outside every repo, and
// passes it to claude with --plugin-dir, so the skills load natively (as plania:<slug>), the stream names the ones
// the run used, and nothing is ever written into the app's worktree. PLANIA_KIT_DIR moves the kit folder (tests).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const KIT_PLUGIN = "plania";
const SLUG = /^[a-z][a-z0-9-]{0,39}$/;

// The process's own PLANIA_KIT_DIR counts too: the runner is often handed a reduced env (tests, a child's env).
export const kitRoot = (env: NodeJS.ProcessEnv = process.env): string =>
  env.PLANIA_KIT_DIR?.trim() || process.env.PLANIA_KIT_DIR?.trim() || path.resolve(import.meta.dirname, "../../kit");

export const sha = (text: string | Buffer, n = 8): string => createHash("sha256").update(text).digest("hex").slice(0, n);

// The leading `---` block of a SKILL.md as flat key/value pairs. Folded and literal scalars (`>`, `|`) and plain
// continuation lines are joined with a space; quotes around a value are dropped. Enough for name and description.
export function frontmatter(markdown: string): { fields: Record<string, string>; body: string } {
  const text = markdown.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return { fields: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end < 0) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  let key: string | null = null;
  for (const line of text.slice(4, end).split("\n")) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (m && !/^\s/.test(line)) {
      key = m[1]!;
      const v = m[2]!.trim();
      fields[key] = /^[>|][+-]?$/.test(v) ? "" : v.replace(/^(["'])(.*)\1$/, "$2");
    } else if (key && line.trim()) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  return { fields, body: text.slice(text.indexOf("\n", end + 1) + 1) };
}

// Every file under dir, as paths relative to it, sorted (so the hash does not depend on the disk's order).
function filesOf(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesOf(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

// One hash for a skill folder: every file's path and bytes. A change to a supporting file changes the version too.
export function shaOfDir(dir: string): string {
  const h = createHash("sha256");
  for (const rel of filesOf(dir)) {
    h.update(rel);
    h.update("\0");
    // Line endings are normalised, so a Windows checkout (CRLF) and the server (LF) give a skill the same version.
    h.update(readFileSync(path.join(dir, rel)).toString("latin1").replace(/\r\n/g, "\n"), "latin1");
    h.update("\0");
  }
  return h.digest("hex").slice(0, 8);
}

export type KitSkill = { slug: string; name: string; when: string; markdown: string; dir: string; sha: string };

// The skills in kit/skills. A folder without a SKILL.md, without a description, or whose name is not a slug is left out.
export function repoSkills(env: NodeJS.ProcessEnv = process.env): KitSkill[] {
  const root = path.join(kitRoot(env), "skills");
  if (!existsSync(root)) return [];
  const out: KitSkill[] = [];
  for (const slug of readdirSync(root).sort()) {
    const dir = path.join(root, slug);
    const file = path.join(dir, "SKILL.md");
    if (!SLUG.test(slug) || !existsSync(file)) continue;
    const markdown = readFileSync(file, "utf8");
    const { fields } = frontmatter(markdown);
    const when = (fields.description ?? "").replace(/\s+/g, " ").trim();
    if (!when) continue;
    out.push({ slug, name: (fields.name ?? slug).trim() || slug, when: when.slice(0, 1024), markdown, dir, sha: shaOfDir(dir) });
  }
  return out;
}

// kit/kits.json: the skills a role carries by default. A missing or broken file means none.
export function defaultSkills(role: string, env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    const kits = JSON.parse(readFileSync(path.join(kitRoot(env), "kits.json"), "utf8")) as Record<string, unknown>;
    const list = kits[role];
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === "string" && SLUG.test(s)) : [];
  } catch {
    return [];
  }
}

// kit/roles/<role>.md, or null. The runner uses it only when Plania has no `Prompt: <role>` doc.
export function roleFile(role: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const file = path.join(kitRoot(env), "roles", `${role}.md`);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8").trim();
  return text || null;
}

// PLA-I67-2: files are an owner skill's supporting text files (src/runner/skills.ts), written next to its SKILL.md.
export type KitEntry = { slug: string; name: string; when: string; markdown: string; sha: string; dir?: string | null; files?: { path: string; content: string }[] };
export type KitWritten = { slug: string; name: string; when: string; file: string; version: string };

export const skillVersion = (e: { slug: string; sha: string }): string => `${e.slug}@${e.sha}`;

// Writes the run's plugin: a manifest and one folder per skill. A skill from the repo is copied whole; a pack doc
// (one Markdown body) gets the frontmatter Claude needs. Whatever was there is replaced.
export function writeKitPlugin(dir: string, entries: KitEntry[]): KitWritten[] {
  rmSync(dir, { recursive: true, force: true });
  if (entries.length === 0) return [];
  mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), `${JSON.stringify({ name: KIT_PLUGIN, version: "1.0.0", description: "The skills this Plania run carries." }, null, 2)}\n`, { mode: 0o600 });
  return entries.map((e) => {
    const target = path.join(dir, "skills", e.slug);
    if (e.dir && existsSync(e.dir)) {
      cpSync(e.dir, target, { recursive: true });
    } else {
      mkdirSync(target, { recursive: true });
      const body = frontmatter(e.markdown).body;
      writeFileSync(path.join(target, "SKILL.md"), `---\nname: ${e.slug}\ndescription: ${JSON.stringify(e.when)}\n---\n\n${body.endsWith("\n") ? body : `${body}\n`}`, { mode: 0o600 });
      for (const f of e.files ?? []) {
        const file = path.join(target, f.path);
        if (!file.startsWith(target + path.sep)) continue;
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, f.content, { mode: 0o600 });
      }
    }
    return { slug: e.slug, name: e.name, when: e.when, file: path.join(target, "SKILL.md"), version: skillVersion(e) };
  });
}

// The prompt lines. The skills also load on their own (their descriptions are in the session); the line and the
// file path are there so a run still finds the body if the plugin did not load.
export function kitLines(written: KitWritten[]): string[] {
  if (written.length === 0) return [];
  return [
    "Skills you carry (use one before you do that kind of work: the Skill tool, or read its file):",
    ...written.map((s) => `- ${KIT_PLUGIN}:${s.slug} (${s.file}): ${s.when.length > 240 ? `${s.when.slice(0, 239).trimEnd()}…` : s.when}`),
  ];
}
