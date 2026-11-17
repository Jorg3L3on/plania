// PLA-53: what a restart of the Plania server would kill. Runs, QA checks, El Probador's passes and Máquinas test
// runs live in the server process: a restart (every release) cuts them. `pnpm server:restart` reads this first and refuses
// while anything is listed (scripts/restart.ts).
import type { Db } from "../db/client.js";
import { readerOf } from "../store/port.js";
import { notNull } from "../store/types.js";

export type InFlight = { kind: "run" | "qa" | "fotos" | "entrega" | "pruebas"; text: string };

// A «tomando» older than this has nobody behind it (the sweep takes it again); a delivery this fresh may be about to
// get its pass.
const PASS_MS = 6 * 60_000;
const FRESH_MS = 2 * 60_000;

// machine_state keys like 'maquinas:pruebas:%:corriendo'.
const MARK_START = "maquinas:pruebas:";
const MARK_END = ":corriendo";

export async function inFlight(db: Db, now = new Date()): Promise<InFlight[]> {
  const out: InFlight[] = [];
  const r = readerOf(db);
  for (const run of await r.find("agentRuns", { status: "running" })) {
    const agent = await r.get("agents", { id: run.agentId });
    if (!agent) continue;
    out.push({ kind: "run", text: `${agent.slug} trabaja${run.taskKey ? ` en ${run.taskKey}` : ""}${run.startedAt ? ` desde ${run.startedAt.toISOString().slice(11, 16)}Z` : ""}` });
  }

  for (const lane of await r.find("qaLanes", { status: "checking" })) {
    const t = await r.get("tasks", { id: lane.taskId });
    if (t) out.push({ kind: "qa", text: `QA corre las pruebas de ${t.key}` });
  }

  for (const t of await r.find("tasks", { status: "In review", muestra: notNull() })) {
    const p = await r.get("projects", { id: t.projectId });
    if (!p || !p.settings.capture) continue;
    const s = t.probador;
    if (s?.state === "tomando" && now.getTime() - Date.parse(s.at) < PASS_MS) out.push({ kind: "fotos", text: `El Probador toma las fotos de ${t.key}` });
    else if (!s && now.getTime() - (t.statusChangedAt ?? t.createdAt).getTime() < FRESH_MS) out.push({ kind: "entrega", text: `${t.key} se acaba de entregar: sus fotos están por empezar` });
  }

  const marks = (await r.find("machineState")).filter((m) => m.key.length >= MARK_START.length + MARK_END.length && m.key.startsWith(MARK_START) && m.key.endsWith(MARK_END));
  for (const m of marks) {
    const pid = Number((m.value as { server_pid?: number }).server_pid);
    if (Number.isInteger(pid) && pid > 1 && alive(pid)) out.push({ kind: "pruebas", text: `Máquinas corre las pruebas de ${m.key.split(":")[2]}` });
  }
  return out;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
