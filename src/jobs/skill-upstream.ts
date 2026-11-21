import type { Job } from "./index.js";
import { upstreamTick } from "../runner/skill-import.js";

// PLA-I71-5: every six hours, look at each brought skill's link again and mark «versión nueva» when upstream changed.
// Nothing updates by itself: the owner sees the diff and accepts or declines (src/runner/skill-import.ts).
export const skillUpstreamJob: Job = {
  name: "skill-upstream",
  intervalMs: 6 * 60 * 60 * 1000,
  runOnce: async (db, now) => {
    const out = await upstreamTick(db, {}, now);
    return { checked: out.checked, marked: out.marked.length };
  },
};
