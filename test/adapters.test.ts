// PLA-I26-2: adapters wake an agent. A dry run never opens a socket or a process.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, type SpawnAgent, type SpawnDeps, type WakeFetch } from "../src/adapters/index.js";

const BIN = "/tmp/plania-fake-bin";
const WAKE = "http://127.0.0.1/wake";
const HOOK = "http://127.0.0.1/hook";
const SECRET = "super-secret-value";

const agent = (patch: Partial<SpawnAgent>): SpawnAgent => ({
  slug: "coder",
  adapter: "none",
  adapterConfig: {},
  wakeUrl: null,
  ...patch,
});

const blocked = (): SpawnDeps => ({
  fetch: async () => {
    throw new Error("socket opened");
  },
  run: async () => {
    throw new Error("process opened");
  },
  env: {
    CURSOR_AGENT_BIN: BIN,
    CURSOR_AGENT_ARGS: `["--flag","${SECRET}"]`,
    CLAUDE_CODE_BIN: BIN,
    GROK_WAKE_URL: HOOK,
  },
});

test("dry-run never calls fetch or a process and hides config values", async () => {
  for (const row of [
    agent({ adapter: "http", wakeUrl: WAKE }),
    agent({ adapter: "cursor_agent", adapterConfig: { command_env: "CURSOR_AGENT_BIN", args_env: "CURSOR_AGENT_ARGS" } }),
    agent({ adapter: "claude_code", adapterConfig: { command_env: "CLAUDE_CODE_BIN" } }),
    agent({ adapter: "grok_webhook", adapterConfig: { url_env: "GROK_WAKE_URL" } }),
    agent({ adapter: "none" }),
  ]) {
    const result = await spawn({ agent: row, task: { project: "micasa", key: "MIC-1", title: "Example" }, dryRun: true }, blocked());
    assert.equal(result.status, "ok");
    assert.equal(result.summary, "dry-run");
    assert.equal(result.adapter, row.adapter);
    const text = JSON.stringify(result);
    assert.equal(text.includes(WAKE), false);
    assert.equal(text.includes(HOOK), false);
    assert.equal(text.includes(BIN), false);
    assert.equal(text.includes(SECRET), false);
  }
});

test("http posts the wake url and none is a no-op", async () => {
  let posted: { url: string; body: string } | null = null;
  const fetchImpl: WakeFetch = async (url, init) => {
    posted = { url, body: init.body };
    return { ok: true };
  };
  const http = await spawn(
    { agent: agent({ adapter: "http", wakeUrl: WAKE }), task: { project: "micasa", key: "MIC-1", title: "Example" } },
    { fetch: fetchImpl, run: async () => { throw new Error("process opened"); } },
  );
  assert.equal(http.status, "ok");
  assert.equal(http.summary, "woke for MIC-1");
  assert.equal(posted!.url, WAKE);
  assert.equal(JSON.stringify(http).includes(WAKE), false);
  const body = JSON.parse(posted!.body) as { agent: string; task: { key: string } };
  assert.equal(body.agent, "coder");
  assert.equal(body.task.key, "MIC-1");

  const missing = await spawn({ agent: agent({ adapter: "http" }) }, { fetch: fetchImpl });
  assert.equal(missing.status, "skipped");
  assert.equal(missing.summary, "no wake_url");

  const idle = await spawn({ agent: agent({ adapter: "none", wakeUrl: WAKE }) }, blocked());
  assert.equal(idle.status, "skipped");
  assert.equal(idle.summary, "adapter none");
});

test("cli stubs read env names and grok posts the webhook without logging values", async () => {
  const calls: { command: string; args: string[] }[] = [];
  const env = {
    CURSOR_AGENT_BIN: BIN,
    CURSOR_AGENT_ARGS: `["--flag","${SECRET}"]`,
    CLAUDE_CODE_BIN: BIN,
    GROK_WAKE_URL: HOOK,
  };
  const cursor = await spawn(
    {
      agent: agent({ adapter: "cursor_agent", adapterConfig: { command_env: "CURSOR_AGENT_BIN", args_env: "CURSOR_AGENT_ARGS" } }),
      task: { project: "micasa", key: "MIC-2", title: "Example" },
    },
    {
      env,
      run: async (command, args) => {
        calls.push({ command, args });
        return { code: 0 };
      },
      fetch: async () => { throw new Error("socket opened"); },
    },
  );
  assert.equal(cursor.status, "ok");
  assert.equal(cursor.summary, "woke for MIC-2");
  assert.equal(calls[0]!.command, BIN);
  assert.deepEqual(calls[0]!.args.slice(0, 2), ["--flag", SECRET]);
  assert.equal(calls[0]!.args.includes("--task"), true);
  assert.equal(JSON.stringify(cursor).includes(BIN), false);
  assert.equal(JSON.stringify(cursor).includes(SECRET), false);

  const missing = await spawn(
    { agent: agent({ adapter: "claude_code", adapterConfig: { command_env: "CLAUDE_CODE_BIN" } }) },
    { env: {}, run: async () => { throw new Error("process opened"); } },
  );
  assert.equal(missing.status, "fail");
  assert.equal(missing.summary, "missing env CLAUDE_CODE_BIN");

  const badArgs = await spawn(
    { agent: agent({ adapter: "cursor_agent", adapterConfig: { command_env: "CURSOR_AGENT_BIN", args_env: "CURSOR_AGENT_ARGS" } }) },
    { env: { CURSOR_AGENT_BIN: BIN, CURSOR_AGENT_ARGS: "[not-json" }, run: async () => ({ code: 0 }) },
  );
  assert.equal(badArgs.summary, "bad args env CURSOR_AGENT_ARGS");
  assert.equal(badArgs.summary.includes("not-json"), false);

  let hook: string | null = null;
  const grok = await spawn(
    { agent: agent({ adapter: "grok_webhook", adapterConfig: { url_env: "GROK_WAKE_URL" } }) },
    {
      env,
      fetch: async (url) => {
        hook = url;
        return { ok: true };
      },
      run: async () => { throw new Error("process opened"); },
    },
  );
  assert.equal(hook, HOOK);
  assert.equal(grok.status, "ok");
  assert.equal(grok.summary, "woke");
  assert.equal(JSON.stringify(grok).includes(HOOK), false);

  const noUrl = await spawn(
    { agent: agent({ adapter: "grok_webhook", adapterConfig: { url_env: "GROK_WAKE_URL" } }) },
    { env: {}, fetch: async () => { throw new Error("socket opened"); } },
  );
  assert.equal(noUrl.summary, "missing env GROK_WAKE_URL");
});
