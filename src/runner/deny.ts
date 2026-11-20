// PLA-I29-5: what an unattended run may never do. The rules go to claude as --settings
// {permissions: {deny}}; deny applies in every permission mode, auto included.
// The runner also refuses to start on a protected branch or on a base other than the start branch (worktree.ts).
// GitHub branch protection is not relied on (it may be paid; Plan doc, Cost).
//
// PLA-I2-7: every rule belongs to a group with an id and says what it stops (`does`). The screen's page of limits
// (ui/src/lib/limites.ts) has a plain sentence for every group and every `does`, and test/i2-7-limits.test.ts fails
// when one is missing. Each rule also carries one example call it refuses; the same test runs every example through
// deniedBy(). These are rules Claude Code follows, not a barrier of the operating system.

/** The branch names no run may move or aim at. The runner's base check (worktree.ts) uses the same list. */
export const PROTECTED_BRANCHES = ["main", "master", "production", "prod"] as const;

export type DenyGroupId = "protected-branches" | "force-push" | "pull-requests" | "production" | "plania-writes" | "qa" | "preguntar" | "probar" | "plania-self";

export type DenyRule = {
  /** The rule as Claude Code reads it: Bash(<glob>) or a tool name. */
  rule: string;
  /** What it stops, as a key of DOES_WORDS in ui/src/lib/limites.ts. */
  does: string;
  /** The tool and command of one call it refuses; deniedBy() must refuse it. */
  example: { tool: string; command: string | null };
};
export type DenyGroup = { id: DenyGroupId; rules: readonly DenyRule[] };

const bash = (glob: string, does: string, example: string): DenyRule => ({ rule: `Bash(${glob})`, does, example: { tool: "Bash", command: example } });
const tool = (name: string, does: string): DenyRule => ({ rule: name, does, example: { tool: name, command: null } });
const perBranch = (f: (b: string) => DenyRule[]): DenyRule[] => PROTECTED_BRANCHES.flatMap(f);

/** PLA-I2-9: a run of the Plania project itself (src/self/plania-self.ts isSelfProject) never reaches the live
 * server's database by name, never applies a migration and never restarts the live server: the owner does both. `name` is the live database's
 * name; the page of limits shows the rules for the default name, plania. The runner also refuses to start such a
 * run when its environment or folder points at the live database (selfRunProblem). */
export function selfDenyRules(name: string): DenyRule[] {
  return [
    bash(`*psql* ${name}`, "live-database", `psql ${name}`),
    bash(`*psql* ${name} *`, "live-database", `psql ${name} -c 'select 1'`),
    bash(`*psql*/${name}`, "live-database", `psql postgres://localhost:5432/${name}`),
    bash(`*psql*/${name} *`, "live-database", `psql postgres://localhost/${name} -c 'select 1'`),
    bash(`*psql*/${name}?*`, "live-database", `psql postgres://localhost/${name}?sslmode=disable`),
    bash(`*psql*-d ${name}*`, "live-database", `psql -h localhost -d ${name}`),
    bash(`*pg_dump*${name}*`, "live-database", `pg_dump ${name}`),
    bash(`*DATABASE_URL=*/${name}`, "live-database", `export DATABASE_URL=postgres://localhost/${name}`),
    bash(`*DATABASE_URL=*/${name} *`, "live-database", `DATABASE_URL=postgres://localhost/${name} pnpm dev`),
    bash(`*DATABASE_URL=*/${name}?*`, "live-database", `DATABASE_URL=postgres://localhost/${name}?x=1 pnpm dev`),
    bash("*db:migrate*", "apply-migrations", `pnpm db:migrate --database ${name}`),
    bash("*src/db/migrate*", "apply-migrations", "pnpm exec tsx src/db/migrate.ts"),
    bash("*drizzle-kit*migrate*", "apply-migrations", "pnpm exec drizzle-kit migrate"),
    bash("*drizzle-kit*push*", "apply-migrations", "pnpm exec drizzle-kit push"),
    // The live server changes only when the owner restarts it.
    bash("*server:restart*", "restart-live", "pnpm server:restart --force"),
    bash("*launchctl*com.plania.server*", "restart-live", "launchctl kickstart -k gui/501/com.plania.server"),
    bash("*systemctl*plania*", "restart-live", "systemctl --user restart plania.service"),
  ];
}

export const DENY_GROUPS: readonly DenyGroup[] = [
  // Never main, master, production or prod (PLA-I2-7: the same names as the base check; it was main only).
  {
    id: "protected-branches",
    rules: perBranch((b) => [
      bash(`git push * ${b}*`, "push-protected", `git push origin ${b}`),
      bash(`git push *:${b}*`, "push-protected", `git push origin HEAD:${b}`),
      bash(`git push ${b}*`, "push-protected", `git push ${b}`),
      bash(`git -C * push * ${b}*`, "push-protected", `git -C /w push origin ${b}`),
      bash(`git -C * push *:${b}*`, "push-protected", `git -C /w push origin HEAD:${b}`),
      bash(`git checkout ${b}*`, "checkout-protected", `git checkout ${b}`),
      bash(`git checkout * ${b}`, "checkout-protected", `git checkout -f ${b}`),
      bash(`git checkout -B ${b}*`, "checkout-protected", `git checkout -B ${b} origin/${b}`),
      bash(`git switch ${b}*`, "checkout-protected", `git switch ${b}`),
      bash(`git switch * ${b}`, "checkout-protected", `git switch --discard-changes ${b}`),
      bash(`git -C * checkout ${b}*`, "checkout-protected", `git -C /w checkout ${b}`),
      bash(`git -C * switch ${b}*`, "checkout-protected", `git -C /w switch ${b}`),
      bash(`git merge *${b}*`, "merge-protected", `git merge origin/${b}`),
      bash(`git -C * merge *${b}*`, "merge-protected", `git -C /w merge origin/${b}`),
      bash(`git reset --hard origin/${b}*`, "reset-protected", `git reset --hard origin/${b}`),
      bash(`git branch -f ${b}*`, "move-protected", `git branch -f ${b} HEAD`),
      bash(`git branch -D ${b}*`, "move-protected", `git branch -D ${b}`),
      bash(`git update-ref refs/heads/${b}*`, "move-protected", `git update-ref refs/heads/${b} HEAD`),
    ]),
  },
  // Never force.
  {
    id: "force-push",
    rules: [
      bash("git push --force*", "force-push", "git push --force"),
      bash("git push -f*", "force-push", "git push -f"),
      bash("git push * --force*", "force-push", "git push origin jl/x --force-with-lease"),
      bash("git push * -f*", "force-push", "git push origin -f"),
      bash("git push * +*", "force-push", "git push origin +jl/x"),
      bash("git -C * push *--force*", "force-push", "git -C /w push --force"),
      bash("git -C * push * -f*", "force-push", "git -C /w push origin -f"),
    ],
  },
  // Never merge a PR or aim one at a protected branch. PLA-I2-7: `gh pr create --base main` with nothing before
  // --base slipped past the old `gh pr create * --base main*`; the globs below take both orders and --base=.
  {
    id: "pull-requests",
    rules: [
      bash("gh pr merge*", "merge-pr", "gh pr merge 12 --merge"),
      bash("gh api *merge*", "merge-pr", "gh api -X PUT repos/o/r/pulls/12/merge"),
      ...perBranch((b) => [
        bash(`gh pr create*--base ${b}*`, "pr-to-protected", `gh pr create --base ${b} --title x`),
        bash(`gh pr create*--base=${b}*`, "pr-to-protected", `gh pr create --title x --base=${b}`),
        bash(`gh pr create*-B ${b}*`, "pr-to-protected", `gh pr create -B ${b} --title x`),
        bash(`gh pr edit*--base ${b}*`, "pr-to-protected", `gh pr edit 12 --base ${b}`),
        bash(`gh pr edit*--base=${b}*`, "pr-to-protected", `gh pr edit 12 --base=${b}`),
        bash(`gh pr edit*-B ${b}*`, "pr-to-protected", `gh pr edit 12 -B ${b}`),
      ]),
    ],
  },
  // Never production.
  {
    id: "production",
    rules: [
      bash("vercel --prod*", "deploy-production", "vercel --prod"),
      bash("vercel deploy --prod*", "deploy-production", "vercel deploy --prod"),
      bash("vercel * --prod*", "deploy-production", "vercel deploy . --prod"),
      bash("vercel promote*", "deploy-production", "vercel promote dpl_1"),
      bash("*DATABASE_URL*prod*", "production-database", "DATABASE_URL=postgres://prod-db/app pnpm db:migrate"),
      bash("*psql*prod*", "production-database", "psql postgres://prod-db/app"),
    ],
  },
  // Plania writes that ship, change the release step, or change the roster's own wiring.
  {
    id: "plania-writes",
    rules: [
      tool("mcp__plania__set_env", "set-env"),
      tool("mcp__plania__set_project", "set-project"),
      tool("mcp__plania__set_agent", "set-agent"),
      tool("mcp__plania__answer_delegated", "answer-for-owner"),
      tool("mcp__plania__create_company_project", "create-project"),
    ],
  },
  // PLA-I46-9: a QA run reviews a delivery and writes nothing to the app repo: no edits, no commits, no pushes, no
  // PR changes, no branch moves. Plania records its report.
  {
    id: "qa",
    rules: [
      tool("Edit", "edit-files"),
      tool("Write", "edit-files"),
      tool("NotebookEdit", "edit-files"),
      bash("git commit*", "commit", "git commit -m x"),
      bash("git -C * commit*", "commit", "git -C /w commit -m x"),
      bash("git push*", "push", "git push origin jl/x"),
      bash("git -C * push*", "push", "git -C /w push origin jl/x"),
      bash("git reset*", "move-branch", "git reset --hard HEAD~1"),
      bash("git checkout*", "move-branch", "git checkout jl/x"),
      bash("git switch*", "move-branch", "git switch jl/x"),
      bash("git rebase*", "move-branch", "git rebase origin/sandbox"),
      bash("git merge*", "move-branch", "git merge jl/x"),
      bash("git stash*", "move-branch", "git stash"),
      bash("git restore*", "move-branch", "git restore ."),
      bash("git clean*", "move-branch", "git clean -fd"),
      bash("git tag*", "move-branch", "git tag v1"),
      bash("gh pr create*", "change-pr", "gh pr create --title x"),
      bash("gh pr edit*", "change-pr", "gh pr edit 12 --title x"),
      bash("gh pr comment*", "change-pr", "gh pr comment 12 --body x"),
      bash("gh pr review*", "change-pr", "gh pr review 12 --approve"),
      bash("gh pr close*", "change-pr", "gh pr close 12"),
      tool("mcp__plania__start", "take-ticket"),
      tool("mcp__plania__claim", "take-ticket"),
      tool("mcp__plania__finish", "take-ticket"),
      tool("mcp__plania__set_task", "take-ticket"),
      tool("mcp__plania__thread_post", "post-thread"),
    ],
  },
  // PLA-I57-1: a run that answers the owner's question (Preguntar) works in the project's own checkout, so on top of
  // QA's rules it may not change files from the shell or run the app's tooling. It answers with answer_consulta only.
  {
    id: "preguntar",
    rules: [
      bash("rm*", "change-files-shell", "rm -rf src"),
      bash("mv*", "change-files-shell", "mv a b"),
      bash("cp*", "change-files-shell", "cp a b"),
      bash("touch*", "change-files-shell", "touch a"),
      bash("mkdir*", "change-files-shell", "mkdir a"),
      bash("chmod*", "change-files-shell", "chmod +x a"),
      bash("sed -i*", "change-files-shell", "sed -i s/a/b/ f"),
      bash("tee*", "change-files-shell", "tee f"),
      bash("npm*", "run-tooling", "npm install"),
      bash("pnpm*", "run-tooling", "pnpm test"),
      bash("npx*", "run-tooling", "npx tsc"),
      bash("yarn*", "run-tooling", "yarn build"),
      bash("node*", "run-tooling", "node script.js"),
      bash("python*", "run-tooling", "python script.py"),
      bash("git pull*", "git-sync", "git pull"),
      bash("git fetch*", "git-sync", "git fetch origin"),
      bash("git worktree*", "git-sync", "git worktree add ../x"),
      bash("git branch*", "git-sync", "git branch jl/x"),
      tool("mcp__plania__ask", "plan-writes"),
      tool("mcp__plania__create_task", "plan-writes"),
      tool("mcp__plania__attach_doc", "plan-writes"),
      tool("mcp__plania__deliver_stage", "plan-writes"),
      tool("mcp__plania__attach_frames", "plan-writes"),
    ],
  },
  // PLA-I67-6: a skill trial («Probar») re-runs a past delivery in a throwaway copy. It may edit that copy, but it
  // reaches no Plania tool (its MCP config is empty too), and it never commits, pushes, moves a branch or touches a PR,
  // so the delivery's branch, ticket and PR stay as they were.
  {
    id: "probar",
    rules: [
      tool("mcp__plania", "plania-in-trial"),
      bash("git commit*", "commit", "git commit -m x"),
      bash("git -C * commit*", "commit", "git -C /w commit -m x"),
      bash("git push*", "push", "git push origin jl/x"),
      bash("git -C * push*", "push", "git -C /w push origin jl/x"),
      bash("git checkout*", "move-branch", "git checkout jl/x"),
      bash("git switch*", "move-branch", "git switch jl/x"),
      bash("git branch*", "move-branch", "git branch -f jl/x"),
      bash("git merge*", "move-branch", "git merge jl/x"),
      bash("git rebase*", "move-branch", "git rebase origin/sandbox"),
      bash("git update-ref*", "move-branch", "git update-ref refs/heads/jl/x HEAD"),
      bash("git worktree*", "move-branch", "git worktree add ../x jl/x"),
      bash("gh pr*", "change-pr", "gh pr comment 12 --body x"),
    ],
  },
  // PLA-I2-9: on top of the others, when the project is Plania itself.
  { id: "plania-self", rules: selfDenyRules("plania") },
];

const rulesOf = (...ids: DenyGroupId[]): string[] => DENY_GROUPS.filter((g) => ids.includes(g.id)).flatMap((g) => g.rules.map((r) => r.rule));

/** The groups every unattended run carries. QA and Preguntar runs add their own group(s) on top. */
export const RUN_GROUP_IDS: readonly DenyGroupId[] = ["protected-branches", "force-push", "pull-requests", "production", "plania-writes"];

export const DENY_RULES: readonly string[] = rulesOf(...RUN_GROUP_IDS);

// AUDIT-1: hooks ride in the same settings file, so a project's after-edit command never lands in its repo.
export type HookEntry = { matcher?: string; hooks: { type: "command"; command: string; timeout?: number }[] };
export type DenySettings = { permissions: { deny: string[]; defaultMode?: string }; hooks?: { PostToolUse?: HookEntry[] } };

// The hook for settings.qa.after_edit: the command runs after every file edit of the run.
export const afterEditHooks = (h: { command: string; timeout_seconds?: number } | undefined | null): DenySettings["hooks"] | undefined =>
  h?.command?.trim() ? { PostToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: h.command.trim(), timeout: h.timeout_seconds ?? 60 }] }] } : undefined;

/** A QA run, on top of DENY_RULES. */
export const QA_DENY_RULES: readonly string[] = rulesOf("qa");

/** A Preguntar run, on top of DENY_RULES: QA's rules and its own. */
export const CONSULTA_DENY_RULES: readonly string[] = rulesOf("qa", "preguntar");

/** PLA-I67-6: a skill trial, on top of DENY_RULES. */
export const TRIAL_DENY_RULES: readonly string[] = rulesOf("probar");

/** A run of the Plania project itself, on top of its lane's rules, for the live database's name. */
export const selfRules = (liveName: string | null): string[] => selfDenyRules(liveName || "plania").map((r) => r.rule);

export const denySettings = (extra: readonly string[] = []): DenySettings => ({ permissions: { deny: [...DENY_RULES, ...extra] } });

const globToRegex = (glob: string): RegExp =>
  new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "s");

// The parts of a compound command, each checked on its own (a && b, a; b, a | b).
const segments = (command: string): string[] =>
  command
    .split(/&&|\|\||;|\||\n/)
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);

// The rule that denies this tool call, or null. Bash rules match the command (or any segment of a
// compound one) as a glob; MCP rules match the tool name exactly or the whole server (mcp__plania).
export function deniedBy(tool: string, command: string | null, rules: readonly string[] = DENY_RULES): string | null {
  for (const rule of rules) {
    const bash = /^Bash\((.*)\)$/s.exec(rule);
    if (bash) {
      if (tool !== "Bash" || command == null) continue;
      const re = globToRegex(bash[1]!);
      if (segments(command).some((part) => re.test(part))) return rule;
      continue;
    }
    if (tool === rule || tool.startsWith(`${rule}__`)) return rule;
  }
  return null;
}
