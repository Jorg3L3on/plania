import type { Db } from "../db/client.js";
import { SEARCH_KINDS, type SearchKind } from "../search/index.js";
import { searchIndex } from "../search/service.js";
import { readerOf } from "../store/port.js";
import { ToolError } from "./errors.js";
import { findProject } from "./queries.js";

// search: the tickets, docs and decisions of one project closest in meaning to a question. It finds by
// meaning, not by words: "moving off Postgres" finds a ticket titled "Port the store to devva".
export async function search(db: Db, input: { project: string; query: string; limit?: number; kinds?: string[] }) {
  const query = input.query.trim();
  if (!query) throw new ToolError("INVALID_FILTER", { field: "query" });
  const kinds = (input.kinds ?? []).filter((k): k is SearchKind => (SEARCH_KINDS as readonly string[]).includes(k));
  if (input.kinds?.length && kinds.length !== input.kinds.length) throw new ToolError("INVALID_FILTER", { field: "kinds", allowed: SEARCH_KINDS });
  const index = searchIndex();
  if (!index) throw new ToolError("SEARCH_UNAVAILABLE", { hint: "use list_tasks search for a word match" });
  const p = await findProject(db, input.project);
  const hits = await index.search(p.id, query, { limit: input.limit, kinds });
  const r = readerOf(db);
  const results = [];
  for (const h of hits) {
    if (h.kind === "task") results.push({ rank: h.rank, kind: h.kind, key: h.ref, title: h.title, snippet: h.snippet });
    else if (h.kind === "doc") {
      // A doc hangs from a task or from the project; say which, so the caller can open it with get_doc.
      const doc = await r.get("docs", { id: h.ref });
      const task = doc?.taskId ? await r.get("tasks", { id: doc.taskId }) : undefined;
      results.push({ rank: h.rank, kind: h.kind, doc_id: h.ref, task_key: task?.key ?? null, title: h.title, snippet: h.snippet });
    } else results.push({ rank: h.rank, kind: h.kind, decision_id: h.ref, title: h.title, snippet: h.snippet });
  }
  return { project: p.slug, query, results };
}
