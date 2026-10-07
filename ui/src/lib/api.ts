import type { ProjectDetail, ProjectSummary, TaskDetail } from "./types";

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
  release: (slug: string, key: string) =>
    request<TaskDetail>("POST", `/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}/release`),
  answer: (slug: string, questionId: string, answer: string) =>
    request<unknown>("POST", `/projects/${encodeURIComponent(slug)}/questions/${encodeURIComponent(questionId)}/answer`, { answer }),
  exportUrl: (slug: string) => `/api/export/${encodeURIComponent(slug)}.json`,
};

export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;
