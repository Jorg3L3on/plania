// PLA-I47-7: a delivery held for QA's pass is not the owner's turn. The floor's light read the delivery message before
// the decisions were read, said «Una entrega espera tu visto bueno.» and drew «Ver en Te toca», a link to an anchor
// that no longer exists. Throwaway store, fake names only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
process.env.PLANIA_HOME_PROJECT = "zigzag";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { resolveThread } = await import("../src/runner/threads.js");

type Json = Record<string, any>;
let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let pid = "";
const company = async () => (await (await app.request("/api/company", { headers: { Cookie: `${SESSION_COOKIE}=${createSession()}` } })).json()) as Json;
const card = async () => (await company()).projects.find((p: Json) => p.slug === "micasa") as Json;

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  pid = await store.projectId("micasa");
  await store.fix(async (uow) => {
    await uow.update("projects", { slug: "micasa" }, { runsPaused: false });
    await uow.insert("agents", { slug: "taller-mc-ux", name: "Taller", role: "engineer", kind: "coder", adapter: "claude_code", projectId: pid, roleTemplate: "taller" });
    await uow.insert("agents", { slug: "qa-mc-ux", name: "QA", role: "qa", kind: "coder", adapter: "claude_code", projectId: pid, roleTemplate: "qa" });
  });
  const t = (await writes.createTask(db, { project: "micasa", title: "Pantalla de gracias", scope: "s", checks: ["c"], work_type: "code" } as never, { actor: { agent: "po-micasa", session_id: "s-ux" } } as never)) as { key: string };
  const url = "https://github.com/example/micasa/pull/77";
  const { thread } = await resolveThread(db, "micasa");
  await store.fix(async (uow) => {
    const [task] = await uow.update("tasks", { key: t.key }, { status: "In review", prUrl: url });
    await uow.insert("pullRequests", { projectId: pid, repo: "example/micasa", number: 77, url, title: "Gracias", taskId: task!.id, state: "open", ciState: "success" });
    await uow.insert("threadMessages", {
      threadId: thread.id,
      authorAgent: "taller-mc-ux",
      authorRole: "taller",
      body: `Listo ${t.key}: PR #77`,
      links: [
        { kind: "ticket", ref: t.key, title: "Pantalla de gracias" },
        { kind: "pr", ref: url, title: "PR #77" },
      ],
    });
  });
});

after(async () => {
  await closeDb?.();
  await store?.end();
});

test("I47-7: a delivery still waiting for QA is not Te toca: no needs_jorge light and no dead «Ver en Te toca» move", async () => {
  const c = await company();
  assert.equal(c.decisions.filter((d: Json) => d.project === "micasa").length, 0, "QA holds it off Te toca");
  const p = c.projects.find((x: Json) => x.slug === "micasa");
  assert.notEqual(p.light, "needs_jorge");
  assert.equal(p.next_move?.accion?.href, undefined, "no link move to #te-toca");
});

test("I47-7: once QA passes, the same delivery is the owner's move again", async () => {
  const [t] = await store.find("tasks", { title: "Pantalla de gracias" });
  await store.fix((uow) =>
    uow.insert("qaLanes", {
      projectId: pid,
      taskId: t!.id,
      taskKey: t!.key,
      status: "pass",
      // The item as main's test stored it (no duration_s).
      verify: [{ name: "test", command: "pnpm test", exit_code: 0, ok: true, pass: 3, fail: 0, tail: "" }] as never,
      review: { verdict: "pass", notes: "Sin hallazgos", model: null },
    }),
  );
  const c = await company();
  const p = c.projects.find((x: Json) => x.slug === "micasa");
  assert.equal(p.light, "needs_jorge", JSON.stringify({ light: p.light, reason: p.light_reason, d: c.decisions.map((d: Json) => [d.project, d.kind, d.hold]) }));
  assert.equal(p.next_move.origen.kind, "decision", "the move is the delivery itself, not the light's link");
});
