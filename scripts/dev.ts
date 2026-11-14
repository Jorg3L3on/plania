// The Plania server: it runs on this Mac only.
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
import { withDb } from "../src/db/client.js";
import { sweepOrphans } from "../src/runner/runner.js";

const { values } = parseArgs({ options: { port: { type: "string", default: "3737" } }, strict: false });
const port = Number(values.port);
const hostname = "127.0.0.1";

const distDir = path.resolve(import.meta.dirname, "../dist/ui");
const indexPath = path.join(distDir, "index.html");

// PLANIA_STORE=devva: plania runs on the devva store and needs no Postgres (deploy/devva/README.md).
// Everything that asks for the database gets the store's handle. The default is Postgres.
if (process.env.PLANIA_STORE === "devva") {
  const { DevvaStore } = await import("../src/store/devva.js");
  const { useDb } = await import("../src/db/client.js");
  const store = await DevvaStore.open({ prefix: process.env.PLANIA_DEVVA_PREFIX || "plania" });
  useDb(store.handle);
  console.log(`[store] devva: ${store.commits} commits replayed, ${store.recovered.repaired} projection records rewritten`);
}

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

// PLANIA_SEARCH=devva: the search tool, on a devva vector lobe with embeddings from SEXTANT_URL. It works with
// either store. An unreachable engine or embedder is logged; the server runs on without search.
if (process.env.PLANIA_SEARCH === "devva") {
  const { startSearch } = await import("../src/search/service.js");
  const { makeDb } = await import("../src/db/client.js");
  void startSearch(makeDb().db).catch((e) => console.log(`[search] off: ${e instanceof Error ? e.message : String(e)}`));
}

// Devva as a shadow of Postgres (deploy/devva/README.md). An unreachable engine is logged; the server runs on.
if (process.env.PLANIA_SHADOW === "devva" && process.env.PLANIA_STORE !== "devva") {
  const { Shadow } = await import("../src/store/shadow.js");
  const { makeDb } = await import("../src/db/client.js");
  void Shadow.start(makeDb().db, { prefix: process.env.PLANIA_DEVVA_PREFIX || "plania" })
    .then((s) => console.log(`[shadow] devva on, ${s.devva.commits} commits in its log`))
    .catch((e) => console.log(`[shadow] off: ${e instanceof Error ? e.message : String(e)}`));
}

// PLA-I29-2: runs left "running" by an earlier server are stopped and closed (fail: orphaned).
if (process.env.PLANIA_JOBS !== "0") {
  void withDb((db) => sweepOrphans(db))
    .then((n) => n > 0 && console.log(`[runner] swept ${n} orphaned run(s)`))
    .catch((e) => console.log(`[runner] orphan sweep failed: ${e instanceof Error ? e.message : String(e)}`));
}
