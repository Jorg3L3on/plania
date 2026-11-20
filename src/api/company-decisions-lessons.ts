// PLA-I67-3: a lesson the reflector proposed shows in «Te toca» as kind leccion (id l-<lesson uuid>), with the owner's
// words and the delivery they came from. Aprobar makes it active; «Fue solo esa vez» and «No es una lección» close it.
// Editing before approving is on the agent's page (Oficio). Decided ones stay in the list for the usual window.
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, lessons, projects, tasks, type Lesson, type Project } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { decideLesson, type LessonAction } from "../runner/lessons.js";
import { roleOf } from "../runner/limits.js";
import { defineWords, say } from "../words.js";
import type { Decision, DecisionState } from "./company-decisions.js";

export const LESSON_DECISION_WORDS = defineWords({
  es: {
    from: (title: string, words: string) => `De tu corrección en «${title}»: «${words}»`,
    fromTeach: "La escribiste tú.",
    gone: "Esa lección ya no está.",
    already: "Esa lección ya tiene tu respuesta.",
    notHere: "Aquí la lección se aprueba, se deja como solo esa vez o se descarta.",
  },
  en: {
    from: (title: string, words: string) => `From your correction on "${title}": "${words}"`,
    fromTeach: "You wrote it.",
    gone: "That lesson is gone.",
    already: "That lesson already has your answer.",
    notHere: "Here a lesson is approved, kept as only that once, or dropped.",
  },
});

const ACTION: Record<string, LessonAction> = { aprobar: "approve", solo_una_vez: "one-off", rechazar: "reject" };
const BACK: Record<string, string> = { active: "aprobar", "one-off": "solo_una_vez", rejected: "rechazar" };
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function lessonRows(db: Db, since: Date, byId: Map<string, Project>): Promise<Decision[]> {
  const rows = await db
    .select({ l: lessons, agent: agents })
    .from(lessons)
    .innerJoin(agents, eq(agents.id, lessons.agentId))
    .where(and(eq(lessons.proposedBy, "reflector"), inArray(lessons.state, ["proposed", "active", "one-off", "rejected"]), gt(lessons.updatedAt, since)))
    .orderBy(desc(lessons.createdAt))
    .limit(40);
  const keys = [...new Set(rows.map((r) => r.l.taskKey).filter((k): k is string => !!k))];
  const titles = keys.length ? await db.select({ key: tasks.key, title: tasks.title, projectId: tasks.projectId }).from(tasks).where(inArray(tasks.key, keys)) : [];
  const out: Decision[] = [];
  for (const { l, agent } of rows) {
    const p = l.projectId ? byId.get(l.projectId) : undefined;
    if (!p) continue;
    // An approved lesson stays only when it was decided in the window; an open proposal always shows.
    const decided = l.state !== "proposed";
    if (decided && !(l.decidedAt && l.decidedAt > since)) continue;
    const title = titles.find((t) => t.key === l.taskKey && t.projectId === l.projectId)?.title ?? l.taskKey ?? "";
    const state: DecisionState | null = decided ? { action: BACK[l.state] ?? l.state, at: (l.decidedAt ?? l.updatedAt).toISOString(), result: { lesson: l.id, state: l.state } } : null;
    out.push({
      id: `l-${l.id}`,
      project: p.slug,
      title: l.text,
      kind: "leccion",
      options: null,
      actions: decided ? [] : ["aprobar", "solo_una_vez", "rechazar"],
      state,
      at: l.createdAt.toISOString(),
      ref: l.taskKey,
      detail: l.ownerWords ? cut(say(LESSON_DECISION_WORDS).from(title, l.ownerWords), 400) : say(LESSON_DECISION_WORDS).fromTeach,
      links: l.taskKey ? [{ kind: "ticket", ref: l.taskKey, title }] : [],
      body: null,
      checks: null,
      release: null,
      combinable: [],
      recommended_reason: null,
      plan: null,
      evidence: null,
      files: null,
      preview_url: null,
      hold: null,
      asker: { agent: agent.slug, role: roleOf(agent) ?? agent.role },
      file_step: null,
      verify: null,
    });
  }
  return out;
}

export async function actOnLesson(db: Db, lessonId: string, action: string): Promise<{ state: DecisionState } | { error: string; status: 400 | 404 | 409; hint: string }> {
  const to = ACTION[action];
  if (!to) return { error: "INVALID_ACTION", status: 400, hint: say(LESSON_DECISION_WORDS).notHere };
  try {
    // The decisions route is the owner's screen only (a Bearer never reaches it).
    const l: Lesson = await decideLesson(db, lessonId, to, { owner: true });
    return { state: { action, at: new Date().toISOString(), result: { lesson: l.id, state: l.state } } };
  } catch (e) {
    if (e instanceof ToolError && e.code === "LESSON_NOT_FOUND") return { error: "DECISION_NOT_FOUND", status: 404, hint: say(LESSON_DECISION_WORDS).gone };
    if (e instanceof ToolError && e.code === "LESSON_STATE") return { error: "ALREADY_ACTED", status: 409, hint: say(LESSON_DECISION_WORDS).already };
    throw e;
  }
}
