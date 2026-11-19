# Role prompts

One file per role, named by the runner's role: `product-owner.md`, `research.md`, `artist.md`,
`taller.md`, `qa.md`, `seguridad.md`, `asistente.md`, `copy.md`, `marketing.md`, `data.md`.

## Where they come from

The prompts the agents run with today are docs on the live server, titled `Prompt: <Role>`
(`Prompt: Product owner`, `Prompt: Taller`, …). The files here are **exported from that server**.

Never write a role prompt by hand from memory, and never reconstruct one from what an agent seems to
do. A file that differs from what is live makes every run's `prompt_version` stamp a lie. If the
server cannot be reached, the file stays missing until it can.

All ten were exported from the live server (pull request 264) except `seguridad.md`, which had no
live doc and was written for PLA-I2-20: the owner reads and approves it before it is deployed.

## What any install has

A role prompt runs on installs other than the first one, so it names only what every install has
(`test/kit-roles.test.ts` checks it):

- the project context, `Context: Glossary`, `Context: Commands` and `Context: Map`, which the runner
  appends to a session's first prompt and the readiness list checks;
- the idea stage docs (`Idea`, `Research`, `Design`, `Plan`) and the docs a role writes on its ticket;
- skills in `kit/skills/` that `kits.json` gives that role. A doc's shape comes from the skill, not a
  template elsewhere; anything optional, like a design library, is named only "when your kit carries
  a skill for it".

The start branch and the owner's language come from the run's prompt, never from this file.

## Changing one

1. Export the live prompt first, so the diff starts from what is really running.
2. Edit the file here, in a commit that says which run showed the need.
3. Deploy it to the server from the file. The file in git is the source; the doc on the server is its
   copy.

## What belongs in a role prompt

A role prompt says who the agent is, what it owns, and what it must never do. It stays under about
**40 instructions**. Past that, models start skipping lines, and nobody can tell which line a result
came from.

| Belongs here | Belongs elsewhere |
|---|---|
| The role's job in two or three sentences | **Procedures**, step by step: a skill in `kit/skills/` |
| What it owns and what it hands to whom | What is true of one project: that project's context (`kit/context/`) and its rules in Plania |
| The few rules with no exceptions for this role | Anything a command can enforce: a check or a deny rule, not a sentence |
| How it reports: where, and in which language | What a tool already says in its own description |

When a prompt grows, the usual cause is a procedure that crept in. Move it to a skill and leave one
line that names the skill.
