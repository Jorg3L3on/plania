// PLA-I74-2: the canary's hosting API, shaped like Vercel's /v6/deployments (src/jobs/vercel.ts). A push to the
// production branch makes a deployment that answers READY or ERROR, as the scenario says. The filters in the query
// (state, projectId, target) are honoured as Vercel honours them, so asking only for READY never sees an ERROR.
// PLA-I74-8: a failed deploy has its build log (/v3/deployments/:id/events), and a READY one's site answers on its own
// URL (the live check before «En producción»), unless the scenario says the site is down.
export type Deployment = {
  uid: string;
  url: string;
  state: "READY" | "ERROR" | "BUILDING";
  target: "production" | null;
  created: number;
  ready?: number;
  errorCode?: string;
  errorMessage?: string;
  meta: { githubCommitSha: string; githubCommitRef: string };
};

export const BUILD_LOG = ["Running build in Washington, D.C.", "> next build", "Failed to compile.", "./pages/clientes.tsx: Type error: Property 'nombre' does not exist", "Error: Command \"npm run build\" exited with 1"];

export class FakeHost {
  readonly deployments: Deployment[] = [];
  readonly asked: string[] = [];
  /** What the next production deploy ends as. */
  outcome: "READY" | "ERROR" = "READY";
  /** The production site does not answer (a READY deploy that is not live). */
  down = false;
  private created = Date.parse("2026-11-22T10:00:00Z");
  /** Vercel posts each deploy's result as a commit status on GitHub; the harness wires it to the fake GitHub. */
  onDeploy: ((d: Deployment) => void) | null = null;

  constructor(readonly projectId: string) {}

  /** The host builds a commit of the production branch. */
  deploy(sha: string, ref = "main"): Deployment {
    this.created += 60_000;
    const n = this.deployments.length + 1;
    const failed = this.outcome === "ERROR";
    const d: Deployment = {
      uid: `dpl_${n}`,
      url: `canary-${n}.example.com`,
      state: this.outcome,
      target: "production",
      created: this.created,
      ...(failed ? { errorCode: "BUILD_FAILED", errorMessage: "Command \"npm run build\" exited with 1" } : { ready: this.created + 30_000 }),
      meta: { githubCommitSha: sha, githubCommitRef: ref },
    };
    this.deployments.push(d);
    this.onDeploy?.(d);
    return d;
  }

  fetch = async (url: string) => {
    this.asked.push(url);
    const u = new URL(url);
    const answer = (status: number, body: unknown) => ({ status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
    // A deployed site: it answers when its deploy is READY and the site is up.
    const site = this.deployments.find((d) => u.hostname === d.url);
    if (site) return answer(site.state === "READY" && !this.down ? 200 : 502, {});
    if (u.hostname !== "api.vercel.com") return answer(404, {});
    const events = /^\/v3\/deployments\/([^/]+)\/events$/.exec(u.pathname);
    if (events) {
      const d = this.deployments.find((x) => x.uid === decodeURIComponent(events[1]!));
      return d ? answer(200, d.state === "ERROR" ? BUILD_LOG.map((text, i) => ({ type: "stdout", created: d.created + i, text })) : []) : answer(404, {});
    }
    if (u.pathname !== "/v6/deployments" || u.searchParams.get("projectId") !== this.projectId) return answer(404, {});
    const state = u.searchParams.get("state");
    const target = u.searchParams.get("target");
    const list = this.deployments.filter((d) => (!state || state.split(",").includes(d.state)) && (!target || d.target === target)).sort((a, b) => b.created - a.created);
    return answer(200, { deployments: list.slice(0, Number(u.searchParams.get("limit") ?? 20)) });
  };
}
