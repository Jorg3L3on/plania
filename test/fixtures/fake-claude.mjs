#!/usr/bin/env node
// A stand-in for `claude -p --output-format stream-json` in runner tests: prints a system line, a few assistant
// lines and a result with modelUsage, sleeping FAKE_MS (default 300) in between; exits FAKE_EXIT (default 0).
// PLA-I2-13: a run only gets Claude's own variables, so through the runner the controls are CLAUDE_FAKE_*.
// SIGINT ends it with 130 after printing nothing more. FAKE_RATE_LIMIT=1 adds a rejected rate_limit_event.
const ms = Number(process.env.CLAUDE_FAKE_MS ?? process.env.FAKE_MS ?? 300);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
process.on("SIGINT", () => process.exit(130));
out({ type: "system", subtype: "init", session_id: "fake-session" });
const steps = 3;
for (let i = 0; i < steps; i++) {
  await new Promise((r) => setTimeout(r, ms / steps));
  out({ type: "assistant", message: { content: [{ type: "text", text: `step ${i}` }], usage: { input_tokens: 10, output_tokens: 5 } } });
}
if ((process.env.CLAUDE_FAKE_RATE_LIMIT ?? process.env.FAKE_RATE_LIMIT) === "1") out({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: Math.floor(Date.now() / 1000) + 3600, utilization: 1 } });
out({ type: "result", subtype: "success", is_error: false, num_turns: steps, session_id: "fake-session", result: "OK", modelUsage: { "claude-opus-5-5": { inputTokens: 30, outputTokens: 15, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } });
process.exit(Number(process.env.CLAUDE_FAKE_EXIT ?? process.env.FAKE_EXIT ?? 0));
