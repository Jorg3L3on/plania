// PLA-I29-5: what an unattended run may never do. The rules go to claude as --settings
// {permissions: {deny}}; deny applies in every permission mode, auto included.
// The runner also refuses to start on main or on a base other than sandbox (worktree.ts).
// GitHub branch protection is not relied on (it may be paid; Plan doc, Cost).

export const DENY_RULES: readonly string[] = [
  // Never main.
  "Bash(git push * main*)",
  "Bash(git push *:main*)",
  "Bash(git push main*)",
  "Bash(git -C * push * main*)",
  "Bash(git -C * push *:main*)",
  "Bash(git checkout main*)",
  "Bash(git checkout * main)",
  "Bash(git checkout -B main*)",
  "Bash(git switch main*)",
  "Bash(git switch * main)",
  "Bash(git -C * checkout main*)",
  "Bash(git -C * switch main*)",
  "Bash(git merge *main*)",
  "Bash(git -C * merge *main*)",
  "Bash(git reset --hard origin/main*)",
  "Bash(git branch -f main*)",
  "Bash(git branch -D main*)",
  "Bash(git update-ref refs/heads/main*)",
  // Never force.
  "Bash(git push --force*)",
  "Bash(git push -f*)",
  "Bash(git push * --force*)",
  "Bash(git push * -f*)",
  "Bash(git push * +*)",
  "Bash(git -C * push *--force*)",
  "Bash(git -C * push * -f*)",
  // Never merge a PR or aim one at main.
  "Bash(gh pr merge*)",
  "Bash(gh pr create * --base main*)",
  "Bash(gh pr create * -B main*)",
  "Bash(gh pr edit * --base main*)",
  "Bash(gh api *merge*)",
  // Never production.
  "Bash(vercel --prod*)",
  "Bash(vercel deploy --prod*)",
  "Bash(vercel * --prod*)",
  "Bash(vercel promote*)",
  "Bash(*DATABASE_URL*prod*)",
  "Bash(*psql*prod*)",
  // Plania writes that ship, change the release step, or change the roster's own wiring.
  "mcp__plania__set_env",
  "mcp__plania__set_project",
  "mcp__plania__set_agent",
  "mcp__plania__answer_delegated",
  "mcp__plania__create_company_project",
];

export type DenySettings = { permissions: { deny: string[]; defaultMode?: string } };

export const denySettings = (): DenySettings => ({ permissions: { deny: [...DENY_RULES] } });

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
