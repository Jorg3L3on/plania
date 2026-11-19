// PLA-I2-12: GET /api/machine-check, the machine check for the screen (/machine/falta). The same items the install
// command and `pnpm machine:check` print (src/machine-check/). The check runs a short `claude -p`, so a reading is
// kept for ten minutes and shared by concurrent requests; ?fresh=1 checks again.
import { Hono } from "hono";
import { blocking, machineCheck, type MachineItem } from "../machine-check/index.js";
import type { MachineCheckReading } from "../../ui/src/lib/falta.js";

const KEEP_MS = 10 * 60_000;

export function machineCheckRoutes(check: () => Promise<MachineItem[]> = () => machineCheck(), now: () => Date = () => new Date()) {
  let last: { at: number; reading: MachineCheckReading } | null = null;
  let running: Promise<MachineCheckReading> | null = null;
  const read = (): Promise<MachineCheckReading> => {
    running ??= check()
      .then((items) => {
        const reading = { items, ready: blocking(items).length === 0, checked_at: now().toISOString() };
        last = { at: now().getTime(), reading };
        return reading;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  const routes = new Hono();
  routes.get("/", async (c) => {
    const fresh = c.req.query("fresh") === "1";
    if (!fresh && last && now().getTime() - last.at < KEEP_MS) return c.json(last.reading);
    return c.json(await read());
  });
  return routes;
}
