---
name: two-axis-review
description: Reviews a delivery on two axes that are never merged, whether it meets the spec and whether the code is sound. Use when QA reviews a delivery in a fresh session, judges a diff against a ticket's scope and Done when, marks the product owner's check list, or reviews a bug fix.
---

# Two-axis review

A delivery can do exactly what was asked with code that will break, or be well written and do the
wrong thing. Those are different failures with different repairs. You give one verdict for each and
never let one soften the other.

## What you may touch

You are read-only: no edits, no commits, no pushes, no changes to the pull request, and Plania refuses
`start`, `claim`, `finish`, `set_task` and `thread_post` from a QA run. Plania records your report and
acts on it.

- `get_task` with `fields: ["title", "scope", "checks"]`: the only thing you read from the ticket.
- Do **not** read the project thread, the ticket's notes or its log before your verdict. You judge the
  change on its own, without the builder's account of it.
- The change: `git diff origin/sandbox...HEAD` and the files it touches.
- What Plania already ran on this commit is in your run prompt. Do not repeat it; you may run a single
  test again to check a point.

## Axis 1 — Spec: does it do what was asked?

1. **Before opening the diff**, write from the scope and the Done when what you expect to find.
2. Read the diff.
3. For each Done when item and each item of the check list: met or not met, with the evidence. The
   evidence is a file and line, a test that covers it, or something you ran. "Probably" is not met.
4. Look for what is missing, what behaves differently from the scope, a screen that breaks, and
   behaviour nobody asked for.

The spec verdict is `pass` only when every item is met.

## Axis 2 — Code: is the change sound?

Fail this axis only for a defect you can state as a case: this input, this wrong result.

- **Cases the spec did not list**: empty, missing, very large, twice at once, the error path, a person
  without permission.
- **Tests**: do they test behaviour, and would they fail if the code were wrong? Read the diff of the
  test files: an assertion removed, a test deleted or skipped, a timeout raised, or a snapshot
  refreshed to hide a change fails this axis.
- **Data**: a migration that destroys or rewrites data, or cannot be reversed.
- **Safety**: input trusted without checking, a secret in the code, an action with no permission check.
- **Leftovers**: debug output, code commented out, a `TODO` that hides missing work, files that have
  nothing to do with the ticket.

## A bug fix: also what must not change

For a ticket that fixes a bug, add a third list. Name two to five behaviours next to the fix that
worked before (read the callers and the code around it). Check that each still holds: the tests that
cover it pass, or you read the path. A fix that changes a neighbour fails the spec axis.

Also check there is a regression test, and that it would fail without the fix.

## Style alone never fails

Names, formatting, structure you would have chosen differently, missing comments: none of these fails
either axis. You may add at most three lines that start with «Sugerencia (no cuenta):».

## Keep yourself honest

Reviewers lean towards passing. Before a `pass`, name the strongest reason this could fail, and go and
check it. Before a `fail`, check that it is a real defect against the scope, the Done when or the
check list, or a code defect with a concrete case. If it is neither, it is a suggestion.

## The report

Write the notes in the owner's language, exact, one finding per line: `archivo:línea`, what is wrong, what would
fix it. No praise and no summary of what the change does.

End with the block your run prompt asks for, in exactly its format, as the last thing you write.
Formats and an example: [report.md](report.md).

- Each axis has its own verdict and its own notes.
- The overall verdict is `fail` when either axis fails.
- Every check-list item gets a mark and a note.

## Done when

- You wrote what you expected before reading the diff.
- Every Done when and check-list item is marked, with its evidence.
- The spec verdict and the code verdict are separate, each with its notes.
- For a bug fix, what must not change is listed and checked.
- No finding is about style alone.
- The report block is the last thing in your output, in the format the run prompt gave.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4, AUDIT-6); no run on record yet. It prevents a review that returns one blended verdict, where tidy code hides a missed requirement, or a matter of taste sends a correct delivery back.
