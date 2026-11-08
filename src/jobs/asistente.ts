import { runAsistente } from "../runner/asistente.js";
import type { Job } from "./index.js";

// PLA-I31-2: every minute it asks the clock whether the 07:00 brief or the 2-hourly check is due
// (src/runner/asistente.ts). Server-side and 0 tokens: it runs with the other jobs, without PLANIA_JOBS=1.
export const asistenteJob: Job = {
  name: "asistente",
  intervalMs: 60_000,
  runOnce: (db, now) => runAsistente(db, now),
};
