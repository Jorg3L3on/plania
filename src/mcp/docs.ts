import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { docs, tasks, type Task } from "../db/schema.js";
import { ToolError, findProject, requireTask } from "./queries.js";
import { iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// Docs live in Plania so another machine's session can read them: a spec or plan on a task,
// a design page or ADR on the project. A title is unique within its task (or the project).
// Creating twice is DOC_EXISTS; replacing needs the version you read.

type Doc = typeof docs.$inferSelect;

export function docSummary(d: Doc) {
  return { id: d.id, title: d.title, version: d.version, updated_at: iso(d.updatedAt) };
}

function docShape(d: Doc, taskKey: string | null) {
  return { ...docSummary(d), task_key: taskKey, markdown: d.markdown, actor: d.actor, created_at: iso(d.createdAt) };
}

export async function taskDocs(db: Q, taskId: string) {
  const rows = await db.select().from(docs).where(eq(docs.taskId, taskId)).orderBy(asc(docs.createdAt));
  return rows.map(docSummary);
}

export async function projectDocs(db: Q, projectId: string) {
  const rows = await db
    .select()
    .from(docs)
    .where(and(eq(docs.projectId, projectId), isNull(docs.taskId)))
    .orderBy(asc(docs.createdAt));
  return rows.map((d) => ({ ...docSummary(d), markdown: d.markdown }));
}

export async function hasDoc(db: Q, t: Task): Promise<boolean> {
  const [d] = await db.select({ id: docs.id }).from(docs).where(eq(docs.taskId, t.id)).limit(1);
  return !!d;
}

// Inside an open writeTx. Used by attach_doc and by add_decision for an ADR body.
export async function putDoc(
  tx: Q,
  emit: Emit,
  ctx: Ctx,
  projectId: string,
  task: Task | undefined,
  input: { title: string; markdown: string; version?: number },
): Promise<Doc> {
  const scope = task ? eq(docs.taskId, task.id) : and(eq(docs.projectId, projectId), isNull(docs.taskId));
  const [existing] = await tx.select().from(docs).where(and(scope, eq(docs.title, input.title))).limit(1);
  let d: Doc;
  if (input.version === undefined) {
    if (existing) throw new ToolError("DOC_EXISTS", { doc_id: existing.id, version: existing.version });
    [d] = (await tx
      .insert(docs)
      .values({ projectId, taskId: task?.id ?? null, title: input.title, markdown: input.markdown, actor: ctx.actor })
      .returning()) as [Doc];
  } else {
    if (!existing) throw new ToolError("DOC_NOT_FOUND", { title: input.title });
    if (existing.version !== input.version) throw new ToolError("STALE_VERSION", { current_version: existing.version });
    [d] = (await tx
      .update(docs)
      .set({ markdown: input.markdown, version: sql`${docs.version} + 1`, actor: ctx.actor, updatedAt: sql`now()` })
      .where(and(eq(docs.id, existing.id), eq(docs.version, input.version)))
      .returning()) as [Doc];
  }
  await emit("doc.put", task ?? null, { doc_id: d.id, title: d.title, version: d.version });
  return d;
}

export async function attachDoc(
  db: Db,
  input: { project: string; key?: string; title: string; markdown: string; version?: number },
  ctx: Ctx,
) {
  if (!input.title.trim()) throw new ToolError("DOC_NOT_FOUND", { title: input.title });
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const task = input.key ? await requireTask(tx, p.id, input.key) : undefined;
    const d = await putDoc(tx, emit, ctx, p.id, task, input);
    return { doc: docShape(d, task?.key ?? null) };
  });
}

export async function getDoc(db: Q, projectId: string, docId: string) {
  const [row] = await db
    .select({ d: docs, key: tasks.key })
    .from(docs)
    .leftJoin(tasks, eq(tasks.id, docs.taskId))
    .where(and(eq(docs.projectId, projectId), sql`${docs.id}::text = ${docId}`))
    .limit(1);
  if (!row) throw new ToolError("DOC_NOT_FOUND", { doc_id: docId });
  return { doc: docShape(row.d, row.key) };
}
