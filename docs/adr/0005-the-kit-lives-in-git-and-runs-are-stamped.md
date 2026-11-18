# 0005. The agents' kit lives in git, and every run is stamped with its version

Status: Accepted
Recorded: 2026-11-17 (audit of that date, moves 2 to 4)

## Context

What an agent knows beyond its model was text in the production database: one role prompt per role and
optional skill packs, edited on screen. An edit changed every project's agents at once, with no diff,
no review and no way back, and no run recorded which text it had run with. So nobody could say whether
a change to a prompt or a skill made results better or worse.

## Decision

The agents' kit is files in this repo, under `kit/`: role prompts in `kit/roles/`, skills in
`kit/skills/<slug>/SKILL.md` in Claude's native skill format, and the default skills per role in
`kit/kits.json`. Git is the source; what the server holds is a copy made from it.

Every run records what it was given: the version of its role prompt, the skills in its kit with a hash
of each, and the skills it actually used.

A skill, or a line in one, is added only after a failure seen in a real run, and names that run. A
skill is tested against a run without it before it is given to a role.

## Consequences

- Every change to what agents know is a commit that can be read, reviewed and reverted.
- Results can be compared by prompt version and by skill, and a skill that changes nothing can be
  found and removed.
- Changing a prompt takes a commit and a deploy, not an edit on screen.
- Role prompts must be exported from the live server before they can be versioned. Until that export
  happens, `kit/roles/` holds none, and they must not be rewritten from memory.
- The kit is never written into a product repo (see 0002): a run receives it from outside the repo's
  tracked files.

## Where it shows

- `kit/`, starting at `kit/README.md`.
- `drizzle/migrations/0061_run_kit.sql` and `agent_runs` in `src/db/schema.ts`: `prompt_version`,
  `skills`, `skills_used`, `context_tokens`.
- `src/runner/packs.ts`: the older pack format this replaces.
