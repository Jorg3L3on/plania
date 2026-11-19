// PLA-I2-17: GET /api/release, the release this server is (version, commit, build time) and its notes
// (CHANGELOG.md, in the owner's words) for the screen: the version line in Plomería and the Novedades page.
import { Hono } from "hono";
import { readChangelog, readRelease, ROOT_DIR } from "../release.js";
import type { ReleaseReading } from "../../ui/src/lib/version.js";

export function releaseRoutes(rootDir: string = ROOT_DIR) {
  const routes = new Hono();
  routes.get("/", (c) => c.json({ ...readRelease(rootDir), notes: readChangelog(rootDir) } satisfies ReleaseReading));
  return routes;
}
