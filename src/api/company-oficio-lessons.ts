// PLA-I67-3: an agent's lessons from the Oficio page (src/runner/lessons.ts). Mounted on companyRoutes, so only the
// owner's session cookie reaches them (a Bearer is 403 before any of this runs); every decision here is the owner's.
//   GET  /api/company/projects/:slug/team/:agent/lessons             {lessons: [proposed and active], reading}
//   POST /api/company/projects/:slug/team/:agent/lessons             {text, applies_when?} the teach bar's rule → 201 lesson, active
//   POST /api/company/projects/:slug/team/:agent/lessons/:id/decide  {action: approve | one-off | reject | retire, text?, applies_when?}
//   PUT  /api/company/projects/:slug/team/:agent/lessons/:id         {text?, applies_when?} a new version of an active lesson
// PLA-I67-5:
//   POST …/lessons/:id/repeat   {task_key?, words?} the owner marks that the correction came back
//   POST …/lessons/repeats/:rid {confirm} a reflector suggestion of a repeat, confirmed or dismissed
//   POST …/lessons/:id/merge    {skill: slug | null} into a skill (a new version) or a skill of its own; the lesson retires
//   POST …/lessons/:id/keep     «mantener» on a 90-day retirement proposal
//   decide takes keep: new | old when the lesson clashes with an active one (409 LESSON_CONFLICT without it)
// Errors: 400 LESSON_NOT_ALLOWED | TOO_LARGE, 404 AGENT_NOT_FOUND | LESSON_NOT_FOUND, 409 LESSON_STATE.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { withDb } from "../db/client.js";
import { ToolError } from "../mcp/errors.js";
import { decideLesson, editLesson, lessonsRead, teachRule } from "../runner/lessons.js";
import { confirmRepeat, keepLesson, markRepeat, mergeLesson } from "../runner/lesson-watch.js";
import { seatOf } from "../runner/skills.js";

export const oficioLessonRoutes = new Hono();
const OWNER = { owner: true };

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "INVALID_BODY" }, 400);
  return parsed.data;
}
const act = async (c: Context, run: () => Promise<Response>) => {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
    throw e;
  }
};
const UUID = /^[0-9a-f-]{36}$/i;
const Edit = z.object({ text: z.string().max(2000).optional(), applies_when: z.string().max(400).nullable().optional() }).strict();

oficioLessonRoutes.get("/projects/:slug/team/:agent/lessons", (c) => act(c, async () => c.json(await withDb((db) => lessonsRead(db, c.req.param("slug"), c.req.param("agent"))))));

oficioLessonRoutes.post("/projects/:slug/team/:agent/lessons", async (c) => {
  const input = await body(c, z.object({ text: z.string().max(2000), applies_when: z.string().max(400).nullable().optional() }).strict());
  if (input instanceof Response) return input;
  return act(c, async () => c.json(await withDb((db) => teachRule(db, c.req.param("slug"), c.req.param("agent"), input, OWNER)), 201));
});

oficioLessonRoutes.post("/projects/:slug/team/:agent/lessons/:id/decide", async (c) => {
  const input = await body(c, Edit.extend({ action: z.enum(["approve", "one-off", "reject", "retire"]), keep: z.enum(["new", "old"]).optional() }).strict());
  if (input instanceof Response) return input;
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ error: "LESSON_NOT_FOUND", lesson: id }, 404);
  return act(c, async () =>
    c.json(
      await withDb(async (db) => {
        await seatOf(db, c.req.param("slug"), c.req.param("agent"));
        return decideLesson(db, id, input.action, OWNER, { text: input.text, applies_when: input.applies_when }, new Date(), input.keep);
      }),
    ),
  );
});

oficioLessonRoutes.put("/projects/:slug/team/:agent/lessons/:id", async (c) => {
  const input = await body(c, Edit);
  if (input instanceof Response) return input;
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ error: "LESSON_NOT_FOUND", lesson: id }, 404);
  return act(c, async () => c.json(await withDb((db) => editLesson(db, id, OWNER, input))));
});

const lessonAct = (path: string, schema: z.ZodType, run: (c: Context, id: string, input: never) => Promise<unknown>) =>
  oficioLessonRoutes.post(path, async (c) => {
    const input = await body(c, schema);
    if (input instanceof Response) return input;
    const id = c.req.param("id") ?? c.req.param("rid") ?? "";
    if (!UUID.test(id)) return c.json({ error: "LESSON_NOT_FOUND", lesson: id }, 404);
    return act(c, async () => {
      const out = await run(c, id, input as never);
      return c.json(out ?? { ok: true });
    });
  });

lessonAct("/projects/:slug/team/:agent/lessons/:id/repeat", z.object({ task_key: z.string().max(80).nullable().optional(), words: z.string().max(2000).nullable().optional() }).strict(), (c, id, input: { task_key?: string | null; words?: string | null }) =>
  withDb(async (db) => {
    await seatOf(db, c.req.param("slug")!, c.req.param("agent")!);
    await markRepeat(db, id, OWNER, input);
  }),
);
lessonAct("/projects/:slug/team/:agent/lessons/repeats/:rid", z.object({ confirm: z.boolean() }).strict(), (c, id, input: { confirm: boolean }) => withDb((db) => confirmRepeat(db, id, input.confirm, OWNER)));
lessonAct("/projects/:slug/team/:agent/lessons/:id/merge", z.object({ skill: z.string().max(40).nullable() }).strict(), (c, id, input: { skill: string | null }) =>
  withDb(async (db) => ({ skill: await mergeLesson(db, c.req.param("slug")!, c.req.param("agent")!, id, input.skill, OWNER) })),
);
lessonAct("/projects/:slug/team/:agent/lessons/:id/keep", z.object({}).strict(), (c, id) => withDb((db) => keepLesson(db, id, OWNER)));
