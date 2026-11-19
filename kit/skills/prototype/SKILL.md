---
name: prototype
description: Builds throwaway code to answer exactly one question that reading cannot settle, records the answer, and discards the code. Use when Research needs to know whether something is possible, how fast or how large it is, how a library or an API really behaves, or which of two approaches works, and the answer requires running code.
---

# Prototype

A prototype buys one answer. It is written to be deleted, and it is never merged: if the answer is yes,
Taller builds the real thing from a ticket, from the start, with tests.

## Plania tools

- `get_task` and `get_doc`: the question behind the work.
- `register_footprint` and `release_footprint`: anything that outlives a command (a server, a copy of a
  database, a container, a tunnel), with its teardown.
- `lease_resource`: a shared thing such as a port. `consume`: a call against a daily quota.
- `attach_doc`: the answer. `add_result`: kind `verify` (or `perf` for a measurement) with `command`,
  `exit_code` and `cite`.
- `thread_post`: the closing line.

## Steps

1. **Write the question and both outcomes before any code.** «¿Puede X hacer Y con nuestros datos?»,
   what result means yes, what result means no. One question. If you have two, that is two prototypes.
2. **Set a limit.** About half the run. When it is reached, the answer is "no se pudo saber en este
   tiempo", with what you learned, and that is a valid result.
3. **Work outside the tracked code.** Use a folder that git does not track and that you will delete: a
   temporary folder, or an untracked folder in the workspace. Never commit it, never push it, never
   open a pull request with it.
4. **Write the least code that answers.** No tests, no error handling, no styling, values written in by
   hand. Use the versions of the dependencies the project really has (read its manifest), or the answer
   is about a different system.
5. **Stay away from anything real.** No live database, no production, no real people's data, no
   secrets in the code. Sample data you make up.
6. **Measure; do not judge by eye.** Print the number. For a timing, run it three times and give all
   three.
7. **Record the answer** in a doc on the idea or ticket (inside the Research doc's `What we learned`,
   or a doc titled `Prototype: <la pregunta>`), in plain words in the owner's language:
   - the question;
   - the command you ran and the lines it printed;
   - the answer: sí, no, or depende de qué;
   - what the prototype did **not** test (size, concurrency, real data, cost);
   - the few lines that matter, at most forty, if a builder would want to see them.
8. **Discard.** Stop what you started and run its teardown, then `release_footprint`. Delete the
   folder. `git status` shows a clean workspace.

## What a prototype is not

- Not a first version. Do not suggest "promoting" it, and do not leave it where a builder would find it
  and start from it.
- Not a way around a decision. If the result depends on what the owner wants, record both results and
  hand the decision back.
- Not evidence beyond its question. A prototype that worked with ten rows says nothing about ten
  thousand; say so.

## Done when

- The question has a recorded answer, with the command and its output.
- What was not tested is written down.
- The workspace is clean: no prototype files, no commit, no pushed branch, no pull request.
- Nothing you started is still running, and no footprint of yours is left registered.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4); no run on record yet. It prevents research that answers "can it be done" by reasoning alone, and exploratory code that lingers in a branch until someone builds on it.
