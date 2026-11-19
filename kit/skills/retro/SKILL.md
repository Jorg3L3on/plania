---
name: retro
description: After a delivery was sent back, finds the one change to the agents' environment that would have prevented it and proposes it to the owner, or proposes nothing. Use when Asistente is woken on a returned delivery, on a ticket that QA failed or that the owner answered with Pedir cambios, or is asked why the same mistake keeps happening.
---

# Retro

A returned delivery is information about the environment the agent worked in: a check that did not
run, or an instruction that was not there. A retro turns one return into at most one fix, and the
owner decides whether to take it.

## Plania tools

- `get_task` with `include_log: true`: the scope, the Done when, the results, and the note that came
  with the return.
- `list_events` with `key`: the order of what happened (types `qa`, `task`, `pr`).
- `thread_read` (the project's thread): the owner's own words when he asked for changes.
- `get_project`: `settings.qa`, to see which checks already exist.
- `attach_doc`: the retro, on the ticket, titled `Retro`.
- `propose` (kind `choice`): the one fix.
- `thread_post`: one line when you propose nothing.

You change nothing yourself. A run cannot change a project's settings, and the kit lives in git: a
person applies what the owner accepts.

## Steps

1. **Read what happened**, from the records, not from anyone's summary. If the workspace has the repo,
   read the diff of the commit that was returned.
2. **State the mistake in one sentence**: what was delivered, against what was expected. Link the
   evidence: the QA note, the owner's message, the failing result.
3. **Ask why the run did not catch it**, and put it in exactly one class:

   | Class | The test | The fix |
   |---|---|---|
   | **Mechanical** | A command would have caught it: a test that was not run, a type or lint error, a broken build, a layout that breaks at phone width | **A check**: one entry for the project's verify list (a name and a command), or a command to run after each edit |
   | **Judgement** | No command would catch it. The agent chose wrongly: misread the scope, cut by layer, tested the inside, skipped a state, passed what it should have failed | **One line in a named skill**: the slug, where the line goes, and its exact words |
   | **Neither** | A one-off: the owner changed his mind, an outside service failed, the request was unclear and has since been made clear | **Nothing** |

4. **Prefer a check to a line.** A check cannot be forgotten. Propose a line only when no command
   could do the job.
5. **Look before you add.** If the project already has that check, or the skill already says it, the
   instruction was not missing. Propose nothing, or the check that would enforce it.
6. **Choose exactly one.** When several things went wrong, take the one that would have stopped the
   return earliest. No lists, no "also consider".

Three worked cases: [examples.md](examples.md).

## Proposing

1. `attach_doc` on the ticket, title `Retro`: the mistake, its class, the evidence, and the exact fix
   (the command, or the skill's slug and the line to add). This is where the technical text goes.
2. `propose` in the project, kind `choice`, with two options:
   - **Option 1, recommended**: the fix, in plain words. `effect` says what will be different from now
     on: «Antes de entregar, el taller también revisa que la pantalla se vea bien en teléfono».
   - **Option 2**: «Dejarlo como está». `effect`: «Nada cambia; si vuelve a pasar se verá en la
     siguiente entrega devuelta».
   - `title`: «Para que no se repita: <el error, en palabras llanas>».
   - `recommended_reason`: one sentence with the evidence.
   - `links`: the ticket and the Retro doc.

The owner reads it in Te toca. Plain words in the owner's language; no ticket keys, branch names or the word sandbox in the
title or the labels.

When there is nothing to propose, do not call `propose`. Post one line in the project's thread saying
that you looked and why nothing should change.

## How to write it

Describe the gap in the environment, not a fault in an agent. «No había ninguna revisión a 390 de
ancho» is useful. «Taller fue descuidado» is not, and it cannot be fixed.

## Done when

- The mistake is one sentence, with its evidence linked.
- It is in exactly one class.
- Either one proposal exists with two options (the fix, and leaving things as they are) and a Retro
  doc holding the exact fix, or no proposal exists and the reason is posted.
- You changed no setting, no skill and no ticket status.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4, AUDIT-10); no run on record yet. It prevents a returned delivery from teaching the next run nothing, and a retro that answers with a list of new rules, so the prompts grow after every mistake and nobody can tell which line helped.
