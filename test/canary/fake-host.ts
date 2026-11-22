// PLA-I74-2: the canary's hosting API, shaped like Vercel's /v6/deployments (src/jobs/vercel.ts). A push to the
// production branch makes a deployment that answers READY or ERROR, as the scenario says. The filters in the query
// (state, projectId) are honoured as Vercel honours them, so asking only for READY never sees an ERROR.
export type Deployment = { uid: string; url: string; state: "READY" | "ERROR" | "BUILDING"; target: "production" | null; created: number; ready?: number; meta: { githubCommitSha: string; githubCommitRef: string } };

export class FakeHost {
  readonly deployments: Deployment[] = [];
  readonly asked: string[] = [];
  /** What the next production deploy ends as. */
  outcome: "READY" | "ERROR" = "READY";
  private created = Date.parse("2026-11-22T10:00:00Z");

  constructor(readonly projectId: string) {}

  /** The host builds a commit of the production branch. */
  deploy(sha: string, ref = "main"): Deployment {
    this.created += 60_000;
    const d: Deployment = { uid: `dpl_${this.deployments.length + 1}`, url: `canary-${this.deployments.length + 1}.example.com`, state: this.outcome, target: "production", created: this.created, ...(this.outcome === "READY" ? { ready: this.created + 30_000 } : {}), meta: { githubCommitSha: sha, githubCommitRef: ref } };
    this.deployments.push(d);
    return d;
  }

  fetch = async (url: string) => {
    this.asked.push(url);
    const u = new URL(url);
    if (u.hostname !== "api.vercel.com" || u.pathname !== "/v6/deployments" || u.searchParams.get("projectId") !== this.projectId) return { status: 404, headers: { get: () => null }, json: async () => ({}) };
    const state = u.searchParams.get("state");
    const list = this.deployments.filter((d) => !state || state.split(",").includes(d.state)).sort((a, b) => b.created - a.created);
    return { status: 200, headers: { get: () => null }, json: async () => ({ deployments: list.slice(0, Number(u.searchParams.get("limit") ?? 20)) }) };
  };
}
