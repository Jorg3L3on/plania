import type { Cronometro } from "./cronometro";
import type { RunReport } from "./informe";
import type { Oficio } from "./oficio";
import type { CodigoBody } from "./nuevo-proyecto";
import type { CaminoRead } from "./camino-types";
import type { Puesto, SkillCard, SkillDraft, SkillScope } from "./oficio-skills";
import type { ImportPreview, TrialStarted, TrialView, TrialsRead, UpdateCheck } from "./oficio-trials";
import type { LessonAction, LessonView, LessonsRead } from "./oficio-lessons";
import type { TaskComment, RoutineRun } from "@/components/delegation/types";
import type { TeamRoster } from "@/components/team/types";
import type { Dashboard, WakeResult } from "@/components/dashboard/types";
import type { Goal, GoalWrite } from "@/components/goals/model";
import type { Usage, Company, CompanyPlan, CompanyProjectRow, CompanyRun, NewProjectResult, ProjectSheetData, RunBrief } from "@/lib/compania";
import type { CapturesRead, PruebaRead } from "@/lib/ventana";
import type { Listo } from "@/lib/listo";
import type { Preparacion } from "@/lib/preparar-codigo";
import type { MachineCheckReading } from "@/lib/falta";
import type { ReleaseReading } from "@/lib/version";
import type { FirstStartState } from "@/lib/primer-arranque";
import type { Language } from "@/lib/i18n";
import type { GuiaRead } from "@/lib/primera-entrega";
import type { LimitsPage } from "@/lib/limites";
import type { Ajustes, AjustesContextoId } from "@/lib/ajustes";
import type { LogoRef } from "@/lib/logos";
import type { MarcaRead, MarksRequest, PixelTests, Plan, Staged, Surface, VersionRef } from "@/lib/marca";
import type { Style, StyleRead } from "@/lib/estilo";
import type { Voice, VoiceRead } from "@/lib/voz";
import type { Historial } from "@/lib/historial";
import type { ArranqueRead } from "@/lib/ajustes-avanzado";
import type { BaseRead, LlavesRead, MaquinasRead, PruebasRead, RecorridoRead, RowsRead, SeedResult, TableroRead, TablesRead } from "@/lib/maquinas";
import type { CopiasRead, EntrarRead, Numeros, SobrantesRead } from "@/lib/cuarto";

const copiaQ = (copia?: string) => (copia ? `?copia=${encodeURIComponent(copia)}` : "");
import type { AgentToken, Digest, Inbox, Machine, Orden, ProgressItem, ProgressLog, ProgressRange, ProgressSummary, ProjectDetail, ProjectSummary, ShipResult, StreamSummary, TaskDetail, TaskRow } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

// PLA-I67-2: one seat's routes under the company API.
const seatPath = (slug: string, agent: string) => `/company/projects/${encodeURIComponent(slug)}/team/${encodeURIComponent(agent)}`;

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
  // PLA-74: the stream's slim read (open ideas and tickets, counts), a few KB instead of the full 1.3 MB.
  projectsStream: () => request<StreamSummary[]>("GET", "/projects?for=stream"),
  project: (slug: string) => request<ProjectRead>("GET", `/projects/${encodeURIComponent(slug)}`),
  task: (slug: string, key: string) =>
    request<TaskDetail>("GET", `/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}`),
  // version is the one shown on screen; if the task moved since, the server answers STALE_VERSION.
  patchTask: (slug: string, key: string, patch: { status?: string; priority?: string; note?: string; reason?: string; version: number }) =>
    request<TaskDetail>("PATCH", `/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}`, patch),
  // 2.12 Pedir: a Backlog ticket as the owner (origin owner); the reply is the new task.
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
  // 2.11 Orden: the last audit run, and the one-click fixes (run as the owner); the reply is the new run.
  audit: (slug: string) => request<Orden>("GET", `/projects/${encodeURIComponent(slug)}/audit`),
  fixAudit: (slug: string, finding: { code: string; key: string | null; id: string }) =>
    request<Orden>("POST", `/projects/${encodeURIComponent(slug)}/audit/fix`, finding),
  inbox: (project?: string) => request<Inbox>("GET", project ? `/inbox?project=${encodeURIComponent(project)}` : "/inbox"),
  // 2.13: the owner ships the release step (merge mode): a PR from → into, merged with a merge commit.
  // PLA-I36-11: publishing carries the owner's code.
  shipRelease: (slug: string) => request<ShipResult>("POST", `/projects/${encodeURIComponent(slug)}/release/ship`, {}),
  // PLA-160: one throttled GitHub poll of the project, before the Publicar sheet says there is nothing to publish.
  releaseRecheck: (slug: string) => request<{ checked: boolean }>("POST", `/projects/${encodeURIComponent(slug)}/release/recheck`, {}),
  resolveBlocker: (slug: string, id: string, note?: string) =>
    request<{ key: string }>("POST", `/projects/${encodeURIComponent(slug)}/blockers/${encodeURIComponent(id)}/resolve`, note ? { note } : undefined),
  // Screen only. The bot cannot read or flip this.
  delegation: () => request<{ enabled: boolean }>("GET", "/delegation"),
  setDelegation: (enabled: boolean) => request<{ enabled: boolean }>("POST", "/delegation", { enabled }),
  // PLA-06: mark delegated answers seen (they leave the Bandeja and the audit; the record stays).
  reviewDelegated: (ids: string[]) => request<{ reviewed: number }>("POST", "/delegated/reviewed", { ids }),
  machine: () => request<Machine>("GET", "/machine"),
  // PLA-I2-12: what this machine lacks to run Plania; fresh checks again instead of the ten-minute reading.
  machineCheck: (fresh = false) => request<MachineCheckReading>("GET", `/machine-check${fresh ? "?fresh=1" : ""}`),
  // PLA-I2-17: which release this is and its notes (CHANGELOG.md).
  releaseInfo: () => request<ReleaseReading>("GET", "/release"),
  // PLA-I2-2: first start, before any session: whether it is open, the form, and the machine check it links.
  // PLA-I2-16: the guide to a first delivery, and its example project.
  guia: () => request<GuiaRead>("GET", "/guia"),
  guiaEjemplo: () => request<{ slug: string }>("POST", "/guia/ejemplo"),
  firstStart: () => request<FirstStartState>("GET", "/first-start"),
  // PLA-I2-10: the install's language; GET needs no session.
  language: () => request<{ language: Language; chosen: boolean; languages: Language[] }>("GET", "/language"),
  setLanguage: (language: Language) => request<{ language: Language }>("PUT", "/language", { language }),
  finishFirstStart: (body: { code: string; name: string; password: string; time_zone: string; projects_root?: string; worktrees_root?: string; language?: Language }) => request<{ ok: true; home: string }>("POST", "/first-start", body),
  // The first-install audit: gh before a project with code (F2), and Claude Code's own token (P5, shown once).
  githubAccess: () => request<{ access: string }>("GET", "/onboarding/github"),
  connectClaudeCode: () => request<{ url: string; secret: string }>("POST", "/onboarding/claude-code", {}),
  firstStartMachineCheck: (fresh = false) => request<MachineCheckReading>("GET", `/first-start/machine-check${fresh ? "?fresh=1" : ""}`),
  // PLA-I2-7: the page of limits, built from the real rules.
  limits: () => request<LimitsPage>("GET", "/limits"),
  // PLA-I2-9: migrations agents wrote in deliveries of Plania itself, not applied yet.
  selfMigrations: (slug: string) => request<import("./migraciones-propias").AgentMigrations>("GET", `/projects/${encodeURIComponent(slug)}/migraciones-propias`),
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
  // PLA-I72-5: copia names one copy's own base ("inicio" or an initiative key); without it, the app's.
  tablas: (slug: string, copia?: string) => request<TablesRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/tablas${copiaQ(copia)}`),
  filas: (slug: string, table: string, offset: number, copia?: string) =>
    request<RowsRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/tablas/${encodeURIComponent(table)}/filas?offset=${offset}${copia ? `&copia=${encodeURIComponent(copia)}` : ""}`),
  migrar: (slug: string, copia?: string) => request<SeedResult>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/migrar${copiaQ(copia)}`, {}),
  sembrar: (slug: string, copia?: string) => request<SeedResult>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/sembrar${copiaQ(copia)}`, {}),
  vaciarYSembrar: (slug: string, rows: number, copia?: string) => request<SeedResult>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/vaciar-y-sembrar${copiaQ(copia)}`, { rows }),
  // PLA-I72: the copies, their numbers, the leftovers and the sign-in (src/maquinas/copias.ts, numeros.ts, sobrantes.ts).
  copias: (slug: string) => request<CopiasRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/copias`),
  // PLA-I74-6: «Revisar proyecto».
  revision: (slug: string) => request<{ revision: import("./revision").RevisionRead }>("GET", `/projects/${encodeURIComponent(slug)}/revision`),
  revisar: (slug: string) => request<{ started: boolean; revision: import("./revision").RevisionRead }>("POST", `/projects/${encodeURIComponent(slug)}/revision`),
  copiaAct: (slug: string, id: string, action: "encender" | "apagar" | "reiniciar" | "borrar" | "quedarse" | "rehacer", body: { keep?: boolean } = {}) =>
    request<CopiasRead>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/copias/${encodeURIComponent(id)}/${action}`, body),
  borrarCache: (slug: string, id: string) => request<{ removed: string[]; freed_bytes: number }>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/copias/${encodeURIComponent(id)}/borrar-cache`, {}),
  reiniciarEncendidas: (slug: string) => request<CopiasRead & { reiniciadas: string[] }>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/copias/reiniciar-encendidas`, {}),
  numeros: (slug: string) => request<Numeros>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/numeros`),
  sobrantes: (slug: string) => request<SobrantesRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/sobrantes`),
  borrarSobrante: (slug: string, id: string) => request<SobrantesRead>("DELETE", `/projects/${encodeURIComponent(slug)}/maquinas/sobrantes/${encodeURIComponent(id)}`),
  borrarSobrantes: (slug: string, expected: number) => request<SobrantesRead & { borrados: number }>("DELETE", `/projects/${encodeURIComponent(slug)}/maquinas/sobrantes`, { expected }),
  entrar: (slug: string) => request<EntrarRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/entrar`),
  cambiarContrasena: (slug: string) => request<EntrarRead & { password: string; set_in: string[] }>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/entrar/cambiar`, {}),
  bitacoraDe: (slug: string, copia: string) => request<{ lines: string[] }>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/bitacora${copiaQ(copia)}`),
  llaves: (slug: string) => request<LlavesRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/llaves`),
  // PLA-116: one value into the app's env file; the answer is the names-only read again.
  ponerLlave: (slug: string, name: string, value: string) => request<LlavesRead>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/llaves`, { name, value }),
  pruebas: (slug: string) => request<PruebasRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/pruebas`),
  correrPruebas: (slug: string) => request<PruebasRead>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/pruebas`, {}),
  recorrido: (slug: string) => request<RecorridoRead>("GET", `/projects/${encodeURIComponent(slug)}/maquinas/recorrido`),
  contrasena: (slug: string) => request<{ user: string; password: string }>("POST", `/projects/${encodeURIComponent(slug)}/maquinas/recorrido/contrasena`, {}),
  tablero: () => request<TableroRead>("GET", "/maquinas/tablero"),
  // PLA-I46-10: the QA lane's evidence for one delivery (the floor's evidence card).
  qa: (slug: string, key: string) => request<QaRead>("GET", `/projects/${encodeURIComponent(slug)}/qa/${encodeURIComponent(key)}`),
  // PLA-I52-4: El Probador. The delivery's pairs (antes / después per view and width), its copy, and the two clicks.
  probador: (slug: string, key: string) => request<ProbadorRead>("GET", `/projects/${encodeURIComponent(slug)}/probador/${encodeURIComponent(key)}`),
  // PLA-127: the images a delivery changes, before and after.
  probadorImagenes: (slug: string, key: string) => request<{ files: { path: string; estado: "nueva" | "cambio" | "borrada" }[] }>("GET", `/projects/${encodeURIComponent(slug)}/probador/${encodeURIComponent(key)}/imagenes`),
  probadorTomar: (slug: string, key: string) => request<{ ok: true }>("POST", `/projects/${encodeURIComponent(slug)}/probador/${encodeURIComponent(key)}/tomar`, {}),
  preguntar: (slug: string, key: string, text: string) => request<{ id: string; wake: string }>("POST", `/projects/${encodeURIComponent(slug)}/probador/${encodeURIComponent(key)}/preguntar`, { text }),
  vivo: (slug: string) => request<{ vivo: VivoRead }>("POST", `/projects/${encodeURIComponent(slug)}/entrega/vivo`, {}),
  // PLA-91: the copy's state while it comes up (the card polls it; it never refreshed before).
  entregaEstado: (slug: string) => request<{ entrega: EntregaRead | null }>("GET", `/projects/${encodeURIComponent(slug)}/entrega`),
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
  // PLA-I66-1: every project logo (src/brand/logos.ts).
  logos: () => request<{ logos: Record<string, LogoRef> }>("GET", "/company/logos"),
  // PLA-I66-2: the Marca door (src/brand/marca.ts); fresh reads the repo again now.
  marca: (slug: string, fresh = false) => request<MarcaRead>("GET", `/company/projects/${encodeURIComponent(slug)}/marca${fresh ? "?fresh=1" : ""}`),
  // PLA-I66-3: the owner's own logo (src/api/marca.ts).
  marcaUpload: async (slug: string, file: File): Promise<Staged> => {
    const res = await fetch(`/api/company/projects/${encodeURIComponent(slug)}/logo/upload?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!res.ok) {
      const { error, ...detail } = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
      throw new ApiError(res.status, error ?? `HTTP_${res.status}`, detail);
    }
    return (await res.json()) as Staged;
  },
  marcaPreview: (slug: string, body: { up: string; scale: number; bg: string | null }) => request<{ png: string; tests: PixelTests }>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/preview`, body),
  marcaUse: (slug: string, body: { up: string; name: string; scale: number; bg: string | null }) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/logo`, body),
  marcaCandidate: (slug: string, path: string) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/candidate`, { path }),
  marcaVersions: (slug: string) => request<{ versions: VersionRef[] }>("GET", `/company/projects/${encodeURIComponent(slug)}/logo/versions`),
  marcaGoBack: (slug: string, v: number) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/versions/${v}`),
  marcaRelease: (slug: string) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/release`),
  // PLA-I66-4: the files into the repo.
  // PLA-I66-6: the switch for the native app icons and the launch screens.
  marcaNative: (slug: string, on: boolean) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/marca/native`, { on }),
  // PLA-I66-5: Artist's marks.
  marcaMarks: (slug: string) => request<{ request: MarksRequest | null }>("GET", `/company/projects/${encodeURIComponent(slug)}/logo/marks`),
  marcaCancelMarks: (slug: string, id: string) => request<{ request: MarksRequest }>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/marks/${encodeURIComponent(id)}/cancel`),
  marcaAskMarks: (slug: string, hints: { about: string; feel: string[]; avoid: string[]; colors: string[]; images: string[]; like?: string | null; change?: string | null; surface?: Surface | null }) => request<{ request: MarksRequest }>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/marks`, hints),
  marcaUseMark: (slug: string, id: string, mark: string) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/marks/${id}/${mark}`),
  marcaKeep: (slug: string, sha: string) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/keep`, { sha }),
  marcaPlan: (slug: string, mode: "faltan" | "todo", surface?: Surface | null) => request<{ plan: Plan; set: string; dir: string }>("GET", `/company/projects/${encodeURIComponent(slug)}/marca/plan?mode=${mode}${surface ? `&surface=${surface}` : ""}`),
  marcaRequest: (slug: string, mode: "faltan" | "todo", surface?: Surface | null) => request<{ key: string; read: MarcaRead }>("POST", `/company/projects/${encodeURIComponent(slug)}/marca/pedido`, { mode, surface: surface ?? null }),
  // PLA-122: one surface's own icon.
  marcaSurfaceStart: (slug: string, s: Surface) => request<Staged>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/surface/${s}/start`),
  marcaSurfaceSet: (slug: string, s: Surface, body: { up: string; name: string; scale: number; bg: string | null }) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/surface/${s}`, body),
  marcaSurfaceReset: (slug: string, s: Surface) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/surface/${s}/reset`),
  marcaExtras: (slug: string, key: string, on: boolean) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/marca/extras`, { key, on }),
  marcaUseMarkFor: (slug: string, id: string, mark: string, s: Surface) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/marks/${id}/${mark}?surface=${s}`),
  marcaVariant: (slug: string, s: Surface, body: { bg: string | null; scale: number }) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/surface/${s}/variant`, body),
  marcaSurfaceKeep: (slug: string, s: Surface) => request<MarcaRead>("POST", `/company/projects/${encodeURIComponent(slug)}/logo/surface/${s}/keep`),
  // PLA-I69-4: Marca → Estilo (src/api/marca.ts).
  marcaEstilo: (slug: string, fresh = false) => request<StyleRead>("GET", `/company/projects/${encodeURIComponent(slug)}/marca/estilo${fresh ? "?fresh=1" : ""}`),
  marcaEstiloSave: (slug: string, style: Partial<Style>) => request<StyleRead>("POST", `/company/projects/${encodeURIComponent(slug)}/marca/estilo`, style),
  marcaEstiloBack: (slug: string, v: number) => request<StyleRead>("POST", `/company/projects/${encodeURIComponent(slug)}/marca/estilo/back`, { v }),
  marcaEstiloPedido: (slug: string) => request<StyleRead & { key: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/marca/estilo/pedido`),
  // PLA-I69-5: Marca → Voz y nombre.
  marcaVoz: (slug: string) => request<VoiceRead>("GET", `/company/projects/${encodeURIComponent(slug)}/marca/voz`),
  marcaVozSave: (slug: string, voice: Partial<Voice>) => request<VoiceRead>("POST", `/company/projects/${encodeURIComponent(slug)}/marca/voz`, voice),
  marcaVozBack: (slug: string, v: number) => request<VoiceRead>("POST", `/company/projects/${encodeURIComponent(slug)}/marca/voz/back`, { v }),
  // PLA-I69-6: Marca → Historial.
  marcaHistorial: (slug: string) => request<Historial>("GET", `/company/projects/${encodeURIComponent(slug)}/marca/historial`),
  // PLA-I39-2: the clock's read.
  companyProject: (slug: string) => request<OrgProjectDetail>("GET", `/company/projects/${encodeURIComponent(slug)}`),
  companyFicha: (slug: string, all = false) => request<OrgFicha>("GET", `/company/projects/${encodeURIComponent(slug)}/ficha${all ? "?todo=1" : ""}`),
  // PLA-I64-6: what landed day by day (a window of 14 days ending on hasta).
  hecho: (slug: string, hasta?: string | null) => request<Hecho>("GET", `/company/projects/${encodeURIComponent(slug)}/hecho${hasta ? `?hasta=${encodeURIComponent(hasta)}` : ""}`),
  // NEWPROJ-4: what a run needs, ready / missing / not_needed. Reads only.
  readiness: (slug: string) => request<Listo>("GET", `/company/projects/${encodeURIComponent(slug)}/readiness`),
  // NEWPROJ-6: the Ajustes view. Each save sends the version it read and answers with the view read again.
  ajustes: (slug: string) => request<Ajustes>("GET", `/company/projects/${encodeURIComponent(slug)}/settings`),
  // PLA-I68: Camino (src/api/company-camino.ts).
  camino: (slug: string) => request<CaminoRead>("GET", `/company/projects/${encodeURIComponent(slug)}/camino`),
  caminoRecheck: (slug: string) => request<CaminoRead>("POST", `/company/projects/${encodeURIComponent(slug)}/camino/recheck`, {}),
  caminoSaveKey: (slug: string, provider: string, value: string) =>
    request<{ provider: string; meta: unknown }>("PUT", `/company/projects/${encodeURIComponent(slug)}/camino/keys/${encodeURIComponent(provider)}`, { value }),
  caminoTestKey: (slug: string, provider: string) =>
    request<{ provider: string; ok: boolean; status: number | null; message: string; account: string | null }>("POST", `/company/projects/${encodeURIComponent(slug)}/camino/keys/${encodeURIComponent(provider)}/test`, {}),
  caminoApply: (slug: string, input: { version: number; changes: { kind: string; label: string; [k: string]: unknown }[] }) =>
    request<{ results: { index: number; kind: string; dest: string; ok: boolean; error?: string; detail?: Record<string, unknown>; note?: string; pr?: { number: number; url: string } }[]; stopped: { index: number; error?: string; detail?: Record<string, unknown> } | null; applied: number; skipped: number; read: CaminoRead }>(
      "POST",
      `/company/projects/${encodeURIComponent(slug)}/camino/apply`,
      input,
    ),
  caminoRepoCheck: (slug: string, repo: string) =>
    request<{ ok: boolean; reason?: "no_token" | "not_found" | "refused" | "network"; repo?: string; private?: boolean; default_branch?: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/camino/repo-check`, { repo }),
  caminoLint: (slug: string, path: string, content: string) =>
    request<{ available: boolean; errors: { line: number; column: number; message: string; kind: string }[] }>("POST", `/company/projects/${encodeURIComponent(slug)}/camino/lint`, { path, content }),
  caminoPins: (slug: string, uses: string[]) => request<Record<string, string>>("POST", `/company/projects/${encodeURIComponent(slug)}/camino/pins`, { uses }),
  caminoRerun: (slug: string, id: number) => request<{ rerun: true }>("POST", `/company/projects/${encodeURIComponent(slug)}/camino/runs/${id}/rerun`, {}),
  caminoProviderList: (slug: string, provider: string, project?: string) =>
    request<{ items: { id: string; name: string; url?: string | null; note?: string | null }[]; connected: boolean; refused?: boolean }>("POST", `/company/projects/${encodeURIComponent(slug)}/camino/providers/${encodeURIComponent(provider)}/list`, project ? { project } : {}),
  caminoProviderVars: (slug: string, provider: string, project: string, target: string | null) =>
    request<{ names: string[]; connected: boolean; refused?: boolean }>("POST", `/company/projects/${encodeURIComponent(slug)}/camino/providers/${encodeURIComponent(provider)}/vars`, { project, target }),
  caminoApprove: (slug: string, path: string, sha256: string) => request<{ approved: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/camino/approve`, { path, sha256 }),
  caminoMigrations: (slug: string, database: string, tool: string) => request<{ ok: boolean; count: number | null }>("POST", `/company/projects/${encodeURIComponent(slug)}/camino/migrations`, { database, tool }),
  caminoRemoveKey: (slug: string, provider: string) => request<{ removed: true }>("DELETE", `/company/projects/${encodeURIComponent(slug)}/camino/keys/${encodeURIComponent(provider)}`),
  ajustesCodigo: (slug: string, input: { version: number; repo_path?: string; github_repo?: string; no_code?: true }) =>
    request<Ajustes>("PUT", `/company/projects/${encodeURIComponent(slug)}/settings/code`, input),
  // PLA-I2-5: Plania prepares the code (folder, git, GitHub, the working branch), and makes the working branch alone.
  prepararCodigo: (slug: string, input: { version: number; repo_path?: string; github: { name?: string; private?: boolean } | null }) =>
    request<{ setup: Preparacion; saved: boolean; settings: Ajustes }>("POST", `/company/projects/${encodeURIComponent(slug)}/settings/code/preparar`, input),
  crearRama: (slug: string) => request<{ state: "done" | "already" | "failed"; code: string | null }>("POST", `/company/projects/${encodeURIComponent(slug)}/settings/code/rama`, {}),
  ajustesLanzamiento: (slug: string, input: { version: number; release: { from: string; into: string; env: string; mode?: "merge"; prod_migrations?: "deploy" | "owner" | "none" } | null }) =>
    request<Ajustes>("PUT", `/company/projects/${encodeURIComponent(slug)}/settings/release`, input),
  ajustesPruebas: (slug: string, input: { version: number; commands: string[]; no_build?: string | null }) => request<Ajustes>("PUT", `/company/projects/${encodeURIComponent(slug)}/settings/verify`, input),
  ajustesContexto: (slug: string, id: AjustesContextoId, input: { markdown: string; version?: number }) =>
    request<Ajustes>("PUT", `/company/projects/${encodeURIComponent(slug)}/settings/context/${id}`, input),
  // PLA-I2-6: how the app starts, and one «Avanzado» field.
  // PLA-135: a library doc (create by title, or replace with the version read).
  ajustesDoc: (slug: string, input: { title: string; markdown: string; version?: number }) => request<Ajustes>("PUT", `/company/projects/${encodeURIComponent(slug)}/settings/docs`, input),
  ajustesArranque: (slug: string, input: { version: number; capture: ArranqueRead | null }) => request<Ajustes>("PUT", `/company/projects/${encodeURIComponent(slug)}/settings/capture`, input),
  ajustesAvanzado: (slug: string, input: { version: number; field: string; value: unknown }) => request<Ajustes>("PUT", `/company/projects/${encodeURIComponent(slug)}/settings/advanced`, input),
  // PLA-I64-3: steps done per day, last 14 days.
  pulso: (slug: string) => request<Pulso>("GET", `/company/projects/${encodeURIComponent(slug)}/pulso`),
  projectDoc: (slug: string, id: string) => request<ProjectDocBody>("GET", `/company/docs/${encodeURIComponent(id)}?project=${encodeURIComponent(slug)}`),
  // PLA-I46-13: packs are set in the same call; the server refuses an unknown pack before hiring.
  addToTeam: (slug: string, template: string, packs?: string[], motor?: MotorPatch) =>
    request<{ agent: OrgMember; team: OrgMember[]; packs?: PackRef[] }>("POST", `/company/projects/${encodeURIComponent(slug)}/team`, { template, ...(packs?.length ? { packs } : {}), ...(motor ? { motor } : {}) }),
  // PLA-I71-3: Equipo's seat changes (only the owner's session reaches them).
  equipo: (slug: string) => request<EquipoRead>("GET", `/company/projects/${encodeURIComponent(slug)}/equipo`),
  // PLA-I71-6: the team catalog, adopting a team, and the whole company in a file.
  teams: () => request<{ teams: TeamView[] }>("GET", "/company/teams"),
  saveTeam: (slug: string, input: { name: string; line?: string; lessons?: boolean; references?: boolean }) => request<TeamView>("POST", `/company/projects/${encodeURIComponent(slug)}/teams/save`, input),
  adoptPreview: (slug: string, team: string, mode: "keep" | "also") => request<AdoptPlan>("GET", `/company/projects/${encodeURIComponent(slug)}/teams/${encodeURIComponent(team)}/adopt?mode=${mode}`),
  adopt: (slug: string, team: string, mode: "keep" | "also") => request<AdoptPlan>("POST", `/company/projects/${encodeURIComponent(slug)}/teams/${encodeURIComponent(team)}/adopt`, { mode }),
  bringTeam: (source: PackageSource) => request<{ slug: string; ignored: string[] }>("POST", "/company/teams/import", { source }),
  exportFiles: (opts: { lessons: boolean; references: boolean }) => request<{ files: { path: string; content: string }[] }>("GET", `/company/export?lessons=${opts.lessons ? 1 : 0}&references=${opts.references ? 1 : 0}`),
  importPreview: (source: PackageSource) => request<CompanyImportPreview>("POST", "/company/import/preview", { source }),
  importCompany: (source: PackageSource, choices: Record<string, "create" | "rename" | "skip">) => request<{ created: string[]; renamed: string[]; skipped: string[]; agents: string[] }>("POST", "/company/import", { source, choices }),
  // PLA-I71-4: the skill store.
  tienda: (slug: string) => request<import("./tienda").Tienda>("GET", `/company/projects/${encodeURIComponent(slug)}/tienda`),
  seatBelow: (slug: string, agent: string) => request<{ below: string[] }>("GET", `${seatPath(slug, agent)}/below`),
  moveSeat: (slug: string, agent: string, reportsTo: string | null) => request<{ ok: true }>("PUT", `${seatPath(slug, agent)}/manager`, { reports_to: reportsTo }),
  pauseSeat: (slug: string, agent: string, paused: boolean) => request<{ paused: boolean }>("PUT", `${seatPath(slug, agent)}/pause`, { paused }),
  retireSeat: (slug: string, agent: string) => request<{ moved: string[] }>("POST", `${seatPath(slug, agent)}/retire`, {}),
  createPuesto: (input: { title: string; line: string; base: string }) => request<PuestoView>("POST", "/company/puestos", input),
  // PLA-142: a role of the owner's own and a saved or brought team can be deleted.
  deletePuesto: (slug: string) => request<{ deleted: string }>("DELETE", `/company/puestos/${encodeURIComponent(slug)}`),
  deleteTeam: (slug: string) => request<{ deleted: string }>("DELETE", `/company/teams/${encodeURIComponent(slug)}`),
  decideProposal: (slug: string, id: string, accept: boolean) => request<{ state: string; agent: string | null }>("POST", `/company/projects/${encodeURIComponent(slug)}/proposals/${encodeURIComponent(id)}/decide`, { accept }),
  // PLA-I59-2 (Motores): the console's one save (several seats and the company default, all or nothing).
  saveMotores: (input: MotoresSave) => request<{ changed: string[]; company: boolean; floor?: boolean }>("PUT", "/company/motores", input),
  // PLA-I46-12: the skill packs (Plania docs `Pack: <name>`).
  packs: () => request<{ packs: PackRef[] }>("GET", "/company/packs"),
  // PLA-I67-1: one agent's page, and La estantería's save (own: an empty list means it carries none).
  oficio: (slug: string, agent: string) => request<Oficio>("GET", `/company/projects/${encodeURIComponent(slug)}/team/${encodeURIComponent(agent)}/oficio`),
  setSeatPacks: (slug: string, agent: string, packs: string[]) =>
    request<{ project: string; agent: string; packs: PackRef[]; own: boolean }>("PUT", `/company/projects/${encodeURIComponent(slug)}/team/${encodeURIComponent(agent)}/packs`, { packs, own: true }),
  // PLA-140: back to the role's factory list (an empty list that is not its own).
  resetSeatPacks: (slug: string, agent: string) =>
    request<{ project: string; agent: string; packs: PackRef[]; own: boolean }>("PUT", `/company/projects/${encodeURIComponent(slug)}/team/${encodeURIComponent(agent)}/packs`, { packs: [], own: false }),
  // PLA-I67-2: the owner's skills and «tu manera» (src/api/company-oficio-skills.ts).
  skillCard: (slug: string, agent: string, skill: string) => request<SkillCard>("GET", `${seatPath(slug, agent)}/skills/${encodeURIComponent(skill)}`),
  createSkill: (slug: string, agent: string, d: SkillDraft) => request<SkillCard>("POST", `${seatPath(slug, agent)}/skills`, d),
  editSkill: (slug: string, agent: string, skill: string, d: Partial<SkillDraft>) => request<SkillCard>("PUT", `${seatPath(slug, agent)}/skills/${encodeURIComponent(skill)}`, d),
  setSkillOn: (slug: string, agent: string, skill: string, on: boolean) => request<SkillCard>("PUT", `${seatPath(slug, agent)}/skills/${encodeURIComponent(skill)}/state`, { on }),
  rollbackSkill: (slug: string, agent: string, skill: string, n: number) => request<SkillCard>("POST", `${seatPath(slug, agent)}/skills/${encodeURIComponent(skill)}/rollback`, { n }),
  duplicateSkill: (slug: string, agent: string, skill: string) => request<SkillCard>("POST", `${seatPath(slug, agent)}/skills/${encodeURIComponent(skill)}/duplicate`),
  deleteSkill: (slug: string, agent: string, skill: string) => request<{ archived: string }>("DELETE", `${seatPath(slug, agent)}/skills/${encodeURIComponent(skill)}`),
  restoreSkill: (slug: string, agent: string, skill: string) => request<SkillCard>("POST", `${seatPath(slug, agent)}/skills/${encodeURIComponent(skill)}/restore`),
  puesto: (slug: string, agent: string) => request<Puesto>("GET", `${seatPath(slug, agent)}/puesto`),
  setManner: (slug: string, agent: string, text: string) => request<Puesto>("PUT", `${seatPath(slug, agent)}/manner`, { text }),
  // PLA-I67-6: «Traer de un enlace» and «Probar» (src/api/company-oficio-trials.ts).
  previewImport: (slug: string, agent: string, url: string) => request<ImportPreview>("POST", `${seatPath(slug, agent)}/import/preview`, { url }),
  // PLA-I71-5: a pick from skills.sh, the catalog's search, and «No, quedarme con la mía».
  previewCatalog: (slug: string, agent: string, pick: { source: string; skill: string }) => request<ImportPreview>("POST", `${seatPath(slug, agent)}/import/preview`, { catalog: pick }),
  catalogSkills: (q: string) => request<{ skills: CatalogHit[] }>("GET", `/company/catalog/skills?q=${encodeURIComponent(q)}`),
  declineSkillLink: (slug: string, agent: string, skill: string) => request<SkillCard>("POST", `${seatPath(slug, agent)}/skills/${encodeURIComponent(skill)}/link/decline`),
  bringSkill: (slug: string, agent: string, input: { url: string; source_hash: string; scope: SkillScope; on: boolean; via: "skills.sh" | null }) => request<SkillCard>("POST", `${seatPath(slug, agent)}/import`, input),
  importSkill: (slug: string, agent: string, input: { url: string; source_hash: string; scope?: SkillScope }) => request<SkillCard>("POST", `${seatPath(slug, agent)}/import`, input),
  checkSkillLink: (slug: string, agent: string, skill: string) => request<UpdateCheck>("POST", `${seatPath(slug, agent)}/skills/${encodeURIComponent(skill)}/link/check`),
  updateSkillLink: (slug: string, agent: string, skill: string, source_hash: string) => request<SkillCard>("POST", `${seatPath(slug, agent)}/skills/${encodeURIComponent(skill)}/link/update`, { source_hash }),
  skillTrials: (slug: string, agent: string, skill: string) => request<TrialsRead>("GET", `${seatPath(slug, agent)}/skills/${encodeURIComponent(skill)}/trials`),
  startTrial: (slug: string, agent: string, skill: string, run_id: string) => request<TrialStarted>("POST", `${seatPath(slug, agent)}/skills/${encodeURIComponent(skill)}/trials`, { run_id }),
  trial: (slug: string, agent: string, id: string) => request<TrialView>("GET", `${seatPath(slug, agent)}/trials/${encodeURIComponent(id)}`),
  // PLA-I67-3: an agent's lessons (src/api/company-oficio-lessons.ts).
  lessons: (slug: string, agent: string) => request<LessonsRead>("GET", `${seatPath(slug, agent)}/lessons`),
  teachRule: (slug: string, agent: string, text: string) => request<LessonView>("POST", `${seatPath(slug, agent)}/lessons`, { text }),
  decideLesson: (slug: string, agent: string, id: string, action: LessonAction, edit: { text?: string; applies_when?: string | null; keep?: "new" | "old" } = {}) =>
    request<LessonView>("POST", `${seatPath(slug, agent)}/lessons/${encodeURIComponent(id)}/decide`, { action, ...edit }),
  // PLA-I67-5: repeats, merge into a skill, «mantener».
  markRepeat: (slug: string, agent: string, id: string) => request<{ ok: true }>("POST", `${seatPath(slug, agent)}/lessons/${encodeURIComponent(id)}/repeat`, {}),
  confirmRepeat: (slug: string, agent: string, rid: string, confirm: boolean) => request<{ ok: true }>("POST", `${seatPath(slug, agent)}/lessons/repeats/${encodeURIComponent(rid)}`, { confirm }),
  mergeLesson: (slug: string, agent: string, id: string, skill: string | null) => request<{ skill: string }>("POST", `${seatPath(slug, agent)}/lessons/${encodeURIComponent(id)}/merge`, { skill }),
  keepLesson: (slug: string, agent: string, id: string) => request<{ ok: true }>("POST", `${seatPath(slug, agent)}/lessons/${encodeURIComponent(id)}/keep`, {}),
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
  // NEWPROJ-7: Borrar proyecto, with the owner's code. Refusals: OWNER_CODE_UNSET 409, OWNER_CODE_REQUIRED / OWNER_CODE_INVALID 403.
  deleteProject: (slug: string, code: string) =>
    request<{ deleted: string; stopped: number; worktrees: number; agents: string[] }>("DELETE", `/company/projects/${encodeURIComponent(slug)}`, { code }),
  setRunnerSettings: (input: { plan_guard_pct?: number; guard_override?: boolean; max_turns?: number; timeout_minutes?: number; cooldown_minutes?: number }) => request<Company["settings"]>("PUT", "/company/settings", input),
  // PLA-I36: steer a project from its card.
  // PLA-I40-2: Que empiece ya for one teammate.
  // PLA-165: key, when the move names a step, starts that step and nothing else.
  startTeammate: (slug: string, agent: string, pastGuard = false, key: string | null = null) =>
    request<StartNowResult>("POST", `/company/projects/${encodeURIComponent(slug)}/team/${encodeURIComponent(agent)}/start`, { ...(pastGuard ? { past_guard: true } : {}), ...(key ? { key } : {}) }),
  // PLA-I54-1: mode forma (an idea in the floor's tube) or ya (the Ready ticket plus the wake). The reply's key is the
  // new idea's or ticket's: F5 uploads the side page's pictures to it.
  // PLA-I57-1: mode pregunta asks the PO a question (no task; the reply's consulta is its id); consulta on a forma or
  // ya request carries that answer along.
  askProject: (slug: string, input: { text: string; kind?: OrderKind; now?: boolean; mode?: AskMode; consulta?: string }) =>
    request<AskResult>("POST", `/company/projects/${encodeURIComponent(slug)}/ask`, input),
  consultas: (slug: string) => request<{ consultas: ConsultaView[] }>("GET", `/company/projects/${encodeURIComponent(slug)}/consultas`),
  pickNext: (slug: string, key: string) => request<{ next: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/next`, { key }),
  setProjectOptions: (slug: string, input: { plan_approval?: boolean; preview_url?: string | null; auto_accept?: boolean; auto_accept_invisible?: boolean }) =>
    request<{ plan_approval: boolean; preview_url: string | null }>("PUT", `/company/projects/${encodeURIComponent(slug)}/options`, input),
  stopRun: (id: string) => request<{ stopped: true; ticket: string | null }>("POST", `/company/runs/${encodeURIComponent(id)}/stop`),
  resumeRun: (id: string) => request<{ woke: boolean; reason: string; ticket: string | null }>("POST", `/company/runs/${encodeURIComponent(id)}/resume`),
  // PLA-I54-3: the Pedido tab (a note uses noteTask, an answer the screen's answer route).
  pedido: (slug: string, key: string) => request<PedidoDetail>("GET", `/company/projects/${encodeURIComponent(slug)}/pedidos/${encodeURIComponent(key)}`),
  pedidoAct: (slug: string, key: string, action: "guardar" | "restaurar" | "descartar" | "construir", reason?: string) =>
    request<{ key: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/pedidos/${encodeURIComponent(key)}/${action}`, reason ? { reason } : {}),
  // PLA-I61 (La idea abierta): any idea with its stops; seen, answers, wake (src/api/company-idea.ts).
  idea: (slug: string, key: string) => request<IdeaDetail>("GET", `/company/projects/${encodeURIComponent(slug)}/ideas/${encodeURIComponent(key)}`),
  ideaVisto: (slug: string, key: string, stop: PedidoStop) => request<{ key: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/ideas/${encodeURIComponent(key)}/visto`, { stop }),
  ideaRespuesta: (slug: string, key: string, input: IdeaAnswerInput) =>
    request<{ key: string; stage: string | null; wake: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/ideas/${encodeURIComponent(key)}/respuesta`, input),
  // AUDIT-8: his pick on one of the PO's decisions (numbers as the screen shows them, from 1).
  ideaDecision: (slug: string, key: string, input: IdeaDecisionInput) =>
    request<{ key: string; stage: string | null; changed: boolean; wake: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/ideas/${encodeURIComponent(key)}/decision`, input),
  pedirArreglo: (slug: string, key: string) => request<{ key: string; existing: boolean }>("POST", `/company/projects/${encodeURIComponent(slug)}/initiatives/${encodeURIComponent(key)}/arreglo`),
  ideaDespertar: (slug: string, key: string) => request<{ key: string; wake: string }>("POST", `/company/projects/${encodeURIComponent(slug)}/ideas/${encodeURIComponent(key)}/despertar`),
  noteTask: (slug: string, key: string, text: string) => request<{ noted: true }>("POST", `/company/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}/note`, { text }),
  resendRequest: (slug: string, key: string) => request<{ key: string; wake: "queued" | "busy" | "off" }>("POST", `/company/projects/${encodeURIComponent(slug)}/requests/${encodeURIComponent(key)}/resend`),
  cancelOrder: (slug: string, key: string) => request<{ cancelled: string[] }>("POST", `/company/projects/${encodeURIComponent(slug)}/orders/${encodeURIComponent(key)}/cancel`),
  ownerCode: () => request<{ enrolled: boolean }>("GET", "/company/owner-code"),
  enrolOwnerCode: (input: { password: string; code?: string }) => request<{ secret_base32: string; otpauth_uri: string }>("POST", "/company/owner-code/enroll", input),
  // PLA-I31-3 adds this route; until then it is 404 and the dialog says so.
  createCompanyProject: (input: { name: string; goal?: string } & CodigoBody) => request<NewProjectResult>("POST", "/company/projects", input),
  // «Agregar un proyecto»: the machine's own folder window (only for a browser on the machine the server runs on).
  elegirCarpeta: () => request<{ available: boolean; path: string | null }>("POST", "/company/carpeta", {}),
};

// ---- PLA-I33: the organization (Plan doc 61ad843a, "Contrato de API"). Fields the contract leaves
// untyped (week, usage, last_run) reuse the PLA-I30 shapes.

export type OrderKind = "cambio" | "direccion" | "idea";
export type StartNowResult = { started: boolean; reason: "started" | "queued" | "busy" | "idle" | "held" | "fail"; ticket: string | null; run_id: string | null; summary: string };
export type AskMode = "forma" | "ya" | "pregunta";
// PLA-I57-1: a question from Preguntar and the PO's answer (src/pedidos/consultas.ts).
export type ConsultaAnswer = {
  short: string;
  why: string[];
  sources: { path: string; line: number | null; missing: boolean }[];
  branch: string | null;
  commit: string | null;
  sure: "seen" | "guess";
  tried: boolean;
  fix: string | null;
  by: string;
};
export type ConsultaView = {
  id: string;
  text: string;
  asked_at: string;
  state: "cola" | "leyendo" | "lista" | "sin_respuesta";
  trail: string[];
  started_at: string | null;
  answered_at: string | null;
  answer: ConsultaAnswer | null;
  /** PLA-69: why a queued question waits, when the runner holds it. */
  held?: string | null;
};
export type AskResult = { key: string; title: string; po: string; mode?: AskMode; consulta?: string; wake: "queued" | "busy" | "off"; woke: { woke: boolean; reason: string; ticket: string | null; summary: string } | null };
// PLA-I54-1: one of the owner's ideas taking shape, a capsule in the floor's tube (src/api/company-pedidos.ts).
export type PedidoStop = "buzon" | "entendido" | "investigacion" | "diseno" | "plan" | "lista";
export type PedidoState = "espera" | "trabajando" | "quieta" | "cola" | "valvula";
// PLA-I54-3: one request in La ficha's Pedido tab (src/api/company-pedido.ts).
export type PedidoTrailItem = {
  at: string;
  who: string;
  kind: "pedido" | "nota" | "entendi" | "pregunta" | "respuesta" | "doc" | "etapa" | "guardada" | "restaurada" | "construir" | "valvula" | "descartada" | "veredicto" | "marcos" | "despertar";
  text: string;
  doc?: { id: string; title: string };
  stop?: string;
};
// PLA-I61 (La idea abierta).
export type IdeaVerdict = "ok" | "deshacer" | "cambios" | "opcion" | "corregir";
export type IdeaNote = { frame: string; x: number; y: number; text: string };
export type IdeaAnswerInput = { stop: PedidoStop; verdict: IdeaVerdict; text?: string; option?: number; notes?: IdeaNote[] };
export type IdeaAnswer = { verdict: Exclude<IdeaVerdict, "deshacer">; text: string | null; option: number | null; notes: IdeaNote[]; at: string };
export type IdeaStop = {
  stop: PedidoStop;
  state: "done" | "here" | "todo";
  by: string | null;
  at: string | null;
  delivered: boolean;
  doc: { id: string; title: string; version: number; markdown: string } | null;
  seen: boolean;
  answer: IdeaAnswer | null;
  // AUDIT-8: what the stage delivered as data; null when its doc was written by hand.
  data?: Record<string, unknown> | null;
};
// AUDIT-8: a decision of the PO's. recommended and chosen are option numbers (from 1); chosen is the one in force.
export type IdeaDecision = { n: number; question: string; options: string[]; recommended: number; why: string; state: "assumed" | "decided"; chosen: number; at: string | null };
export type IdeaDecisionInput = { decision: number; option: number; question?: string; text?: string };
export type IdeaPlanStep = { title: string; done_when: string; try_it: string; work_type: string };
export type IdeaFrame = { id: string; frame: string; name: string; group: string | null; hace: string | null; porque: string | null; url: string; width: number | null; height: number | null };
export type IdeaDetail = OrgPedido & {
  summary: string;
  text: string;
  status: string;
  stage: string | null;
  promoted_to: string | null;
  pedido: boolean;
  question_options: string[];
  stops: IdeaStop[];
  ficha: PedidoFicha;
  // PLA-112 (F-5): the PO's own ficha, for the Entendido stop (older servers do not send it).
  ficha_po?: PedidoFicha;
  research: { recommendation: string | null; options: { n: number; title: string; text: string }[]; unknown: string[]; recommended?: number | null; learned?: string[] };
  plan_steps: string[];
  // AUDIT-8: the plan and the PO's decisions as data (an idea whose docs were written by hand has neither).
  plan?: { steps: IdeaPlanStep[]; risks: string[]; size: string | null } | null;
  decisions?: IdeaDecision[];
  frames: IdeaFrame[];
  unseen: number;
  quiet_since: string | null;
  queued?: string | null;
  trail: PedidoTrailItem[];
  pictures: { id: string; url: string; at: string }[];
  // PLA-I65-1 (Una sola ficha); an older server sends none of these.
  kind?: "idea" | "initiative";
  short?: string;
  understood_text?: string | null;
  gist?: Partial<Record<PedidoStop, string | null>>;
  built?: IdeaBuilt | null;
};
// PLA-I65-1: the initiative the idea became (src/api/company-idea.ts builtOf).
export type IdeaBuiltStep = { key: string; title: string; status: string; phase: number | null; etapa: EtapaId | null; pr: { number: number; state: string; url: string } | null };
export type IdeaBuilt = {
  key: string;
  title: string;
  status: string;
  version: number;
  done: number;
  total: number;
  can_close: boolean;
  steps: IdeaBuiltStep[];
  prs: { number: number; state: string; url: string; key: string }[];
  published_at: string | null;
  evidence: { key: string; kind: string; cite: string; commit: string | null; env: string | null; at: string }[];
  // PLA-I73-1: an older server sends none.
  tiempo?: Cronometro;
  // PLA-I74-8: the production deploy its merged steps wait on (src/api/deploy-fix.ts); an older server sends none.
  deploy?: IdeaDeploy | null;
  // PLA-I74-1: the run report; an older server sends none.
  informe?: RunReport;
};
export type IdeaDeploy = { state: "error" | "building" | "checking"; sha: string | null; url: string | null; probe_url: string | null; log: string | null; at: string; fix_key: string | null };
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
  // PLA-I61-6: deliveries he has not opened and the newest one (an older server sends neither).
  unseen?: number;
  unseen_stop?: PedidoStop | null;
};
export type OrgLight = "ok" | "needs_owner" | "failed" | "blocked" | "late" | "quiet" | "paused";
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
export type OrgMemberState = "running" | "idle" | "waiting_owner" | "paused";
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
  // PLA-I67-1: how many skills its next run carries (its own list, else its role's default kit).
  skills_on?: number;
  // PLA-I59-2 (Motores): what this seat's next run asks for and whether each part is its own; a PO's Preguntar
  // motor; this week's input + output tokens and share of the project. Optional for older servers.
  motor?: MotorView;
  consulta_motor?: MotorView | null;
  used_week?: { tokens: number; share: number } | null;
  // PLA-I71-1: the org chart's facts (its name, who it reports to by slug, its own lessons). Optional for older servers.
  name?: string;
  reports_to?: string | null;
  lessons?: { active: number; proposed: number };
  // PLA-I71-3: when the owner paused this seat (null: it works), and a role of the owner's own's title.
  paused_at?: string | null;
  puesto?: string | null;
};
export type MotorView = { model: string | null; effort: string | null; own_model: boolean; own_effort: boolean };
// PLA-I71-3: the role catalog (factory and the owner's own) and a PO's open seat proposals.
export type TeamSeatSpec = { role: string; title?: string | null; line?: string | null; base?: string | null; reports_to: string | null; skills: string[]; motor?: { model: string | null; effort: string | null } | null; manner?: string | null };
export type TeamView = { slug: string; name: string; line: string; origin: "factory" | "owner" | "imported"; seats: { role: string; title: string | null }[]; skills: number; hash: string; source: string | null; at: string | null; spec: { seats: TeamSeatSpec[]; lessons?: unknown[]; references?: unknown[] } };
export type AdoptPlan = { template: string; name: string; hash: string; stays: { role: string; agent: string; adds: string[] }[]; arrives: { role: string; title: string | null; reports_to: string | null; skills: string[]; motor: { model: string | null; effort: string | null } | null }[]; no_room: string[]; plan_note: { more_agents: number } };
export type PackageSource = { files: { path: string; content: string }[] } | { tar: string } | { url: string };
export type CompanyImportItem = { key: string; kind: "team" | "skill"; name: string; action: "create" | "rename" | "skip"; to: string; taken: boolean; agents?: number; marks?: number };
export type CompanyImportPreview = { company: string; items: CompanyImportItem[]; agents: number; ignored: string[]; secrets: string[] };
export type CatalogHit = { id: string; name: string; source: string; skill: string; publisher: string; installs: number | null };
export type PuestoView = { slug: string; title: string; line: string; origin: "factory" | "owner"; base: string; taken: boolean };
export type SeatProposalView = { id: string; role: string; title: string; reason: string; proposed_by: string; state: string; at: string };
export type EquipoRead = { puestos: PuestoView[]; proposals: SeatProposalView[] };
// A part null clears it (the seat inherits again); the whole patch null clears both.
export type MotorPatch = { model?: string | null; effort?: string | null };
// PLA-I60-5: the same save carries «a la vez»: per seat (max_parallel, null: del piso), the project's floor and the
// company's «Tope de la máquina».
export type MotoresSave = {
  project: string;
  seats?: { agent: string; motor?: MotorPatch | null; consulta_motor?: MotorPatch | null; max_parallel?: number | null }[];
  floor?: { max_concurrent?: number; max_per_agent?: number; consulta_slots?: number };
  company?: MotorPatch & { max_concurrent?: number };
};
// PLA-I60-5: what Motores shows about «a la vez» (types live with the pure logic, lib/a-la-vez.ts).
export type { RunnerHeld, RunnerLive, RunnerQueued, RunnerSeat, RunnerView } from "./a-la-vez";
import type { RunnerView } from "./a-la-vez";
export type OrgNextHold = "rest" | "usage" | "slot" | "paused" | "no_goal" | "waiting_owner" | "waiting_step" | "unqueued" | "soon";
export type OrgNextStart = { key: string | null; title: string | null; hold: OrgNextHold; starts_at: string | null; text: string };
export type OrgThreadRef = { id: string; unread: number; last: { at: string; author_role: string; body: string } | null };
export type OrgProject = {
  // F7: the home project while it holds no work; lists leave it out (lib/proyectos-visibles.ts).
  quiet_home?: boolean;
  // PLA-I60-5: «a la vez» (absent on older servers: Motores then shows the model and effort only).
  runner?: RunnerView;
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
// NEWPROJ-5: arranque, when the step's newest run failed before it started (its summary, when). Optional for older servers.
// PLA-I3-1: tokens, what the runner measured: used is input + output (the figure to show), the prompt cache apart.
// An initiative's rolls up its tickets, its own runs and the idea it was promoted from. Optional for older servers.
export type Tokens = { used: number; cache_read: number; cache_write: number; runs: number };
// PLA-I74-5: whose turn the step is (src/state/turn.ts). Optional so older servers and fixtures render.
export type Turn =
  | { turn: "agent_working"; agent: string | null; run_id: string | null; since: string | null }
  | { turn: "agent_queued"; agent: string | null; reason: "run_queued" | "agent_busy" | "waits_step" | "qa_queued"; detail: string | null }
  | { turn: "owner"; card: string; detail: string | null }
  | { turn: "outside"; on: "ci" | "photos" | "review" | "merge" | "deploy" | "close" | "env" | "time"; until: string | null }
  | { turn: "failed"; detail: string | null }
  | { turn: "nobody"; why: string; agent: string | null };
export type ProjectTicket = { key: string; title: string; status: string; phase: number | null; parent_key: string | null; etapa: Etapa; zonas?: Zona[]; arranque?: { summary: string; at: string | null } | null; tokens?: Tokens; turn?: Turn };
export type DoneInitiative = { key: string; title: string; done_at: string | null };
// PLA-I56-1: done counts landed tickets (Merged, Released, Done); closed only Done; can_close when every ticket is Done.
// An older server sends none of the three (then landed counts as closed, and there is no Cerrar).
export type OpenInitiative = { key: string; title: string; status: string; done: number; total: number; closed?: number; can_close?: boolean; version?: number; tokens?: Tokens; tickets: ProjectTicket[] };
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
  | { kind: "start"; agent: string; label: string; key?: string | null }
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
// PLA-I67-3: leccion, a lesson proposed from the owner's correction.
export type DecisionKind = "proposal" | "plan" | "action" | "question" | "deliverable" | "pr" | "step" | "release" | "leccion";
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
export type DecisionRelease = { from: string; into: string; env: string; ahead: number | null; tickets: { key: string; title: string }[]; open_checks: number; before: number; reel?: ReelItem[]; migrations?: string[]; migrate?: "auto" | "manual" | null; prod_migrations?: "deploy" | "owner" | "none" | null; prod_fix?: { env: string; name: string; missing: "provider" | null } };
export type DecisionAction = "elegir" | "responder" | "hecho" | "aplazar" | "aceptar" | "fusionar" | "cambios" | "empezar" | "cambiar" | "cancelar" | "despues" | "aplicar" | "verificar" | "aprobar" | "once" | "rechazar";
// PLA-I46-9/10: GET /api/projects/:slug/qa/:key (src/runner/qa.ts qaEvidence).
export type QaState = "off" | "none" | "waiting" | "checking" | "reviewing" | "pass" | "fail" | "returned" | "error";
export type QaAxisRead = { verdict: "pass" | "fail"; notes: string };
export type QaRead = {
  project: string;
  key: string;
  enabled: boolean;
  state: QaState;
  tests: { pass: number; total: number; verdict: "pass" | "fail" | null; items: { name: string; command: string; ok: boolean; exit_code: number | null; pass: number | null; fail: number | null; duration_s: number }[] };
  // AUDIT-6: spec and code are the review's two verdicts (absent on an older review); walked, whether QA went through the app.
  review: { verdict: "pass" | "fail"; notes: string; model: string | null; spec?: QaAxisRead; code?: QaAxisRead; walked?: boolean } | null;
  checklist: { n: number; text: string; mark: "pass" | "fail" | null; note: string | null }[];
  captures: { ids: string[]; image_urls: string[]; ok: number; failed: number; error: string | null } | null;
  notes: string | null;
};
// PLA-I52-4: GET /api/projects/:slug/probador/:key (src/captures/probador.ts probadorRead).
export type MuestraVista = { key: string; label: string; path: string; estado?: string; session?: boolean };
export type Muestra = { frase: string; vistas: MuestraVista[]; pasos: string[] };
// PLA-158 (F-27): waiting says what a pass in «tomando» waits on, in the owner's words (null while it works).
export type ProbadorState = { state: "tomando" | "lista" | "fallo"; attempts: number; error: string | null; commit: string | null; at: string; waiting?: string | null };
export type ParShot = { id: string; image_url: string; width: number; height: number | null; taken_at: string } | null;
export type ParSide = { still: ParShot; error: string | null; missing: boolean };
export type DiffBox = { x: number; y: number; w: number; h: number; ratio: number };
export type ParWidth = { antes: ParSide; despues: ParSide; diff: DiffBox | null };
export type ParVista = { key: string; label: string; path: string; estado: string | null; kind: "nueva" | "cambio" | "igual" | "sin_antes" | "error"; desktop: ParWidth; phone: ParWidth };
export type EntregaRead = { phase: "starting" | "capturing" | "live" | "failed" | "off" | "running" | "unavailable"; port: number | null; url: string | null; error: string | null; key: string | null; branch: string | null; commit: string | null };
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
  // PLA-I59-2: the company's default motor (null parts: the CLI's own default). Optional for older servers.
  motor_default?: { model: string | null; effort: string | null };
  // PLA-I2-13: which sign-in Claude is using, one sentence from the server.
  claude_sign_in?: string;
};
export type OrgTemplate = { slug: string; title: string };
// PLA-I46-13: every role template and whether it can be added (free), is on the team (taken) or lacks its prompt doc.
export type HireRole = OrgTemplate & { state: "free" | "taken" | "no_doc" };
// AUDIT-3: source kit is a skill folder in the Plania repo (no doc); doc is a `Pack: <name>` doc.
export type PackRef = { slug: string; name: string; when: string; doc_id: string | null; source?: "kit" | "doc"; sha?: string };
export type OrgProjectDetail = ProjectSheetData & { team: OrgMember[]; thread_id: string; templates: OrgTemplate[]; hire?: HireRole[] };

// PLA-I47-1: La ficha's tabs (GET /api/company/projects/:slug/ficha). Rows only; a doc's body is read on open.
export type FichaIdea = {
  key: string;
  title: string;
  stage: string | null;
  waits: string | null;
  updated_at: string;
  docs: { Idea: string | null; Research: string | null; Design: string | null; Plan: string | null };
  // PLA-I61-3: older servers send neither.
  summary?: string;
  unseen?: number;
  // PLA-I64-1: older servers send none of these.
  promoted_to?: string | null;
  origin?: string | null;
  stop?: PedidoStop | null;
  state?: PedidoState | null;
  guardada?: boolean;
  question?: { id: string; text: string } | null;
  // PLA-62: when he last said «Constrúyelo».
  ordered_at?: string | null;
};
export type FichaLienzo = { key: string; title: string; count: number; thumbs: string[]; unseen: number };
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
  lienzos?: FichaLienzo[];
  // PLA-I64-1: every idea that became an initiative.
  promoted?: { idea: string; initiative: string }[];
};
export type HechoDay = { day: string; n: number; steps: { key: string; title: string; parent: string | null }[]; more: number; initiatives: { key: string; title: string }[]; prs: number };
export type Hecho = { from: string; to: string; tz: string; total: number; days: HechoDay[]; initiatives: { key: string; title: string; done_at: string; steps: number; idea: string | null; origin: string | null }[]; before: string | null };
export type Pulso = { days: { day: string; n: number }[]; total: number; tz: string };
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

export type UsageTotal = { agent: string; project: string; week: string; input: number; output: number; cache_read?: number; cache_create?: number };
export type UsageWeek = { week: string; starts_at: string; used: number; input: number; output: number; cache_read: number; cache_create: number };
export type UsageSummary = { label: "reportado"; totals: UsageTotal[]; screen?: UsageWeek };

export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;

// ---- PLA-I54-2: pictures on a request (src/api/pedido-images.ts). Screen cookie only.
// Errors come back as ApiError with detail.message in Spanish, ready to show (e.g. "La imagen pesa más de 5 MB.").
export type PedidoImage = {
  id: string;
  url: string; // the bytes, behind the session
  mime: "image/png" | "image/jpeg" | "image/webp";
  bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
};
export const PEDIDO_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PEDIDO_IMAGE_MAX = 6;
const pedidoImagesPath = (slug: string, key: string) => `/company/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}/images`;

export const listPedidoImages = (slug: string, key: string) =>
  request<{ images: PedidoImage[] }>("GET", pedidoImagesPath(slug, key)).then((r) => r.images);

// One picture per call, sent as its raw bytes (the server reads the type from them, not from the name).
export async function uploadPedidoImage(slug: string, key: string, file: Blob): Promise<PedidoImage> {
  const res = await fetch(`/api${pedidoImagesPath(slug, key)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    const { error, ...detail } = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    throw new ApiError(res.status, error ?? `HTTP_${res.status}`, detail);
  }
  return ((await res.json()) as { image: PedidoImage }).image;
}

// Several pictures in order; stops at the first refusal and says which ones made it.
export async function uploadPedidoImages(slug: string, key: string, files: Blob[]): Promise<{ images: PedidoImage[]; error: ApiError | null }> {
  const images: PedidoImage[] = [];
  for (const f of files) {
    try {
      images.push(await uploadPedidoImage(slug, key, f));
    } catch (e) {
      if (e instanceof ApiError) return { images, error: e };
      throw e;
    }
  }
  return { images, error: null };
}

export const deletePedidoImage = (slug: string, key: string, id: string) =>
  request<{ deleted: true }>("DELETE", `${pedidoImagesPath(slug, key)}/${encodeURIComponent(id)}`);
