// PLA-I29-2: read claude's stream-json output, one JSON object per line.
// The result event carries modelUsage (per model, subagents included), num_turns, session_id and subtype.
// rate_limit_event carries the plan windows (decision dec6d6f1: the runner's usage source).
// Assistant events give live turns and tokens while the run is still going.
// total_cost_usd is never read: Plania does not show money.

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
      const message = event.message as { id?: unknown; usage?: Record<string, unknown> } | undefined;
      const id = str(message?.id);
      if (!id) return;
      const usage = message?.usage ?? {};
      this.messages.set(id, {
        input: num(usage.input_tokens),
        output: num(usage.output_tokens),
        cacheRead: num(usage.cache_read_input_tokens),
        cacheCreate: num(usage.cache_creation_input_tokens),
      });
      return;
    }
    if (event.type === "result") {
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
