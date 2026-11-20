// PLA-I68: the shape GET /api/company/projects/:slug/camino answers (src/camino/store.ts CaminoRead). The config and
// discovery shapes are the server's own (src/camino/types.ts has no imports, so the screen reads it as types only).
import type { BranchRule, CaminoEnv, CommitSettings, ConnMeta, DepsSettings, Discovery, MergeSettings, ProviderId, PublishModel } from "../../../src/camino/types.js";

export type * from "../../../src/camino/types.js";

export type CaminoConfigRead = {
  model: PublishModel;
  branches: { published: string; integration: string | null; work_pattern: string };
  rules: Record<string, BranchRule>;
  merge: MergeSettings;
  required_checks: Record<string, string[]>;
  commits: CommitSettings;
  deps: DepsSettings;
  envs: CaminoEnv[];
  connections: Partial<Record<ProviderId, ConnMeta>>;
  source: Record<"model" | "branches" | "merge" | "envs", "camino" | "settings" | "github" | "default">;
};

export type CaminoProposal = { number: number; title: string; url: string; state: string; base_branch: string | null; head_branch: string | null; ci_state: string | null; task_key: string | null; merged_at: string | null; updated_at: string };
export type CaminoDest = "plania" | "proveedor" | "github" | "pr" | "llavero";

export type CaminoRead = {
  slug: string;
  title: string;
  version: number;
  config: CaminoConfigRead;
  settings: { repo: string | null; folder: string | null; no_code: boolean; release: { from: string; into: string; env: string; prod_migrations: string | null } | null; capture: boolean; capture_pages?: string[]; vercel: boolean };
  discovery: Discovery | null;
  checked_at: string | null;
  checking: boolean;
  plania: {
    envs: { env: string; commit: string | null; branch: string | null; migrations_applied: number | null; migrations: number; deployed_at: string | null }[];
    note_stale: boolean;
    keys_store: "keychain" | "file" | "memory";
  };
  proposals: CaminoProposal[];
  history: { at: string; who: string; label: string; dest: CaminoDest; undo: string | null }[];
};
