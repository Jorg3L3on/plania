# Plania

Source of the plan for Jorge and his agents. A generated resume per project on screen, the rest over MCP.
The plan lives here, not in each product repo. v2 (approved 2026-10-06) makes it safe for several agent
sessions at once: leased claims, versioned writes, an event log with who did what, and server time everywhere.

- App: Hono on Vercel Hobby (`iad1`), one Node function at `api/index.ts`.
- DB: Neon Free (`aws-us-east-1`), Drizzle over `pg`, one pool per request.
- Screen: server-rendered HTML, password login (argon2id + `plania_session` cookie).
- Agents: `POST /mcp` with `Authorization: Bearer <MCP_BEARER_TOKEN>` (or the read-only token).
- CI: `POST /hooks/*` with `Authorization: Bearer <PLANIA_CI_TOKEN>`.

## Setup

```bash
corepack enable pnpm
pnpm install
cp .env.example .env
```

Fill `.env`:

| Var | Value |
|---|---|
| `DATABASE_URL` | Neon connection string (or a local Postgres for dev) |
| `MCP_BEARER_TOKEN` | Random token, e.g. `openssl rand -hex 32`. Clients use it as `PLANIA_MCP_TOKEN`. |
| `SESSION_SECRET` | At least 32 bytes, e.g. `openssl rand -base64 48` |
| `PLANIA_PASSWORD_HASH` | Output of `pnpm hash-password`. Quote it in `.env`. Never a plain password. |
| `MCP_READ_TOKEN` | Optional. A second token for planning sessions: read tools only. |
| `PLANIA_CI_TOKEN` | Optional. Token for `/hooks/*` only; it cannot use `/mcp`. |
| `PLANIA_TZ` | Optional. Time zone the screen shows times in. Default `America/Mexico_City`. |

## Database

Migrations are generated here (`pnpm db:generate`) and applied by Jorge, in order:

```bash
for f in drizzle/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done   # fresh database
pnpm seed
```

`pnpm seed` loads the day-one projects `micasa`, `workia`, `filmia`, `zigzag`. It is safe to rerun:

- Title and body belong to the seed until someone edits them with `set_project`; after that the seed leaves them alone.
- Each project's handoff "must keep" line is added once as a pinned decision.
- Rules and design docs are not seeded: write them with `set_project` and `attach_doc`.

### Upgrading a v1 database to v2

Migrations `0001`–`0014` only add (tables, columns, defaults); the v1 columns stay, so the old server keeps
working until the restart. Then move the v1 data with the backfill, stage by stage, dry-run first:

```bash
for f in drizzle/migrations/00{01..14}_*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
pnpm backfill-v2 --stage body                    # bodies → scope, phase, checks, dated notes, results
pnpm backfill-v2 --stage decisions               # typed dates → decided_on; one named key → task; flags wrong days
pnpm backfill-v2 --stage resume                  # the card's must-keep → pinned decision; card stays as legacy_card
pnpm backfill-v2 --stage sequences               # lists the numbers each ticket mentions
pnpm backfill-v2 --stage claims                  # In progress tickets → a 24h legacy lease from their claim note
# each again with --apply once the dry run looks right. Two take a mapping you write:
pnpm backfill-v2 --stage sequences --project filmia --map migration:0008=FIL-02,0009=FIL-01-F1,0010=FIL-01-F3 --apply
pnpm backfill-v2 --stage decisions --project filmia --map <new-id-prefix>:<old-id-prefix> --apply   # reversals
launchctl kickstart -k gui/$(id -u)/com.plania.server
```

Run the stages in that order (notes from bodies land in the log before the later stages' events). A stage
that already ran for a project is skipped. The backfill never changes `tasks.body` or the v1 card; a later
cleanup migration drops them (and `design_pages`) once the backfill is confirmed. Until then `get_task`
shows `legacy_body` for a task whose scope is still empty, and `get_resume` shows `legacy_card`.

## Dev

```bash
pnpm dev     # http://localhost:3737, reloads on change
pnpm start   # same server, no watch
pnpm build   # typecheck
pnpm test    # MCP, screen, hooks, seed and backfill tests; rebuilds a local plania_test database each run
```

Port 3737 avoids the 3000 that product repos use. The server only listens on 127.0.0.1.

## Running locally as a service

Plania currently runs on this Mac instead of Vercel.

- Database: local Postgres 14 (Homebrew service), database `plania`.
- Server: launchd agent `com.plania.server` at `~/Library/LaunchAgents/com.plania.server.plist`.
  It starts at login, restarts on crash, and logs to `~/Library/Logs/plania/server.log`.
  It runs nvm's Node by absolute path, so update the plist after switching Node versions.
- Clients, all pointing at `http://localhost:3737/mcp` with the Bearer from `.env`:
  Claude Code (user scope), Cursor (`~/.cursor/mcp.json`), Codex (`~/.codex/config.toml`).

```bash
launchctl kickstart -k gui/$(id -u)/com.plania.server   # restart after code or .env changes
launchctl bootout gui/$(id -u)/com.plania.server        # stop and unload
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.plania.server.plist  # load again
tail -f ~/Library/Logs/plania/server.log
```

Change the screen password with `pnpm hash-password`, paste the result into `.env` as
`PLANIA_PASSWORD_HASH='...'`, then restart. Rotating `MCP_BEARER_TOKEN` means updating all three client configs.

## MCP

`POST /mcp`, stateless JSON (no sessions, no GET listen stream). Every call needs a Bearer token;
otherwise `401 {"error":"UNAUTHORIZED"}`. The screen cookie is never accepted here.
`MCP_BEARER_TOKEN` sees every tool; `MCP_READ_TOKEN` sees only the read tools.

The working protocol (claim, versions, evidence, never Done) is served as the server's `instructions`
on `initialize`, versioned (`PROTOCOL_VERSION` in `src/mcp/protocol.ts`, also in `get_project`). Project-specific
additions are the project's `rules` (`set_project`). Product repos point here instead of copying the rules.

| Read | |
|---|---|
| `get_resume` | Generated: live claims, next claimable, per open initiative its notes, claims, next ticket and pinned decisions; open questions; latest events |
| `get_project` | Body, rules, protocol version, counts, `env` per environment, reserved sequence numbers |
| `list_tasks` | Filters: parent, status, kind, work_type, owner, unblocked, updated_since, search, limit |
| `get_task` | Scope, phase, checks, results, docs, questions, blockers with `satisfied`, claim, workspace, version, log; `include_children` |
| `get_memory` | Rules, project docs, decisions (filters: task, initiative, tag, superseded) |
| `get_doc` | One doc's markdown |
| `get_next` | Next claimable ticket (expired leases included as `stale_claim`) |
| `list_events` | The change feed, with a cursor |

| Write | |
|---|---|
| `create_task` | Ticket (default) or initiative; scope, checks, phase, work_type, blocked_by |
| `set_task` | Fields with `version`; status through the state machine; a note alone needs no version |
| `claim` | claim / heartbeat / release a lease (default 30 min), with workspace |
| `set_check` | Tick one Done when item |
| `add_result` | Evidence: kind, verdict, cite, url; can tick checks |
| `attach_doc` | A spec, plan or design doc on a task or the project |
| `add_decision` | One line; task, tags, pin, supersedes, ADR body |
| `ask` / `answer` | Questions for Jorge; the answer becomes a decision |
| `reserve_sequence` | Next free number of a sequence (e.g. migrations), bound to a ticket |
| `set_env` | What an environment runs: commit, branch, migrations applied, deployed at |
| `set_project` | Title, body, rules, with version |

Rules every write follows:

- **Actor.** `actor: {agent, session_id, machine?, model?}` is required and lands in the event log.
  `session_id` owns leases. `jorge` is reserved for the screen.
- **Events.** Every write records one or more events in the same transaction; `get_task.log` and
  `list_events` read them. Writes are serialized per project, so a `list_events` cursor never skips one.
- **Time.** Every timestamp is ISO-8601 UTC from the server. Agents never type dates.
- **Versions.** `set_task`, `set_project` and doc replaces carry the version read; a mismatch is `STALE_VERSION`.
  Appends (notes, results, checks, questions) need none.
- **Leases.** `claim` is the only way into In progress. While a session holds a live lease, other sessions
  may add notes and results but not change the task (`NOT_OWNER`). An expired lease is free; the next write in
  the project releases it (`claim.expired`, In progress → Ready).
- **States.** Tickets: Backlog ⇄ Ready → (claim) In progress → In review; Blocked (with a note) from any open
  state; Needs Jorge through `ask` only. Initiatives: Planning ⇄ Active ⇄ Shipping, any ⇄ On hold.
  Done and Won't do (and reopening) are Jorge's: on screen, or `confirm_by_jorge` + `reason` when he asked.
- **Evidence.** In review needs a result recorded during the current claim: code a passing
  unit|integration|test|live|ci; ops live|verify|ci; research any result or a doc; decision-needed never.
- **Template.** A ticket needs a scope; code and ops tickets need a check. Conventions only warn.
- **Idempotency.** A write with `request_id` that is retried returns the first response and writes nothing.
  Without it, `create_task` with an existing key is `KEY_EXISTS`. Request ids are kept 30 days.
- **Limits.** Title 200, summary 300, scope/body 50 000, note 4 000, decision 2 000, check 500 × 50,
  blocked_by 50, doc 200 000, ADR 100 000 characters (`src/mcp/limits.ts`); over it is `TOO_LARGE {field, max}`.

Contract errors come back as an MCP tool error (`isError: true`) whose text is
`{"error":"<CODE>","status":<400|403|404|409>, ...detail}`, e.g. `{"error":"STALE_VERSION","status":409,"current_version":4}`.
Input that does not match a tool's schema (a missing `actor`, a wrong type) is rejected by the MCP SDK
before Plania runs, as a plain-text tool error (`INVALID_INPUT`). The catalog is generated from
`src/mcp/errors.ts` with `pnpm error-catalog`:

<!-- errors:start -->
| Code | Status | When |
|---|---|---|
| `BLOCKED_REQUIRES_NOTE` | 400 | status Blocked without a note (create_task cannot block: it takes no note) |
| `BLOCKER_NOT_FOUND` | 400 | a blocked_by key does not exist in this project, or names the task itself |
| `BODY_REMOVED` | 400 | body is gone in v2: use scope, checks, and note (the log) |
| `FIELD_NOT_ALLOWED` | 400 | a field of the other kind: priority/parent_key/origin/work_type/phase on an initiative, base_branch/next_action/in_progress_note on a ticket |
| `INVALID_ENV` | 400 | set_env: env is not lowercase [a-z][a-z0-9_-]*, a commit is not 7-40 hex, or migrations_applied is not a count |
| `INVALID_ENV_CONDITION` | 400 | an env blocker's condition or value is wrong (contains_commit <sha>, migration_gte <n>, deployed_after [ISO]) |
| `INVALID_FILTER` | 400 | a list filter is malformed (detail: field), e.g. updated_since is not an ISO-8601 time |
| `INVALID_PHASE` | 400 | phase is not an integer 0..999 |
| `INVALID_PRIORITY` | 400 | priority is not P0, P1, P2 or P3 |
| `INVALID_QUESTION` | 400 | ask with an empty question, or answer with an empty answer |
| `INVALID_RESULT` | 400 | add_result kind, verdict or cite is not valid, or check_ns with a verdict other than pass |
| `INVALID_SEQUENCE` | 400 | sequence name is not lowercase [a-z][a-z0-9_-]*, or a number is out of range |
| `INVALID_STATUS` | 400 | status is not in the task kind's vocabulary, or not allowed at creation |
| `INVALID_TTL` | 400 | ttl_minutes outside 5..240 |
| `INVALID_WORK_TYPE` | 400 | work_type is not code, ops, research or decision-needed |
| `OVERRIDE_REQUIRES_REASON` | 400 | confirm_by_jorge without a reason |
| `PARENT_MUST_BE_INITIATIVE` | 400 | parent_key names a ticket |
| `RESERVED_ACTOR` | 400 | actor.agent is jorge: only the screen writes as Jorge |
| `TEMPLATE_INVALID` | 400 | create_task: a ticket without scope, or a code/ops ticket without checks (detail: missing) |
| `TEXT_HAS_DATE` | 400 | decision text starts with a date: the server stamps dates |
| `TOO_LARGE` | 400 | a text field exceeds its limit (detail: field, max) |
| `VERSION_REQUIRED` | 400 | set_task changes fields without the version you read |
| `HUMAN_ONLY` | 403 | Done, Won't do or reopening them: Jorge's call, on screen or with confirm_by_jorge + reason |
| `CHECK_NOT_FOUND` | 404 | no check with that n on this task |
| `DECISION_NOT_FOUND` | 404 | supersedes names no decision of this project |
| `DOC_NOT_FOUND` | 404 | no doc with that id in the project, or replacing (version given) a title that does not exist |
| `INITIATIVE_NOT_FOUND` | 404 | get_next initiative_key is not an initiative of this project |
| `PROJECT_NOT_FOUND` | 404 | unknown project slug |
| `QUESTION_NOT_FOUND` | 404 | no question with that id in this project |
| `RESULT_NOT_FOUND` | 404 | evidence_id is not a result of this task |
| `TASK_NOT_FOUND` | 404 | unknown key in this project (also an unknown parent_key or task_key) |
| `ALREADY_ANSWERED` | 409 | the question was answered already (detail: answer, answered_by) |
| `ALREADY_SUPERSEDED` | 409 | the decision named in supersedes was already reversed (detail: superseded_by) |
| `CLAIM_HELD` | 409 | another session holds a live lease (detail: owner, lease_until, workspace) |
| `DOC_EXISTS` | 409 | attach_doc without version for a title that exists (detail: doc_id, version): pass version to replace |
| `EVIDENCE_REQUIRED` | 409 | In review without evidence for the work_type from the current claim (detail: accepts, since) |
| `INVALID_TRANSITION` | 409 | the status change is not allowed from the current status (detail: from, to, hint) |
| `KEY_EXISTS` | 409 | create with a key that exists; creates are not idempotent without request_id |
| `LEASE_EXPIRED` | 409 | heartbeat after your lease ran out: claim again |
| `NOT_CLAIMABLE` | 409 | the ticket cannot be claimed (detail: status, or unsatisfied blocked_by) |
| `NOT_OWNER` | 409 | another session holds a live lease on this task (detail: owner, lease_until) |
| `REQUEST_ID_REUSED` | 409 | request_id was already used by a different tool in this project |
| `SEQUENCE_TAKEN` | 409 | the requested sequence value is held by another live ticket |
| `STALE_VERSION` | 409 | the task (or doc) changed since you read it (detail: current_version) |
<!-- errors:end -->

## Hooks

Inbound integrations, JSON with real HTTP status codes, `Authorization: Bearer <PLANIA_CI_TOKEN>`.
`request_id` is required; a redelivery is a no-op. Nothing posts to them yet: Plania listens on localhost.

- `POST /hooks/result` `{project, key, verdict, cite, url?, kind? (ci), pr_url?, branch?, request_id}`: a result as
  actor `ci`, plus the PR link and branch.
- `POST /hooks/env` `{project, env, commit?, branch?, migrations_applied?, commits?, deployed?, request_id}`: `set_env`.

## Export

`GET /export/<slug>.json` downloads a whole project (tasks with checks, results and questions, docs, decisions,
env, reservations, every event). Jorge's session, `MCP_BEARER_TOKEN` or `MCP_READ_TOKEN`; the project page links it.

## Clients

`PLANIA_MCP_TOKEN` is the same value as `MCP_BEARER_TOKEN`. Local URL: `http://localhost:3737/mcp`.
Canonical URL once deployed: `https://plania.vercel.app/mcp`. On this Mac all three clients are already set up for local.

Claude Code, available in every project:

```bash
claude mcp add --scope user --transport http plania http://localhost:3737/mcp --header "Authorization: Bearer ${PLANIA_MCP_TOKEN}"
```

Cursor, in `~/.cursor/mcp.json`:

```json
{"mcpServers":{"plania":{"url":"http://localhost:3737/mcp","headers":{"Authorization":"Bearer ${env:PLANIA_MCP_TOKEN}"}}}}
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.plania]
url = "http://localhost:3737/mcp"
bearer_token_env_var = "PLANIA_MCP_TOKEN"
```

The local configs on this Mac hold the token literally, because apps launched from the Dock do not see shell variables.
For Vercel, swap the URL for the canonical one.

### In a product repo

Add this to the repo's `CLAUDE.md` (or `AGENTS.md`). The rules themselves come from Plania, so they do not drift:

```markdown
## Plan

The plan for this product lives in Plania (MCP server `plania`, project `<slug>`), not in this repo.
Follow the protocol in the Plania server's instructions and the project's rules (`get_project`).
```

## Screen

`http://localhost:3737`, password login. Times show in `PLANIA_TZ`. `/` lists projects with one generated line
(open questions first, then live claims, else what is next). `/p/<slug>` shows, in order:

- Questions agents asked, each answerable with one click or free text (`POST /p/<slug>/questions/<id>/answer`).
- The generated resume per initiative, and the v1 card folded away while it exists.
- Open initiatives and tickets, with who holds each lease (Liberar frees it) and Done on In review tickets
  and open initiatives. Done carries the version shown; if the task moved meanwhile, nothing changes and the page says so.
- Decisions, reversed ones struck through; the latest events.

## Edge cases

- Blockers must be in the same project; a task naming itself is `BLOCKER_NOT_FOUND`. `blocked_by` replaces task and env blockers together.
- `create_task` cannot create a Blocked ticket (it takes no note): `BLOCKED_REQUIRES_NOTE`.
- `set_task` with `parent_key: null` turns a ticket into a standalone spec. Moving a ticket keeps its origin.
- Leaving Blocked clears `blocked_note`. Leaving Done clears `resolved_at`; re-marking Done keeps the first one.
- Any move out of In progress releases the lease, except to Needs Jorge. An answered question returns the ticket
  to its previous status; In progress whose lease ran out meanwhile returns to Ready.
- An expired lease stays on the row until the next write in that project; reads already treat it as free.
- Evidence counts from the current claim: rework after In review needs new results.
- `reserve_sequence` gives one above the highest number reserved, so an explicit `value` can leave a gap.
- Env `contains_commit` matches a sha prefix among the commits reported with `set_env` (Plania does not read git).
  `deployed_after` without a value means the next deploy after the blocker was set.

## Deviations from the handoff

- The handoff says "SDK MCP v2". No 2.x of `@modelcontextprotocol/sdk` is published.
  Plania uses the latest 1.x with `@hono/mcp`, approved by Jorge on 2026-10-06.
- Contract errors listed as HTTP codes are returned inside the MCP tool result,
  because JSON-RPC calls share one HTTP 200 response. Only a missing Bearer is a real HTTP 401.
- **v2 (approved by Jorge on 2026-10-06)** replaces the handoff's single-operator rules: the 12-tool ceiling,
  claims as notes with last write winning, the hand-written resume card, one markdown body per task, text-only
  criteria, and ADRs only in the product repo. `update_resume`, `create_initiative` and `set_initiative` are gone
  (`create_task` and `set_task` cover initiatives; the resume is generated).

## Open

- The cleanup migration (drop `tasks.body`, the `projects.resume_*` card and `design_pages`) waits until the
  v2 backfill is confirmed on the real database.
- Nothing feeds `/hooks/*` yet; GitHub and Vercel cannot reach a localhost server.
- `api/index.ts` only receives `/api/*` on Vercel by default. `/`, `/login`, `/mcp`, `/hooks` and `/export` need
  a rewrite to `/api`, which `vercel.json` does not have.
- `hono/vercel`'s `handle` takes a Web `Request`. On the Node runtime, a bare `export default` may receive
  Node's `req, res` instead. Hono's Node examples export named `GET`/`POST` handlers. Confirm on a preview.
