---
name: diagnosing-bugs
description: Finds the cause of a bug by first building a fast, deterministic command that fails because of it, then changing one variable at a time. Use when Taller works a bug ticket, a delivery that QA or the owner sent back, a failing or flaky test, a regression, or any behaviour nobody can yet explain, and before proposing any fix.
---

# Diagnosing bugs

A theory formed before you can reproduce the bug is a guess, and a fix for a guess cannot be checked.
So the first product of a bug ticket is not a fix. It is a command that fails.

## Plania tools

- `start`, then `get_task`: the scope, the results, the note QA or the owner left, and the bug's
  `found_in`, `introduced_by` and `regression` fields.
- `set_task` with a `note`: what you tried and what you found, as you go.
- `ask`: when the bug cannot be reproduced and only the owner knows the steps, the device or the data.
- `create_task` (work type `bug`, with `severity` S1 to S4): the same mistake found elsewhere, outside
  this ticket's scope.
- `add_result` or the `result` of `finish`: a bug accepts kind `unit`, `integration`, `test`, `live`,
  `ci`, `e2e` or `visual`.

## 1. A failing command, before any theory

Build one command that:

- **fails because of the bug**, with a non-zero exit;
- is **fast**: seconds, not minutes, so you can run it fifty times;
- is **deterministic**: the same result every time.

A test in the repo's own runner is best. A small script is fine. Then shrink it: remove inputs and
steps until removing one more makes it pass. What is left is the bug.

If the result changes between runs, the thing that varies is your first finding. Look for time, order,
the network, random values, shared state, two things running at once. Pin it, then run the command ten
times to prove it is stable.

If you cannot reproduce it after an honest attempt, do not fix it by guess. Note what you tried, and
`ask` the owner for what is missing, with options he can pick ("¿En qué pasó? Teléfono / Computadora").

## 2. Theories, each with a way to kill it

Only now write two or three possible causes. For each, write the observation that would prove it
wrong. A theory that nothing could disprove is not worth testing.

## 3. One variable at a time

Change one thing, run the command, write down what happened. If it did not explain the bug, undo it
before the next change. Two changes at once tell you nothing about either.

Ways to cut the search in half:

- A regression: `git bisect run <the command>`, between a commit where it worked and the current one.
  Never check out main; use a commit hash or `origin/sandbox` as the good end.
- Print the value at the boundary between two parts, and see which side is wrong.
- Halve the input.

## 4. The cause

You have the cause when you can turn the bug on and off with one change, and say why in one sentence.
"It works now" is not a cause. If the bug went away and you cannot say why, it is still there.

## 5. Fix the cause, and pin it

- Fix where the wrong thing happens, not where it shows. No `try/catch` around the symptom, no retry,
  no special case for the one input that was reported.
- Turn the failing command into a **regression test** in the suite. See it fail without the fix
  (undo the fix line and run it), then pass with it. Its name states the behaviour.
- Search for the same mistake elsewhere. Inside the ticket's scope, fix it. Outside, `create_task`.
- Write down what must **not** change: the behaviour next to the fix that worked before. Run the tests
  that cover it. QA checks this list.

## 6. Record

Leave a note on the ticket: the cause in one sentence, the fix, what must not change. The result's
`cite` names the command and what it showed before and after; `commit` is the head.

## Done when

- A failing command existed before the fix, and it is written down.
- The cause is one sentence, and you can switch the bug on and off.
- A regression test fails without the fix and passes with it.
- The project's checks are green at the commit you deliver (see `verify-before-done`).

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4); no run on record yet. It prevents a fix aimed at the first plausible theory, which changes several things at once, makes the symptom go away, and comes back from QA or the owner because the cause was never found.
