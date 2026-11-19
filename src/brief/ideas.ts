// PLA-I49-6: an idea card's five fates, from the brief (POST /api/brief/act with an idea id, d|<app>|<hash>):
//   keep      the idea becomes a Plania idea (kind idea, Open, stage idea) with its `Idea` doc. 0 tokens.
//   discard   one tap and a reason chip. Stored in brief_actions; when the idea is already a Plania record it closes
//             as Won't do with that reason. Pass B reads the last 60 days of discards and does not propose them again.
//   research  keep, then stage research: the event hook wakes the project's Research.
//   sketch    keep, then a Ready ticket "Sketch: <title>" for the project's Artist and its wake. The idea's stage does
//             not move: the full Design stage still follows Research.
//   plan      Give to PO: Send to Plania (sendToPlania), as before. PLA-I50 makes the PO choose the shape.
// An idea acted on keeps its Plania key in the action's result, so the same card twice makes one record.
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { briefActions, docs, projects, tasks, type MorningBrief } from "../db/schema.js";
import { attachDoc } from "../mcp/docs.js";
import { ToolError } from "../mcp/errors.js";
import { webCtx } from "../mcp/tx.js";
import { createTask, setTask } from "../mcp/writes.js";
import { queueWake, serviceAgent } from "../runner/events.js";
import { homeSlug } from "../runner/threads.js";
import { PlanError, sendToPlania } from "./plan.js";
import { CROSS, type Idea } from "./types.js";
import { ownerEs } from "../owner.js";

export const IDEA_ACTIONS = ["keep", "discard", "research", "sketch", "plan"] as const;
export type IdeaAction = (typeof IDEA_ACTIONS)[number];
export const DISCARD_REASONS = ["not_now", "not_for_product", "exists", "too_big", "costs_money", "other"] as const;
export const DISCARD_DAYS = 60;
const REASON_EN: Record<string, string> = { not_now: "not now", not_for_product: "not for this product", exists: "already exists", too_big: "too big", costs_money: "costs money", other: "other" };
const REASON_ES: Record<string, string> = { not_now: "ahora no", not_for_product: "no es para este producto", exists: "ya existe", too_big: "muy grande", costs_money: "cuesta dinero", other: "otra razón" };
/** How many briefs an idea nobody acted on is shown in before it is dropped. */
export const IDEA_SEEN_MAX = 3;

export const IDEA_INPUT: Record<IdeaAction, z.ZodType<Record<string, unknown>>> = {
  keep: z.object({}).strict(),
  discard: z.object({ reason: z.enum(DISCARD_REASONS), note: z.string().trim().max(300).optional() }).strict(),
  research: z.object({}).strict(),
  sketch: z.object({}).strict(),
  plan: z.object({}).strict(),
};
export const IDEA_LEVEL: Record<IdeaAction, "instant" | "wake"> = { keep: "instant", discard: "instant", research: "wake", sketch: "wake", plan: "wake" };

const ctx = (tool: string) => ({ ...webCtx, tool: `screen.brief_${tool}` });
const isIdeaId = (id: string) => id.startsWith("d|");
export { isIdeaId };

/** The project an idea goes to: its app, or the home project for a cross idea. */
export function ideaProject(idea: Pick<Idea, "app">, env: NodeJS.ProcessEnv = process.env): string {
  return idea.app === CROSS ? homeSlug(env) : idea.app;
}

export function ideaDoc(idea: Pick<Idea, "title" | "why" | "source" | "flags">, lang: string): string {
  const es = lang === "es";
  return [
    `# Idea: ${idea.title}`,
    "",
    `## Problem`,
    idea.why,
    "",
    `## Who it is for`,
    es ? `Los usuarios de ${idea.source}.` : `The people who use ${idea.source}.`,
    "",
    `## Why now`,
    idea.why,
    ...(idea.flags?.length ? ["", `Flags: ${idea.flags.join(", ")}`] : []),
    "",
    es ? "Guardada desde el brief de la mañana." : "Kept from the morning brief.",
  ].join("\n");
}

/** The Plania idea a card already became (an earlier keep, research or sketch), or an Open idea with its title. */
export async function ideaRecord(db: Db, idea: Pick<Idea, "id" | "title" | "app">, env: NodeJS.ProcessEnv = process.env): Promise<{ key: string; status: string; stage: string | null; project: string } | null> {
  const [prior] = await db
    .select({ result: sql<Record<string, unknown>>`${briefActions.outcome}->'result'` })
    .from(briefActions)
    .where(and(eq(briefActions.itemId, idea.id), isNull(briefActions.undoneAt), inArray(briefActions.action, ["keep", "research", "sketch"]), sql`${briefActions.outcome}->>'status' = 'done'`))
    .orderBy(desc(briefActions.createdAt))
    .limit(1);
  const slug = ideaProject(idea, env);
  const [p] = await db.select({ id: projects.id, slug: projects.slug }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return null;
  const key = typeof prior?.result?.key === "string" ? prior.result.key : null;
  const where = key
    ? and(eq(tasks.projectId, p.id), eq(tasks.key, key))
    : and(eq(tasks.projectId, p.id), eq(tasks.kind, "idea"), eq(tasks.status, "Open"), sql`lower(${tasks.title}) = lower(${idea.title})`);
  const [t] = await db.select({ key: tasks.key, status: tasks.status, stage: tasks.stage }).from(tasks).where(where).limit(1);
  return t ? { ...t, project: p.slug } : null;
}

async function keep(db: Db, idea: Idea, lang: string, env: NodeJS.ProcessEnv): Promise<{ key: string; project: string; created: boolean; stage: string | null }> {
  const have = await ideaRecord(db, idea, env);
  if (have && have.status === "Open") return { key: have.key, project: have.project, created: false, stage: have.stage };
  const project = ideaProject(idea, env);
  const made = (await createTask(db, { project, kind: "idea", title: idea.title, summary: idea.why } as never, ctx("keep"))) as { key: string };
  await attachDoc(db, { project, key: made.key, title: "Idea", markdown: ideaDoc(idea, lang) }, ctx("keep"));
  return { key: made.key, project, created: true, stage: "idea" };
}

export type IdeaOutcome = { line: string; result: Record<string, unknown> } | { error: string; hint: string };

export async function runIdea(db: Db, brief: MorningBrief, idea: Idea, action: IdeaAction, input: Record<string, unknown>, lang: string, env: NodeJS.ProcessEnv = process.env): Promise<IdeaOutcome> {
  const es = lang === "es";
  try {
    if (action === "keep") {
      const k = await keep(db, idea, lang, env);
      return { line: es ? `Guardada en Plania: ${k.key}` : `Kept in Plania: ${k.key}`, result: { ...k, title: idea.title, app: idea.app } };
    }
    if (action === "discard") {
      const have = await ideaRecord(db, idea, env);
      const reason = String(input.reason);
      if (have && have.status === "Open") {
        const [t] = await db.select().from(tasks).where(and(eq(tasks.key, have.key))).limit(1);
        await setTask(db, { project: have.project, key: have.key, status: "Won't do", version: t!.version, reason: `Descartada desde el brief: ${reason}${input.note ? ` (${input.note})` : ""}` } as never, ctx("discard"));
      }
      const words = (es ? REASON_ES : REASON_EN)[reason] ?? reason;
      return { line: es ? `Descartada: ${words}` : `Discarded: ${words}`, result: { title: idea.title, app: idea.app, reason, note: input.note ?? null, key: have?.key ?? null } };
    }
    if (action === "research") {
      const k = await keep(db, idea, lang, env);
      if (k.stage === "idea") {
        const [t] = await db.select().from(tasks).where(eq(tasks.key, k.key)).limit(1);
        // The stage move wakes the project's Research (src/runner/events.ts); a paused project's waits.
        await setTask(db, { project: k.project, key: k.key, stage: "research", version: t!.version } as never, ctx("research"));
      }
      return { line: es ? `A Research: ${k.key}` : `To Research: ${k.key}`, result: { ...k, stage: "research", title: idea.title, app: idea.app } };
    }
    if (action === "sketch") {
      const k = await keep(db, idea, lang, env);
      const [p] = await db.select().from(projects).where(eq(projects.slug, k.project)).limit(1);
      const artist = p ? await serviceAgent(db, "artist", p) : null;
      if (!artist) return { error: "NO_ARTIST", hint: es ? "Este proyecto no tiene Artist." : "This project has no Artist." };
      const ticket = (await createTask(
        db,
        {
          project: k.project,
          title: `Sketch: ${idea.title}`.slice(0, 200),
          status: "Ready",
          origin: "owner",
          work_type: "research",
          priority: "P2",
          owner_agent: artist.slug,
          scope: [
            `Pedido ${ownerEs("de")} desde el brief de la mañana: un boceto de la idea ${k.key} ("${idea.title}").`,
            "",
            idea.why,
            "",
            `Una pantalla y sus estados principales (vacío, error, cargando), en un canvas o artifact. Pon el enlace en un doc titulado \`Sketch\` en la idea ${k.key}. El boceto no mueve la etapa de la idea: el Diseño completo sigue después de Research.`,
          ].join("\n"),
          checks: [`El doc Sketch en ${k.key} tiene el enlace al boceto`],
        } as never,
        ctx("sketch"),
      )) as { key: string };
      const [t] = await db.select({ id: tasks.id, key: tasks.key }).from(tasks).where(and(eq(tasks.projectId, p!.id), eq(tasks.key, ticket.key))).limit(1);
      // An Artist-owned Ready ticket wakes nobody by itself: queue its wake (held while the project is paused;
      // turning runs on wakes it then, once).
      const wake = await queueWake(db, p!, t!, { agent: artist, taskKey: ticket.key, reason: `sketch from the morning brief: ${idea.title}` }, "brief.sketch");
      return { line: es ? `A Artist: ${ticket.key}` : `To Artist: ${ticket.key}`, result: { ...k, ticket: ticket.key, agent: artist.slug, wake: wake.kind === "queued" ? "queued" : wake.reason, title: idea.title, app: idea.app } };
    }
    // plan: Send to Plania, as V1.
    const sent = await sendToPlania(db, { briefId: brief.id, codes: [idea.code] }, { env });
    return { line: es ? "Al PO para que la planee" : "To the PO to plan it", result: { request_id: sent.request_id, title: idea.title, app: idea.app, code: idea.code } };
  } catch (e) {
    if (e instanceof ToolError) return { error: e.code, hint: String((e.detail as { hint?: string } | undefined)?.hint ?? e.code) };
    if (e instanceof PlanError) return { error: e.code, hint: e.code };
    throw e;
  }
}

/** For pass B: ideas discarded in the last 60 days, with their reason (newest first, one per title). */
export async function discardedIdeas(db: Db, now: Date = new Date()): Promise<{ app: string; title: string; reason: string; note: string | null }[]> {
  const since = new Date(now.getTime() - DISCARD_DAYS * 86_400_000);
  const rows = await db
    .select({ outcome: briefActions.outcome })
    .from(briefActions)
    .where(and(eq(briefActions.action, "discard"), isNull(briefActions.undoneAt), gte(briefActions.createdAt, since), sql`${briefActions.outcome}->>'status' = 'done'`))
    .orderBy(desc(briefActions.createdAt))
    .limit(200);
  const seen = new Set<string>();
  const out: { app: string; title: string; reason: string; note: string | null }[] = [];
  for (const r of rows) {
    const x = (r.outcome.result ?? {}) as { app?: string; title?: string; reason?: string; note?: string | null };
    if (!x.title || seen.has(x.title.toLowerCase())) continue;
    seen.add(x.title.toLowerCase());
    out.push({ app: x.app ?? "", title: x.title, reason: x.reason ?? "other", note: x.note ?? null });
  }
  return out;
}

// PLA-I51-4: promoted_to is the initiative the idea became (null while it is still open work); the page lists only
// the ones without it under "Ya en Plania" and counts the rest.
export type IdeaInMotion = { project: string; key: string; title: string; stage: string | null; next: "sketch_ready" | "research_ready" | "planned" | "in_motion"; sketch: boolean; research: boolean; doc_url: string | null; promoted_to: string | null };

/** Open Plania ideas of the brief's projects: their stage, and whether a Sketch or Research doc came back. */
export async function ideasInMotion(db: Db, slugs: string[]): Promise<IdeaInMotion[]> {
  if (!slugs.length) return [];
  const rows = await db
    .select({ key: tasks.key, title: tasks.title, stage: tasks.stage, id: tasks.id, project: projects.slug, promoted: tasks.promotedTo })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.kind, "idea"), eq(tasks.status, "Open"), inArray(projects.slug, slugs)))
    // Ideas not planned yet first, so the limit never pushes them out behind planned ones.
    .orderBy(sql`${tasks.promotedTo} is not null`, desc(tasks.updatedAt))
    .limit(30);
  const ids = rows.map((r) => r.id);
  const docRows = ids.length ? await db.select({ taskId: docs.taskId, title: docs.title, markdown: docs.markdown }).from(docs).where(inArray(docs.taskId, ids)) : [];
  return rows.map((r) => {
    const mine = docRows.filter((d) => d.taskId === r.id);
    const sketch = mine.find((d) => d.title === "Sketch");
    const research = mine.some((d) => d.title === "Research");
    const url = sketch?.markdown.match(/https?:\/\/\S+/)?.[0]?.replace(/[).,]+$/, "") ?? null;
    const next = r.promoted ? "planned" : sketch ? "sketch_ready" : research ? "research_ready" : "in_motion";
    return { project: r.project, key: r.key, title: r.title, stage: r.stage, next, sketch: !!sketch, research, doc_url: url, promoted_to: r.promoted ?? null };
  });
}

/** How many earlier briefs (newest first, up to IDEA_SEEN_MAX) already showed each idea id. */
export async function ideaSeen(db: Db, beforeDate: string): Promise<Map<string, number>> {
  const prev = await db.execute<{ data: { ideas?: { id?: string }[] } }>(sql`
    select distinct on (local_date) data from morning_briefs where local_date < ${beforeDate} order by local_date desc, generated_at desc limit ${IDEA_SEEN_MAX}`);
  const out = new Map<string, number>();
  for (const b of prev.rows) for (const i of b.data.ideas ?? []) if (i.id) out.set(i.id, (out.get(i.id) ?? 0) + 1);
  return out;
}

/** Idea ids the owner already acted on (any fate): they leave Today's ideas. */
export async function actedIdeaIds(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ id: briefActions.itemId })
    .from(briefActions)
    .where(and(sql`${briefActions.itemId} like 'd|%'`, isNull(briefActions.undoneAt), sql`${briefActions.outcome}->>'status' = 'done'`));
  return new Set(rows.map((r) => r.id));
}

/** Keys of Plania objects a brief row was already acted on (so a "look at the sketch" row does not come back daily). */
export async function actedTargetKeys(db: Db): Promise<Set<string>> {
  const rows = await db.execute<{ key: string }>(sql`
    select distinct target->>'key' as key from brief_actions
    where target->>'key' is not null and undone_at is null and outcome->>'status' = 'done'`);
  return new Set(rows.rows.map((r) => r.key));
}
