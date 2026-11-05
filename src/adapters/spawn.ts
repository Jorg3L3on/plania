import { spawn as nodeSpawn } from "node:child_process";
import { ADAPTERS, type AdapterConfig, type AdapterName } from "../db/schema.js";

// PLA-I26: wake an agent through its adapter. dryRun returns before any socket or process.
// Summaries name env vars and task keys. They never include config values, URLs, or command paths.

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

export type RunProcess = (command: string, args: string[]) => Promise<{ code: number | null }>;

export type SpawnDeps = {
  fetch?: WakeFetch;
  run?: RunProcess;
  env?: NodeJS.ProcessEnv;
};

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

const defaultRun: RunProcess = (command, args) =>
  new Promise((resolve, reject) => {
    const child = nodeSpawn(command, args, { stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGTERM"), 10_000);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code });
    });
  });

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

const parseArgs = (raw: string): string[] | null => {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  return trimmed.split(/\s+/);
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

const runCli = async (
  adapter: AdapterName,
  request: SpawnRequest,
  deps: Required<Pick<SpawnDeps, "run" | "env">>,
): Promise<SpawnResult> => {
  const task = request.task ?? null;
  const commandName = namedEnv(request.agent.adapterConfig, "command_env");
  if (!commandName) return { adapter, status: "fail", summary: "missing command_env" };
  const command = readEnv(deps.env, commandName);
  if (!command) return { adapter, status: "fail", summary: `missing env ${commandName}` };
  const argsName = namedEnv(request.agent.adapterConfig, "args_env");
  let extra: string[] = [];
  if (argsName) {
    const raw = readEnv(deps.env, argsName);
    if (!raw) return { adapter, status: "fail", summary: `missing env ${argsName}` };
    const parsed = parseArgs(raw);
    if (!parsed) return { adapter, status: "fail", summary: `bad args env ${argsName}` };
    extra = parsed;
  }
  const args = [...extra, "--agent", request.agent.slug, ...(task ? ["--project", task.project, "--task", task.key] : [])];
  try {
    const result = await deps.run(command, args);
    if (result.code !== 0) return { adapter, status: "fail", summary: "command exited" };
    return { adapter, status: "ok", summary: woke(task) };
  } catch {
    return { adapter, status: "fail", summary: "spawn failed" };
  }
};

export const spawn = async (request: SpawnRequest, deps: SpawnDeps = {}): Promise<SpawnResult> => {
  const adapter = request.agent.adapter;
  if (!isAdapter(adapter)) return { adapter: "none", status: "fail", summary: "unknown adapter" };
  if (request.dryRun) return { adapter, status: "ok", summary: "dry-run" };

  const task = request.task ?? null;
  const fetchImpl = deps.fetch ?? fetch;
  const run = deps.run ?? defaultRun;
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

  if (adapter === "cursor_agent" || adapter === "claude_code") return runCli(adapter, request, { run, env });

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
