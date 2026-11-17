// PLA-I48-3: Pruebas. Runs the project's verify commands (settings.qa.verify, else package.json's test script) in
// the test copy's worktree when the owner asks, one run at a time per floor. The click starts the run and returns
// at once; the floor reads the state until it ends. The last result (pass/fail per command, counts when the
// runner prints them, duration and the output tail, scrubbed) is kept in machine_state.
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { machineState } from "../db/schema.js";
import { checkoutEnv, shellExec } from "../captures/run.js";
import { appDirs, scrub, secretValues } from "./env.js";
import { findScripts } from "./detect.js";
import { MaquinaError } from "./errors.js";
import { appEnvOf, mdeps, menv, projectOf } from "./machines.js";

export type PruebaStep = { name: string; command: string; ok: boolean; code: number | null; ms: number; passed: number | null; failed: number | null; tail: string[] };
export type PruebasResult = { ok: boolean; started_at: string; ended_at: string; duration_ms: number; passed: number | null; failed: number | null; steps: PruebaStep[]; commit: string | null };
export type PruebasRead = { running: { started_at: string; step: string | null } | null; last: PruebasResult | null; commands: { name: string; command: string }[]; can: boolean; reason: string | null };

const TAIL = 40;
const running = new Map<string, { started_at: string; step: string | null; done: Promise<void> }>();
const key = (slug: string) => `maquinas:pruebas:${slug}`;

// Counts the common runners print: node --test (# pass N / # fail N), vitest/jest (N passed, N failed).
export function countsOf(text: string): { passed: number | null; failed: number | null } {
  const num = (re: RegExp) => {
    const all = [...text.matchAll(re)];
    return all.length ? Number(all[all.length - 1]![1]) : null;
  };
  const passed = num(/^# pass (\d+)/gm) ?? num(/(\d+) passed/g);
  const failed = num(/^# fail (\d+)/gm) ?? num(/(\d+) failed/g) ?? (passed !== null ? 0 : null);
  return { passed, failed };
}

function commandsOf(p: Awaited<ReturnType<typeof projectOf>>) {
  const verify = p.settings.qa?.verify ?? [];
  if (verify.length) return verify.map((v) => ({ name: v.name, command: v.command, timeout: (v.timeout_minutes ?? 15) * 60_000 }));
  const dirs = appDirs(p.slug, p.settings, menv());
  const t = findScripts(dirs.prueba ?? dirs.repo).test;
  return t ? [{ name: "test", command: t, timeout: 15 * 60_000 }] : [];
}

async function last(db: Db, slug: string): Promise<PruebasResult | null> {
  const [r] = await db.select().from(machineState).where(eq(machineState.key, key(slug)));
  return (r?.value as PruebasResult | undefined) ?? null;
}

export async function pruebasRead(db: Db, slug: string): Promise<PruebasRead> {
  const p = await projectOf(db, slug);
  const cmds = commandsOf(p);
  const wt = appDirs(slug, p.settings, menv()).prueba;
  const r = running.get(slug);
  if (!r) await closeInterrupted(db, slug);
  const reason = !cmds.length ? "Este piso no tiene comandos de prueba (settings.qa.verify o un script test)" : !wt ? "Enciende la app una vez para crear la copia de prueba" : null;
  return { running: r ? { started_at: r.started_at, step: r.step } : null, last: await last(db, slug), commands: cmds.map(({ name, command }) => ({ name, command })), can: !reason, reason };
}

// PLA-53: a run lives in this process. It leaves a marker while it runs; a marker with no run behind it is a run the
// server's restart cut, and it is recorded as that (once) instead of vanishing.
const markKey = (slug: string) => `maquinas:pruebas:${slug}:corriendo`;
export const INTERRUPTED = "Plania se reinició a media corrida: las pruebas no terminaron. Córrelas otra vez.";
async function closeInterrupted(db: Db, slug: string): Promise<void> {
  const [m] = await db.select().from(machineState).where(eq(machineState.key, markKey(slug)));
  if (!m) return;
  const v = m.value as { started_at?: string; step?: string | null; server_pid?: number };
  // Another live Plania server on this database (a dev server) may still be running it.
  if (v.server_pid && v.server_pid !== process.pid && alive(v.server_pid)) return;
  const ended = new Date();
  const started = v.started_at ?? ended.toISOString();
  const result: PruebasResult = {
    ok: false,
    started_at: started,
    ended_at: ended.toISOString(),
    duration_ms: Math.max(0, ended.getTime() - Date.parse(started)),
    passed: null,
    failed: null,
    steps: [{ name: v.step ?? "?", command: "", ok: false, code: null, ms: 0, passed: null, failed: null, tail: [INTERRUPTED] }],
    commit: null,
  };
  await db.insert(machineState).values({ key: key(slug), value: result }).onConflictDoUpdate({ target: machineState.key, set: { value: result, updatedAt: ended } });
  await db.delete(machineState).where(eq(machineState.key, markKey(slug)));
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Starts a run. A second call while one runs is refused.
export async function correrPruebas(db: Db, slug: string): Promise<PruebasRead> {
  if (running.has(slug)) throw new MaquinaError("TESTS_RUNNING", "Las pruebas ya están corriendo");
  const p = await projectOf(db, slug);
  const cmds = commandsOf(p);
  if (!cmds.length) throw new MaquinaError("NOT_CONFIGURED", "Este piso no tiene comandos de prueba");
  const wt = appDirs(slug, p.settings, menv()).prueba;
  if (!wt) throw new MaquinaError("NO_TEST_COPY", "Enciende la app una vez para crear la copia de prueba");
  const secrets = [...secretValues(process.env), ...secretValues(appEnvOf(p).env.values)];
  const startedAt = new Date();
  const state = { started_at: startedAt.toISOString(), step: cmds[0]!.name as string | null, done: Promise.resolve() };
  running.set(slug, state);
  const mark = { started_at: state.started_at, step: state.step, server_pid: process.pid };
  await db
    .insert(machineState)
    .values({ key: markKey(slug), value: mark })
    .onConflictDoUpdate({ target: machineState.key, set: { value: mark, updatedAt: startedAt } })
    .catch((e) => console.log(`[pruebas] ${slug}: could not mark the run: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`));
  state.done = (async () => {
    const steps: PruebaStep[] = [];
    try {
      for (const c of cmds) {
        state.step = c.name;
        const t0 = Date.now();
        const r = await (mdeps().exec ?? shellExec)(c.command, { cwd: wt, timeoutMs: c.timeout, env: checkoutEnv({ CI: "1" }) });
        const text = scrub(`${r.stdout}\n${r.stderr}`, secrets);
        const counts = countsOf(text);
        steps.push({
          name: c.name,
          command: c.command,
          ok: r.code === 0,
          code: r.code,
          ms: Date.now() - t0,
          ...counts,
          tail: text
            .split("\n")
            .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trimEnd())
            .filter(Boolean)
            .slice(-TAIL)
            .map((l) => l.slice(0, 240)),
        });
      }
    } catch (e) {
      steps.push({ name: state.step ?? "?", command: "", ok: false, code: null, ms: 0, passed: null, failed: null, tail: [scrub(e instanceof Error ? e.message : String(e), secrets).slice(0, 240)] });
    }
    const ended = new Date();
    const sum = (k: "passed" | "failed") => (steps.some((s) => s[k] !== null) ? steps.reduce((a, s) => a + (s[k] ?? 0), 0) : null);
    const result: PruebasResult = { ok: steps.every((s) => s.ok), started_at: state.started_at, ended_at: ended.toISOString(), duration_ms: ended.getTime() - startedAt.getTime(), passed: sum("passed"), failed: sum("failed"), steps, commit: null };
    await db
      .insert(machineState)
      .values({ key: key(slug), value: result })
      .onConflictDoUpdate({ target: machineState.key, set: { value: result, updatedAt: ended } })
      .catch((e) => console.log(`[pruebas] ${slug}: could not save the result: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`));
    await db.delete(machineState).where(eq(machineState.key, markKey(slug))).catch(() => undefined);
  })().finally(() => running.delete(slug));
  return pruebasRead(db, slug);
}

// Tests: wait for a floor's run to end.
export async function pruebasDone(slug: string): Promise<void> {
  await running.get(slug)?.done;
}
