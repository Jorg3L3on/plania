// A file step: a teammate needs lines added to a file its session may not write (e.g. .env.example, which the
// session's read rules for .env* also cover) on its open PR. Instead of the owner editing the repo by hand,
// Compañía shows the file, the lines (editable) and the PR's branch, and "Agregar al PR" commits them there
// through the GitHub contents API (the same gh and token as Publicar), then marks the step done.
//   fileStepOf   the step's file change: the agent's own {file: {path, append}} on the human_action, else one read
//                from its text (a path and the lines in backticks), else null.
//   applyFileStep adds the lines that are missing at the end of the file on the PR's head branch, one commit.
// Refused: a real secrets file (.env, .env.local…: only .example, .sample, .template, .dist and .defaults are
// written), a path outside the repo, a PR that is not open, a head branch that is main or the release's target.
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, tasks, type Task } from "../db/schema.js";
import { releaseGh } from "../mcp/release-ship.js";

export type FileStep = { path: string; lines: string; pr_url: string | null; source: "agent" | "text" };
export type FileApplied = { path: string; branch: string; added: number; commit: string | null; pr_url: string };
export type FileRefusal = { error: string; hint: string };

const PR = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/;
// A path-looking word: an optional folder, then a name with an extension, or a dotfile with one (.env.example).
const PATH = /(?:^|[\s`'"(«])((?:[\w.-]+\/)*(?:\.[\w-]+(?:\.[\w-]+)*|[\w-]+(?:\.[\w-]+)+))(?=$|[\s`'",.:;)»])/g;
const SAFE_ENV = /\.(example|sample|template|dist|defaults)$/i;

/** A file that holds real secrets: never written into the repo from here. */
export function secretPath(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return /^\.env(\..+)?$/i.test(base) && !SAFE_ENV.test(base);
}

/** A relative path inside the repo, with no way out of it. */
export function cleanPath(raw: string): string | null {
  const path = raw.trim().replace(/^\.\//, "");
  if (!path || path.length > 300 || path.startsWith("/") || path.includes("\\") || path.split("/").some((s) => s === ".." || s === "" || s === ".")) return null;
  if (!/^[\w./-]+$/.test(path) || path.startsWith(".git/") || path === ".git") return null;
  return path;
}

/** The file change a step asks for: the agent's own, or one read from the step's text. */
export function fileStepOf(spec: Record<string, unknown>, text: string, prUrl: string | null): FileStep | null {
  const file = spec.file as { path?: unknown; append?: unknown } | undefined;
  if (file && typeof file.path === "string" && typeof file.append === "string") {
    const path = cleanPath(file.path);
    const lines = file.append.replace(/\r\n/g, "\n").replace(/\n+$/, "");
    if (path && lines.trim()) return { path, lines, pr_url: prUrl, source: "agent" };
  }
  // Read from the text: lines in backticks, and the path the text names (a dotfile or a file with a folder first).
  const ticks = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);
  const paths = [...text.matchAll(PATH)].map((m) => m[1]!).filter((p) => !/^\d+(\.\d+)*$/.test(p) && !/^https?:/.test(p));
  const named = paths.find((p) => p.startsWith(".")) ?? paths.find((p) => p.includes("/")) ?? null;
  const path = named ? cleanPath(named) : null;
  if (!path) return null;
  const lines = ticks.filter((l) => l.trim() && l.trim() !== path);
  if (lines.length === 0) return null;
  return { path, lines: lines.join("\n"), pr_url: prUrl, source: "text" };
}

/** The lines of `add` that `current` does not have yet, in order. */
export function missingLines(current: string, add: string): string[] {
  const have = new Set(current.split("\n").map((l) => l.trimEnd()));
  const out: string[] = [];
  for (const l of add.replace(/\r\n/g, "\n").split("\n")) {
    const line = l.trimEnd();
    if (line === "" || !have.has(line)) out.push(line);
  }
  // Blank lines only between added lines, never leading or trailing.
  while (out.length && out[0] === "") out.shift();
  while (out.length && out.at(-1) === "") out.pop();
  return out.some((l) => l !== "") ? out : [];
}

/** The new content: the current file with the missing lines at the end, one blank line before them. */
export function appended(current: string, lines: string[]): string {
  if (lines.length === 0) return current;
  const body = current.replace(/\n*$/, "");
  return `${body ? `${body}\n\n` : ""}${lines.join("\n")}\n`;
}

async function gh(args: string[]): Promise<{ ok: boolean; out: string }> {
  const r = await releaseGh.run(args);
  return { ok: r.ok, out: (r.ok ? r.stdout : r.stderr).trim() };
}

const refuse = (error: string, hint: string): FileRefusal => ({ error, hint });

/** Commit the missing lines to the PR's head branch. Writes nothing to Plania's database: the caller resolves the step. */
export async function applyFileStep(db: Db, t: Task, input: { path: string; lines: string; pr_url: string | null }): Promise<FileApplied | FileRefusal> {
  const path = cleanPath(input.path);
  if (!path) return refuse("FILE_PATH", "Esa ruta no es un archivo dentro del repositorio.");
  if (secretPath(path)) return refuse("FILE_SECRET", `${path} guarda secretos reales: Plania no lo escribe en el repositorio. Solo archivos de ejemplo como .env.example.`);
  const url = input.pr_url ?? t.prUrl;
  const m = url ? PR.exec(url) : null;
  if (!m) return refuse("FILE_NO_PR", "Este paso no tiene un PR abierto donde agregarlo.");
  const [, repo, number] = m;

  const view = await gh(["pr", "view", number!, "--repo", repo!, "--json", "headRefName,baseRefName,state,url"]);
  if (!view.ok) return refuse("FILE_GITHUB", `GitHub no respondió al leer el PR: ${view.out.slice(0, 200)}`);
  const pr = JSON.parse(view.out) as { headRefName: string; baseRefName: string; state: string; url: string };
  if (pr.state !== "OPEN") return refuse("FILE_PR_CLOSED", `El PR #${number} está ${pr.state.toLowerCase()}: ya no se le agrega nada.`);
  const [p] = await db.select().from(projects).where(eq(projects.id, t.projectId)).limit(1);
  const into = p?.settings.release?.into ?? "main";
  if (pr.headRefName === "main" || pr.headRefName === into) return refuse("FILE_BRANCH", `La rama del PR es ${pr.headRefName}: desde aquí no se escribe ahí.`);

  const at = `repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const read = await gh(["api", `${at}?ref=${encodeURIComponent(pr.headRefName)}`]);
  let current = "";
  let sha: string | null = null;
  if (read.ok) {
    const f = JSON.parse(read.out) as { content?: string; sha?: string; type?: string };
    if (f.type && f.type !== "file") return refuse("FILE_PATH", `${path} no es un archivo en el repositorio.`);
    current = Buffer.from(f.content ?? "", "base64").toString("utf8");
    sha = f.sha ?? null;
  } else if (!/\b404\b|Not Found/i.test(read.out)) {
    return refuse("FILE_GITHUB", `GitHub no respondió al leer ${path}: ${read.out.slice(0, 200)}`);
  }

  const lines = missingLines(current, input.lines);
  if (lines.length === 0) return { path, branch: pr.headRefName, added: 0, commit: null, pr_url: pr.url };
  const content = Buffer.from(appended(current, lines), "utf8").toString("base64");
  const n = lines.filter((l) => l !== "").length;
  const message = `${t.key}: agrega ${n} ${n === 1 ? "línea" : "líneas"} a ${path} (desde Plania)`;
  const put = await gh(["api", "-X", "PUT", at, "-f", `message=${message}`, "-f", `content=${content}`, "-f", `branch=${pr.headRefName}`, ...(sha ? ["-f", `sha=${sha}`] : [])]);
  if (!put.ok) return refuse("FILE_GITHUB", `GitHub no aceptó el cambio: ${put.out.slice(0, 200)}`);
  const commit = (JSON.parse(put.out) as { commit?: { sha?: string } }).commit?.sha ?? null;
  return { path, branch: pr.headRefName, added: n, commit, pr_url: pr.url };
}

/** The ticket a human_action blocker sits on, with its spec and text. */
export async function stepOf(db: Db, blockerId: string): Promise<{ t: Task; spec: Record<string, unknown> } | null> {
  const rows = await db.execute<{ task_id: string; spec: Record<string, unknown> }>(sql`select b.task_id, b.spec from blockers b where b.id = ${blockerId} and b.type = 'human_action'`);
  const row = rows.rows[0];
  if (!row) return null;
  const [t] = await db.select().from(tasks).where(eq(tasks.id, row.task_id)).limit(1);
  return t ? { t, spec: row.spec } : null;
}
