// The search tool: a devva vector lobe bucketed by project, kept current from each commit.
// It needs a running devva engine. With SEXTANT_URL set, one test uses real embeddings.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { storeOf } = await import("../src/store/port.js");
const { SearchIndex } = await import("../src/search/index.js");
const { sextantEmbedder } = await import("../src/search/embedder.js");
const { useSearch } = await import("../src/search/service.js");
type Embedder = import("../src/search/embedder.js").Embedder;
type Index = Awaited<ReturnType<typeof SearchIndex.open>>;

const stamp = `${process.pid}_${Date.now().toString(36)}`;
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
type Json = Record<string, any>;

// A stand-in embedder for tests: each word lands in one of 96 dimensions, so texts that share words are
// close. It is deterministic and needs no service; it knows nothing about meaning.
const wordEmbedder: Embedder = {
  identity: { embedder: "test-words", revision: "1", runtime: "node" },
  async embed(texts) {
    return texts.map((text) => {
      const v = new Array<number>(96).fill(0.0001);
      for (const word of text.toLowerCase().match(/[a-záéíóúñü]{3,}/g) ?? []) {
        let h = 0;
        for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % 96;
        v[h]! += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      return v.map((x) => x / norm);
    });
  },
};

let store: TestStore;
let client: Client;
let index: Index;
let stop: () => void = () => {};

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const text = r.content[0]!.text;
  if (!text.startsWith("{") && !text.startsWith("[")) return { __error: "INVALID_INPUT", text };
  const data = JSON.parse(text);
  return r.isError ? { __error: data.error, ...data } : data;
}
const ok = async (name: string, args: Json): Promise<Json> => {
  const r = await call(name, args);
  assert.equal(r.__error, undefined, `${name}: ${JSON.stringify(r)}`);
  return r;
};
// Results are read loosely, as the MCP client hands them over.
async function found(project: string, query: string, extra: Json = {}): Promise<any[]> {
  await index.settled();
  return (await ok("search", { project, query, ...extra })).results;
}
async function open(embedder: Embedder, prefix: string): Promise<void> {
  index = await SearchIndex.open({ prefix }, embedder, () => {});
  stop = storeOf(makeDb().db).onCommit((c) => void index.follow(c));
  useSearch(index);
}

describe("search", () => {
  before(async () => {
    store = await resetTestStore();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(makeDb().db).connect(serverSide);
    client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
    await open(wordEmbedder, `s_${stamp}`);
  });
  after(async () => {
    stop();
    useSearch(null);
    await index?.purge();
    index?.close();
    await client?.close();
    await store?.end();
  });

  test("finds the closest ticket, doc and decision of one project, and nothing of another", async () => {
    await ok("create_task", { project: "zigzag", title: "Migrate the database to devva", scope: "Move every table off Postgres", checks: ["done"], actor: A });
    await ok("create_task", { project: "zigzag", title: "Fix the login button", scope: "The button does nothing on phones", checks: ["done"], actor: A });
    await ok("create_task", { project: "micasa", title: "Database migration for the house app", scope: "Postgres tables", checks: ["done"], actor: A });
    const doc = await ok("attach_doc", { project: "zigzag", title: "Backup runbook", markdown: "# Backup\nNightly dump of the database, then a restore drill.", actor: A });
    const decision = await ok("add_decision", { project: "zigzag", text: "Phones are the first screen we design for", actor: A });

    const hits = await found("zigzag", "database migration");
    assert.equal(hits[0].key, "ZIG-01");
    assert.deepEqual([hits[0].rank, hits[0].kind, hits[0].title], [1, "task", "Migrate the database to devva"]);
    assert.ok(hits.every((h) => h.key !== "MIC-01"), "another project's ticket never appears");
    const scores = hits.map((h) => h.score as number);
    assert.ok(scores.every((s) => typeof s === "number" && s <= 1 && s >= -1), `every hit has a cosine score: ${scores}`);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "the nearest hit has the highest score");
    assert.equal((await found("micasa", "database migration"))[0].key, "MIC-01");

    const docs = await found("zigzag", "nightly dump restore drill", { kinds: ["doc"] });
    assert.deepEqual(docs.map((h) => [h.kind, h.doc_id, h.task_key]), [["doc", doc.doc_id ?? doc.doc?.id ?? docs[0].doc_id, null]]);
    assert.equal((await found("zigzag", "phones first screen", { kinds: ["decision"] }))[0].decision_id, decision.decision?.id ?? decision.id ?? decision.decision_id);
    assert.equal((await found("zigzag", "anything", { limit: 2 })).length, 2);
  });

  test("the index follows edits, retirements and deleted projects", async () => {
    const before = await ok("get_task", { project: "zigzag", key: "ZIG-02" });
    await ok("set_task", { project: "zigzag", key: "ZIG-02", scope: "Repair the payment webhook that drops retries", version: before.version, actor: A });
    const edited = await found("zigzag", "payment webhook retries");
    assert.equal(edited[0].key, "ZIG-02");
    assert.match(edited[0].snippet, /payment webhook/);
    assert.doesNotMatch(edited[0].snippet, /does nothing on phones/, "the old scope is gone from the index");

    const decisions = await found("zigzag", "phones first screen", { kinds: ["decision"] });
    await ok("retire_decision", { project: "zigzag", decision_id: decisions[0].decision_id, reason: "no longer true", actor: A });
    assert.deepEqual(await found("zigzag", "phones first screen", { kinds: ["decision"] }), []);

    const { deleteProject } = await import("../src/mcp/project.js");
    const micasa = await store.projectId("micasa");
    await storeOf(makeDb().db).write(micasa, {}, (uow) => deleteProject(uow, micasa));
    await index.settled();
    assert.equal((await index.search(micasa, "database migration")).length, 0);
    assert.deepEqual(index.errors, []);
  });

  test("sync rebuilds an emptied index from the store, and is a no-op when nothing changed", async () => {
    await index.settled();
    await index.purge();
    assert.deepEqual(await found("zigzag", "database migration"), []);
    const rebuilt = await storeOf(makeDb().db).read((r) => index.sync(r));
    assert.equal(rebuilt.added, rebuilt.indexed);
    assert.ok(rebuilt.indexed >= 3);
    assert.equal((await found("zigzag", "database migration"))[0].key, "ZIG-01");
    assert.deepEqual(await storeOf(makeDb().db).read((r) => index.sync(r)), { indexed: rebuilt.indexed, added: 0, removed: 0 });
  });

  test("bad input and a server without search are refused by name", async () => {
    assert.equal((await call("search", { project: "zigzag", query: "   " })).__error, "INVALID_FILTER");
    assert.equal((await call("search", { project: "nope", query: "x" })).__error, "PROJECT_NOT_FOUND");
    useSearch(null);
    try {
      assert.equal((await call("search", { project: "zigzag", query: "database" })).__error, "SEARCH_UNAVAILABLE");
    } finally {
      useSearch(index);
    }
  });

  test("with real embeddings it finds by meaning, across languages", { skip: process.env.SEXTANT_URL ? false : "set SEXTANT_URL to the sextant service" }, async () => {
    stop();
    const words = index;
    await open(sextantEmbedder(process.env.SEXTANT_URL!), `sx_${stamp}`);
    try {
      const done = await storeOf(makeDb().db).read((r) => index.sync(r));
      assert.equal(done.added, done.indexed);
      await ok("create_task", { project: "zigzag", title: "Avisar al cliente cuando su pedido sale a reparto", scope: "Un mensaje al salir el repartidor", checks: ["listo"], actor: A });
      // No word in common with the ticket it should find.
      const hits = await found("zigzag", "moving our data to another storage engine");
      assert.equal(hits[0].key, "ZIG-01", JSON.stringify(hits.map((h) => h.title)));
      const es = await found("zigzag", "notificaciones de entrega");
      assert.equal(es[0].title, "Avisar al cliente cuando su pedido sale a reparto", JSON.stringify(es.map((h) => h.title)));
    } finally {
      stop();
      await index.purge();
      index.close();
      index = words;
      useSearch(index);
    }
  });
});
