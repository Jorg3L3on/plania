// PLA-I74-2: the canary's GitHub. It answers the REST calls the poller makes (src/jobs/github.ts) and the `gh` CLI
// calls Plania and the scripted builder make, backed by the fixture's real bare origin: branches, heads, compares and
// merges are git's own answers, so a merge here is a real merge commit the deploy poller can then look for.
// Pull requests, check runs and commit statuses live in memory. Anything it does not know is a 404 and is recorded,
// so a new call Plania starts making shows up as a test failure instead of a silent pass.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type CheckRun = { name: string; status: string; conclusion: string | null; html_url: string; head_sha: string };
type Status = { context: string; state: string; target_url: string | null };
export type FakePr = {
  number: number;
  title: string;
  body: string;
  head: string; // branch
  base: string;
  state: "open" | "closed";
  merged_at: string | null;
  merge_commit_sha: string | null;
  updated_at: string;
};

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryGit = (cwd: string, ...args: string[]) => {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
};

export class FakeGithub {
  readonly prs = new Map<number, FakePr>();
  readonly checks = new Map<string, CheckRun[]>();
  readonly statuses = new Map<string, Status[]>();
  readonly unknown: string[] = [];
  readonly ghCalls: string[][] = [];
  private next = 1;
  private clock = Date.parse("2026-11-22T10:00:00Z");
  /** Check runs a new PR head gets by default: one green "test" run. A scenario may replace it. */
  ciFor: (sha: string, pr: FakePr) => CheckRun[] = (sha) => [{ name: "test", status: "completed", conclusion: "success", html_url: `https://github.com/${this.repo}/actions/runs/1`, head_sha: sha }];

  constructor(
    readonly repo: string,
    readonly origin: string,
  ) {}

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
  private url = (n: number) => `https://github.com/${this.repo}/pull/${n}`;
  private sha = (ref: string) => tryGit(this.origin, "rev-parse", `refs/heads/${ref}`) ?? tryGit(this.origin, "rev-parse", ref);

  /** What `gh pr create` does for the builder: a PR from head into base, with its CI. */
  open(input: { head: string; base: string; title: string; body: string }): FakePr {
    const existing = [...this.prs.values()].find((p) => p.head === input.head && p.base === input.base && p.state === "open");
    if (existing) return existing;
    const pr: FakePr = { number: this.next++, ...input, state: "open", merged_at: null, merge_commit_sha: null, updated_at: this.tick() };
    this.prs.set(pr.number, pr);
    this.refreshChecks(pr);
    return pr;
  }

  /** A push to a PR's branch: the PR moves (updated_at) and the new head gets its CI. */
  pushed(branch: string): void {
    for (const pr of this.prs.values()) {
      if (pr.head !== branch || pr.state !== "open") continue;
      pr.updated_at = this.tick();
      this.refreshChecks(pr);
    }
  }

  private refreshChecks(pr: FakePr): void {
    const sha = this.sha(pr.head);
    if (sha && !this.checks.has(sha)) this.checks.set(sha, this.ciFor(sha, pr));
  }

  /** git's own answer: does head merge into base without a conflict. */
  private mergeable(pr: FakePr): boolean {
    const a = this.sha(pr.base);
    const b = this.sha(pr.head);
    if (!a || !b) return false;
    return tryGit(this.origin, "merge-tree", "--write-tree", a, b) !== null;
  }

  /** A real merge commit on origin (--no-ff), as GitHub's merge button makes. */
  merge(number: number, matchHead?: string): string {
    const pr = this.prs.get(number);
    if (!pr || pr.state !== "open") throw new Error(`PR #${number} is not open`);
    const headSha = this.sha(pr.head)!;
    if (matchHead && !headSha.startsWith(matchHead) && !matchHead.startsWith(headSha)) throw new Error(`head moved: ${headSha} is not ${matchHead}`);
    const work = mkdtempSync(path.join(tmpdir(), "canary-merge-"));
    try {
      git(work, "clone", "-q", this.origin, ".");
      git(work, "config", "user.name", "github");
      git(work, "config", "user.email", "github@example.com");
      git(work, "config", "commit.gpgsign", "false");
      git(work, "checkout", "-q", pr.base);
      git(work, "merge", "-q", "--no-ff", "-m", `Merge pull request #${number} from ${pr.head}`, `origin/${pr.head}`);
      git(work, "push", "-q", "origin", pr.base);
      const sha = git(work, "rev-parse", "HEAD");
      Object.assign(pr, { state: "closed", merged_at: this.tick(), merge_commit_sha: sha, updated_at: this.tick() });
      return sha;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  private prJson(pr: FakePr) {
    const headSha = this.sha(pr.head) ?? pr.merge_commit_sha ?? "0".repeat(40);
    return {
      number: pr.number,
      html_url: this.url(pr.number),
      title: pr.title,
      state: pr.state,
      body: pr.body,
      merged_at: pr.merged_at,
      merge_commit_sha: pr.merge_commit_sha,
      updated_at: pr.updated_at,
      head: { sha: headSha, ref: pr.head },
      base: { ref: pr.base },
    };
  }

  private compare(a: string, b: string) {
    const sa = this.sha(a);
    const sb = this.sha(b);
    if (!sa || !sb) return null;
    const ahead = Number(git(this.origin, "rev-list", "--count", `${sa}..${sb}`));
    const behind = Number(git(this.origin, "rev-list", "--count", `${sb}..${sa}`));
    const status = !ahead && !behind ? "identical" : ahead && behind ? "diverged" : ahead ? "ahead" : "behind";
    const commits = ahead ? git(this.origin, "rev-list", "--reverse", `${sa}..${sb}`).split("\n").map((sha) => ({ sha })) : [];
    const files = ahead
      ? git(this.origin, "diff", "--name-status", sa, sb)
          .split("\n")
          .filter(Boolean)
          .map((l) => ({ filename: l.split("\t").at(-1)!, status: l.startsWith("A") ? "added" : l.startsWith("D") ? "removed" : "modified" }))
      : [];
    return { status, ahead_by: ahead, behind_by: behind, commits, files };
  }

  /** The REST API, as src/jobs/github.ts's Fetch. */
  fetch = async (url: string) => {
    const u = new URL(url);
    const p = u.pathname.replace(`/repos/${this.repo}`, "");
    const ok = (data: unknown) => ({ status: 200, headers: { get: () => null }, json: async () => data });
    const notFound = () => (this.unknown.push(u.pathname + u.search), { status: 404, headers: { get: () => null }, json: async () => ({}) });
    let m: RegExpExecArray | null;
    if (p === "/pulls") return ok([...this.prs.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((pr) => this.prJson(pr)));
    if ((m = /^\/pulls\/(\d+)$/.exec(p))) {
      const pr = this.prs.get(Number(m[1]));
      if (!pr) return notFound();
      const c = this.compare(pr.base, pr.head);
      return ok({ ...this.prJson(pr), changed_files: c?.files.length ?? 0 });
    }
    if ((m = /^\/pulls\/(\d+)\/commits$/.exec(p))) {
      const pr = this.prs.get(Number(m[1]));
      const c = pr && this.compare(pr.base, pr.head);
      return ok((c?.commits ?? []).map((x) => ({ sha: x.sha, commit: { message: tryGit(this.origin, "log", "-1", "--format=%B", x.sha) ?? "" } })));
    }
    if (/^\/pulls\/\d+\/reviews$/.test(p)) return ok([]);
    if ((m = /^\/commits\/([0-9a-f]+)\/check-runs$/.exec(p))) return ok({ check_runs: this.checks.get(m[1]!) ?? [] });
    if ((m = /^\/commits\/([0-9a-f]+)\/status$/.exec(p))) {
      const statuses = this.statuses.get(m[1]!) ?? [];
      return ok({ state: statuses.length ? statuses[0]!.state : "pending", total_count: statuses.length, statuses });
    }
    if ((m = /^\/branches\/(.+)$/.exec(p))) {
      const name = decodeURIComponent(m[1]!);
      const sha = tryGit(this.origin, "rev-parse", `refs/heads/${name}`);
      return sha ? ok({ name, commit: { sha } }) : notFound();
    }
    if (p === "/branches") {
      if (u.searchParams.get("page") !== "1") return ok([]);
      const refs = git(this.origin, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads");
      return ok(refs.split("\n").filter(Boolean).map((l) => ({ name: l.split(" ")[0], commit: { sha: l.split(" ")[1] } })));
    }
    if ((m = /^\/compare\/(.+)\.\.\.(.+)$/.exec(p))) {
      const c = this.compare(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!));
      return c ? ok(c) : notFound();
    }
    return notFound();
  };

  /** The `gh` CLI, as src/mcp/release-ship.ts's GhRun (and any other gh call Plania makes). */
  gh = async (args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> => {
    this.ghCalls.push(args);
    const flag = (name: string) => {
      const i = args.indexOf(name);
      return i >= 0 ? args[i + 1] : undefined;
    };
    const ok = (stdout: string) => ({ ok: true, stdout, stderr: "" });
    const [a, b] = args;
    try {
      if (a === "pr" && b === "list") {
        const list = [...this.prs.values()].filter((p) => p.state === "open" && (!flag("--base") || p.base === flag("--base")) && (!flag("--head") || p.head === flag("--head")));
        return ok(JSON.stringify(list.map((p) => ({ number: p.number, url: this.url(p.number) }))));
      }
      if (a === "pr" && b === "create") {
        const pr = this.open({ head: flag("--head")!, base: flag("--base")!, title: flag("--title") ?? "", body: flag("--body") ?? "" });
        return ok(`${this.url(pr.number)}\n`);
      }
      if (a === "pr" && b === "edit") {
        const pr = this.prs.get(Number(args[2]));
        if (pr) Object.assign(pr, { title: flag("--title") ?? pr.title, body: flag("--body") ?? pr.body, updated_at: this.tick() });
        return ok("");
      }
      if (a === "pr" && b === "merge") {
        this.merge(Number(args[2]), flag("--match-head-commit"));
        return ok("");
      }
      if (a === "pr" && b === "view") {
        const pr = this.prs.get(Number(args[2]));
        if (!pr) return { ok: false, stdout: "", stderr: "no pull requests found" };
        const sha = this.sha(pr.head);
        const rollup = (sha && this.checks.get(sha)) || [];
        const clean = pr.state !== "open" || this.mergeable(pr);
        return ok(
          JSON.stringify({
            url: this.url(pr.number),
            baseRefName: pr.base,
            headRefOid: sha ?? pr.merge_commit_sha,
            state: pr.merged_at ? "MERGED" : pr.state === "open" ? "OPEN" : "CLOSED",
            mergeable: clean ? "MERGEABLE" : "CONFLICTING",
            mergeCommit: pr.merge_commit_sha ? { oid: pr.merge_commit_sha } : null,
            statusCheckRollup: rollup.map((c) => ({ __typename: "CheckRun", name: c.name, status: c.status.toUpperCase(), conclusion: c.conclusion?.toUpperCase() ?? null })),
          }),
        );
      }
    } catch (e) {
      return { ok: false, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
    }
    this.unknown.push(`gh ${args.join(" ")}`);
    return { ok: false, stdout: "", stderr: `fake gh: unknown call ${args.slice(0, 3).join(" ")}` };
  };
}
