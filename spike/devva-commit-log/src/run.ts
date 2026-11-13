// The spike's checks. Each prints PASS or FAIL with the numbers it saw; the exit code is the count of failures.
//   pnpm exec tsx spike/devva-commit-log/src/run.ts
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { claim, createTask, finish, increment } from "./domain.js";
import { Store, StoreError } from "./store.js";

const CONTAINER = "plania-devva-spike-engine-1";
const prefix = `sp_${Date.now().toString(36)}`;
const worker = path.resolve(import.meta.dirname, "worker.ts");
let failures = 0;

function check(name: string, ok: boolean, detail: unknown): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail)}`);
}
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof StoreError ? e.code : `threw ${String(e)}`;
  }
}
function child(args: string[], env: Record<string, string> = {}): Promise<{ exit: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", "tsx", worker, ...args], { env: { ...process.env, ...env }, cwd: path.resolve(import.meta.dirname, "..") });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (exit) => resolve({ exit, out }));
  });
}
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

console.log(`engine  ${docker("inspect", CONTAINER, "--format", "{{.Config.Image}} {{index .Config.Labels \"org.devva.integration\"}} {{json .Args}}")}`);
console.log(`prefix  ${prefix}   client xyzdb (vendored from devva-eval)   node ${process.version}`);

// 1. One tool flow, three commits, and the projection agrees with the log.
let store = await Store.open({ prefix });
const t1 = await createTask(store, "p1", "Port the write path");
const c1 = await claim(store, "p1", t1.key, "session-a", t1.version);
const f1 = await finish(store, "p1", t1.key, "session-a", "ran the spike");
check("flow: create, claim, finish", f1.status === "In review" && f1.version === 3 && store.head === 3, { key: t1.key, versions: [t1.version, c1.version, f1.version], head: store.head });
check("flow: projection equals the log", JSON.stringify(await store.drift(["p1"])) === '{"missing":0,"extra":0,"stale":0}', { drift: await store.drift(["p1"]), bucket: (await store.bucket("p1")).length, events: await store.eventCount("p1") });

// 2. Idempotency: the same request id returns the first reply and writes nothing.
const r1 = await createTask(store, "p1", "Idempotent", "req-1");
const headAfter = store.head;
const r2 = await createTask(store, "p1", "Idempotent", "req-1");
check("idempotency: retry replays", r1.key === r2.key && store.head === headAfter, { first: r1.key, second: r2.key, head: store.head });
check("idempotency: other tool refused", (await code(claim(store, "p1", r1.key, "s", 1, "req-1"))) === "REQUEST_ID_REUSED", {});

// 3. Versioned write: a stale version is refused and nothing is committed.
const before = store.head;
check("stale version refused", (await code(claim(store, "p1", r1.key, "session-b", 99))) === "STALE_VERSION" && store.head === before, { head: store.head });

// 4. A handler that fails after its first put leaves no trace.
const t4 = await createTask(store, "p1", "Abort me");
const c4 = await claim(store, "p1", t4.key, "session-a", t4.version);
const h4 = store.head;
const failed = await code(finish(store, "p1", t4.key, "session-a", "x", { failAfterResult: true }));
const results4 = (await store.bucket("p1")).filter((r) => r.kind === "result" && r.task_key === t4.key).length;
check("abort: nothing written", failed === "EVIDENCE_REQUIRED" && store.head === h4 && results4 === 0, { error: failed, head: store.head, results: results4, taskVersion: c4.version });

// 5. Commit latency, one writer.
const times: number[] = [];
for (let i = 0; i < 200; i++) {
  const t0 = performance.now();
  await increment(store, "p1", "latency");
  times.push(performance.now() - t0);
}
console.log(`MEASURE write (commit + 2 projection statements + watermark), 200 runs: median ${median(times).toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms`);
store.close();

// 6. The process dies right after the commit, before any projection statement.
const crashA = await child(["one", prefix, "p2"], { SPIKE_CRASH: "after-commit" });
store = await Store.open({ prefix });
const tasksP2 = (await store.bucket("p2")).filter((r) => r.kind === "task").length;
check("crash after commit: recovered on boot", crashA.exit === 137 && store.recovered.reapplied >= 1 && tasksP2 === 1 && (await store.drift(["p1", "p2"])).missing === 0, { childExit: crashA.exit, recovered: store.recovered, tasksInP2: tasksP2, drift: await store.drift(["p1", "p2"]) });
store.close();

// 7. The process dies after the first projection statement of a commit.
const crashB = await child(["one", prefix, "p2"], { SPIKE_CRASH: "mid-apply" });
store = await Store.open({ prefix });
const d7 = await store.drift(["p2"]);
check("crash mid-apply: recovered on boot", crashB.exit === 137 && store.recovered.reapplied >= 1 && d7.missing + d7.stale + d7.extra === 0 && (await store.eventCount("p2")) === 2, { childExit: crashB.exit, recovered: store.recovered, drift: d7, eventsInP2: await store.eventCount("p2") });
store.close();

// 8. Two writer processes increment one record. The engine's guarded SET kept 50 of 400 (CW-14).
const N = 100;
const race = await Promise.all([child(["inc", prefix, "p3", "shared", String(N)]), child(["inc", prefix, "p3", "shared", String(N)])]);
store = await Store.open({ prefix });
const value = store.recs.get("metric:p3:shared")?.value;
const conflicts = race.map((r) => Number(/"conflicts":(\d+)/.exec(r.out)?.[1] ?? -1));
check("two writers: no lost update", value === 2 * N && race.every((r) => r.exit === 0), { expected: 2 * N, value, conflictsPerWriter: conflicts, exits: race.map((r) => r.exit) });
const driftRace = await store.drift(["p3"]);
console.log(`OBSERVE projection after two concurrent appliers: ${JSON.stringify(driftRace)} (stale > 0 means an older image landed last)`);
store.close();
store = await Store.open({ prefix, reproject: true });
const d8 = await store.drift(["p3"]);
check("two writers: projection rebuilt from the log", d8.missing + d8.stale + d8.extra === 0, { drift: d8, reapplied: store.recovered.reapplied });
store.close();

// 9. kill -9 on the engine while a writer streams commits.
const streaming = child(["stream", prefix, "p4", "400"]);
await new Promise((r) => setTimeout(r, 1500));
docker("kill", "-s", "KILL", CONTAINER);
const stream = await streaming;
docker("start", CONTAINER);
const acked = [...stream.out.matchAll(/^ACK (\d+)$/gm)].map((m) => Number(m[1]));
let opened: Store | null = null;
for (let i = 0; i < 40 && !opened; i++) {
  try {
    opened = await Store.open({ prefix });
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!opened) throw new Error("engine did not come back");
store = opened;
const lastAck = Math.max(0, ...acked);
const d9 = await store.drift(["p1", "p2", "p3", "p4"]);
check("engine kill -9: every acknowledged commit survived", acked.length > 0 && store.head >= lastAck, { acked: acked.length, lastAck, headAfterRestart: store.head, committedButUnacked: store.head - lastAck, logReplayed: store.recovered.replayed });
check("engine kill -9: projection consistent after boot", d9.missing + d9.stale + d9.extra === 0, { drift: d9, reapplied: store.recovered.reapplied, tasksInP4: (await store.bucket("p4")).filter((r) => r.kind === "task").length });
const after = await createTask(store, "p4", "written after the restart");
check("engine kill -9: writes resume", after.status === "Ready", { key: after.key, head: store.head });

// 10. A clean engine restart after many updates of one record. Inserts survive; recent in-place updates do not.
for (let i = 0; i < 400; i++) await increment(store, "p5", "updated-in-place");
const headBefore = store.head;
store.close();
docker("stop", CONTAINER);
docker("start", CONTAINER);
let seen: Store | null = null;
for (let i = 0; i < 40 && !seen; i++) {
  try {
    seen = await Store.open({ prefix, inspectOnly: true });
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!seen) throw new Error("engine did not come back");
const stale = (await seen.bucket("p5")).find((r) => r.pk === "metric:p5:updated-in-place")?.value;
console.log(`OBSERVE after a clean engine restart, before repair: log says ${seen.recs.get("metric:p5:updated-in-place")?.value}, projection says ${stale}, watermark ${seen.recovered.watermark} of ${seen.head}, drift ${JSON.stringify(await seen.drift(["p5"]))}`);
check("clean restart: the log kept every commit", seen.head === headBefore && seen.recs.get("metric:p5:updated-in-place")?.value === 400, { head: seen.head, headBefore });
seen.close();
store = await Store.open({ prefix });
const d10 = await store.drift(["p1", "p2", "p3", "p4", "p5"]);
check("clean restart: boot repairs the projection", d10.missing + d10.stale + d10.extra === 0, { drift: d10, recovered: store.recovered });

await store.purge();
store.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures);
