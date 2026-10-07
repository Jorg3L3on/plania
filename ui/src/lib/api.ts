import type { ProjectDetail, ProjectSummary, TaskRow } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
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
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, data.error ?? `HTTP_${res.status}`);
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
  patchTask: (slug: string, key: string, patch: { status?: string; priority?: string; note?: string }) =>
    request<TaskRow>("PATCH", `/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}`, patch),
};

export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;
