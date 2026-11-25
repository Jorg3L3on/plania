# Decision records

Short records of decisions that shape Plania and that someone might otherwise undo by accident. Each
one says what was decided, why, and where the code shows it.

These are decisions about **Plania itself**. Decisions about a product live in that project's decision
log in Plania (`add_decision`), not here.

## Format

One file per decision, `NNNN-short-title.md`, numbered in the order recorded. At most one page.

```markdown
# NNNN. The decision, as a sentence

Status: Accepted | Superseded by NNNN
Recorded: YYYY-MM-DD

## Context
What made a decision necessary. Two to five sentences.

## Decision
What we do. Stated so that a change can be checked against it.

## Consequences
What this costs and what it rules out, as well as what it buys.

## Where it shows
The files, rules and tests that hold the decision in place.
```

## Rules

- Record a decision when it was **made**, or when it is found in the code and not written down. The
  first five were found: they were already visible in the code on the day they were recorded.
- A record is not edited to change the decision. Write a new one and mark the old one
  `Superseded by NNNN`. Fixing a path that moved is fine.
- No record for something a test or a type already makes impossible to get wrong, or for a choice
  nobody would be tempted to reverse.
- Before changing code that a record names under "Where it shows", read the record.

## Index

| No. | Decision |
|---|---|
| [0001](0001-the-plan-lives-in-plania.md) | The plan lives in Plania, not in product repos |
| [0002](0002-product-repos-carry-no-agent-files.md) | Product repos carry no agent files |
| [0003](0003-runs-never-touch-main-and-never-merge.md) | Runs never touch main and never merge |
| [0004](0004-qa-reviews-in-a-fresh-session.md) | QA reviews in a fresh session |
| [0005](0005-the-kit-lives-in-git-and-runs-are-stamped.md) | The agents' kit lives in git, and every run is stamped with its version |
| [0006](0006-owner-written-knowledge-lives-in-versioned-data.md) | What the owner writes for an agent lives in versioned data, and runs are stamped with it |
| [0007](0007-teams-are-data-and-travel-in-the-open-layout.md) | Teams are data, and a company travels as text in the open agent-companies layout |
| [0008](0008-one-pedir-per-project-one-palette-for-the-app.md) | One Pedir bar inside a project, one Pedir palette for the app |
