// PLA-I68: Camino, a project's path from code to people. Configuration only: publishing, migrating and merging stay in
// Publicar. These are the shapes the camino row holds (config, discovery) and the screen reads.
//   config     what the owner set (branch roles, GitHub rules, conventions, environments, connection metadata). Never a
//              secret: keys live in the OS keychain (src/camino/keys.ts); a connection here is only how it was saved,
//              its last 4 characters, its expiry and its last test.
//   discovery  what Plania read last from GitHub and this machine. Every value the screen shows says its source.

export const PROVIDERS = [
  "github",
  "vercel",
  "netlify",
  "render",
  "railway",
  "fly",
  "cloudflare",
  "github_releases",
  "mac_service",
  "own_server",
  "neon",
  "supabase",
  "planetscale",
  "postgres",
  "mysql",
  "local_postgres",
] as const;
export type ProviderId = (typeof PROVIDERS)[number];
/** Native: Plania drives it through its API. Detected: read-only. Manual: the owner's own command and a checklist. */
export type Badge = "native" | "detected" | "manual";

/** A saved key, without the key. store says where it lives. */
export type ConnMeta = {
  last4: string;
  saved_at: string;
  store: "keychain" | "file";
  expires_at?: string | null;
  last_used_at?: string | null;
  test?: { ok: boolean; at: string; message: string; account?: string | null; scopes?: string[] | null };
};

export type PublishModel = "trunk" | "integ" | "tags";
/** A GitHub rule on a role branch, in plain words: PR only, no delete or force-push, agents never bypass. */
export type BranchRule = { on: boolean; pr: boolean; nodel: boolean; agents: boolean };
export type MergeSettings = { squash: boolean; promo_merge: boolean; delete_on_merge: boolean; suggest_update: boolean };

// PLA-I68-4: commit conventions.
export type ConventionId = "conventional" | "area" | "ticket" | "gitmoji" | "classic" | "kernel" | "custom";
export type CommitSettings = {
  convention: ConventionId | null;
  types: string[];
  scope: "no" | "opcional" | "obligatorio";
  max: number;
  lang: "es" | "en";
  emoji: boolean;
  ticket: "trailer" | "prefijo" | "final" | "no";
  body: boolean;
  ai: boolean;
  pr_title: boolean;
  enforce: "instr" | "revisa" | "ci" | "hook";
  examples: string;
  custom_regex?: string | null;
};

// PLA-I68-5: Dependabot settings Camino proposes as a PR to .github/dependabot.yml.
export type DepsSettings = { on: boolean; interval: "daily" | "weekly" | "monthly"; target: string | null; group: boolean; auto_patch: boolean };

// PLA-I68-6: environments, any number.
export type EnvKind = "temporal" | "permanente" | "produccion" | "versiones";
export type EnvRuns = { kind: "branch"; branch: string } | { kind: "pr" } | { kind: "promote"; from: string } | { kind: "tags"; pattern: string } | { kind: "none" };
export type MigrateWhen = "paso" | "build" | "llegar" | "mano" | "nunca";
export type CaminoEnv = {
  id: string;
  name: string;
  kind: EnvKind;
  runs: EnvRuns;
  url: string | null;
  server: {
    provider: ProviderId | null;
    project: string | null;
    note: string | null;
    /** PLA-I70-19: a Manual service's own commands and checklist, written by the owner. Plania stores and shows them; it never runs them. */
    manual?: { deploy: string | null; rollback: string | null; check: string[] };
  };
  database: {
    provider: ProviderId | null;
    name: string | null;
    data: "falsos" | "copia" | "real";
    roles_split: boolean;
    migrate_when: MigrateWhen;
    lock: boolean;
    sql_review: boolean;
    approve_destructive: boolean;
    backup: "proveedor" | "dump" | "ninguna";
  } | null;
  vars: string[];
  health: { url: string | null; pages: string[] };
  publisher: "owner";
  freeze: boolean;
  /** The env_states name this environment's record is kept under (prod, sandbox…), when it has one. */
  record: string | null;
};

/** Who migrates production, as Publicar reads it (null: nobody said). */
export type ProdMigrationsOf = "deploy" | "owner" | "none" | null;

export type CaminoConfig = {
  model?: PublishModel;
  branches?: { published?: string; integration?: string | null; work_pattern?: string };
  rules?: Record<string, BranchRule>;
  merge?: Partial<MergeSettings>;
  /** Branch → check names that must be green to enter it (picked from names GitHub reported). */
  required_checks?: Record<string, string[]>;
  commits?: Partial<CommitSettings>;
  deps?: Partial<DepsSettings>;
  envs?: CaminoEnv[];
  connections?: Partial<Record<ProviderId, ConnMeta>>;
  /** PLA-I68-6: a destructive migration the owner approved, by repo path → the sha256 of the exact file approved. */
  approvals?: Record<string, string>;
};

// ---- discovery

export type GhBranch = { name: string; sha: string; ahead: number | null; behind: number | null; protected: boolean };
export type GhRuleset = { id: number; name: string; enforcement: string; target: string; branches: string[]; required_checks: string[]; plania: boolean };
export type GhWorkflow = { id: number; name: string; path: string; state: string };
export type GhCheckSeen = { name: string; app: string | null; branches: string[]; last_at: string };
export type GhRun = { id: number; name: string; branch: string; event: string; status: string; conclusion: string | null; head_sha: string; created_at: string; updated_at: string; attempt: number; url: string; workflow_id: number | null };
export type GhCommit = { sha: string; message: string; date: string };
export type GhFile = { path: string; text: string; sha: string };
export type GhMerge = { squash: boolean; merge: boolean; rebase: boolean; delete_on_merge: boolean; suggest_update: boolean };

export type DiscoveryGithub =
  | {
      ok: true;
      repo: { full_name: string; private: boolean; default_branch: string; admin: boolean; push: boolean; html_url: string; merge: GhMerge | null };
      token: { source: string; scopes: string[] | null; expires_at: string | null };
      branches: GhBranch[];
      branches_total: number;
      rules: { available: boolean; reason: "plan" | "forbidden" | null; list: GhRuleset[] };
      workflows: GhWorkflow[];
      workflow_files: GhFile[];
      dependabot: GhFile | null;
      checks: GhCheckSeen[];
      runs: GhRun[];
      commits: GhCommit[];
      repos: string[];
      /** PLA-I70-3: set when the last read failed (network, 5xx): this block is the last good one, with its age. */
      stale?: { since: string; error: string };
    }
  | { ok: false; error: "no_repo" | "no_token" | "not_found" | "unauthorized" | "network"; detail?: string; repos?: string[]; /** PLA-I70-10: where the token Plania tried came from (null: there was none). */ source?: string | null };

export type DiscoveryMac = {
  folder: { path: string; exists: boolean; clone: boolean; remote: string | null; matches: boolean | null; clones: string[] } | null;
  /** PLA-158 (F-26): own is the database the project itself names (its env file's URL), listed even on another server. */
  postgres: { ok: boolean; databases: string[]; own?: string | null } | null;
  env_example: string[] | null;
  scripts: string[] | null;
  folders: string[] | null;
  migrations: { dir: string; count: number; tool: string | null } | null;
  /** PLA-I68-5: the package manager the lockfile names (absent in reads made before). */
  pm?: "npm" | "pnpm" | "yarn" | null;
};

export type Discovery = { checked_at: string; took_ms: number; github: DiscoveryGithub; mac: DiscoveryMac };
