# Plania

Source of the plan for Jorge and his agents. A generated resume per project on screen, the rest over MCP.
The plan lives here, not in each product repo. v2 (approved 2026-10-06) makes it safe for several agent
sessions at once: leased claims, versioned writes, an event log with who did what, and server time everywhere.

- App: Hono on Node, one long-lived process on this Mac (`scripts/dev.ts`, the launchd service).
- DB: local Postgres, Drizzle over `pg`, one shared pool per process (`src/db/client.ts`).
- Screen: React SPA (Vite, shadcn/ui) in `ui/`, served by the same app; password login (argon2id + `plania_session` cookie).
- Agents: `POST /mcp` with `Authorization: Bearer <token>`: an agent token issued on screen (`/tokens`), or the
  static `MCP_BEARER_TOKEN` / `MCP_READ_TOKEN` from `.env`.
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
| `DATABASE_URL` | Postgres connection string (the local `plania` database) |
| `MCP_BEARER_TOKEN` | Random token, e.g. `openssl rand -hex 32`. Clients use it as `PLANIA_MCP_TOKEN`. |
| `SESSION_SECRET` | At least 32 bytes, e.g. `openssl rand -base64 48` |
| `PLANIA_PASSWORD_HASH` | Output of `pnpm hash-password`. Quote it in `.env`. Never a plain password. |
| `MCP_READ_TOKEN` | Optional. A second token for planning sessions: read tools only. |
| `PLANIA_CI_TOKEN` | Optional. Token for `/hooks/*` only; it cannot use `/mcp`. |
| `PLANIA_TZ` | Optional. Time zone the screen shows times in, and the nightly backup's clock. Default `America/Mexico_City`. |
| `PLANIA_PG_BIN` | Optional. Directory of the `pg_dump` the backup uses. Default: Homebrew's for the server's major version. |
| `PLANIA_BACKUP_DIR` | Optional. Where the nightly dumps go. Default `~/plania-backups`. |

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

### Upgrading to 2.3 (audit, context, handoff)

Migration `0018` adds `audit_runs`, `releases`, `tasks.state_note` / `state_note_at` / `handoff` and `checks.derived_from`.
Nothing to backfill. The audit job starts with the server; `audit(project)` runs it on demand.

### Upgrading to 2.2 (branches, typed blockers, pollers)

Migration `0017` adds `projects.settings`, the typed `blockers` table (the old `env_blockers` rows are copied in),
`branches`, `resources`, `quota_usage`, `pull_requests`, `poll_state`, `project_metrics`, the structured result
columns, env `flags`/`migrations`/`deploy_source`, and the bug and debt fields. Then, per project, set what the
pollers need (`set_project settings`): `github: {repo}`, `vercel: {project_id, team_id?}`, `release_target`,
`branch_pattern` (filmia: `^jl/[a-z0-9][a-z0-9-]*$`), `claim_from`. Put `GITHUB_TOKEN` (a fine-grained PAT with
Pull requests, Contents and Checks read) and `VERCEL_TOKEN` in `.env`; the settings only name the variables.

### Upgrading to 2.1 (keys, approvals, tokens)

Migrations `0015` and `0016` add the key counters and aliases (and set each project's `key_prefix`), agent tokens,
approvals, check waivers, decision retirement, the headline and `events.token_id`; `0016` also copies the old
single `supersedes_id` into `decision_supersessions`. Then move the keys of a
project to the 2.1 scheme once (initiatives `FIL-I1`, phases `FIL-I1-1`, standalone tickets unchanged); every old key
stays as an alias and each rename is a `task.rekeyed` event:

```bash
pnpm rekey --project filmia            # dry run: prints the plan
pnpm rekey --project filmia --apply    # writes it, in one transaction
```

### Upgrading to 2.9 (backups, v1 cleanup)

Migration `0022` adds `machine_state` (the nightly backup's record), copies every non-empty v1 `tasks.body` into a
task doc titled "v1 body", then drops `tasks.body`, the four `projects.resume_*` columns, `design_pages`,
`env_blockers` and `decisions.supersedes_id`. Take a `plania-pre-0022-*` dump first.

Upgrading a v1 database: the backfill that did it (`scripts/backfill-v2.ts`) is in the git history before 2.9.

## Dev

```bash
pnpm dev     # API on 3738 (tsx watch) + Vite on http://localhost:5173 with hot reload
pnpm build   # typecheck server and UI, then build the SPA into dist/ui
pnpm start   # serve API, MCP and the built SPA on http://localhost:3737
pnpm test    # MCP, API, live-event, hooks, seed and backup tests; rebuilds this checkout's local plania_test_<hash> database each run
```

Port 3737 avoids the 3000 that product repos use. The server only listens on 127.0.0.1.
In dev, Vite proxies `/api` and `/mcp` to the dev API on 3738, so the service on 3737 keeps running.

Each checkout and worktree gets its own test database, `plania_test_` plus a six-character hash of the repo's absolute path,
so test runs in different worktrees can run at the same time. Tests only ever drop databases named `plania_test_*`, never `plania`.
Databases from deleted worktrees stay behind. To list and remove them:

```bash
psql -l | grep plania_test_
```

```bash
dropdb plania_test_3f9a2c
```

## Running locally as a service

Plania runs on this Mac.

- Database: local Postgres 14 (Homebrew service), database `plania`.
- Server: launchd agent `com.plania.server` at `~/Library/LaunchAgents/com.plania.server.plist`.
  It starts at login, restarts on crash, and logs to `~/Library/Logs/plania/server.log`.
  It runs nvm's Node by absolute path, so update the plist after switching Node versions.
- Clients, all pointing at `http://localhost:3737/mcp` with the Bearer from `.env`:
  Claude Code (user scope), Cursor (`~/.cursor/mcp.json`), Codex (`~/.codex/config.toml`).

```bash
pnpm build && launchctl kickstart -k gui/$(id -u)/com.plania.server   # deploy code changes locally
launchctl bootout gui/$(id -u)/com.plania.server        # stop and unload
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.plania.server.plist  # load again
tail -f ~/Library/Logs/plania/server.log
```

Backups: the `backup` job dumps the database once a day after 03:00 (`PLANIA_TZ`) into
`~/plania-backups/plania-<YYYYMMDD>.sql.gz` and keeps the last 14; hand-made `plania-pre-*` dumps stay. The Máquina
page shows the last copy, and `BACKUP_STALE` appears there when the last one is older than 48 h. To restore:

```bash
createdb plania_restore && gunzip -c ~/plania-backups/plania-20261016.sql.gz | psql -v ON_ERROR_STOP=1 plania_restore
```

Change the screen password with `pnpm hash-password`, paste the result into `.env` as
`PLANIA_PASSWORD_HASH='...'`, then restart. Rotating `MCP_BEARER_TOKEN` means updating all three client configs.

## MCP

`POST /mcp`, stateless JSON (no sessions, no GET listen stream). Every call needs a Bearer token;
otherwise `401 {"error":"UNAUTHORIZED"}`. The screen cookie is never accepted here.
`MCP_BEARER_TOKEN` sees every tool; `MCP_READ_TOKEN` sees only the read tools.

The working protocol (claim, versions, evidence, closing finished work) is served as the server's `instructions`
on `initialize`, versioned (`PROTOCOL_VERSION` in `src/mcp/protocol.ts`, also in `get_project`). Project-specific
additions are the project's `rules` (`set_project`). Product repos point here instead of copying the rules.

<!-- mcp-tools:start -->
| Read | |
|---|---|
| `get_resume` | Where the project stands, generated from data: live claims (who, until when, where), the next claimable ticket, and per open initiative its in_progress note and claims, next_action note and next_claimable, must_keep (pinned decisions) and status counts. |
| `get_project` | Project title, long body (stack, repo, prod, constraints), rules (project-specific additions to the protocol in the server instructions) with rules_version, protocol_version, headline, settings (release_target, branch_pattern, claim_from, resources, quotas, github, vercel, release), ticket counts, env (per environment: commit, branch, migrations, flags, deployed_at and its source), branches (each with its owner, head and merge state), resources (live leases, today's quotas), metrics, reserved sequence numbers with the ticket holding each, and release: the step settings.release names (from → into), with how far from is ahead, the merged tickets it ships, their migrations, the before-steps, open checks and the command Jorge runs (null without settings.release). |
| `list_tasks` | Initiatives and tickets without scope, with version, claimed_by (live lease owner or null) and updated_at. |
| `get_task` | One initiative or ticket, by its key or any former key (aliases). |
| `get_memory` | Fixed memory: rules, design_docs (project docs, with markdown; view summary lists them without it), and the decision log, newest first (limit default 100, max 500). |
| `get_doc` | One doc by id (from get_task docs, get_memory design_docs, or a decision's adr_doc_id), with its markdown and version. |
| `get_next` | Next claimable ticket: Backlog or Ready, or In progress with an expired lease (stale_claim: true), with every blocker satisfied (tasks In review or Done, env conditions holding). |
| `list_events` | What changed, oldest first: every write is an event with its actor, server time, project and a one-line summary (Spanish). |
| `list_projects` | Every project in one line each: slug, title, key_prefix, headline, line (what is claimed, else the next step, else what is next to claim), ticket counts (open, in_progress, in_review, needs_jorge, blocked, done), open_questions, claims, last_event_id and last_event_at. |
| `get_running` | Every ticket with an owner, across projects, with a derived liveness: live (lease valid, activity in the last 20 min), quiet (lease valid, no heartbeat or event for longer), stale (lease ran out, not yet cleared). |
| `get_digest` | One call for an assistant that keeps Jorge updated: what changed since a cursor, grouped by project with Spanish summaries and highlights (done, to_review, blocked, needs_jorge, prs_opened, prs_merged, claims), what runs now (get_running) and what waits on Jorge (get_inbox all), plus unchanged_projects. |
| `get_inbox` | Everything waiting on Jorge, oldest first per kind, each item with its group: decisiones (pending approvals, open questions), pasos (human actions a task waits on, the project's release) and limpieza (what agents left on the Mac). |
| `audit` | What the server can see is wrong, from data it has: REVIEW_PR_MERGED, DONE_CHECKS_OPEN, MERGED_CHECKS_OPEN, INITIATIVE_CHILDREN_DONE, INITIATIVE_STATE_NOTE_STALE, DECISION_STALE_REF, DECISION_CONTRADICTS_DONE, ENV_DEPLOYED_AT_MISSING, ENV_DRIFT, BLOCKED_BUT_SATISFIED, CLAIMABLE_BUT_GATED, CLAIM_EXPIRED_WITH_COMMITS, BRANCH_MERGED_NOT_DELETED, BRANCH_WITHOUT_TICKET, TASK_MISSING_PR_URL, WAITING_ON_JORGE_FREE_TEXT, OVERDUE, and the footprint codes. |
| `get_context` | One call for a session opening a worktree: from workspace {branch, worktree_path, machine} (and your session_id) it returns the initiative on that branch, the tickets on it, your live claims (with any handoff note), the pinned decisions that apply, open questions and pending approvals on those tickets, the footprint they have on the Mac (footprint) and what your session registered (my_footprint), and the events since since_cursor that touch them. |

| Write | |
|---|---|
| `create_task` | Create a ticket (default) or, with kind initiative, a parent initiative. |
| `set_task` | Update a ticket or an initiative. |
| `set_check` | Tick (or untick) one Done when item by its n, amend its text, or lift a waiver. |
| `add_result` | Record evidence on a task: kind, verdict pass\|warn\|fail, cite (what ran and what it showed), url (CI run, screenshot, recording), and the structured fields: commit, branch, env, command, exit_code, counts, duration_s, attachments, viewport, device, metrics. |
| `attach_doc` | Store a markdown doc in Plania so every machine can read it: a spec or plan on a task (key), or a project doc such as a design page (no key). |
| `claim` | Lease a ticket so no other session works on it. |
| `add_decision` | Append one decision to the log. |
| `reserve_sequence` | Reserve the next number of a per-project sequence (e.g. name 'migration' gives '0009') for a ticket, so two initiatives never take the same one. |
| `ask` | Ask Jorge a question about a task, in Plania rather than only in your chat, so any session can see it and its answer. |
| `answer` | Record Jorge's answer to a question (he answers on screen, or tells you in chat and you record it here, quoting him). |
| `set_project` | Edit the project's title, body (stack, repo, prod, constraints), rules (project-specific additions to the protocol) or headline. |
| `set_env` | Record what an environment runs, as data other sessions can check: commit and branch deployed, migrations (the tags applied, e.g. ['0009_x']; migrations_applied is derived), flags (configuration state, never secret values: {google_oauth: false, omdb_key: 'valid'}; null removes one). |
| `request_approval` | Ask Jorge to approve one move you cannot make yourself: action wont_do \| reopen (a status change), waive_check (target {n}, once In review or later), runbook_step, lease_resource. |
| `waive_check` | Mark one Done when item as not going to be done, with the reason (it then counts as closed for In review and Done). |
| `retire_decision` | Retire a decision that no longer holds and has no replacement (to replace one, add_decision with supersedes). |
| `handoff` | Hand your claim to another session (its session_id) or to anyone ('open'), with a note: what is done, what is next, the branch head (head_sha). |
| `set_metric` | Report a measured value (e.g. pickevent_nights 31) for metric_gte blockers; a result's metrics field does the same. |
| `lease_resource` | Hold a shared thing for a while so no other session uses it: a dev port (port:3001, scoped to your machine automatically), the production migrate step (neon-prod:migrate), anything by name. |
| `release_resource` | Give a leased resource back. |
| `register_footprint` | Declare something you started that outlives the command: a dev server, a database or a copy of one, a container, a service, a tunnel, a worktree. |
| `release_footprint` | Say a registered footprint is torn down; it leaves the Machine inventory. |
| `consume` | Count n (default 1) against a daily quota from settings.quotas (e.g. quota:omdb with daily 1000). |
| `batch` | Several writes in one call: ops of create_task, set_task, set_check, add_result, add_decision or note ({op: 'note', key, text}), each with the fields of its tool (project, actor and request_id come from the batch). |
<!-- mcp-tools:end -->

Rules every write follows:

- **Keys.** The server assigns them (omit `key`): `PREFIX-I<n>` for an initiative, `PREFIX-<nn>` for a standalone ticket,
  `<initiative>-<n>` for a phase (`phase` stays a field). One counter per scope, bumped under the project lock, so
  concurrent creates never collide and a number is never reissued. An explicit key is accepted for imports: when it fits
  its scope's pattern it must be at or above the counter (`KEY_BELOW_COUNTER`); otherwise it only warns. Moving a ticket
  (`set_task parent_key`) gives it a key under its new parent and keeps the old one as an alias; every tool accepts
  aliases, answers with the canonical key (`aliases` lists the old ones) and logs the canonical key.
- **Replies.** Writes answer `{key, status, version, changed}` plus the id they made (`result`, `decision`, `question`,
  `claim`); `verbose: true` adds `task`, the full shape without the log. Reads: `get_task view summary` for the cheap
  read, `fields` to pick keys, `list_events {key, since}` for the log. Every task reference carries `kind` and `parent_key`.
- **Batch.** `batch {ops[], atomic}` runs several writes in one transaction; the first failure is `BATCH_FAILED
  {index, op, failed}` and nothing is written. `atomic: false` commits op by op, failures inline, and a retry with the
  same `request_id` replays the ops that went through. An op on a key an earlier op changed may omit `version`.
- **Branches.** An initiative's `integration_branch` (its `branch`) is registered to it; its phases claim on it by
  default. Another live initiative setting the same branch is `BRANCH_IN_USE` unless it passes `share_branch` with a
  `share_reason`; a ticket on a branch its initiative does not own or share is refused too. Names must match the
  project's `settings.branch_pattern` (`BRANCH_NAME_INVALID`). The GitHub poller fills heads, merges and deletions.
- **Blockers.** Besides tickets and env conditions, `blocked_by` takes `{human_action: {text}}` (Jorge's inbox),
  `{env_flag: {env, flag, equals}}`, `{time_after: ISO}` and `{metric_gte: {name, value}}`. `get_next` never offers a
  ticket with an unsatisfied blocker (and only Ready ones when `settings.claim_from` is `ready`); when every blocker of
  a Blocked ticket holds, the server moves it to Ready (`blocker.satisfied`).
- **Evidence.** Results carry what ran, where and against which commit. A pass whose commit is no longer the branch
  head is `stale_for_head`; In review then needs a fresh pass (`EVIDENCE_STALE`).
- **Merged and Released.** The pollers move In review → Merged when the PR merges and Merged → Released when the
  `settings.release_target` environment runs a commit containing the merge; by hand they need a ci pass naming the
  merge commit. Agents close them: Done is theirs once the work is finished (see States).
- **Environments.** `deployed` takes the provider's record; `flags` hold configuration state and refuse anything
  that looks like a secret (`SECRET_LIKE_VALUE`); `migrations` is the list of tags applied.
- **Resources.** `lease_resource` holds a name (a port gets `@machine`); `RESOURCE_HELD` names the holder. Policies in
  `settings.resources` may require an approval; `settings.quotas` give `consume` a daily budget (`QUOTA_EXCEEDED`).
- **Handoffs.** `handoff {to, note, head_sha}` ends your lease and holds the ticket for the receiver for ten minutes
  (`HANDOFF_HELD` for anyone else); the receiver's `claim` reply carries the note, and `get_task.workspace_history`
  lists every workspace the ticket has used.
- **State notes.** `scope` is the spec; `state_note` (initiatives) says where things stand and is flagged `stale` once
  a ticket moves after it. A status heading inside `scope` only warns.
- **Derived checks.** An initiative check with `derived_from: <ticket key>` ticks itself when that ticket is Done, and
  `set_check evidence_id` accepts any result of the project (the reply names its `source`).
- **Audit.** `audit` finds, from data: tickets in review whose PR merged, Done with open checks, initiatives closed with
  open tickets, stale state notes, decisions citing commits or PRs the release target has moved past, environments
  without a deploy time, drift, Blocked tickets whose blockers hold, gated scopes without a typed blocker, expired
  claims with commits, merged branches still on origin, branches without a ticket, missing PRs.
- **Releases.** When a ticket reaches Released, the deploy's record collects it (`get_project.releases`: env, commit,
  deployed_at and source, tickets, PRs, migrations new since the previous release).
- **Bugs and debt.** `work_type: bug` needs a `severity` (S1–S4) and may carry `found_in`, `introduced_by`,
  `regression`; `debt` carries `cost_note`. S1 and S2 bugs show in the status block.
- **Actor.** `actor: {agent?, session_id, machine?, model?}` lands in the event log; `session_id` owns leases.
  An agent token fills `agent` and `machine` and refuses values that disagree (`ACTOR_MISMATCH`); with a static token
  `agent` is required (`ACTOR_REQUIRED`). `jorge` is reserved for the screen. Every event records `token_id`.
- **Tokens.** Issued on screen at `/tokens`, shown once, stored hashed: name, agent, machine and scopes `read`
  (read tools), `write` (every write but ops), `ops` (`set_env`, `reserve_sequence`). Revoking one stops its next call.
  The static `.env` tokens keep working, unbound.
- **Approvals.** Won't do and reopening a closed task are Jorge's. An agent asks with `request_approval` (also for a waiver
  once In review, a runbook step or a gated resource); Jorge grants or rejects in the inbox, one event per decision;
  the granted `approval_id` unlocks exactly one move (`APPROVAL_MISMATCH`, `APPROVAL_NOT_GRANTED`, `APPROVAL_USED`)
  and expires after 7 days. `confirm_by_jorge` is gone. Jorge's own moves on screen need no approval.
- **Checks.** Entering In review, Merged, Released or Done needs every check done or waived (`CHECKS_OPEN` lists the
  numbers), Jorge included; an initiative needs every ticket closed (`INITIATIVE_CHILDREN_OPEN`).
- **Headline.** One line (≤ 280 chars) on where the project stands, written with `set_project` or on screen and
  versioned; the server marks it `stale` when an env changes, an initiative moves or a ticket reaches Done after it.
- **Events.** Every write records one or more events in the same transaction; `get_task.log` and
  `list_events` read them. Writes are serialized per project, so a `list_events` cursor never skips one.
- **Time.** Every timestamp is ISO-8601 UTC from the server. Agents never type dates.
- **Versions.** `set_task`, `set_project` and doc replaces carry the version read; a mismatch is `STALE_VERSION`.
  Appends (notes, results, checks, questions) need none.
- **Leases.** `claim` is the only way into In progress. While a session holds a live lease, other sessions
  may add notes and results but not change the task (`NOT_OWNER`). An expired lease is free; the next write in
  the project releases it (`claim.expired`, In progress → Ready).
- **States.** Tickets: Backlog ⇄ Ready → (claim) In progress → In review → Merged → Released; Blocked (with a note)
  from any open state; Needs Jorge through `ask` only. Initiatives: Planning ⇄ Active ⇄ Shipping, any ⇄ On hold.
  Done is the agents' once the work is finished: code, bug and debt tickets from Merged or Released; ops and research
  from In review on; decision-needed once answered (Backlog, Ready or In progress); an initiative from any open
  status once its tickets are closed. Elsewhere it is `INVALID_TRANSITION` with `allowed_from`. Won't do and reopening
  are Jorge's: on screen, or with an approval he granted.
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
| `ACTOR_REQUIRED` | 400 | actor.agent is missing and no agent token identifies the caller |
| `BLOCKED_REQUIRES_NOTE` | 400 | status Blocked without a note (create_task cannot block: it takes no note) |
| `BLOCKER_NOT_FOUND` | 400 | a blocked_by key does not exist in this project, or names the task itself |
| `BODY_REMOVED` | 400 | body is gone in v2: use scope, checks, and note (the log) |
| `BRANCH_NAME_INVALID` | 400 | the branch name does not match the project's branch_pattern (detail: pattern) |
| `DEPLOY_SOURCE_REQUIRED` | 400 | set_env deployed needs a source {provider, deployment_id, url}: the server stores where the time came from |
| `FIELD_NOT_ALLOWED` | 400 | a field of the other kind: priority/parent_key/origin/work_type/phase on an initiative, base_branch/next_action/in_progress_note on a ticket |
| `INVALID_APPROVAL` | 400 | request_approval action is not wont_do, reopen, waive_check, runbook_step or lease_resource |
| `INVALID_BATCH_OP` | 400 | batch: an op is not set_task, set_check, add_result, add_decision, create_task or note |
| `INVALID_BLOCKER` | 400 | a blocked_by entry is malformed (detail: type, hint): human_action {assignee, text}, env_flag {env, flag, equals}, time_after {at}, metric_gte {name, value} |
| `INVALID_ENV` | 400 | set_env: env is not lowercase [a-z][a-z0-9_-]*, a commit is not 7-40 hex, or migrations_applied is not a count |
| `INVALID_ENV_CONDITION` | 400 | an env blocker's condition or value is wrong (contains_commit <sha>, migration_gte <n>, deployed_after [ISO]) |
| `INVALID_FILTER` | 400 | a list filter is malformed (detail: field), e.g. updated_since is not an ISO-8601 time |
| `INVALID_FOOTPRINT` | 400 | register_footprint / release_footprint: unknown kind, a locator that does not fit its kind, an empty purpose or teardown, or no actor.machine (detail: field, hint) |
| `INVALID_METRIC` | 400 | set_metric name is not lowercase [a-z][a-z0-9_-]*, or value is not an integer |
| `INVALID_PHASE` | 400 | phase is not an integer 0..999 |
| `INVALID_PRIORITY` | 400 | priority is not P0, P1, P2 or P3 |
| `INVALID_QUESTION` | 400 | ask with an empty question, or answer with an empty answer |
| `INVALID_RESOURCE` | 400 | lease_resource / consume: bad name, ttl, amount, or an unknown quota (detail: field) |
| `INVALID_RESULT` | 400 | add_result kind, verdict or cite is not valid, or check_ns with a verdict other than pass |
| `INVALID_SEQUENCE` | 400 | sequence name is not lowercase [a-z][a-z0-9_-]*, or a number is out of range |
| `INVALID_SEVERITY` | 400 | a bug needs severity S1, S2, S3 or S4; found_in, introduced_by, regression and cost_note belong to bugs and debt |
| `INVALID_STATUS` | 400 | status is not in the task kind's vocabulary, or not allowed at creation |
| `INVALID_TTL` | 400 | ttl_minutes outside 5..240 |
| `INVALID_WORK_TYPE` | 400 | work_type is not code, ops, research, decision-needed, bug or debt |
| `PARENT_MUST_BE_INITIATIVE` | 400 | parent_key names a ticket |
| `RESERVED_ACTOR` | 400 | actor.agent is jorge: only the screen writes as Jorge |
| `SECRET_LIKE_VALUE` | 400 | an env flag looks like a secret (a key name, a token prefix, or 20+ random characters); flags record whether something is configured, never the value |
| `TEMPLATE_INVALID` | 400 | create_task: a ticket without scope, or a code/ops ticket without checks (detail: missing) |
| `TEXT_HAS_DATE` | 400 | decision text starts with a date: the server stamps dates |
| `TOO_LARGE` | 400 | a text field exceeds its limit (detail: field, max) |
| `VERSION_REQUIRED` | 400 | set_task changes fields without the version you read |
| `ACTOR_MISMATCH` | 403 | actor.agent or actor.machine disagrees with the agent token's (detail: expected) |
| `APPROVAL_MISMATCH` | 403 | the approval_id is for another task, action or target (detail: expected) |
| `APPROVAL_REQUIRED` | 403 | this needs an approval_id: request_approval first (detail: action, target) |
| `HUMAN_ONLY` | 403 | Won't do or reopening a closed task: Jorge's call, on screen or with an approval_id he granted (request_approval) |
| `APPROVAL_NOT_FOUND` | 404 | no approval with that id in this project |
| `CHECK_NOT_FOUND` | 404 | no check with that n on this task |
| `DECISION_NOT_FOUND` | 404 | supersedes names no decision of this project |
| `DOC_NOT_FOUND` | 404 | no doc with that id in the project, or replacing (version given) a title that does not exist |
| `INITIATIVE_NOT_FOUND` | 404 | get_next initiative_key is not an initiative of this project |
| `PROJECT_NOT_FOUND` | 404 | unknown project slug |
| `QUESTION_NOT_FOUND` | 404 | no question with that id in this project |
| `RESULT_NOT_FOUND` | 404 | evidence_id is not a result of this project |
| `TASK_NOT_FOUND` | 404 | unknown key in this project (also an unknown parent_key or task_key) |
| `UNKNOWN_BRANCH` | 404 | get_context: no initiative or ticket is on that branch (detail: known) |
| `ALREADY_ANSWERED` | 409 | the question was answered already (detail: answer, answered_by) |
| `ALREADY_SUPERSEDED` | 409 | the decision named in supersedes was already reversed (detail: superseded_by) |
| `APPROVAL_NOT_GRANTED` | 409 | the approval is pending, rejected or expired (detail: state) |
| `APPROVAL_USED` | 409 | the approval already unlocked one move (detail: used_at) |
| `BATCH_FAILED` | 409 | an atomic batch rolled back because one op failed (detail: index, op, failed: {error, status, ...}) |
| `BLOCKER_NOT_WITHDRAWABLE` | 409 | set_task withdraw_blocker: not a pending blocker parsed from a note on this task, or another session's note (detail: reason) |
| `BRANCH_IN_USE` | 409 | the branch belongs to another live initiative (detail: owner_key); pass share_branch: true with a reason to share it |
| `CHECKS_OPEN` | 409 | In review, Merged, Released or Done while a check is neither done nor waived (detail: open, the check numbers) |
| `CLAIM_HELD` | 409 | another session holds a live lease (detail: owner, lease_until, workspace) |
| `DECISION_RETIRED` | 409 | the decision was retired: it cannot be superseded, pinned or retired again |
| `DOC_EXISTS` | 409 | attach_doc without version for a title that exists (detail: doc_id, version): pass version to replace |
| `EVIDENCE_REQUIRED` | 409 | In review without evidence for the work_type from the current claim (detail: accepts, since) |
| `EVIDENCE_STALE` | 409 | In review needs a pass recorded against the branch's current head; the passes found are for older commits (detail: head, results) |
| `FOOTPRINT_HELD` | 409 | another live session declared this footprint, or releasing one you did not declare (detail: holder, purpose) |
| `HANDOFF_HELD` | 409 | the ticket was handed to another session; the hold lasts ten minutes (detail: to, until, note) |
| `INITIATIVE_CHILDREN_OPEN` | 409 | an initiative cannot be Done or Won't do while a ticket of it is in another state (detail: open) |
| `INVALID_TRANSITION` | 409 | the status change is not allowed from the current status (detail: from, to, hint) |
| `KEY_BELOW_COUNTER` | 409 | an explicit key with a number already issued for that scope (detail: next); omit key to get the next one |
| `KEY_EXISTS` | 409 | create with a key that exists (or is an alias of one); creates are not idempotent without request_id |
| `LEASE_EXPIRED` | 409 | heartbeat after your lease ran out: claim again |
| `NOT_CLAIMABLE` | 409 | the ticket cannot be claimed (detail: status, or unsatisfied blocked_by) |
| `NOT_OWNER` | 409 | another session holds a live lease on this task (detail: owner, lease_until) |
| `QUOTA_EXCEEDED` | 409 | consume would pass the daily quota (detail: limit, used, remaining) |
| `REQUEST_ID_REUSED` | 409 | request_id was already used by a different tool in this project |
| `RESOURCE_HELD` | 409 | another session holds the resource (detail: holder, lease_until, purpose) |
| `SEQUENCE_TAKEN` | 409 | the requested sequence value is held by another live ticket |
| `STALE_VERSION` | 409 | the task (or doc) changed since you read it (detail: current_version) |
<!-- errors:end -->

## Hooks

Inbound integrations, JSON with real HTTP status codes, `Authorization: Bearer <PLANIA_CI_TOKEN>`.
`request_id` is required; a redelivery is a no-op. Nothing posts to them yet: Plania listens on localhost.

- `POST /hooks/result` `{project, key, verdict, cite, url?, kind? (ci), pr_url?, branch?, request_id}`: a result as
  actor `ci`, plus the PR link and branch. Answers the write reply with `result` and the full `task`.
- `POST /hooks/env` `{project, env, commit?, branch?, migrations?, flags?, commits?, deployed?: {provider, deployment_id, url}, request_id}`: `set_env`.
- `POST /hooks/metric` `{project, name, value, request_id}`: `set_metric`.
- `GET /mcp/events?project=&since=<cursor>&key=&types=`: the change feed as server-sent events for agents (any read
  token): replays from the cursor, then streams; each message's id is the next cursor.

## Export

`GET /api/export/<slug>.json` downloads a whole project (tasks with checks, results and questions, docs, decisions,
env, reservations, every event). Jorge's session, `MCP_BEARER_TOKEN` or `MCP_READ_TOKEN`; the project page links it.

## Clients

`PLANIA_MCP_TOKEN` is the same value as `MCP_BEARER_TOKEN`. Local URL: `http://localhost:3737/mcp`.
On this Mac all three clients are already set up.

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

### In a product repo

Add this to the repo's `CLAUDE.md` (or `AGENTS.md`). The rules themselves come from Plania, so they do not drift:

```markdown
## Plan

The plan for this product lives in Plania (MCP server `plania`, project `<slug>`), not in this repo.
Follow the protocol in the Plania server's instructions and the project's rules (`get_project`).
```

## Screen

`http://localhost:3737`, password login. React 19, Tailwind 4 and shadcn/ui. Dark ("Noche") by default, with light and
system themes. Times arrive as UTC and show in the browser's local time.

- **Lanes, not steps.** Each open initiative is a lane, plus "Sueltos" for tickets without one. Every lane has the
  same five columns: Hecho (Done), En revisión (In review, Merged, Released: one PR per initiative, so phases wait
  on its branch), En curso (In progress, Needs Jorge, and Blocked by anything but tickets), Siguiente (Ready, then
  Blocked tickets that only wait on other tickets, shown as "espera F1 · F3"; or else the top Backlog ticket) and
  Después (the rest of the Backlog). A column empty in every lane narrows to a strip. Only lanes with work in motion
  pulse. Task rows carry `waits_on` (unsettled ticket blockers) and `held` (any other open blocker) for this. The
  rules live in `ui/src/lib/lanes.ts` and are tested in `test/lanes.test.ts`.
- `/` shows one track per project: progress, then an Ahora → Siguiente row per lane, and how many questions wait
  for Jorge. Past four initiatives, lanes still for a week fold behind "Ver todas". Projects without initiatives
  show their generated line. A "Te toca a ti" strip lists Needs Jorge tickets across projects.
- `/inbox` lists everything waiting on Jorge: approvals (grant or reject several at once, one event each) and open
  questions. The header shows the count. `/tokens` issues and revokes agent tokens.
- `/p/<slug>` shows the headline first (editable, "desactualizado" when the server marked it stale), then, in order: questions agents asked (answer with one click or free text, with an optional line for
  the decision log); the lane grid; each initiative's line of stations; a branch graph built from initiatives' `branch`
  and `base_branch`; and the pinned decisions. "Ver la ficha completa" opens the generated resume per initiative
  (claims, next, pinned decisions) and the decision log, reversed ones
  struck through. A link downloads the project as JSON.
- `?view=lista` switches to the list grouped by initiative, with status and priority filters and a toggle for
  closed items. Rows show codes only for initiatives; the side panel header still shows a ticket's key.
- Status and priority change from menus on each row, as Jorge: any move is allowed, Done included, and leases do
  not stop him. Each change carries the version on screen; if an agent changed the task meanwhile, nothing is
  overwritten and a toast says so. Blocked asks for its note. Every change offers Undo for 8 seconds.
- A ticket with a live lease shows who holds it and until when; Liberar frees it.
- Clicking any ticket opens a side panel: scope (Markdown), Done when checks, evidence, docs, questions,
  blockers (tasks and env conditions, each satisfied or not), branch, worktree, PR and its history. The open task is in
  the URL (`?task=MIC-01-F2`), so it can be linked; Back and Escape close it.
- **Live:** writes from agents, CI or the screen appear within a second. A ticket that changed column glides to
  its new place and glows briefly. The header shows "En vivo" while the event stream is connected. Animations
  stop under the system's reduced-motion setting.

### On the phone

The screen works at phone width (from 320 px) and installs as a home-screen app. Below `sm` the header keeps the
mark, Bandeja and the live dot, and folds Tokens, Tema and Salir into a "⋯" menu. Wide tables become stacked rows, and
buttons grow to touch size on coarse pointers only, so the desktop layout does not change. The page pads for the notch
and the home indicator (`viewport-fit=cover` and `env(safe-area-inset-*)`, with the `gutter` utility for side padding).

- **Icons and manifest** live in `ui/public/`. Vite copies them to `dist/ui`, and `scripts/dev.ts` serves them before the
  SPA fallback. `manifest.webmanifest` and `sw.js` are sent with `no-cache` and the icons for a day. The
  `theme-color` follows the theme toggle, so the status bar matches Claro or Oscuro.
- **Offline:** the build writes `dist/ui/sw.js` from `ui/sw.js` with the list of hashed files (the plugin is in
  `vite.config.ts`). It precaches the app shell, so the app still opens without a network and shows "Sin conexión".
  It retries when the network returns. Pages load network-first, so an online open always gets the latest build.
  `/api`, `/mcp`, `/hooks` and `/health` never go through it, so data and the live stream are never cached. The live
  stream reopens when the app returns to the foreground.
- **Install:** iOS Safari → Compartir → Agregar a inicio. Android Chrome → menu → Instalar app.
- **Reaching it from the phone is still open.** The server listens on 127.0.0.1 only. Service workers, Android's
  install and the `secure` session cookie all need HTTPS, so the likely route is `tailscale serve` in front of :3737.
  Plain HTTP on the LAN would not keep the login. A home-screen app on iOS keeps its own cookies, so you sign in
  once inside it.

How live updates flow: every write runs in `writeTx` (`src/mcp/tx.ts`), which after commit publishes one change per
task it touched on the in-process bus in `src/events.ts`. `GET /api/events` streams those as server-sent events, and
the UI refetches what changed.

### JSON API (cookie only)

| Route | Purpose |
|---|---|
| `POST /api/login`, `POST /api/logout`, `GET /api/session` | Session |
| `GET /api/projects` | Projects with their generated line, open question count, and all tasks without scope |
| `GET /api/projects/:slug` | Generated resume, decisions, and all tasks without scope (with version, lease, `branch`, `base_branch`, `waits_on` and `held`) |
| `GET /api/projects/:slug/tasks/:key` | One task, in the `get_task` shape |
| `PATCH /api/projects/:slug` | `{ headline, version }` |
| `PATCH /api/projects/:slug/tasks/:key` | `{ status?, priority?, note?, version }`, as Jorge through `set_task` |
| `POST /api/projects/:slug/tasks/:key/checks/:n/waive` | `{ reason }` |
| `GET /api/machine` | What runs and is stored on this Mac for agent work: `{ machine, totals, items }`, every unreleased footprint with its project, initiative, ticket, session and any port lease; read-only |
| `GET /api/inbox?project=` | Everything waiting on Jorge; `POST /api/approvals/decide` `{ ids, decision, note? }` grants or rejects, one event each |
| `GET /api/tokens`, `POST /api/tokens`, `DELETE /api/tokens/:id` | Agent tokens (the secret is in the create response only) |
| `POST /api/projects/:slug/tasks/:key/release` | Free a lease |
| `POST /api/projects/:slug/questions/:id/answer` | `{ answer, decision_text? }` |
| `GET /api/export/:slug.json` | The whole project (also with an MCP token, rw or ro) |
| `GET /api/events` | Server-sent change events |

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

- **UI v2, decided by Jorge on 2026-10-07:** the screen is a React SPA with shadcn/ui instead of server-rendered HTML,
  and it changes status and priority inline. That adds a cookie-only JSON API under `/api` and a server-sent event
  stream, which the handoff did not have. Counts are still not on screen.

## Open

- GitHub and Vercel cannot reach a localhost server, so Plania polls them (`src/jobs/github.ts`, `src/jobs/vercel.ts`,
  every minute, with ETags): pull requests linked by `pr_url`, a `Plania: KEY` line in the body or a `Plania-Task: KEY`
  trailer; check runs as `ci` results (a red one sends an In review ticket back to Ready); merges → Merged; branch heads
  and deletions; READY deployments → `set_env` with Vercel's time and id → Released. `/hooks/*` stays for a CI that can
  reach the server.
- Background jobs run inside `pnpm start` (`src/jobs/`): the two pollers, lease warnings (`claim.expiring`, five minutes
  before a lease ends), `time_after` blockers, the audit (every ten minutes), the machine footprint and the nightly backup.
  `PLANIA_JOBS=0` turns them off (tests, `pnpm dev:api`).
- Not built from the Filmia requests: test plans and QA runs as tables (R-18: use a "Test plan" doc and `qa_run`-style
  results), runbooks with approval steps (R-23), rule proposals (R-26), and shared rules across projects (R-27).
  The v1 data cleanup (R-32) shipped in 2.9.
