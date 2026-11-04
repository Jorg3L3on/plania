import type { TeamRoster } from "@/components/team/types";
import type { AgentToken, Digest, Inbox, Machine, Orden, ProjectDetail, ProjectSummary, ShipResult, TaskDetail } from "./types";

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
  patchTask: (slug: string, key: string, patch: { status?: string; priority?: string; note?: string; version: number }) =>
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
  decide: (ids: string[], decision: "grant" | "reject", note?: string) =>
    request<{ results: { id: string; ok: boolean; error?: string }[]; decided: number }>("POST", "/approvals/decide", { ids, decision, note }),
  // Screen only. The bot cannot read or flip this.
  delegation: () => request<{ enabled: boolean }>("GET", "/delegation"),
  setDelegation: (enabled: boolean) => request<{ enabled: boolean }>("POST", "/delegation", { enabled }),
  // PLA-06: mark delegated answers seen (they leave the Bandeja and the audit; the record stays).
  reviewDelegated: (ids: string[]) => request<{ reviewed: number }>("POST", "/delegated/reviewed", { ids }),
  machine: () => request<Machine>("GET", "/machine"),
  team: () => request<TeamRoster>("GET", "/team"),
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
};

export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;
