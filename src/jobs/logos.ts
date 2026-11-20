// PLA-120: each project's logo is read from its repo in the background too, not only when someone opens Compañía
// (GET /logos still asks, so a page view stays fresh). refreshLogos skips a project looked at in the last minute.
import { refreshLogos } from "../brand/logos.js";
import type { Job } from "./index.js";

export const logosJob: Job = {
  name: "logos",
  intervalMs: 5 * 60_000,
  runOnce: async (db) => {
    await refreshLogos(db);
    return {};
  },
};
