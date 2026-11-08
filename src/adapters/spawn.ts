import { ADAPTERS, type AdapterConfig, type AdapterName } from "../db/schema.js";

// PLA-I26: wake an agent through its adapter. dryRun returns before any socket or process.
// Summaries name env vars and task keys. They never include config values, URLs, or command paths.
// PLA-I29-2: claude_code runs through the supervised runner (src/runner), never from here; the
// old defaultRun/runCli path (stdio ignored, SIGTERM after 10 s) is gone, and so is cursor_agent.

export type SpawnAgent = {
  slug: string;
  adapter: AdapterName;
  adapterConfig: AdapterConfig | null;
  wakeUrl: string | null;
};

export type SpawnTask = {
  project: string;
  key: string;
  title: string;
};

export type SpawnRequest = {
  agent: SpawnAgent;
  task?: SpawnTask | null;
  dryRun?: boolean;
};

export type SpawnResult = {
  adapter: AdapterName;
  status: "ok" | "fail" | "skipped";
  summary: string;
};

export type WakeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; redirect: "error"; signal: AbortSignal },
) => Promise<{ ok: boolean }>;

export type SpawnDeps = {
  fetch?: WakeFetch;
  env?: NodeJS.ProcessEnv;
};

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

const isAdapter = (value: string): value is AdapterName => (ADAPTERS as readonly string[]).includes(value);

const namedEnv = (config: AdapterConfig | null, field: keyof AdapterConfig): string | null => {
  const name = config?.[field];
  if (typeof name !== "string" || !ENV_NAME.test(name)) return null;
  return name;
};

const readEnv = (env: NodeJS.ProcessEnv, name: string | null): string | null => {
  if (!name) return null;
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") return null;
  return value;
};

const postJson = async (url: string, body: unknown, fetchImpl: WakeFetch): Promise<boolean> => {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  return res.ok;
};

const payloadOf = (agent: SpawnAgent, task: SpawnTask | null) => ({
  agent: agent.slug,
  task: task ? { project: task.project, key: task.key, title: task.title } : null,
});

const woke = (task: SpawnTask | null): string => (task ? `woke for ${task.key}` : "woke");

export const spawn = async (request: SpawnRequest, deps: SpawnDeps = {}): Promise<SpawnResult> => {
  const adapter = request.agent.adapter;
  if (!isAdapter(adapter)) return { adapter: "none", status: "fail", summary: "unknown adapter" };
  if (request.dryRun) return { adapter, status: "ok", summary: "dry-run" };

  const task = request.task ?? null;
  const fetchImpl = deps.fetch ?? fetch;
  const env = deps.env ?? process.env;

  if (adapter === "none") return { adapter, status: "skipped", summary: "adapter none" };

  if (adapter === "http") {
    if (!request.agent.wakeUrl) return { adapter, status: "skipped", summary: "no wake_url" };
    try {
      const ok = await postJson(request.agent.wakeUrl, payloadOf(request.agent, task), fetchImpl);
      if (!ok) return { adapter, status: "fail", summary: "post failed" };
      return { adapter, status: "ok", summary: woke(task) };
    } catch {
      return { adapter, status: "fail", summary: "post failed" };
    }
  }

  // Removed in PLA-I29-2; Initiative B drops the enum value and the roster row.
  if (adapter === "cursor_agent") return { adapter, status: "skipped", summary: "adapter cursor_agent removed" };
  if (adapter === "claude_code") return { adapter, status: "fail", summary: "claude_code runs through the runner" };

  const urlName = namedEnv(request.agent.adapterConfig, "url_env");
  if (!urlName) return { adapter, status: "fail", summary: "missing url_env" };
  const url = readEnv(env, urlName);
  if (!url) return { adapter, status: "fail", summary: `missing env ${urlName}` };
  try {
    const ok = await postJson(url, payloadOf(request.agent, task), fetchImpl);
    if (!ok) return { adapter, status: "fail", summary: "post failed" };
    return { adapter, status: "ok", summary: woke(task) };
  } catch {
    return { adapter, status: "fail", summary: "post failed" };
  }
};
