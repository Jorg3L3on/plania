// Every contract error, with its HTTP-style status and when it happens. ToolError only accepts these
// codes, so a new one cannot ship undocumented; the README catalog and a test are checked against this.
export const ERRORS = {
  // 400: the request itself is wrong; retrying it unchanged fails again.
  BLOCKED_REQUIRES_NOTE: [400, "status Blocked without a note (create_task cannot block: it takes no note)"],
  BODY_REMOVED: [400, "body is gone in v2: use scope, checks, and note (the log)"],
  BLOCKER_NOT_FOUND: [400, "a blocked_by key does not exist in this project, or names the task itself"],
  FIELD_NOT_ALLOWED: [400, "a field of the other kind: priority/parent_key/origin/work_type/phase on an initiative, base_branch/next_action/in_progress_note on a ticket"],
  INVALID_ENV: [400, "set_env: env is not lowercase [a-z][a-z0-9_-]*, a commit is not 7-40 hex, or migrations_applied is not a count"],
  INVALID_ENV_CONDITION: [400, "an env blocker's condition or value is wrong (contains_commit <sha>, migration_gte <n>, deployed_after [ISO])"],
  INVALID_FILTER: [400, "a list filter is malformed (detail: field), e.g. updated_since is not an ISO-8601 time"],
  INVALID_PHASE: [400, "phase is not an integer 0..999"],
  INVALID_PRIORITY: [400, "priority is not P0, P1, P2 or P3"],
  INVALID_QUESTION: [400, "ask with an empty question, or answer with an empty answer"],
  INVALID_RESULT: [400, "add_result kind, verdict or cite is not valid, or check_ns with a verdict other than pass"],
  INVALID_SEQUENCE: [400, "sequence name is not lowercase [a-z][a-z0-9_-]*, or a number is out of range"],
  INVALID_STATUS: [400, "status is not in the task kind's vocabulary, or not allowed at creation"],
  INVALID_TTL: [400, "ttl_minutes outside 5..240"],
  INVALID_WORK_TYPE: [400, "work_type is not code, ops, research or decision-needed"],
  OVERRIDE_REQUIRES_REASON: [400, "confirm_by_jorge without a reason"],
  PARENT_MUST_BE_INITIATIVE: [400, "parent_key names a ticket"],
  RESERVED_ACTOR: [400, "actor.agent is jorge: only the screen writes as Jorge"],
  TEMPLATE_INVALID: [400, "create_task: a ticket without scope, or a code/ops ticket without checks (detail: missing)"],
  TEXT_HAS_DATE: [400, "decision text starts with a date: the server stamps dates"],
  TOO_LARGE: [400, "a text field exceeds its limit (detail: field, max)"],
  VERSION_REQUIRED: [400, "set_task changes fields without the version you read"],
  // 403: only Jorge may do this.
  HUMAN_ONLY: [403, "Done, Won't do or reopening them: Jorge's call, on screen or with confirm_by_jorge + reason"],
  // 404: something named does not exist.
  CHECK_NOT_FOUND: [404, "no check with that n on this task"],
  DECISION_NOT_FOUND: [404, "supersedes names no decision of this project"],
  DOC_NOT_FOUND: [404, "no doc with that id in the project, or replacing (version given) a title that does not exist"],
  INITIATIVE_NOT_FOUND: [404, "get_next initiative_key is not an initiative of this project"],
  PROJECT_NOT_FOUND: [404, "unknown project slug"],
  QUESTION_NOT_FOUND: [404, "no question with that id in this project"],
  RESULT_NOT_FOUND: [404, "evidence_id is not a result of this task"],
  TASK_NOT_FOUND: [404, "unknown key in this project (also an unknown parent_key or task_key)"],
  // 409: the state changed or is held by someone else; re-read, then decide.
  ALREADY_SUPERSEDED: [409, "the decision named in supersedes was already reversed (detail: superseded_by)"],
  ALREADY_ANSWERED: [409, "the question was answered already (detail: answer, answered_by)"],
  CLAIM_HELD: [409, "another session holds a live lease (detail: owner, lease_until, workspace)"],
  DOC_EXISTS: [409, "attach_doc without version for a title that exists (detail: doc_id, version): pass version to replace"],
  EVIDENCE_REQUIRED: [409, "In review without evidence for the work_type from the current claim (detail: accepts, since)"],
  INVALID_TRANSITION: [409, "the status change is not allowed from the current status (detail: from, to, hint)"],
  KEY_EXISTS: [409, "create with a key that exists; creates are not idempotent without request_id"],
  LEASE_EXPIRED: [409, "heartbeat after your lease ran out: claim again"],
  NOT_CLAIMABLE: [409, "the ticket cannot be claimed (detail: status, or unsatisfied blocked_by)"],
  REQUEST_ID_REUSED: [409, "request_id was already used by a different tool in this project"],
  NOT_OWNER: [409, "another session holds a live lease on this task (detail: owner, lease_until)"],
  SEQUENCE_TAKEN: [409, "the requested sequence value is held by another live ticket"],
  STALE_VERSION: [409, "the task (or doc) changed since you read it (detail: current_version)"],
} as const satisfies Record<string, readonly [400 | 403 | 404 | 409, string]>;

export type ErrorCode = keyof typeof ERRORS;

export class ToolError extends Error {
  readonly status: 400 | 403 | 404 | 409;

  constructor(
    readonly code: ErrorCode,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
    this.status = ERRORS[code][0];
  }
}
