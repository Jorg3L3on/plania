// PLA-I47-1: what La ficha reads. Throwaway store, fictional projects and fake names only.
//   #1  ideas[], prs[] and docs[] rows, their order, the limits, and no markdown in docs[]
//   #2  GET /api/company/docs/:id?project=<slug> reads a project doc of that project; malformed ids stay 404
//   #3  designs[] carries the artifact link of a Design doc and nothing for a Design doc without one
//   #4  no migration (checked by git in the evidence, not here)
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { TEST_BEARER, gte, resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { FICHA_LIMITS, artifactLinks } = await import("../src/api/company-ficha.js");

type Json = Record<string, any>;
let store: TestStore;
let pid = "";
let projectDocId = "";
let otherProjectDocId = "";
const cookie = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
const get = async (path: string, headers: Record<string, string> = cookie()) => {
  const res = await app.request(path, { headers });
  return { status: res.status, body: (await res.json()) as Json };
};
const ACTOR = { agent: "test", session_id: "s" };
const LIENZO = "https://claude.ai/artifact/AbC123_x-yz";

const task = async (key: string, kind: string, status: string, extra: { stage?: string; at?: string } = {}) =>
  (
    await store.fix((uow) =>
      uow.insert("tasks", { projectId: pid, key, title: `Título ${key}`, kind, status, stage: extra.stage ?? null, updatedAt: extra.at ? new Date(extra.at) : uow.now }),
    )
  ).id;
const doc = async (taskId: string | null, title: string, markdown: string, at: string, project = pid) =>
  (await store.fix((uow) => uow.insert("docs", { projectId: project, taskId, title, markdown, actor: ACTOR, updatedAt: new Date(at) }))).id;

before(async () => {
  store = await resetTestStore();
  await store.fix(async (uow) => {
    await uow.insert("projects", { slug: "tienda", title: "Tienda Luna", keyPrefix: "TLU" });
    await uow.insert("projects", { slug: "otra", title: "Otra Cosa", keyPrefix: "OTR" });
  });
  pid = await store.projectId("tienda");
  const other = await store.projectId("otra");

  // Three open ideas at different stages, plus a Done one that is not listed.
  const i1 = await task("TLU-IDEA1", "idea", "Open", { stage: "research", at: "2026-11-01T10:00:00Z" });
  const i2 = await task("TLU-IDEA2", "idea", "Open", { stage: "design", at: "2026-11-03T10:00:00Z" });
  const i3 = await task("TLU-IDEA3", "idea", "Open", { stage: "planning", at: "2026-11-02T10:00:00Z" });
  await task("TLU-IDEA4", "idea", "Done", { stage: "ready", at: "2026-11-04T10:00:00Z" });
  const t1 = await task("TLU-1", "ticket", "In review");
  const t2 = await task("TLU-2", "ticket", "In progress");

  await doc(i1, "Idea", "## Problem\nx\n## Who it is for\ny\n## Why now\nz", "2026-11-01T10:00:00Z");
  await doc(i2, "Design", `## Approach\nLienzo: ${LIENZO} (y otra vez ${LIENZO})\n## Scope\nx\n## Out of scope\ny`, "2026-11-03T10:00:00Z");
  await doc(i3, "Design", "## Approach\nSin enlace todavía\n## Scope\nx\n## Out of scope\ny", "2026-11-02T09:00:00Z");
  await doc(t1, "Spec", "Cuerpo largo de la spec", "2026-11-05T10:00:00Z");
  await doc(t2, "Notas", "Cuerpo de las notas", "2026-11-06T10:00:00Z");
  projectDocId = await doc(null, "Guía del proyecto", "# Guía\n\nCómo trabajamos en Tienda Luna.", "2026-11-07T10:00:00Z");
  otherProjectDocId = await doc(null, "Guía ajena", "no", "2026-11-07T10:00:00Z", other);

  const pr = (n: number, state: string, ci: string, taskId: string | null, at: string, merged: string | null) =>
    store.fix((uow) =>
      uow.insert("pullRequests", {
        projectId: pid,
        repo: "demo/tienda",
        number: n,
        url: `https://github.com/demo/tienda/pull/${n}`,
        title: `PR ${n}`,
        taskId,
        state,
        ciState: ci,
        headBranch: `jl/rama-${n}`,
        mergedAt: merged ? new Date(merged) : null,
        ghUpdatedAt: new Date(at),
      }),
    );
  await pr(7, "merged", "success", t1, "2026-11-08T10:00:00Z", "2026-11-08T10:00:00Z");
  await pr(9, "open", "failure", t2, "2026-11-09T10:00:00Z", null);
});

after(async () => {
  await store?.end();
});

test("#1 the ficha lists ideas, PRs and docs, newest first, with no markdown", async () => {
  const res = await get("/api/company/projects/tienda/ficha");
  assert.equal(res.status, 200);
  const f = res.body;
  assert.equal(f.slug, "tienda");
  assert.deepEqual(f.ideas.map((i: Json) => [i.key, i.stage]), [
    ["TLU-IDEA2", "design"],
    ["TLU-IDEA3", "planning"],
    ["TLU-IDEA1", "research"],
  ]);
  const idea1 = f.ideas.find((i: Json) => i.key === "TLU-IDEA1");
  assert.equal(typeof idea1.waits, "string");
  assert.ok(idea1.docs.Idea, "the Idea doc id is carried");
  assert.equal(idea1.docs.Design, null);
  assert.ok(f.ideas.find((i: Json) => i.key === "TLU-IDEA2").docs.Design);

  assert.deepEqual(f.prs.map((p: Json) => [p.number, p.state, p.ci_state, p.task_key]), [
    [9, "open", "failure", "TLU-2"],
    [7, "merged", "success", "TLU-1"],
  ]);
  assert.equal(f.prs[1].merged_at, "2026-11-08T10:00:00.000Z");
  assert.equal(f.prs[0].merged_at, null);
  assert.equal(f.prs[0].head_branch, "jl/rama-9");

  assert.deepEqual(f.docs.map((d: Json) => [d.title, d.task_key]), [
    ["Guía del proyecto", null],
    ["Notas", "TLU-2"],
    ["Spec", "TLU-1"],
    ["Design", "TLU-IDEA2"],
    ["Design", "TLU-IDEA3"],
    ["Idea", "TLU-IDEA1"],
  ]);
  for (const d of f.docs) assert.deepEqual(Object.keys(d).sort(), ["id", "task_key", "title", "updated_at"]);
  assert.ok(!JSON.stringify(f.docs).includes("Cuerpo"), "no markdown in docs[]");
  assert.ok(!f.docs.some((d: Json) => d.title === "Guía ajena"), "another project's doc is not listed");
  assert.deepEqual(f.counts, { ideas: 3, prs: 2, docs: 6, designs: 1 });

  assert.equal((await get("/api/company/projects/nadie/ficha")).status, 404);
  assert.equal((await get("/api/company/projects/tienda/ficha", {})).status, 401);
  assert.equal((await get("/api/company/projects/tienda/ficha", { ...cookie(), Authorization: `Bearer ${TEST_BEARER}` })).status, 403);
});

test("#1 the limits hold: 20 PRs and 30 docs at most, counts keep the totals", async () => {
  const actor = ACTOR;
  const base = Date.parse("2026-10-01T00:00:00Z");
  await store.fix(async (uow) => {
    for (let n = 100; n < 125; n++) {
      await uow.insert("pullRequests", {
        projectId: pid,
        repo: "demo/tienda",
        number: n,
        url: `https://github.com/demo/tienda/pull/${n}`,
        title: `Viejo ${n}`,
        state: "closed",
        ciState: "none",
        ghUpdatedAt: new Date(base + n * 60_000),
      });
    }
    for (let n = 0; n < 30; n++) {
      await uow.insert("docs", { projectId: pid, title: `Viejo ${String(n).padStart(2, "0")}`, markdown: "x", actor, updatedAt: new Date(base) });
    }
  });
  const f = (await get("/api/company/projects/tienda/ficha")).body;
  assert.equal(f.prs.length, FICHA_LIMITS.prs);
  assert.equal(f.prs[0].number, 9, "the newest stays first");
  assert.equal(f.docs.length, FICHA_LIMITS.docs);
  assert.equal(f.docs[0].title, "Guía del proyecto");
  assert.equal(f.counts.prs, 27);
  assert.equal(f.counts.docs, 36);
  await store.fix(async (uow) => {
    await uow.delete("pullRequests", { number: gte(100) });
    const old = (await uow.find("docs")).filter((d) => d.title.startsWith("Viejo "));
    await uow.delete("docs", { id: old.map((d) => d.id) });
  });
});

test("#2 a project doc opens with ?project=<slug>; malformed ids and other projects stay 404", async () => {
  const ok = await get(`/api/company/docs/${projectDocId}?project=tienda`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.title, "Guía del proyecto");
  assert.match(ok.body.markdown, /Cómo trabajamos/);
  assert.equal(ok.body.task_key, null);

  // Without ?project the route keeps its old rule: a project doc that is not a role prompt is not served.
  assert.equal((await get(`/api/company/docs/${projectDocId}`)).status, 404);
  // Another project's doc through this project's slug is not served.
  assert.equal((await get(`/api/company/docs/${otherProjectDocId}?project=tienda`)).status, 404);
  const bad = await get(`/api/company/docs/not-a-uuid?project=tienda`);
  assert.equal(bad.status, 404);
  assert.equal(bad.body.error, "DOC_NOT_FOUND");
  assert.equal((await get(`/api/company/docs/${projectDocId}?project=tienda`, {})).status, 401);
});

test("#3 designs[] carries the lienzo link once, and nothing for a Design doc without one", async () => {
  const f = (await get("/api/company/projects/tienda/ficha")).body;
  assert.deepEqual(f.designs.map((d: Json) => [d.idea_key, d.url]), [["TLU-IDEA2", LIENZO]]);
  assert.ok(f.designs[0].doc_id);
  assert.deepEqual(artifactLinks("nada aquí, ni https://example.com/artifact/x"), []);
  assert.deepEqual(artifactLinks("https://claude.ai/code/artifact/0f0e-11 y https://claude.ai/artifact/Z9"), [
    "https://claude.ai/code/artifact/0f0e-11",
    "https://claude.ai/artifact/Z9",
  ]);
});
