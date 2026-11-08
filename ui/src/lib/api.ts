import type { TaskComment, RoutineRun } from "@/components/delegation/types";
import type { TeamRoster } from "@/components/team/types";
import type { Dashboard, WakeResult } from "@/components/dashboard/types";
import type { Goal, GoalWrite } from "@/components/goals/model";
import type { AskResult, Company, NewProjectResult, ProjectSheetData, WakeOutcome } from "@/lib/compania";
import type { AgentToken, Digest, Inbox, Machine, Orden, ProgressItem, ProgressLog, ProgressRange, ProgressSummary, ProjectDetail, ProjectSummary, ShipResult, TaskDetail } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const { error, ...detail } = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    throw new ApiError(res.status, error ?? `HTTP_${res.status}`, detail);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  login: (password: string) => request<void>("POST", "/login", { password }),
  logout: () => request<void>("POST", "/logout"),
  // TanStack Query rejects undefined data, so the empty 204 becomes true.
  session: () => request<void>("GET", "/session").then(() => true),
  projects: () => request<ProjectSummary[]>("GET", "/projects"),
  project: (slug: string) => request<ProjectDetail>("GET", `/projects/${encodeURIComponent(slug)}`),
  task: (slug: string, key: string) =>
    request<TaskDetail>("GET", `/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}`),
  // version is the one shown on screen; if the task moved since, the server answers STALE_VERSION.
  patchTask: (slug: string, key: string, patch: { status?: string; priority?: string; note?: string; reason?: string; version: number }) =>
    request<TaskDetail>("PATCH", `/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}`, patch),
  // 2.12 Pedir: a Backlog ticket as Jorge (origin jorge); the reply is the new task.
  createTask: (slug: string, input: { title: string; summary?: string; priority?: string; parent_key?: string }) =>
    request<TaskDetail>("POST", `/projects/${encodeURIComponent(slug)}/tasks`, input),
  release: (slug: string, key: string) =>
    request<TaskDetail>("POST", `/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}/release`),
  answer: (slug: string, questionId: string, answer: string, decisionText?: string) =>
    request<unknown>("POST", `/projects/${encodeURIComponent(slug)}/questions/${encodeURIComponent(questionId)}/answer`, {
      answer,
      ...(decisionText ? { decision_text: decisionText } : {}),
    }),
  // The headline carries the project version on screen, like a task's.
  patchProject: (slug: string, headline: string, version: number) =>
    request<{ version: number }>("PATCH", `/projects/${encodeURIComponent(slug)}`, { headline, version }),
  waiveCheck: (slug: string, key: string, n: number, reason: string) =>
    request<TaskDetail>("POST", `/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}/checks/${n}/waive`, { reason }),
  // 2.11 Orden: the last audit run, and the one-click fixes (run as Jorge); the reply is the new run.
  audit: (slug: string) => request<Orden>("GET", `/projects/${encodeURIComponent(slug)}/audit`),
  fixAudit: (slug: string, finding: { code: string; key: string | null; id: string }) =>
    request<Orden>("POST", `/projects/${encodeURIComponent(slug)}/audit/fix`, finding),
  inbox: (project?: string) => request<Inbox>("GET", project ? `/inbox?project=${encodeURIComponent(project)}` : "/inbox"),
  // 2.13: Jorge ships the release step (merge mode): a PR from → into, merged with a merge commit.
  shipRelease: (slug: string) => request<ShipResult>("POST", `/projects/${encodeURIComponent(slug)}/release/ship`),
  resolveBlocker: (slug: string, id: string, note?: string) =>
    request<{ key: string }>("POST", `/projects/${encodeURIComponent(slug)}/blockers/${encodeURIComponent(id)}/resolve`, note ? { note } : undefined),
  // Screen only. The bot cannot read or flip this.
  delegation: () => request<{ enabled: boolean }>("GET", "/delegation"),
  setDelegation: (enabled: boolean) => request<{ enabled: boolean }>("POST", "/delegation", { enabled }),
  // PLA-06: mark delegated answers seen (they leave the Bandeja and the audit; the record stays).
  reviewDelegated: (ids: string[]) => request<{ reviewed: number }>("POST", "/delegated/reviewed", { ids }),
  machine: () => request<Machine>("GET", "/machine"),
  team: () => request<TeamRoster>("GET", "/team"),
  comments: (slug: string, key: string) =>
    request<{ comments: TaskComment[] }>(
      "GET",
      `/delegation/comments?project=${encodeURIComponent(slug)}&key=${encodeURIComponent(key)}`,
    ),
  routines: (agent?: string, date?: string) => {
    const params = new URLSearchParams();
    if (agent) params.set("agent", agent);
    if (date) params.set("date", date);
    const query = params.toString();
    return request<{ runs: RoutineRun[] }>("GET", query ? `/delegation/routines?${query}` : "/delegation/routines");
  },
  dashboard: () => request<Dashboard>("GET", "/dashboard"),
  // PLA-I28: the CEO screen's actions. Cookie session only.
  wakeAgent: (agent: string, taskKey?: string) =>
    request<WakeResult>("POST", "/dashboard/wake", taskKey ? { agent, task_key: taskKey } : { agent }),
  assignTask: (project: string, key: string, toAgent: string) =>
    request<{ key: string; owner_agent: string }>("POST", "/dashboard/assign", { project, key, to_agent: toAgent }),
  // 2.12 Hoy: the digest since this device's cursor; "Visto" moves the server's bookmark too.
  digest: (since?: number) => request<Digest>("GET", since === undefined ? "/digest" : `/digest?since=${since}`),
  digestSeen: (cursor: number) => request<{ cursor: number }>("POST", "/digest/seen", { cursor }),
  // 2.12 push: the VAPID key to subscribe with, and this device's subscription.
  pushPublicKey: () => request<{ public_key: string }>("GET", "/push/public-key"),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => request<{ id: string }>("POST", "/push/subscribe", sub),
  pushUnsubscribe: (endpoint: string) => request<{ removed: boolean }>("DELETE", "/push/subscribe", { endpoint }),
  tokens: () => request<AgentToken[]>("GET", "/tokens"),
  createToken: (input: { name: string; agent: string; machine?: string; scopes: string[] }) =>
    request<{ token: AgentToken; secret: string }>("POST", "/tokens", input),
  revokeToken: (id: string, reason?: string) =>
    request<AgentToken>("DELETE", `/tokens/${encodeURIComponent(id)}${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`),
  goals: (project?: string) => request<{ goals: Goal[] }>("GET", project ? `/goals?project=${encodeURIComponent(project)}` : "/goals"),
  createGoal: (input: GoalWrite) => request<Goal>("POST", "/goals", input),
  patchGoal: (id: string, input: GoalWrite) => request<Goal>("PATCH", `/goals/${encodeURIComponent(id)}`, input),
  // PLA-I19: Mi progreso. Cookie session only; the server answers 401 to a bearer token.
  progressSummary: (range: ProgressRange, date?: string) => {
    const q = new URLSearchParams({ range });
    if (date) q.set("date", date);
    return request<ProgressSummary>("GET", `/progress/summary?${q}`);
  },
  progressLog: (query: { from?: string; to?: string; project?: string; type?: string; q?: string; cursor?: string }) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) q.set(key, value);
    const suffix = q.size ? `?${q}` : "";
    return request<ProgressLog>("GET", `/progress/log${suffix}`);
  },
  progressItem: (project: string, key: string) =>
    request<ProgressItem>("GET", `/progress/item/${encodeURIComponent(project)}/${encodeURIComponent(key)}`),
  // PLA-I25: reported token totals. Informational.
  usage: () => request<UsageSummary>("GET", "/usage"),
  // PLA-I30 Compañía: GET /api/company and its Jorge-only writes (cookie session only; a Bearer is 403).
  company: () => request<Company>("GET", "/company"),
  companyProject: (slug: string) => request<ProjectSheetData>("GET", `/company/projects/${encodeURIComponent(slug)}`),
  promptDoc: (id: string) => request<{ id: string; title: string; version: number; markdown: string }>("GET", `/company/docs/${encodeURIComponent(id)}`),
  setCompanyPaused: (paused: boolean) => request<{ paused: boolean; stopped: number }>("POST", "/company/switch", { paused }),
  setProjectPaused: (slug: string, paused: boolean) =>
    request<{ project: string; paused: boolean; stopped: number }>("POST", `/company/projects/${encodeURIComponent(slug)}/switch`, { paused }),
  setBudget: (input: { scope: "role"; role: string; weekly_limit: number | null } | { scope: "project"; project: string; weekly_limit: number | null }) =>
    request<{ scope: string; key: string; weekly_limit: number | null }>("PUT", "/company/budgets", input),
  setRunnerSettings: (input: { plan_guard_pct?: number }) => request<Company["settings"]>("PUT", "/company/settings", input),
  // PLA-I30-6/7: Pedirle al PO and Despertar ahora on the project sheet.
  askPo: (slug: string, text: string) => request<AskResult>("POST", `/company/projects/${encodeURIComponent(slug)}/ask`, { text }),
  wakePo: (slug: string) => request<WakeOutcome>("POST", `/company/projects/${encodeURIComponent(slug)}/wake`),
  // PLA-I31-3 adds this route; until then it is 404 and the dialog says so.
  createCompanyProject: (input: { name: string; goal: string }) => request<NewProjectResult>("POST", "/company/projects", input),
  // PLA-I25: a project, a product-owner bot and a Playbook. The same slug again changes nothing.
  createCompany: (input: { slug: string; name: string; owner_bot_name: string }) => request<CompanyProject>("POST", "/templates/company", input),
};

export type CompanyProject = {
  created: boolean;
  project: string;
  name: string;
  owner: { slug: string; name: string; role: string } | null;
  playbook: { title: string; version: number } | null;
};

export type UsageTotal = { agent: string; project: string; week: string; input: number; output: number };

export type UsageSummary = { label: "reportado"; totals: UsageTotal[] };

export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;
