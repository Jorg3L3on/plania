# 0002. Product repos carry no agent files

Status: Accepted
Recorded: 2026-11-17 (in force before that date)

## Context

The usual way to tell an agent how to work in a repo is a file in that repo: `CLAUDE.md`, `AGENTS.md`,
a `.claude/` or `.cursor/` folder, hooks. With many products, those files drift apart, get merged into
`main` with the product, and make the product's history carry the tooling of whoever built it.

## Decision

Nothing for Plania or for its agents is committed to a product repo: no agent instruction files, no
agent folders, no hooks, no CI for Plania. Everything an agent needs beyond the code reaches a run from
Plania at run time: the protocol in the server's `instructions`, the project's rules and decisions
through the tools, and the run's kit from outside the repo's tracked files.

This is about product repos. Plania's own repo has a `CLAUDE.md`, because people and agents build
Plania in it directly.

## Consequences

- One place to change how agents work, for every product at once.
- A product repo stays usable by anyone, with any tool, and shows no trace of how it was built.
- A session opened by hand in a product repo knows nothing unless it is connected to Plania.
- Per-run delivery has to be built and guarded: what is written into a run's folder must never reach
  a commit.
- Project knowledge (its words, its commands, where things live) needs a home in Plania, since it
  cannot live next to the code.

## Where it shows

- `README.md`, "In a product repo": "Nothing."
- `src/runner/packs.ts`: what a run is handed is written to a folder that ignores itself, is cleared
  before and after the run, and fails the run if it shows up in the branch's diff.
- `src/runner/qa-settings.ts`: the project's checks are "stored in Plania, never in the app repo".
- `kit/context/`: the templates for the project knowledge that Plania holds instead.
