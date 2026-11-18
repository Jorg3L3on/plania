# 0001. The plan lives in Plania, not in product repos

Status: Accepted
Recorded: 2026-11-17 (decided with v2, approved 2026-10-06)

## Context

Several agent sessions work on several products at once, from more than one machine and more than one
client. A plan kept as files in each product repo is only visible on the branch and the machine where
it was written, cannot be claimed or versioned, and goes stale without anyone noticing.

## Decision

Plania is the single source of the plan. Scope, Done when, status, decisions, questions, evidence,
specs and plans are records in Plania, read and written through its MCP tools. Product repos hold code
and code conventions, and nothing else.

## Consequences

- Any session on any machine sees the same plan, and every change has an author and a server time.
- Two sessions cannot silently overwrite each other: writes carry a version and work is claimed.
- An agent without access to Plania cannot plan or deliver. Plania being down stops the work.
- A plan cannot be reviewed in a pull request next to the code it describes.
- Plan files, status notes and replies are kept out of this repo too.

## Where it shows

- `src/mcp/protocol.ts`: the protocol opens with "Plania is the source of the plan; product repos hold
  code and conventions, not plans".
- `attach_doc` in `src/mcp/register.ts`: "Use this instead of plan files that live on one machine".
- `README.md`, first paragraph, and "Deviations from the handoff" (what v2 replaced).
- `.gitignore`: "Plans, requests and replies live in Plania or chat, not in the repo".
