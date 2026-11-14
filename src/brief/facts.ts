// PLA-I41-2: the facts pack (spec §4 step 1, §6.2 Inputs, §10). buildFacts(db, window) reads the Plania DB only —
// no network, no git, no GitHub — and returns what pass A judges: per included project its tickets In progress and
// In review, what was created in the window, the open initiatives with their derived state, Ready work, the owner's
// inbox, the last audit, pull requests (opened/merged/closed in the window and every open one with age and base),
// the release compare, env records with a staleness check, merged branches not deleted, and the thread messages of
// the window. The brief token cannot call thread_read (THREAD_FORBIDDEN), so the threads are here. Plus the previous
// brief's items and source_errors (no GitHub repo, or the poller's last error).
//
// Never in facts: token values, emails, env values, actor session ids or machines. redactFacts() runs over the whole
// pack last as a guard, so a token or an address pasted into a message or a poller error does not leak either.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  auditRuns,
  branches,
  briefChecks,
  envStates,
  events,
  morningBriefs,
  pollState,
  projects,
  pullRequests,
  tasks,
  threadMessages,
  threads,
  type Project,
  type Task,
} from "../db/schema.js";
import { inboxFor } from "../mcp/inbox.js";
import { initiativeState } from "../mcp/initiative-state.js";
import { prOf, type PrShape } from "../mcp/queries.js";
import { releaseCompareOf, releasePlan } from "../mcp/release-plan.js";
import type { Q } from "../mcp/tx.js";
import { repoPathOf } from "../runner/worktree.js";
import { loadBriefProjects, loadBriefSettings, resolveBriefSettings } from "./settings.js";
import type { BriefSettings, Status } from "./types.js";

export type FactsWindow = { from: Date; to: Date };

const DAY = 24 * 3600_000;
export const MAX_WINDOW_MS = 3 * DAY;
export const STALE_PR_DAYS = 14;
const MAX_MESSAGES = 20;
const MAX_BODY = 600;
const MAX_LIST = 25;

/** From the last brief (at most three days back), else the last 24 hours, to now. */
export function briefWindow(lastGeneratedAt: Date | null, now: Date): FactsWindow {
  const floor = now.getTime() - MAX_WINDOW_MS;
  const from = lastGeneratedAt && lastGeneratedAt.getTime() < now.getTime() ? Math.max(lastGeneratedAt.getTime(), floor) : now.getTime() - DAY;
  return { from: new Date(from), to: now };
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const days = (from: Date, to: Date): number => Math.floor((to.getTime() - from.getTime()) / DAY);
const clip = (s: string, n = MAX_BODY): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const inWindow = (d: Date | null | undefined, w: FactsWindow): boolean => !!d && d >= w.from && d <= w.to;
const PRIORITY: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export type FactsPr = {
  number: number;
  title: string;
  url: string;
  state: string;
  base: string | null;
  head: string | null;
  ticket: string | null;
  ci_state: string | null;
  opened_at: string | null;
  age_days: number | null;
  merged_at: string | null;
  updated_at: string | null;
};

export type FactsSourceError = { project: string; source: "github"; error: "no_repo" | "poll_error"; detail: string; fix: string };

export type FactsMessage = {
  at: string;
  author: string;
  role: string;
  body: string;
  links: { kind: string; ref: string; title: string }[];
  action: string | null;
  question_open: boolean | null;
};

export type FactsThread = { unread: number; messages: FactsMessage[] };

export type FactsProject = {
  slug: string;
  name: string;
  key_prefix: string;
  runs_paused: boolean;
  repo_path: string;
  github_repo: string | null;
  headline_note: string;
  tickets_in_progress: { key: string; title: string; priority: string | null; parent: string | null; agent: string | null; lease_live: boolean; last_seen_at: string | null; branch: string | null }[];
  tickets_in_review: { key: string; title: string; parent: string | null; since: string | null; open_checks: number; pr: PrShape | null }[];
  tickets_blocked: { key: string; title: string; status: string; note: string | null }[];
  created_in_window: { key: string; kind: string; title: string; status: string; stage: string | null; parent: string | null; created_at: string }[];
  initiatives: {
    key: string;
    title: string;
    status: string;
    next_action: string;
    state_note: string;
    done: number;
    total: number;
    phase_now: number | null;
    in_review: { key: string; pr: number | null }[];
    to_release: string[];
    waiting_on: { key: string; on: string }[];
    line: string;
  }[];
  ready: { key: string; title: string; priority: string | null; first: boolean }[];
  inbox: { kind: string; key: string | null; title: string | null; why: string; options?: string[]; urgency?: string | null; human_only?: boolean; waiting_since: string; pr_url: string | null }[];
  audit: { at: string; count: number; findings: { code: string; key: string | null; detail: string; fix_hint: string; level: string | null }[] } | null;
  pull_requests: { opened: FactsPr[]; merged: FactsPr[]; closed: FactsPr[]; open: FactsPr[] };
  release: {
    from: string;
    into: string;
    env: string;
    from_head: string | null;
    into_head: string | null;
    // identical | ahead | behind | diverged | contained | unknown. "contained": into already has from.
    state: string;
    ahead: number | null;
    behind: number | null;
    fast_forward: boolean | null;
    compare_url: string | null;
    tickets: { key: string; title: string; status: string; pr_url: string | null }[];
    migrations: string[];
    before: { key: string; text: string }[];
    open_checks: number;
    compared_at: string | null;
  } | null;
  envs: {
    env: string;
    commit: string | null;
    branch: string | null;
    deployed_at: string | null;
    updated_at: string;
    migrations_applied: number | null;
    migrations: string[];
    // PRs merged into the branch this env runs after the record was written: stale when not empty.
    merged_since: { number: number; title: string; merged_at: string }[];
    stale: boolean;
  }[];
  merged_branches_not_deleted: string[];
  thread: FactsThread;
};

export type Facts = {
  version: 1;
  window: { from: string; to: string };
  timezone: string;
  language: string;
  owner_name: string;
  hidden_refs: string[];
  github_mode: string;
  projects: FactsProject[];
  company_thread: FactsThread;
  previous_brief: { generated_at: string; items: { id: string; app: string; status: Status | string; title: string; ref: string | null; checked: boolean }[]; ideas: { code: string; app: string; title: string }[] } | null;
  source_errors: FactsSourceError[];
};

function prFact(pr: typeof pullRequests.$inferSelect, ticket: string | null, openedAt: Date | null, now: Date): FactsPr {
  return {
    number: pr.number,
    title: clip(pr.title, 200),
    url: pr.url,
    state: pr.state,
    base: pr.baseBranch,
    head: pr.headBranch,
    ticket,
    ci_state: pr.ciState,
    opened_at: iso(openedAt),
    age_days: openedAt && pr.state === "open" ? days(openedAt, now) : null,
    merged_at: iso(pr.mergedAt),
    updated_at: iso(pr.ghUpdatedAt),
  };
}

async function threadFacts(db: Q, threadId: string | null, readAt: Date | null, w: FactsWindow): Promise<FactsThread> {
  if (!threadId) return { unread: 0, messages: [] };
  const rows = await db
    .select({ m: threadMessages, qAnswered: sql<Date | null>`(select answered_at from questions q where q.id = ${threadMessages.questionId})` })
    .from(threadMessages)
    .where(and(eq(threadMessages.threadId, threadId), gte(threadMessages.at, w.from), lte(threadMessages.at, w.to)))
    .orderBy(desc(threadMessages.at))
    .limit(MAX_MESSAGES);
  const [unread] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(threadMessages)
    .where(and(eq(threadMessages.threadId, threadId), sql`${threadMessages.authorAgent} <> 'jorge'`, readAt ? sql`${threadMessages.at} > ${readAt.toISOString()}::timestamptz` : sql`true`));
  return {
    unread: unread?.n ?? 0,
    messages: rows.reverse().map(({ m, qAnswered }) => ({
      at: m.at.toISOString(),
      author: m.authorAgent,
      role: m.authorRole,
      body: clip(m.body),
      links: m.links.map((l) => ({ kind: l.kind, ref: l.ref, title: clip(l.title, 120) })),
      action: m.actionState?.action ?? null,
      question_open: m.questionId ? qAnswered === null : null,
    })),
  };
}

async function projectFacts(db: Q, p: Project, s: BriefSettings, w: FactsWindow, errors: FactsSourceError[]): Promise<FactsProject> {
  const now = w.to;
  const all = await db.select().from(tasks).where(eq(tasks.projectId, p.id)).orderBy(asc(tasks.key));
  const byId = new Map(all.map((t) => [t.id, t]));
  const parentKey = (t: Task) => (t.parentId ? (byId.get(t.parentId)?.key ?? null) : null);
  const tickets = all.filter((t) => t.kind === "ticket");

  // Tickets
  const inProgress = tickets
    .filter((t) => t.status === "In progress")
    .map((t) => ({
      key: t.key,
      title: t.title,
      priority: t.priority,
      parent: parentKey(t),
      agent: t.owner?.agent ?? null,
      lease_live: !!t.leaseUntil && t.leaseUntil > now,
      last_seen_at: iso(t.lastSeenAt),
      branch: t.workspace?.branch ?? t.branch,
    }));
  const reviewRows = tickets.filter((t) => t.status === "In review");
  const openChecks = reviewRows.length
    ? await db.execute<{ task_id: string; n: number }>(sql`select task_id, count(*)::int as n from checks where done = false and waived_at is null and task_id in (${sql.join(reviewRows.map((t) => sql`${t.id}`), sql`, `)}) group by task_id`)
    : { rows: [] };
  const inReview = await Promise.all(
    reviewRows.map(async (t) => ({
      key: t.key,
      title: t.title,
      parent: parentKey(t),
      since: iso(t.statusChangedAt),
      open_checks: openChecks.rows.find((r) => r.task_id === t.id)?.n ?? 0,
      pr: await prOf(db, t),
    })),
  );
  const blocked = tickets
    .filter((t) => t.status === "Blocked" || t.status === "Needs Jorge")
    .map((t) => ({ key: t.key, title: t.title, status: t.status, note: t.blockedNote ? clip(t.blockedNote, 300) : null }));
  const created = all
    .filter((t) => inWindow(t.createdAt, w))
    .slice(0, MAX_LIST)
    .map((t) => ({ key: t.key, kind: t.kind, title: t.title, status: t.status, stage: t.stage, parent: parentKey(t), created_at: t.createdAt.toISOString() }));

  // Initiatives that are still open, with the state derived from their tickets.
  const initiatives = [];
  for (const i of all.filter((t) => t.kind === "initiative" && !["Done", "Won't do"].includes(t.status))) {
    const st = await initiativeState(db, i, all.filter((c) => c.parentId === i.id));
    initiatives.push({
      key: i.key,
      title: i.title,
      status: i.status,
      next_action: clip(i.nextAction, 300),
      state_note: clip(i.stateNote, 300),
      done: st.done,
      total: st.total,
      phase_now: st.phase_now,
      in_review: st.in_review.map((r) => ({ key: r.key, pr: r.pr?.number ?? null })),
      to_release: st.to_release,
      waiting_on: st.waiting_on,
      line: st.line,
    });
  }

  const ready = tickets
    .filter((t) => t.status === "Ready")
    .sort((a, b) => (PRIORITY[a.priority ?? ""] ?? 9) - (PRIORITY[b.priority ?? ""] ?? 9) || a.key.localeCompare(b.key, "en", { numeric: true }))
    .slice(0, 5)
    .map((t) => ({ key: t.key, title: t.title, priority: t.priority, first: p.settings.next_first === t.key }));
  if (p.settings.next_first) ready.sort((a, b) => Number(b.first) - Number(a.first));

  // What waits on the owner: questions, human steps, the release.
  const inbox = (await inboxFor(db, p))
    .filter((it) => it.kind === "question" || it.kind === "human_action" || it.kind === "release")
    .slice(0, MAX_LIST)
    .map((it) => ({
      kind: it.kind,
      key: it.key,
      title: it.title,
      why: clip(it.why, 400),
      ...(it.options?.length ? { options: it.options.map((o) => clip(o, 160)) } : {}),
      ...(it.urgency !== undefined ? { urgency: it.urgency } : {}),
      ...(it.human_only !== undefined ? { human_only: it.human_only } : {}),
      waiting_since: it.waiting_since,
      pr_url: it.pr_url,
    }));

  const [auditRow] = await db.select().from(auditRuns).where(eq(auditRuns.projectId, p.id)).limit(1);
  const audit = auditRow
    ? {
        at: auditRow.at.toISOString(),
        count: auditRow.count,
        findings: auditRow.findings.slice(0, MAX_LIST).map((f) => ({ code: f.code, key: f.key, detail: clip(f.detail, 300), fix_hint: clip(f.fix_hint, 200), level: f.level ?? null })),
      }
    : null;

  // Pull requests. The table has no opened date: the pr.opened event the poller wrote is the open time.
  const repo = p.settings.github?.repo ?? null;
  const prs = await db.select().from(pullRequests).where(eq(pullRequests.projectId, p.id)).orderBy(desc(pullRequests.number));
  const prEvents = await db
    .select({ type: events.type, at: events.createdAt, url: sql<string>`${events.payload}->>'url'` })
    .from(events)
    .where(and(eq(events.projectId, p.id), inArray(events.type, ["pr.opened", "pr.closed"])))
    .orderBy(asc(events.id));
  const openedAt = new Map<string, Date>();
  const closedAt = new Map<string, Date>();
  for (const e of prEvents) {
    if (e.type === "pr.opened" && !openedAt.has(e.url)) openedAt.set(e.url, e.at);
    if (e.type === "pr.closed") closedAt.set(e.url, e.at);
  }
  const ticketOf = (pr: typeof pullRequests.$inferSelect) => (pr.taskId ? (byId.get(pr.taskId)?.key ?? null) : null);
  const fact = (pr: typeof pullRequests.$inferSelect) => prFact(pr, ticketOf(pr), openedAt.get(pr.url) ?? null, now);
  const pull_requests = {
    opened: prs.filter((pr) => inWindow(openedAt.get(pr.url), w)).slice(0, MAX_LIST).map(fact),
    merged: prs.filter((pr) => pr.state === "merged" && inWindow(pr.mergedAt, w)).slice(0, MAX_LIST).map(fact),
    closed: prs.filter((pr) => pr.state === "closed" && inWindow(closedAt.get(pr.url), w)).slice(0, MAX_LIST).map(fact),
    open: prs.filter((pr) => pr.state === "open").map(fact),
  };

  // Release compare (from the poller's cache; ahead/behind/diverged).
  let release: FactsProject["release"] = null;
  const plan = await releasePlan(db, p);
  if (plan) {
    const r = p.settings.release!;
    const cached = await releaseCompareOf(db, p.id);
    const fresh = cached && plan.from.head_sha && plan.into.head_sha && cached.from_head === plan.from.head_sha && cached.into_head === plan.into.head_sha ? (cached as typeof cached & { status?: string; behind_by?: number }) : null;
    const same = !!plan.from.head_sha && plan.from.head_sha === plan.into.head_sha;
    const behind = typeof fresh?.behind_by === "number" ? fresh.behind_by : null;
    const state = same
      ? "identical"
      : typeof fresh?.status === "string"
        ? fresh.status
        : plan.ahead === null
          ? "unknown"
          : plan.shipped
            ? "contained"
            : behind !== null && behind > 0
              ? "diverged"
              : "ahead";
    release = {
      from: r.from,
      into: r.into,
      env: r.env,
      from_head: plan.from.head_sha?.slice(0, 7) ?? null,
      into_head: plan.into.head_sha?.slice(0, 7) ?? null,
      state,
      ahead: plan.ahead,
      behind: same ? 0 : behind,
      fast_forward: state === "diverged" ? false : state === "ahead" && behind === 0 ? true : null,
      compare_url: repo ? `https://github.com/${repo}/compare/${r.into}...${r.from}` : null,
      tickets: plan.tickets,
      migrations: plan.migrations,
      before: plan.before.map((b) => ({ key: b.key, text: clip(b.text, 300) })),
      open_checks: plan.open_checks,
      compared_at: fresh ? (fresh.shipped_at ?? null) : null,
    };
  }

  // Env records, and whether a merge into the branch they run landed after the record.
  const envRows = await db.select().from(envStates).where(eq(envStates.projectId, p.id)).orderBy(asc(envStates.env));
  const envs = envRows.map((e) => {
    const target = e.branch ?? (p.settings.release && e.env === p.settings.release.env ? p.settings.release.into : null);
    const recordAt = e.deployedAt ?? e.updatedAt;
    const since = target
      ? prs
          .filter((pr) => pr.state === "merged" && pr.baseBranch === target && pr.mergedAt && pr.mergedAt > recordAt && !(e.commit && pr.mergeSha && pr.mergeSha.startsWith(e.commit)))
          .sort((a, b) => b.mergedAt!.getTime() - a.mergedAt!.getTime())
          .slice(0, 10)
          .map((pr) => ({ number: pr.number, title: clip(pr.title, 200), merged_at: pr.mergedAt!.toISOString() }))
      : [];
    return {
      env: e.env,
      commit: e.commit?.slice(0, 7) ?? null,
      branch: e.branch,
      deployed_at: iso(e.deployedAt),
      updated_at: e.updatedAt.toISOString(),
      migrations_applied: e.migrationsApplied,
      migrations: e.migrations,
      merged_since: since,
      stale: since.length > 0,
    };
  });

  const merged_branches_not_deleted = (
    await db.select({ name: branches.name }).from(branches).where(and(eq(branches.projectId, p.id), isNotNull(branches.mergedAt), isNull(branches.deletedAt))).orderBy(asc(branches.name))
  )
    .map((b) => b.name)
    .filter((n) => !p.settings.release || (n !== p.settings.release.from && n !== p.settings.release.into))
    .slice(0, MAX_LIST);

  // GitHub gaps (§10.2).
  if (s.github_mode !== "off") {
    if (!repo) {
      errors.push({ project: p.slug, source: "github", error: "no_repo", detail: `GitHub isn't connected for ${p.title}: the project has no settings.github.repo.`, fix: `pnpm project:add ${p.slug} --repo owner/name` });
    } else {
      const [ps] = await db.select({ error: pollState.error }).from(pollState).where(and(eq(pollState.projectId, p.id), eq(pollState.source, "github"))).limit(1);
      if (ps?.error) errors.push({ project: p.slug, source: "github", error: "poll_error", detail: clip(`The GitHub poller failed for ${p.title}: ${ps.error}`, 300), fix: "Check the token file (~/.config/plania/github-token) and that the repo name is right." });
    }
  }

  const [pt] = await db.select().from(threads).where(and(eq(threads.kind, "project"), eq(threads.projectId, p.id))).limit(1);

  return {
    slug: p.slug,
    name: p.title,
    key_prefix: p.keyPrefix,
    runs_paused: p.runsPaused,
    repo_path: repoPathOf(p.slug, p.settings),
    github_repo: repo,
    headline_note: clip(p.headlineNote, 280),
    tickets_in_progress: inProgress,
    tickets_in_review: inReview,
    tickets_blocked: blocked,
    created_in_window: created,
    initiatives,
    ready,
    inbox,
    audit,
    pull_requests,
    release,
    envs,
    merged_branches_not_deleted,
    thread: await threadFacts(db, pt?.id ?? null, pt?.readAt ?? null, w),
  };
}

async function previousBrief(db: Q, w: FactsWindow): Promise<Facts["previous_brief"]> {
  const [prev] = await db.select().from(morningBriefs).where(lt(morningBriefs.generatedAt, w.to)).orderBy(desc(morningBriefs.generatedAt)).limit(1);
  if (!prev) return null;
  const data = prev.data as { items?: unknown; ideas?: unknown };
  const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  const ideas = Array.isArray(data.ideas) ? (data.ideas as Record<string, unknown>[]) : [];
  const ids = items.map((i) => String(i.id ?? "")).filter(Boolean);
  const checked = new Set(ids.length ? (await db.select({ id: briefChecks.itemId }).from(briefChecks).where(inArray(briefChecks.itemId, ids))).map((r) => r.id) : []);
  return {
    generated_at: prev.generatedAt.toISOString(),
    items: items.map((i) => ({
      id: String(i.id ?? ""),
      app: String(i.app ?? ""),
      status: String(i.status ?? ""),
      title: String(i.title ?? ""),
      ref: typeof i.ref === "string" ? i.ref : null,
      checked: checked.has(String(i.id ?? "")),
    })),
    ideas: ideas.map((d) => ({ code: String(d.code ?? ""), app: String(d.app ?? ""), title: String(d.title ?? "") })),
  };
}

// ---- Redaction guard

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN_SHAPES = [
  /\bpla_[A-Za-z0-9_-]{16,}/g, // Plania agent tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g, // Anthropic / OpenAI style keys
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
];
// Env vars whose values must never appear, whatever they look like.
export const SECRET_ENV = ["PLANIA_BRIEF_TOKEN", "MCP_READ_TOKEN", "MCP_BEARER_TOKEN", "PLANIA_RUNNER_TOKEN", "PLANIA_CI_TOKEN", "SESSION_SECRET", "PLANIA_GITHUB_TOKEN", "GITHUB_TOKEN", "VERCEL_TOKEN"];

export function redactText(s: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = s;
  for (const name of SECRET_ENV) {
    const v = env[name];
    if (v && v.length >= 6) out = out.split(v).join("[redacted]");
  }
  for (const re of TOKEN_SHAPES) out = out.replace(re, "[redacted]");
  return out.replace(EMAIL, "[email]");
}

export function redactFacts<T>(v: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof v === "string") return redactText(v, env) as T;
  if (Array.isArray(v)) return v.map((x) => redactFacts(x, env)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactFacts(x, env)])) as T;
  return v;
}

// ---- The pack

export type BuildFactsOptions = { settings?: BriefSettings; env?: NodeJS.ProcessEnv };

export async function buildFacts(db: Q, window: FactsWindow, opts: BuildFactsOptions = {}): Promise<Facts> {
  const env = opts.env ?? process.env;
  const stored = opts.settings ?? (await loadBriefSettings(db));
  const s = resolveBriefSettings(stored, env);
  const order = (await loadBriefProjects(db, stored)).filter((bp) => bp.include);
  const rows = order.length ? await db.select().from(projects).where(or(...order.map((bp) => eq(projects.slug, bp.slug)))) : [];
  const errors: FactsSourceError[] = [];
  const list: FactsProject[] = [];
  for (const bp of order) {
    const p = rows.find((r) => r.slug === bp.slug);
    if (p) list.push(await projectFacts(db, p, stored, window, errors));
  }
  const [ct] = await db.select().from(threads).where(eq(threads.kind, "company")).limit(1);
  const facts: Facts = {
    version: 1,
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    timezone: s.timezone,
    language: s.language,
    owner_name: s.owner_name,
    hidden_refs: s.hidden_refs,
    github_mode: s.github_mode,
    projects: list,
    company_thread: await threadFacts(db, ct?.id ?? null, ct?.readAt ?? null, window),
    previous_brief: await previousBrief(db, window),
    source_errors: errors,
  };
  return redactFacts(facts, env);
}
