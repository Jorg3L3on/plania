// PLA-I67-5: watch and clean what an agent learned.
//   Repeats. The owner marks a lesson's correction as having come back (counts at once); a reflector «repeats lesson X»
//   verdict is only a suggestion until the owner confirms it (decision on PLA-I67-5: the trial over real corrections
//   was not run). REPEAT_FLAG confirmed repeats flag the lesson: rewrite it, merge it into a skill, or retire it.
//   Merge. The lesson becomes one line of a skill under «Lessons from the owner» (a new skill version through
//   editSkill; a factory skill gets the owner's copy), or a skill of its own; the lesson is retired.
//   Budget. The text a run always carries (role prompt, «tu manera», the skill list, lessons, reference notes) has a
//   hard cap of ALWAYS_ON_WORDS words. Lessons fill what is left, newest confirmed first, and a run never carries more;
//   when the active lessons want more room than that, the page proposes consolidating them into a skill.
//   Expiry. An active lesson not carried, confirmed or kept in EXPIRY_DAYS is proposed for retirement; nothing is
//   removed without the owner.
//   History. One list per agent of what changed, when and by whom, read from the rows that already record it.
import { carriedReferences } from "../references/store.js";
import { MAX_CARRIED_REFERENCES } from "./references.js";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { lessonRepeats, lessons, skillVersions, skills, type Agent, type Lesson } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import type { Q } from "../mcp/tx.js";
import { roleOf, type RunnerRole } from "./limits.js";
import { rolePrompt } from "./prompts.js";
import { createSkill, editSkill, inScope, seatOf, skillCard, type ResolvedSkill } from "./skills.js";
import type { Decider } from "./lessons.js";

export const REPEAT_FLAG = 2;
export const EXPIRY_DAYS = 90;
export const ALWAYS_ON_WORDS = 1500;
export const MERGED_HEADING = "## Lessons from the owner";

export const wordsIn = (text: string | null | undefined): number => (text ? text.split(/\s+/).filter(Boolean).length : 0);
// A skill's line in the run prompt is its slug and description (kitLines).
export const skillLineWords = (s: Pick<ResolvedSkill, "slug" | "when">): number => 2 + wordsIn(s.when.slice(0, 240));
export const lessonLineWords = (l: { text: string; applies_when: string | null }): number => 1 + wordsIn(l.text) + (l.applies_when ? 1 + wordsIn(l.applies_when) : 0);

// ---- Repeats

const owned = async (db: Db | Q, id: string): Promise<Lesson> => {
  const [l] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1);
  if (!l) throw new ToolError("LESSON_NOT_FOUND", { lesson: id });
  return l;
};

export async function markRepeat(db: Db, lessonId: string, by: Decider, input: { task_key?: string | null; words?: string | null } = {}, now: Date = new Date()): Promise<void> {
  if (!by.owner) throw new ToolError("LESSON_OWNER_ONLY", { lesson: lessonId });
  const l = await owned(db, lessonId);
  if (l.state !== "active") throw new ToolError("LESSON_STATE", { lesson: lessonId, state: l.state, action: "repeat" });
  await db.insert(lessonRepeats).values({ lessonId, taskKey: input.task_key?.trim() || null, words: input.words?.trim().slice(0, 600) || null, by: "owner", confirmed: true, createdAt: now });
}

// The reflector's «repeats lesson X»: a suggestion only.
export async function suggestRepeat(db: Db | Q, lessonId: string, fb: { id: string; taskKey: string | null; words: string }): Promise<void> {
  await db.insert(lessonRepeats).values({ lessonId, feedbackId: fb.id, taskKey: fb.taskKey, words: fb.words.slice(0, 600), by: "reflector", confirmed: false }).onConflictDoNothing();
}

export async function confirmRepeat(db: Db, repeatId: string, yes: boolean, by: Decider, now: Date = new Date()): Promise<void> {
  if (!by.owner) throw new ToolError("LESSON_OWNER_ONLY", { repeat: repeatId });
  const [r] = await db.select().from(lessonRepeats).where(eq(lessonRepeats.id, repeatId)).limit(1);
  if (!r) throw new ToolError("LESSON_NOT_FOUND", { repeat: repeatId });
  await db.update(lessonRepeats).set(yes ? { confirmed: true } : { dismissedAt: now }).where(eq(lessonRepeats.id, repeatId));
}

export type RepeatView = { confirmed: number; flagged: boolean; suggested: { id: string; task_key: string | null; words: string | null }[]; last: { task_key: string | null; words: string | null; at: string } | null };

export async function repeatsOf(db: Db | Q, ids: string[]): Promise<Map<string, RepeatView>> {
  const out = new Map<string, RepeatView>();
  if (ids.length === 0) return out;
  const rows = await db.select().from(lessonRepeats).where(and(inArray(lessonRepeats.lessonId, ids), isNull(lessonRepeats.dismissedAt))).orderBy(desc(lessonRepeats.createdAt));
  for (const id of ids) {
    const mine = rows.filter((r) => r.lessonId === id);
    const confirmed = mine.filter((r) => r.confirmed);
    out.set(id, {
      confirmed: confirmed.length,
      flagged: confirmed.length >= REPEAT_FLAG,
      suggested: mine.filter((r) => !r.confirmed).map((r) => ({ id: r.id, task_key: r.taskKey, words: r.words })),
      last: confirmed[0] ? { task_key: confirmed[0].taskKey, words: confirmed[0].words, at: confirmed[0].createdAt.toISOString() } : null,
    });
  }
  return out;
}

// ---- Merge into a skill

// skill: an existing skill's slug (owner or factory); null makes a new skill of the lesson alone.
export async function mergeLesson(db: Db, project: string, agent: string, lessonId: string, skill: string | null, by: Decider, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<string> {
  if (!by.owner) throw new ToolError("LESSON_OWNER_ONLY", { lesson: lessonId });
  const l = await owned(db, lessonId);
  if (l.state !== "active") throw new ToolError("LESSON_STATE", { lesson: lessonId, state: l.state, action: "merge" });
  let slug: string;
  if (skill) {
    const card = await skillCard(db, project, agent, skill, env);
    const line = `- ${l.text}${l.appliesWhen ? ` (${l.appliesWhen})` : ""}`;
    const body = card.body.includes(MERGED_HEADING) ? `${card.body.trimEnd()}\n${line}` : `${card.body.trimEnd()}\n\n${MERGED_HEADING}\n\n${line}`;
    await editSkill(db, project, agent, skill, { body }, env);
    slug = skill;
  } else {
    const name = l.text.length > 60 ? `${l.text.slice(0, 59).trimEnd()}…` : l.text;
    slug = await createSkill(db, project, agent, { name, description: l.appliesWhen || l.text, body: l.text }, env);
  }
  await db.update(lessons).set({ state: "retired", mergedInto: slug, decidedAt: now, updatedAt: now }).where(eq(lessons.id, lessonId));
  return slug;
}

// ---- Expiry

export async function lastCarried(db: Db | Q, ids: string[]): Promise<Map<string, Date>> {
  if (ids.length === 0) return new Map();
  const rows = (
    await db.execute<{ item: string; at: string } & Record<string, unknown>>(sql`
      select item, max(created_at) as at from run_knowledge where kind = 'lesson' and item in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) group by item`)
  ).rows;
  return new Map(rows.map((r) => [r.item, new Date(r.at)]));
}

export function retirementDue(l: Pick<Lesson, "state" | "approvedAt" | "lastConfirmedAt" | "keptAt" | "createdAt">, carried: Date | undefined, now: Date): boolean {
  if (l.state !== "active") return false;
  const times = [l.approvedAt, l.lastConfirmedAt, l.keptAt, carried, l.createdAt].filter((d): d is Date => !!d).map((d) => d.getTime());
  return now.getTime() - Math.max(...times) > EXPIRY_DAYS * 86_400_000;
}

export async function keepLesson(db: Db, id: string, by: Decider, now: Date = new Date()): Promise<void> {
  if (!by.owner) throw new ToolError("LESSON_OWNER_ONLY", { lesson: id });
  const l = await owned(db, id);
  if (l.state !== "active") throw new ToolError("LESSON_STATE", { lesson: id, state: l.state, action: "keep" });
  await db.update(lessons).set({ keptAt: now, updatedAt: now }).where(eq(lessons.id, id));
}

// ---- Budget

export type Budget = { budget: number; role: number; manner: number; skills: number; references: number; lessons: number; lessons_wanted: number; used: number; room_for_lessons: number; over: boolean };

// The words a run of this agent always carries, apart from its lessons. Role prompt from the same place the runner reads it.
export async function fixedWords(db: Db, a: Agent, skillsCarried: Pick<ResolvedSkill, "slug" | "when">[], env: NodeJS.ProcessEnv = process.env): Promise<{ role: number; manner: number; skills: number; references: number }> {
  const role = roleOf(a);
  const prompt = role ? await rolePrompt(db, role as RunnerRole, env).catch(() => null) : null;
  // PLA-I67-4: each reference the run carries adds its manifest line (title and the owner's note, plus the path).
  const refs = a.projectId ? await carriedReferences(db, a.projectId, a.id, MAX_CARRIED_REFERENCES).catch(() => []) : [];
  return { role: wordsIn(prompt?.markdown), manner: wordsIn(a.manner), skills: skillsCarried.reduce((n, s) => n + skillLineWords(s), 0), references: refs.reduce((n, r) => n + wordsIn(`${r.title} ${r.note}`) + 4, 0) };
}

export const lessonRoomOf = (fixed: { role: number; manner: number; skills: number; references: number }, budget = ALWAYS_ON_WORDS): number =>
  Math.max(0, budget - fixed.role - fixed.manner - fixed.skills - fixed.references);

export function budgetOf(fixed: { role: number; manner: number; skills: number; references: number }, carriedLessons: { text: string; applies_when: string | null }[], wantedLessons: { text: string; applies_when: string | null }[], budget = ALWAYS_ON_WORDS): Budget {
  const lessonsUsed = carriedLessons.reduce((n, l) => n + lessonLineWords(l), 0);
  const wanted = wantedLessons.reduce((n, l) => n + lessonLineWords(l), 0);
  const used = fixed.role + fixed.manner + fixed.skills + fixed.references + lessonsUsed;
  return { budget, ...fixed, lessons: lessonsUsed, lessons_wanted: wanted, used, room_for_lessons: lessonRoomOf(fixed, budget), over: wanted + fixed.role + fixed.manner + fixed.skills + fixed.references > budget };
}

// ---- History

export type HistoryItem = { at: string; kind: "skill_new" | "skill_version" | "skill_deleted" | "lesson_proposed" | "lesson_taught" | "lesson_approved" | "lesson_retired" | "lesson_merged" | "lesson_rejected" | "lesson_once" | "lesson_repeat" | "manner"; what: string; n?: number; by: "owner" | "plania" | "factory" };

export async function historyOf(db: Db, project: string, agent: string, limit = 12): Promise<HistoryItem[]> {
  const a = await seatOf(db, project, agent);
  const out: HistoryItem[] = [];
  const mine = (await db.select().from(skills)).filter((s) => inScope(s, a));
  if (mine.length) {
    const vs = await db.select().from(skillVersions).where(inArray(skillVersions.skillId, mine.map((s) => s.id))).orderBy(desc(skillVersions.createdAt)).limit(40);
    for (const v of vs) {
      if (v.author === "factory") continue;
      out.push({ at: v.createdAt.toISOString(), kind: v.n === 1 ? "skill_new" : "skill_version", what: v.name, n: v.n, by: "owner" });
    }
    for (const s of mine.filter((x) => x.archivedAt)) {
      const v = vs.find((x) => x.skillId === s.id);
      out.push({ at: s.archivedAt!.toISOString(), kind: "skill_deleted", what: v?.name ?? s.slug, by: "owner" });
    }
  }
  const ls = await db.select().from(lessons).where(eq(lessons.agentId, a.id)).orderBy(desc(lessons.updatedAt)).limit(40);
  for (const l of ls) {
    out.push({ at: l.createdAt.toISOString(), kind: l.proposedBy === "owner" ? "lesson_taught" : "lesson_proposed", what: l.text, by: l.proposedBy === "owner" ? "owner" : "plania" });
    if (l.decidedAt && l.proposedBy !== "owner") {
      const kind = l.mergedInto ? "lesson_merged" : ({ active: "lesson_approved", retired: "lesson_retired", rejected: "lesson_rejected", "one-off": "lesson_once", expired: null, proposed: null } as const)[l.state];
      if (kind) out.push({ at: l.decidedAt.toISOString(), kind, what: l.mergedInto ? `${l.text} → ${l.mergedInto}` : l.text, by: "owner" });
    } else if (l.decidedAt && (l.state === "retired" || l.mergedInto) && l.proposedBy === "owner") {
      out.push({ at: l.decidedAt.toISOString(), kind: l.mergedInto ? "lesson_merged" : "lesson_retired", what: l.mergedInto ? `${l.text} → ${l.mergedInto}` : l.text, by: "owner" });
    }
  }
  if (ls.length) {
    const reps = await db.select().from(lessonRepeats).where(and(inArray(lessonRepeats.lessonId, ls.map((l) => l.id)), eq(lessonRepeats.confirmed, true))).limit(40);
    for (const r of reps) out.push({ at: r.createdAt.toISOString(), kind: "lesson_repeat", what: ls.find((l) => l.id === r.lessonId)?.text ?? "", by: r.by === "owner" ? "owner" : "plania" });
  }
  if (a.mannerUpdatedAt) out.push({ at: a.mannerUpdatedAt.toISOString(), kind: "manner", what: "", by: "owner" });
  return out.sort((x, y) => y.at.localeCompare(x.at)).slice(0, limit);
}
