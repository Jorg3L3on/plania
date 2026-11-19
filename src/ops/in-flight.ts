// PLA-53: what a restart of the Plania server would kill. Runs, QA checks, El Probador's passes and Máquinas test
// runs live in the server process: a restart (every release) cuts them. `pnpm server:restart` reads this first and refuses
// while anything is listed (scripts/restart.ts).
import { and, eq, like, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, machineState, projects, qaLanes, tasks } from "../db/schema.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: what a restart would cut, in the install's language; the Spanish is unchanged.
export const IN_FLIGHT_WORDS = defineWords({
  es: {
    run: (slug: string, key: string | null, since: string | null) => `${slug} trabaja${key ? ` en ${key}` : ""}${since ? ` desde ${since}Z` : ""}`,
    qa: (key: string) => `QA corre las pruebas de ${key}`,
    fotos: (key: string) => `El Probador toma las fotos de ${key}`,
    entrega: (key: string) => `${key} se acaba de entregar: sus fotos están por empezar`,
    pruebas: (slug: string) => `Máquinas corre las pruebas de ${slug}`,
  },
  en: {
    run: (slug: string, key: string | null, since: string | null) => `${slug} is working${key ? ` on ${key}` : ""}${since ? ` since ${since}Z` : ""}`,
    qa: (key: string) => `QA is running the tests of ${key}`,
    fotos: (key: string) => `El Probador is taking the stills of ${key}`,
    entrega: (key: string) => `${key} was just delivered: its stills are about to start`,
    pruebas: (slug: string) => `Máquinas is running the tests of ${slug}`,
  },
});

export type InFlight = { kind: "run" | "qa" | "fotos" | "entrega" | "pruebas"; text: string };

// A «tomando» older than this has nobody behind it; a delivery this fresh may be about to get its pass.
// PLA-102 (guided test PLA-86, F-21): this was 6 minutes, the same as the sweep's orphan age, but a pass with three
// views at two widths, two copies and the muestra's rows runs longer. A restart at 6.6 minutes read «Nada en curso»
// and cut MIA-I10-3's pass. The sweep can retake early (it checks the pass in memory); a restart must not, so it waits
// longer before calling a pass abandoned.
export const PASS_MS = 20 * 60_000;
const FRESH_MS = 2 * 60_000;

export async function inFlight(db: Db, now = new Date()): Promise<InFlight[]> {
  const out: InFlight[] = [];
  const w = say(IN_FLIGHT_WORDS);
  const runs = await db
    .select({ slug: agents.slug, key: agentRuns.taskKey, startedAt: agentRuns.startedAt })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(eq(agentRuns.status, "running"));
  for (const r of runs) out.push({ kind: "run", text: w.run(r.slug, r.key, r.startedAt ? r.startedAt.toISOString().slice(11, 16) : null) });

  const lanes = await db.select({ key: tasks.key }).from(qaLanes).innerJoin(tasks, eq(tasks.id, qaLanes.taskId)).where(eq(qaLanes.status, "checking"));
  for (const l of lanes) out.push({ kind: "qa", text: w.qa(l.key) });

  const deliveries = await db
    .select({ t: tasks, p: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.status, "In review"), sql`${tasks.muestra} is not null`));
  for (const { t, p } of deliveries) {
    if (!p.settings.capture) continue;
    const s = t.probador;
    if (s?.state === "tomando" && now.getTime() - Date.parse(s.at) < PASS_MS) out.push({ kind: "fotos", text: w.fotos(t.key) });
    else if (!s && now.getTime() - (t.statusChangedAt ?? t.createdAt).getTime() < FRESH_MS) out.push({ kind: "entrega", text: w.entrega(t.key) });
  }

  const marks = await db.select().from(machineState).where(like(machineState.key, "maquinas:pruebas:%:corriendo"));
  for (const m of marks) {
    const pid = Number((m.value as { server_pid?: number }).server_pid);
    if (Number.isInteger(pid) && pid > 1 && alive(pid)) out.push({ kind: "pruebas", text: w.pruebas(m.key.split(":")[2] ?? "") });
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
