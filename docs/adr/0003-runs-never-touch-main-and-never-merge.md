# 0003. Runs never touch main and never merge

Status: Accepted
Recorded: 2026-11-17 (in force since PLA-I29-5)

## Context

Runs are unattended. An agent that can push to `main`, merge its own pull request or reach production
can ship a mistake with nobody having looked at it. Asking the agent not to, in a prompt, is not
enough: the rule has to hold when the agent is wrong.

## Decision

A run works on its own branch, in its own worktree, cut from `sandbox`. It may open a pull request
into `sandbox`. It may never:

- check out, push to, reset or merge into `main`;
- force-push;
- merge any pull request, or aim one at `main`;
- deploy to production or connect to a production database;
- change a project's settings, the environment record, or the roster.

Merging a delivery is the owner's approval on screen. Shipping a release is the owner's, from the
screen, and is refused to any token.

The rule is enforced outside the agent, in two places that do not depend on each other: deny rules
handed to every run, and the runner refusing to start on a protected branch or from any base but
`sandbox`. GitHub branch protection is not relied on.

## Consequences

- The worst a run can do is open a bad pull request against `sandbox`.
- Nothing lands without the owner. When he is away, finished work waits.
- Work that really needs `main` (a hotfix) cannot be done by a run; a person does it.
- Deny rules are patterns over commands. A new way to reach `main` needs a new rule and a test.

## Where it shows

- `src/runner/deny.ts`: `DENY_RULES`, and the stricter `QA_DENY_RULES` and `CONSULTA_DENY_RULES`.
- `src/runner/worktree.ts`: `ALLOWED_BASE` is `sandbox`; protected branches are refused.
- `src/runner/runner.ts`, `userPrompt`: every run is told "Never main… never merge".
- `src/mcp/protocol.ts`, Finish: "Never merge a PR".
- `README.md`, the JSON API table: shipping a release refuses any `Authorization: Bearer`.
