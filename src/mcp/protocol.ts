// The working protocol, served as the MCP server's instructions so every client and every product
// repo reads the same version. Project-specific additions live in the project's rules (set_project).
// Bump PROTOCOL_VERSION whenever the text changes meaning.

export const PROTOCOL_VERSION = "2.17";

// 2.17: the old screen step was removed (PLA-I18). Ideas move stage by stage with only the stage doc checked.
// ask ignores a removed field from an older client and the reply says so. Old question rows stay as read-only history.
// 2.16: get_resume, list_projects and get_digest carry read-only readiness. Unknown data is caution.
// The screen shows the server's reason text, including ENV_UNKNOWN.
// 2.15: the screen still answers a human-only question with a click. When the owner is away, only
// actor agent plania-bot may record one answer he gave in his own chat, with message id and quote.
// The server cannot prove that caller or that message. 2.13 kept three sections, Start / Work /
// Finish, under 900 words. What a single tool already explains lives in that tool's description
// (register.ts); this text says the order and what never to do.
const PROTOCOL = `Plania protocol ${PROTOCOL_VERSION}. Plania is the source of the plan; product repos hold code and conventions, not plans. The tools you need most: start, finish, get_next, ask, request_approval, register_footprint. Each tool's description carries its own rules and errors; this text is the order of work.

Identity. Every write takes actor {agent, session_id, machine, model}. Use one session_id for the whole session: it owns your claims. Never write as jorge. An agent token fills agent and machine.

Start
1. Know your ticket? start {key, workspace {worktree_path, branch}}: it claims the ticket and returns the context in one call (initiative, tickets on the branch, your claims, pinned decisions, open questions, approvals, footprint, audit findings on your tickets, and any handoff note left for you). Read the pinned decisions before writing code.
2. No ticket yet? get_next offers one (P0 first, Jorge's requests before others of their priority); then start it. When it offers a chore instead (an audit finding an agent can fix, a stale state_note), do the chore.
3. requests (in start, get_context, get_resume and get_next) are what Jorge asked for on screen: read them first. A request is a sentence; whoever takes it writes its scope and checks.
4. Reading without working: get_resume (where the project stands), get_project (stack, settings, env, branches, the release step), get_memory (rules, docs, decisions), get_task. Watching all projects: get_digest, list_projects, get_running. get_resume, list_projects and get_digest include readiness, and it is read-only. Precedence: no_context (nothing to resume and no event in 14 days), then blocked (open blocker, red check, failed or lagging deploy on a review ticket, overlapping claims, or a human decision on that ticket), then caution (stale lease, owner missing from the machine, quiet claim, dirty or unknown worktree, ENV_UNKNOWN, stale note, pending or unreadable check, or a human decision elsewhere), else ready. Unknown or missing data is caution, never ready. The screen shows the server's reason text.

Work
5. Keep the lease: claim action heartbeat before it runs out (key "*" for every ticket you hold). Leaving mid-ticket: handoff {to, note, head_sha}.
6. Writes that change fields carry the version you read; STALE_VERSION means re-read, merge, retry. Notes need no version: prefer a note to rewriting scope. Several writes at once: batch.
7. Evidence is a record: add_result with what ran, the commit and the counts; check_ns ticks the checks it proves. A check that will not be done: waive_check with the reason, before review.
8. Need Jorge to decide? ask: the ticket waits in Needs Jorge and the question reaches his inbox; never only write "waiting on Jorge" in a field. A human_only question is answered on the owner's screen. When he is away he may tell actor agent plania-bot in his own chat; only that agent may call answer_delegated, for one named option or for a wont_do or reopen approval, and only with delegated_by_jorge {message_id, quote}. The server cannot prove the caller is that bot or that the message exists: the quote, the audit, the Delegada badge, 10 an hour, one per question, and a screen kill switch (default on) are the controls. That tool cannot raise the limit or flip the switch. Any other agent, and the answer tool, is refused. Never forward an answer. Need him to do something? blocked_by human_action (a line that starts with "Jorge:" becomes one and warns). A move you may not make (Won't do, reopening, a waiver once in review, a resource that needs one): request_approval, then pass the approval_id he grants.
9. Started something that outlives the command (a dev server, a database copy, a container, a tunnel)? register_footprint with its teardown, and release_footprint once it is gone. Tests and builds are not registered. Never touch a live database for tests.
10. Decisions go to add_decision (one line, pinned if it must be kept); specs and plans to attach_doc, never a plan file on one machine. Shared numbers (a migration): reserve_sequence. Shared things (a port, the production migrate step): lease_resource.

Finish
11. Commit, push, open the PR with "Plania: <KEY>" in its body, then finish {key, result, pr_url, branch}: the result and the move to In review land together or not at all. Every check must be done or waived (CHECKS_OPEN lists what is left) and the pass must name the branch head (EVIDENCE_STALE says which).
12. The pollers move the ticket to Merged when the PR merges and to Released when the release target runs it. Never merge a PR, and never merge a release branch into another: a merged ticket waits in the release step until Jorge ships it.
13. Close what you finished: set_task Done once it is Merged or Released (ops and research from In review). A code ticket closes with its pr_url (TASK_MISSING_PR_URL), or no_pr_reason when there was none. An initiative is Done once all its tickets are closed. Won't do and reopening are Jorge's.
14. Leave the initiative current: finish's note (or set_task) updates its next_action; state_note is optional commentary. The headline is generated.

Never type dates: the server stamps them. Pass request_id on writes you may retry. Errors come back as {error, status, ...detail}; 409 means the state moved or someone else holds it: re-read before deciding.`;

const READ_ONLY = `This connection is read-only (a planning token): every read tool works; writes are not available. Hand your plan to a session with a write token.`;

export function instructions(readOnly: boolean): string {
  return readOnly ? `${PROTOCOL}\n\n${READ_ONLY}` : PROTOCOL;
}
