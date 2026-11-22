import type { Job } from "./index.js";
import { withDb } from "../db/client.js";
import { cleanClosedCopies, nightlySweep, watchClosures } from "../maquinas/sobrantes.js";

// PLA-I72-3: every two minutes, a closed initiative's copy (Done, Won't do, or every ticket merged) is stopped and
// deleted; any change to a project's tasks does the same within seconds. Once a night (after 03:00, once a day) the
// sweep also records each project's leftovers for Máquinas.
let lastSweep: string | null = null;
export const copiasJob: Job = {
  name: "copias",
  intervalMs: 2 * 60 * 1000,
  runOnce: async (db, now) => {
    watchClosures((slug) => void withDb((d) => cleanClosedCopies(d, slug)).catch(() => undefined));
    const day = now.toISOString().slice(0, 10);
    if (now.getHours() >= 3 && lastSweep !== day) {
      lastSweep = day;
      const r = await nightlySweep(db, now);
      return { cleaned: r.cleaned, leftovers: r.leftovers };
    }
    return { cleaned: await cleanClosedCopies(db), leftovers: 0 };
  },
};
