// The server's one search index, when it has one. Search needs a devva engine and an embedder; without
// both, plania runs as before and the search tool says it is unavailable.
import type { Db } from "../db/client.js";
import { pgStore } from "../store/pg.js";
import { sextantEmbedder } from "./embedder.js";
import { SearchIndex } from "./index.js";

let current: SearchIndex | null = null;
export const searchIndex = (): SearchIndex | null => current;
// Puts an index in place, or removes it. For tests and for startSearch.
export function useSearch(index: SearchIndex | null): void {
  current = index;
}

// Opens the index, brings it level with the store, and keeps it level from every commit.
export async function startSearch(db: Db, log: (line: string) => void = console.log): Promise<SearchIndex> {
  const url = process.env.SEXTANT_URL;
  if (!url) throw new Error("SEXTANT_URL is not set");
  const index = await SearchIndex.open({ prefix: process.env.PLANIA_DEVVA_PREFIX || "plania" }, sextantEmbedder(url), log);
  const store = pgStore(db);
  store.onCommit((c) => void index.follow(c));
  const done = await store.read((r) => index.sync(r));
  log(`[search] ${done.indexed} entries indexed (${done.added} embedded now, ${done.removed} removed)`);
  current = index;
  return index;
}
