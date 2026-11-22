---
name: pr
description: Writes the pull request for a delivery so a reviewer can judge it without opening the code, covering what changed, evidence from before and after, how risky the merge is and how to undo it. Use when Taller opens or updates a pull request, right before calling finish, or when an existing pull request body is only a title or a list of commits.
---

# PR

The pull request is what a person reads before deciding to merge. They were not there when you built
it. Tell them what changed, show that it works, and be honest about what could go wrong and how to
take it back.

## Plania tools

- `get_task`: the ticket's key, scope and Done when, which the body answers to.
- `finish`: takes the `pr_url` and `branch`. A code ticket without a pull request is
  `TASK_MISSING_PR_URL`; work that truly has none passes `no_pr_reason`.

## Rules with no exceptions

- The base is the one your run prompt names for the workspace: `sandbox`. **Never main.**
- You never merge a pull request, and you never force-push. Merging is the owner's.
- The body carries the line `Plania: <KEY>`. Plania links the pull request to the ticket by it.
- No secrets, tokens or personal data, in the text or in a screenshot.

## Steps

1. Commit and push your branch.
2. Check whether the pull request already exists: `gh pr view`. Phases of one initiative share its
   branch and its pull request. If it exists, update the body (`gh pr edit --body-file`); do not open a
   second one.
3. Otherwise `gh pr create --base <base> --title … --body-file …`.
4. Write the body with the four sections below. The template is in [template.md](template.md).
5. Pass the URL to `finish`.

## The body

**Qué cambió.** First one or two sentences on what is different for a person using the app. Then
three to six lines on what changed in the code, grouped by behaviour. Not a list of files and not the
commit log: the diff already shows those.

**Evidencia, antes y después.** What you ran and what it showed, from this run, at the head commit.
- Checks: each command with its counts.
- A bug: the command that failed before the fix and passes now.
- A screen change: what it looked like before and after, at desktop and at phone width.
- What you did **not** verify, said plainly.

**Riesgo de la mezcla.** Bajo, medio or alto, and why. Name what applies: a migration, a change to
stored data, code that other parts share, a new environment variable or flag, a dependency added or
upgraded. Say what else could break and how someone would notice.

**Cómo deshacerlo.** What it takes to go back. Usually: revert the merge commit. Say when that is not
enough: a migration that must be reversed first, data that was rewritten, a setting to switch off.

## A database migration

Before you add one, reserve its number: `reserve_sequence {name: "migration", task_key, at_least: <the
next number in the repo's migrations folder>}`, and name the file with the number it returns. Two
branches never take the same number, and the release sheet shows it (PLA-82, F-25: a migration 0003 was
added while the counter still said 0001). Say the migration under «Riesgo de la mezcla».

## Language and title

Match the repo: look at its last merged pull requests (`gh pr list --state merged --limit 5`). When
there is no pattern, write in plain words in the owner's language. The title is the outcome in a person's terms, with the
ticket key: «MIC-12: compartir una lista por enlace».

The `muestra` you pass to `finish` is for the owner and is always plain words in the owner's language: `frase` is one
sentence on what changes for the app's users, and `pasos` are three ways to try it.

When a view needs data the app's dev database lacks (an appointment today, a client at a given stage),
put the fake rows in `muestra.datos` as SQL: fictional names, example.com addresses, times from
`now()`. Plania loads it into its own throwaway copies before the pictures (PLA-78, after Taller's
good shots stayed in a Mac folder and the card showed «Sin citas hoy»). Pictures you take yourself
are not shown to the owner; the muestra is.

The views run in order on that one database: every view on desktop, then every view on phone. So
`acciones` may open, pick and fill, but never press a button that saves, cancels or sends: the next
view would find the data changed (PLA-107: a «ficha» view that pressed «Mover» moved the sample
appointment, and four of six photos found nobody). To show a state after a save, such as a moved
appointment and its history, seed that state in `datos` and open it with `path` or `follow`.

In a step of an initiative, the rows of its earlier accepted steps are loaded after yours, statement
by statement, skipping what yours already made (PLA-97). Seed only what this step needs.

Every fake id, link token, slug or other unique value in `datos` is derived from the ticket key (for
example the key in lowercase as a prefix), never a fixed value such as `token-demo` or id 1: those
rows share a database with the other steps' rows, and two steps that reused one link token for
different records showed impossible states in the copies (PLA-158).

## Done when

- The pull request is open against `sandbox`, never main, and is not merged.
- The body has the four sections and the `Plania: <KEY>` line.
- The evidence comes from this run at the head commit, and says what was not verified.
- The risk names what applies, and the way back is concrete.
- `finish` received the `pr_url`.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4); no run on record yet. It prevents a pull request whose body is its title, so the person who merges has to read the whole diff to learn the risk, and finds out how to undo it only after something breaks.
