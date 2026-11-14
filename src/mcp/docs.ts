import type { Db } from "../db/client.js";
import type { docs, Task } from "../db/schema.js";
import { readerOf, uowOf } from "../store/port.js";
import { ToolError, findProject, requireTask } from "./queries.js";
import { iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// Docs live in Plania so another machine's session can read them: a spec or plan on a task,
// a design page or ADR on the project. A title is unique within its task (or the project).
// Creating twice is DOC_EXISTS; replacing needs the version you read.

type Doc = typeof docs.$inferSelect;

// An id a caller typed matches a row only in the text form Postgres prints a uuid in (lowercase, with
// dashes), as when it was compared as id::text. Anything else is not found, never a uuid parse error.
export function isUuidText(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}

export function docSummary(d: Doc) {
  return { id: d.id, title: d.title, version: d.version, updated_at: iso(d.updatedAt) };
}

function docShape(d: Doc, taskKey: string | null) {
  return { ...docSummary(d), task_key: taskKey, markdown: d.markdown, actor: d.actor, created_at: iso(d.createdAt) };
}

export async function taskDocs(db: Q, taskId: string) {
  const rows = await readerOf(db).find("docs", { taskId }, { orderBy: [{ column: "createdAt" }] });
  return rows.map(docSummary);
}

export async function projectDocs(db: Q, projectId: string) {
  const rows = await readerOf(db).find("docs", { projectId, taskId: null }, { orderBy: [{ column: "createdAt" }] });
  return rows.map((d) => ({ ...docSummary(d), markdown: d.markdown }));
}

export async function hasDoc(db: Q, t: Task): Promise<boolean> {
  return !!(await readerOf(db).get("docs", { taskId: t.id }));
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
  const uow = uowOf(tx);
  // The scope of the two partial unique indexes: the task's docs, or the project's docs with no task.
  // Looking the title up first is what keeps it unique there; the indexes only back it up.
  const scope = task ? { taskId: task.id } : { projectId, taskId: null };
  const existing = await uow.get("docs", { ...scope, title: input.title });
  let d: Doc;
  if (input.version === undefined) {
    if (existing) throw new ToolError("DOC_EXISTS", { doc_id: existing.id, version: existing.version });
    d = await uow.insert("docs", { projectId, taskId: task?.id ?? null, title: input.title, markdown: input.markdown, actor: ctx.actor });
  } else {
    if (!existing) throw new ToolError("DOC_NOT_FOUND", { title: input.title });
    if (existing.version !== input.version) throw new ToolError("STALE_VERSION", { current_version: existing.version });
    const [u] = await uow.update(
      "docs",
      { id: existing.id, version: existing.version },
      { markdown: input.markdown, version: existing.version + 1, actor: ctx.actor, updatedAt: uow.now },
    );
    // Writes are serialized, so the version cannot move under us; if it ever does, it is the same refusal.
    if (!u) throw new ToolError("STALE_VERSION", { current_version: (await uow.get("docs", { id: existing.id }))?.version ?? null });
    d = u;
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
  const r = readerOf(db);
  const d = isUuidText(docId) ? await r.get("docs", { projectId, id: docId }) : undefined;
  if (!d) throw new ToolError("DOC_NOT_FOUND", { doc_id: docId });
  const task = d.taskId ? await r.get("tasks", { id: d.taskId }) : undefined;
  return { doc: docShape(d, task?.key ?? null) };
}
