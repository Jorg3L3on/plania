// PLA-I71-5: the open skill catalog. skills.sh answers a search with public JSON and no key
// (GET https://skills.sh/api/search?q=…, checked 2026-11-21: {skills: [{id, source "owner/repo", skillId, name,
// installs}]}); it is not a documented API, so a change there shows as an empty list or a fetch code, never as a guess.
// A pick is then read from its GitHub repository like any pasted link (skill-import.ts: the folder whose name is the
// skill's id, read at one commit), so the same review and the same pin apply. Every request goes through the safe fetch;
// tests inject it, nothing here reaches the network in a test.
import { ToolError } from "../mcp/errors.js";
import { SafeFetchError, safeFetch } from "../lib/safe-fetch.js";
import type { ImportDeps } from "./skill-import.js";

export type CatalogHit = { id: string; name: string; source: string; skill: string; publisher: string; installs: number | null };

const SEG = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
async function json(url: string, deps: ImportDeps, maxBytes = 400_000): Promise<unknown> {
  try {
    const r = await safeFetch(url, { accept: ["application/json"], maxBytes, ...deps.fetch, headers: { "User-Agent": "Plania/1 (skill catalog)", Accept: "application/json", ...deps.fetch?.headers } });
    return JSON.parse(r.bytes.toString("utf8"));
  } catch (e) {
    if (e instanceof SafeFetchError) throw new ToolError(e.code, e.detail);
    if (e instanceof SyntaxError) throw new ToolError("SKILL_IMPORT_FORMAT", { reason: "catalog" });
    throw e;
  }
}

export async function searchCatalog(q: string, deps: ImportDeps = {}): Promise<CatalogHit[]> {
  const query = q.trim().slice(0, 80);
  if (query.length < 2) return [];
  const out = (await json(`https://skills.sh/api/search?q=${encodeURIComponent(query)}`, deps)) as { skills?: unknown };
  const list = Array.isArray(out.skills) ? (out.skills as Record<string, unknown>[]) : [];
  return list
    .map((x) => ({ id: String(x.id ?? ""), name: String(x.name ?? x.skillId ?? ""), source: String(x.source ?? ""), skill: String(x.skillId ?? ""), installs: typeof x.installs === "number" ? x.installs : null }))
    .filter((x) => /^[^/]+\/[^/]+$/.test(x.source) && x.source.split("/").every((s) => SEG.test(s)) && SEG.test(x.skill))
    .map((x) => ({ ...x, publisher: x.source.split("/")[0]! }))
    .slice(0, 24);
}

/** The GitHub folder a catalog pick lives in: the repository's default branch, the folder named like the skill. */
export async function resolveCatalog(source: string, skill: string, deps: ImportDeps = {}): Promise<string> {
  const [owner, repo] = source.split("/");
  if (!owner || !repo || !SEG.test(owner) || !SEG.test(repo) || !SEG.test(skill)) throw new ToolError("SKILL_IMPORT_FORMAT", { reason: "catalog" });
  const meta = (await json(`https://api.github.com/repos/${owner}/${repo}`, deps)) as { default_branch?: unknown };
  const branch = typeof meta.default_branch === "string" && SEG.test(meta.default_branch) ? meta.default_branch : "main";
  const tree = (await json(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, deps, 4_000_000)) as { tree?: { path?: unknown }[] };
  const paths = (tree.tree ?? []).map((t) => String(t.path ?? "")).filter((p) => /(^|\/)SKILL\.md$/i.test(p));
  const dir = paths.map((p) => p.replace(/\/?SKILL\.md$/i, "")).find((d) => d.split("/").at(-1) === skill) ?? (paths.length === 1 ? paths[0]!.replace(/\/?SKILL\.md$/i, "") : null);
  if (dir === null) throw new ToolError("SKILL_IMPORT_FORMAT", { reason: "catalog_not_found", skill });
  return `https://github.com/${owner}/${repo}/tree/${branch}${dir ? `/${dir}` : ""}`;
}
