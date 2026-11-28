// PLA-I29-2: read claude's stream-json output, one JSON object per line.
// The result event carries modelUsage (per model, subagents included), num_turns, session_id and subtype.
// rate_limit_event carries the plan windows (decision dec6d6f1: the runner's usage source).
// Assistant events give live turns and tokens while the run is still going.
// total_cost_usd is never read: Plania does not show money.

import { addTally, splitMcpName, type McpTally } from "./conexiones.js";

export type ModelTokens = {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
};

export type PlanWindowReading = {
  status: string | null;
  fiveHourPct: number | null;
  sevenDayPct: number | null;
  fiveHourResetsAt: Date | null;
  sevenDayResetsAt: Date | null;
  overageStatus: string | null;
};

export type RunResult = {
  subtype: string;
  isError: boolean;
  numTurns: number;
  sessionId: string | null;
  models: ModelTokens[];
  hasModelUsage: boolean;
  // PLA-I41-3: with --json-schema the result event carries the validated object as structured_output
  // (confirmed on CLI 2.1.302; result holds the same JSON as a string). undefined when absent.
  structuredOutput: unknown;
  resultText: string | null;
};

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const pct = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1000) / 10 : null);
const epoch = (value: unknown): Date | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null);

export const totalOf = (t: { input: number; output: number; cacheRead: number; cacheCreate: number }): number =>
  t.input + t.output + t.cacheRead + t.cacheCreate;

export function parseModelUsage(raw: unknown): ModelTokens[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, Record<string, unknown>>)
    .filter(([model, usage]) => model.trim() && usage && typeof usage === "object")
    .map(([model, usage]) => ({
      model: model.slice(0, 80),
      input: num(usage.inputTokens),
      output: num(usage.outputTokens),
      cacheRead: num(usage.cacheReadInputTokens),
      cacheCreate: num(usage.cacheCreationInputTokens),
    }));
}

// utilization is a fraction (0.83); readings are stored as percent (83).
export function parseRateLimit(raw: unknown): PlanWindowReading | null {
  if (!raw || typeof raw !== "object") return null;
  const info = (raw as { rate_limit_info?: Record<string, unknown> }).rate_limit_info;
  if (!info || typeof info !== "object") return null;
  const windows = (info.unifiedWindows ?? {}) as Record<string, { utilization?: unknown; resetsAt?: unknown } | undefined>;
  const five = windows.five_hour;
  const seven = windows.seven_day;
  const fallbackReset = info.rateLimitType === "five_hour" ? epoch(info.resetsAt) : null;
  return {
    status: str(info.status),
    fiveHourPct: pct(five?.utilization),
    sevenDayPct: pct(seven?.utilization),
    fiveHourResetsAt: epoch(five?.resetsAt) ?? fallbackReset,
    sevenDayResetsAt: epoch(seven?.resetsAt),
    overageStatus: str(info.overageStatus),
  };
}

// Accumulates one run's stream. feed() takes raw chunks; lines may split across chunks.
export class StreamReader {
  result: RunResult | null = null;
  readings: PlanWindowReading[] = [];
  sessionId: string | null = null;
  // AUDIT-2: the skills the run invoked (the Skill tool, or a read of a skill's SKILL.md), without the plugin prefix.
  skillsUsed = new Set<string>();
  // PLA-I67-4: every file the run read (the Read tool's file_path), so its end can say which references it opened.
  filesRead = new Set<string>();
  // AUDIT-7: the context the last top-level turn carried (input + cache read + cache create). Null before any turn.
  contextTokens: number | null = null;
  // PLA-I75: every mcp__ call by its tool_use id (server, tool, and what its result said), and the ids the CLI's result
  // event lists as permission denials. The run log is the record of what an agent did with a connection, never its own
  // account of it.
  private mcpCalls = new Map<string, { server: string; tool: string; outcome: "pending" | "ok" | "failed" | "blocked" }>();
  private denied = new Set<string>();
  private buffer = "";
  private messages = new Map<string, { input: number; output: number; cacheRead: number; cacheCreate: number }>();

  constructor(private readonly onReading?: (reading: PlanWindowReading) => void) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    let at = this.buffer.indexOf("\n");
    while (at !== -1) {
      this.line(this.buffer.slice(0, at));
      this.buffer = this.buffer.slice(at + 1);
      at = this.buffer.indexOf("\n");
    }
  }

  end(): void {
    if (this.buffer.trim()) this.line(this.buffer);
    this.buffer = "";
  }

  /** PLA-I75: the run's mcp__ calls by server and tool: ran, failed (or never answered), or blocked by a rule. */
  mcpTally(): McpTally {
    const out: McpTally = {};
    for (const [id, c] of this.mcpCalls) addTally(out, c.server, c.tool, this.denied.has(id) || c.outcome === "blocked" ? "blocked" : c.outcome === "ok" ? "ok" : "failed");
    return out;
  }

  // Live counts while the run goes: one turn per assistant message, its latest usage.
  get liveTurns(): number {
    return this.messages.size;
  }

  get liveTokens(): { input: number; output: number; cacheRead: number; cacheCreate: number } {
    const sum = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
    for (const m of this.messages.values()) {
      sum.input += m.input;
      sum.output += m.output;
      sum.cacheRead += m.cacheRead;
      sum.cacheCreate += m.cacheCreate;
    }
    return sum;
  }

  private line(text: string): void {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{")) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }
    const sid = str(event.session_id);
    if (sid) this.sessionId = sid;
    if (event.type === "rate_limit_event") {
      const reading = parseRateLimit(event);
      if (reading) {
        this.readings.push(reading);
        this.onReading?.(reading);
      }
      return;
    }
    if (event.type === "assistant") {
      const message = event.message as { id?: unknown; usage?: Record<string, unknown>; content?: unknown } | undefined;
      for (const part of Array.isArray(message?.content) ? (message!.content as Record<string, unknown>[]) : []) {
        if (part?.type !== "tool_use") continue;
        const input = (part.input ?? {}) as Record<string, unknown>;
        if (part.name === "Skill" && typeof input.skill === "string" && input.skill.trim()) this.skillsUsed.add(input.skill.trim().replace(/^[a-z0-9-]+:/, "").slice(0, 60));
        const file = part.name === "Read" && typeof input.file_path === "string" ? /[\\/]skills[\\/]([a-z][a-z0-9-]{0,39})[\\/]SKILL\.md$/.exec(input.file_path) : null;
        if (file) this.skillsUsed.add(file[1]!);
        if (part.name === "Read" && typeof input.file_path === "string" && this.filesRead.size < 500) this.filesRead.add(input.file_path.slice(0, 1000));
        const mcp = typeof part.name === "string" ? splitMcpName(part.name) : null;
        if (mcp && typeof part.id === "string" && this.mcpCalls.size < 5000) this.mcpCalls.set(part.id, { ...mcp, outcome: "pending" });
      }
      const id = str(message?.id);
      if (!id) return;
      const usage = message?.usage ?? {};
      // A subagent's turns (parent_tool_use_id set) carry their own, smaller context.
      if (event.parent_tool_use_id == null) this.contextTokens = num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens);
      this.messages.set(id, {
        input: num(usage.input_tokens),
        output: num(usage.output_tokens),
        cacheRead: num(usage.cache_read_input_tokens),
        cacheCreate: num(usage.cache_creation_input_tokens),
      });
      return;
    }
    if (event.type === "user") {
      const message = event.message as { content?: unknown } | undefined;
      for (const part of Array.isArray(message?.content) ? (message!.content as Record<string, unknown>[]) : []) {
        if (part?.type !== "tool_result" || typeof part.tool_use_id !== "string") continue;
        const call = this.mcpCalls.get(part.tool_use_id);
        if (!call) continue;
        const text = typeof part.content === "string" ? part.content : Array.isArray(part.content) ? (part.content as { text?: unknown }[]).map((c) => (typeof c?.text === "string" ? c.text : "")).join(" ") : "";
        call.outcome = part.is_error !== true ? "ok" : DENIED_TEXT.test(text) ? "blocked" : "failed";
      }
      return;
    }
    if (event.type === "result") {
      for (const d of Array.isArray(event.permission_denials) ? (event.permission_denials as Record<string, unknown>[]) : []) {
        if (typeof d?.tool_use_id === "string") this.denied.add(d.tool_use_id);
        const name = typeof d?.tool_name === "string" ? splitMcpName(d.tool_name) : null;
        if (name && typeof d?.tool_use_id === "string" && !this.mcpCalls.has(d.tool_use_id)) this.mcpCalls.set(d.tool_use_id, { ...name, outcome: "blocked" });
      }
      const usage = event.modelUsage;
      this.result = {
        subtype: str(event.subtype) ?? "unknown",
        isError: event.is_error === true,
        numTurns: num(event.num_turns),
        sessionId: sid,
        models: parseModelUsage(usage),
        hasModelUsage: !!usage && typeof usage === "object" && Object.keys(usage as object).length > 0,
        structuredOutput: "structured_output" in event ? event.structured_output : undefined,
        resultText: typeof event.result === "string" ? event.result : null,
      };
    }
  }
}

// The CLI's text for a call a permission rule refused (a deny rule, or no one to approve it in an unattended run).
const DENIED_TEXT = /permission to use .* (has been|was) denied|denied by (a )?permission|requires approval|permission denied/i;

export function parseStream(text: string): StreamReader {
  const reader = new StreamReader();
  reader.feed(text);
  reader.end();
  return reader;
}

// The free /usage probe (num_turns 0, modelUsage {}): its result text names the session and week rows.
// "Current session: 83% used · resets …" and "Current week (all models): 19% used · resets …".
export function parseUsageText(text: string): PlanWindowReading | null {
  const session = /Current session:\s*(\d{1,3})%\s*used/i.exec(text);
  const week = /Current week \(all models\):\s*(\d{1,3})%\s*used/i.exec(text);
  if (!session) return null;
  const five = Number(session[1]);
  return {
    status: five >= 100 ? "rejected" : null,
    fiveHourPct: five,
    sevenDayPct: week ? Number(week[1]) : null,
    fiveHourResetsAt: null,
    sevenDayResetsAt: null,
    overageStatus: null,
  };
}
