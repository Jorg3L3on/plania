// Local server. Production on Vercel runs api/index.ts instead.
// Serves /mcp, the API and the built SPA (dist/ui) from one process.
//   pnpm start            → port 3737, the launchd service
//   pnpm dev:api          → port 3738, behind Vite's dev proxy
// Bound to 127.0.0.1 so nothing outside this machine can reach it.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { app } from "../src/app.js";
import { startJobs } from "../src/jobs/index.js";

const { values } = parseArgs({ options: { port: { type: "string", default: "3737" } }, strict: false });
const port = Number(values.port);
const hostname = "127.0.0.1";

const distDir = path.resolve(import.meta.dirname, "../dist/ui");
const indexPath = path.join(distDir, "index.html");

const server = new Hono();
server.route("/", app);

// Hashed build assets can be cached forever; index.html must always be fresh.
server.use(
  "/assets/*",
  serveStatic({
    root: path.relative(process.cwd(), distDir),
    onFound: (_path, c) => c.header("Cache-Control", "public, max-age=31536000, immutable"),
  }),
);

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
