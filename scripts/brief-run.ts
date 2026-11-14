// PLA-I41-6: pnpm brief:run [--pass brief|ideas|all] [--no-wait] — asks the local Plania server to run the Morning
// brief (POST /api/brief/run), so the lock, the runner slot and the logs stay in the server. It signs a session
// cookie with SESSION_SECRET from .env, like the screen's login, and then follows the run until it ends.
// Prints the run id and plain status lines only; never a token or a cookie.
import { parseArgs } from "node:util";
import { SESSION_COOKIE, createSession } from "../src/auth/session.js";

const { values } = parseArgs({
  options: {
    pass: { type: "string", default: "all" },
    "no-wait": { type: "boolean", default: false },
    port: { type: "string" },
  },
  strict: true,
});

const PASSES: Record<string, string[] | undefined> = { all: undefined, brief: ["brief"], ideas: ["ideas"] };
if (!(values.pass! in PASSES)) {
  console.error("--pass is brief, ideas or all");
  process.exit(2);
}
const base = process.env.PLANIA_URL?.replace(/\/$/, "") || `http://127.0.0.1:${values.port ?? process.env.PORT ?? "3737"}`;
const headers = { Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" };

let res: Response;
try {
  const passes = PASSES[values.pass!];
  res = await fetch(`${base}/api/brief/run`, { method: "POST", headers, body: JSON.stringify({ trigger: "cli", ...(passes ? { passes } : {}) }) });
} catch {
  console.error(`The Plania server is not answering at ${base}. Start it (pnpm start) and try again.`);
  process.exit(1);
}
const body = (await res.json().catch(() => ({}))) as { run_id?: string; error?: string };
if (res.status === 409) {
  console.log(`A Morning brief is already running (${body.run_id ?? "unknown run"}).`);
  process.exit(1);
}
if (res.status !== 202 || !body.run_id) {
  console.error(`The server refused the run: ${res.status} ${body.error ?? ""}`.trim());
  process.exit(1);
}
console.log(`Morning brief started: run ${body.run_id}`);
if (values["no-wait"]) process.exit(0);

let last = "";
for (;;) {
  await new Promise((r) => setTimeout(r, 5_000));
  const latest = (await fetch(`${base}/api/brief/latest`, { headers })
    .then((r) => r.json())
    .catch(() => null)) as { run?: { id: string; status: string; waiting_for_build?: boolean } | null; brief?: { mode: string; generated_at: string } | null } | null;
  if (!latest) continue;
  const run = latest.run;
  if (run && run.id === body.run_id) {
    const now = run.status === "waiting" ? (run.waiting_for_build ? "Waiting for the current build" : "Waiting for the runner slot") : "Generating…";
    if (now !== last) console.log(now);
    last = now;
    continue;
  }
  console.log(latest.brief ? `Done: ${latest.brief.mode} brief at ${latest.brief.generated_at}` : "The run ended without a brief; see the page for its status.");
  break;
}
