// PLA-I68-2: what Camino reads from GitHub, and the one client every Camino call to GitHub goes through (F3+ writes too).
// The token is the project's saved GitHub key when there is one (src/camino/keys.ts), else the one the poller uses
// (settings.github.token_env, ~/.config/plania/github-token, then `gh auth token`). It is only ever a header.
// Discovery reads, never writes: the repo and its merge settings, branches with ahead/behind against the default
// branch, rulesets (a private repo on GitHub Free answers 403/404: the plan does not allow them), workflows and their
// files, check names seen in the last 7 days per branch, recent runs, the last 200 non-merge commits, and the
// account's repos for the pickers.
import type { DiscoveryGithub, GhBranch, GhCheckSeen, GhCommit, GhFile, GhRuleset, GhRun, GhWorkflow } from "./types.js";
import type { HttpFetch } from "./providers.js";

export type GhResponse = { status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> };
export type GhApi = {
  source: string;
  call(method: string, path: string, body?: unknown): Promise<GhResponse>;
};

const API = "https://api.github.com";

/** A GitHub client over fetch with one token. Paths start with /. */
export function ghApi(token: string, source: string, fetch: HttpFetch, timeoutMs = 15_000): GhApi {
  return {
    source,
    async call(method, path, body) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        return await fetch(`${API}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "plania",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: ctl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
async function getJson<T>(api: GhApi, path: string): Promise<{ status: number; data: T | null; headers: GhResponse["headers"] }> {
  try {
    const r = await api.call("GET", path);
    const data = r.status >= 200 && r.status < 300 ? ((await r.json()) as T) : null;
    return { status: r.status, data, headers: r.headers };
  } catch {
    return { status: 0, data: null, headers: { get: () => null } };
  }
}

/** Runs fns with at most n at once, keeping order. */
export async function limited<T>(n: number, fns: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(fns.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, fns.length) }, async () => {
      while (i < fns.length) {
        const k = i++;
        out[k] = await fns[k]!();
      }
    }),
  );
  return out;
}

const AI_TRAILER = /^co-authored-by:.*\b(claude|anthropic|copilot|chatgpt|openai|gpt|cursor|codex|gemini|devin)\b/im;
/** A commit message carries an AI co-author trailer. */
export const hasAiTrailer = (message: string): boolean => AI_TRAILER.test(message);

const isoDate = (v: string | null): string | null => {
  if (!v) return null;
  const d = new Date(v.replace(/ UTC$/, "Z").replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

type RepoJson = {
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  permissions?: { admin?: boolean; push?: boolean };
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
  delete_branch_on_merge?: boolean;
  allow_update_branch?: boolean;
};

/** PLA-I70-20: how many branches get ahead/behind (a branch with no count never offers «Borrar»); role branches first. */
const COMPARE_MAX = 60;

/** Everything Camino reads from GitHub for one repo. roles: the branches whose rules and checks matter first. */
export async function discoverGithub(api: GhApi, repo: string, roles: string[], now: Date): Promise<DiscoveryGithub> {
  const R = `/repos/${enc(repo)}`;
  const me = await getJson<{ login: string }>(api, "/user");
  if (me.status === 401) return { ok: false, error: "unauthorized" };
  if (me.status === 0) return { ok: false, error: "network" };
  const scopes = me.headers.get("x-oauth-scopes");
  const token = { source: api.source, scopes: scopes === null ? null : scopes.split(",").map((s) => s.trim()).filter(Boolean), expires_at: isoDate(me.headers.get("github-authentication-token-expiration")) };
  const reposRes = await getJson<{ full_name: string }[]>(api, "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member");
  const repos = (reposRes.data ?? []).map((r) => r.full_name).slice(0, 100);

  const repoRes = await getJson<RepoJson>(api, R);
  if (repoRes.status === 404) return { ok: false, error: "not_found", repos };
  if (repoRes.status === 401 || repoRes.status === 403) return { ok: false, error: "unauthorized", repos };
  if (!repoRes.data) return { ok: false, error: "network", repos };
  const rj = repoRes.data;
  const def = rj.default_branch;

  const [branchesRes, rulesRes, wfRes, runsRes, depRes, c1, c2] = await Promise.all([
    getJson<{ name: string; commit: { sha: string }; protected: boolean }[]>(api, `${R}/branches?per_page=100`),
    getJson<{ id: number; name: string; enforcement: string; target: string }[]>(api, `${R}/rulesets?per_page=100`),
    getJson<{ workflows: { id: number; name: string; path: string; state: string }[] }>(api, `${R}/actions/workflows?per_page=100`),
    getJson<{ workflow_runs: any[] }>(api, `${R}/actions/runs?per_page=60&created=>=${new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)}`),
    getJson<{ content: string; sha: string; path: string }>(api, `${R}/contents/.github/dependabot.yml?ref=${encodeURIComponent(def)}`),
    getJson<{ sha: string; parents: unknown[]; commit: { message: string; author: { date: string } | null } }[]>(api, `${R}/commits?sha=${encodeURIComponent(def)}&per_page=100&page=1`),
    getJson<{ sha: string; parents: unknown[]; commit: { message: string; author: { date: string } | null } }[]>(api, `${R}/commits?sha=${encodeURIComponent(def)}&per_page=100&page=2`),
  ]);

  // Branches: ahead/behind against the default branch for the role branches first, then the most recent others.
  const raw = branchesRes.data ?? [];
  const order = [...raw].sort((a, b) => Number(roles.includes(b.name)) - Number(roles.includes(a.name)));
  const compared = await limited(
    6,
    order.slice(0, COMPARE_MAX).map((b) => async () => {
      if (b.name === def) return { name: b.name, ahead: 0, behind: 0 };
      const c = await getJson<{ ahead_by: number; behind_by: number }>(api, `${R}/compare/${encodeURIComponent(def)}...${encodeURIComponent(b.name)}`);
      return { name: b.name, ahead: c.data?.ahead_by ?? null, behind: c.data?.behind_by ?? null };
    }),
  );
  const cmp = new Map(compared.map((c) => [c.name, c]));
  const branches: GhBranch[] = raw.map((b) => ({ name: b.name, sha: b.commit.sha, ahead: cmp.get(b.name)?.ahead ?? null, behind: cmp.get(b.name)?.behind ?? null, protected: !!b.protected }));

  // Rulesets: a 403 or 404 on a private repo means the plan does not allow them (GitHub Free).
  let rules: { available: boolean; reason: "plan" | "forbidden" | null; list: GhRuleset[] };
  if (rulesRes.data) {
    const full = await limited(
      4,
      rulesRes.data.map((r) => async () => {
        const d = await getJson<{ id: number; name: string; enforcement: string; target: string; conditions?: { ref_name?: { include?: string[] } }; rules?: { type: string; parameters?: { required_status_checks?: { context: string }[] } }[] }>(api, `${R}/rulesets/${r.id}`);
        const x = d.data ?? { ...r };
        return {
          id: x.id,
          name: x.name,
          enforcement: x.enforcement,
          target: x.target,
          branches: (x.conditions?.ref_name?.include ?? []).map((s) => s.replace(/^refs\/heads\//, "")),
          required_checks: (x.rules ?? []).flatMap((ru) => ru.parameters?.required_status_checks?.map((c) => c.context) ?? []),
          plania: x.name.startsWith("plania-"),
        } satisfies GhRuleset;
      }),
    );
    rules = { available: true, reason: null, list: full };
  } else {
    rules = { available: false, reason: rj.private && (rulesRes.status === 403 || rulesRes.status === 404) ? "plan" : "forbidden", list: [] };
  }

  const workflows: GhWorkflow[] = (wfRes.data?.workflows ?? []).map((w) => ({ id: w.id, name: w.name, path: w.path, state: w.state }));
  const workflow_files = (
    await limited(
      4,
      workflows
        .filter((w) => w.path.startsWith(".github/workflows/"))
        .slice(0, 12)
        .map((w) => async () => {
          const f = await getJson<{ content: string; sha: string }>(api, `${R}/contents/${enc(w.path)}?ref=${encodeURIComponent(def)}`);
          return f.data ? ({ path: w.path, text: Buffer.from(f.data.content, "base64").toString("utf8"), sha: f.data.sha } satisfies GhFile) : null;
        }),
    )
  ).filter((f): f is GhFile => !!f);
  const dependabot: GhFile | null = depRes.data ? { path: ".github/dependabot.yml", text: Buffer.from(depRes.data.content, "base64").toString("utf8"), sha: depRes.data.sha } : null;

  const runs: GhRun[] = (runsRes.data?.workflow_runs ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    branch: r.head_branch,
    event: r.event,
    status: r.status,
    conclusion: r.conclusion ?? null,
    head_sha: r.head_sha,
    created_at: r.created_at,
    updated_at: r.updated_at,
    attempt: r.run_attempt ?? 1,
    url: r.html_url,
    workflow_id: r.workflow_id ?? null,
  }));

  // Check names seen in 7 days, per branch: the role branches' heads and the heads of recent runs.
  const heads = new Map<string, { branch: string; at: string }>();
  for (const b of branches.filter((x) => roles.includes(x.name) || x.name === def)) heads.set(b.sha, { branch: b.name, at: now.toISOString() });
  for (const r of runs) if (heads.size < 14 && !heads.has(r.head_sha)) heads.set(r.head_sha, { branch: r.branch, at: r.updated_at });
  const seen = new Map<string, GhCheckSeen>();
  const note = (name: string, app: string | null, branch: string, at: string) => {
    const s = seen.get(name) ?? { name, app, branches: [], last_at: at };
    if (!s.branches.includes(branch)) s.branches.push(branch);
    if (at > s.last_at) s.last_at = at;
    seen.set(name, s);
  };
  await limited(
    4,
    [...heads.entries()].map(([sha, h]) => async () => {
      const [cr, st] = await Promise.all([
        getJson<{ check_runs: { name: string; app?: { slug?: string } | null; completed_at: string | null; started_at: string | null }[] }>(api, `${R}/commits/${sha}/check-runs?per_page=100`),
        getJson<{ statuses: { context: string; updated_at: string }[] }>(api, `${R}/commits/${sha}/status`),
      ]);
      for (const c of cr.data?.check_runs ?? []) note(c.name, c.app?.slug ?? null, h.branch, c.completed_at ?? c.started_at ?? h.at);
      for (const s of st.data?.statuses ?? []) note(s.context, null, h.branch, s.updated_at ?? h.at);
    }),
  );
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const checks = [...seen.values()].filter((c) => c.last_at >= weekAgo).sort((a, b) => a.name.localeCompare(b.name));

  const commits: GhCommit[] = [...(c1.data ?? []), ...(c2.data ?? [])]
    .filter((c) => (c.parents?.length ?? 0) <= 1)
    .slice(0, 200)
    .map((c) => ({ sha: c.sha, message: c.commit.message.slice(0, 2000), date: c.commit.author?.date ?? "" }));

  return {
    ok: true,
    repo: {
      full_name: rj.full_name,
      private: rj.private,
      default_branch: def,
      admin: !!rj.permissions?.admin,
      push: !!rj.permissions?.push,
      html_url: rj.html_url,
      merge:
        rj.allow_squash_merge === undefined
          ? null
          : { squash: !!rj.allow_squash_merge, merge: !!rj.allow_merge_commit, rebase: !!rj.allow_rebase_merge, delete_on_merge: !!rj.delete_branch_on_merge, suggest_update: !!rj.allow_update_branch },
    },
    token,
    branches,
    branches_total: raw.length,
    rules,
    workflows,
    workflow_files,
    dependabot,
    checks,
    runs,
    commits,
    repos,
  };
}
