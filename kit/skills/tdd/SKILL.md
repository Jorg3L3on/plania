---
name: tdd
description: Drives a code change through tests written first, one at a time, each seen failing before any code is written for it. Use when Taller implements a feature or fixes a bug in a repo that has a test runner, when a ticket's Done when can be expressed as observable behaviour, or when about to write the code first and the tests afterwards.
---

# TDD

A test you never saw fail proves nothing: it may pass for the wrong reason, or test nothing at all.
Writing the test first, and watching it fail for the right reason, is how you know that the code you
write next is what makes it pass.

## Plania tools

- `start`: opens the ticket. `get_task`: its `scope` and `checks` (the Done when list, each with its `n`).
- `get_project`: `settings.qa.verify` lists the project's own check commands.
- `set_task` with a `note`: the list of behaviours you will test.
- `add_result` or the `result` of `finish`: kind `unit`, `integration` or `test`, with `command`,
  `exit_code`, `counts`, `commit` and `check_ns`.
- `ask`: only when the Done when can be read two ways that lead to different products.

## 1. Agree what to test

Before any test, list the behaviours the ticket asks for, one line each, taken from the Done when and
the scope. Leave the list as a note on the ticket. In an unattended run nobody answers, so the
agreement is with the ticket: every Done when item appears in the list, and nothing appears that the
ticket did not ask for.

Test through the **public interface**: the exported function, the route, the command, the rendered
screen. That is what a caller or a person touches, and it survives a rewrite of the inside. Do not test
private helpers, internal state, or mocks of your own modules.

How to pick the interface, and what a good test looks like: [what-to-test.md](what-to-test.md).

## 2. The loop

Find how the repo tests first: the commands in the run prompt and the project's context, the scripts
in its manifest, and the tests next to the code you will change. Copy their style.

For each behaviour on the list, in order:

1. **Write one test.** One behaviour, one reason to fail.
2. **Run that test alone and watch it fail.** Read why. It must fail on the assertion, because the
   behaviour is missing. A failure from a typo, an import or the setup is not the failure you need:
   fix the test and run it again.
3. **If it passes at once**, it proves nothing. Either the behaviour already exists (drop the test, or
   keep it as a guard and say so), or the test does not test what you think. Find out which.
4. **Write the least code that makes it pass.** Nothing for the next behaviour, nothing "while here".
5. **Run it and see it pass.** Then run the tests around it; they stay green.
6. **Tidy only while green**, and run again.
7. **Commit** the test and the code together.

One test at a time. Writing five tests and then the code turns the first four failures into noise.

## 3. Never change a test to make it pass

When a test that existed before your change fails, there are two cases:

- Your change broke something. Fix the code.
- The ticket changes that behaviour on purpose, and its scope says so. Change the test's expectation in
  its own commit, and name the Done when item that requires it in the message.

Never: delete the test, skip it, mark it `only`, loosen its assertion, raise its timeout, or refresh a
snapshot without reading the difference. A QA review fails a delivery that weakened a test.

## 4. When the repo has no tests for this layer

Do not bring in a test framework inside a feature ticket. Use the smallest check there is (a script
that exits non-zero, the type checker, running the app and looking, recorded as kind `live`) and say in
the result what was and was not covered. A missing test setup is its own ticket: `create_task`.

## 5. Finish

Run the whole suite and the project's other checks at the final commit (see `verify-before-done`).
Record the result with the real numbers, the commit and the `check_ns` it proves.

## Done when

- Every Done when item maps to at least one test that you saw fail and now passes.
- No test that existed before was changed, except as the scope requires and in its own commit.
- The full suite is green at the commit you deliver.
- The result names the command, the counts and that commit.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4); no run on record yet. It prevents deliveries whose tests were written after the code and never failed, and builds that turn green because a test was edited rather than the code.
