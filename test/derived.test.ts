// 2.11 Derived truth (item 3): the generated headline and the derived initiative state.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { fitClauses } = await import("../src/mcp/headline.js");
const { auditProject } = await import("../src/mcp/audit.js");
const { findProject } = await import("../src/mcp/queries.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const P = { project: "zigzag" };
const T = { scope: "s", checks: ["c"] };

let client: Client;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  return r.isError ? { __error: data.error, ...data } : data;
}
const version = async (key: string) => (await call("get_task", { ...P, key, view: "summary" })).version;

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
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

describe("generated headline", () => {
  test("clauses join until 280 characters and stop at a clause boundary", () => {
    assert.equal(fitClauses(["prod = main abc1234.", "", "Siguiente: ZIG-01."]), "prod = main abc1234. Siguiente: ZIG-01.");
    const long = "x".repeat(270) + ".";
    assert.equal(fitClauses([long, "Siguiente: ZIG-01."]), long, "the clause that does not fit drops whole");
    assert.equal(fitClauses(["y".repeat(300)]).length, 280, "a first clause alone is clipped");
    assert.equal(fitClauses([]), "");
  });

  test("get_resume.headline is {generated, note}: the env, the initiatives released there, claims, what waits on Jorge, what is next", async () => {
    let r = await call("get_resume", P);
    assert.deepEqual(r.headline, { generated: "", note: { text: "", version: 0, at: null, stale: false } });

    await call("create_task", { ...P, kind: "initiative", title: "Alerts", scope: "s" }); // ZIG-I1
    await call("create_task", { ...P, title: "Model", ...T, parent_key: "ZIG-I1", phase: 1, status: "Ready" }); // ZIG-I1-1
    await call("create_task", { ...P, title: "Screen", ...T, parent_key: "ZIG-I1", phase: 2, status: "Ready" }); // ZIG-I1-2
    await call("create_task", { ...P, title: "Phone run", ...T, parent_key: "ZIG-I1", phase: 3, status: "Ready", blocked_by: [{ human_action: { text: "run it on the phone" } }] }); // ZIG-I1-3
    await call("set_env", { ...P, env: "prod", commit: "abc1234def", branch: "main", deployed: { provider: "vercel", deployment_id: "dpl_1" } });
    const p = await findProject(db, "zigzag");
    await raw.query("insert into releases (project_id, env, commit, task_keys) values ($1, 'prod', 'abc1234def', '{ZIG-I1-1}')", [p.id]);
    await call("claim", { ...P, key: "ZIG-I1-2" });

    r = await call("get_resume", P);
    assert.equal(r.headline.generated, "prod = main abc1234 (ZIG-I1). En curso: ZIG-I1-2 (test-agent). Te toca: 1 paso. Siguiente: ZIG-I1-1.");
    assert.equal(r.headline.note.text, "");
    assert.ok(r.headline.generated.length <= 280);

    // set_project headline still writes the note; the generated line is unaffected and never stale.
    const proj = await call("get_project", P);
    await call("set_project", { ...P, version: proj.version, headline: "Waiting for the store review" });
    await call("set_env", { ...P, env: "prod", commit: "abc1234def" });
    r = await call("get_resume", P);
    assert.equal(r.headline.note.text, "Waiting for the store review");
    assert.equal(r.headline.note.stale, true, "the note goes stale as before");
    assert.match(r.headline.generated, /^prod = main abc1234/);

    // list_projects and the digest read their line from it.
    const listed = (await call("list_projects", {})).projects.find((x: Json) => x.slug === "zigzag");
    assert.equal(listed.line, r.headline.generated);
    assert.equal(listed.headline.generated, r.headline.generated);
    const digest = (await call("get_digest", { project: "zigzag" })).projects.find((x: Json) => x.slug === "zigzag");
    assert.equal(digest.line, r.headline.generated);
    assert.equal(digest.headline, r.headline.generated);
    assert.equal(digest.headline_note, "Waiting for the store review");
  });
});

describe("derived initiative state", () => {
  test("phase now, done of total, in review with its PR, what open tickets wait on; the same in get_task and get_resume", async () => {
    await raw.query("update tasks set status = 'Done' where key = 'ZIG-I1-1'");
    await call("add_result", { ...P, key: "ZIG-I1-2", kind: "unit", verdict: "pass", cite: "ok", check_ns: [1] });
    await call("set_task", { ...P, key: "ZIG-I1-2", status: "In review", pr_url: "https://github.com/Jorg3L3on/zigzag/pull/7", version: await version("ZIG-I1-2") });

    const i = await call("get_task", { ...P, key: "ZIG-I1" });
    assert.deepEqual(
      { ...i.state, in_review: i.state.in_review.map((x: Json) => [x.key, x.pr?.number]) },
      {
        phase_now: 3,
        done: 1,
        total: 3,
        in_progress: [],
        in_review: [["ZIG-I1-2", 7]],
        to_release: [],
        waiting_on: [{ key: "ZIG-I1-3", on: "Jorge: run it on the phone" }],
        line: "Fase 3 · 1/3 hechos · en revisión 1 (#7) · espera a Jorge (1)",
      },
    );
    const summary = await call("get_task", { ...P, key: "ZIG-I1", view: "summary" });
    assert.equal(summary.state.line, i.state.line);
    const resumed = (await call("get_resume", P)).initiatives.find((x: Json) => x.key === "ZIG-I1");
    assert.equal(resumed.state.line, i.state.line);
    assert.equal(resumed.state_note, "");
    // A ticket carries no state.
    assert.equal((await call("get_task", { ...P, key: "ZIG-I1-3" })).state, undefined);
  });

  test("a stale state_note is a flag on the note, not an audit finding", async () => {
    await call("set_task", { ...P, key: "ZIG-I1", state_note: "phone run next", version: await version("ZIG-I1") });
    await raw.query("update tasks set status_changed_at = now() + interval '1 minute' where key = 'ZIG-I1-3'");
    const i = await call("get_task", { ...P, key: "ZIG-I1" });
    assert.equal(i.state_note.stale, true);
    const p = await findProject(db, "zigzag");
    const codes = (await auditProject(db, p)).map((f) => f.code as string);
    assert.ok(!codes.includes("INITIATIVE_STATE_NOTE_STALE"));
  });
});

describe("evidence timeline (fix d)", () => {
  test("results carry ticked_checks and stale_for_head once the branch moves past their commit", async () => {
    await call("create_task", { ...P, title: "Timeline", scope: "s", checks: ["one", "two", "three"], status: "Ready" }); // ZIG-01
    await call("claim", { ...P, key: "ZIG-01", workspace: { branch: "jl/timeline" } });
    await call("add_result", { ...P, key: "ZIG-01", kind: "unit", verdict: "pass", cite: "pnpm test", command: "pnpm test", counts: { pass: 12 }, duration_s: 40, commit: "abc1234", branch: "jl/timeline", check_ns: [2, 3] });
    await call("add_result", { ...P, key: "ZIG-01", kind: "visual", verdict: "warn", cite: "375px ok, 320px clips" });
    let t = await call("get_task", { ...P, key: "ZIG-01" });
    assert.deepEqual(t.results.map((r: Json) => [r.kind, r.ticked_checks, r.stale_for_head]), [["unit", [2, 3], false], ["visual", [], null]]);
    const p = await findProject(db, "zigzag");
    await raw.query("insert into branches (project_id, name, head_sha) values ($1, 'jl/timeline', 'def5678') on conflict (project_id, name) do update set head_sha = 'def5678'", [p.id]);
    t = await call("get_task", { ...P, key: "ZIG-01" });
    assert.equal(t.results[0].stale_for_head, true, "the branch moved on");
    assert.deepEqual([t.results[0].command, t.results[0].counts, t.results[0].duration_s], ["pnpm test", { pass: 12 }, 40]);
  });
});
