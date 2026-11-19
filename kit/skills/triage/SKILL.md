---
name: triage
description: Sorts incoming and stalled work across projects by its state and routes each item to whoever can move it next, whether an agent, a product owner or the owner. Use when Asistente wakes without a ticket, reads the company thread, receives a new request, or finds work that is stuck, unowned, duplicated or waiting on nobody.
---

# Triage

Every open item should have exactly one person or agent whose move it is. Triage finds the items where
that is not true and fixes it with one routing action each. You do not do the work yourself.

## Plania tools

Reading:

- `thread_read` (thread `company`): what the owner wrote. Read it first.
- `get_digest`: what changed, what runs now, what waits on the owner.
- `get_inbox` (project `all`): everything waiting on him, with how long.
- `list_projects`: one line and a `readiness` per project. `get_resume`: one project in detail.
- `get_running`: each owned ticket as `live`, `quiet` or `stale`.
- `audit`: what the server sees is wrong, each finding with a `fix_hint`.
- `list_agents`: the roster, to route by slug.

Routing:

- `create_task`: a request that is not yet a ticket.
- `assign` (`to_agent`, `note`): give a task to the agent who should own it.
- `wake_agent` (`agent`, `task_key`): wake the owner of a Ready ticket.
- `comment` or `set_task` with a `note`: leave what you found on the item.
- `propose` (kind `choice`): a real choice between options, for the owner.
- `thread_post`: your answer to the owner, in the company thread; in a project's thread when it is
  about that project.

## Route by state

Classify each item by where it is, then take the one action for that state.

| State | Action |
|---|---|
| A new request, and the project is clear | Make sure it is a ticket there (`get_resume` lists requests; otherwise `create_task`), then `assign` it to that project's product owner |
| A new request, and the project is not clear | Ask the owner in the company thread, as one closed question naming the candidates |
| Ready, nobody working on it | `wake_agent` with its `task_key` |
| In progress, and `get_running` says `stale` or `quiet` for long | A note on the ticket saying what you saw, then `wake_agent` its owner. Never claim it yourself |
| Blocked, and the audit says `BLOCKED_BUT_SATISFIED` | Follow the `fix_hint` |
| Blocked on something real | Name who clears it. If it is the owner and it is not in his inbox, add a `human_action` blocker with `set_task` |
| Needs owner, or anything in `get_inbox` | Nothing to route: it is already the owner's. Report it, oldest first, with how long it has waited |
| In review and passed | The owner's turn. Report it |
| The same work in two tickets | `comment` on the newer one pointing at the older. Closing one is the owner's: list it for him |
| A choice between options that only the owner can make | `propose` kind `choice`, with a recommendation |
| An audit finding an agent can fix | Do what its `fix_hint` says, or route it to the owner agent of that ticket |
| The project's `readiness` is `blocked` on the owner | Do not wake its agents; report what he must do |

## Rules

- **One owner, one action.** If an item needs two actions, do the first and note the second.
- **You do not build.** No code, no claims, no merges. Never answer a question for the owner: `answer`
  only records his own words, quoted.
- **Do not bounce work.** `assign` counts hops. `HOP_CAP` or `PING_PONG` means stop and tell the owner
  that the item has no natural home.
- **Do not wake twice.** A second `wake_agent` inside the agent's heartbeat does nothing; do not retry.
- **Leave no item with nobody's move.** If you cannot route it, it goes into your report as stuck, with
  why.

## The report

One `thread_post` in the company thread, plain words in the owner's language, eight lines at most, with links to the tickets:

1. what moved since last time;
2. what waits on him: how many, and the oldest;
3. what was stuck, and what you did about each;
4. what is still stuck and needs him.

No ticket keys in the sentences themselves; the links carry them.

## Done when

- Every item you looked at has one owner and a next action, or is listed as waiting on the owner.
- No item was routed twice in this run.
- Nothing was built, claimed, merged or answered on the owner's behalf.
- The report is posted.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4); no run on record yet. It prevents an Asistente run that summarises the state of the company and leaves stalled tickets exactly where they were, or that starts doing a project's work itself.
