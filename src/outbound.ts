// PLA-I2-7: everything that leaves the machine, in one list. The page of limits (/machine/limites) is generated
// from it: each entry has a plain sentence in OUTBOUND_WORDS (ui/src/lib/limites.ts), and
// test/i2-7-limits.test.ts fails when an entry has none, or when the file named in `code` is gone.
// Adding a new call to the outside means adding an entry here first.

export type OutboundId =
  | "claude"
  | "github-read"
  | "github-merge"
  | "vercel-read"
  | "push"
  | "qa-browser"
  | "agent-wake"
  | "tailscale"
  | "scanner-download";

export type Outbound = {
  id: OutboundId;
  /** Where it goes (a host or a service), for the reader who wants to check. */
  to: string;
  /** When it is used, in English, for code readers. The screen uses OUTBOUND_WORDS. */
  when: string;
  /** The file that makes the call. */
  code: string;
  /** Off unless the owner sets something up (a token, keys, a URL, a program). */
  optional: boolean;
};

export const OUTBOUND: readonly Outbound[] = [
  { id: "claude", to: "Anthropic, through the claude program", when: "every run, the morning brief and the machine check", code: "src/runner/runner.ts", optional: false },
  { id: "github-read", to: "api.github.com", when: "the poller reads pull requests, checks and branches of projects with a repo", code: "src/jobs/github.ts", optional: true },
  { id: "github-merge", to: "GitHub, through gh", when: "the owner clicks Aceptar or Lanzar: gh opens and merges the pull request", code: "src/mcp/release-ship.ts", optional: true },
  { id: "vercel-read", to: "api.vercel.com", when: "the poller reads deployments of projects with a Vercel project and key (Camino's, or settings.vercel and its env var)", code: "src/jobs/vercel.ts", optional: true },
  { id: "push", to: "the phone's push service (Apple, Google or Mozilla)", when: "a notice to phones that turned on notices, with VAPID keys set", code: "src/push.ts", optional: true },
  { id: "qa-browser", to: "the npm registry and Playwright's download site", when: "the first QA walk-through downloads the browser tools (npx @playwright/mcp)", code: "src/runner/runner.ts", optional: true },
  { id: "agent-wake", to: "the wake URL of an agent with the http adapter", when: "Plania wakes that agent with the ticket's key", code: "src/adapters/spawn.ts", optional: true },
  { id: "tailscale", to: "the owner's tailnet, through tailscale serve", when: "a test copy is opened on the phone", code: "src/captures/vivo.ts", optional: true },
  { id: "scanner-download", to: "github.com (gitleaks releases)", when: "the diff scanner downloads its pinned tool once, checked by hash", code: "src/lib/scan/gitleaks.ts", optional: true },
];
