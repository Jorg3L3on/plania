// The working protocol, served as the MCP server's instructions so every client and every product
// repo reads the same version. Project-specific additions live in the project's rules (set_project).
// Bump PROTOCOL_VERSION whenever the text changes meaning.

export const PROTOCOL_VERSION = "2.1";

const PROTOCOL = `Plania protocol ${PROTOCOL_VERSION}. Plania is the source of the plan; product repos hold code and conventions, not plans.

Identity. Every write takes actor {agent, session_id, machine, model}. Use one session_id for your whole session: it owns your claims. Never write as jorge.

Start. get_resume (live claims, next claimable, per initiative: notes, must-keep decisions; open questions), get_project (stack, env per environment, reserved sequence numbers, project rules), get_memory (rules, design docs, decisions), then get_task. Or get_next.

Keys. The server assigns them: omit key on create_task. PREFIX-I<n> is an initiative, PREFIX-<nn> a standalone ticket, <initiative>-<n> a phase (phase is its own field). A moved ticket gets a new key and keeps the old one as an alias; every tool accepts aliases and answers with the canonical key. Every task reference carries kind and parent_key.

Replies. Writes answer {key, status, version, changed}; pass verbose: true when you need the full task back. get_task view summary is the cheap read; the log is paged with list_events {key, since} (include_log: true embeds the last 50). Several writes at once: batch (atomic by default; BATCH_FAILED names the op that failed and nothing is written).

Work a ticket.
1. claim it, with workspace {worktree_path, branch}. CLAIM_HELD: someone else holds it; pick another. Send claim action heartbeat before the lease runs out (default 30 min).
2. Writes carry the version you read (get_task). STALE_VERSION: re-read, merge, retry. A note (set_task note) needs no version: prefer notes to rewriting scope.
3. Tick Done when items with set_check. Record evidence with add_result (kind unit|integration|test|verify|live|grep|subagent|ci, verdict pass|warn|fail, cite, url for CI runs or screenshots).
4. Need a number that must not collide (a migration)? reserve_sequence. Need Jorge? ask (the ticket waits in Needs Jorge). When he answers in chat, record it with answer, quoting him; add decision_text only when the answer settles something worth keeping.
5. Decisions: add_decision, one line, with task_key; pin it if it must be kept; supersedes when it reverses an earlier one. Specs, plans and ADRs: attach_doc, never a plan file on one machine.
6. Blocked by a deploy rather than a ticket? blocked_by {env, condition, value}. After a deploy you ran, set_env.
7. Finish: add_result, then set_task status In review with branch and pr_url (this releases the lease). Update the initiative's next_action / in_progress_note if the plan moved.
8. Never set Done or Won't do: Jorge does, on screen. Only if he explicitly asks you: confirm_by_jorge with reason.

Never type dates: the server stamps everything in UTC. Before acting on a ticket you read a while ago, list_events since your last cursor. Pass request_id on writes you may retry after a timeout.
Errors come back as {error, status, ...detail}; 409 means the state moved or someone else holds it: re-read before deciding.`;

const READ_ONLY = `This connection is read-only (a planning token): every read tool works; writes are not available. Hand your plan to a session with a write token.`;

export function instructions(readOnly: boolean): string {
  return readOnly ? `${PROTOCOL}\n\n${READ_ONLY}` : PROTOCOL;
}
