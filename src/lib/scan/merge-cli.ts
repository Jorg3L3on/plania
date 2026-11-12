// PLA-I38-2: argument parsing for scripts/merge-gate.ts.

export const MERGE_USAGE =
  "usage: pnpm merge-gate <owner/repo> <pr-number> [--merge squash|merge|rebase] [--record <ticket>] [--json]";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TICKET = /^[A-Z][A-Z0-9]*-[A-Z0-9-]+$/;
const METHODS = ["squash", "merge", "rebase"] as const;
export type MergeMethod = (typeof METHODS)[number];

export type MergeArgs = { repo: string; pr: number; method?: MergeMethod; ticket?: string; json: boolean };

export function parseMergeArgs(argv: string[]): { ok: true; options: MergeArgs } | { ok: false; message: string; json: boolean } {
  let method: MergeMethod | undefined;
  let ticket: string | undefined;
  let json = false;
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") return { ok: false, message: MERGE_USAGE, json };
    else if (arg === "--merge") {
      const next = argv[++i];
      if (!next || !(METHODS as readonly string[]).includes(next)) return { ok: false, message: MERGE_USAGE, json };
      method = next as MergeMethod;
    } else if (arg === "--record") {
      const next = argv[++i];
      if (!next || !TICKET.test(next)) return { ok: false, message: MERGE_USAGE, json };
      ticket = next;
    } else if (arg.startsWith("-")) return { ok: false, message: MERGE_USAGE, json };
    else positionals.push(arg);
  }
  const [repo, prText] = positionals;
  if (!repo || !prText || positionals.length !== 2 || !REPO.test(repo)) return { ok: false, message: MERGE_USAGE, json };
  if (!/^[1-9]\d{0,8}$/.test(prText)) return { ok: false, message: MERGE_USAGE, json };
  return { ok: true, options: { repo, pr: Number(prText), method, ticket, json } };
}
