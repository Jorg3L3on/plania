// PLA-I35-1: GET /api/company adds plan, this_week, next and work per project and decisions[] (Te toca);
// POST /api/company/decisions/:id {action, option?, text?} acts on one row (src/api/company-decisions.ts).
// PLA-I32-6: GET /api/company and GET /api/company/projects/:slug serve the Plan's read contract
// (src/api/company-org.ts); POST /api/company/projects/:slug/team {template} adds a team member; the runner's
// plumbing (switches, guard, runs, log) is read from GET /api/machine. The writes below stay.
// PLA-I29: the runner's screen routes. The owner's session cookie only, like the delegation switch:
// a Bearer (any agent token) is 403 even with a cookie, no cookie is 401. No MCP tool writes these.
//   GET  /api/company                      the Compañía read (switches, runs, plan reading)
//   POST /api/company/switch               {paused}            company kill switch
//   POST /api/company/projects/:slug/switch {paused}           project kill switch
//   PUT  /api/company/settings             {max_concurrent?, cooldown_minutes?, plan_guard_pct?, guard_override?, reserve_tokens?, max_turns?, timeout_minutes?, default_model?, default_effort?}
//   POST /api/company/projects             {name, goal}  PLA-I31-3: a new project, paused, with its PO
//        → 201 {slug, key_prefix, paused: true, po, prompt_doc_id}; 409 PROJECT_EXISTS | PROMPT_DOC_MISSING
// PLA-I30 (src/api/company-extra.ts): the read gains viewer, prompts, roster and project_facts, plus
//   GET  /api/company/projects/:slug       the project sheet
//   GET  /api/company/docs/:id             one role prompt doc (Prompt ↗); ?project=<slug>: any doc of that project (PLA-I47-1)
//   GET  /api/company/projects/:slug/ficha La ficha's rows: ideas, PRs, docs, lienzos (PLA-I47-1)
//   GET  /api/company/projects/:slug/pulso steps done per day, last 14 days (PLA-I64-3)
//   GET  /api/company/projects/:slug/readiness  NEWPROJ-4: what a run needs, ready / missing / not_needed (src/runner/readiness.ts)
//   GET  /api/company/projects/:slug/settings   NEWPROJ-6: the Ajustes view; PUT …/settings/{code,release,verify,context/:doc}
//        writes through setProject and attachDoc (src/api/project-settings.ts)
//   GET  /api/company/projects/:slug/hecho what landed day by day, ?hasta=&dias= (PLA-I64-6); …/ficha?todo=1 every doc and PR
// PLA-I30-6/7: POST /api/company/projects/:slug/ask {text}  and  POST /api/company/projects/:slug/wake
// PLA-I54-3/4: GET /api/company/projects/:slug/pedidos/:key and POST …/pedidos/:key/{guardar,restaurar,descartar,construir}.
// PLA-I36-11: deleting a project needs the owner's code ({code}). src/auth/owner-code.ts.
// PLA-21: no token budgets, so no limit to raise.
//   GET  /api/company/owner-code          {enrolled}
//   POST /api/company/owner-code/enroll   {password, code?} → {secret_base32, otpauth_uri} once
//   DELETE /api/company/projects/:slug    {code}  the project and everything in it; NEWPROJ-7: its live runs are stopped,
//        its worktrees removed and its team deleted first → {deleted, stopped, worktrees, agents}
// PLA-I46-12: skill packs (src/runner/packs.ts). A pack is a `Pack: <name>` doc; a role carries a list of slugs.
//   GET  /api/company/packs                               → {packs: [{slug, name, when, doc_id}]}
//   GET  /api/company/projects/:slug/team/:agent/packs    → {project, agent, packs: [{slug, name, when, doc_id}]}
//   PUT  /api/company/projects/:slug/team/:agent/packs    {packs: [slug], own?} replaces the list → same shape
//        PLA-I67-1: packs is what the next run carries (the role's default kit when the seat lists none) and own says
//        whether the seat has its own list; own: true with an empty list means the seat carries none (La estantería)
//   GET  /api/company/projects/:slug/team/:agent/oficio   PLA-I67-1: the agent's page (src/api/company-oficio.ts)
//        404 PROJECT_NOT_FOUND | AGENT_NOT_FOUND; 400 UNKNOWN_PACK {packs} | TOO_MANY_PACKS
//   POST /api/company/projects/:slug/team                 {template, packs?, motor?} sets the new member's packs (and PLA-I59-2 motor) too
//   PLA-I67-2: …/team/:agent/skills[/:skill[/state|rollback|duplicate|restore]], …/puesto and …/manner: the owner's
//        skills and «tu manera» (src/api/company-oficio-skills.ts)
//   PLA-I67-3: …/team/:agent/lessons[/:id[/decide]]: lessons, the teach bar's rule, the owner's verdicts
//        (src/api/company-oficio-lessons.ts); a proposal also shows in Te toca as kind leccion (id l-<uuid>)
//   PUT  /api/company/motores  {project, seats?, company?}  PLA-I59-2: the Motores console's save (src/api/company-motores.ts)
import { pedirArreglo } from "./deploy-fix.js";
import { caminoRoutes } from "./company-camino.js";
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "../auth/session.js";
import { withDb } from "../db/client.js";
import { logoBytes, logosRead, refreshLogos } from "../brand/logos.js";
import { marcaFile, marcaRead } from "../brand/marca.js";
import { ToolError } from "../mcp/errors.js";
import { NEW_PROJECT_GOAL_MAX, NEW_PROJECT_NAME_MAX, createProjectFromTemplate } from "../runner/new-project.js";
import { deleteProject } from "../runner/delete-project.js";
import { defaultRepoCheckDeps, type RepoCheckDeps } from "../runner/repo-check.js";
import { projectReadiness, type ReadinessDeps } from "../runner/readiness.js";
import { listConsultas } from "../pedidos/consultas.js";
import { repoSetupRoutes } from "./repo-setup.js";
import { CONTEXT_DOC_IDS, putContextDoc, putLibraryDoc, setAdvanced, setCapture, setCodeLocation, setReleaseStep, setVerifyList, settingsRead, type ContextDocId } from "./project-settings.js";
import { AVANZADO_FIELDS } from "./settings-avanzado.js";
import { askMode, askPo, pickNext, resendRequest, setProjectOptions, startTeammateNow, wakePo } from "./company-actions.js";
import { noteForAgent, resumeRun, stopOneRun } from "./company-runs.js";
import { cancelOrder } from "./company-orders.js";
import { construirPedido, descartarPedido, guardarPedido, pedidoDetail, restaurarPedido } from "./company-pedido.js";
import { ideaDecisionRoutes, ideaDespertar, ideaDetail, ideaRespuesta, ideaVisto } from "./company-idea.js";
import { frameBytes } from "../pedidos/frames.js";
import { promptDoc } from "./company-extra.js";
import { fichaRead, hechoRead, projectDocRead, pulsoRead } from "./company-ficha.js";
import { addTeamMember, companyRead, projectRead, serverTiming, type ReadProfile } from "./company-org.js";
import { setMotores } from "./company-motores.js";
import { checkMotor } from "../mcp/team.js";
import { actOnDecision } from "./company-decisions.js";
import { setCompanyPaused, setProjectPaused, setRunnerSettings } from "../runner/company.js";
import { EFFORTS, MODEL_HINT, isModel } from "../runner/motor.js";
import { checkOwnerCode, enrolOwnerCode, ownerCodeEnrolled } from "../auth/owner-code.js";
import { findProject } from "../mcp/queries.js";
import { projects } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { MAX_PACKS, listPacks, packRef, rolePacks, setRolePacks } from "../runner/packs.js";
import { oficioRead } from "./company-oficio.js";
import { oficioSkillRoutes } from "./company-oficio-skills.js";
import { conexionesRoutes } from "./company-conexiones.js";
import { oficioTrialRoutes } from "./company-oficio-trials.js";
import { oficioLessonRoutes } from "./company-oficio-lessons.js";
import { equipoRoutes } from "./company-equipo.js";
import { teamRoutes } from "./company-teams.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: the company routes' own refusals in the install's language; the Spanish is unchanged.
export const COMPANY_ROUTE_WORDS = defineWords({
  es: { noFrame: "No encontré ese marco." },
  en: { noFrame: "I could not find that frame." },
});

export const companyRoutes = new Hono();

companyRoutes.use("*", async (c, next) => {
  if (/^\s*bearer\b/i.test(c.req.header("Authorization") ?? "")) {
    return c.json({ error: "FORBIDDEN", hint: "the runner's settings and kill switches are the owner's screen only" }, 403);
  }
  if (!verifySession(getCookie(c, SESSION_COOKIE))) return c.json({ error: "UNAUTHORIZED" }, 401);
  await next();
});

function fail(c: Context, e: unknown): Response {
  if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
  throw e;
}

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "INVALID_BODY" }, 400);
  return parsed.data;
}

const Paused = z.object({ paused: z.boolean() }).strict();

// PLA-I32-6: the read contract (src/api/company-org.ts). The runner's plumbing moved to GET /api/machine.
// PLA-74: Server-Timing names the slowest steps (summed over projects), so a slow floor can be read from the browser.
companyRoutes.get("/", async (c) => {
  const prof: ReadProfile = new Map();
  const t0 = performance.now();
  const out = await withDb((db) => companyRead(db, new Date(), prof));
  c.header("Server-Timing", serverTiming(prof, performance.now() - t0));
  return c.json(out);
});

// PLA-I66-1: every project's logo (src/brand/logos.ts). Asking also looks at the repos whose last look is over a
// minute old; a slow look does not hold the screen: it answers with what it has and the event bus brings the rest.
export const LOGO_WAIT_MS = 1500;
companyRoutes.get("/logos", async (c) => {
  const logos = await withDb(async (db) => {
    await Promise.race([refreshLogos(db), new Promise((r) => setTimeout(r, LOGO_WAIT_MS))]);
    return logosRead(db);
  });
  return c.json({ logos });
});

companyRoutes.get("/projects/:slug/logo", async (c) => {
  const r = await withDb((db) => logoBytes(db, c.req.param("slug")));
  if (!r) return c.json({ error: "LOGO_NOT_FOUND" }, 404);
  // The URL carries the version (?v=), so a cached copy is never stale. An SVG is an image here: nothing in it runs.
  return c.body(new Uint8Array(r.bytes), 200, {
    "Content-Type": r.mime,
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  });
});

// PLA-I66-2: the Marca door's read (the original, the checklist of icon files on the start branch, the candidates),
// and a file of the repo the read showed, for the cards. ?fresh=1 reads the repo again now.
companyRoutes.get("/projects/:slug/marca", async (c) => {
  const r = await withDb((db) => marcaRead(db, c.req.param("slug"), { fresh: c.req.query("fresh") === "1" }));
  return r ? c.json(r) : c.json({ error: "PROJECT_NOT_FOUND" }, 404);
});

companyRoutes.get("/projects/:slug/marca/file", async (c) => {
  const r = await withDb((db) => marcaFile(db, c.req.param("slug"), c.req.query("path") ?? ""));
  if (!r) return c.json({ error: "FILE_NOT_FOUND" }, 404);
  return c.body(new Uint8Array(r.bytes), 200, {
    "Content-Type": r.mime,
    "Cache-Control": "private, max-age=60",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  });
});

companyRoutes.get("/projects/:slug", async (c) => {
  try {
    return c.json(await withDb((db) => projectRead(db, c.req.param("slug"))));
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I47-1 (src/api/company-ficha.ts): what La ficha's tabs read (ideas, PRs, docs, lienzos).
companyRoutes.get("/projects/:slug/ficha", async (c) => {
  try {
    return c.json(await withDb((db) => fichaRead(db, c.req.param("slug"), { all: c.req.query("todo") === "1" })));
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I64-3: el pulso, steps done per day (?days=14).
companyRoutes.get("/projects/:slug/pulso", async (c) => {
  try {
    const days = Number(c.req.query("days") ?? 14);
    return c.json(await withDb((db) => pulsoRead(db, c.req.param("slug"), { days: Number.isFinite(days) ? days : 14 })));
  } catch (e) {
    return fail(c, e);
  }
});

// NEWPROJ-4: the readiness list. Reads only. Tests swap the environment, git and the filesystem (setReadinessDeps).
let readinessDeps: ReadinessDeps = {};
export const setReadinessDeps = (d: ReadinessDeps | null): void => {
  readinessDeps = d ?? {};
};

companyRoutes.get("/projects/:slug/readiness", async (c) => {
  try {
    return c.json(await withDb((db) => projectReadiness(db, c.req.param("slug"), readinessDeps)));
  } catch (e) {
    return fail(c, e);
  }
});

// NEWPROJ-6: the Ajustes view (src/api/project-settings.ts). Every write goes through setProject or attachDoc with the
// version the screen read; a body with a key it does not know (a token field, say) is INVALID_BODY.
companyRoutes.get("/projects/:slug/settings", async (c) => {
  try {
    return c.json(await withDb((db) => settingsRead(db, c.req.param("slug"))));
  } catch (e) {
    return fail(c, e);
  }
});

const Version = z.number().int().min(1);
const CodeBody = z.object({ version: Version, repo_path: z.string().max(500).optional(), github_repo: z.string().max(140).optional(), no_code: z.boolean().optional() }).strict();
const ReleaseBody = z
  .object({ version: Version, release: z.object({ from: z.string().max(100), into: z.string().max(100), env: z.string().max(40), mode: z.enum(["command", "merge"]).optional(), prod_migrations: z.enum(["deploy", "owner", "none"]).optional() }).strict().nullable() })
  .strict();
const VerifyBody = z.object({ version: Version, commands: z.array(z.string().max(300)).max(8), no_build: z.string().trim().min(3).max(240).nullable().optional() }).strict();
const ContextBody = z.object({ markdown: z.string().max(60_000), version: Version.optional() }).strict();
// PLA-135: a library doc from Ajustes.
const LibraryBody = z.object({ title: z.string().min(1).max(120), markdown: z.string().max(60_000), version: Version.optional() }).strict();

// PLA-I2-5: preparing the code and the working branch (src/api/repo-setup.ts), behind the same guard.
companyRoutes.route("/", repoSetupRoutes);

companyRoutes.put("/projects/:slug/settings/code", async (c) => {
  const input = await body(c, CodeBody);
  if (input instanceof Response) return input;
  try {
    // The same folder check as creating a project (setNewProjectRepoCheck swaps it in tests).
    const out = await withDb((db) => setCodeLocation(db, c.req.param("slug"), input, newProjectRepoCheck));
    if ("error" in out) {
      const { status, ...rest } = out;
      return c.json(rest, status);
    }
    return c.json(out);
  } catch (e) {
    return fail(c, e);
  }
});

companyRoutes.put("/projects/:slug/settings/release", async (c) => {
  const input = await body(c, ReleaseBody);
  if (input instanceof Response) return input;
  try {
    return c.json(await withDb((db) => setReleaseStep(db, c.req.param("slug"), input)));
  } catch (e) {
    return fail(c, e);
  }
});

companyRoutes.put("/projects/:slug/settings/verify", async (c) => {
  const input = await body(c, VerifyBody);
  if (input instanceof Response) return input;
  try {
    return c.json(await withDb((db) => setVerifyList(db, c.req.param("slug"), input)));
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I2-6: how the app starts, and one «Avanzado» field. A refusal (a secret, a value that is not a variable's name)
// writes nothing.
const CaptureBody = z
  .object({
    version: Version,
    capture: z
      .object({
        start_command: z.string().max(300),
        port: z.number().int(),
        install_command: z.string().max(300).nullable(),
        ready_path: z.string().max(300).nullable(),
        pages: z.array(z.object({ path: z.string().max(300), label: z.string().max(60) }).strict()).max(12),
      })
      .strict()
      .nullable(),
  })
  .strict();
const AdvancedBody = z.object({ version: Version, field: z.enum(AVANZADO_FIELDS), value: z.unknown() }).strict();
const refusalOr = <T extends object>(c: Context, out: T) => {
  if ("error" in out && "status" in out) {
    const { status, ...rest } = out as { status: 400 | 404 | 409 };
    return c.json(rest, status);
  }
  return c.json(out);
};

companyRoutes.put("/projects/:slug/settings/capture", async (c) => {
  const input = await body(c, CaptureBody);
  if (input instanceof Response) return input;
  try {
    return refusalOr(c, await withDb((db) => setCapture(db, c.req.param("slug"), input)));
  } catch (e) {
    return fail(c, e);
  }
});

companyRoutes.put("/projects/:slug/settings/advanced", async (c) => {
  const input = await body(c, AdvancedBody);
  if (input instanceof Response) return input;
  try {
    return refusalOr(c, await withDb((db) => setAdvanced(db, c.req.param("slug"), { version: input.version, field: input.field, value: input.value ?? null })));
  } catch (e) {
    return fail(c, e);
  }
});

companyRoutes.put("/projects/:slug/settings/context/:doc", async (c) => {
  const doc = c.req.param("doc") as ContextDocId;
  if (!(CONTEXT_DOC_IDS as readonly string[]).includes(doc)) return c.json({ error: "DOC_NOT_FOUND", doc }, 404);
  const input = await body(c, ContextBody);
  if (input instanceof Response) return input;
  try {
    return c.json(await withDb((db) => putContextDoc(db, c.req.param("slug"), doc, input)));
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-135: a library doc from Ajustes (create by title, or replace with the version read).
companyRoutes.put("/projects/:slug/settings/docs", async (c) => {
  const input = await body(c, LibraryBody);
  if (input instanceof Response) return input;
  try {
    return refusalOr(c, await withDb((db) => putLibraryDoc(db, c.req.param("slug"), input)));
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I64-6: Hecho, day by day (?hasta=YYYY-MM-DD&dias=14).
companyRoutes.get("/projects/:slug/hecho", async (c) => {
  try {
    const until = c.req.query("hasta");
    const days = Number(c.req.query("dias") ?? 14);
    return c.json(await withDb((db) => hechoRead(db, c.req.param("slug"), { until: until && /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : undefined, days: Number.isFinite(days) ? days : 14 })));
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I35-1 (src/api/company-decisions.ts): act on one Te toca row.
const DecisionBody = z
  .object({
    action: z.enum(["elegir", "responder", "hecho", "aplazar", "aceptar", "fusionar", "cambios", "empezar", "cambiar", "cancelar", "despues", "aplicar", "verificar", "aprobar", "once", "rechazar"]), // PLA-I67-3: a lesson
    option: z.union([z.number().int().min(1).max(20), z.array(z.number().int().min(1).max(20)).min(1).max(5)]).optional(),
    text: z.string().trim().min(1).max(2000).optional(),
    // PLA-I52-6, Devolver a Taller from El Probador: the pins the owner put on the pictures.
    marcas: z
      .array(z.object({ vista: z.string().max(40), side: z.enum(["antes", "despues"]), width: z.enum(["desktop", "phone"]), x: z.number().min(0).max(1), y: z.number().min(0).max(1), note: z.string().max(600) }).strict())
      .max(12)
      .optional(),
    // aplicar: the file and the lines the owner reviewed (a file step).
    path: z.string().trim().min(1).max(300).optional(),
    lines: z.string().min(1).max(20000).optional(),
    // PLA-I46-11, Aprobar el plan: the answer kept for each question (0-based) and the check list as the owner left it.
    answers: z.array(z.number().int().min(0).max(3)).max(3).optional(),
    checklist: z.array(z.string().max(200)).max(3).optional(),
  })
  .strict();

companyRoutes.post("/decisions/:id", async (c) => {
  const input = await body(c, DecisionBody);
  if (input instanceof Response) return input;
  try {
    const out = await withDb((db) => actOnDecision(db, c.req.param("id"), input));
    if ("error" in out) {
      const { status, ...rest } = out;
      return c.json(rest, status);
    }
    return c.json(out);
  } catch (e) {
    return fail(c, e);
  }
});

const PackSlugs = z.array(z.string().trim().min(1).max(40)).max(MAX_PACKS);
const MotorBody = z.object({ model: z.string().max(80).nullable().optional(), effort: z.string().max(20).nullable().optional() }).strict();
// PLA-I59-2: Sumar may give the new seat its own motor (absent: it inherits the company default).
const TeamBody = z.object({ template: z.string().min(1).max(40), packs: PackSlugs.optional(), motor: MotorBody.optional() }).strict();

companyRoutes.post("/projects/:slug/team", async (c) => {
  const input = await body(c, TeamBody);
  if (input instanceof Response) return input;
  const slug = c.req.param("slug");
  const out = await withDb(async (db) => {
    // Unknown packs are refused before anyone is hired.
    if (input.packs?.length) {
      const known = new Set((await listPacks(db)).map((p) => p.slug));
      const unknown = input.packs.filter((s) => !known.has(s));
      if (unknown.length) return { error: "UNKNOWN_PACK" as const, status: 400 as const, hint: `no pack doc for ${unknown.join(", ")}`, packs: unknown };
    }
    // PLA-I59-2: a bad motor is refused before anyone is hired, too.
    if (input.motor) {
      try {
        checkMotor("motor", input.motor);
      } catch (e) {
        if (e instanceof ToolError) return { error: "INVALID_FILTER" as const, status: 400 as const, field: String(e.detail.field ?? ""), hint: String(e.detail.hint ?? "") };
        throw e;
      }
    }
    const hired = await addTeamMember(db, slug, input.template.trim());
    if ("error" in hired) return hired;
    let made = hired;
    if (input.motor) {
      const set = await setMotores(db, { project: slug, seats: [{ agent: hired.agent.agent, motor: input.motor }] });
      if ("error" in set) return set;
      const team = (await projectRead(db, slug)).team;
      made = { agent: team.find((m) => m.agent === hired.agent.agent)!, team };
    }
    if (!input.packs?.length) return made;
    const set = await setRolePacks(db, slug, made.agent.agent, input.packs);
    if ("error" in set) return set;
    const slugs = set.packs.map((x) => x.slug);
    const withPacks = <T extends { agent: string }>(m: T): T => (m.agent === made.agent.agent ? { ...m, packs: slugs } : m);
    return { agent: withPacks(made.agent), team: made.team.map(withPacks), packs: set.packs };
  });
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out, 201);
});

// PLA-I59-2 (Motores): one save for the console (several seats and the company default, all or nothing).
const MotoresBody = z
  .object({
    project: z.string().min(1).max(60),
    // PLA-I60-5: a seat's own «a la vez» (null: del piso).
    seats: z
      .array(z.object({ agent: z.string().min(1).max(60), motor: MotorBody.nullable().optional(), consulta_motor: MotorBody.nullable().optional(), max_parallel: z.number().int().min(1).max(50).nullable().optional() }).strict())
      .max(20)
      .optional(),
    // PLA-I60-5: the project's «Agentes a la vez», «Por agente», «Preguntas a la vez».
    floor: z.object({ max_concurrent: z.number().int().min(0).max(500).optional(), max_per_agent: z.number().int().min(1).max(50).optional(), consulta_slots: z.number().int().min(0).max(20).optional() }).strict().optional(),
    // PLA-I60-5: «Tope de la máquina» (the company ceiling) rides with the company default motor.
    company: MotorBody.extend({ max_concurrent: z.number().int().min(0).max(500).optional() }).strict().optional(),
  })
  .strict();

companyRoutes.put("/motores", async (c) => {
  const input = await body(c, MotoresBody);
  if (input instanceof Response) return input;
  const out = await withDb((db) => setMotores(db, input));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out);
});

companyRoutes.get("/packs", async (c) => c.json({ packs: (await withDb((db) => listPacks(db))).map(packRef) }));

companyRoutes.get("/projects/:slug/team/:agent/packs", async (c) => {
  const out = await withDb((db) => rolePacks(db, c.req.param("slug"), c.req.param("agent")));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out);
});

companyRoutes.get("/projects/:slug/team/:agent/oficio", async (c) => {
  const out = await withDb((db) => oficioRead(db, c.req.param("slug"), c.req.param("agent")));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out);
});

const PacksBody = z.object({ packs: PackSlugs, own: z.boolean().optional() }).strict();

companyRoutes.put("/projects/:slug/team/:agent/packs", async (c) => {
  const input = await body(c, PacksBody);
  if (input instanceof Response) return input;
  const out = await withDb((db) => setRolePacks(db, c.req.param("slug"), c.req.param("agent"), input.packs, process.env, { own: input.own }));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out);
});

companyRoutes.get("/docs/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "DOC_NOT_FOUND" }, 404);
  // PLA-I47-1: ?project=<slug> reads any doc of that one project (La ficha); without it, role prompts and task docs only.
  const project = c.req.query("project");
  try {
    if (project) return c.json(await withDb((db) => projectDocRead(db, project, id)));
    return c.json(await withDb((db) => promptDoc(db, id)));
  } catch (e) {
    return fail(c, e);
  }
});

companyRoutes.post("/switch", async (c) => {
  const input = await body(c, Paused);
  if (input instanceof Response) return input;
  return c.json(await withDb((db) => setCompanyPaused(db, input.paused)));
});

companyRoutes.post("/projects/:slug/switch", async (c) => {
  const input = await body(c, Paused);
  if (input instanceof Response) return input;
  try {
    return c.json(await withDb((db) => setProjectPaused(db, c.req.param("slug"), input.paused)));
  } catch (e) {
    return fail(c, e);
  }
});

const Settings = z
  .object({
    max_concurrent: z.number().int().min(0).max(8).optional(),
    cooldown_minutes: z.number().int().min(0).max(1440).optional(),
    plan_guard_pct: z.number().int().min(0).max(100).optional(),
    guard_override: z.boolean().optional(),
    reserve_tokens: z.number().int().min(0).max(5_000_000).optional(),
    max_turns: z.number().int().min(1).max(500).optional(),
    timeout_minutes: z.number().int().min(1).max(600).optional(),
    // PLA-I59-1: the company's default motor; null clears it.
    default_model: z.string().trim().toLowerCase().refine(isModel, MODEL_HINT).nullable().optional(),
    default_effort: z.enum(EFFORTS).nullable().optional(),
  })
  .strict();

companyRoutes.put("/settings", async (c) => {
  const input = await body(c, Settings);
  if (input instanceof Response) return input;
  return c.json(await withDb((db) => setRunnerSettings(db, input)));
});

// ---- PLA-I36-11: the owner's code

companyRoutes.get("/owner-code", async (c) => c.json({ enrolled: await ownerCodeEnrolled() }));

companyRoutes.post("/owner-code/enroll", async (c) => {
  const input = await body(c, z.object({ password: z.string().min(1).max(200), code: z.string().max(12).optional() }).strict());
  if (input instanceof Response) return input;
  const out = await withDb((db) => enrolOwnerCode(db, input));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out);
});

companyRoutes.delete("/projects/:slug", async (c) => {
  const input = await body(c, z.object({ code: z.string().max(12).optional() }).strict());
  if (input instanceof Response) return input;
  try {
    return await withDb(async (db) => {
      const p = await findProject(db, c.req.param("slug"));
      const refused = await checkOwnerCode(db, input.code);
      if (refused) {
        const { status, ...rest } = refused;
        return c.json(rest, status);
      }
      // NEWPROJ-7: stops its runs, removes its worktrees and its team, then the row (src/runner/delete-project.ts).
      return c.json(await deleteProject(db, p));
    });
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I30-6/7 (src/api/company-actions.ts): Pedirle al PO and Despertar ahora on the project sheet.
// PLA-I54-1: {mode: forma | ya} (default forma); the text grew to 2000 for the side page's textarea.
// PLA-I57-1: mode pregunta asks the PO a question (no task); consulta carries an answer into a forma or ya request.
const AskBody = z
  .object({ text: z.string().trim().min(3).max(2000), kind: z.enum(["cambio", "direccion", "idea"]).optional(), now: z.boolean().optional(), mode: z.enum(["forma", "ya", "pregunta"]).optional(), consulta: z.string().uuid().optional() })
  .strict();

companyRoutes.post("/projects/:slug/ask", async (c) => {
  const input = await body(c, AskBody);
  if (input instanceof Response) return input;
  try {
    const out = await withDb((db) => askPo(db, c.req.param("slug"), input.text, { kind: input.kind, now: input.now, mode: askMode(input), consulta: input.consulta }));
    if ("error" in out) {
      const { status, ...rest } = out;
      return c.json(rest, status);
    }
    return c.json(out, 201);
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I57-1: the project's questions for Pedir's side page (newest first), each with its state, trail and answer.
companyRoutes.get("/projects/:slug/consultas", async (c) => {
  try {
    const out = await withDb(async (db) => {
      const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, c.req.param("slug"))).limit(1);
      return p ? { consultas: await listConsultas(db, p.id) } : null;
    });
    return out ? c.json(out) : c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  } catch (e) {
    return fail(c, e);
  }
});

companyRoutes.post("/projects/:slug/wake", async (c) => {
  try {
    const out = await withDb((db) => wakePo(db, c.req.param("slug")));
    if ("error" in out) {
      const { status, ...rest } = out;
      return c.json(rest, status);
    }
    return c.json(out);
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I40-2: Que empiece ya for one teammate. The body is optional: {past_guard} also passes the plan guard once.
// PLA-165: key starts that step (it must be the teammate's ready work); without it, the teammate's next ready step.
const StartNow = z.object({ past_guard: z.boolean().optional(), key: z.string().trim().min(1).max(40).optional() }).strict();
companyRoutes.post("/projects/:slug/team/:agent/start", async (c) => {
  const raw = await c.req.text();
  let json: unknown = {};
  try {
    if (raw.trim()) json = JSON.parse(raw);
  } catch {
    return c.json({ error: "INVALID_BODY" }, 400);
  }
  const input = StartNow.safeParse(json);
  if (!input.success) return c.json({ error: "INVALID_BODY" }, 400);
  try {
    const out = await withDb((db) => startTeammateNow(db, c.req.param("slug"), c.req.param("agent"), input.data));
    if ("error" in out) {
      const { status, ...rest } = out;
      return c.json(rest, status);
    }
    return c.json(out);
  } catch (e) {
    return fail(c, e);
  }
});

// PLA-I36-9: stop one run, resume it, or tell its agent something. PLA-I36-8: cancel an order.
const send = (c: Context, out: object) => {
  if ("error" in out) {
    const { status, ...rest } = out as unknown as { status: 400 | 404 | 409 };
    return c.json(rest, status);
  }
  return c.json(out);
};
companyRoutes.post("/runs/:id/stop", async (c) => send(c, await withDb((db) => stopOneRun(db, c.req.param("id")))));
companyRoutes.post("/runs/:id/resume", async (c) => send(c, await withDb((db) => resumeRun(db, c.req.param("id")))));
companyRoutes.post("/projects/:slug/tasks/:key/note", async (c) => {
  const input = await body(c, z.object({ text: z.string().trim().min(2).max(1000) }).strict());
  if (input instanceof Response) return input;
  return send(c, await withDb((db) => noteForAgent(db, c.req.param("slug"), c.req.param("key"), input.text)));
});
// PLA-I54-3: the «Pedido» tab (src/api/company-pedido.ts). The note box uses /tasks/:key/note above and the answer box
// POST /api/projects/:slug/questions/:id/answer.
companyRoutes.get("/projects/:slug/pedidos/:key", async (c) => send(c, await withDb((db) => pedidoDetail(db, c.req.param("slug"), c.req.param("key")))));
companyRoutes.post("/projects/:slug/pedidos/:key/guardar", async (c) => send(c, await withDb((db) => guardarPedido(db, c.req.param("slug"), c.req.param("key")))));
companyRoutes.post("/projects/:slug/pedidos/:key/restaurar", async (c) => send(c, await withDb((db) => restaurarPedido(db, c.req.param("slug"), c.req.param("key")))));
// PLA-I54-4: «Constrúyelo».
companyRoutes.post("/projects/:slug/pedidos/:key/construir", async (c) => send(c, await withDb((db) => construirPedido(db, c.req.param("slug"), c.req.param("key")))));
companyRoutes.post("/projects/:slug/pedidos/:key/descartar", async (c) => {
  const raw = await c.req.text();
  let json: unknown = {};
  try {
    if (raw.trim()) json = JSON.parse(raw);
  } catch {
    return c.json({ error: "INVALID_BODY" }, 400);
  }
  const input = z.object({ reason: z.string().trim().max(500).optional() }).strict().safeParse(json);
  if (!input.success) return c.json({ error: "INVALID_BODY" }, 400);
  return send(c, await withDb((db) => descartarPedido(db, c.req.param("slug"), c.req.param("key"), input.data.reason)));
});
// AUDIT-8: the owner's pick on one of the PO's decisions (POST /projects/:slug/ideas/:key/decision).
companyRoutes.route("/", ideaDecisionRoutes);
// PLA-I67-2: the owner's skills and «tu manera» (src/api/company-oficio-skills.ts).
companyRoutes.route("/", oficioSkillRoutes);
companyRoutes.route("/", conexionesRoutes);
// PLA-I67-6: «Traer de un enlace» and «Probar».
companyRoutes.route("/", oficioTrialRoutes);
// PLA-I67-3: an agent's lessons (src/api/company-oficio-lessons.ts).
companyRoutes.route("/", oficioLessonRoutes);
// PLA-I71-3: move, pause, retire and add seats; the owner decides a PO's proposal.
companyRoutes.route("/", equipoRoutes);
// PLA-I71-6: the team catalog and the whole company in a file.
companyRoutes.route("/", teamRoutes);
// PLA-I68: Camino, a project's path from code to people (src/api/company-camino.ts).
companyRoutes.route("/", caminoRoutes);
// PLA-I61 (La idea abierta, src/api/company-idea.ts): any idea, its stops and deliveries; seen, answers, wake, frames.
companyRoutes.get("/projects/:slug/ideas/:key", async (c) => send(c, await withDb((db) => ideaDetail(db, c.req.param("slug"), c.req.param("key")))));
companyRoutes.post("/projects/:slug/ideas/:key/visto", async (c) => {
  const input = await body(c, z.object({ stop: z.string().min(1).max(20) }).strict());
  if (input instanceof Response) return input;
  return send(c, await withDb((db) => ideaVisto(db, c.req.param("slug"), c.req.param("key"), input.stop)));
});
const Answer = z
  .object({
    stop: z.string().min(1).max(20),
    verdict: z.enum(["ok", "deshacer", "cambios", "opcion", "corregir"]),
    text: z.string().trim().max(1000).optional(),
    option: z.number().int().min(1).max(20).optional(),
    notes: z.array(z.object({ frame: z.string().min(1).max(16), x: z.number(), y: z.number(), text: z.string().max(600) }).strict()).max(30).optional(),
  })
  .strict();
companyRoutes.post("/projects/:slug/ideas/:key/respuesta", async (c) => {
  const input = await body(c, Answer);
  if (input instanceof Response) return input;
  return send(c, await withDb((db) => ideaRespuesta(db, c.req.param("slug"), c.req.param("key"), input)));
});
// PLA-I74-8: «Pedir arreglo» on a failed production deploy.
companyRoutes.post("/projects/:slug/initiatives/:key/arreglo", async (c) => send(c, await withDb((db) => pedirArreglo(db, c.req.param("slug"), c.req.param("key")))));
companyRoutes.post("/projects/:slug/ideas/:key/despertar", async (c) => send(c, await withDb((db) => ideaDespertar(db, c.req.param("slug"), c.req.param("key")))));
companyRoutes.get("/projects/:slug/ideas/:key/frames/:id", async (c) => {
  const r = await withDb((db) => frameBytes(db, c.req.param("slug"), c.req.param("key"), c.req.param("id")));
  if (!r) return c.json({ error: "FRAME_NOT_FOUND", hint: say(COMPANY_ROUTE_WORDS).noFrame }, 404);
  return c.body(new Uint8Array(r.bytes), 200, { "Content-Type": r.mime, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
});
// PLA-I40-6: Reenviar a request nobody took (Cerrar is the cancel below).
companyRoutes.post("/projects/:slug/requests/:key/resend", async (c) => send(c, await withDb((db) => resendRequest(db, c.req.param("slug"), c.req.param("key")))));
companyRoutes.post("/projects/:slug/orders/:key/cancel", async (c) => send(c, await withDb((db) => cancelOrder(db, c.req.param("slug"), c.req.param("key")))));

// PLA-I36-6: Cambiar lo siguiente.
companyRoutes.post("/projects/:slug/next", async (c) => {
  const input = await body(c, z.object({ key: z.string().min(1).max(40) }).strict());
  if (input instanceof Response) return input;
  const out = await withDb((db) => pickNext(db, c.req.param("slug"), input.key));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out);
});

// PLA-I36-8/10: plan approval and the preview address.
companyRoutes.put("/projects/:slug/options", async (c) => {
  const input = await body(c, z.object({ plan_approval: z.boolean().optional(), auto_accept: z.boolean().optional(), auto_accept_invisible: z.boolean().optional(), preview_url: z.string().url().regex(/^https?:\/\//).max(300).nullable().optional() }).strict());
  if (input instanceof Response) return input;
  const out = await withDb((db) => setProjectOptions(db, c.req.param("slug"), input));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out);
});

// NEWPROJ-3: where the code is: a folder on this machine (checked before creating), a GitHub repo (owner/name, shape
// only), both, or no_code. Shapes are checked by createProjectFromTemplate so a refusal names its field.
const NewProjectBody = z
  .object({
    name: z.string().min(1).max(NEW_PROJECT_NAME_MAX),
    goal: z.string().min(1).max(NEW_PROJECT_GOAL_MAX),
    repo_path: z.string().max(500).optional(),
    github_repo: z.string().max(140).optional(),
    no_code: z.boolean().optional(),
  })
  .strict();

// NEWPROJ-3: the folder check's git and filesystem; tests swap them (setNewProjectRepoCheck).
let newProjectRepoCheck: RepoCheckDeps = defaultRepoCheckDeps;
export const setNewProjectRepoCheck = (d: RepoCheckDeps | null): void => {
  newProjectRepoCheck = d ?? defaultRepoCheckDeps;
};

companyRoutes.post("/projects", async (c) => {
  const input = await body(c, NewProjectBody);
  if (input instanceof Response) return input;
  const out = await withDb((db) => createProjectFromTemplate(db, input, { repoCheck: newProjectRepoCheck, releaseFromScreen: true }));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out, 201);
});
