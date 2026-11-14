// PLA-I41-6: the Morning brief API (spec §7.3), behind the plania_session cookie (mounted after the session check in
// routes.ts). latest / history / :date read morning_briefs; run starts the pipeline (Generate now, pnpm brief:run);
// checks/:itemId checks and unchecks an item or idea; settings reads and saves brief_settings. The Send to Plania
// routes (plan, plan/:id) answer 501 until Morning brief C (PLA-I43). Nothing here returns a token, an env value
// or a log's content.
import { Hono, type Context } from "hono";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withDb, type Db } from "../db/client.js";
import { briefChecks, docs, morningBriefs, projects, type MorningBrief } from "../db/schema.js";
import { BriefRunningError, localDateIn, runningRun, startBrief, type RunBriefDeps } from "../brief/pipeline.js";
import { IDEA_PERSONA_DOC } from "../brief/prompts.js";
import { BriefSettingsError, loadBriefSettings, resolveBriefSettings, saveBriefSettings } from "../brief/settings.js";
import { liveRuns } from "../runner/runner.js";

export const briefApi = new Hono();

// Tests: a fake spawnPass, clock and liveRuns for POST /run. Never set outside tests.
let runDeps: RunBriefDeps = {};
export function setBriefApiDepsForTests(deps: RunBriefDeps): void {
  runDeps = deps;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ITEM_ID = /^[id]\|[a-z0-9][a-z0-9-]{0,62}\|[0-9a-f]{12}$/;

type Item = { id?: unknown; status?: unknown };
const itemsOf = (b: MorningBrief): Item[] => (Array.isArray(b.data.items) ? (b.data.items as Item[]) : []);
const ideasOf = (b: MorningBrief): Item[] => (Array.isArray(b.data.ideas) ? (b.data.ideas as Item[]) : []);

const briefOut = (b: MorningBrief) => ({ id: b.id, local_date: b.localDate, generated_at: b.generatedAt.toISOString(), trigger: b.trigger, mode: b.mode, data: b.data });

/** The checked ids among this brief's items and ideas. */
async function checksFor(db: Db, b: MorningBrief | null): Promise<string[]> {
  if (!b) return [];
  const ids = [...itemsOf(b), ...ideasOf(b)].map((i) => i.id).filter((id): id is string => typeof id === "string");
  if (!ids.length) return [];
  const rows = await db.select({ id: briefChecks.itemId }).from(briefChecks).where(inArray(briefChecks.itemId, ids));
  return rows.map((r) => r.id).sort();
}

async function runState(db: Db) {
  const run = await runningRun(db);
  if (!run) return null;
  // "Waiting for the current build": the run is waiting and a runner run is live.
  return { id: run.id, status: run.status, started_at: run.started_at.toISOString(), waiting_for_build: run.status === "waiting" && liveRuns().length > 0 };
}

briefApi.get("/latest", (c) =>
  withDb(async (db) => {
    const [b] = await db.select().from(morningBriefs).orderBy(desc(morningBriefs.generatedAt)).limit(1);
    return c.json({ brief: b ? briefOut(b) : null, checks: await checksFor(db, b ?? null), run: await runState(db) });
  }),
);

briefApi.get("/history", async (c) => {
  const raw = c.req.query("days") ?? "14";
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1 || Number(raw) > 90) return c.json({ error: "INVALID_DAYS", hint: "days is 1 to 90" }, 400);
  const days = Number(raw);
  return withDb(async (db) => {
    const s = resolveBriefSettings(await loadBriefSettings(db));
    const from = localDateIn(new Date(Date.now() - (days - 1) * 86_400_000), s.timezone);
    const rows = await db.select().from(morningBriefs).where(gte(morningBriefs.localDate, from)).orderBy(desc(morningBriefs.localDate), desc(morningBriefs.generatedAt));
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
  await withDb((db) => db.insert(briefChecks).values({ itemId: id }).onConflictDoNothing());
  return c.json({ item_id: id, checked: true });
});

briefApi.delete("/checks/:itemId", async (c) => {
  const id = itemParam(c);
  if (id instanceof Response) return id;
  await withDb((db) => db.delete(briefChecks).where(eq(briefChecks.itemId, id)));
  return c.json({ item_id: id, checked: false });
});

async function settingsOut(db: Db) {
  const settings = await loadBriefSettings(db);
  const r = resolveBriefSettings(settings);
  const personas = await db
    .select({ project: projects.slug, doc_id: docs.id })
    .from(docs)
    .innerJoin(projects, eq(projects.id, docs.projectId))
    .where(and(isNull(docs.taskId), eq(docs.title, IDEA_PERSONA_DOC)))
    .orderBy(projects.slug);
  return { settings, resolved: { timezone: r.timezone, timezone_label: r.timezone_label, owner_name: r.owner_name }, personas };
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

// Send to Plania (D3) is Morning brief C (PLA-I43).
const notYet = (c: Context) => c.json({ error: "NOT_IMPLEMENTED", hint: "Send to Plania comes with Morning brief C" }, 501);
briefApi.post("/plan", notYet);
briefApi.get("/plan/:id", notYet);

briefApi.get("/:date", async (c) => {
  const date = c.req.param("date");
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return c.json({ error: "NOT_FOUND" }, 404);
  return withDb(async (db) => {
    const [b] = await db.select().from(morningBriefs).where(eq(morningBriefs.localDate, date)).orderBy(desc(morningBriefs.generatedAt)).limit(1);
    if (!b) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ brief: briefOut(b), checks: await checksFor(db, b) });
  });
});
