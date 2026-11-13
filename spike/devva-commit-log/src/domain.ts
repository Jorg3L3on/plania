// Three plania-shaped tools on the store: create_task, claim, finish. Each is one commit.
import { randomUUID } from "node:crypto";
import { type Rec, type Store, StoreError } from "./store.js";

const LEASE_MS = 30 * 60_000;

export type Reply = { key: string; status: string; version: number };

// Keys come from a per-project counter record that travels in the same commit as the task.
export function createTask(store: Store, project: string, title: string, rid?: string): Promise<Reply> {
  return store.write(project, { tool: "create_task", rid }, (tx) => {
    const counterPk = `counter:${project}`;
    const counter = tx.get(counterPk) ?? { pk: counterPk, project, kind: "counter", version: 0, next: 1 };
    const n = counter.next as number;
    const key = `${project.toUpperCase()}-${String(n).padStart(2, "0")}`;
    if (tx.get(`task:${project}:${key}`)) throw new StoreError("KEY_EXISTS", { key });
    tx.put({ ...counter, next: n + 1, version: counter.version + 1 });
    tx.put({ pk: `task:${project}:${key}`, project, kind: "task", version: 1, id: randomUUID(), key, title, status: "Ready", owner: null, lease_until: null, created_at: tx.now, updated_at: tx.now });
    tx.emit(project, "task.created", key, { title });
    return { key, status: "Ready", version: 1 };
  });
}

function task(tx: { get(pk: string): Rec | undefined }, project: string, key: string): Rec {
  const t = tx.get(`task:${project}:${key}`);
  if (!t) throw new StoreError("TASK_NOT_FOUND", { key });
  return t;
}

export function claim(store: Store, project: string, key: string, session: string, version: number, rid?: string): Promise<Reply> {
  return store.write(project, { tool: "claim", rid }, (tx) => {
    const t = task(tx, project, key);
    if (t.version !== version) throw new StoreError("STALE_VERSION", { current_version: t.version });
    const live = t.owner && (t.lease_until as number) > tx.now;
    if (live && t.owner !== session) throw new StoreError("CLAIM_HELD", { owner: t.owner });
    const next = tx.put({ ...t, status: "In progress", owner: session, lease_until: tx.now + LEASE_MS, version: t.version + 1, updated_at: tx.now });
    tx.emit(project, "task.claimed", key, { session });
    return { key, status: "In progress", version: next.version };
  });
}

// add_result plus In review in one commit: a failure writes neither.
export function finish(store: Store, project: string, key: string, session: string, cite: string, opts: { failAfterResult?: boolean; rid?: string } = {}): Promise<Reply> {
  return store.write(project, { tool: "finish", rid: opts.rid }, (tx) => {
    const t = task(tx, project, key);
    if (t.owner !== session) throw new StoreError("NOT_OWNER", { owner: t.owner });
    const resultId = randomUUID();
    tx.put({ pk: `result:${project}:${resultId}`, project, kind: "result", version: 1, task_key: key, verdict: "pass", cite, created_at: tx.now });
    tx.emit(project, "result.added", key, { verdict: "pass" });
    if (opts.failAfterResult) throw new StoreError("EVIDENCE_REQUIRED");
    const next = tx.put({ ...t, status: "In review", owner: null, lease_until: null, version: t.version + 1, updated_at: tx.now });
    tx.emit(project, "task.status", key, { from: t.status, to: "In review" });
    return { key, status: "In review", version: next.version };
  });
}

// Read-modify-write on one record: the case the engine's guarded SET loses (CW-14).
export function increment(store: Store, project: string, name: string): Promise<number> {
  return store.write(project, { tool: "increment" }, (tx) => {
    const pk = `metric:${project}:${name}`;
    const cur = tx.get(pk) ?? { pk, project, kind: "metric", version: 0, value: 0 };
    const value = (cur.value as number) + 1;
    tx.put({ ...cur, value, version: cur.version + 1 });
    tx.emit(project, "metric.set", null, { name, value });
    return value;
  });
}
