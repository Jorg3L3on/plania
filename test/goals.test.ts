// PLA-I22-1: goals table, goal_id on initiatives, list_goals / set_goal, progress roll-up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { tasks } from "../src/db/schema.js";
import { whyChainOf } from "../src/mcp/goals.js";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s-goals", machine: "ci" };

let db: Db;
let client: Client;
let raw: import("pg").Client;
let closeDb: () => Promise<void>;

async function tool(name: string, args: Json = {}): Promise<Json> {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text) as Json;
  return r.isError ? { __error: data.error, __status: data.status, ...data } : data;
}

const write = (name: string, args: Json) => tool(name, { actor: A, ...args });

before(async () => {
  raw = await resetTestDb();
  const opened = makeDb();
  db = opened.db;
  closeDb = opened.close;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("goals", () => {
  test("migration 0035 applies twice and only an initiative can point at a goal", async () => {
    const sql = readFileSync(path.resolve(import.meta.dirname, "../drizzle/migrations/0035_goals.sql"), "utf8");
    await raw.query(sql);
    await raw.query(sql);
    const cols = await raw.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'goals' order by 1",
    );
    assert.deepEqual(
      cols.rows.map((r) => r.column_name),
      ["created_at", "id", "parent_id", "position", "project_id", "status", "target_on", "title", "updated_at", "why"],
    );
    const goal = await raw.query<{ id: string }>("insert into goals (title, why) values ('Suelta', 'nadie la pide') returning id");
    const project = await raw.query<{ id: string }>("select id from projects where slug = 'workia'");
    await raw.query("insert into tasks (project_id, kind, key, title, status, goal_id) values ($1, 'initiative', 'WRK-GOAL-OK', 'Ok', 'Planning', $2)", [
      project.rows[0]!.id,
      goal.rows[0]!.id,
    ]);
    await assert.rejects(
      raw.query("insert into tasks (project_id, kind, key, title, status, goal_id) values ($1, 'ticket', 'WRK-GOAL-NO', 'No', 'Backlog', $2)", [
        project.rows[0]!.id,
        goal.rows[0]!.id,
      ]),
      /tasks_goal_initiative/,
    );
  });

  test("progress rolls up a company goal from its project goals, and ignores an initiative with no goal", async () => {
    const company = await write("set_goal", { title: "Una dirección", why: "para que todo empuje igual" });
    assert.equal(company.__error, undefined);
    assert.equal(company.project, null);
    assert.equal(company.parent_id, null);
    assert.deepEqual(company.progress, { done: 0, total: 0 });

    const workia = await write("set_goal", {
      project: "workia",
      parent_id: company.id,
      title: "Cobros claros",
      why: "el cliente entiende qué paga",
      target_on: "2026-12-01",
    });
    const micasa = await write("set_goal", { project: "micasa", parent_id: company.id, title: "Casa al día", why: "cada gasto tiene dueño" });
    assert.equal(workia.project, "workia");
    assert.equal(workia.parent_id, company.id);
    assert.equal(workia.target_on, "2026-12-01");

    const initA = await write("create_task", { project: "workia", kind: "initiative", title: "Cobros", scope: "PRD", goal_id: workia.id });
    const initA2 = await write("create_task", { project: "workia", kind: "initiative", title: "Recibos", scope: "PRD", goal_id: workia.id });
    const initB = await write("create_task", { project: "micasa", kind: "initiative", title: "Gastos", scope: "PRD", goal_id: micasa.id });
    const initC = await write("create_task", { project: "workia", kind: "initiative", title: "Dirección", scope: "PRD", goal_id: company.id });
    const loose = await write("create_task", { project: "workia", kind: "initiative", title: "Sin meta", scope: "PRD" });
    assert.equal(initA.__error, undefined, JSON.stringify(initA));

    const phase = async (project: string, parent: string, title: string, done: boolean) => {
      const t = await write("create_task", {
        project,
        title,
        scope: "alcance",
        work_type: "decision-needed",
        parent_key: parent,
        status: "Backlog",
      });
      assert.equal(t.__error, undefined, JSON.stringify(t));
      if (!done) return t;
      const closed = await write("set_task", { project, key: t.key, status: "Done", version: t.version });
      assert.equal(closed.status, "Done", JSON.stringify(closed));
      return closed;
    };

    await phase("workia", initA.key, "Uno", true);
    await phase("workia", initA.key, "Dos", false);
    await phase("workia", initA2.key, "Tres", true);
    await phase("micasa", initB.key, "Cuatro", false);
    await phase("workia", initC.key, "Cinco", true);
    await phase("workia", loose.key, "Seis", true);

    const dropped = await phase("workia", initA.key, "Siete", false);
    await raw.query("update tasks set status = 'Won''t do' where key = $1", [dropped.key]);

    const tree = await tool("list_goals");
    const root = tree.goals.find((g: Json) => g.id === company.id);
    const childA = root.children.find((g: Json) => g.id === workia.id);
    const childB = root.children.find((g: Json) => g.id === micasa.id);
    assert.deepEqual(childA.progress, { done: 2, total: 4 }, "Won't do counts in the total and not in done");
    assert.deepEqual(childA.initiatives.map((i: Json) => i.key).sort(), [initA.key, initA2.key].sort());
    assert.deepEqual(childB.progress, { done: 0, total: 1 });
    assert.deepEqual(root.progress, { done: 3, total: 6 });
    assert.equal(root.initiatives.length, 1);
    assert.equal(root.initiatives[0].key, initC.key);

    const onlyWorkia = await tool("list_goals", { project: "workia" });
    assert.deepEqual(onlyWorkia.goals.map((g: Json) => g.id), [workia.id]);
    assert.deepEqual(onlyWorkia.goals[0].progress, { done: 2, total: 4 });

    const [linked] = await db.select().from(tasks).where(eq(tasks.key, initA.key));
    const chain = await whyChainOf(db, linked!);
    assert.equal(chain?.some((l) => l.level === "project_goal" && l.title === "Cobros claros"), true);

    const [open] = await db.select().from(tasks).where(eq(tasks.key, loose.key));
    assert.equal(await whyChainOf(db, open!), null);

    const cleared = await write("set_task", { project: "workia", key: initA2.key, goal_id: null, version: initA2.version });
    assert.equal(cleared.__error, undefined, JSON.stringify(cleared));
    assert.ok(cleared.changed.includes("goal_id"));
    const after = await tool("list_goals", { project: "workia" });
    assert.deepEqual(after.goals[0].progress, { done: 1, total: 3 });
  });

  test("goal_id is refused on a ticket, an unknown goal, and another project's goal", async () => {
    const goal = await write("set_goal", { project: "micasa", title: "Solo MiCasa", why: "no sale de aquí" });
    const ticket = await write("create_task", {
      project: "workia",
      title: "Un ticket",
      scope: "alcance",
      checks: ["hecho"],
      goal_id: goal.id,
    });
    assert.equal(ticket.__error, "FIELD_NOT_ALLOWED");
    assert.equal(ticket.field, "goal_id");

    const missing = await write("create_task", {
      project: "workia",
      kind: "initiative",
      title: "Huérfana",
      scope: "PRD",
      goal_id: "00000000-0000-4000-8000-000000000099",
    });
    assert.equal(missing.__error, "GOAL_NOT_FOUND");
    assert.equal(missing.__status, 404);

    const other = await write("create_task", { project: "workia", kind: "initiative", title: "Ajena", scope: "PRD", goal_id: goal.id });
    assert.equal(other.__error, "GOAL_NOT_FOUND");
  });

  test("a company goal cannot have a parent, and a bad date is INVALID_GOAL", async () => {
    const company = await write("set_goal", { title: "Raíz", why: "arriba" });
    const nested = await write("set_goal", { title: "Otra raíz", why: "no", parent_id: company.id });
    assert.equal(nested.__error, "INVALID_GOAL");
    assert.equal(nested.field, "parent_id");
    const dated = await write("set_goal", { project: "workia", title: "Fecha", why: "no", target_on: "2026-02-31" });
    assert.equal(dated.__error, "INVALID_GOAL");
    assert.equal(dated.field, "target_on");
    const projectGoal = await write("set_goal", { project: "workia", title: "De proyecto", why: "sí" });
    const parent = await write("set_goal", { project: "workia", title: "Hija de hija", why: "no", parent_id: projectGoal.id });
    assert.equal(parent.__error, "INVALID_GOAL");
    assert.equal(parent.field, "parent_id");
  });

  test("set_goal updates in place and replays request_id", async () => {
    const created = await write("set_goal", { project: "zigzag", title: "Borrador", why: "primera" });
    const updated = await write("set_goal", { project: "zigzag", id: created.id, title: "En firme", status: "done", why: "segunda" });
    assert.equal(updated.title, "En firme");
    assert.equal(updated.status, "done");
    assert.equal(updated.id, created.id);
    const first = await write("set_goal", { project: "zigzag", title: "Una vez", why: "igual", request_id: "goal-once" });
    const again = await write("set_goal", { project: "zigzag", title: "Otra vez", why: "distinta", request_id: "goal-once" });
    assert.equal(again.id, first.id);
    assert.equal(again.title, "Una vez");
  });
});
