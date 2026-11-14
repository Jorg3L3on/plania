import type { Db } from "../db/client.js";
import type { Actor, Project, questions, Task } from "../db/schema.js";
import { storeOf, readerOf } from "../store/port.js";
import { openHumanActions, unsatisfiedBlockers } from "./blockers.js";
import { footprintFindings } from "./footprint-audit.js";
import { WAITING_ON_JORGE, isGating, parseJorgeLines } from "./jorge-lines.js";
import { prefixOf } from "./keys.js";
import { releasePending, releasePlan } from "./release-plan.js";
import { isScreenActor, iso, type Q } from "./tx.js";

// The project audit (R-31): what the server can see is wrong, from data it already has. Pure
// reads, one function per finding code; `audit(project)` runs them on demand and the audit job
// every ten minutes, storing the last run so the status block can show the count.

// 2.11: id names what a one-click fix acts on (a decision id, an env, a branch, a worktree path) and
// command is the shell line Jorge copies, when the fix is one (src/mcp/orden.ts).
export type Finding = { code: string; key: string | null; detail: string; fix_hint: string; id?: string; command?: string; level?: "info" | "warn" };

/** Scope says the ticket must wait, and nothing typed holds it. */
/** Won't do with no screen actor and no delegated evidence, and no historical granted wont_do row. */
export const WONT_DO_WITHOUT_EVIDENCE = "WONT_DO_WITHOUT_EVIDENCE";

export const CLAIMABLE_BUT_WAITING = "CLAIMABLE_BUT_WAITING";
/** Previous code, one release. Same finding as CLAIMABLE_BUT_WAITING. */
export const CLAIMABLE_BUT_GATED = "CLAIMABLE_BUT_GATED";

export const AUDIT_CODE_ALIASES: Record<string, string> = {
  [CLAIMABLE_BUT_GATED]: CLAIMABLE_BUT_WAITING,
};

export function canonicalAuditCode(code: string): string {
  return AUDIT_CODE_ALIASES[code] ?? code;
}

const CLOSED = ["Done", "Won't do"];
// A ticket that has not reached In review yet (PLA-03 drift).
export const DRIFT_STATUSES = ["Backlog", "Ready", "In progress", "Blocked", "Needs Jorge"];
export { WAITING_ON_JORGE };
const SHA = /\b[0-9a-f]{7,40}\b/g;
const PR = /pull\/(\d+)|#(\d{2,6})\b/g;
// A Plania key token, case-sensitive: a three-letter uppercase project prefix (FIL, ZIG, PLA, MIC, WRK)
// then -I<n>, -I<n>-<n>, -IDEA<n> or -<n>. Lowercase branch names such as web-i2 are not keys.
// This project's own keys are matched separately, so a lowercase copy of a real key still counts.
const KEY_SHAPE = /(?:^|[^A-Za-z0-9])[A-Z]{3}(?:-IDEA\d+|-I\d+(?:-\d+)?|-\d+)(?![A-Za-z0-9])/;

// Title and head branch are the PR fields the poller stores. The body is not a column, so a
// "Plania: KEY" line there is invisible. A linked pull_requests row (task_id, or a task whose
// pr_url is this url) is the minimum entry: it always has a title, possibly empty, and a
// head_branch, possibly null. A pr_url that never became a row (a result url, a release ship)
// has no title and no branch, and is not guessed at.
function prCarriesPlaniaKey(title: string, branch: string | null, prefix: string, keys: readonly string[]): boolean {
  const raw = `${title}\n${branch ?? ""}`;
  if (KEY_SHAPE.test(raw)) return true;
  const blob = raw.toUpperCase();
  const esc = (token: string) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (prefix && new RegExp(`(?:^|[^A-Z0-9])${esc(prefix.toUpperCase())}(?:-IDEA\\d+|-I\\d+(?:-\\d+)?|-\\d+)(?![A-Z0-9])`).test(blob)) return true;
  return keys.some((k) => new RegExp(`(?:^|[^A-Z0-9])${esc(k.toUpperCase())}(?![A-Z0-9])`).test(blob));
}

export async function auditProject(db: Q, p: Project): Promise<Finding[]> {
  const out: Finding[] = [];
  const store = readerOf(db);
  const all = await store.find("tasks", { projectId: p.id }, { orderBy: [{ column: "key" }] });
  const byId = new Map(all.map((t) => [t.id, t]));
  const ids = all.map((t) => t.id);
  const prs = await store.find("pullRequests", { projectId: p.id });
  const prOf = (t: Task) => prs.filter((pr) => pr.taskId === t.id).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const env = p.settings.release_target ?? "prod";
  const envs = await store.find("envStates", { projectId: p.id });
  const target = envs.find((e) => e.env === env);
  const openChecks = ids.length ? await store.find("checks", { taskId: ids, done: false, waivedAt: null }) : [];
  // Every typed blocker of the project's tasks, read once for the findings below that look at them.
  const typedBlockers = ids.length ? await store.find("blockers", { taskId: ids }) : [];
  const openOf = (t: Task) => openChecks.filter((c) => c.taskId === t.id).map((c) => c.n);

  // Tickets in review whose PR already merged, and merged ones not released though the target has the commit.
  for (const t of all.filter((t) => t.status === "In review")) {
    const pr = prOf(t);
    if (pr?.state === "merged") out.push({ code: "REVIEW_PR_MERGED", key: t.key, detail: `PR #${pr.number} merged ${iso(pr.mergedAt)}`, fix_hint: "the poller moves it to Merged on its next tick; check settings.github" });
  }
  // PLA-03: a merged PR whose ticket never reached In review. Nothing moves it; it is only said.
  for (const t of all.filter((t) => t.kind === "ticket" && DRIFT_STATUSES.includes(t.status))) {
    const pr = prOf(t) ?? prs.find((x) => !!t.prUrl && x.url === t.prUrl);
    if (pr?.state === "merged") {
      out.push({
        code: "PR_MERGED_TICKET_OPEN",
        key: t.key,
        detail: `PR #${pr.number} merged ${iso(pr.mergedAt)} but the ticket is ${t.status}`,
        fix_hint: "finish it (In review) if the PR is its work, or unlink the PR; nothing moves it on its own",
        id: pr.url,
      });
    }
  }
  // Done or merged with open checks.
  for (const t of all.filter((t) => t.status === "Done")) {
    const open = openOf(t);
    if (open.length) out.push({ code: "DONE_CHECKS_OPEN", key: t.key, detail: `checks ${open.join(", ")} neither done nor waived`, fix_hint: "waive_check with the reason, or set_check done with evidence" });
  }
  for (const t of all.filter((t) => t.status === "Merged" || t.status === "Released")) {
    const open = openOf(t);
    if (open.length) out.push({ code: "MERGED_CHECKS_OPEN", key: t.key, detail: `checks ${open.join(", ")} open after the merge`, fix_hint: "waive_check with the reason, or add the missing evidence" });
  }
  // Initiatives closed with open children, or a status section inside the spec.
  for (const i of all.filter((t) => t.kind === "initiative")) {
    const children = all.filter((t) => t.parentId === i.id);
    if (CLOSED.includes(i.status)) {
      const open = children.filter((c) => !CLOSED.includes(c.status));
      if (open.length) out.push({ code: "INITIATIVE_CHILDREN_DONE", key: i.key, detail: `${open.map((c) => c.key).join(", ")} still open`, fix_hint: "close the tickets or reopen the initiative" });
    }
    // 2.11: a stale state_note is a flag on the note (get_task state_note.stale), no longer a finding: the state is derived.
    if (/^#{1,3}\s*(estado|status)\b/im.test(i.scope)) out.push({ code: "INITIATIVE_SCOPE_HAS_STATUS", key: i.key, detail: "scope holds a status section", fix_hint: "move it to state_note; scope is the spec" });
  }
  // Decisions that cite a commit or PR the release target has moved past, or contradict a Done ticket's plan.
  const live = await store.find("decisions", { projectId: p.id, retiredAt: null });
  const superseded = new Set((await store.find("decisionSupersessions")).map((r) => r.supersedesId));
  // The target env's known commits, read the first time a decision needs them.
  let targetCommits: string[] | undefined;
  for (const d of live.filter((d) => !superseded.has(d.id))) {
    const shas = [...d.line.matchAll(SHA)].map((m) => m[0]).filter((s) => /[a-f]/.test(s) && /\d/.test(s));
    if (target?.commit && shas.length && !shas.some((s) => target.commit!.startsWith(s) || s.startsWith(target.commit!))) {
      targetCommits ??= (await store.find("envCommits", { projectId: p.id, env })).map((c) => c.sha);
      // A cited sha is a prefix of a commit the env ran (SHA matches hex only, so a prefix test is the old LIKE).
      const ran = targetCommits.filter((sha) => shas.some((s) => sha.startsWith(s))).length;
      if (ran > 0) out.push({ code: "DECISION_STALE_REF", key: d.taskId ? (byId.get(d.taskId)?.key ?? null) : null, detail: `decision ${d.id.slice(0, 8)} cites ${shas.join(", ")}; ${env} is at ${target.commit.slice(0, 7)}`, fix_hint: "retire_decision, or add_decision with supersedes", id: d.id });
    }
    const prNumbers = [...d.line.matchAll(PR)].map((m) => Number(m[1] ?? m[2]));
    const mergedCited = prs.filter((pr) => prNumbers.includes(pr.number) && pr.state === "merged");
    if (mergedCited.length && d.pinned) out.push({ code: "DECISION_STALE_REF", key: d.taskId ? (byId.get(d.taskId)?.key ?? null) : null, detail: `pinned decision ${d.id.slice(0, 8)} cites merged PR #${mergedCited[0]!.number}`, fix_hint: "retire_decision once it is done, or unpin", id: d.id });
    if (d.taskId) {
      const t = byId.get(d.taskId);
      if (t && t.status === "Won't do" && d.pinned) out.push({ code: "DECISION_CONTRADICTS_DONE", key: t.key, detail: `pinned decision ${d.id.slice(0, 8)} about a Won't do ticket`, fix_hint: "retire_decision", id: d.id });
    }
  }
  // Environments.
  for (const e of envs) {
    if (e.commit && !e.deployedAt) out.push({ code: "ENV_DEPLOYED_AT_MISSING", key: null, detail: `${e.env} runs ${e.commit.slice(0, 7)} with no deployed_at`, fix_hint: "set_env deployed with the provider's record, or let the Vercel poller fill it", id: e.env });
  }
  // 2.10: with a release step, drift is that step's to show: ENV_DRIFT points at it instead of repeating it.
  const plan = p.settings.release ? await releasePlan(db, p) : null;
  // The branches still on origin, for ENV_DRIFT and the branch findings further down.
  const known = await store.find("branches", { projectId: p.id, deletedAt: null });
  if (target?.commit) {
    for (const i of all.filter((t) => t.kind === "initiative" && !CLOSED.includes(t.status) && t.branch)) {
      const head = known.find((b) => b.name === i.branch)?.headSha;
      if (head && !head.startsWith(target.commit) && !target.commit.startsWith(head) && known.find((b) => b.name === i.branch)?.mergedAt) {
        out.push(
          releasePending(plan)
            ? { code: "ENV_DRIFT", key: i.key, detail: `${i.branch} merged; it ships with the release step ${plan.from.branch} → ${plan.into.branch} in Jorge's inbox`, fix_hint: "nothing to do here: the release step (get_resume.status.release) is Jorge's" }
            : { code: "ENV_DRIFT", key: i.key, detail: `${i.branch} merged but ${env} still runs ${target.commit.slice(0, 7)}`, fix_hint: "deploy, then set_env (or wait for the poller)" },
        );
      }
    }
  }
  // Blocked tickets whose blockers all hold; claimable tickets that say "not before".
  // A Blocked ticket counts when it waits on a ticket or on a typed blocker that holds claims (a line parsed
  // from free text outside blocked_note does not), and no blocker of it fails: the rule promoteUnblocked applies.
  const blocked = all.filter((t) => t.status === "Blocked");
  const waitsOnTicket = new Set(blocked.length ? (await store.find("taskBlockers", { taskId: blocked.map((t) => t.id) })).map((l) => l.taskId) : []);
  for (const t of blocked) {
    const hasBlockers = waitsOnTicket.has(t.id) || typedBlockers.some((b) => b.taskId === t.id && isGating(b.spec));
    if (!hasBlockers || (await unsatisfiedBlockers(db, t)).length) continue;
    out.push({ code: "BLOCKED_BUT_SATISFIED", key: t.key, detail: "every blocker holds", fix_hint: "the server promotes it on the next write; or set_task Ready" });
  }
  for (const t of all.filter((t) => t.kind === "ticket" && ["Backlog", "Ready"].includes(t.status))) {
    const hasBlockers = typedBlockers.some((b) => b.taskId === t.id);
    if (!hasBlockers && /\b(no antes|not before|después de|after)\b/i.test(t.scope) && /\b(deploy|prod|30 nights|30 noches|credentials|credenciales)\b/i.test(t.scope)) {
      out.push({ code: CLAIMABLE_BUT_WAITING, key: t.key, detail: "scope says it must wait, but it has no blocker the server can check", fix_hint: "blocked_by with a typed blocker (human_action, env_flag, time_after, metric_gte)" });
    }
  }
  // Expired claims that left commits behind, PRs missing, branches merged but not deleted, branches nobody owns.
  for (const t of all.filter((t) => t.kind === "ticket" && t.status === "Ready" && t.workspace?.branch && !t.owner)) {
    const withCommit = (await store.find("results", { taskId: t.id })).some((r) => r.commit !== null);
    const expired = await store.count("events", { taskId: t.id, type: "claim.expired" });
    if (withCommit && expired > 0) out.push({ code: "CLAIM_EXPIRED_WITH_COMMITS", key: t.key, detail: `lease expired with work on ${t.workspace!.branch}`, fix_hint: "claim it again, or hand it off" });
  }
  // 2.13: a ticket closed with no_pr_reason said why it has no PR (event task.no_pr); not a finding.
  const noPr = new Set((await store.find("events", { projectId: p.id, type: "task.no_pr" })).map((e) => e.taskId));
  for (const t of all.filter((t) => t.kind === "ticket" && ["In review", "Merged", "Released", "Done"].includes(t.status) && !t.prUrl && (t.workType ?? "code") === "code" && !noPr.has(t.id))) {
    out.push({ code: "TASK_MISSING_PR_URL", key: t.key, detail: `${t.status} without a PR`, fix_hint: "set_task pr_url, or put Plania: KEY in the PR body" });
  }
  // The release's branches are long-lived (sandbox merges into main every release): never "merged, delete it".
  // 2.11: neither is a branch an env runs or an initiative builds on, now that Orden offers the delete to copy.
  const releaseBranches = new Set([
    ...(p.settings.release ? [p.settings.release.from, p.settings.release.into] : []),
    ...envs.map((e) => e.branch).filter((b): b is string => !!b),
    ...all.filter((t) => t.kind === "initiative" && t.baseBranch).map((t) => t.baseBranch!),
  ]);
  for (const b of known.filter((b) => !releaseBranches.has(b.name))) {
    if (b.mergedAt) out.push({ code: "BRANCH_MERGED_NOT_DELETED", key: b.ownerTaskId ? (byId.get(b.ownerTaskId)?.key ?? null) : null, detail: `${b.name} merged ${iso(b.mergedAt)} and still on origin`, fix_hint: `git push origin --delete ${b.name}`, id: b.name, command: `git push origin --delete ${b.name}` });
    const used = all.some((t) => t.branch === b.name || t.workspace?.branch === b.name) || prs.some((pr) => pr.headBranch === b.name);
    if (!b.ownerTaskId && !used && b.headSha) out.push({ code: "BRANCH_WITHOUT_TICKET", key: null, detail: `${b.name} has no ticket or initiative`, fix_hint: "set the initiative's integration_branch, or delete the branch", id: b.name, command: `git push origin --delete ${b.name}` });
  }
  // 2.8: "waiting on Jorge" written as free text, with nothing he can act on in the inbox.
  const openQ = new Set((await store.find("questions", { projectId: p.id, answeredAt: null })).map((r) => r.taskId));
  const humanActionOn = new Set((await openHumanActions(db, p.id)).map((r) => r.b.taskId));
  // 2.10: the parser (jorge-lines.ts) turns most of these into blockers on the next write; the detail
  // says so, or names the parsed blocker when Jorge already marked it done and the text still waits.
  const parsedDone = typedBlockers
    .filter((b) => b.type === "human_action" && b.spec.source === "parsed" && b.satisfiedAt !== null)
    .map((b) => ({ id: b.id, taskId: b.taskId, hash: b.spec.line_hash }));
  for (const t of all.filter((t) => !CLOSED.includes(t.status))) {
    const texts = [t.kind === "initiative" ? t.nextAction : "", t.blockedNote ?? ""].filter(Boolean);
    const hit = texts.find((x) => WAITING_ON_JORGE.test(x));
    if (hit && !openQ.has(t.id) && !humanActionOn.has(t.id)) {
      const lines = parseJorgeLines(hit);
      const done = parsedDone.find((b) => b.taskId === t.id && lines.some((l) => l.hash === b.hash));
      const detail = done
        ? `"${hit.slice(0, 80)}" parsed into blocker ${done.id}, already marked done, and the text still waits on Jorge`
        : lines.length
          ? `"${hit.slice(0, 80)}" with no open question or human_action; the parser makes it one on the next write of that field`
          : `"${hit.slice(0, 80)}" with no open question or human_action`;
      const fix = done ? "rewrite the text now that it is done" : "ask (question) or blocked_by human_action, so it reaches his inbox";
      out.push({ code: "WAITING_ON_JORGE_FREE_TEXT", key: t.key, detail, fix_hint: fix });
    }
  }
  // 2.8: due dates that passed with the task still open.
  const today = new Date().toISOString().slice(0, 10);
  for (const t of all.filter((t) => t.dueOn && t.dueOn < today && !CLOSED.includes(t.status) && !["Merged", "Released"].includes(t.status))) {
    out.push({ code: "OVERDUE", key: t.key, detail: `due ${t.dueOn}, still ${t.status}`, fix_hint: "finish it, move due_on, or set_task Won't do with a reason" });
  }
  // PLA-I8-3: an open linked PR whose title and head branch carry no Plania key.
  // Merged and closed rows stay: many were linked from a "Plania: KEY" line in the body, which is not stored.
  const prefix = prefixOf(p);
  const keys = all.map((t) => t.key);
  for (const pr of prs) {
    if (pr.state !== "open") continue;
    const linked = (pr.taskId ? byId.get(pr.taskId) : undefined) ?? all.find((t) => t.prUrl !== null && t.prUrl === pr.url);
    if (!linked) continue;
    if (prCarriesPlaniaKey(pr.title, pr.headBranch, prefix, keys)) continue;
    const where = [pr.title ? `"${pr.title}"` : "", pr.headBranch ?? ""].filter(Boolean).join(" ");
    out.push({
      code: "PR_WITHOUT_PLANIA_KEY",
      key: linked.key,
      detail: `PR #${pr.number}${where ? ` ${where}` : ""} has no Plania key in the title or branch`,
      fix_hint: "put the task key in the PR title or head branch (the body is not stored)",
      id: pr.url,
    });
  }
  // PLA-I18-2: the old screen step was removed, so an answer stored by an agent is no longer a finding. Every
  // delegated answer still is, so the owner can review the quote, until he marks it seen (PLA-06).
  const delegatedRows = await store.find("delegatedAnswers", { projectId: p.id, reviewedAt: null });
  // warn: it is his instruction recorded by a bot the server cannot prove, not a silent success.
  const questionById = new Map<string, typeof questions.$inferSelect>();
  const delegatedQuestionIds = delegatedRows.map((d) => d.questionId).filter((id): id is string => !!id);
  if (delegatedQuestionIds.length) {
    for (const q of await store.find("questions", { id: delegatedQuestionIds })) questionById.set(q.id, q);
  }
  const approvalById = new Map<string, { action: string; state: string; taskKey: string | null }>();
  if (delegatedRows.some((d) => d.approvalId)) {
    const archived = await store.find("events", { projectId: p.id, type: "approval.archived" });
    for (const e of archived) {
      const payload = e.payload as { approval_id?: unknown; action?: unknown; state?: unknown };
      const id = typeof payload.approval_id === "string" ? payload.approval_id : "";
      if (!id) continue;
      approvalById.set(id, {
        action: typeof payload.action === "string" ? payload.action : "",
        state: typeof payload.state === "string" ? payload.state : "",
        taskKey: e.taskKey,
      });
    }
  }
  for (const d of delegatedRows) {
    const q = d.questionId ? questionById.get(d.questionId) : undefined;
    const a = d.approvalId ? approvalById.get(d.approvalId) : undefined;
    const key = q ? (byId.get(q.taskId)?.key ?? null) : (a?.taskKey ?? null);
    const what = a ? `approval ${a.action} ${a.state}` : "question";
    out.push({
      code: "DELEGATED_ANSWER",
      level: "warn",
      key,
      detail: `${what} delegated at ${iso(d.createdAt)} by ${d.actor.agent}: "${d.quote}" (message ${d.messageId})`,
      fix_hint: "review the quote on the Bandeja (badge Delegada). The kill switch on that screen turns delegated answers off; the bot cannot flip it",
      id: d.questionId ?? d.approvalId ?? d.id,
    });
  }
  // A Won't do that no screen session wrote and no agent backed with a quote. An archived granted
  // row still counts, so old decisions do not all light up.
  const wontDo = all.filter((t) => t.status === "Won't do");
  if (wontDo.length) {
    const ids = wontDo.map((t) => t.id);
    // The store filters on columns; the payload conditions are checked here.
    const statusEvents = (await store.find("events", { taskId: ids, type: "task.status" }, { orderBy: [{ column: "id", desc: true }] })).filter((e) => e.payload.to === "Won't do");
    const latest = new Map<string, Actor>();
    for (const e of statusEvents) if (e.taskId && !latest.has(e.taskId)) latest.set(e.taskId, e.actor);
    const coveredMoves = (await store.find("events", { taskId: ids, type: "task.delegated_move" })).filter((e) => e.payload.message_id != null && e.payload.to === "Won't do");
    const coveredGrants = (await store.find("events", { taskId: ids, type: "approval.archived" })).filter((e) => e.payload.action === "wont_do" && e.payload.state === "granted");
    const covered = new Set<string>([...coveredMoves.map((m) => m.taskId), ...coveredGrants.map((g) => g.taskId)].filter((id): id is string => !!id));
    for (const t of wontDo) {
      if (isScreenActor(latest.get(t.id))) continue;
      if (covered.has(t.id)) continue;
      out.push({
        code: WONT_DO_WITHOUT_EVIDENCE,
        level: "warn",
        key: t.key,
        detail: `${t.key} is Won't do with no screen actor and no delegated evidence`,
        fix_hint: "review it with Jorge. A screen move needs a reason; an agent move also needs delegated_by_jorge {message_id, quote}",
      });
    }
  }
  // What this project's agents left running on the Mac (stale servers and databases, merged worktrees).
  out.push(...(await footprintFindings(db, { projectId: p.id })));
  return out;
}

// Stores the run as a write of its own (never inside writeTx: every caller runs it after its write).
export async function runAudit(db: Db, p: Project) {
  const findings = await auditProject(db, p);
  await storeOf(db).write(p.id, {}, async (uow) => {
    const at = { projectId: p.id };
    if (await uow.get("auditRuns", at)) await uow.update("auditRuns", at, { findings, count: findings.length, at: uow.now });
    else await uow.insert("auditRuns", { ...at, findings, count: findings.length });
  });
  return { project: p.slug, at: iso(new Date()), count: findings.length, findings };
}

export async function lastAudit(db: Q, projectId: string) {
  const row = await readerOf(db).get("auditRuns", { projectId });
  return row ? { at: iso(row.at), count: row.count } : null;
}
