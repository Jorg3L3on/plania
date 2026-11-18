# Replay set

Past tickets, run again from the commit they started on. It answers one question before a change to the agents ships: does this role prompt, kit or model build better or worse than the one in use?

A case is a real ticket: what the agent was asked (title, scope, checks), where it started (`base_sha`) and what graded it (the project's verify commands). A replay gives the case to a fresh `claude -p` in a throwaway checkout and runs the verify commands on what it leaves.

## What is here

| Path | What |
|---|---|
| `replay/cases/*.json` | The cases. Committed. |
| `replay/results/*.json` | One file per run. Not committed (gitignored). |
| `scripts/replay-capture.ts` | Writes a case from Plania's database. |
| `scripts/replay.ts` | Runs the cases, and compares two runs. |

A case file:

```json
{
  "id": "zigzag-zig-12",
  "project": "zigzag",
  "repo": "~/Developer/zigzag",
  "base_sha": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  "role": "taller",
  "title": "The login page remembers the last email",
  "scope": "…the ticket's scope, as written…",
  "checks": ["The email field is filled on a second visit", "Nothing is stored for a failed login"],
  "verify": [{ "name": "test", "command": "pnpm test", "timeout_minutes": 10 }]
}
```

`repo` is the project's local clone (`~` is the home folder). `verify` needs at least one command: a case with nothing to grade it is refused.

## Capture a case

```bash
pnpm exec tsx --env-file=.env scripts/replay-capture.ts zigzag ZIG-12
```

It reads the ticket's scope and checks, the base commit of its pull request and the project's `settings.qa.verify`, and writes `replay/cases/zigzag-zig-12.json`. It only reads the database.

- The base commit is worked out with git in the project's local repo, so fetch first. If the PR is not on record or the commits are gone, pass `--base-sha <sha>`.
- `--role research` for a ticket another role built (default `taller`), `--id` to name the file, `--force` to replace one.
- Read the scope before committing the case. It is the ticket's text and it stays in this repo: no secrets, no personal data.

## Run

```bash
pnpm exec tsx scripts/replay.ts --dry-run
```

```bash
pnpm exec tsx scripts/replay.ts --trials 3
```

| Flag | Meaning |
|---|---|
| `--case <id>` | Only this case. Repeat it for several. Default: every case. |
| `--trials <k>` | Runs per case (default 1). Use 3 or more to compare: one run says little. |
| `--role-prompt <path>` | The role prompt file to append. Default: `kit/roles/<role>.md` when it exists, else none. |
| `--kit <dir>` | A kit folder, passed to Claude as `--plugin-dir`. |
| `--model <m>` | The model. Default: the CLI's. |
| `--max-turns <n>` | Turn cap per run (default 60). |
| `--timeout-minutes <n>` | Wall-clock cap per run (default 30). |
| `--dry-run` | Print the commands and the prompt. Starts nothing, writes nothing. |

Per case and trial it makes a git worktree of the repo at `base_sha` in the system temp folder, runs Claude there once, runs the verify commands, and removes the worktree. The run has no MCP server and none of Plania's env, so it cannot read or write the plan, and it may not push or open a pull request.

The Claude binary is `CLAUDE_CODE_BIN` (else `~/.local/bin/claude`), the same rule as the runner. A real run spends plan usage: `cases × trials` runs.

It prints one line per case and writes `replay/results/<stamp>.json`:

```
case            trials  passed  pass rate  pass^k  turns  tokens     time
--------------  ------  ------  ---------  ------  -----  ------  -------
zigzag-zig-12        3       2       67 %      no   31.3   48210  412.0 s
total                3       2       67 %     0/1     94  144630  1236.0 s
```

- **pass rate**: trials that passed over trials run.
- **pass^k**: every one of the k trials passed. This is the number to trust for "it works every time".
- A trial passes when the run ended without an error and every verify command passed. A run that hit the turn cap is a failure even if the checks happen to pass.

The command exits 1 when any trial failed, like a test run.

## Compare

Run once with what is in use, once with the change, then:

```bash
pnpm exec tsx scripts/replay.ts --compare replay/results/<before>.json replay/results/<after>.json
```

It prints, per case and in total, the pass rate of each, the change in points, pass^k before and after, and the change in turns and tokens. Change one thing at a time (the prompt, or the kit, or the model) and keep `--trials` the same in both runs.

## Building the set

Start with 20 to 30 cases, drawn from real failures: the weekly reading list on the Calidad page (failed runs, QA returns, deliveries the owner sent back) names them. A ticket that went wrong once is a ticket that can tell two prompts apart; one that every run gets right tells nothing.

Pick cases where the verify commands would catch a wrong answer. The verify list is the project's own (tests, typecheck, lint), run on the checkout as the run left it. It does not include the tests the original pull request added, so a case whose checks pass on the untouched base commit cannot fail for the right reason. Try the verify commands on `base_sha` before keeping a case.

Keep the set fixed while comparing. Add cases when a new kind of failure shows up; retire one when every run passes it for a month.
