#!/usr/bin/env node
// A stand-in for `claude -p --output-format stream-json` in runner tests: prints a system line, a few assistant
// lines and a result with modelUsage, sleeping FAKE_MS (default 300) in between; exits FAKE_EXIT (default 0).
// PLA-I2-13: a run only gets Claude's own variables, so through the runner the controls are CLAUDE_FAKE_*.
// SIGINT ends it with 130 after printing nothing more. CLAUDE_FAKE_PIDS: see below. FAKE_RATE_LIMIT=1 adds a rejected rate_limit_event.
if (process.argv.includes("--version")) {
  process.stdout.write("2.1.302 (Claude Code)\n");
  process.exit(0);
}
const ms = Number(process.env.CLAUDE_FAKE_MS ?? process.env.FAKE_MS ?? 300);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
process.on("SIGINT", () => process.exit(130));
// PLA-I2-4: CLAUDE_FAKE_PIDS=<file> starts one child of its own (a tool Claude would run, same process group) and
// writes "<own pid> <child pid>" there, so a test can check that stopping the run leaves no process behind.
if (process.env.CLAUDE_FAKE_PIDS) {
  const { spawn } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const tool = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync(process.env.CLAUDE_FAKE_PIDS, `${process.pid} ${tool.pid}\n`);
}
out({ type: "system", subtype: "init", session_id: "fake-session" });
// PLA-I2-12: FAKE_SIGNED_OUT=1 answers as Claude Code does when nobody is signed in on the machine: an error result
// on the first turn, no model usage, exit 1. --version prints a version line.
if (process.env.FAKE_SIGNED_OUT === "1") {
  out({ type: "result", subtype: "success", is_error: true, num_turns: 1, session_id: "fake-session", result: "Not logged in · Please run /login" });
  process.exit(1);
}
// PLA-I2-15: CLAUDE_FAKE_COMMENT=<text> does what a real run does with the plan: it reads the MCP config the runner
// wrote (--mcp-config), expands ${PLANIA_RUNNER_TOKEN} from its own env, and comments <text> on the ticket named in
// the prompt ("Ticket: KEY: title"), in the project the prompt names. A refused call fails the run (exit 1).
// PLA-I2-16: CLAUDE_FAKE_CALLS=<JSON list of {name, arguments}> makes those tool calls after the comment, in order,
// with "{project}" and "{key}" in any string replaced by the prompt's; actor is filled when missing. That is how a
// test's product owner proposes its plan and its builder finishes with a PR.
if (process.env.CLAUDE_FAKE_COMMENT || process.env.CLAUDE_FAKE_CALLS) {
  const { readFileSync } = await import("node:fs");
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const prompt = arg("-p") ?? "";
  const project = /for project (\S+) /.exec(prompt)?.[1];
  const key = /Ticket: ([A-Z][A-Z0-9]*-[A-Z0-9-]+):/.exec(prompt)?.[1];
  const server = JSON.parse(readFileSync(arg("--mcp-config"), "utf8")).mcpServers.plania;
  const headers = Object.fromEntries(
    Object.entries(server.headers ?? {}).map(([k, v]) => [k, String(v).replace(/\$\{(\w+)\}/g, (_m, n) => process.env[n] ?? "")]),
  );
  const fill = (v) =>
    typeof v === "string" ? v.replaceAll("{project}", project ?? "").replaceAll("{key}", key ?? "") : Array.isArray(v) ? v.map(fill) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;
  const calls = [];
  if (process.env.CLAUDE_FAKE_COMMENT) calls.push({ name: "comment", arguments: { project, key, body: process.env.CLAUDE_FAKE_COMMENT } });
  if (process.env.CLAUDE_FAKE_CALLS) for (const c of JSON.parse(process.env.CLAUDE_FAKE_CALLS)) calls.push({ name: c.name, arguments: fill(c.arguments) });
  let failure = !project || !key ? `no project or ticket in the prompt (${project}, ${key})` : null;
  let id = 0;
  for (const c of calls) {
    if (failure) break;
    const call = { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: c.name, arguments: { actor: { session_id: "fake-session" }, ...c.arguments } } };
    try {
      const res = await fetch(server.url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify(call),
      });
      const text = await res.text();
      // The answer is plain JSON or one server-sent event; either way the JSON-RPC message is the last {...} line.
      const line = text.split("\n").map((l) => l.replace(/^data:\s*/, "")).filter((l) => l.startsWith("{")).at(-1) ?? "{}";
      const msg = JSON.parse(line);
      if (!res.ok || msg.error || msg.result?.isError) failure = `${c.name} refused (${res.status}): ${line.slice(0, 600)}`;
    } catch (e) {
      failure = `${c.name} failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (failure) {
    process.stderr.write(`${failure}\n`);
    out({ type: "result", subtype: "success", is_error: true, num_turns: 1, session_id: "fake-session", result: failure });
    process.exit(1);
  }
  out({ type: "assistant", message: { content: [{ type: "text", text: `called ${calls.map((c) => c.name).join(", ")} on ${key}` }], usage: { input_tokens: 10, output_tokens: 5 } } });
}
const steps = 3;
for (let i = 0; i < steps; i++) {
  await new Promise((r) => setTimeout(r, ms / steps));
  out({ type: "assistant", message: { content: [{ type: "text", text: `step ${i}` }], usage: { input_tokens: 10, output_tokens: 5 } } });
}
if ((process.env.CLAUDE_FAKE_RATE_LIMIT ?? process.env.FAKE_RATE_LIMIT) === "1") out({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: Math.floor(Date.now() / 1000) + 3600, utilization: 1 } });
out({ type: "result", subtype: "success", is_error: false, num_turns: steps, session_id: "fake-session", result: "OK", modelUsage: { "claude-opus-5-5": { inputTokens: 30, outputTokens: 15, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } });
process.exit(Number(process.env.CLAUDE_FAKE_EXIT ?? process.env.FAKE_EXIT ?? 0));
