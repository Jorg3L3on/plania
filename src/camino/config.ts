// PLA-I68-2: the configuration Camino shows is what the owner set on Camino, over what the project's older settings
// already say (github.repo, local.repo_path, release, start_branch, capture, vercel), over defaults. Nothing is lost
// when the camino row is still empty: those settings are read into it here, at read time.
import type { ProjectSettings } from "../db/schema.js";
import { startBranchOf } from "../runner/start-branch.js";
import { prodEnvOf } from "./prod.js";
import { caminoSay } from "./words.js";
import type { BranchRule, CaminoConfig, CaminoEnv, CommitSettings, DepsSettings, MergeSettings, PublishModel } from "./types.js";

export const DEFAULT_RULE: BranchRule = { on: false, pr: true, nodel: true, agents: false };
export const DEFAULT_MERGE: MergeSettings = { squash: true, promo_merge: true, delete_on_merge: false, suggest_update: false };
export const DEFAULT_COMMITS: CommitSettings = {
  convention: null,
  types: ["feat", "fix", "docs", "refactor", "test", "chore"],
  scope: "opcional",
  max: 72,
  lang: "en",
  emoji: false,
  ticket: "trailer",
  body: true,
  ai: false,
  pr_title: true,
  enforce: "revisa",
  examples: "",
  custom_regex: null,
};
export const DEFAULT_DEPS: DepsSettings = { on: false, interval: "weekly", target: null, group: true, auto_patch: false };

/** The work-branch pattern Plania's own runner uses (src/runner/worktree.ts branchFor). */
export const RUNNER_WORK_PATTERN = "plania/<clave>";

export type EffectiveConfig = {
  model: PublishModel;
  branches: { published: string; integration: string | null; work_pattern: string };
  rules: Record<string, BranchRule>;
  merge: MergeSettings;
  required_checks: Record<string, string[]>;
  commits: CommitSettings;
  deps: DepsSettings;
  envs: CaminoEnv[];
  connections: NonNullable<CaminoConfig["connections"]>;
  /** Where each top value came from: camino (the owner set it here), settings (an older setting), github, default. */
  source: Record<"model" | "branches" | "merge" | "envs" | "commits", "camino" | "settings" | "github" | "default">;
};

const env = (over: Partial<CaminoEnv> & Pick<CaminoEnv, "id" | "name" | "kind">): CaminoEnv => ({
  runs: { kind: "none" },
  url: null,
  server: { provider: null, project: null, note: null },
  database: null,
  vars: [],
  health: { url: null, pages: [] },
  publisher: "owner",
  freeze: false,
  record: null,
  ...over,
});

/** Environments the older settings imply: the release's target, and the local test copy when Plania runs one. */
export function derivedEnvs(s: ProjectSettings): CaminoEnv[] {
  const out: CaminoEnv[] = [];
  const start = startBranchOf(s);
  if (s.capture) {
    out.push(
      env({
        id: "copia",
        name: caminoSay().envCopy,
        kind: "permanente",
        runs: { kind: "branch", branch: s.release?.from ?? start },
        server: { provider: "mac_service", project: null, note: null },
        database: s.capture.database
          ? { provider: "local_postgres", name: null, data: "falsos", roles_split: false, migrate_when: "llegar", lock: false, sql_review: false, approve_destructive: false, backup: "dump" }
          : null,
      }),
    );
  }
  if (s.release) {
    const pm = s.release.prod_migrations;
    out.push(
      env({
        id: s.release.env,
        name: caminoSay().envProd,
        kind: "produccion",
        record: s.release.env,
        runs: { kind: "branch", branch: s.release.into },
        url: s.preview_url ?? null,
        server: { provider: s.vercel ? "vercel" : null, project: s.vercel?.project_id ?? null, note: null },
        database:
          pm === "none"
            ? null
            : { provider: null, name: null, data: "real", roles_split: false, migrate_when: pm === "deploy" ? "build" : "mano", lock: false, sql_review: false, approve_destructive: true, backup: "ninguna" },
      }),
    );
  }
  return out;
}

/** PLA-132: environments saved before the production address was edited only here: the production one with no
 * address shows the older settings.preview_url instead of nothing, until the owner saves one. */
function withOlderAddress(envs: CaminoEnv[], s: ProjectSettings): CaminoEnv[] {
  const prod = prodEnvOf({ envs }, s.release ?? null);
  if (!prod || prod.url || !s.preview_url) return envs;
  return envs.map((e) => (e === prod ? { ...e, url: s.preview_url! } : e));
}

export function effectiveConfig(s: ProjectSettings, stored: CaminoConfig, github: { default_branch: string; merge: Partial<MergeSettings> | null } | null): EffectiveConfig {
  const release = s.release;
  const start = startBranchOf(s);
  const derivedModel: PublishModel = release ? "integ" : "trunk";
  const published = stored.branches?.published ?? release?.into ?? github?.default_branch ?? "main";
  // PLA-I70-4: a project that publishes straight from one branch has no integration branch; only the integ model derives one.
  const model: PublishModel = stored.model ?? derivedModel;
  const integration = stored.branches?.integration !== undefined ? stored.branches.integration : release ? release.from : model === "integ" && start !== published ? start : null;
  const ghMerge = github?.merge ? { squash: github.merge.squash, delete_on_merge: github.merge.delete_on_merge, suggest_update: github.merge.suggest_update } : {};
  return {
    model,
    branches: { published, integration: integration || null, work_pattern: stored.branches?.work_pattern ?? RUNNER_WORK_PATTERN },
    rules: stored.rules ?? {},
    merge: { ...DEFAULT_MERGE, ...Object.fromEntries(Object.entries(ghMerge).filter(([, v]) => v !== undefined)), ...(stored.merge ?? {}) },
    required_checks: stored.required_checks ?? {},
    commits: { ...DEFAULT_COMMITS, ...(stored.commits ?? {}) },
    deps: { ...DEFAULT_DEPS, ...(stored.deps ?? {}) },
    envs: stored.envs ? withOlderAddress(stored.envs, s) : derivedEnvs(s),
    connections: stored.connections ?? {},
    source: {
      model: stored.model ? "camino" : release ? "settings" : "default",
      branches: stored.branches ? "camino" : release ? "settings" : github ? "github" : "default",
      merge: stored.merge ? "camino" : github?.merge ? "github" : "default",
      envs: stored.envs ? "camino" : s.release || s.capture ? "settings" : "default",
      commits: stored.commits ? "camino" : "default",
    },
  };
}
