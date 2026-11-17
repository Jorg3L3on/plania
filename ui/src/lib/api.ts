import type { TaskComment, RoutineRun } from "@/components/delegation/types";
import type { TeamRoster } from "@/components/team/types";
import type { Dashboard, WakeResult } from "@/components/dashboard/types";
import type { Goal, GoalWrite } from "@/components/goals/model";
import type { Usage, Company, CompanyPlan, CompanyProjectRow, CompanyRun, NewProjectResult, ProjectSheetData, RunBrief } from "@/lib/compania";
import type { CapturesRead, PruebaRead } from "@/lib/ventana";
import type { BaseRead, LlavesRead, MaquinasRead, PruebasRead, RecorridoRead, RowsRead, SeedResult, TableroRead, TablesRead } from "@/lib/maquinas";
import type { AgentToken, Digest, Inbox, Machine, Orden, ProgressItem, ProgressLog, ProgressRange, ProgressSummary, ProjectDetail, ProjectSummary, ShipResult, TaskDetail, TaskRow } from "./types";

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
  project: (slug: string) => request<ProjectRead>("GET", `/projects/${encodeURIComponent(slug)}`),
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
  // PLA-I46-7/8: the Ventana a la app (stills of the test copy) and its clicks: Encenderla, Reintentar, Apagar.
  captures: (slug: string) => request<CapturesRead>("GET", `/projects/${encodeURIComponent(slug)}/captures`),
  prueba: (slug: string, act: "encender" | "tomar" | "apagar") =>
    request<{ prueba: PruebaRead }>("POST", `/projects/${encodeURIComponent(slug)}/captures/${act}`, {}),
  // PLA-I48: Máquinas, the floor's second level (src/api/maquinas.ts).
  maquinas: (slug: string) => request<MaquinasRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas`),
  reiniciar: (slug: string) => request<{ prueba: PruebaRead }>("POST", `/projects/${encodeURIComponent(slug)}/captures/reiniciar`, {}),
  bitacora: (slug: string) => request<{ lines: string[] }>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/bitacora`),
  configurar: (slug: string) => request<MaquinasRead>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/configurar`, {}),
  baseLever: (slug: string, act: "encender" | "apagar") => request<{ base: BaseRead }>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/base/${act}`, {}),
  tablas: (slug: string) => request<TablesRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/tablas`),
  filas: (slug: string, table: string, offset: number) =>
    request<RowsRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/tablas/${encodeURIComponent(table)}/filas?offset=${offset}`),
  migrar: (slug: string) => request<SeedResult>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/migrar`, {}),
  sembrar: (slug: string) => request<SeedResult>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/sembrar`, {}),
  vaciarYSembrar: (slug: string, rows: number) => request<SeedResult>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/vaciar-y-sembrar`, { rows }),
  llaves: (slug: string) => request<LlavesRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/llaves`),
  pruebas: (slug: string) => request<PruebasRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/pruebas`),
  correrPruebas: (slug: string) => request<PruebasRead>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/pruebas`, {}),
  recorrido: (slug: string) => request<RecorridoRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/recorrido`),
  contrasena: (slug: string) => request<{ user: string; password: string }>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/recorrido/contrasena`, {}),
  tablero: () => request<TableroRead>("GET", "/maquinas/tablero"),
  // PLA-I46-10: the QA lane's evidence for one delivery (the floor's evidence card).
  qa: (slug: string, key: string) => request<QaRead>("GET", `/projects/${encodeURIComponent(slug)}/qa/${encodeURIComponent(key)}`),
  // PLA-I52-4: El Probador. The delivery's pairs (antes / después per view and width), its copy, and the two clicks.
  probador: (slug: string, key: string) => request<ProbadorRead>("GET", `/projects/${encodeURIComponent(slug)}/probador/${encodeURIComponent(key)}`),
  probadorTomar: (slug: string, key: string) => request<{ ok: true }>("POST", `/projects/${encodeURIComponent(slug)}/probador/${encodeURIComponent(key)}/tomar`, {}),
  preguntar: (slug: string, key: string, text: string) => request<{ id: string; wake: string }>("POST", `/projects/${encodeURIComponent(slug)}/probador/${encodeURIComponent(key)}/preguntar`, { text }),
  vivo: (slug: string) => request<{ vivo: VivoRead }>("POST", `/projects/${encodeURIComponent(slug)}/entrega/vivo`, {}),
  entregaEncender: (slug: string, key: string) => request<{ entrega: EntregaRead }>("POST", `/projects/${encodeURIComponent(slug)}/entrega/encender`, { key }),
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
  companyFicha: (slug: string) => request<OrgFicha>("GET", `/company/projects/${encodeURIComponent(slug)}/ficha`),
  projectDoc: (slug: string, id: string) => request<ProjectDocBody>("GET", `/company/docs/${encodeURIComponent(id)}?project=${encodeURIComponent(slug)}`),
  // PLA-I46-13: packs are set in the same call; the server refuses an unknown pack before hiring.
  addToTeam: (slug: string, template: string, packs?: string[]) =>
    request<{ agent: OrgMember; team: OrgMember[]; packs?: PackRef[] }>("POST", `/company/projects/${encodeURIComponent(slug)}/team`, packs?.length ? { template, packs } : { template }),
  // PLA-I46-12: the skill packs (Plania docs `Pack: <name>`).
  packs: () => request<{ packs: PackRef[] }>("GET", "/company/packs"),
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
  // PLA-I54-1: mode forma (an idea in the floor's tube) or ya (the Ready ticket plus the wake). The reply's key is the
  // new idea's or ticket's: F5 uploads the side page's pictures to it.
  askProject: (slug: string, input: { text: string; kind?: OrderKind; now?: boolean; mode?: AskMode }) => request<AskResult>("POST", `/company/projects/${encodeURIComponent(slug)}/ask`, input),
  pickNext: (slug: string, key: string) => request<{ next: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/next`, { key }),
  setProjectOptions: (slug: string, input: { plan_approval?: boolean; preview_url?: string | null; auto_accept?: boolean; auto_accept_invisible?: boolean }) =>
    request<{ plan_approval: boolean; preview_url: string | null }>("PUT", `/company/projects/${encodeURIComponent(slug)}/options`, input),
  stopRun: (id: string) => request<{ stopped: true; ticket: string | null }>("POST", `/company/runs/${encodeURIComponent(id)}/stop`),
  resumeRun: (id: string) => request<{ woke: boolean; reason: string; ticket: string | null }>("POST", `/company/runs/${encodeURIComponent(id)}/resume`),
  // PLA-I54-3: the Pedido tab (a note uses noteTask, an answer the screen's answer route).
  pedido: (slug: string, key: string) => request<PedidoDetail>("GET", `/company/projects/${encodeURIComponent(slug)}/pedidos/${encodeURIComponent(key)}`),
  pedidoAct: (slug: string, key: string, action: "guardar" | "restaurar" | "descartar" | "construir", reason?: string) =>
    request<{ key: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/pedidos/${encodeURIComponent(key)}/${action}`, reason ? { reason } : {}),
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
export type AskMode = "forma" | "ya";
export type AskResult = { key: string; title: string; po: string; mode?: AskMode; wake: "queued" | "busy" | "off"; woke: { woke: boolean; reason: string; ticket: string | null; summary: string } | null };
// PLA-I54-1: one of the owner's ideas taking shape, a capsule in the floor's tube (src/api/company-pedidos.ts).
export type PedidoStop = "buzon" | "entendido" | "investigacion" | "diseno" | "plan" | "lista";
export type PedidoState = "espera" | "trabajando" | "quieta" | "cola" | "valvula";
// PLA-I54-3: one request in La ficha's Pedido tab (src/api/company-pedido.ts).
export type PedidoTrailItem = {
  at: string;
  who: string;
  kind: "pedido" | "nota" | "entendi" | "pregunta" | "respuesta" | "doc" | "etapa" | "guardada" | "restaurada" | "construir" | "valvula" | "descartada";
  text: string;
  doc?: { id: string; title: string };
};
export type PedidoFicha = { problema: string | null; tamano: string | null; solucion: string | null; riesgos: string | null; fuera: string | null };
export type PedidoDetail = OrgPedido & {
  mode: "forma";
  text: string;
  status: string;
  stage: string | null;
  promoted_to: string | null;
  question_options: string[];
  trail: PedidoTrailItem[];
  ficha: PedidoFicha;
  // PLA-I54-5: the request's pictures.
  pictures: { id: string; url: string; at: string }[];
};
export type OrgPedido = {
  key: string;
  title: string;
  stop: PedidoStop;
  state: PedidoState;
  who: string;
  images: number;
  understood: string | null;
  question: { id: string; text: string } | null;
  guardada: boolean;
  at: string;
};
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
  // PLA-I46-12: the skill pack slugs this role carries.
  packs?: string[];
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
  auto_accept?: { on: boolean; hold: string | null; invisible?: boolean };
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
  // PLA-I47-3: the ticket the owner put first.
  next_first?: string | null;
  plan_approval?: boolean;
  preview_url?: string | null;
  // PLA-I46-3: la siguiente jugada (src/api/company-move.ts). Null: nothing here is the owner's; absent: older server.
  next_move?: OrgNextMove | null;
  // PLA-I53-2: every open initiative with its tickets' stage (the stage board), and who works now.
  tablero?: Tablero;
  ahora?: AhoraItem[];
  // PLA-I54-1: the tube's capsules (absent: an older server, and the floor draws no tube).
  pedidos?: OrgPedido[];
};
// PLA-I53-2: one stage per ticket, computed on the server (src/api/etapa.ts). The shapes the floor and the project
// page both read.
export type EtapaId = "despues" | "lista" | "en_espera" | "pospuesto" | "bloqueado" | "construyendo" | "devuelto" | "sin_dueno" | "en_qa" | "en_revision" | "te_toca" | "integrado" | "publicado" | "hecho";
export type EtapaCi = "pending" | "success" | "failure" | "none";
export type EtapaHolder = { agent: string; role: string };
export type Etapa = { etapa: EtapaId; qa: "queued" | "running" | null; holder: EtapaHolder | null; live: boolean; since: string | null; ci: EtapaCi | null; reason: string | null };
export type AhoraItem = { key: string; title: string; initiative: string | null } & Pick<Etapa, "etapa" | "qa" | "holder" | "live" | "since" | "reason">;
// PLA-I53-6: zonas, what part of the app a ticket touches (from its areas); none when it has no areas.
export type Zona = "pantalla" | "servidor" | "datos" | "docs";
export type ProjectTicket = { key: string; title: string; status: string; phase: number | null; parent_key: string | null; etapa: Etapa; zonas?: Zona[] };
export type DoneInitiative = { key: string; title: string; done_at: string | null };
export type OpenInitiative = { key: string; title: string; status: string; done: number; total: number; tickets: ProjectTicket[] };
// PLA-I53-2: GET /api/projects/:slug, with every ticket's stage and the board the floor reads.
export type StagedTask = TaskRow & { etapa?: Etapa | null };
export type ProjectRead = Omit<ProjectDetail, "tasks"> & { tasks: StagedTask[]; tablero?: Tablero; ahora?: AhoraItem[] };
// PLA-I53-6: the newest landed loose ticket's title, and the completed initiatives (newest first, no tickets).
export type Tablero = { initiatives: OpenInitiative[]; loose: ProjectTicket[]; loose_done: number; loose_done_title?: string | null; done_initiatives?: DoneInitiative[] };
export type OrgMoveVerb = "aceptar" | "publicar" | "responder" | "fijar" | "arrancar" | "planear" | "ver";
export type OrgMoveAction =
  | { kind: "decision"; id: string; action: DecisionAction; label: string }
  | { kind: "reveal"; id: string | null; label: string }
  | { kind: "publish"; label: string }
  | { kind: "fijar"; label: string }
  | { kind: "plan"; text: string; label: string }
  | { kind: "start"; agent: string; label: string }
  | { kind: "link"; href: string; label: string };
export type OrgMoveOrigin = { kind: "decision"; id: string; decision: string } | { kind: "light" } | { kind: "hold"; agent: string; hold: string } | { kind: "route"; leg: string };
export type OrgNextMove = { verbo: OrgMoveVerb; texto: string; accion: OrgMoveAction; origen: OrgMoveOrigin };
export type OrgLatest = { kind: "published" | "delivered"; title: string | null; n: number | null; at: string };
export type OrgStaleRequest = { key: string; title: string; since: string };
export type OrgStepState = "done" | "published" | "delivered" | "working" | "next" | "later";
// PLA-I47-3: postponed (a Backlog step) and waits (the step that holds it) only when they say something.
export type OrgRouteStep = { key: string; title: string; state: OrgStepState; who: string | null; at: string | null; postponed?: boolean; waits?: string | null };
export type OrgRouteLeg = { key: string; title: string; done: number; total: number; state: "done" | "here" | "planned" | "unplanned"; note: string | null; postponed?: boolean; steps?: OrgRouteStep[]; more_steps?: number };
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
// PLA-I46-11: a plan for a leg also carries the leg, its closed questions (suggested: 0-based) and the PO's
// check list; later_at once the owner said Después.
export type PlanQuestion = { text: string; options: string[]; suggested: number };
export type DecisionPlan = {
  order: string;
  understood: string;
  steps: { title: string; done_when: string }[];
  cost: string;
  needs_approval: boolean;
  created: string[];
  leg?: { key: string; title: string } | null;
  questions?: PlanQuestion[];
  checklist?: string[];
  later_at?: string | null;
};
export type DecisionEvidence = { verdict: string; kind: string; cite: string; pass: number | null; fail: number | null; at: string };
export type DecisionLink = { kind: "doc" | "pr" | "ticket" | "idea"; ref: string; title: string };
export type DecisionChecks = { open: number; ci: "pending" | "success" | "failure" | "none" | null };
export type ReelItem = { key: string; title: string; label: string; kind: "nueva" | "cambio"; image_url: string };
export type DecisionRelease = { from: string; into: string; env: string; ahead: number | null; tickets: { key: string; title: string }[]; open_checks: number; before: number; reel?: ReelItem[] };
export type DecisionAction = "elegir" | "responder" | "hecho" | "aplazar" | "aceptar" | "fusionar" | "cambios" | "empezar" | "cambiar" | "cancelar" | "despues" | "aplicar" | "verificar";
// PLA-I46-9/10: GET /api/projects/:slug/qa/:key (src/runner/qa.ts qaEvidence).
export type QaState = "off" | "none" | "waiting" | "checking" | "reviewing" | "pass" | "fail" | "returned" | "error";
export type QaRead = {
  project: string;
  key: string;
  enabled: boolean;
  state: QaState;
  tests: { pass: number; total: number; verdict: "pass" | "fail" | null; items: { name: string; command: string; ok: boolean; exit_code: number | null; pass: number | null; fail: number | null; duration_s: number }[] };
  review: { verdict: "pass" | "fail"; notes: string; model: string | null } | null;
  checklist: { n: number; text: string; mark: "pass" | "fail" | null; note: string | null }[];
  captures: { ids: string[]; image_urls: string[]; ok: number; failed: number; error: string | null } | null;
  notes: string | null;
};
// PLA-I52-4: GET /api/projects/:slug/probador/:key (src/captures/probador.ts probadorRead).
export type MuestraVista = { key: string; label: string; path: string; estado?: string; session?: boolean };
export type Muestra = { frase: string; vistas: MuestraVista[]; pasos: string[] };
export type ProbadorState = { state: "tomando" | "lista" | "fallo"; attempts: number; error: string | null; commit: string | null; at: string };
export type ParShot = { id: string; image_url: string; width: number; height: number | null; taken_at: string } | null;
export type ParSide = { still: ParShot; error: string | null; missing: boolean };
export type DiffBox = { x: number; y: number; w: number; h: number; ratio: number };
export type ParWidth = { antes: ParSide; despues: ParSide; diff: DiffBox | null };
export type ParVista = { key: string; label: string; path: string; estado: string | null; kind: "nueva" | "cambio" | "igual" | "sin_antes"; desktop: ParWidth; phone: ParWidth };
export type EntregaRead = { phase: "starting" | "capturing" | "live" | "failed" | "off" | "running"; port: number | null; url: string | null; error: string | null; key: string | null; branch: string | null; commit: string | null };
export type VivoRead = { url: string | null; local_url: string | null; tailnet: boolean; signed_in: boolean; user: string | null; error: string | null; hint: string | null };
export type ProbadorQA = { id: string; text: string; at: string; answer: { text: string; at: string; by: string } | null };
export type ProbadorRead = { key: string; muestra: Muestra | null; state: ProbadorState | null; vistas: ParVista[]; entrega: EntregaRead | null; preguntas?: ProbadorQA[] };
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
  cambio?: "se_ve" | "se_comporta" | "no_se_ve" | null;
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
export type Marca = { vista: string; side: "antes" | "despues"; width: "desktop" | "phone"; x: number; y: number; note: string };
export type DecisionInput = { action: DecisionAction; option?: number | number[]; text?: string; path?: string; lines?: string; answers?: number[]; checklist?: string[]; marcas?: Marca[] };
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
// PLA-I46-13: every role template and whether it can be added (free), is on the team (taken) or lacks its prompt doc.
export type HireRole = OrgTemplate & { state: "free" | "taken" | "no_doc" };
export type PackRef = { slug: string; name: string; when: string; doc_id: string };
export type OrgProjectDetail = ProjectSheetData & { team: OrgMember[]; thread_id: string; templates: OrgTemplate[]; hire?: HireRole[] };

// PLA-I47-1: La ficha's tabs (GET /api/company/projects/:slug/ficha). Rows only; a doc's body is read on open.
export type FichaIdea = {
  key: string;
  title: string;
  stage: string | null;
  waits: string | null;
  updated_at: string;
  docs: { Idea: string | null; Research: string | null; Design: string | null; Plan: string | null };
};
export type FichaPr = { number: number; title: string; url: string; state: string; ci_state: string | null; task_key: string | null; merged_at: string | null; head_branch: string | null };
export type FichaDoc = { id: string; title: string; task_key: string | null; updated_at: string };
export type FichaDesign = { idea_key: string; doc_id: string; url: string };
export type OrgFicha = {
  slug: string;
  counts: { ideas: number; prs: number; docs: number; designs: number };
  ideas: FichaIdea[];
  prs: FichaPr[];
  docs: FichaDoc[];
  designs: FichaDesign[];
};
export type ProjectDocBody = { id: string; title: string; version: number; markdown: string; task_key: string | null };

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
  // PLA-I46-5: week is the whole company's, input + output in used, cache reads and writes apart.
  usage: { asistente: Usage; projects: CompanyProjectRow[]; week?: Usage };
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

export type UsageTotal = { agent: string; project: string; week: string; input: number; output: number; cache_read?: number; cache_create?: number };
export type UsageWeek = { week: string; starts_at: string; used: number; input: number; output: number; cache_read: number; cache_create: number };
export type UsageSummary = { label: "reportado"; totals: UsageTotal[]; screen?: UsageWeek };

export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;
