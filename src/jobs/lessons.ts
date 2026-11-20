import type { Job } from "./index.js";
import { lessonsTick } from "../runner/reflector.js";

// PLA-I67-3: every minute, read the owner's new corrections, expire proposals nobody looked at in four weeks, and run
// the reflector on a few (src/runner/reflector.ts). Starts with the wakes (it uses the owner's plan like a run);
// PLANIA_REFLECTOR=0 turns the reflector off and keeps the rest.
export const lessonsJob: Job = {
  name: "lessons",
  intervalMs: 60 * 1000,
  runOnce: async (db, now) => {
    const out = await lessonsTick(db, now, process.env.PLANIA_REFLECTOR === "0" ? async () => ({ verdict: "one_off", why: "reflector off" }) : undefined);
    return { captured: out.captured, expired: out.expired, reflected: out.done, failed: out.failed };
  },
};
