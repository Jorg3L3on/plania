---
name: spec
description: Writes the product-level spec for an idea, an order or an initiative, covering the problem, who has it, user stories and what is out of scope, with no technical how. Use when a product owner writes or rewrites an Idea doc, fills an initiative's scope, turns one of the owner's requests into something a team can plan, or finds a spec that names files, tables, endpoints or libraries.
---

# Spec

A spec says what will be true for a person when the work is done, and why it matters. It does not say
how to build it. Research, Artist and Taller each add their part later; a spec that already chose the
how takes those choices away from the roles that have the facts.

## Where it goes

| Work | Tool | Shape |
|---|---|---|
| An idea at stage `idea` | `attach_doc` with `key` the idea, `title: "Idea"` | Headings `Problem`, `Who it is for`, `Why now` are required; add `User stories`, `Out of scope` and, if any, `Assumptions` |
| An initiative | `create_task` (kind `initiative`) or `set_task`, field `scope` | The same sections; the phased plan is added under them later |
| A standalone ticket | `create_task` or `set_task`, field `scope`, with `checks` | Problem, story, out of scope in a few lines |

The required headings stay in English exactly as written: the screen translates them, and the move to
the next stage checks them (`STAGE_REQUIREMENTS_MISSING` names what is missing). Everything under the
headings is plain words in the owner's language, because the owner reads it.

Replacing a doc: read it first (`get_task` lists `docs`, `get_doc` returns the `version`) and pass that
`version`; `STALE_VERSION` means someone wrote meanwhile, so read again. A new title that already exists
is `DOC_EXISTS`.

## Sections

**Problem.** What happens today, to whom, how often, and what it costs them. Something observed, with
where you saw it: the owner's own words quoted, a message in the thread, a number. Not a missing
feature ("no hay botón de compartir" is a solution in disguise).

**Who it is for.** One kind of person in one situation: "quien hace las compras de la casa y recibe
encargos por mensaje". Never "los usuarios".

**Why now.** What makes this worth doing before the other open work. If nothing does, say so.

**User stories.** Three to seven, most valuable first, each `Como <quién>, quiero <qué>, para <por qué>`.
Each one is something a person can do and see in the running app, so it can be checked by trying it.
A story nobody could try ("como sistema, quiero una tabla…") is a technical task, not a story.

**Out of scope.** What a reasonable reader would assume is included and is not, each with its reason.
There is always at least one. This section is what stops a build from growing.

**Assumptions.** The decisions you took on the owner's behalf, as the `grilling` skill records them.

## What and why, never how

Leave out: file names, tables and columns, endpoints, libraries, component names, data structures,
"refactor", "migrate", performance tricks. If you catch yourself writing one, ask what the person would
notice, and write that instead.

One exception: a constraint the owner stated himself ("tiene que funcionar sin internet"). Quote it as
a constraint in the Problem or the story it limits.

## Before you send it

1. Read each sentence and ask: could a builder satisfy this in two ways the owner would judge
   differently? If yes, it hides a decision. Use `grilling`.
2. Check the length: an Idea doc fits on one screen, about 60 lines. Longer means it is carrying the
   how, or more than one idea.
3. For an idea, `set_task` with `stage: "research"` and the `version` you read. A stage moves one step
   at a time.

## Done when

- The required headings are there and the stage move, when there is one, was accepted.
- Every story names who, what and why, and could be tried by a person.
- Out of scope has at least one line with its reason.
- No sentence names a technical how, except a quoted constraint from the owner.
- Every open decision is a closed question or a recorded assumption.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4); no run on record yet. It prevents a spec that passes the heading check but describes a solution instead of a problem, so the roles after it build what the product owner guessed.
