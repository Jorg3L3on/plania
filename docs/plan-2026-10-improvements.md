# Plania improvements plan (October 2026)

Written 2026-10-15 from a review of the code, the five screens, protocol 2.8 and the live data
(audit, inbox, digest of filmia, micasa, plania, workia, zigzag). Nothing here is implemented.

The review found one failure behind most symptoms: **the thing only Jorge can do is invisible to the
one screen he checks.** What waits on him lives in free text (`next_action`, `state_note`, the
headline), the inbox holds only footprint chores, and the recurring human step, `sandbox → main`,
has no object. Secondary findings: hand-written summaries rot (headline stale on 3 of 5 projects,
state notes on 4 initiatives), the audit has no screen, Jorge cannot create a ticket, the phone app
has nothing to push, and 42 tools plus a 1,500-word protocol still produce Done-without-PR.

The plan is five releases, each one PR, protocol bump and migration where noted. Items are numbered
as in the review; the search palette (review item 8) is left out on Jorge's call.

| Release | Theme | Items | Protocol | Migration |
|---|---|---|---|---|
| 2.9 | Housekeeping | fixes a, b, e, f | 2.8 (no text change) | 0022 (cleanup) |
| 2.10 | Te toca | 1, 2 (phase one), fix c | 2.9 | 0023 |
| 2.11 | Derived truth | 3, 4, fix d | 2.10 | 0024 |
| 2.12 | Intent and the day | 5, 6 | 2.11 | 0025, 0026 |
| 2.13 | Agent surface | 7, 2 (phase two) | 2.12 | none |

Order rationale: housekeeping first because the cleanup migration and the shared pool touch every
later file and are cheap to verify; 2.10 next because it is the highest-value user change and the
parser it adds is what 2.13's guards build on; derived truth before intent because the generated
headline feeds the "Hoy" strip; the agent surface last because its composite tools wrap the writes
2.10 and 2.11 change.

---

## 2.9 Housekeeping

### Fix a. One connection pool; drop the Vercel entry point

- `src/db/client.ts`: a module-level `pg.Pool` (max 10, `idleTimeoutMillis` 30 s) created on first
  use from `DATABASE_URL`; `makeDb()` returns the shared db and a no-op `close`; `withDb` keeps its
  signature so no caller changes. Tests set `DATABASE_URL` before the first call (`test/helpers.ts`
  line 25 already does), and get a `resetPool()` for the suites that rebuild the database.
- Delete `api/index.ts`, `vercel.json` and the `hono/vercel` import; remove the Vercel and Neon
  lines from the README's first paragraph and from the comment at the top of `scripts/dev.ts`.
- Done when: `pnpm test` passes, the service restarts, `/health` answers, and
  `select count(*) from pg_stat_activity where datname='plania'` stays flat under load.

### Fix b. Nightly backup job

- `src/jobs/backup.ts` in the `JOBS` list, interval one hour, runs once per local day after 03:00
  (`PLANIA_TZ`), tracked in `poll_state` with `source: "backup"` for a new project-less row (or a
  small `machine_state` row, see 2.11 fix d, whichever lands first).
- Runs `pg_dump --no-owner "$DATABASE_URL" | gzip` into `~/plania-backups/plania-<YYYYMMDD>.sql.gz`,
  keeps the last 14 daily and the hand-made `plania-pre-*` dumps untouched. `pg_dump` is found via
  `PLANIA_PG_BIN` or the Homebrew path.
- `GET /api/machine` gains `backup: {at, path, bytes, error}`; the Máquina page shows one line
  "Última copia: hace 6 h, 2.1 MB" and a red line when the last run failed or is older than 48 h.
- Done when: a dump appears the first night, restoring it into `plania_test_*` loads, the audit has a
  `BACKUP_STALE` finding (project `null`) when the file is older than 48 h.

### Fix e. Generate the README tool table

- `scripts/mcp-table.ts` reads the registrations in `src/mcp/register.ts` (name, title, read-only
  annotation, the first sentence of the description) and rewrites the README between
  `<!-- mcp-tools:start -->` and `<!-- mcp-tools:end -->`.
- `test/readme.test.ts` fails when the committed README differs from the generated table.
- Done when: the two tables in the README are the generated ones and the test guards them.

### Fix f. The v1 cleanup migration (0022)

Precondition: no project has a legacy card (`legacy_card_present: false` on every `get_resume`;
zigzag confirmed, check the other four) and a `plania-pre-0022-*` dump exists.

- Migration `0022` drops `tasks.body`, `projects.resume_*` (four columns), `design_pages`,
  `env_blockers`, and `decisions.supersedes_id` if 0016 left it.
- Remove: the `legacy` job, the `archive_legacy_card` tool, `legacy_card` / `legacy_body` from
  `get_resume`, `get_task`, `queries.ts`, the `backfill-v2` script and its test, `include_legacy`,
  and in the UI `resume.legacy_card` reads in `project.tsx` (the `dedupe`, `branchText`, `nowText`,
  `nextText` fallbacks) and `project-parts.tsx`.
- Done when: `pnpm test` passes without `backfill.test.ts`, the README's "Upgrading a v1 database"
  section is reduced to one line pointing at the git history.

---

## 2.10 Te toca

### Item 1. Human actions as data, and an inbox with three tones

**Server**

- A parser in a new `src/mcp/jorge-lines.ts`, shared with the audit's existing
  `WAITING_ON_JORGE_FREE_TEXT` heuristic: a line that starts with `Jorge:` (any case, optional
  leading list marker) or matches the audit regex is a human action. Keep it conservative; the audit
  keeps flagging what the parser does not catch.
- On `create_task`, `set_task` (fields `next_action`, `in_progress_note`, `state_note`, `summary`,
  `blocked_note`) and `set_task note`: each parsed line becomes a `human_action` blocker on that task
  with `spec.source: "parsed"` and `spec.line_hash`. Parsed blockers are re-synced per write: lines
  gone from the text drop their unsatisfied parsed blocker; satisfied ones stay as history. Event
  `blocker.parsed`; reply warning `JORGE_LINE_PARSED` naming the blocker id and the fix hint "use
  blocked_by human_action next time".
- `set_project headline` with a Jorge line: warning only, no blocker (the headline is generated from
  2.11 on and the line disappears with it).
- A parsed blocker does not change the ticket's status (an initiative keeps Shipping; a Ready ticket
  stays Ready) unless the text sits in `blocked_note`, in which case it behaves like any blocker.
- `inboxFor` adds `group: "decisiones" | "pasos" | "limpieza"`: approvals and questions are
  decisiones; `human_action` and releases (item 2) are pasos; footprints are limpieza. `count` and
  `by_project` count decisiones + pasos; a new `chores` count holds limpieza.
- `resolveHumanAction` accepts an optional `note` that lands in the ticket log as Jorge's note.

**UI**

- `/inbox` becomes three tabs with the counts in the tab labels: Decisiones (today's approvals
  and questions, unchanged), Pasos (human actions and releases, each row a verb, a ticket, a
  "Hecho" button and an optional note field), Limpieza (the footprint rows as they are).
- The header badge and the city's waiting count use decisiones + pasos; Limpieza shows a quiet
  count on the Máquina link instead.
- A ticket's sheet shows its human actions under "Te toca" with the same Hecho button.

**Protocol 2.9**: step 6 says "Need Jorge to do something? blocked_by human_action; a line that
starts with `Jorge:` becomes one on its own and warns". The audit finding keeps its code but its
detail says "parsed into blocker <id>" when the parser caught it.

**Migration 0023**: none for blockers (the table exists); see item 2 below for the settings column.

**Tests**: `test/jorge-lines.test.ts` (parser cases from the seven live findings), inbox grouping,
resync on edit, no status change on parse.

**Done when**: on the live database, after one write per flagged ticket, the audit reports zero
`WAITING_ON_JORGE_FREE_TEXT` and the Pasos tab lists them.

### Item 2, phase one. The Release as an inbox step

**Model**: a release is computed, never typed. `settings.release` on the project:
`{from: "sandbox", into: "main", env: "prod"}` (filmia and zigzag), or `{from: "sandbox", into:
"main", env: "prod"}` for micasa; absent means the project has no release step. Migration 0023 adds
nothing to the schema; `ProjectSettings` gains the type and `set_project settings` validates it.

**Server**: `src/mcp/release-plan.ts`, `releasePlan(db, p)` returns `null` or

```
{ from: {branch, head_sha}, into: {branch, head_sha}, ahead: n,
  tickets: [{key, title, status, pr_url}],   // Merged (and In review with a merged PR) not yet Released
  migrations: [tags reserved by those tickets and not in env.migrations],
  before: [human actions on those tickets or the project tagged before_release, unsatisfied],
  open_checks: n,
  command: "git fetch origin && git checkout main && git merge --ff-only origin/sandbox && git push origin main" }
```

`ahead` and the commit list come from the GitHub poller: a new call to
`GET /repos/{repo}/compare/{into}...{from}` every tick, cached in `poll_state.cursor` by the pair of
heads, so no call when nothing moved. The poller already writes `branches.head_sha` for both.

- `get_resume.status` gains `release: releasePlan`, `get_project` too; `get_inbox` lists one
  `release` item per project in pasos when `ahead > 0` and `tickets.length > 0`, with `why` "N
  tickets listos para prod" and `target` the plan.
- When the poller sees `into.head` contain `from.head` the item disappears and an event
  `release.shipped {from, into, tickets}` is written; the existing Merged → Released path then runs
  on the Vercel deploy.
- The audit's `ENV_DRIFT` finding points at the release item instead of repeating it.

**UI**: in Pasos, a release row shows the project mark, "sandbox → main: 4 tickets, 1 migración",
the ticket chips, the before-steps as a checklist, the open-check count in warning tone, and the
command block with the same copy button footprints use. On the project page the header gets a
"Para lanzar" pill with the count that opens the inbox tab.

**Protocol 2.9**: step 7 adds "A merged ticket waits in get_resume.status.release until Jorge
ships it; never merge `into` yourselves" (matches the pinned zigzag and filmia decisions).

**Tests**: plan from fixtures (ahead, tickets, migrations), item disappears on contain, no item
without `settings.release`.

**Done when**: zigzag's ZIG-I21 shows as one release step with ZIG-14 as a before-step, and
shipping it by hand makes the row vanish within one poll.

### Fix c. Due dates on screen

- `GET /api/projects` adds per project `upcoming: [{key, title, on, kind: "due" | "time_after"}]`
  (next 14 days) and `overdue` keys; `GET /api/projects/:slug` includes `due_on` and `time_after`
  blockers on every task row (the MCP shapes already carry them).
- Home: a "Próximo" list under the city, one line per date, overdue ones first in warning tone.
  Ticket rows and the sheet show "vence 24 oct"; the lane grid's chip turns to the overdue tone.
- Done when: filmia's 2026-10-24 comparison appears as a date without anyone retyping it.

---

## 2.11 Derived truth

### Item 3. Generated headline and initiative state; notes as commentary

**Server**

- `src/mcp/headline.ts`, `generatedHeadline(db, p)` from `statusBlock`: `"<env> = <branch>
  <sha7> (<initiatives released since the previous release>). <from> = <into> + <PR numbers>
  (<keys>). Te toca: <n pasos>. Siguiente: <next_claimable key>."` Clauses drop when empty;
  280 chars max, cut at a clause boundary.
- `projects.headline` keeps its column and becomes the note: `get_resume.headline` returns
  `{generated, note: {text, version, at, stale}}`. `set_project headline` still writes the note
  (no breaking change). `headline_stale` keeps its trigger but only marks the note.
- Initiatives: `get_task` and the resume add `state: {phase_now, done, total, in_review:
  [{key, pr}], waiting_on: [...]}` computed from children, claims and blockers. `state_note` stays
  as commentary; `INITIATIVE_STATE_NOTE_STALE` is demoted from the audit to a flag on the note and
  the protocol tells agents the note is optional.

**UI**: the project header shows the generated line as the headline and the note as a second,
smaller line with the pencil Jorge already has; initiative rows show the derived state line first
and the note, when present, after it in muted tone.

**Protocol 2.10**: step 7 drops "update the project headline"; it now says "the headline is
generated; add a note with set_project only for what the data cannot say".

**Migration 0024**: `projects.headline` renamed to `headline_note` and friends (data kept).

**Done when**: all five projects show a headline with no stale flag and the digest's `line` per
project comes from the generated headline.

### Item 4. Orden: the audit on screen, with fixes

- `GET /api/projects/:slug/audit` returns the latest `audit_runs` row (the job keeps running every
  ten minutes) plus `can_fix` per finding: `retire_decision` (DECISION_STALE_REF,
  DECISION_CONTRADICTS_DONE), `copy` (BRANCH_MERGED_NOT_DELETED, WORKTREE_MERGED_NOT_REMOVED,
  BRANCH_WITHOUT_TICKET), `mark_deployed` (ENV_DEPLOYED_AT_MISSING), `open` for the rest.
- `POST /api/projects/:slug/audit/fix` with `{code, key, id}` runs the one-click ones as Jorge
  through the existing tool functions.
- UI: an "Orden" section at the bottom of the project page, collapsed with the count, grouped
  "Lo tuyo" / "De los agentes"; each row has the detail, the fix hint and the button or copy
  block. Home tiles show a small count when it is above zero.
- Agents: `get_next` returns `{chore: finding}` when nothing is claimable and the project has
  findings an agent can fix (the fix hint names the tool); `get_context` adds `audit: {count,
  on_my_tickets: [...]}`.
- Protocol 2.10: start section adds "when get_next offers a chore, do it".
- Done when: the three stale-decision findings on zigzag and filmia are gone after three clicks
  and `get_next` on a quiet project offers a state-note fix.

### Fix d. Evidence timeline in the ticket sheet

- The sheet's "Evidencia" list becomes a timeline: verdict glyph in tone, kind, cite, the commit
  (seven chars, linked to the PR when known), the command in a code line when present, counts,
  duration, `stale_for_head` as a muted "en commit anterior" chip. Checks that a result ticked show
  "☑ 2, 3" on the row.
- `GET /api/projects/:slug/tasks/:key` already returns results; add `stale_for_head` and
  `ticked_checks` to the shape.
- Done when: a Done ticket's sheet tells, without opening GitHub, what ran and against which commit.

---

## 2.12 Intent and the day

### Item 5. Pedir: Jorge's requests become tickets

- Migration 0025: `tasks.origin text not null default 'agent'` (`agent | jorge | import`).
- `POST /api/projects/:slug/tasks {title, summary?, priority?, parent_key?}` creates a Backlog
  ticket as Jorge with `origin: "jorge"`, server-assigned key, event `task.created` by jorge.
- UI: a "Pedir" box on the project header (title, optional line, optional initiative picker,
  priority defaults to P2) and on home a one-field version with a project picker, both usable on
  the phone. The new ticket opens in the sheet.
- Agents: `get_resume`, `get_context` and `get_next` list `requests` (open tickets with
  `origin: "jorge"`, newest first) above the backlog; `get_next` offers a request before any other
  Backlog ticket of equal priority.
- Protocol 2.11: start section adds "requests are what Jorge asked for; read them first".
- Done when: a sentence typed on the phone is the next ticket an agent claims.

### Item 6. "Hoy" strip and push notifications

**Hoy**

- `GET /api/digest?since=<cursor>` wraps `getDigest` with reader `"screen"`; the UI stores the
  cursor in localStorage per device (`rememberCursor` only when Jorge taps "Visto").
- Home shows a strip above the city: per project the digest highlights (done, to review, PRs,
  claims) as chips and the `needs_jorge` items as links to Pasos; "Visto" clears it.

**Push** (needs the HTTPS decision below)

- Migration 0026: `push_subscriptions {id, endpoint unique, keys jsonb, user_agent, created_at,
  last_ok_at, failed_at}`.
- `web-push` dependency; VAPID keys in `.env` (`PLANIA_VAPID_PUBLIC/PRIVATE/SUBJECT`);
  `POST /api/push/subscribe`, `DELETE /api/push/subscribe`.
- `ui/sw.js` gains `push` and `notificationclick` handlers (open `/inbox` on the right tab).
- Server: on events `approval.requested`, `question.asked`, `blocker.parsed`/`blocker.created`
  (human_action), `release.ready`, send one notification per subscription, batched per minute so a
  burst is one message; `410` removes the subscription.
- UI: a switch in the phone menu "Avisarme cuando me toque".

**HTTPS**: the server stays on 127.0.0.1; `tailscale serve --https=443 http://127.0.0.1:3737`
exposes it on the tailnet with a real certificate; the session cookie's `secure` flag already
expects HTTPS. This is the "decide later" from the PWA work and needs Jorge's yes.

- Done when: a question asked by an agent reaches the phone within a minute and opens Decisiones.

---

## 2.13 Agent surface

### Item 7. Two composite tools and write-time guards

- `start {key, workspace, session_id}`: `get_context` for the workspace plus `claim` on the key in
  one call; returns the context shape with `claim` and any handoff note. Errors are claim's.
- `finish {key, result, pr_url, branch, version}`: `add_result` then `set_task status In review`
  in one transaction; `CHECKS_OPEN` lists the numbers with each check's text; `EVIDENCE_STALE`
  explains the head. Optionally `note` for the initiative's next_action.
- Guards at write time (`writes.ts`): Done, Merged or Released on a ticket whose `work_type` is
  code without `pr_url` is refused with `TASK_MISSING_PR_URL` unless `no_pr_reason` is given;
  `ask` returns the question id with "the ticket waits in Needs Jorge" so agents stop writing it
  in text; a `set_task` with a Jorge line keeps the 2.10 warning.
- Protocol 2.12 rewritten in three sections, Start / Work / Finish, under 900 words, listing
  `start`, `finish`, `get_next`, `ask`, `register_footprint` first; the
  rules every tool already explains move to the tool descriptions.
- `scripts/mcp-table.ts` from 2.9 keeps the README in step.
- Done when: a fresh agent session on a filmia ticket goes start → finish without a protocol read
  beyond the instructions, and the audit shows no new `TASK_MISSING_PR_URL` in a week.

### Item 2, phase two. Ship a release from the screen

- `settings.release.mode: "command" | "merge"`; `merge` requires `GITHUB_TOKEN` with contents
  write for that repo (Jorge's call, per repo).
- `POST /api/projects/:slug/release/ship` as Jorge: opens or reuses a PR `from → into`
  titled "Release: <keys>" with the ticket list in the body, merges it with `gh pr merge --merge`
  (keeps history, matches the pinned decisions that Jorge alone merges), writes `release.merged`
  with the merge sha, and the poller moves tickets to Released on the deploy.
- UI: the release row gets a "Lanzar" button with a confirm sheet repeating the plan; disabled
  while a before-step is open or the plan has open checks.
- Done when: a filmia release ships from the phone and the Vercel poller closes it.

---

## What Jorge decides before each release

- 2.9: approve dropping the Vercel path for good (Plania stays on the Mac).
- 2.10: the `settings.release` triple per project; confirm the ff-only command is the real flow
  for filmia, micasa and zigzag.
- 2.11: whether the hand-written headline keeps a pencil at all (the plan keeps it as a note).
- 2.12: HTTPS over Tailscale for the phone, and VAPID keys in `.env`.
- 2.13: a GitHub token with contents write per repo, or stay in command mode.

## How this plan should live

Plania is the source of the plan. Once approved, file it there as five initiatives under the PLA
project (`PLA-I2` to `PLA-I6`), one phase per item, with this document attached by `attach_doc`
and the "done when" lines as each phase's checks. The branch for each is `jl/plania-2-<n>`.
