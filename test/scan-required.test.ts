// PLA-I38-2: Merged on an app-repo code ticket needs a scan pass on the PR head.
// A failing scan, a squash commit, and a bot allowlist write do not waive it.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask, claim, setTask } = await import("../src/mcp/writes.js");
const { addResult } = await import("../src/mcp/evidence.js");
const { findTask } = await import("../src/mcp/queries.js");
const { finish } = await import("../src/mcp/agent-surface.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { ToolError } = await import("../src/mcp/errors.js");

const HEAD = "abcabca111111111111111111111111111111111";
const SQUASH = "ddddddd222222222222222222222222222222222";
const ctx = { actor: { agent: "taller", session_id: "s1", machine: "ci" } };
const botActor = { agent: "taller", session_id: "s1", machine: "ci" };

let raw: pg.Client;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;
let allow: string;
const previousAllow = process.env.PLANIA_SCAN_ALLOWLIST;

before(async () => {
  allow = path.join(mkdtempSync(path.join(tmpdir(), "plania-allow-")), "scan-allowlist");
  process.env.PLANIA_SCAN_ALLOWLIST = allow;
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
});

after(async () => {
  await closeDb?.();
  await raw?.end();
  rmSync(path.dirname(allow), { recursive: true, force: true });
  if (previousAllow === undefined) delete process.env.PLANIA_SCAN_ALLOWLIST;
  else process.env.PLANIA_SCAN_ALLOWLIST = previousAllow;
});

async function codeTicket(title: string) {
  const created = await createTask(db, { project: "filmia", title, scope: "s", checks: ["c"], status: "Ready" }, ctx);
  await claim(db, { project: "filmia", key: created.key }, ctx);
  return created.key;
}

async function review(key: string, pr: number) {
  await addResult(db, { project: "filmia", key, kind: "unit", verdict: "pass", cite: "ok", check_ns: [1] }, ctx);
  const t = (await findTask(db, (await raw.query(`select id from projects where slug = 'filmia'`)).rows[0].id, key))!;
  const url = `https://github.com/example/filmia/pull/${pr}`;
  await setTask(db, { project: "filmia", key, status: "In review", pr_url: url, version: t.version }, ctx);
  await raw.query(
    `insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_sha, merge_sha, merged_at, head_branch, base_branch)
     select p.id, 'example/filmia', $2, $3, 'phase', t.id, 'merged', $4, $5, now(), 'jl/scan', 'main'
     from projects p join tasks t on t.project_id = p.id where p.slug = 'filmia' and t.key = $1`,
    [key, pr, url, HEAD, SQUASH],
  );
}

test("a scan pass on the PR head allows Merged; a missing, failing, or squash-only pass blocks it", async () => {
  const key = await codeTicket("Scan pass");
  await review(key, 8);
  await addResult(db, { project: "filmia", key, kind: "ci", verdict: "pass", cite: "ci", commit: SQUASH }, ctx);
  const version = async () => (await raw.query(`select version from tasks where key = $1`, [key])).rows[0].version as number;
  await assert.rejects(setTask(db, { project: "filmia", key, status: "Merged", version: await version() }, ctx), (error: unknown) => {
    assert.ok(error instanceof ToolError);
    assert.equal(error.code, "SCAN_REQUIRED");
    assert.equal(error.status, 409);
    return true;
  });
  await addResult(db, { project: "filmia", key, kind: "scan", verdict: "fail", cite: "pnpm merge-gate example/filmia 8", commit: HEAD }, ctx);
  await assert.rejects(setTask(db, { project: "filmia", key, status: "Merged", version: await version() }, ctx), (error: unknown) => {
    assert.ok(error instanceof ToolError);
    assert.equal(error.code, "SCAN_REQUIRED");
    return true;
  });
  await addResult(db, { project: "filmia", key, kind: "scan", verdict: "pass", cite: "squash commit", commit: SQUASH }, ctx);
  await assert.rejects(setTask(db, { project: "filmia", key, status: "Merged", version: await version() }, ctx), (error: unknown) => {
    assert.ok(error instanceof ToolError);
    assert.equal(error.code, "SCAN_REQUIRED");
    assert.match(String(error.detail.hint), /scanned head/);
    return true;
  });
  await addResult(db, { project: "filmia", key, kind: "scan", verdict: "pass", cite: "pnpm merge-gate example/filmia 8", commit: HEAD }, ctx);
  const merged = await setTask(db, { project: "filmia", key, status: "Merged", version: await version() }, ctx);
  assert.equal(merged.status, "Merged");
});

test("finish reaches In review without a scan; Merged still requires one", async () => {
  const key = await codeTicket("Finish");
  const projectId = (await raw.query(`select id from projects where slug = 'filmia'`)).rows[0].id as string;
  const t = (await findTask(db, projectId, key))!;
  const done = await finish(
    db,
    { project: "filmia", key, result: { kind: "unit", verdict: "pass", cite: "ok", check_ns: [1] }, pr_url: "https://github.com/example/filmia/pull/9", branch: "jl/scan", version: t.version },
    ctx,
  );
  assert.equal(done.status, "In review");
  await raw.query(
    `insert into pull_requests (project_id, repo, number, url, title, task_id, state, head_sha, head_branch, base_branch)
     select p.id, 'example/filmia', 9, t.pr_url, 'phase', t.id, 'open', $2, 'jl/scan', 'main'
     from projects p join tasks t on t.project_id = p.id where t.key = $1`,
    [key, HEAD],
  );
  await addResult(db, { project: "filmia", key, kind: "ci", verdict: "pass", cite: "ci", commit: SQUASH }, ctx);
  const version = (await raw.query(`select version from tasks where key = $1`, [key])).rows[0].version as number;
  await assert.rejects(setTask(db, { project: "filmia", key, status: "Merged", version }, ctx), /SCAN_REQUIRED/);
});

test("a bot cannot record an allowlist exception; the screen session can", async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  const client = new Client({ name: "scan-required", version: "0" });
  await client.connect(clientSide);
  try {
    const refused = (await client.callTool({
      name: "set_scan_allowlist",
      arguments: { project: "filmia", actor: botActor, entry: "path:src/fixtures/" },
    })) as { isError?: boolean; content: { text: string }[] };
    const body = JSON.parse(refused.content[0]!.text);
    assert.equal(refused.isError, true);
    assert.equal(body.error, "HUMAN_ONLY");
    assert.equal(existsSync(allow) && readFileSync(allow, "utf8").includes("src/fixtures"), false);
  } finally {
    await client.close();
  }

  const cookie = `${SESSION_COOKIE}=${createSession()}`;
  const bearer = await app.request("/api/scan-allowlist", {
    method: "POST",
    headers: { Cookie: cookie, Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ entry: "path:src/fixtures/" }),
  });
  assert.equal(bearer.status, 403);
  assert.equal(((await bearer.json()) as { error: string }).error, "HUMAN_ONLY");

  const saved = await app.request("/api/scan-allowlist", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ entry: "path:src/fixtures/" }),
  });
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal(((await saved.json()) as { entry_kind: string }).entry_kind, "path");
  assert.match(readFileSync(allow, "utf8"), /^path:src\/fixtures\/$/m);
});
