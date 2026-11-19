// PLA-I2-17: GET /api/release, the release this server is (version, commit, build time) and its notes
// (CHANGELOG.md, in the owner's words) for the screen: the version line in Plomería and the Novedades page.
// PLA-I2-8: and the last update's report (machine_state `update.last`): what it kept of the owner's kit.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { withDb } from "../db/client.js";
import { machineState } from "../db/schema.js";
import { readChangelog, readRelease, ROOT_DIR } from "../release.js";
import type { ReleaseReading } from "../../ui/src/lib/version.js";
import type { UpdateReport } from "../../ui/src/lib/actualizar.js";

export const UPDATE_STATE_KEY = "update.last";

export const lastUpdate = (): Promise<UpdateReport | null> =>
  withDb(async (db) => {
    const [row] = await db.select({ value: machineState.value }).from(machineState).where(eq(machineState.key, UPDATE_STATE_KEY)).limit(1);
    return (row?.value as UpdateReport | undefined) ?? null;
  });

export function releaseRoutes(rootDir: string = ROOT_DIR, readLast: () => Promise<UpdateReport | null> = lastUpdate) {
  const routes = new Hono();
  routes.get("/", async (c) => {
    const last = await readLast().catch(() => null);
    // A report from another version (an older update) is not shown as this one's.
    const release = readRelease(rootDir);
    const last_update = last && last.to === release.version ? last : null;
    return c.json({ ...release, notes: readChangelog(rootDir), last_update } satisfies ReleaseReading);
  });
  return routes;
}
