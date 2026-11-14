import type { Project, ReleaseSettings } from "../db/schema.js";
import { readerOf } from "../store/port.js";
import { openHumanActions } from "./blockers.js";
import { ToolError } from "./errors.js";
import { type Q } from "./tx.js";

// 2.10 (item 2, phase one): the release is computed, never typed. A project with settings.release
// {from, into, env} (sandbox → main, deployed to prod) has one step only Jorge takes: fast-forward
// `into` to `from`. releasePlan says what that step ships: the heads, how many commits `from` is
// ahead (the GitHub poller's compare, cached in poll_state by the pair of heads), the merged
// tickets not yet released, the migrations they reserved that env does not run yet, the human
// actions that must happen first, the checks still open, and the command. Agents never merge `into`.

export type ReleaseCompare = { key: string; from_head: string; into_head: string; ahead: number; contains: boolean; commits: string[]; shipped_at?: string };

export type ReleasePlan = {
  from: { branch: string; head_sha: string | null };
  into: { branch: string; head_sha: string | null };
  env: string;
  // null until the poller compared these heads.
  ahead: number | null;
  shipped: boolean;
  commits: string[];
  tickets: { key: string; title: string; status: string; pr_url: string | null }[];
  migrations: string[];
  before: { blocker_id: string; key: string; text: string }[];
  open_checks: number;
  command: string;
  // 2.13: how Jorge ships it (settings.release.mode), the merge he already made from the screen for
  // this from head (the poller has not seen it land yet), and whether Lanzar may run now.
  mode: "command" | "merge";
  merged: { sha: string; pr_url: string; at: string } | null;
  ship: { ready: boolean; reason: ShipBlock | null };
};

// Why Lanzar is off: command mode, nothing ahead, no GitHub data to know, a before-step or a check
// still open, already merged.
export type ShipBlock = "mode_command" | "no_repo" | "no_github_data" | "nothing_to_ship" | "before_steps" | "open_checks" | "merged";

const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;
const ENV = /^[a-z][a-z0-9_-]{0,29}$/;

/** set_project settings.release: {from, into, env}, two different branch names and an env. */
export function checkReleaseSettings(v: unknown): ReleaseSettings {
  const bad = (hint: string) => new ToolError("INVALID_FILTER", { field: "settings.release", hint });
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad('{from: "sandbox", into: "main", env: "prod"}');
  const { from, into, env, mode, ...rest } = v as Record<string, unknown>;
  if (Object.keys(rest).length) throw bad(`unknown keys: ${Object.keys(rest).join(", ")}`);
  if (typeof from !== "string" || !BRANCH.test(from)) throw bad("from is a branch name, e.g. sandbox");
  if (typeof into !== "string" || !BRANCH.test(into)) throw bad("into is a branch name, e.g. main");
  if (from === into) throw bad("from and into are different branches");
  if (typeof env !== "string" || !ENV.test(env)) throw bad("env is lowercase, e.g. prod");
  if (mode !== undefined && mode !== "command" && mode !== "merge") throw bad('mode is "command" (default) or "merge"');
  return { from, into, env, ...(mode === "merge" ? { mode } : {}) };
}

export const releaseCommand = (r: ReleaseSettings) => `git fetch origin && git checkout ${r.into} && git merge --ff-only origin/${r.from} && git push origin ${r.into}`;
export const compareKey = (fromHead: string, intoHead: string) => `${fromHead}...${intoHead}`;

// A human action elsewhere in the project that says it comes before the release: tagged
// before_release, or naming the step in its text ("antes de mergear sandbox → main").
function beforeRelease(spec: Record<string, unknown>, r: ReleaseSettings): boolean {
  if (spec.before_release === true) return true;
  const text = String(spec.text ?? "").toLowerCase();
  const step = new RegExp(`\\b${r.from.toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*(?:→|->|a|to|into)\\s*${r.into.toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\b`);
  return step.test(text) && /\b(antes de|before)\b/.test(text);
}

export async function releaseCompareOf(db: Q, projectId: string): Promise<ReleaseCompare | null> {
  const row = await readerOf(db).get("pollState", { projectId, source: "github" });
  return (row?.cursor.release as ReleaseCompare | undefined) ?? null;
}

/** The release step of a project, or null when it has no settings.release. */
export async function releasePlan(db: Q, p: Project): Promise<ReleasePlan | null> {
  const r = p.settings.release;
  if (!r) return null;
  const store = readerOf(db);
  const heads = await store.find("branches", { projectId: p.id, name: [r.from, r.into], deletedAt: null });
  const fromHead = heads.find((b) => b.name === r.from)?.headSha ?? null;
  const intoHead = heads.find((b) => b.name === r.into)?.headSha ?? null;
  const cached = await releaseCompareOf(db, p.id);
  const fresh = fromHead && intoHead && cached?.key === compareKey(fromHead, intoHead) ? cached : null;
  const same = !!fromHead && fromHead === intoHead;
  const ahead = same ? 0 : (fresh?.ahead ?? null);
  const shipped = same || !!fresh?.contains;

  // Merged (and In review with a merged PR) not yet Released; a PR merged straight into `into` is not part of it.
  const all = await store.find("tasks", { projectId: p.id, kind: "ticket", status: ["Merged", "In review"] }, { orderBy: [{ column: "key" }] });
  const prs = all.length ? await store.find("pullRequests", { taskId: all.map((t) => t.id) }) : [];
  const prOf = (id: string) => prs.filter((pr) => pr.taskId === id).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const shipping = all.filter((t) => {
    const pr = prOf(t.id);
    if (t.status === "In review" && pr?.state !== "merged") return false;
    return !pr || pr.baseBranch === r.from;
  });
  const ids = shipping.map((t) => t.id);

  const env = await store.get("envStates", { projectId: p.id, env: r.env });
  const applied = env?.migrations ?? [];
  const reserved = ids.length ? await store.find("sequenceReservations", { projectId: p.id, name: "migration", taskId: ids }, { orderBy: [{ column: "value" }] }) : [];
  const width = (await store.get("sequences", { projectId: p.id, name: "migration" }))?.width ?? 4;
  const migrations = reserved
    .map((m) => String(m.value).padStart(width, "0"))
    .filter((tag) => (applied.length ? !applied.some((a) => a === tag || a.startsWith(`${tag}_`)) : !(env?.migrationsApplied != null && Number(tag) <= env.migrationsApplied)));

  // Before-steps: open human actions on the shipping tickets, and elsewhere in the project those tagged before_release.
  // The same open human actions the inbox lists, oldest first.
  const open = await openHumanActions(db, p.id);
  const before = open
    .filter((o) => ids.includes(o.t.id) || beforeRelease(o.b.spec, r))
    .map((o) => ({ blocker_id: o.b.id, key: o.t.key, text: String(o.b.spec.text ?? "") }));

  const open_checks = ids.length ? await store.count("checks", { taskId: ids, done: false, waivedAt: null }) : 0;

  const mode = r.mode ?? "command";
  const merged = fromHead ? await mergedFromScreen(db, p.id, fromHead) : null;
  const pending = !shipped && (ahead ?? 0) > 0 && shipping.length > 0;
  const reason: ShipBlock | null =
    mode !== "merge" ? "mode_command"
    : !p.settings.github?.repo ? "no_repo"
    : merged ? "merged"
    // PLA-03: no compare for these heads (no token, a failed call) is unknown, not "nothing ahead".
    : !shipped && ahead === null ? "no_github_data"
    : !pending ? "nothing_to_ship"
    : before.length ? "before_steps"
    : open_checks ? "open_checks"
    : null;

  return {
    from: { branch: r.from, head_sha: fromHead },
    into: { branch: r.into, head_sha: intoHead },
    env: r.env,
    ahead,
    shipped,
    commits: fresh?.commits ?? [],
    tickets: shipping.map((t) => ({ key: t.key, title: t.title, status: t.status, pr_url: t.prUrl ?? prOf(t.id)?.url ?? null })),
    migrations,
    before,
    open_checks,
    command: releaseCommand(r),
    mode,
    merged,
    ship: { ready: reason === null, reason },
  };
}

// The release.merged event Jorge's Lanzar wrote for this from head, if any: between the merge and the
// poller's next compare the step still shows, as merged, and Lanzar stays off.
async function mergedFromScreen(db: Q, projectId: string, fromHead: string): Promise<ReleasePlan["merged"]> {
  // Newest first; the payload's from.head_sha is matched here, the store filters on columns only.
  const merges = await readerOf(db).find("events", { projectId, type: "release.merged" }, { orderBy: [{ column: "id", desc: true }] });
  const e = merges.find((m) => (m.payload.from as { head_sha?: unknown } | null | undefined)?.head_sha === fromHead);
  if (!e) return null;
  const pl = e.payload as { merge_sha: string; pr: { url: string } };
  return { sha: pl.merge_sha, pr_url: pl.pr.url, at: e.createdAt.toISOString() };
}

/** PLA-03: tickets are waiting but the poller has no compare for these heads, so whether `from` is
 * ahead is unknown. Said as "sin datos de GitHub", never as nothing to ship. */
export const releaseUnknown = (plan: ReleasePlan | null): plan is ReleasePlan => !!plan && !plan.shipped && plan.ahead === null && plan.tickets.length > 0;

/** The plan waits on Jorge: `from` is ahead and carries tickets. */
export const releasePending = (plan: ReleasePlan | null): plan is ReleasePlan => !!plan && !plan.shipped && (plan.ahead ?? 0) > 0 && plan.tickets.length > 0;
