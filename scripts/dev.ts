// The Plania server: it runs on this Mac only.
// Serves /mcp, the API and the built SPA (dist/ui) from one process.
//   pnpm start            → port 3737, the launchd service
//   pnpm dev:api          → port 3738, behind Vite's dev proxy
// Bound to 127.0.0.1 so nothing outside this machine can reach it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { app } from "../src/app.js";
import { startJobs } from "../src/jobs/index.js";
import { withDb } from "../src/db/client.js";
import { sweepOrphans } from "../src/runner/runner.js";
import { gitState, readUiBuild, staleReason } from "../src/ui-build.js";

const { values } = parseArgs({ options: { port: { type: "string", default: "3737" } }, strict: false });
const port = Number(values.port);
const hostname = "127.0.0.1";

const distDir = path.resolve(import.meta.dirname, "../dist/ui");
const indexPath = path.join(distDir, "index.html");
const repoDir = path.resolve(import.meta.dirname, "..");

// PLA-I46-1: a restart is a deploy. dist/ui used to be rebuilt only by a manual `pnpm build`, so a
// restart on a newer HEAD kept serving the old bundle. Rebuild here when the stamp is not HEAD.
// Only for the launchd server (3737); the dev API behind Vite never serves dist/ui.
if ((port === 3737 && process.env.PLANIA_UI_BUILD !== "0") || process.env.PLANIA_UI_BUILD === "1") {
  const reason = staleReason(readUiBuild(distDir), gitState(repoDir), existsSync(indexPath));
  if (reason) {
    console.log(`[ui] rebuilding dist/ui: ${reason}`);
    try {
      execFileSync(process.execPath, [path.join(repoDir, "node_modules/vite/bin/vite.js"), "build"], {
        cwd: repoDir,
        stdio: "inherit",
        timeout: 5 * 60_000,
      });
      console.log(`[ui] built ${readUiBuild(distDir)?.commit?.slice(0, 7) ?? "unknown"}`);
    } catch (e) {
      console.log(`[ui] build failed, serving the previous dist/ui: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

const server = new Hono();
// Which commit the screen is on, for a check after a deploy (no auth: it names a commit, nothing else).
server.get("/health/ui", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ ui: readUiBuild(distDir), head: gitState(repoDir) });
});
server.route("/", app);

// Hashed build assets can be cached forever; index.html must always be fresh.
server.use(
  "/assets/*",
  serveStatic({
    root: path.relative(process.cwd(), distDir),
    onFound: (_path, c) => c.header("Cache-Control", "public, max-age=31536000, immutable"),
  }),
);

// The few unhashed files from ui/public: the manifest and service worker must be re-checked on
// every load so updates reach installed apps; icons can sit in a cache for a day.
const publicFiles = (cacheControl: string) =>
  serveStatic({ root: path.relative(process.cwd(), distDir), onFound: (_path, c) => c.header("Cache-Control", cacheControl) });
server.get("/sw.js", publicFiles("no-cache"));
server.get("/manifest.webmanifest", publicFiles("no-cache"));
for (const p of ["/icons/*", "/favicon.svg", "/favicon-16.png", "/favicon-32.png", "/apple-touch-icon.png"]) {
  server.get(p, publicFiles("public, max-age=86400"));
}

// SPA fallback: any other GET that no route claimed gets index.html, except API and MCP paths.
server.get("*", (c) => {
  if (c.req.path.startsWith("/api/") || c.req.path === "/mcp") return c.notFound();
  if (!existsSync(indexPath)) return c.text("UI not built. Run: pnpm build", 503);
  c.header("Cache-Control", "no-cache");
  return c.html(readFileSync(indexPath, "utf8"));
});

serve({ fetch: server.fetch, port, hostname }, () => console.log(`plania on http://localhost:${port}`));

// Background jobs (lease warnings, legacy card archiving, later the pollers). PLANIA_JOBS=0 turns them off.
if (process.env.PLANIA_JOBS !== "0") startJobs();

// PLA-I29-2: runs left "running" by an earlier server are stopped and closed (fail: orphaned).
if (process.env.PLANIA_JOBS !== "0") {
  void withDb((db) => sweepOrphans(db))
    .then((n) => n > 0 && console.log(`[runner] swept ${n} orphaned run(s)`))
    .catch((e) => console.log(`[runner] orphan sweep failed: ${e instanceof Error ? e.message : String(e)}`));
}
