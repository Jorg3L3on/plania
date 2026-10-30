import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { approvals, auditRuns, blockers, branches, checks, decisions, delegatedAnswers, docs, envStates, pullRequests, questions, results, tasks, type Project, type Task } from "../db/schema.js";
import { hasUnsatisfiedBlocker, openHumanActions } from "./blockers.js";
import { footprintFindings } from "./footprint-audit.js";
import { WAITING_ON_JORGE, gatingSql, parseJorgeLines } from "./jorge-lines.js";
import { prefixOf } from "./keys.js";
import { releasePending, releasePlan } from "./release-plan.js";
import { isScreenActor, iso, type Q } from "./tx.js";

// The project audit (R-31): what the server can see is wrong, from data it already has. Pure
// reads, one function per finding code; `audit(project)` runs them on demand and the audit job
// every ten minutes, storing the last run so the status block can show the count.

// 2.11: id names what a one-click fix acts on (a decision id, an env, a branch, a worktree path) and
// command is the shell line Jorge copies, when the fix is one (src/mcp/orden.ts).
export type Finding = { code: string; key: string | null; detail: string; fix_hint: string; id?: string; command?: string; level?: "info" | "warn" };

const CLOSED = ["Done", "Won't do"];
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
  const all = await db.select().from(tasks).where(eq(tasks.projectId, p.id)).orderBy(asc(tasks.key));
  const byId = new Map(all.map((t) => [t.id, t]));
  const ids = all.map((t) => t.id);
  const prs = await db.select().from(pullRequests).where(eq(pullRequests.projectId, p.id));
  const prOf = (t: Task) => prs.filter((pr) => pr.taskId === t.id).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const env = p.settings.release_target ?? "prod";
  const envs = await db.select().from(envStates).where(eq(envStates.projectId, p.id));
  const target = envs.find((e) => e.env === env);
  const openChecks = ids.length
    ? await db
        .select({ taskId: checks.taskId, n: checks.n })
        .from(checks)
        .where(and(inArray(checks.taskId, ids), eq(checks.done, false), isNull(checks.waivedAt)))
    : [];
  const openOf = (t: Task) => openChecks.filter((c) => c.taskId === t.id).map((c) => c.n);

  // Tickets in review whose PR already merged, and merged ones not released though the target has the commit.
  for (const t of all.filter((t) => t.status === "In review")) {
    const pr = prOf(t);
    if (pr?.state === "merged") out.push({ code: "REVIEW_PR_MERGED", key: t.key, detail: `PR #${pr.number} merged ${iso(pr.mergedAt)}`, fix_hint: "the poller moves it to Merged on its next tick; check settings.github" });
  }
  // Done or merged with open checks.
  for (const t of all.filter((t) => t.status === "Done")) {
    const open = openOf(t);
    if (open.length) out.push({ code: "DONE_CHECKS_OPEN", key: t.key, detail: `checks ${open.join(", ")} neither done nor waived`, fix_hint: "waive_check with the reason, or set_check done with evidence" });
  }
  for (const t of all.filter((t) => t.status === "Merged" || t.status === "Released")) {
    const open = openOf(t);
    if (open.length) out.push({ code: "MERGED_CHECKS_OPEN", key: t.key, detail: `checks ${open.join(", ")} open after the merge`, fix_hint: "waive_check (needs an approval) or add the missing evidence" });
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
  const live = await db.select().from(decisions).where(and(eq(decisions.projectId, p.id), isNull(decisions.retiredAt)));
  const superseded = new Set((await db.execute<{ id: string }>(sql`select supersedes_id as id from decision_supersessions`).then((r) => r.rows)).map((r) => r.id));
  for (const d of live.filter((d) => !superseded.has(d.id))) {
    const shas = [...d.line.matchAll(SHA)].map((m) => m[0]).filter((s) => /[a-f]/.test(s) && /\d/.test(s));
    if (target?.commit && shas.length && !shas.some((s) => target.commit!.startsWith(s) || s.startsWith(target.commit!))) {
      const known = await db.execute<{ n: number }>(sql`select count(*)::int as n from env_commits where project_id = ${p.id} and env = ${env} and (${sql.join(shas.map((s) => sql`sha like ${s} || '%'`), sql` or `)})`).then((r) => r.rows[0]?.n ?? 0);
      if (known > 0) out.push({ code: "DECISION_STALE_REF", key: d.taskId ? (byId.get(d.taskId)?.key ?? null) : null, detail: `decision ${d.id.slice(0, 8)} cites ${shas.join(", ")}; ${env} is at ${target.commit.slice(0, 7)}`, fix_hint: "retire_decision, or add_decision with supersedes", id: d.id });
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
  if (target?.commit) {
    const heads = await db.select().from(branches).where(and(eq(branches.projectId, p.id), isNull(branches.deletedAt)));
    for (const i of all.filter((t) => t.kind === "initiative" && !CLOSED.includes(t.status) && t.branch)) {
      const head = heads.find((b) => b.name === i.branch)?.headSha;
      if (head && !head.startsWith(target.commit) && !target.commit.startsWith(head) && heads.find((b) => b.name === i.branch)?.mergedAt) {
        out.push(
          releasePending(plan)
            ? { code: "ENV_DRIFT", key: i.key, detail: `${i.branch} merged; it ships with the release step ${plan.from.branch} → ${plan.into.branch} in Jorge's inbox`, fix_hint: "nothing to do here: the release step (get_resume.status.release) is Jorge's" }
            : { code: "ENV_DRIFT", key: i.key, detail: `${i.branch} merged but ${env} still runs ${target.commit.slice(0, 7)}`, fix_hint: "deploy, then set_env (or wait for the poller)" },
        );
      }
    }
  }
  // Blocked tickets whose blockers all hold; claimable tickets that say "not before".
  const blockedButFree = all.length
    ? await db.select({ key: tasks.key }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.status, "Blocked"), sql`not ${hasUnsatisfiedBlocker(tasks.id)}`, sql`(exists (select 1 from ${blockers} b where b.task_id = ${tasks.id} and ${gatingSql("b")}) or exists (select 1 from task_blockers tb where tb.task_id = ${tasks.id}))`))
    : [];
  for (const t of blockedButFree) out.push({ code: "BLOCKED_BUT_SATISFIED", key: t.key, detail: "every blocker holds", fix_hint: "the server promotes it on the next write; or set_task Ready" });
  for (const t of all.filter((t) => t.kind === "ticket" && ["Backlog", "Ready"].includes(t.status))) {
    const hasBlockers = (await db.select({ id: blockers.id }).from(blockers).where(eq(blockers.taskId, t.id)).limit(1)).length > 0;
    if (!hasBlockers && /\b(no antes|not before|después de|after)\b/i.test(t.scope) && /\b(deploy|prod|30 nights|30 noches|credentials|credenciales)\b/i.test(t.scope)) {
      out.push({ code: "CLAIMABLE_BUT_GATED", key: t.key, detail: "scope says it must wait, but it has no blocker the server can check", fix_hint: "blocked_by with a typed blocker (human_action, env_flag, time_after, metric_gte)" });
    }
  }
  // Expired claims that left commits behind, PRs missing, branches merged but not deleted, branches nobody owns.
  for (const t of all.filter((t) => t.kind === "ticket" && t.status === "Ready" && t.workspace?.branch && !t.owner)) {
    const [r] = await db.select({ id: results.id }).from(results).where(and(eq(results.taskId, t.id), sql`${results.commit} is not null`)).orderBy(desc(results.createdAt)).limit(1);
    const expired = await db.execute<{ n: number }>(sql`select count(*)::int as n from events where task_id = ${t.id} and type = 'claim.expired'`).then((x) => x.rows[0]?.n ?? 0);
    if (r && expired > 0) out.push({ code: "CLAIM_EXPIRED_WITH_COMMITS", key: t.key, detail: `lease expired with work on ${t.workspace!.branch}`, fix_hint: "claim it again, or hand it off" });
  }
  // 2.13: a ticket closed with no_pr_reason said why it has no PR (event task.no_pr); not a finding.
  const noPr = new Set(
    (await db.execute<{ task_id: string }>(sql`select distinct task_id from events where project_id = ${p.id} and type = 'task.no_pr'`)).rows.map((r) => r.task_id),
  );
  for (const t of all.filter((t) => t.kind === "ticket" && ["In review", "Merged", "Released", "Done"].includes(t.status) && !t.prUrl && (t.workType ?? "code") === "code" && !noPr.has(t.id))) {
    out.push({ code: "TASK_MISSING_PR_URL", key: t.key, detail: `${t.status} without a PR`, fix_hint: "set_task pr_url, or put Plania: KEY in the PR body" });
  }
  const known = await db.select().from(branches).where(and(eq(branches.projectId, p.id), isNull(branches.deletedAt)));
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
  const openQ = new Set((await db.select({ taskId: questions.taskId }).from(questions).where(and(eq(questions.projectId, p.id), isNull(questions.answeredAt)))).map((r) => r.taskId));
  const openA = new Set((await db.select({ taskId: approvals.taskId }).from(approvals).where(and(eq(approvals.projectId, p.id), eq(approvals.state, "pending")))).map((r) => r.taskId));
  const humanActionOn = new Set((await openHumanActions(db, p.id)).map((r) => r.b.taskId));
  // 2.10: the parser (jorge-lines.ts) turns most of these into blockers on the next write; the detail
  // says so, or names the parsed blocker when Jorge already marked it done and the text still waits.
  const parsedDone = ids.length
    ? await db
        .select({ id: blockers.id, taskId: blockers.taskId, hash: sql<string>`${blockers.spec}->>'line_hash'` })
        .from(blockers)
        .where(and(inArray(blockers.taskId, ids), eq(blockers.type, "human_action"), sql`${blockers.spec}->>'source' = 'parsed'`, sql`${blockers.satisfiedAt} is not null`))
    : [];
  for (const t of all.filter((t) => !CLOSED.includes(t.status))) {
    const texts = [t.kind === "initiative" ? t.nextAction : "", t.blockedNote ?? ""].filter(Boolean);
    const hit = texts.find((x) => WAITING_ON_JORGE.test(x));
    if (hit && !openQ.has(t.id) && !openA.has(t.id) && !humanActionOn.has(t.id)) {
      const lines = parseJorgeLines(hit);
      const done = parsedDone.find((b) => b.taskId === t.id && lines.some((l) => l.hash === b.hash));
      const detail = done
        ? `"${hit.slice(0, 80)}" parsed into blocker ${done.id}, already marked done, and the text still waits on Jorge`
        : lines.length
          ? `"${hit.slice(0, 80)}" with no open question, approval or human_action; the parser makes it one on the next write of that field`
          : `"${hit.slice(0, 80)}" with no open question, approval or human_action`;
      const fix = done ? "rewrite the text now that it is done" : "ask (question) or request_approval, or blocked_by human_action, so it reaches his inbox";
      out.push({ code: "WAITING_ON_JORGE_FREE_TEXT", key: t.key, detail, fix_hint: fix });
    }
  }
  // 2.8: due dates that passed with the task still open.
  const today = new Date().toISOString().slice(0, 10);
  for (const t of all.filter((t) => t.dueOn && t.dueOn < today && !CLOSED.includes(t.status) && !["Merged", "Released"].includes(t.status))) {
    out.push({ code: "OVERDUE", key: t.key, detail: `due ${t.dueOn}, still ${t.status}`, fix_hint: "finish it, move due_on, or set_task Won't do via approval" });
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
  // PLA-I8-3: a gate answered by anyone but the owner on the screen (web session, machine screen).
  // Rows answered before 0027, when an agent was still accepted, stay flagged.
  // PLA-I15-2: a delegated answer is stored as the owner and listed on its own, so this finding
  // does not also fire for it. The quote stays on GATE_ANSWERED_DELEGATED for him to review.
  const ideaIds = all.filter((t) => t.kind === "idea").map((t) => t.id);
  const gateRows = ideaIds.length
    ? await db.select().from(questions).where(and(inArray(questions.taskId, ideaIds), sql`${questions.gate} is not null`))
    : [];
  const delegatedRows = await db.select().from(delegatedAnswers).where(eq(delegatedAnswers.projectId, p.id));
  const delegatedQuestionIds = new Set(delegatedRows.map((d) => d.questionId).filter((id): id is string => !!id));
  for (const q of gateRows) {
    if (!q.answeredAt || isScreenActor(q.answeredBy) || delegatedQuestionIds.has(q.id)) continue;
    const who = q.answeredBy ? `${q.answeredBy.agent}${q.answeredBy.machine ? `/${q.answeredBy.machine}` : ""}` : "nobody";
    out.push({
      code: "GATE_ANSWERED_BY_AGENT",
      key: byId.get(q.taskId)?.key ?? null,
      detail: `gate ${q.gate} answered by ${who}, not Jorge on the screen`,
      fix_hint: "ask the gate again; only the screen answers it, by a click",
      id: q.id,
    });
  }
  // Every delegated answer, gate or approval, so the owner can review the quote. warn: it is his
  // instruction recorded by a bot the server cannot prove, not a silent success.
  const questionById = new Map(gateRows.map((q) => [q.id, q]));
  const otherQuestionIds = delegatedRows.map((d) => d.questionId).filter((id): id is string => !!id && !questionById.has(id));
  if (otherQuestionIds.length) {
    for (const q of await db.select().from(questions).where(inArray(questions.id, otherQuestionIds))) questionById.set(q.id, q);
  }
  const approvalById = new Map(
    delegatedRows.some((d) => d.approvalId)
      ? (await db.select().from(approvals).where(eq(approvals.projectId, p.id))).map((a) => [a.id, a] as const)
      : [],
  );
  for (const d of delegatedRows) {
    const q = d.questionId ? questionById.get(d.questionId) : undefined;
    const a = d.approvalId ? approvalById.get(d.approvalId) : undefined;
    const key = q ? (byId.get(q.taskId)?.key ?? null) : (a?.taskKey ?? null);
    const what = q?.gate ? `gate ${q.gate}` : a ? `approval ${a.action} ${a.state}` : "question";
    out.push({
      code: "GATE_ANSWERED_DELEGATED",
      level: "warn",
      key,
      detail: `${what} delegated at ${iso(d.createdAt)} by ${d.actor.agent}: "${d.quote}" (message ${d.messageId})`,
      fix_hint: "review the quote on the Bandeja (badge Delegada). The kill switch on that screen turns delegated answers off; the bot cannot flip it",
      id: d.questionId ?? d.approvalId ?? d.id,
    });
  }
  // What this project's agents left running on the Mac (stale servers and databases, merged worktrees).
  out.push(...(await footprintFindings(db, { projectId: p.id })));
  return out;
}

export async function runAudit(db: Db, p: Project) {
  const findings = await auditProject(db, p);
  await db
    .insert(auditRuns)
    .values({ projectId: p.id, findings, count: findings.length })
    .onConflictDoUpdate({ target: [auditRuns.projectId], set: { findings, count: findings.length, at: sql`now()` } });
  return { project: p.slug, at: iso(new Date()), count: findings.length, findings };
}

export async function lastAudit(db: Q, projectId: string) {
  const [row] = await db.select().from(auditRuns).where(eq(auditRuns.projectId, projectId)).limit(1);
  return row ? { at: iso(row.at), count: row.count } : null;
}
