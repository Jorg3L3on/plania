// PLA-I46-6: take stills of a project's running test copy and keep them in Plania.
// Usage: pnpm capture <project> --checkout <path> [--task <KEY>] [--base-url <url>] [--pages a,b] [--viewports desktop,phone]
// The app must already be running (settings.capture.port). Nothing is written to the checkout; the test
// user's password is set fresh by settings.capture.session.password_command and never stored.
import { hostname } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { makeDb } from "../src/db/client.js";
import { runCapture } from "../src/captures/run.js";
import { VIEWPORT_NAMES, type ViewportName } from "../src/captures/settings.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    checkout: { type: "string" },
    task: { type: "string" },
    "base-url": { type: "string" },
    pages: { type: "string" },
    viewports: { type: "string" },
    session: { type: "string" },
  },
});
const project = positionals[0];
if (!project || !values.checkout) {
  console.error("Usage: pnpm capture <project> --checkout <path> [--task <KEY>] [--base-url <url>] [--pages a,b] [--viewports desktop,phone]");
  process.exit(2);
}
const viewports = values.viewports?.split(",").filter(Boolean) as ViewportName[] | undefined;
if (viewports?.some((v) => !VIEWPORT_NAMES.includes(v))) {
  console.error(`viewports: ${VIEWPORT_NAMES.join(", ")}`);
  process.exit(2);
}

const { db } = makeDb();
const summary = await runCapture(db, {
  project,
  checkout: path.resolve(values.checkout),
  base_url: values["base-url"],
  task_key: values.task,
  pages: values.pages?.split(",").filter(Boolean),
  viewports,
  actor: { agent: "plania-capture", session_id: values.session ?? `capture-${process.pid}`, machine: hostname() },
});
for (const s of summary.stills) console.log(`${s.status === "ok" ? "ok   " : "error"} ${s.page.padEnd(14)} ${s.viewport.padEnd(8)} ${s.error ?? s.id}`);
console.log(JSON.stringify({ run_id: summary.run_id, commit: summary.commit, branch: summary.branch, ok: summary.ok, failed: summary.failed }));
process.exit(summary.failed ? 1 : 0);
