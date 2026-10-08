# Reply to "Plania Requests from Filmia" (2026-10-07)

One line per request, in the format the review asked for. Targets are protocol releases; 2.1, 2.2 and 2.3 are built
on branch `jl/plania-changes-planning-a0112b` (migrations 0015–0018), not yet deployed. Decisions behind the changes:
hosting and a remote endpoint are out of scope; GitHub and Vercel are polled from the Mac, never webhooks; approvals
happen only on screen, as Jorge; keys moved to the scheme R-33 asked for, in one rekey.

```
R-01  Accept            target: 2.1   API: get_resume(include_legacy), archive_legacy_card(project, reason); legacy job archives once v2 data exists; LEGACY_CARD_EMPTY
R-02  Accept w/ change  target: 2.1/2.2  API: get_resume.status (envs with drift, initiatives with counts/next/waiting/in_review+PR, queues, audit_findings), set_project(headline ≤280) with headline_stale; audit count arrives with 2.3
R-03  Accept            target: 2.3   API: get_context(project, workspace{branch,worktree_path,machine}, session_id, since_cursor); UNKNOWN_BRANCH
R-04  Accept w/ change  target: 2.1   change: tokens on the local server only, hosting deferred. API: /tokens page, scopes read|write|ops, actor filled from the token; ACTOR_MISMATCH, ACTOR_REQUIRED; events.token_id; revoke stops the next call
R-05  Accept w/ change  target: 2.1   change: approval via UI only, no chat codes. API: request_approval(key, action, reason, target), set_task(approval_id), waive_check(approval_id); HUMAN_ONLY, APPROVAL_NOT_FOUND, APPROVAL_MISMATCH, APPROVAL_NOT_GRANTED, APPROVAL_USED, APPROVAL_REQUIRED; confirm_by_jorge removed
R-06  Accept            target: 2.3   API: handoff(key, to: session_id|open, note, head_sha); HANDOFF_HELD (10 min); claim reply carries the note; get_task.workspace_history
R-07  Accept w/ change  target: 2.2   change: SSE, not MCP notifications (/mcp is stateless). API: GET /mcp/events?project&since&key&types (replay from the cursor, then live); events question.answered, blocker.satisfied, task.rescoped, claim.expiring, approval.granted, pr.ci_failed
R-08  Accept            target: 2.1   API: create_task without key → PREFIX-I<n> | PREFIX-<nn> | <initiative>-<n>; explicit keys still accepted; KEY_BELOW_COUNTER; never reissued
R-09  Accept w/ change  target: 2.2   change: integration_branch is the initiative's branch column. API: set_task(integration_branch, share_branch, share_reason), claims default to it, get_project.branches, settings.branch_pattern; BRANCH_IN_USE, BRANCH_NAME_INVALID; merged/deleted state from the poller
R-10  Accept w/ change  target: 2.2   change: quotas reset at UTC midnight; policies in settings. API: lease_resource(name, ttl_minutes, purpose, approval_id), release_resource, consume(name, n); settings.resources/quotas; RESOURCE_HELD, QUOTA_EXCEEDED, INVALID_RESOURCE
R-11  Accept            target: 2.2   API: areas[] on tickets and initiatives; claim reply warnings[] on overlap
R-12  Accept w/ change  target: 2.2   change: moved by the pollers within one tick (60 s) while the Mac is up; CI red sends In review → Ready (not In progress). API: statuses Merged, Released; by hand only with a ci pass naming the merge commit; settings.release_target; Done stays Jorge's
R-13  Accept            target: 2.1   API: CHECKS_OPEN [n…] on In review/Merged/Released/Done; waive_check(key, n, reason, approval_id); set_check(text) amends (check.amended); INITIATIVE_CHILDREN_OPEN
R-14  Accept            target: 2.3   API: checks[].derived_from; set_check(evidence_id) takes any result of the project and replies source
R-15  Accept w/ change  target: 2.2   change: metrics come from set_metric / result.metrics / POST /hooks/metric. API: blocked_by {human_action}, {env_flag}, {time_after}, {metric_gte}; settings.claim_from; auto Blocked → Ready (blocker.satisfied); INVALID_BLOCKER, INVALID_METRIC
R-16  Accept            target: 2.3   API: set_task(state_note) with stale; a status heading in scope warns; audit INITIATIVE_STATE_NOTE_STALE
R-17  Accept w/ change  target: 2.2   change: attachments are links only. API: add_result(commit, branch, env, command, exit_code, counts, duration_s, attachments, viewport, device, metrics); kinds e2e|visual|a11y|perf|security|migration; stale_for_head; EVIDENCE_STALE
R-18  Accept w/ change  target: later change: no tables yet; a "Test plan" doc plus structured results with counts cover it until a per-case diff is needed
R-19  Accept            target: 2.2   API: work_type bug (severity S1–S4, found_in, introduced_by, regression) and debt (cost_note); list_tasks(severity); status.s1_s2_bugs; INVALID_SEVERITY
R-20  Accept            target: 2.2   API: set_env(deployed: {provider, deployment_id, url}, migrations[], flags{}); DEPLOY_SOURCE_REQUIRED, SECRET_LIKE_VALUE; any number of envs
R-21  Accept w/ change  target: 2.2   change: polling, not webhooks. GitHub: PRs linked by pr_url / "Plania: KEY" / "Plania-Task: KEY", check runs as ci results, merges, branch heads and deletions, compare for releases; Vercel: READY deployments → set_env with source; settings.github/vercel, tokens in .env
R-22  Accept            target: 2.3   API: get_project.releases (env, commit, deployed_at, source, tasks, prs, migrations new since the previous release)
R-23  Accept            target: later not built yet; approvals already cover an approval-gated step (action runbook_step is reserved)
R-24  Accept            target: 2.1   API: add_decision(supersedes: string | string[]), retire_decision(decision_id, reason); get_memory hides superseded and retired by default; DECISION_RETIRED
R-25  Accept            target: 2.1/2.3  API: answer(decision_text?) writes a decision only when given; audit DECISION_STALE_REF
R-26  Accept            target: later not built yet
R-27  Accept w/ change  target: later not built yet; would be a reserved _shared project
R-28  Accept            target: 2.1   API: get_inbox(project | all); GET /api/inbox, POST /api/approvals/decide (one event each), /inbox page with batch approve; human actions and Released tickets added in 2.2
R-29  Accept            target: 2.1   API: batch(ops[], atomic, request_id); BATCH_FAILED {index, op, failed}; non-atomic replays by request_id
R-30  Accept            target: 2.1   API: writes answer {key, status, version, changed}; verbose; get_task(view: summary|full, fields, include_log); log via list_events
R-31  Accept            target: 2.3   API: audit(project) with the listed codes (+ MERGED_CHECKS_OPEN); every 10 min; count in get_resume.status
R-32  Accept            target: later waits until every legacy card is archived on the real database
R-33  Accept w/ change  target: 2.1   change: no F in phase keys, no B prefix for bugs. API: keys FIL-I<n>, FIL-<nn>, FIL-I<n>-<m>; aliases on every response; task.rekeyed; pnpm rekey --project filmia
```
