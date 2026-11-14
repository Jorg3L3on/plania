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
```

Then add your own projects, and give each one its team (product owner, Research, Artist, Taller):

```bash
pnpm project:add <slug> --title "<Title>" --prefix <PFX> [--repo owner/name] [--path /abs/repo]
pnpm tsx --env-file=.env scripts/seed-org.ts
```

`--path` is the repo on this Mac (default `PLANIA_PROJECTS_ROOT/<slug>`, else `~/Developer/Projects/<slug>`).
`--repo` is its GitHub `owner/name`. Both are safe to rerun.

`pnpm seed` is the original owner's setup: it loads their day-one projects `micasa`, `workia`, `filmia`, `zigzag`.
Skip it on a new install. It is safe to rerun:

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
`branch_pattern` (filmia: `^jl/[a-z0-9][a-z0-9-]*$`), `claim_from`. `GITHUB_TOKEN` in `.env` still wins when it is
set; otherwise the poller reads `~/.config/plania/github-token` (one line, mode `0600`, see GitHub token file). Put `VERCEL_TOKEN`
in `.env`. The settings only name the variables.

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

### Upgrading to 2.11 (derived truth)

Migration `0024` (there is no `0023`: 2.10 needed none) renames `projects.headline`, `headline_version`,
`headline_at` and `headline_stale` to `headline_note*`, data kept: the headline is generated now and what
`set_project headline` writes is its note. Take a `plania-pre-0024-*` dump first. The 2.11 server reads only the new
names and the old one only the old, so apply the migration right before the restart.

### Upgrading to 2.12 (intent and the day)

Migration `0025` adds `push_subscriptions`; nothing else changes shape (Jorge's requests reuse `tasks.origin` with the
new value `jorge`). Take a `plania-pre-0025-*` dump first. The 2.12 server's push job and `/api/push/*` read the table,
so apply it before the restart. Push also needs the VAPID trio in `.env` (`pnpm vapid` prints a pair); without it push
stays off and everything else works. Phone access over Tailscale and turning push on: [docs/phone-access.md](docs/phone-access.md).

### Upgrading to 2.13 (agent surface)

No migration. `pnpm build`, then restart the service; agents get the `start` / `finish` tools on their
next `initialize`. That release served protocol 2.12. PLA-I8-3 moved the protocol to 2.13: those questions were answered only on the screen (that step was removed in 2.17). Shipping a release from the screen is off until a project asks for it: add `mode: "merge"` to its
`settings.release` (on screen or `set_project settings {release: {from, into, env, mode: "merge"}}`) and keep
`settings.github.repo` set. The merge runs `gh` with `GH_TOKEN` from `~/.config/plania/github-release-token`, or from
`~/.config/plania/github-token` when that file has no token. The token needs write access to the repo. Without `mode`
the release row keeps the command to copy.

### Upgrading to 2.14 (screen click)

Migration `0028` drops `gate_challenges` and deletes the `machine_state` row the old screen step stored. Take a dump first. Apply `0028`, `pnpm build`, then restart `com.plania.server`. The protocol moved to 2.14: human-only questions were answered by a click on the owner's screen (that step was removed in 2.17).

### Upgrading to 2.15 (delegated answers)

Migration `0029` adds `delegated_answers`. Take a dump first. Apply `0029`, `pnpm build`, then restart `com.plania.server`. The protocol moves to 2.15. The kill switch defaults on. It is the `machine_state` key `delegation` (`{enabled: true|false}`). The screen toggles it. Nothing else can.

### Upgrading to 2.16 (readiness)

No migration and no schema change. `pnpm build`, then restart the service. `get_resume`, `list_projects`, `get_digest` and `GET /api/projects` gain `readiness` (`state`, `reasons`, `line`). Existing fields keep their shape. The protocol moves to 2.16.

### Upgrading to 2.17 (stage docs only)

The old screen step is gone (PLA-I18). An idea moves idea → research → design → planning → ready by `set_task stage` alone; the only check left is the stage doc and its headings (`STAGE_REQUIREMENTS_MISSING`). A promoted initiative goes Active like any other. `ask` that still sends the removed field ignores it and the reply includes a hint, so a bot still on 2.16 stores the question. `GATE_NOT_PASSED`, `GATE_OPEN`, `GATE_ANSWERED_BY_AGENT` and `STAGE_DOC_STALE` no longer exist; `GATE_ANSWERED_DELEGATED` is now `DELEGATED_ANSWER`. The Bandeja has no section for that old step.

Old question rows stay as read-only history: the letter column, its check constraint and every `delegated_answers` row are kept, and nothing is dropped. Migration `0030_close_gates` (PLA-I18-5) closes the rows of that kind that are still open:

1. Take a dump first: `pg_dump --no-owner "$DATABASE_URL" | gzip > ~/plania-backups/plania-pre-0030-$(date +%Y%m%d).sql.gz`.
2. Apply `drizzle/migrations/0030_close_gates.sql` (`psql "$DATABASE_URL" -f …`). It only updates those open rows and is safe to run twice.
3. `pnpm build`, then restart `com.plania.server`.

Until `0030` runs, an open old row stays out of the inbox and can only be closed on the screen; it moves nothing. The protocol moves to 2.17.

### Upgrading to 2.18 (direct moves)

Migration `0032_drop_gates_approvals` copies old approval rows and lettered questions into events, then drops the approval table, the letter column and its check. Take a dump first. The protocol moves to 2.18.

`request_approval` is gone. Won't do and reopening a closed task are a direct `set_task`: a `reason`, and an agent also sends `delegated_by_jorge` `{message_id, quote}` (the same evidence as `answer_delegated`). The screen session needs only the reason. The move is logged (`task.delegated_move`) and, when an agent sent a quote, listed in the inbox delegated list. `waive_check` takes the reason alone, at every status. `lease_resource` ignores `needs_approval`. An `approval_id` on those calls is accepted and ignored, and the reply includes a hint, for one release. A Won't do with no screen actor, no delegated evidence and no archived granted row is the audit finding `WONT_DO_WITHOUT_EVIDENCE`.

1. Take a dump first: `pg_dump --no-owner "$DATABASE_URL" | gzip > ~/plania-backups/plania-pre-0032-$(date +%Y%m%d).sql.gz`.
2. Apply `drizzle/migrations/0032_drop_gates_approvals.sql` (`psql "$DATABASE_URL" -f …`). It copies those rows into `approval.archived` and `question.archived`, then drops them. A second run copies nothing and drops nothing.
3. `pnpm build`, then restart `com.plania.server`.

### GitHub token file

No migration. `pnpm build`, then restart the service (`launchctl kickstart -k gui/$(id -u)/com.plania.server`).

The GitHub poller used to run `gh auth token`, which reads the login keychain through `security`. With the keychain locked that call hit its timeout and left `security` waiting on the dialog, and every cache expiry started another. The poller now takes the token in this order: the env var named by `settings.github.token_env` (default `GITHUB_TOKEN`; that variable still wins), then `~/.config/plania/github-token` (`PLANIA_GITHUB_TOKEN_FILE` overrides the path). The file is one trimmed line. Empty or more than one line counts as no token. The poller stats the file on every tick and re-reads it when the mtime or size changes. A mode that lets the group or others read it still works; the log gets one note per mtime and never the token. With no token it does not call GitHub and does not spawn anything, and `poll_state.error` is `no token: GITHUB_TOKEN unset, ~/.config/plania/github-token missing or empty`.

`gh auth token` runs only when `PLANIA_GH_FALLBACK=1`, detached in its own process group, with a 5 second timeout that kills the group. A token is cached for 10 minutes; a failure is not retried for an hour. That attempt, and the hour it is remembered, keeps the missing-file text and adds that `gh auth token` failed (`timeout`, `missing`, `exit`, or `empty`).

Lanzar (`settings.release.mode` `merge`) uses the same helper (60 seconds) and sets `GH_TOKEN` from `~/.config/plania/github-release-token`, else `~/.config/plania/github-token`, plus `GH_PROMPT_DISABLED=1`. With no token and the fallback off it returns `RELEASE_MERGE_FAILED` (`step` `token`, `falta token: …`) and starts no process. A 403 from GitHub adds a hint that the token needs write access to contents and pull requests.

## Human-only questions

`ask` with `human_only: true` makes a question only the owner's screen can answer. `answer` from an agent returns `HUMAN_ONLY`, including from actor agent `plania-bot`. The screen session cookie is the only proof on that path. `POST /api/projects/:slug/questions/:id/answer` stores `answered_by` as the screen actor. It refuses a request that carries `Authorization: Bearer`, and it refuses an actor sent in the body or in a header. The MCP bearer never opens `/api`. On the screen every open question has its option buttons and a free answer. The Bandeja also has the kill switch «El bot puede responder por ti» (default on) and every delegated answer with the «Delegada» badge, the quote and the time.

Questions asked before 2.17 that carried a letter (A, B or C) are history in `question.archived` events (see Upgrading to 2.18). They are not stored on the question and they change nothing.

### Delegated answers

When the owner is away from the Mac he can tell the Plania bot (actor agent exactly `plania-bot`) in his own chat what to answer. That bot calls MCP `answer_delegated` on the existing write token. The call answers one human_only question that has named options with one of those options. An `approval_id` on that call is ignored. Required: `delegated_by_jorge.message_id` (8 to 200 characters) and `delegated_by_jorge.quote` (8 to 280 characters). Empty or short evidence is `DELEGATION_EVIDENCE`. Any other agent, including `jorge` (`RESERVED_ACTOR`) and a caller that spoofs the screen session, is refused. The normal `answer` tool stays `HUMAN_ONLY`.

Won't do and reopening are not this tool. Any agent calls `set_task` with `reason` and the same `delegated_by_jorge` evidence. The screen does it with the reason alone. Both are logged. Agent moves join this delegated list.

The answer or decision is stored as the owner's (the screen actor). `delegated_answers` keeps the message id, the quote, the delegating actor and the time. The audit lists each one as `DELEGATED_ANSWER` (warn) for review.

Limits: 10 delegated answers and agent Won't do or reopen moves per hour, and one answer per question (`DELEGATION_LIMIT`). The kill switch defaults on. Off, the tool and those agent moves return `DELEGATION_OFF`. The switch is `POST /api/delegation` with the session cookie. No cookie is 401. A Bearer is 403, with or without the cookie. MCP, `/hooks` and `/bot/v1` cannot toggle it, and the bot cannot raise its own limit.

Honest limit: the actor `plania-bot` is an identity declared in the request, and all bots on the Mac share the same write token, so the server cannot technically prove that the caller is the Plania bot or that the quoted message really exists. The controls are the required evidence (message id and quote), the audit plus the visible badge, the rate limit, the kill switch, and the rule that only the owner's own message counts. This is not a proof of identity. Do not treat it as one.

What proves a human on this Mac answered, on the click path, is the screen session only. A bot that has the MCP bearer, or that sends the screen actor in a header or a body, cannot use that path. A process that can mint a session cookie can. The delegated path is the narrow exception above, and it does not prove the message.

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

### Scanning a diff for personal data and secrets

`pnpm scan:diff` is a scan you can run on a diff before merging. It reports; it does not block anything. Flags, the JSON report, the local hash file, and the gitleaks pin are in [docs/scan-diff.md](docs/scan-diff.md).

```bash
pnpm scan:diff <repo-path> [base]
pnpm scan:diff --json <repo-path> --base main --head HEAD
```

It prints `file:line` and a rule id. It does not print the matched value. Exit 0 when there are no findings, 1 when there is at least one, 2 when the scan does not finish (usage, git, or gitleaks). The allowlist is `~/.config/plania/scan-allowlist` or `PLANIA_SCAN_ALLOWLIST`: a literal value, `/regex/`, or `path:` entry per line.


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

Deploy note: the service reads `~/.config/plania/github-token` itself. It does not run `gh`, and it does not read the macOS keychain, unless `PLANIA_GH_FALLBACK=1`. `launchctl kickstart` is enough after a code deploy; the plist stays as it is. A group-readable token file still works and logs one line, with no token in it.

Owner: create a read-only fine-grained token for the plania repo and save it with `umask 077; mkdir -p ~/.config/plania; pbpaste > ~/.config/plania/github-token` (non-blocking).

Backups: the `backup` job dumps the database once a day after 03:00 (`PLANIA_TZ`) into
`~/plania-backups/plania-<YYYYMMDD>.sql.gz` and keeps the last 14; hand-made `plania-pre-*` dumps stay. The Máquina
page shows the last copy, and `BACKUP_STALE` appears there when the last one is older than 48 h. To restore:

```bash
createdb plania_restore && gunzip -c ~/plania-backups/plania-20261016.sql.gz | psql -v ON_ERROR_STOP=1 plania_restore
```

Change the screen password with `pnpm hash-password`, paste the result into `.env` as
`PLANIA_PASSWORD_HASH='...'`, then restart. Rotating `MCP_BEARER_TOKEN` means updating all three client configs.

## Morning brief

A daily brief of every project, made by a headless `claude -p` on this Mac with the owner's own Claude subscription
(no API key, nothing paid) and shown on `/brief`. It runs once a day at `run_at` (default 07:00, local time) and on
"Generate now". Passes A (brief) and B (ideas) are read-only: they read Plania with a read token and each repo with
`git`, and write nothing.

To turn it on:

1. Apply migration `0045` (take a dump first, like every migration):

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/migrations/0045_morning_brief.sql
   ```

2. On `/tokens`, issue a token with read scope (name it `morning-brief`) and put it in `.env` as `PLANIA_BRIEF_TOKEN`.
   Without it the brief falls back to `MCP_READ_TOKEN`, and with neither it stores a facts-only brief that says so.
   If `.env` has no `PLANIA_RUNNER_TOKEN` yet (the agent runner uses it too), issue one with write scope there as well:
   Send to Plania wakes each project's product owner with it.
3. Make sure `claude` is installed and logged in with your subscription: run `claude` once and log in. The brief uses
   `CLAUDE_CODE_BIN` when it is set, else `~/.local/bin/claude`.
4. Run the setup check. Every line should be ✓; each ✗ line says what to fix. It never prints a token or a path.

   ```bash
   pnpm brief:doctor                 # includes a short claude dry run (one small turn on your plan)
   pnpm brief:doctor --skip-claude   # everything except that dry run
   ```

5. Build and restart the service:

   ```bash
   pnpm build && launchctl kickstart -k gui/$(id -u)/com.plania.server
   ```

Then open `/brief` and press "Generate now" (or `pnpm brief:run`). The first brief takes a few minutes.

What the doctor checks: claude found and its version; claude logged in (the dry run also confirms the result carries
`structured_output`); read token set; runner token set (`PLANIA_RUNNER_TOKEN`, needed for Send to Plania); GitHub
token readable (`GITHUB_TOKEN`, else `~/.config/plania/github-token`, see GitHub token file); each included
project's repo path exists; the brief settings (saved or first-run defaults, on or off) and a valid time zone; each
included project's product owner and the home project (both for Send to Plania); the prompts folder
`prompts/morning-brief` is present; migration `0045` applied. The same lines, without the claude dry run, are the
"Setup check" at the bottom of the settings sheet on `/brief` (`GET /api/brief/doctor`).

First-run defaults (change them on `/brief`, settings): on, 07:00, time zone `PLANIA_TZ` (else
`America/Mexico_City`; the label is the city name unless you set one), language `en`, owner name `PLANIA_CEO_NAME` (else "the owner"), every project included, each
project's idea letter taken from its key prefix (X is for cross ideas), no hidden refs, facts-only fallback at 11:00.
A project's repo is `settings.local.repo_path`, else `PLANIA_PROJECTS_ROOT/<slug>`. Its GitHub repo is
`settings.github.repo`. Send to Plania needs a product-owner agent per project (`po-<slug>`, made by
`create_company_project`, or `scripts/seed-org.ts` above); cross ideas go to `PLANIA_HOME_PROJECT` (default `plania`;
set it to one of your projects if you have no `plania` project). The doctor checks both.

## MCP

`POST /mcp`, stateless JSON (no sessions, no GET listen stream). Every call needs a Bearer token;
otherwise `401 {"error":"UNAUTHORIZED"}`. The screen cookie is never accepted here.
`MCP_BEARER_TOKEN` sees every tool; `MCP_READ_TOKEN` sees only the read tools.

The working protocol (Start / Work / Finish, under 900 words since 2.13; each tool's own rules live in its
description) is served as the server's `instructions`
on `initialize`, versioned (`PROTOCOL_VERSION` in `src/mcp/protocol.ts`, also in `get_project`). Project-specific
additions are the project's `rules` (`set_project`). Product repos point here instead of copying the rules.

### Readiness

`get_resume`, `list_projects`, `get_digest` and `GET /api/projects` add `readiness`: `{ state, reasons, line }`. It is read-only. Nothing is written and the schema does not change. Existing fields keep their shape. `line` is one sentence. Each reason is `{ code, severity, text, task_key }`. `text` is one short Spanish sentence and names the ticket key (for example `MC-12: el dueño ya no está en la máquina`). The screen shows that `text`. It does not recompute readiness or rewrite the sentence.

`state` is `ready`, `caution`, `blocked` or `no_context`. Precedence is `no_context`, then `blocked`, then `caution`, otherwise `ready`.

`no_context` (`NO_CONTEXT`): no live claim, no expired claim, no ticket In review, no initiative `next_action`, no next claimable ticket, and no event in 14 days (`CONTEXT_WINDOW_DAYS` in `src/mcp/readiness.ts`).

`blocked`: the ticket to resume has an unsatisfied blocker or is Blocked (`BLOCKER_OPEN`); its pull request `ci_state` is `failure` (`CI_FAILURE`); a failed deploy (the Vercel poller's last error) or an environment behind the integration branch blocks a ticket In review (`DEPLOY_BLOCKED`); two live claims overlap `areas` (`AREAS_OVERLAP`); that ticket waits on a human decision (`DECISION_PENDING`: an open question, a pending approval, or a `human_action` blocker).

`caution`: an expired lease (`LEASE_EXPIRED`); the owner's footprint is old or missing on the machine (`OWNER_ABSENT`, fresh window `FOOTPRINT_FRESH_MS`); the claim has been quiet past `PLANIA_QUIET_MIN` (`CLAIM_QUIET`, default 20 minutes, the same constant as `get_running`); a dirty worktree (`WORKTREE_DIRTY`); dirty unknown (`DIRTY_UNKNOWN`); an environment with no known commit, or an open initiative's integration branch with no head, while a ticket is In review (`ENV_UNKNOWN`); a stale headline or state note (`NOTE_STALE`); a pending pull-request check (`PR_PENDING`); an unreadable pull request (`PR_UNREADABLE`); a human decision on some other ticket (`DECISION_ELSEWHERE`); a recent event and no step to resume (`NO_NEXT`).

`ready`: a healthy live claim, a ticket In review whose checks are passing, or a clear next step, and none of the above.

Unknown or missing data is caution, never ready. `details.dirty` null, a live claim with no footprint row, a pull request whose `ci_state` cannot be read, a missing environment commit, and an integration branch with no head are caution. A missing commit or head is not treated as up to date. A footprint that is not fresh counts as the owner gone; dirty is read only on a fresh worktree. No environment rows and a known head is not `ENV_UNKNOWN`: there is nothing to compare.

<!-- mcp-tools:start -->
| Read | |
|---|---|
| `get_resume` | Where the project stands, generated from data: live claims (who, until when, where), requests (Jorge's open asks from the screen, newest first: read them first), the next claimable ticket, and per open initiative its derived state {phase_now, done, total, in_progress, in_review, waiting_on, line}, the notes (state_note, in_progress, next_action with next_claimable), must_keep (pinned decisions) and status counts, plus readiness. |
| `get_project` | Project title, long body (stack, repo, prod, constraints), rules (project-specific additions to the protocol in the server instructions) with rules_version, protocol_version, headline (the note set_project writes; get_resume has the generated line), settings (release_target, branch_pattern, claim_from, resources, quotas, github, vercel, release), ticket counts, env (per environment: commit, branch, migrations, flags, deployed_at and its source), branches (each with its owner, head and merge state), resources (live leases, today's quotas), metrics, reserved sequence numbers with the ticket holding each, and release: the step settings.release names (from → into), with how far from is ahead, the merged tickets it ships, their migrations, the before-steps, open checks, the command Jorge runs, its mode (command, or merge: Jorge ships it from the screen) and merged once he did (null without settings.release). |
| `list_tasks` | Initiatives, tickets and ideas without scope, with version, claimed_by (live lease owner or null) and updated_at. |
| `get_task` | One initiative or ticket, by its key or any former key (aliases). |
| `get_memory` | Fixed memory: rules, design_docs (project docs, with markdown; view summary lists them without it), and the decision log, newest first (limit default 100, max 500). |
| `get_doc` | One doc by id (from get_task docs, get_memory design_docs, or a decision's adr_doc_id), with its markdown and version. |
| `get_next` | Next claimable ticket: Backlog or Ready, or In progress with an expired lease (stale_claim: true), with every blocker satisfied (tasks In review or Done, env conditions holding). |
| `list_events` | What changed, oldest first: every write is an event with its actor, server time, project and a one-line summary (Spanish). |
| `list_projects` | Every project in one line each: slug, title, key_prefix, headline, line (what is claimed, else the next step, else what is next to claim, else the last event, else empty), ticket counts (open, in_progress, in_review, needs_jorge, blocked, done), open_questions, claims, last_event_id and last_event_at, and readiness (state, reasons, line; same object as get_resume), sorted by slug. |
| `get_running` | Every ticket with an owner, across projects, with a derived liveness: live (lease valid, activity in the last 20 min), quiet (lease valid, no heartbeat or event for longer), stale (lease ran out, not yet cleared). |
| `get_digest` | One call for an assistant that keeps Jorge updated: what changed since a cursor, grouped by project with Spanish summaries and highlights (done, to_review, blocked, needs_jorge, prs_opened, prs_merged, claims), what runs now (get_running) and what waits on Jorge (get_inbox all), plus unchanged_projects and readiness (state, reasons, line) on each changed project. |
| `get_inbox` | Everything waiting on Jorge, oldest first per kind, each item with its group: decisiones (open questions), pasos (human actions a task waits on, the project's release) and limpieza (what agents left on the Mac). |
| `audit` | What the server can see is wrong, from data it has: REVIEW_PR_MERGED, DONE_CHECKS_OPEN, MERGED_CHECKS_OPEN, INITIATIVE_CHILDREN_DONE, INITIATIVE_SCOPE_HAS_STATUS, DECISION_STALE_REF, DECISION_CONTRADICTS_DONE, ENV_DEPLOYED_AT_MISSING, ENV_DRIFT, BLOCKED_BUT_SATISFIED, CLAIMABLE_BUT_WAITING, CLAIM_EXPIRED_WITH_COMMITS, BRANCH_MERGED_NOT_DELETED, BRANCH_WITHOUT_TICKET, TASK_MISSING_PR_URL, WAITING_ON_JORGE_FREE_TEXT, OVERDUE, PR_WITHOUT_PLANIA_KEY, PR_MERGED_TICKET_OPEN, DELEGATED_ANSWER, WONT_DO_WITHOUT_EVIDENCE, and the footprint codes. |
| `get_context` | One call for a session opening a worktree: from workspace {branch, worktree_path, machine} (and your session_id) it returns the initiative on that branch, the tickets on it, your live claims (with any handoff note), the pinned decisions that apply, open questions on those tickets, the footprint they have on the Mac (footprint) and what your session registered (my_footprint), the events since since_cursor that touch them, and requests (Jorge's open asks from the screen, newest first, read them first). |
| `list_agents` | The company roster: every bot, coder and human, with role, title, adapter, heartbeat, who they report to, capabilities, kind, status, last check-in and note. |
| `list_goals` | Company goals and the project goals under them. |
| `list_routine_runs` | Routine runs, newest first. |
| `usage_summary` | Totals of reported tokens per agent, project and week (input, output, cache_read, cache_create). |
| `list_heartbeat_runs` | Recent heartbeat runs: agent, status, adapter, summary and task key, newest first. |
| `thread_read` | Read a thread's messages, oldest first (the last 200, or only those after `after`: an ISO time or a message id). |

| Write | |
|---|---|
| `start` | Open a ticket in one call: claim on key (In progress, your lease) plus get_context for the workspace. |
| `finish` | Close your part of a ticket in one transaction: add_result (result: kind, verdict, cite, commit, command, counts, check_ns...) then set_task status In review with branch and pr_url. |
| `create_task` | Create a ticket (default), an initiative, or an idea. |
| `set_task` | Update a ticket, an initiative or an idea. |
| `set_check` | Tick (or untick) one Done when item by its n, amend its text, or lift a waiver. |
| `add_result` | Record evidence on a task: kind, verdict pass\|warn\|fail, cite (what ran and what it showed), url (CI run, screenshot, recording), and the structured fields: commit, branch, env, command, exit_code, counts, duration_s, attachments, viewport, device, metrics. |
| `attach_doc` | Store a markdown doc in Plania so every machine can read it: a spec or plan on a task (key), or a project doc such as a design page (no key). |
| `claim` | Lease a ticket so no other session works on it. |
| `add_decision` | Append one decision to the log. |
| `reserve_sequence` | Reserve the next number of a per-project sequence (e.g. name 'migration' gives '0009') for a ticket, so two initiatives never take the same one. |
| `ask` | Ask Jorge a question about a task, in Plania rather than only in your chat, so any session can see it and its answer. |
| `answer` | Record Jorge's answer to a question that is not human_only (he answers those on the screen; otherwise he may tell you in chat and you record it here, quoting him). |
| `answer_delegated` | Record one answer the owner gave actor agent plania-bot in his own chat. |
| `set_project` | Edit the project's title, body (stack, repo, prod, constraints), rules (project-specific additions to the protocol) or headline. |
| `set_env` | Record what an environment runs, as data other sessions can check: commit and branch deployed, migrations (the tags applied, e.g. ['0009_x']; migrations_applied is derived), flags (configuration state, never secret values: {google_oauth: false, omdb_key: 'valid'}; null removes one). |
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
| `set_agent` | Create or update one roster row by slug. |
| `check_in` | Say an agent is here. |
| `set_goal` | Create or update a goal. |
| `comment` | Add a comment on a task. |
| `assign` | Set a task's owner_agent to another roster agent and count the hop. |
| `record_routine_run` | Record one run of a roster agent's routine. |
| `report_tokens` | Record the tokens one agent reports for a task run. |
| `create_company_project` | Create a project, a product-owner bot and a Playbook doc from the company template. |
| `wake_agent` | Wake one roster agent through its adapter when its heartbeat is due. |
| `thread_post` | Write a message in a thread Jorge reads on Compañía: a reply, a delivered doc, PR or idea, or what you need from him. |
| `propose` | Post a proposal as data in your project's thread; Jorge decides it in Te toca. |
<!-- mcp-tools:end -->

Rules every write follows:

- **Keys.** The server assigns them (omit `key`): `PREFIX-I<n>` for an initiative, `PREFIX-IDEA<n>` for an idea
  (`WRK-IDEA3`), `PREFIX-<nn>` for a standalone ticket,
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
  `settings.quotas` give `consume` a daily budget (`QUOTA_EXCEEDED`).
- **Handoffs.** `handoff {to, note, head_sha}` ends your lease and holds the ticket for the receiver for ten minutes
  (`HANDOFF_HELD` for anyone else); the receiver's `claim` reply carries the note, and `get_task.workspace_history`
  lists every workspace the ticket has used.
- **State notes.** `scope` is the spec; `state_note` (initiatives) says where things stand and is flagged `stale` once
  a ticket moves after it. A status heading inside `scope` only warns.
- **Derived checks.** An initiative check with `derived_from: <ticket key>` ticks itself when that ticket is Done, and
  `set_check evidence_id` accepts any result of the project (the reply names its `source`).
- **Audit.** `audit` finds, from data: tickets in review whose PR merged, Done with open checks, initiatives closed with
  open tickets, stale state notes, decisions citing commits or PRs the release target has moved past, environments
  without a deploy time, drift, Blocked tickets whose blockers hold, scopes that say to wait without a typed blocker, expired
  claims with commits, merged branches still on origin, branches without a ticket, missing PRs.
- **Shipping.** `settings.release.mode` is `command` (default: the release row shows the command Jorge runs) or `merge`:
  the row shows "Lanzar", and `POST /api/projects/:slug/release/ship` (the screen's cookie only; any Bearer is `403`)
  opens or reuses a PR `from → into` titled "Release: <keys>", merges it with `gh pr merge --merge --match-head-commit`
  and writes `release.merged`; the pollers do the rest. It is refused (`RELEASE_NOT_READY`) while a before-step or a
  check is open; a failing gh call is `RELEASE_MERGE_FAILED` and records nothing. Agents never merge `into`.
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
- **Won't do and reopening.** Jorge's. On screen, `set_task` with a `reason`. An agent sends `reason` and
  `delegated_by_jorge` `{message_id, quote}`. Without that evidence the move is `HUMAN_ONLY`. Each move is logged
  (`task.delegated_move`) and an agent's quote is listed under delegated in the inbox. `waive_check` is the reason
  alone. `lease_resource` does not wait. `approval_id` is ignored for one release. Old rows stay as history.
  `WONT_DO_WITHOUT_EVIDENCE` flags a Won't do that has neither a screen actor, nor a quote, nor an archived granted row.
- **Start and finish.** `start` is `claim` plus `get_context` in one call (with any handoff note); `finish` is
  `add_result` plus In review with branch and pr_url in one transaction, so a failure writes neither.
- **PRs.** Done, Merged or Released on a code ticket without `pr_url` is `TASK_MISSING_PR_URL` unless the write passes
  `no_pr_reason` (logged as `task.no_pr`, and the audit stops flagging it). The pollers and the screen are exempt.
- **Checks.** Entering In review, Merged, Released or Done needs every check done or waived (`CHECKS_OPEN` lists the
  numbers and each open check's text), Jorge included; an initiative needs every ticket closed (`INITIATIVE_CHILDREN_OPEN`).
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
  are Jorge's: on screen with a reason, or by an agent with a reason and `delegated_by_jorge`.
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
| `DELEGATION_EVIDENCE` | 400 | a delegated answer or a Won't do / reopen move needs delegated_by_jorge.message_id (8 to 200 characters) and a quote of 8 to 280 characters; empty or short evidence is refused |
| `DEPLOY_SOURCE_REQUIRED` | 400 | set_env deployed needs a source {provider, deployment_id, url}: the server stores where the time came from |
| `FIELD_NOT_ALLOWED` | 400 | a field of the other kind: priority/parent_key/origin/work_type/phase on an initiative, base_branch/next_action/in_progress_note on a ticket |
| `FINDING_NOT_FIXABLE` | 400 | audit fix: the code has no one-click fix (copy findings: run the command; the rest: the tool the fix_hint names) |
| `INVALID_APPROVAL` | 400 | a waiver needs a non-empty reason. The old approval action list is no longer a tool |
| `INVALID_BATCH_OP` | 400 | batch: an op is not set_task, set_check, add_result, add_decision, create_task or note |
| `INVALID_BLOCKER` | 400 | a blocked_by entry is malformed (detail: type, hint): human_action {assignee, text}, env_flag {env, flag, equals}, time_after {at}, metric_gte {name, value} |
| `INVALID_ENV` | 400 | set_env: env is not lowercase [a-z][a-z0-9_-]*, a commit is not 7-40 hex, or migrations_applied is not a count |
| `INVALID_ENV_CONDITION` | 400 | an env blocker's condition or value is wrong (contains_commit <sha>, migration_gte <n>, deployed_after [ISO]) |
| `INVALID_FILTER` | 400 | a list filter is malformed (detail: field), e.g. updated_since is not an ISO-8601 time |
| `INVALID_FOOTPRINT` | 400 | register_footprint / release_footprint: unknown kind, a locator that does not fit its kind, an empty purpose or teardown, or no actor.machine (detail: field, hint) |
| `INVALID_GOAL` | 400 | a goal needs a title, status active|done|dropped, target_on as YYYY-MM-DD, a company goal cannot have a parent, and a parent must be a company goal |
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
| `PROMOTED_TO_INVALID` | 400 | promoted_to is not an initiative or a standalone ticket of this project |
| `RESERVED_ACTOR` | 400 | actor.agent is jorge: only the screen writes as Jorge |
| `SECRET_LIKE_VALUE` | 400 | an env flag looks like a secret (a key name, a token prefix, or 20+ random characters); flags record whether something is configured, never the value |
| `TASK_MISSING_PR_URL` | 400 | Done, Merged or Released on a code ticket without pr_url: pass pr_url, or no_pr_reason when the work had no PR |
| `TEMPLATE_INVALID` | 400 | create_task: a ticket without scope, or a code/ops ticket without checks (detail: missing) |
| `TEXT_HAS_DATE` | 400 | decision text starts with a date: the server stamps dates |
| `TOO_LARGE` | 400 | a text field exceeds its limit (detail: field, max) |
| `VERSION_REQUIRED` | 400 | set_task changes fields without the version you read |
| `ACTOR_MISMATCH` | 403 | actor.agent or actor.machine disagrees with the agent token's (detail: expected) |
| `DELEGATION_OFF` | 403 | delegated answers and delegated moves are off: the kill switch on the screen is off |
| `HUMAN_ONLY` | 403 | Won't do or reopening a closed task: Jorge's call, on screen with a reason, or by an agent with a reason and delegated_by_jorge {message_id, quote}. Also a human_only question: only the screen can answer it, by a click; bots are refused. answer_delegated is a different tool and only actor agent plania-bot may call it |
| `NOT_DELEGABLE` | 403 | answer_delegated only answers one human_only question that has named options. An approval_id on that call is ignored |
| `THREAD_FORBIDDEN` | 403 | thread_post or thread_read on a thread that is not yours: Asistente may use every thread, a team member only its own project's (detail: thread, agent) |
| `AGENT_NOT_FOUND` | 404 | unknown roster slug (owner_agent or reports_to) |
| `CHECK_NOT_FOUND` | 404 | no check with that n on this task |
| `DECISION_NOT_FOUND` | 404 | supersedes names no decision of this project |
| `DOC_NOT_FOUND` | 404 | no doc with that id in the project, or replacing (version given) a title that does not exist |
| `FINDING_NOT_FOUND` | 404 | audit fix: a fresh audit no longer has that finding (code and id), so there is nothing to fix |
| `GOAL_NOT_FOUND` | 404 | no goal with that id, or the goal belongs to another project (detail: field goal_id or parent_id) |
| `INITIATIVE_NOT_FOUND` | 404 | get_next initiative_key is not an initiative of this project |
| `PROJECT_NOT_FOUND` | 404 | unknown project slug |
| `QUESTION_NOT_FOUND` | 404 | no question with that id in this project |
| `RESULT_NOT_FOUND` | 404 | evidence_id is not a result of this project |
| `TASK_NOT_FOUND` | 404 | unknown key in this project (also an unknown parent_key or task_key) |
| `THREAD_NOT_FOUND` | 404 | thread is not "company", a project slug with a thread, or a thread id |
| `UNKNOWN_BRANCH` | 404 | get_context: no initiative or ticket is on that branch (detail: known) |
| `ALREADY_ANSWERED` | 409 | the question was answered already (detail: answer, answered_by) |
| `ALREADY_SUPERSEDED` | 409 | the decision named in supersedes was already reversed (detail: superseded_by) |
| `BATCH_FAILED` | 409 | an atomic batch rolled back because one op failed (detail: index, op, failed: {error, status, ...}) |
| `BLOCKER_NOT_WITHDRAWABLE` | 409 | set_task withdraw_blocker: not a pending blocker parsed from a note on this task, or another session's note (detail: reason) |
| `BRANCH_IN_USE` | 409 | the branch belongs to another live initiative (detail: owner_key); pass share_branch: true with a reason to share it |
| `CHECKS_OPEN` | 409 | In review, Merged, Released or Done while a check is neither done nor waived (detail: open, the check numbers) |
| `CLAIM_HELD` | 409 | another session holds a live lease (detail: owner, lease_until, workspace) |
| `DECISION_RETIRED` | 409 | the decision was retired: it cannot be superseded, pinned or retired again |
| `DELEGATION_LIMIT` | 409 | delegated answers and Won't do or reopen moves are limited to 10 per hour, and one answer per question |
| `DOC_EXISTS` | 409 | attach_doc without version for a title that exists (detail: doc_id, version): pass version to replace |
| `EVIDENCE_REQUIRED` | 409 | In review without evidence for the work_type from the current claim (detail: accepts, since) |
| `EVIDENCE_STALE` | 409 | In review needs a pass recorded against the branch's current head; the passes found are for older commits (detail: head, results) |
| `FOOTPRINT_HELD` | 409 | another live session declared this footprint, or releasing one you did not declare (detail: holder, purpose) |
| `HANDOFF_HELD` | 409 | the ticket was handed to another session; the hold lasts ten minutes (detail: to, until, note) |
| `HOP_CAP` | 409 | assign would pass 3 hops (detail: hops, cap). The owner stays and a limpieza inbox item is posted |
| `IDEA_CLOSED` | 409 | a Done or Won't do idea does not change stage or promoted_to (detail: status) |
| `INITIATIVE_CHILDREN_OPEN` | 409 | an initiative cannot be Done or Won't do while a ticket of it is in another state (detail: open) |
| `INVALID_STAGE_MOVE` | 409 | set_task stage is not one step along idea → research → design → planning → ready, or a step back without a note (detail: from, to) |
| `INVALID_TRANSITION` | 409 | the status change is not allowed from the current status (detail: from, to, hint) |
| `KEY_BELOW_COUNTER` | 409 | an explicit key with a number already issued for that scope (detail: next); omit key to get the next one |
| `KEY_EXISTS` | 409 | create with a key that exists (or is an alias of one); creates are not idempotent without request_id |
| `LEASE_EXPIRED` | 409 | heartbeat after your lease ran out: claim again |
| `NOT_CLAIMABLE` | 409 | the ticket cannot be claimed (detail: status, or unsatisfied blocked_by) |
| `LEG_POSTPONED` | 409 | propose: a plan for a leg that is On hold, postponed on purpose; planning is not permission to start it (detail: key, status) |
| `NOT_OWNER` | 409 | another session holds a live lease on this task (detail: owner, lease_until) |
| `PING_PONG` | 409 | this owner pair already assigned the other way (detail: from, to). The owner stays |
| `QUOTA_EXCEEDED` | 409 | consume would pass the daily quota (detail: limit, used, remaining) |
| `RELEASE_MERGE_FAILED` | 409 | release/ship: a gh call failed (detail: step token | list | edit | create | merge | view, output); nothing was recorded |
| `RELEASE_NOT_READY` | 409 | release/ship: the step cannot ship now (detail: reason mode_command | no_repo | no_release | no_github_data | nothing_to_ship | before_steps | open_checks | merged) |
| `REQUEST_ID_REUSED` | 409 | request_id was already used by a different tool in this project |
| `RESOURCE_HELD` | 409 | another session holds the resource (detail: holder, lease_until, purpose) |
| `SEQUENCE_TAKEN` | 409 | the requested sequence value is held by another live ticket |
| `STAGE_REQUIREMENTS_MISSING` | 409 | moving an idea forward without that stage's doc or its headings (detail: doc, missing) |
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

Nothing. Do not add a `CLAUDE.md`, `AGENTS.md`, `.cursor/`, `.claude/`, hooks or CI for Plania to a product repo.
The plan and the rules live in Plania: the server's `instructions` carry the protocol, and `get_project` /
`get_memory` carry the project's rules. Client-side rules belong in the owner's user-level config, not in the repo.

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
- `/inbox` lists everything waiting on Jorge: open questions, human actions, a release and footprint.
  The header shows the count. `/tokens` issues and revokes agent tokens.
- `/p/<slug>` shows the generated headline first, with the note under it (editable, "desactualizada" when the server marked it stale), then, in order: questions agents asked (answer with one click or free text, with an optional line for
  the decision log); the lane grid; each initiative's line of stations; a branch graph built from initiatives' `branch`
  and `base_branch`; the pinned decisions; and Orden, the audit collapsed with its count, grouped "Lo tuyo" (one-click
  fixes and commands to copy) and "De los agentes" (what get_next hands out as chores). "Ver la ficha completa" opens the generated resume per initiative
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
- **Reaching it from the phone** (2.12): the server listens on 127.0.0.1 only and `tailscale serve --bg --https=443
  http://127.0.0.1:3737` puts it on the tailnet with a real certificate. The session cookie is `Secure` when the request
  is HTTPS, arrives with `X-Forwarded-Proto: https` (what `tailscale serve` sends; trusted because only this Mac can
  reach the port), or comes to a loopback host. A home-screen app on iOS keeps its own cookies, so you sign in once
  inside it. Steps in [docs/phone-access.md](docs/phone-access.md).
- **Push** (2.12): "Avisarme cuando me toque" in the "⋯" menu subscribes the device (`ui/src/lib/push.ts`); `ui/sw.js`
  shows the message and a tap opens the Bandeja on its tab. The `push` job (`src/jobs/push.ts`) looks at the inbox
  once a minute and sends one message per device for whatever is new in Decisiones or Pasos (questions,
  human actions typed or parsed, a release ready). A 404/410 from the push service deletes the subscription.

How live updates flow: every write runs in `writeTx` (`src/mcp/tx.ts`), which after commit publishes one change per
task it touched on the in-process bus in `src/events.ts`. `GET /api/events` streams those as server-sent events, and
the UI refetches what changed.

### JSON API (cookie only)

| Route | Purpose |
|---|---|
| `POST /api/login`, `POST /api/logout`, `GET /api/session` | Session |
| `GET /api/projects` | Projects with their generated line (the headline), the next step (`next_line`), read-only `readiness` (`state`, `reasons`, `line`; same object as `get_resume`), Orden's count, open question count, and all tasks without scope |
| `GET /api/projects/:slug` | Generated resume, decisions, and all tasks without scope (with version, lease, `branch`, `base_branch`, `waits_on`, `held` and `created_at` on each task) |
| `GET /api/projects/:slug/tasks/:key` | One task, in the `get_task` shape; each result with `stale_for_head` and `ticked_checks` (the sheet's evidence timeline) |
| `PATCH /api/projects/:slug` | `{ headline, version }`: the note beside the generated headline |
| `GET /api/projects/:slug/audit` | Orden: the last audit run, each finding with `can_fix` (`retire_decision`, `copy`, `mark_deployed`, `open`) and `owner` (`jorge` or `agents`) |
| `POST /api/projects/:slug/audit/fix` | `{ code, key?, id }`: the one-click fixes as Jorge (retire the decision, mark the env deployed); answers with the new run |
| `PATCH /api/projects/:slug/tasks/:key` | `{ status?, priority?, note?, version }`, as Jorge through `set_task` |
| `POST /api/projects/:slug/tasks/:key/checks/:n/waive` | `{ reason }` |
| `GET /api/machine` | What runs and is stored on this Mac for agent work: `{ machine, totals, items }`, every unreleased footprint with its project, initiative, ticket, session and any port lease; read-only |
| `GET /api/inbox?project=` | Everything waiting on Jorge: questions, human actions, a release, footprint |
| `GET /api/tokens`, `POST /api/tokens`, `DELETE /api/tokens/:id` | Agent tokens (the secret is in the create response only) |
| `POST /api/projects/:slug/tasks/:key/release` | Free a lease |
| `POST /api/projects/:slug/release/ship` | 2.13 Lanzar (merge mode): PR `from → into`, `gh pr merge --merge`, `release.merged`. Any `Authorization: Bearer` is refused with 403 |
| `POST /api/projects/:slug/tasks` | 2.12 Pedir: `{ title, summary?, priority?, parent_key? }`, a Backlog ticket as Jorge with `origin: "jorge"` |
| `GET /api/digest?since=`, `POST /api/digest/seen` | 2.12 Hoy: `get_digest` as the reader `screen` (reading never moves its bookmark); `{ cursor }` on "Visto" does |
| `GET /api/push/public-key`, `POST` / `DELETE /api/push/subscribe` | 2.12 push: the VAPID key (`PUSH_NOT_CONFIGURED` without it) and this device's subscription |
| `POST /api/projects/:slug/questions/:id/answer` | `{ answer, decision_text? }`. Cookie only. Any `Authorization: Bearer`, or an actor in the body or a header, is refused. The stored actor is the screen actor |
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
