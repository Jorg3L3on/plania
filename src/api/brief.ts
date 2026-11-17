// PLA-I41-6: the Morning brief API (spec §7.3), behind the plania_session cookie (mounted after the session check in
// routes.ts). latest / history / :date read morning_briefs; run starts the pipeline (Generate now, pnpm brief:run);
// checks/:itemId checks and unchecks an item or idea; settings reads and saves brief_settings (PLA-I42-4 adds the
// per-project rows); personas/:slug reads and saves a project's "Idea persona" doc; doctor is the sheet's read-only
// Setup check (pnpm brief:doctor without the claude dry run, which uses the owner's plan). plan and plan/:id are
// Send to Plania (PLA-I43). Nothing here returns a token, an env value or a log's content.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb, type Db } from "../db/client.js";
import type { MorningBrief } from "../db/schema.js";
import { AUTH_PREFIX, BriefRunningError, localDateIn, runningRun, startBrief, type RunBriefDeps } from "../brief/pipeline.js";
import { IDEA_PERSONA_DOC } from "../brief/prompts.js";
import { plainBrief } from "../brief/plain.js";
import { runDoctor } from "../brief/doctor.js";
import { act, ActBody, briefState, undo, type ActError } from "../brief/act.js";
import { MAX_CODES, PlanError, planOfBrief, planProgress, sendToPlania } from "../brief/plan.js";
import { BriefSettingsError, briefProjects, loadBriefSettings, resolveBriefSettings, saveBriefSettings } from "../brief/settings.js";
import { attachDoc } from "../mcp/docs.js";
import { ToolError } from "../mcp/errors.js";
import { webCtx } from "../mcp/tx.js";
import { writeVia } from "../runner/limits.js";
import { liveRuns } from "../runner/runner.js";
import { homeSlug } from "../runner/threads.js";
import { readerOf } from "../store/port.js";
import { gte } from "../store/types.js";

export const briefApi = new Hono();

// Tests: a fake spawnPass, clock and liveRuns for POST /run. Never set outside tests.
let runDeps: RunBriefDeps = {};
let planEnv: NodeJS.ProcessEnv = process.env;
export function setBriefApiDepsForTests(deps: RunBriefDeps): void {
  runDeps = deps;
  planEnv = deps.env ?? process.env;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ITEM_ID = /^[id]\|[a-z0-9][a-z0-9-]{0,62}\|[0-9a-f]{12}$/;

type Item = { id?: unknown; status?: unknown };
const itemsOf = (b: MorningBrief): Item[] => (Array.isArray(b.data.items) ? (b.data.items as Item[]) : []);
const ideasOf = (b: MorningBrief): Item[] => (Array.isArray(b.data.ideas) ? (b.data.ideas as Item[]) : []);

const briefOut = (b: MorningBrief) => ({ id: b.id, local_date: b.localDate, generated_at: b.generatedAt.toISOString(), trigger: b.trigger, mode: b.mode, data: plainBrief(b.data) });

/** The checked ids among this brief's items and ideas. */
async function checksFor(db: Db, b: MorningBrief | null): Promise<string[]> {
  if (!b) return [];
  const ids = [...itemsOf(b), ...ideasOf(b)].map((i) => i.id).filter((id): id is string => typeof id === "string");
  if (!ids.length) return [];
  const rows = await readerOf(db).find("briefChecks", { itemId: ids });
  return rows.map((r) => r.itemId).sort();
}

/** The newest brief, or the newest of one local date. */
async function newestBrief(db: Db, localDate?: string): Promise<MorningBrief | undefined> {
  const [b] = await readerOf(db).find("morningBriefs", localDate ? { localDate } : {}, { orderBy: [{ column: "generatedAt", desc: true }], limit: 1 });
  return b;
}

async function runState(db: Db) {
  const run = await runningRun(db);
  if (!run) return null;
  // "Waiting for the current build": the run is waiting and a runner run is live.
  return { id: run.id, status: run.status, started_at: run.started_at.toISOString(), waiting_for_build: run.status === "waiting" && liveRuns().length > 0 };
}

/** PLA-33: the last finished run when it failed after the brief on screen was made: the page says so over the kept brief. */
async function lastFailedRun(db: Db, b: MorningBrief | null) {
  const [r] = (await readerOf(db).find("briefRuns", {}, { orderBy: [{ column: "startedAt", desc: true }] })).filter((x) => x.status !== "waiting" && x.status !== "running");
  if (!r || r.status !== "fail" || !r.endedAt || (b && r.endedAt <= b.generatedAt)) return null;
  const auth = r.summary.startsWith(AUTH_PREFIX);
  return { status: r.status, kind: auth ? ("auth" as const) : ("other" as const), reason: auth ? r.summary.slice(AUTH_PREFIX.length) : r.summary, ended_at: r.endedAt.toISOString() };
}

briefApi.get("/latest", (c) =>
  withDb(async (db) => {
    const b = await newestBrief(db);
    // plan_id: this brief's Send to Plania request, so the page shows its progress after a reload (PLA-I43).
    // home_project: where cross-app (X) ideas are planned, for the page's "This wakes N project bots" line.
    return c.json({
      brief: b ? briefOut(b) : null,
      checks: await checksFor(db, b ?? null),
      run: await runState(db),
      last_run: await lastFailedRun(db, b ?? null),
      plan_id: b ? await planOfBrief(db, b.id) : null,
      home_project: homeSlug(planEnv),
    });
  }),
);

briefApi.get("/history", async (c) => {
  const raw = c.req.query("days") ?? "14";
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1 || Number(raw) > 90) return c.json({ error: "INVALID_DAYS", hint: "days is 1 to 90" }, 400);
  const days = Number(raw);
  return withDb(async (db) => {
    const s = resolveBriefSettings(await loadBriefSettings(db));
    const from = localDateIn(new Date(Date.now() - (days - 1) * 86_400_000), s.timezone);
    const rows = await readerOf(db).find("morningBriefs", { localDate: gte(from) }, { orderBy: [{ column: "localDate", desc: true }, { column: "generatedAt", desc: true }] });
    // The newest brief of each date.
    const seen = new Set<string>();
    const out = [];
    for (const b of rows) {
      if (seen.has(b.localDate)) continue;
      seen.add(b.localDate);
      const items = itemsOf(b);
      out.push({
        id: b.id,
        local_date: b.localDate,
        generated_at: b.generatedAt.toISOString(),
        mode: b.mode,
        needs: items.filter((i) => i.status === "needs_you" || i.status === "blocker").length,
        next: items.filter((i) => i.status === "next" || i.status === "open_pr").length,
        ideas: ideasOf(b).length,
      });
    }
    return c.json(out);
  });
});

const runBody = z
  .object({
    passes: z.array(z.enum(["brief", "ideas"])).min(1).max(2).optional(),
    // pnpm brief:run says cli; the page says nothing (manual).
    trigger: z.enum(["manual", "cli"]).optional(),
  })
  .strict();

briefApi.post("/run", async (c) => {
  const text = await c.req.text();
  let body: unknown = {};
  if (text.trim()) {
    if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
    try {
      body = JSON.parse(text);
    } catch {
      return c.json({ error: "INVALID_BODY" }, 400);
    }
  }
  const parsed = runBody.safeParse(body);
  if (!parsed.success) return c.json({ error: "INVALID_BODY", hint: 'passes is ["brief"], ["ideas"] or both' }, 400);
  const passes = parsed.data.passes ? [...new Set(parsed.data.passes)] : undefined;
  return withDb(async (db) => {
    try {
      const { runId, done } = await startBrief(db, { trigger: parsed.data.trigger ?? "manual", passes }, runDeps);
      // The run goes on in the background; done never rejects.
      void done;
      return c.json({ run_id: runId }, 202);
    } catch (err) {
      if (err instanceof BriefRunningError) return c.json({ error: "BRIEF_RUNNING", run_id: err.runId }, 409);
      throw err;
    }
  });
});

function itemParam(c: Context): string | Response {
  const id = c.req.param("itemId") ?? "";
  return ITEM_ID.test(id) ? id : c.json({ error: "INVALID_ITEM_ID" }, 400);
}

briefApi.put("/checks/:itemId", async (c) => {
  const id = itemParam(c);
  if (id instanceof Response) return id;
  // Checking twice keeps the first check.
  await withDb((db) => writeVia(db, async (uow) => ((await uow.get("briefChecks", { itemId: id })) ? undefined : uow.insert("briefChecks", { itemId: id }))));
  return c.json({ item_id: id, checked: true });
});

briefApi.delete("/checks/:itemId", async (c) => {
  const id = itemParam(c);
  if (id instanceof Response) return id;
  await withDb((db) => writeVia(db, (uow) => uow.delete("briefChecks", { itemId: id })));
  return c.json({ item_id: id, checked: false });
});

async function settingsOut(db: Db) {
  const settings = await loadBriefSettings(db);
  const r = resolveBriefSettings(settings);
  const all = await readerOf(db).find("projects");
  const slugOf = new Map(all.map((p) => [p.id, p.slug]));
  const personas = (await readerOf(db).find("docs", { taskId: null, title: IDEA_PERSONA_DOC }))
    .filter((d) => slugOf.has(d.projectId))
    .map((d) => ({ project: slugOf.get(d.projectId)!, doc_id: d.id }))
    .sort((a, b) => (a.project < b.project ? -1 : a.project > b.project ? 1 : 0));
  // PLA-I42-4: the per-project rows the sheet shows (every project, brief order, resolved letter and include flags).
  const rows = briefProjects(all, settings).map((p) => ({ slug: p.slug, name: p.name, key_prefix: p.key_prefix, letter: p.letter, order: p.order, include: p.include, include_ideas: p.include_ideas }));
  return { settings, resolved: { timezone: r.timezone, timezone_label: r.timezone_label, owner_name: r.owner_name }, personas, projects: rows };
}

briefApi.get("/settings", (c) => withDb(async (db) => c.json(await settingsOut(db))));

briefApi.put("/settings", async (c) => {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const body = await c.req.json().catch(() => undefined);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "INVALID_BODY" }, 400);
  return withDb(async (db) => {
    try {
      await saveBriefSettings(db, body);
    } catch (err) {
      if (err instanceof BriefSettingsError) return c.json({ error: "INVALID_SETTINGS", issues: err.issues }, 400);
      throw err;
    }
    return c.json(await settingsOut(db));
  });
});

// PLA-I42-4: a project's "Idea persona" doc for the sheet's "Edit persona". GET gives {doc_id, markdown, version}
// (null fields when the project has none); PUT {markdown, version?} creates it, or saves it when version matches.
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PersonaBody = z.object({ markdown: z.string().max(20_000), version: z.number().int().positive().optional() });

briefApi.get("/personas/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!SLUG.test(slug)) return c.json({ error: "INVALID_SLUG" }, 400);
  return withDb(async (db) => {
    const p = await readerOf(db).get("projects", { slug });
    if (!p) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
    const d = await readerOf(db).get("docs", { projectId: p.id, taskId: null, title: IDEA_PERSONA_DOC });
    return c.json({ project: slug, doc_id: d?.id ?? null, markdown: d?.markdown ?? "", version: d?.version ?? null });
  });
});

briefApi.put("/personas/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!SLUG.test(slug)) return c.json({ error: "INVALID_SLUG" }, 400);
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const body = PersonaBody.safeParse(await c.req.json().catch(() => undefined));
  if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
  return withDb(async (db) => {
    try {
      const { doc } = await attachDoc(db, { project: slug, title: IDEA_PERSONA_DOC, markdown: body.data.markdown, version: body.data.version }, { ...webCtx, tool: "screen.brief_persona" });
      return c.json({ project: slug, doc_id: doc.id, markdown: doc.markdown, version: doc.version });
    } catch (err) {
      if (err instanceof ToolError) return c.json({ error: err.code, ...err.detail }, err.status);
      throw err;
    }
  });
});

// PLA-I42-4 / PLA-I44-2: the read-only "Setup check" at the bottom of the settings sheet (spec §8, §9). The same lines as
// pnpm brief:doctor, without the claude dry run (that one uses the owner's plan; the doctor command runs it).
briefApi.get("/doctor", (c) =>
  withDb(async (db) => {
    const lines = await runDoctor(db, { skipClaudeRun: true, ...(runDeps.env ? { env: runDeps.env } : {}) });
    return c.json({ ok: lines.every((l) => l.ok), lines });
  }),
);


// Send to Plania (D3, D7): POST plan groups the chosen codes by project, posts "Plan these ideas" in each project
// thread and queues each PO's wake (PLA-I43-1); GET plan/:id is the progress per target and per idea.
const PlanBody = z.object({ brief_id: z.string().min(1).max(64), codes: z.array(z.string().max(20)).min(1).max(MAX_CODES) });
const planError = (c: Context, err: unknown) => {
  if (err instanceof PlanError) return c.json({ error: err.code, ...err.detail }, err.status);
  throw err;
};

briefApi.post("/plan", async (c) => {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const body = PlanBody.safeParse(await c.req.json().catch(() => undefined));
  if (!body.success) return c.json({ error: "INVALID_BODY", hint: "{brief_id, codes: [\"W1\", \"Z3\"]}" }, 400);
  return withDb(async (db) => {
    try {
      return c.json(await sendToPlania(db, { briefId: body.data.brief_id, codes: body.data.codes }, { env: planEnv }), 202);
    } catch (err) {
      return planError(c, err);
    }
  });
});

briefApi.get("/plan/:id", (c) =>
  withDb(async (db) => {
    try {
      return c.json(await planProgress(db, c.req.param("id")));
    } catch (err) {
      return planError(c, err);
    }
  }),
);

// PLA-I49-3: act on a row (src/brief/act.ts). The screen's cookie only: a request that carries any Bearer token is
// refused, so no agent, CI or MCP token can publish, merge or answer through the brief (PLA-24's guard).
const bearer = (c: Context) => /^\s*bearer\b/i.test(c.req.header("Authorization") ?? "");
const actError = (c: Context, e: ActError) => c.json({ error: e.error, hint: e.hint }, e.http);

briefApi.post("/act", async (c) => {
  if (bearer(c)) return c.json({ error: "HUMAN_ONLY", hint: "brief actions come from the screen only" }, 403);
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const body = ActBody.safeParse(await c.req.json().catch(() => undefined));
  if (!body.success) return c.json({ error: "INVALID_BODY", hint: "{brief_id, item_id, action, target?, input?, request_id}" }, 400);
  return withDb(async (db) => {
    const out = await act(db, body.data, planEnv);
    if ("http" in out) return actError(c, out);
    return c.json(out, out.status === "failed" ? 409 : 200);
  });
});

briefApi.post("/act/:id/undo", async (c) => {
  if (bearer(c)) return c.json({ error: "HUMAN_ONLY", hint: "brief actions come from the screen only" }, 403);
  return withDb(async (db) => {
    const out = await undo(db, c.req.param("id"), planEnv);
    if ("http" in out) return actError(c, out);
    return c.json(out);
  });
});

briefApi.get("/:id/state", (c) =>
  withDb(async (db) => {
    const id = c.req.param("id");
    const out = /^[0-9a-f-]{36}$/i.test(id) ? await briefState(db, id, planEnv) : null;
    return out ? c.json(out) : c.json({ error: "NOT_FOUND" }, 404);
  }),
);

briefApi.get("/:date", async (c) => {
  const date = c.req.param("date");
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return c.json({ error: "NOT_FOUND" }, 404);
  return withDb(async (db) => {
    const b = await newestBrief(db, date);
    if (!b) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ brief: briefOut(b), checks: await checksFor(db, b) });
  });
});
