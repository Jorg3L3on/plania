// PLA-I38-2: merge-gate writes the scan result itself, through Plania's MCP.
// The cite is the redacted report. The commit is the scanned head. A bot does not call add_result for this pass.

import { hostname } from "node:os";

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type ScanRecord = {
  ticket: string;
  commit: string;
  cite: string;
  command: string;
  verdict: "pass" | "fail";
};

type ProjectRow = { slug?: unknown; key_prefix?: unknown };

export function projectForTicket(projects: { slug: string; key_prefix: string }[], ticket: string): string | null {
  const key = ticket.trim();
  const matches = projects.filter((project) => {
    const prefix = project.key_prefix.trim();
    return prefix.length > 0 && key.startsWith(`${prefix}-`);
  });
  matches.sort((a, b) => b.key_prefix.length - a.key_prefix.length);
  return matches[0]?.slug ?? null;
}

function mcpUrl(env: Record<string, string | undefined>): string {
  return env.PLANIA_MCP_URL || "http://127.0.0.1:3737/mcp";
}

function mcpToken(env: Record<string, string | undefined>): string | null {
  const token = env.PLANIA_MCP_TOKEN || env.MCP_BEARER_TOKEN || env.PLANIA_RUNNER_TOKEN;
  const trimmed = token?.trim();
  return trimmed || null;
}

async function callTool(fetchImpl: FetchLike, url: string, token: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error(`plania record failed (${res.status})`);
  const body = (await res.json()) as { result?: { isError?: boolean; content?: { text?: string }[] }; error?: { message?: string } };
  if (body.error) throw new Error("plania record failed");
  const text = body.result?.content?.find((part) => typeof part.text === "string")?.text ?? "";
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (body.result?.isError) {
    const code = parsed && typeof parsed === "object" && "error" in parsed ? String((parsed as { error: unknown }).error) : "plania record failed";
    throw new Error(code);
  }
  return parsed;
}

export async function recordScanViaMcp(
  input: ScanRecord,
  deps: { fetch?: FetchLike; url?: string; token?: string | null; env?: Record<string, string | undefined> } = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const token = deps.token === undefined ? mcpToken(env) : deps.token;
  if (!token) throw new Error("plania token missing");
  const fetchImpl = deps.fetch ?? ((url, init) => fetch(url, init));
  const url = deps.url ?? mcpUrl(env);
  const listed = (await callTool(fetchImpl, url, token, "list_projects", {})) as { projects?: ProjectRow[] } | null;
  const projects = (listed?.projects ?? []).flatMap((row) => {
    if (typeof row.slug !== "string" || typeof row.key_prefix !== "string") return [];
    return [{ slug: row.slug, key_prefix: row.key_prefix }];
  });
  const project = projectForTicket(projects, input.ticket);
  if (!project) throw new Error("ticket project unknown");
  const agent = env.PLANIA_MERGE_GATE_AGENT?.trim() || "merge-gate";
  await callTool(fetchImpl, url, token, "add_result", {
    project,
    key: input.ticket,
    kind: "scan",
    verdict: input.verdict,
    cite: input.cite.slice(0, 2000),
    command: input.command,
    commit: input.commit,
    actor: { agent, session_id: "merge-gate", machine: hostname() || "cli" },
  });
}
