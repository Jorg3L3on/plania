# The agents' kit

What Plania's agents know beyond their model: the role prompts, the skills each role carries, and the
templates for what a project tells them about itself. It lives in git so that every change has a diff,
and every run is stamped with the version of the kit it ran with (`agent_runs.prompt_version`,
`skills`, `skills_used`).

Nothing here is ever written into a product repo. The runner hands a run its kit from outside the
repo's tracked files.

This folder is the **factory kit**: Plania's own, the same in every installation. What an owner writes
for their agents on the Oficio page (their own skills, an edited copy of a factory skill, «tu manera»)
lives in versioned data in their Plania, not here ([ADR 0006](../docs/adr/0006-owner-written-knowledge-lives-in-versioned-data.md)).
A run carries both, resolved per agent (`src/runner/skills.ts`), and is stamped `slug@hash` for each
skill whichever source it came from. An owner copy replaces the factory skill only for the agents in
its scope; the factory file is never written from the screen.

## Layout

```
kit/
  kits.json                  default skills per role: { "<role>": ["<slug>", ...] }
  roles/
    README.md                how role prompts get here
    <role>.md                one role prompt, exported from the live server
  skills/
    <slug>/
      SKILL.md               the skill: frontmatter, then the body
      <other>.md             detail the body points to, read only when needed
  teams/
    <slug>.json              a factory team (PLA-I71-6, ADR 0007): seats by role, who reports to whom, skills, motor
  reflector/
    role.md                  the reflector's prompt: reads one owner correction, proposes at most one lesson
    skills/reflect-on-correction/SKILL.md   its one skill (not on any seat's shelf)
  context/
    glossary.md              templates the owner fills per project
    commands.md
    map.md
```

Roles are the runner's names: `product-owner`, `research`, `artist`, `taller`, `qa`, `seguridad`,
`asistente`, `copy`, `marketing`, `data`. A role with an empty list in `kits.json` carries no skill
yet, on purpose.

## What a skill is

A folder with a `SKILL.md`, in the format Claude reads natively.

- **Frontmatter**: `name`, equal to the folder's slug, and `description`. The description is the only
  part loaded into every run, and it decides whether the skill is used. It is written in the third
  person, says what the skill does and when to use it, lists triggers and not the procedure, and stays
  under 1,024 characters.
- **Body**: under 150 lines. It names the Plania tools it uses, gives the steps, states its completion
  criteria under `Done when`, and ends with one `Origin` line.
- **Other files**: examples, templates and checklists that are not needed every time. The body links
  to them.

Skills are written in English. Where the agent writes something the owner reads (a question, a plan,
a thread line, a `muestra`), the skill says to write it in plain words in the owner's language (each run is told which).

Tool names are written bare (`finish`, `propose`). In a run they are Plania's MCP tools,
`mcp__plania__<name>`.

A skill holds a procedure. Who the agent is and what it may never do belong in the role prompt; what
is true of one project belongs in that project's context; what a command can enforce belongs in a
check, not in prose.

## Adding a skill, or a line to one

This section is about the factory kit. An owner's own skills follow the owner's judgement.

Only after a failure seen in a real run. Not because a practice sounds good, and not in advance.

1. Find the run where it went wrong, and say what went wrong in one sentence.
2. Ask whether a check could have caught it. If a command can, add the command to the project's
   verify list and stop: a check cannot be forgotten, a skill can.
3. If it is a matter of judgement, look for the skill that already covers that work. Prefer one line
   in an existing skill to a new skill.
4. Write the smallest change that would have prevented that run's failure.
5. Put the run in the `Origin` line: the project, the ticket key, the run id, the date, and the
   failure in one clause.
6. Test it (below) before it reaches `kits.json`.
7. Commit the skill and the `kits.json` change together, with the run named in the message.

The seventeen skills here are the exception: they were seeded from the audit of 2026-11-17, before
any run history could be read, and their `Origin` lines say so. Replace each seed `Origin` with the
first real run that shows its failure. A seed skill that has not fired, or has not changed an outcome,
after a fair number of runs is removed.

Removing is as normal as adding. A skill whose `Origin` failure no longer happens without it has
nothing left to do.

## Testing a skill against a run without it

A skill is kept because runs with it end better than runs without it, on the case it was written for.

1. **Pick the case.** The ticket from the `Origin` line: its base commit, its scope and its Done when.
   A seed skill uses the first real ticket where its failure appeared.
2. **Run it both ways** from that base commit, with the same role prompt and the same model: once with
   the role's kit as it is, once with this skill taken out of the role's list.
3. **Repeat.** Runs vary. Three of each is the minimum before believing a difference.
4. **Compare outcomes, not style**:
   - did the failure in `Origin` happen;
   - did the delivery pass QA on the first try, on both axes;
   - turns and tokens to reach In review.
5. **Read both transcripts.** Check `skills_used` on the run: if the skill never fired, the body was
   not tested at all, and the problem is its `description`.
6. **Decide.** Keep it when the failure appears without the skill and not with it. If both arms end
   the same, the skill is not earning its place in the context: do not add it.

Until the replay set exists, do this by hand on a scratch copy of the project, never on the live plan.

## Checking the files

Every `SKILL.md` must have frontmatter that parses, a `name` equal to its folder, a description under
1,024 characters, a body under 150 lines and a last line starting with `Origin:`. Every slug in
`kits.json` must be a folder under `skills/`. `claude plugin validate` checks the frontmatter when the
kit is packed as a plugin.
