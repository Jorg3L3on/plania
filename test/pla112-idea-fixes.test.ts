// PLA-112 (guided test PLA-86): F-9, Research and Artist move an idea only out of their own stage (Artist moved one
// idea → research → design → planning after the owner rewound it); F-5, the Entendido stop shows the PO's own ficha;
// F-4, the step log says statuses in the owner's words and an open view reads again after an action.
// Throwaway DB, fake values only.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { attachDoc } = await import("../src/mcp/docs.js");
const { fichaOf } = await import("../src/api/company-pedido.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ME = { actor: { agent: "test", session_id: "pla112" } };
const DOCS: Record<string, [string, string]> = {
  idea: ["Idea", "# Idea\n## Problem\nx\n## Who it is for\ny\n## Why now\nz"],
  research: ["Research", "# R\n## What we learned\nx\n## Options\ny\n## Recommendation\nUsar DayPicker"],
  design: ["Design", "# D\n## Approach\nx\n## Scope\ny\n## Out of scope\nz"],
};

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  await seedOrg(made.db);
});
after(async () => {
  await closeDb?.();
  await raw?.end();
});

// A run of the project's agent with this role, and the actor its connection writes as.
async function runOf(role: string): Promise<{ actor: { agent: string; session_id: string } }> {
  const a = (await raw.query(`select a.id, p.id as pid from agents a, projects p where p.slug = 'micasa' and a.role_template = $1 and (a.project_id = p.id or a.project_id is null) order by a.project_id nulls last limit 1`, [role])).rows[0];
  const id = (await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, queued_at) values ($1, $2, $3, 'running', 'running', now()) returning id`, [a.id, a.pid, role])).rows[0].id as string;
  return { actor: { agent: "plania-runner", session_id: `run-${id.replace(/-/g, "").slice(0, 16)}` } };
}
const version = async (key: string) => (await raw.query(`select version from tasks where key = $1`, [key])).rows[0].version as number;
async function idea(at: "idea" | "research" | "design"): Promise<string> {
  const { key } = (await writes.createTask(db, { project: "micasa", kind: "idea", title: `Agenda ${at}` } as never, ME)) as { key: string };
  for (const [stage, [title, markdown]] of Object.entries(DOCS)) await attachDoc(db, { project: "micasa", key, title, markdown }, ME);
  await raw.query(`update tasks set stage = $2 where key = $1`, [key, at]);
  return key;
}

test("PLA-112 F-9: Artist cannot move an idea that is not in design; it moves one out of design; the PO is not held", async () => {
  const artist = await runOf("artist");
  const rewound = await idea("idea");
  await assert.rejects(writes.setTask(db, { project: "micasa", key: rewound, stage: "research", version: await version(rewound) } as never, artist), (e: Json) => e.code === "IDEA_STAGE_NOT_YOURS" && e.detail.owns === "design" && e.detail.stage === "idea");
  assert.equal((await raw.query(`select stage from tasks where key = $1`, [rewound])).rows[0].stage, "idea", "nothing moved");

  const mine = await idea("design");
  await writes.setTask(db, { project: "micasa", key: mine, stage: "planning", version: await version(mine) } as never, artist);
  assert.equal((await raw.query(`select stage from tasks where key = $1`, [mine])).rows[0].stage, "planning");

  const research = await runOf("research");
  const other = await idea("design");
  await assert.rejects(writes.setTask(db, { project: "micasa", key: other, stage: "planning", version: await version(other) } as never, research), (e: Json) => e.code === "IDEA_STAGE_NOT_YOURS");

  const po = await runOf("product-owner");
  const any = await idea("idea");
  await writes.setTask(db, { project: "micasa", key: any, stage: "research", version: await version(any) } as never, po);
  assert.equal((await raw.query(`select stage from tasks where key = $1`, [any])).rows[0].stage, "research", "the PO moves any stage (after «Constrúyelo» it finishes the rest)");
});

test("PLA-112 F-5: the PO's ficha comes from its Idea doc only; Research's recommendation stays out of it", async () => {
  const docs = Object.values(DOCS).map(([title, markdown]) => ({ title, markdown }));
  assert.equal(fichaOf(docs).solucion, "Usar DayPicker", "the merged ficha, as before");
  assert.equal(fichaOf(docs.filter((d) => d.title.toLowerCase() === "idea")).solucion, null);
  const api = await readFile(new URL("../src/api/company-idea.ts", import.meta.url), "utf8");
  assert.match(api, /ficha_po: fichaOf\(list\.filter\(\(x\) => x\.title\.toLowerCase\(\) === "idea"\)\)/);
  const ui = await readFile(new URL("../ui/src/components/corriente/ficha.tsx", import.meta.url), "utf8");
  assert.match(ui, /const po = d\.ficha_po \?\? d\.ficha;/);
});

test("PLA-112 F-4: the log says statuses in words; an action refreshes the open step and idea views", async () => {
  const tablero = await readFile(new URL("../ui/src/components/corriente/tablero.tsx", import.meta.url), "utf8");
  // PLA-I2-10: the words moved to ui/src/lib/tablero-words.ts; the log still says the status in words.
  assert.match(tablero, /return w\.movedTo\(statusWord\(s\("to"\)!\)\)/);
  const tw = await readFile(new URL("../ui/src/lib/tablero-words.ts", import.meta.url), "utf8");
  assert.match(tw, /movedTo: \(status: string\) => `Pasó a \$\{status\}`/);
  const acts = await readFile(new URL("../ui/src/components/corriente/acts.ts", import.meta.url), "utf8");
  assert.match(acts, /invalidateQueries\(\{ queryKey: \["task"\] \}\)/);
  assert.match(acts, /invalidateQueries\(\{ queryKey: \["idea"\] \}\)/);
});
