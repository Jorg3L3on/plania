import type { TaskComment, RoutineRun } from "@/components/delegation/types";
import type { TeamRoster } from "@/components/team/types";
import type { Dashboard, WakeResult } from "@/components/dashboard/types";
import type { Goal, GoalWrite } from "@/components/goals/model";
import type { Usage, Company, CompanyPlan, CompanyProjectRow, CompanyRun, NewProjectResult, ProjectSheetData, RunBrief } from "@/lib/compania";
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
  // PLA-I36-11: publishing carries the owner's code.
  shipRelease: (slug: string) => request<ShipResult>("POST", `/projects/${encodeURIComponent(slug)}/release/ship`, {}),
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
  // PLA-I33 Compañía como organización: the contract in the Plan doc (61ad843a, "Contrato de API").
  company: () => request<OrgCompany>("GET", "/company"),
  // PLA-I39-2: the clock's read.
  companyProject: (slug: string) => request<OrgProjectDetail>("GET", `/company/projects/${encodeURIComponent(slug)}`),
  addToTeam: (slug: string, template: string) =>
    request<{ agent: string; role: string; template: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/team`, { template }),
  actDecision: (id: string, input: DecisionInput) => request<DecisionResult>("POST", `/company/decisions/${encodeURIComponent(id)}`, input),
  thread: (id: string, after?: string) =>
    request<Thread>("GET", `/threads/${encodeURIComponent(id)}${after ? `?after=${encodeURIComponent(after)}` : ""}`),
  postMessage: (id: string, body: string) => request<ThreadPostResult>("POST", `/threads/${encodeURIComponent(id)}/messages`, { body }),
  threadAction: (id: string, input: { message_id: string; action: ThreadAction; text?: string }) =>
    request<ThreadActionResult>("POST", `/threads/${encodeURIComponent(id)}/actions`, input),
  // Máquina's plumbing rides on GET /api/machine (MachineWithPlumbing).
  machinePlumbing: () => request<MachineWithPlumbing>("GET", "/machine"),
  // PLA-I30 writes, kept (cookie session only; a Bearer is 403).
  promptDoc: (id: string) => request<{ id: string; title: string; version: number; markdown: string }>("GET", `/company/docs/${encodeURIComponent(id)}`),
  setCompanyPaused: (paused: boolean) => request<{ paused: boolean; stopped: number }>("POST", "/company/switch", { paused }),
  setProjectPaused: (slug: string, paused: boolean) =>
    request<{ project: string; paused: boolean; stopped: number }>("POST", `/company/projects/${encodeURIComponent(slug)}/switch`, { paused }),
  setRunnerSettings: (input: { plan_guard_pct?: number; guard_override?: boolean }) => request<Company["settings"]>("PUT", "/company/settings", input),
  // PLA-I36: steer a project from its card.
  // PLA-I40-2: Que empiece ya for one teammate.
  startTeammate: (slug: string, agent: string, pastGuard = false) =>
    request<StartNowResult>("POST", `/company/projects/${encodeURIComponent(slug)}/team/${encodeURIComponent(agent)}/start`, pastGuard ? { past_guard: true } : {}),
  askProject: (slug: string, input: { text: string; kind?: OrderKind; now?: boolean }) => request<AskResult>("POST", `/company/projects/${encodeURIComponent(slug)}/ask`, input),
  pickNext: (slug: string, key: string) => request<{ next: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/next`, { key }),
  setProjectOptions: (slug: string, input: { plan_approval?: boolean; preview_url?: string | null; auto_accept?: boolean }) =>
    request<{ plan_approval: boolean; preview_url: string | null }>("PUT", `/company/projects/${encodeURIComponent(slug)}/options`, input),
  stopRun: (id: string) => request<{ stopped: true; ticket: string | null }>("POST", `/company/runs/${encodeURIComponent(id)}/stop`),
  resumeRun: (id: string) => request<{ woke: boolean; reason: string; ticket: string | null }>("POST", `/company/runs/${encodeURIComponent(id)}/resume`),
  noteTask: (slug: string, key: string, text: string) => request<{ noted: true }>("POST", `/company/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}/note`, { text }),
  resendRequest: (slug: string, key: string) => request<{ key: string; wake: "queued" | "busy" | "off" }>("POST", `/company/projects/${encodeURIComponent(slug)}/requests/${encodeURIComponent(key)}/resend`),
  cancelOrder: (slug: string, key: string) => request<{ cancelled: string[] }>("POST", `/company/projects/${encodeURIComponent(slug)}/orders/${encodeURIComponent(key)}/cancel`),
  ownerCode: () => request<{ enrolled: boolean }>("GET", "/company/owner-code"),
  enrolOwnerCode: (input: { password: string; code?: string }) => request<{ secret_base32: string; otpauth_uri: string }>("POST", "/company/owner-code/enroll", input),
  // PLA-I31-3 adds this route; until then it is 404 and the dialog says so.
  createCompanyProject: (input: { name: string; goal: string }) => request<NewProjectResult>("POST", "/company/projects", input),
  // PLA-I25: a project, a product-owner bot and a Playbook. The same slug again changes nothing.
  createCompany: (input: { slug: string; name: string; owner_bot_name: string }) => request<CompanyProject>("POST", "/templates/company", input),
};

// ---- PLA-I33: the organization (Plan doc 61ad843a, "Contrato de API"). Fields the contract leaves
// untyped (week, usage, last_run) reuse the PLA-I30 shapes.

export type OrderKind = "cambio" | "direccion" | "idea";
export type StartNowResult = { started: boolean; reason: "started" | "queued" | "busy" | "idle" | "held" | "fail"; ticket: string | null; run_id: string | null; summary: string };
export type AskResult = { key: string; title: string; po: string; wake: "queued" | "busy" | "off"; woke: { woke: boolean; reason: string; ticket: string | null; summary: string } | null };
export type OrgLight = "ok" | "needs_jorge" | "failed" | "blocked" | "late" | "quiet" | "paused";
export type OrgLightReason = { text: string; action: { label: string; href: string } | null };
// PLA-I36-3: Tus órdenes.
export type OrderState = "enviada" | "entendida" | "en_curso" | "entregada" | "sin_tomar" | "cancelada";
export type OrderStage = "enviada" | "entendido" | "trabajando" | "pruebalo" | "listo" | "cancelada";
export type OrgRun = { id: string; role: string; agent: string; step: string; ticket: string; since: string; last: string | null; status: "running" | "stopped" };
export type OrgOrder = {
  id: string;
  kind: "order" | "choice";
  key?: string | null;
  title: string;
  text?: string | null;
  at: string;
  state: OrderState;
  stage?: OrderStage;
  understood: string | null;
  who: string | null;
  link: { kind: "pr" | "doc"; ref: string; title: string } | null;
  age_h: number | null;
  plan?: { needs_approval: boolean; approved: boolean; steps: number; done: number; decision: string } | null;
  run?: OrgRun | null;
};
export type OrgMemberState = "running" | "idle" | "waiting_jorge" | "paused";
export type OrgProduced = { kind: "doc" | "pr" | "idea" | "plan"; ref: string; title: string };
export type OrgMember = {
  agent: string;
  role: string;
  template: string;
  state: OrgMemberState;
  // PLA-I39-1: title is the ticket's title (null when the run has no ticket). Optional so older fixtures render.
  now: { ticket: string | null; title?: string | null; since: string; run_id?: string } | null;
  last: { ticket: string | null; title?: string | null; status: string; at: string; run_id?: string } | null;
  produced: OrgProduced | null;
  waiting: string | null;
  // PLA-I39-1: up to three Ready tickets waiting for this teammate.
  queue?: { key: string; title: string }[];
  // PLA-I40-1: why the next step has not started, and when it will if that is known.
  next_start?: OrgNextStart | null;
};
export type OrgNextHold = "rest" | "usage" | "slot" | "paused" | "no_goal" | "waiting_owner" | "waiting_step" | "unqueued" | "soon";
export type OrgNextStart = { key: string | null; title: string | null; hold: OrgNextHold; starts_at: string | null; text: string };
export type OrgThreadRef = { id: string; unread: number; last: { at: string; author_role: string; body: string } | null };
export type OrgProject = {
  slug: string;
  title: string;
  paused: boolean;
  light: OrgLight;
  light_reason?: OrgLightReason | null;
  goal: string | null;
  rumbo?: OrgRumbo;
  // PLA-21: this week's tokens, shown only.
  usage: Usage;
  team: OrgMember[];
  thread: OrgThreadRef;
  // PLA-I35-1: the card as a report.
  plan: OrgPlan | null;
  // PLA-I40-7: the accept-by-itself switch, and why the oldest waiting delivery was not accepted.
  auto_accept?: { on: boolean; hold: string | null };
  // PLA-I40-6: what just happened here, and the owner's requests nobody took.
  latest?: OrgLatest[];
  stale_requests?: OrgStaleRequest[];
  // PLA-I40-3: the delivery as legs; the one marked here carries its named steps.
  route?: OrgRoute | null;
  this_week: { done: number; docs: number; prs: number; last_at: string | null };
  next: { title: string; key: string; owner: string; due: string | null } | null;
  work: { open: number; in_progress: number };
  orders?: OrgOrder[];
  // PLA-I36-6/8/10.
  ready?: { key: string; title: string }[];
  plan_approval?: boolean;
  preview_url?: string | null;
};
export type OrgLatest = { kind: "published" | "delivered"; title: string | null; n: number | null; at: string };
export type OrgStaleRequest = { key: string; title: string; since: string };
export type OrgStepState = "done" | "published" | "delivered" | "working" | "next" | "later";
export type OrgRouteStep = { key: string; title: string; state: OrgStepState; who: string | null; at: string | null };
export type OrgRouteLeg = { key: string; title: string; done: number; total: number; state: "done" | "here" | "planned" | "unplanned"; note: string | null; steps?: OrgRouteStep[]; more_steps?: number };
export type OrgRoute = { legs: OrgRouteLeg[]; more_legs: number };
// PLA-I36-5: position by calendar. weeks, today_pct, done_pct are null without a delivery date (no bar).
export type OrgPlan = {
  initiative: { key: string; title: string };
  done: number;
  total: number;
  start_on: string | null;
  due_on: string | null;
  weeks: number | null;
  today_pct: number | null;
  done_pct: number | null;
  pace: "ok" | "late" | "bad" | null;
  weeks_behind: number | null;
  forecast_on: string | null;
};
// PLA-I36-4: the destination.
export type OrgRumbo = { goal_id: string | null; goal: string | null; why: string; target_on: string | null; forecast_on: string | null; weeks_behind: number | null; missing: boolean };
// PLA-I35-1: Te toca rows (GET /api/company decisions[]) and POST /api/company/decisions/:id.
export type DecisionKind = "proposal" | "plan" | "action" | "question" | "deliverable" | "pr" | "step" | "release";
export type DecisionPlan = { order: string; understood: string; steps: { title: string; done_when: string }[]; cost: string; needs_approval: boolean; created: string[] };
export type DecisionEvidence = { verdict: string; kind: string; cite: string; pass: number | null; fail: number | null; at: string };
export type DecisionLink = { kind: "doc" | "pr" | "ticket" | "idea"; ref: string; title: string };
export type DecisionChecks = { open: number; ci: "pending" | "success" | "failure" | "none" | null };
export type DecisionRelease = { from: string; into: string; env: string; ahead: number | null; tickets: { key: string; title: string }[]; open_checks: number; before: number };
export type DecisionAction = "elegir" | "responder" | "hecho" | "aplazar" | "aceptar" | "fusionar" | "cambios" | "empezar" | "cambiar" | "cancelar" | "aplicar" | "verificar";
export type DecisionState = { action: string; at: string; result: Record<string, unknown> };
export type Decision = {
  id: string;
  project: string | null;
  title: string;
  kind: DecisionKind;
  options: { n: number; label: string; recommended: boolean; effect?: string; cost?: string }[] | null;
  actions: DecisionAction[];
  state: DecisionState | null;
  at: string;
  ref: string | null;
  detail: string | null;
  // PLA-I36-2: the evidence in the row. Optional so older fixtures still render.
  links?: DecisionLink[];
  body?: string | null;
  checks?: DecisionChecks | null;
  release?: DecisionRelease | null;
  // PLA-I36-7/8/10.
  combinable?: number[][];
  recommended_reason?: string | null;
  plan?: DecisionPlan | null;
  evidence?: DecisionEvidence | null;
  files?: number | null;
  preview_url?: string | null;
  hold?: string | null;
  // PLA-I39-1: who asked (null: nobody on a team, e.g. a release).
  asker?: DecisionAsker | null;
  // A step that asks for lines in a file: Plania can commit them to the PR (aplicar).
  file_step?: { path: string; lines: string; pr_url: string | null; source: "agent" | "text" } | null;
  // The owner's run on this ticket while queued or running (e.g. re-running its checks after verificar).
  verify?: { state: "queued" | "running"; since: string; role: string | null } | null;
};
export type DecisionAsker = { agent: string; role: string };
export type DecisionInput = { action: DecisionAction; option?: number | number[]; text?: string; path?: string; lines?: string };
export type DecisionResult = { ok: boolean; state: DecisionState; decision: Decision | null; created?: { kind: string; key: string } | null; wake?: string };
export type OrgPlumbing = { spend: number; running: number; paused: boolean };
export type OrgCompany = {
  company: { paused: boolean };
  week: Company["week"];
  asistente: { thread_id: string; usage: Usage; last_run: { status: string; at: string | null; summary?: string } | null; state: OrgMemberState; unread?: number };
  projects: OrgProject[];
  plumbing: OrgPlumbing;
  decisions: Decision[];
  inbox?: { decisiones: number; pasos: number };
  // PLA-I42-5: Brief de hoy (the Morning brief's 0-token lines) and the link to /brief. Optional for older servers.
  brief?: { lines: string[]; generated_at: string; link: string } | null;
};
export type OrgTemplate = { slug: string; title: string };
export type OrgProjectDetail = ProjectSheetData & { team: OrgMember[]; thread_id: string; templates: OrgTemplate[] };

export type ThreadAction = "aceptar" | "cambios" | "responder" | "fusionar";
export type ThreadLink = { kind: "ticket" | "doc" | "pr" | "idea" | "question" | "brief_plan"; ref: string; title: string };
// result is an object on the server ({ticket, status} …); older fixtures carry a string.
export type ThreadActionState = { action: ThreadAction; at: string; result: string | Record<string, unknown> | null };
export type ThreadMessage = {
  id: string;
  at: string;
  author: { agent: string; role: string };
  body: string;
  links: ThreadLink[];
  actions: ThreadAction[];
  action_state: ThreadActionState | null;
  question_id: string | null;
};
export type Thread = { id: string; kind: "company" | "project"; project: string | null; messages: ThreadMessage[] };
export type ThreadPostResult = { message: ThreadMessage; created: { kind: string; key: string } | null; wake: string };
export type ThreadActionResult = { ok: boolean; action_state: ThreadActionState };

// GET /api/machine plus the plumbing blocks that left Compañía (week tokens, plan guard, switches, runs, log).
export type MachinePlumbing = {
  company: { paused: boolean; paused_at: string | null };
  settings: Company["settings"];
  week: Company["week"];
  plan: CompanyPlan;
  usage: { asistente: Usage; projects: CompanyProjectRow[] };
  runs: { live: CompanyRun[]; queued: CompanyRun[] };
  log: RunBrief[];
  viewer?: { can_edit_limits: boolean };
};
export type MachineWithPlumbing = Machine & { plumbing?: MachinePlumbing };

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
