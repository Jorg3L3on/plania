---
name: verify-before-done
description: Requires fresh proof before a delivery is declared finished, meaning the project's checks run in this run at the final commit, with their output read. Use when Taller is about to call finish, tick a Done when item, or write that something works, passes or is fixed, on every delivery however small, and whenever a result comes from a subagent, an earlier run or another agent.
---

# Verify before done

No claim without output. "Done", "passes", "fixed" and "works" each need a command that ran in this
run, at the commit you deliver, whose output you read. Anything else is a hope.

## Plania tools

- `get_task`: the `checks` (Done when), each with its `n` and whether it is done.
- `get_project`: `settings.qa.verify`, the project's own list of checks (`name`, `command`). It is the
  list QA runs on your delivery, and the list `finish` itself may run.
- `add_result`: evidence on its own. `set_check`: tick one item. `waive_check`: an item that will not
  be done, with the reason.
- `finish`: the result and the move to In review, together or not at all.
- `create_task`: breakage you found that is not yours.

## Steps

1. **Find the checks.** In this order: the commands the run prompt gives; `settings.qa.verify`; the
   project's context (its commands); the scripts in the manifest (test, type check, lint, build). Run
   all that exist, not the one you expect to pass.
2. **Commit first.** `git status` is clean, and `git rev-parse HEAD` is the commit you will name. Proof
   for uncommitted code is proof for something you are not delivering.
3. **Run each check whole, once, on the commit you deliver.** Not a filtered subset, not watch mode, not
   "the tests I touched". While you were building, related tests were enough; this is the run that counts.
4. **Read the end of the output**: the exit code, the counts, the names of what failed. A long output
   is not a pass. Cut-off output or a timeout is not a pass.
5. **On any failure**: fix it, commit, and run **everything** again. The earlier passes belonged to an
   older commit.
6. **Go through the Done when items one by one.** For each, name the output that proves it. Something
   a person sees on a screen is proved by running the app and looking (kind `live` or `visual`), not by
   a unit test. An item nothing proves is open: do the work, or `waive_check` with the real reason.
7. **Call `finish`** with `result: {kind, verdict: "pass", cite, commit, command, exit_code, counts,
   check_ns}`, plus `pr_url`, `branch`, and `muestra` when the change touches the screen. `cite` says
   what ran and what it showed, with the real numbers.

## What is not evidence

- What you remember from earlier in this run, before the last change.
- A subagent's or another agent's "all tests pass". Run it yourself.
- A handoff note or a previous session's result.
- A pass by QA or CI on another commit.
- "It should work", "the change is trivial", "only the comments changed".
- A check that ran but whose output you did not read.

## When something fails that you did not break

Show it: run the same command on the base commit and see it fail there too. Say so in a separate
`add_result` with verdict `warn`, naming the command. Never hide it, never delete or skip the test, and
do not repair unrelated breakage inside this ticket: `create_task` for it.

## What `finish` may answer

| Error | Meaning | What to do |
|---|---|---|
| `CHECKS_OPEN` | Done when items still open, listed by `n` | Prove them (`check_ns`), or `waive_check` with a reason |
| `EVIDENCE_STALE` | Your pass names a commit that is no longer the branch head | Run the checks again at the head |
| `VERIFY_FAILED` | Plania ran the verify list in your worktree and one failed | Read the failing lines, fix, commit, run all again |
| `MUESTRA_REQUIRED` | The diff touches the screen and no `muestra` came with it | Pass `muestra {frase, vistas, pasos}`, in plain words in the owner's language |
| `TASK_MISSING_PR_URL` | A code ticket with no pull request | Open it (see `pr`), or `no_pr_reason` |

Never answer a refusal by weakening the check, waiving an item that was simply not done, or reporting
a pass you did not see.

## Say it as it is

In the result and in the thread, write what ran: «Pasa: 142 de 142 en `abc1234`». Not «debería
funcionar». When part of it is not verified, say which part.

## Done when

- Every check the project has ran in this run, whole, at the commit you deliver, and you read the end
  of each output.
- Every Done when item is ticked by evidence, or waived with its reason.
- The result's `commit` is the branch head, and its `cite` has the real counts.
- `finish` was accepted.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-1, AUDIT-4); no run on record yet. It prevents a delivery that reaches review on a pass the builder reported but never ran, so the failure is found a run later by QA and costs a second build.
