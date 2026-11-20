# Upgrading an existing install

Notes for databases and servers set up before each release. A new install needs none of this: `pnpm plania:install`
applies every migration. Updating a packaged install is `pnpm update:plania` (README, Updating).

## Upgrading to 2.3 (audit, context, handoff)

Migration `0018` adds `audit_runs`, `releases`, `tasks.state_note` / `state_note_at` / `handoff` and `checks.derived_from`.
Nothing to backfill. The audit job starts with the server; `audit(project)` runs it on demand.

## Upgrading to 2.2 (branches, typed blockers, pollers)

Migration `0017` adds `projects.settings`, the typed `blockers` table (the old `env_blockers` rows are copied in),
`branches`, `resources`, `quota_usage`, `pull_requests`, `poll_state`, `project_metrics`, the structured result
columns, env `flags`/`migrations`/`deploy_source`, and the bug and debt fields. Then, per project, set what the
pollers need (`set_project settings`): `github: {repo}`, `vercel: {project_id, team_id?}`, `release_target`,
`branch_pattern` (e.g. `^feat/[a-z0-9][a-z0-9-]*$`), `claim_from`. `GITHUB_TOKEN` in `.env` still wins when it is
set; otherwise the poller reads `~/.config/plania/github-token` (one line, mode `0600`, see GitHub token file). Put `VERCEL_TOKEN`
in `.env`. The settings only name the variables.

## Upgrading to 2.1 (keys, approvals, tokens)

Migrations `0015` and `0016` add the key counters and aliases (and set each project's `key_prefix`), agent tokens,
approvals, check waivers, decision retirement, the headline and `events.token_id`; `0016` also copies the old
single `supersedes_id` into `decision_supersessions`. Then move the keys of a
project to the 2.1 scheme once (initiatives `FIL-I1`, phases `FIL-I1-1`, standalone tickets unchanged); every old key
stays as an alias and each rename is a `task.rekeyed` event:

```bash
pnpm rekey --project tienda            # dry run: prints the plan
pnpm rekey --project tienda --apply    # writes it, in one transaction
```

## Upgrading to 2.9 (backups, v1 cleanup)

Migration `0022` adds `machine_state` (the nightly backup's record), copies every non-empty v1 `tasks.body` into a
task doc titled "v1 body", then drops `tasks.body`, the four `projects.resume_*` columns, `design_pages`,
`env_blockers` and `decisions.supersedes_id`. Take a `plania-pre-0022-*` dump first.

Upgrading a v1 database: the backfill that did it (`scripts/backfill-v2.ts`) is in the git history before 2.9.

## Upgrading to 2.11 (derived truth)

Migration `0024` (there is no `0023`: 2.10 needed none) renames `projects.headline`, `headline_version`,
`headline_at` and `headline_stale` to `headline_note*`, data kept: the headline is generated now and what
`set_project headline` writes is its note. Take a `plania-pre-0024-*` dump first. The 2.11 server reads only the new
names and the old one only the old, so apply the migration right before the restart.

## Upgrading to 2.12 (intent and the day)

Migration `0025` adds `push_subscriptions`; nothing else changes shape (the owner's requests reuse `tasks.origin` with the
new value `owner`). Take a `plania-pre-0025-*` dump first. The 2.12 server's push job and `/api/push/*` read the table,
so apply it before the restart. Push also needs the VAPID trio in `.env` (`pnpm vapid` prints a pair); without it push
stays off and everything else works. Phone access over Tailscale and turning push on: [docs/phone-access.md](phone-access.md).

## Upgrading to 2.13 (agent surface)

Restart with `pnpm server:restart`: it lists what a restart would cut (a running agent, a QA check, El Probador's pictures, a Máquinas test run) and refuses while there is any; `--check` only lists, `--force` restarts anyway.

No migration. `pnpm build`, then restart the service; agents get the `start` / `finish` tools on their
next `initialize`. That release served protocol 2.12. PLA-I8-3 moved the protocol to 2.13: those questions were answered only on the screen (that step was removed in 2.17). Shipping a release from the screen is off until a project asks for it: add `mode: "merge"` to its
`settings.release` (on screen in the project's Ajustes, «Fusionar desde Plania», or `set_project settings {release: {from, into, env, mode: "merge"}}`) and keep
`settings.github.repo` set. The merge runs `gh` with `GH_TOKEN` from `~/.config/plania/github-release-token`, or from
`~/.config/plania/github-token` when that file has no token. The token needs write access to the repo. Without `mode`
the release row keeps the command to copy.

## Upgrading to 2.14 (screen click)

Migration `0028` drops `gate_challenges` and deletes the `machine_state` row the old screen step stored. Take a dump first. Apply `0028`, `pnpm build`, then restart `com.plania.server`. The protocol moved to 2.14: human-only questions were answered by a click on the owner's screen (that step was removed in 2.17).

## Upgrading to 2.15 (delegated answers)

Migration `0029` adds `delegated_answers`. Take a dump first. Apply `0029`, `pnpm build`, then restart `com.plania.server`. The protocol moves to 2.15. The kill switch defaults on. It is the `machine_state` key `delegation` (`{enabled: true|false}`). The screen toggles it. Nothing else can.

## Upgrading to 2.16 (readiness)

No migration and no schema change. `pnpm build`, then restart the service. `get_resume`, `list_projects`, `get_digest` and `GET /api/projects` gain `readiness` (`state`, `reasons`, `line`). Existing fields keep their shape. The protocol moves to 2.16.

## Upgrading to 2.17 (stage docs only)

The old screen step is gone (PLA-I18). An idea moves idea → research → design → planning → ready by `set_task stage` alone; the only check left is the stage doc and its headings (`STAGE_REQUIREMENTS_MISSING`). A promoted initiative goes Active like any other. `ask` that still sends the removed field ignores it and the reply includes a hint, so a bot still on 2.16 stores the question. `GATE_NOT_PASSED`, `GATE_OPEN`, `GATE_ANSWERED_BY_AGENT` and `STAGE_DOC_STALE` no longer exist; `GATE_ANSWERED_DELEGATED` is now `DELEGATED_ANSWER`. The Bandeja has no section for that old step.

Old question rows stay as read-only history: the letter column, its check constraint and every `delegated_answers` row are kept, and nothing is dropped. Migration `0030_close_gates` (PLA-I18-5) closes the rows of that kind that are still open:

1. Take a dump first: `pg_dump --no-owner "$DATABASE_URL" | gzip > ~/plania-backups/plania-pre-0030-$(date +%Y%m%d).sql.gz`.
2. Apply `drizzle/migrations/0030_close_gates.sql` (`psql "$DATABASE_URL" -f …`). It only updates those open rows and is safe to run twice.
3. `pnpm build`, then restart `com.plania.server`.

Until `0030` runs, an open old row stays out of the inbox and can only be closed on the screen; it moves nothing. The protocol moves to 2.17.

## Upgrading to 2.18 (direct moves)

Migration `0032_drop_gates_approvals` copies old approval rows and lettered questions into events, then drops the approval table, the letter column and its check. Take a dump first. The protocol moves to 2.18.

`request_approval` is gone. Won't do and reopening a closed task are a direct `set_task`: a `reason`, and an agent also sends `delegated_by_owner` `{message_id, quote}` (the same evidence as `answer_delegated`). The screen session needs only the reason. The move is logged (`task.delegated_move`) and, when an agent sent a quote, listed in the inbox delegated list. `waive_check` takes the reason alone, at every status. `lease_resource` ignores `needs_approval`. An `approval_id` on those calls is accepted and ignored, and the reply includes a hint, for one release. A Won't do with no screen actor, no delegated evidence and no archived granted row is the audit finding `WONT_DO_WITHOUT_EVIDENCE`.

1. Take a dump first: `pg_dump --no-owner "$DATABASE_URL" | gzip > ~/plania-backups/plania-pre-0032-$(date +%Y%m%d).sql.gz`.
2. Apply `drizzle/migrations/0032_drop_gates_approvals.sql` (`psql "$DATABASE_URL" -f …`). It copies those rows into `approval.archived` and `question.archived`, then drops them. A second run copies nothing and drops nothing.
3. `pnpm build`, then restart `com.plania.server`.

## Upgrading to the agents' kit (audit 2026-11)

Migration `0061_run_kit` adds `agent_runs.prompt_version`, `skills`, `skills_used` and `context_tokens`; nothing else changes shape, and it is safe to run twice. Take a `plania-pre-0061-*` dump first, apply `drizzle/migrations/0061_run_kit.sql`, `pnpm build`, then restart the service. The protocol moves to 2.23 (`deliver_stage`).

Then, once, on the server: `pnpm kit:export` writes the live role prompts into `kit/roles/` (commit them), and `pnpm kit:status` should read `same` for every role. What changes for runs is in [The agents' kit](agents-kit.md). Two things are on from the first run and can be turned off: a seat with no packs carries its role's default skills (`PLANIA_DEFAULT_KITS=0`), and a session that failed, was sent back by QA or grew long starts fresh instead of resuming (`PLANIA_RETRY_FRESH=0`). `finish` runs a project's checks only when it has a `settings.qa.verify` list.

## Upgrading to the migration record

From this version the server refuses to start on a database without the migration record. Once, before restarting,
mark the live database up to the last file applied to it (today `0061_run_kit.sql`):
`pnpm db:migrate --database plania --baseline 0061_run_kit.sql`. Later upgrades are `pnpm db:migrate`.

## The GitHub token file

No migration. `pnpm build`, then restart the service (`pnpm server:restart`). What the poller reads is in the README, GitHub token file.
