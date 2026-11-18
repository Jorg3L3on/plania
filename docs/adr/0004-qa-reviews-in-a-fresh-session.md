# 0004. QA reviews in a fresh session

Status: Accepted
Recorded: 2026-11-17 (in force since PLA-I46-9)

## Context

An agent asked to review its own work, or to review work after reading how it was built, tends to
agree with it. The builder's reasoning explains away exactly the things a reviewer should question.

## Decision

Every delivery is reviewed by the QA role in a session that is always new and never resumed. The
reviewer is told what was asked (the ticket's scope, Done when and check list) and is given the
change. It is told not to read the project thread, the ticket's notes or its log before its verdict.

The QA run is read-only: it cannot edit, commit, push, change the pull request, move the ticket or
post in a thread. It ends with a report that Plania parses and acts on. The project's own checks run
first, by Plania, on the delivered commit; the review happens only if they pass.

The review gives two verdicts that are kept apart: whether the change meets the spec, and whether the
code is sound. Either one failing fails the delivery.

## Consequences

- The reviewer judges the change, not the story of the change.
- Every review pays for reading the ticket and the diff from nothing; small changes are reviewed on a
  smaller model to keep that cheap.
- The reviewer cannot fix what it finds. A failure costs another Taller run.
- What the builder learned and did not write into the ticket or the code is invisible to QA. That is
  intended: if it matters, it belongs in one of those two places.
- A returned delivery is retried once; a second failure goes to the owner.

## Where it shows

- `src/runner/runner.ts`: "a QA run is always a fresh session", and the resume is skipped for it.
- `src/runner/qa.ts`: the lane, and `qaBriefFor` ("You have not seen how it was built, on purpose").
- `src/runner/deny.ts`: `QA_DENY_RULES`.
- `src/db/schema.ts`: `QaReview` with its `spec` and `code` axes.
- `kit/skills/two-axis-review/`.
