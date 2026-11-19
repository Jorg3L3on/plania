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
const steps = 3;
for (let i = 0; i < steps; i++) {
  await new Promise((r) => setTimeout(r, ms / steps));
  out({ type: "assistant", message: { content: [{ type: "text", text: `step ${i}` }], usage: { input_tokens: 10, output_tokens: 5 } } });
}
if ((process.env.CLAUDE_FAKE_RATE_LIMIT ?? process.env.FAKE_RATE_LIMIT) === "1") out({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: Math.floor(Date.now() / 1000) + 3600, utilization: 1 } });
out({ type: "result", subtype: "success", is_error: false, num_turns: steps, session_id: "fake-session", result: "OK", modelUsage: { "claude-opus-5-5": { inputTokens: 30, outputTokens: 15, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } });
process.exit(Number(process.env.CLAUDE_FAKE_EXIT ?? process.env.FAKE_EXIT ?? 0));
