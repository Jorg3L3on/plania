// PLA-120: the gaps a guided logo test found in Marca. Throwaway DB and store, fake git, no runner, no claude.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-pla120-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const marks = await import("../src/brand/marks.js");
const logos = await import("../src/brand/logos.js");
const marca = await import("../src/brand/marca.js");
const { repoPathOf } = await import("../src/runner/worktree.js");
const { makeDb } = await import("../src/db/client.js");
const { ensureMember } = await import("../src/runner/team.js");
const { JOBS } = await import("../src/jobs/index.js");
const ui = await import("../ui/src/lib/marca.js");

describe("PLA-120: Marca after a guided logo test", () => {
  let raw: Awaited<ReturnType<typeof resetTestDb>>;
  let db: ReturnType<typeof makeDb>["db"];
  let project: import("../src/db/schema.js").Project;

  before(async () => {
    raw = await resetTestDb();
    db = makeDb().db;
  });
  after(async () => {
    await raw.end();
    rmSync(STORE, { recursive: true, force: true });
  });
  beforeEach(async () => {
    marca.forgetMarca();
    await raw.query("delete from project_logos");
    await raw.query("delete from agents where project_id in (select id from projects where slug = 'tienda')");
    await raw.query("delete from projects where slug = 'tienda'");
    await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
    project = (await raw.query("select * from projects where slug = 'tienda'")).rows[0];
    project.settings ??= {};
    await ensureMember(db, project as never, "artist", { note: "test" } as never);
    rmSync(path.join(STORE, "_marca", "tienda", "marks"), { recursive: true, force: true });
  });

  test("#1 a folder Plania cannot read names the folder and points to Ajustes; no_code keeps its sentence", async () => {
    const r = (await marca.marcaRead(db, "tienda", { git: async () => ({ code: 1, stdout: Buffer.alloc(0) }) }))!;
    assert.equal(r.repo, "none");
    assert.equal(r.folder, repoPathOf("tienda", project.settings));
    const w = ui.marcaWords();
    assert.match(w.noRepoFound(r.folder), new RegExp(r.folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(w.noRepoFound(r.folder), /Ajustes/);
    assert.match(w.noRepo, /todavía no tiene código/);
    await raw.query(`update projects set settings = '{"local":{"no_code":true}}' where slug = 'tienda'`);
    marca.forgetMarca();
    assert.equal((await marca.marcaRead(db, "tienda", {}))!.repo, "no_code");
  });

  test("#2 the start branch as GitHub has it wins over a local branch nobody pulled", async () => {
    const refs: Record<string, string> = { sandbox: "1".repeat(40), "origin/sandbox": "2".repeat(40), HEAD: "3".repeat(40) };
    const git: import("../src/brand/logos.js").Git = async (_cwd, args) => {
      const sha = refs[args[3]!.replace("^{commit}", "")];
      return sha ? { code: 0, stdout: Buffer.from(`${sha}\n`) } : { code: 1, stdout: Buffer.alloc(0) };
    };
    assert.deepEqual(await logos.startCommit(git, "/repo", "sandbox"), { sha: "2".repeat(40), ref: "origin/sandbox" });
    delete refs["origin/sandbox"];
    assert.deepEqual(await logos.startCommit(git, "/repo", "sandbox"), { sha: "1".repeat(40), ref: "sandbox" }, "no remote twin: the local branch");
  });

  test("#3 a wake that queues nothing fails the request with its reason, and the screen says it", async () => {
    const r = await marks.requestMarks(db, project, { about: "Tienda" }, { wake: async () => ({ runId: null, why: "project tienda paused" }) });
    assert.equal(r.status, "failed");
    assert.equal(r.why, "project tienda paused");
    assert.equal(marks.latestRequest("tienda")?.status, "failed", "saved failed, not drawing");
    assert.match(ui.marcaWords().gen.failedWhy(r.why!), /pausa/);
    // A request that did queue a run still draws.
    const ok = await marks.requestMarks(db, project, { about: "Tienda" }, { wake: async () => ({ runId: "0123abcd-0000-4000-8000-000000000000" }) });
    assert.equal(ok.status, "drawing");
  });

  test("#4 #5 typed colours and the owner's change reach the request and the prompt", async () => {
    const r = await marks.requestMarks(db, project, { about: "Tienda", colors: ["#c48b9f", "#4a1f3d", "rosa"], change: "  más delicada,   con cinco pétalos  " }, { wake: async () => ({ runId: "0123abcd-0000-4000-8000-000000000000" }) });
    assert.deepEqual(r.hints.colors, ["#c48b9f", "#4a1f3d"]);
    assert.equal(r.hints.change, "más delicada, con cinco pétalos");
    const text = marks.marksPrompt({ agent: "Artist", project: { slug: "tienda", title: "Tienda" }, request: r, sessionId: "run-x", imageDir: "/up" });
    assert.match(text, /#c48b9f, #4a1f3d/);
    assert.match(text, /asks for this change, in their words: "más delicada, con cinco pétalos"/);
    rmSync(path.join(STORE, "_marca", "tienda", "marks"), { recursive: true, force: true }); // the one above is still drawing
    assert.equal((await marks.requestMarks(db, project, { about: "x", change: "y".repeat(500) }, { wake: async () => ({ runId: null, why: "x" }) })).hints.change?.length, 200);
  });

  test("#6 the logo read runs from the background jobs, not only from a page view", () => {
    const job = JOBS.find((j) => j.name === "logos");
    assert.ok(job, "a logos job");
    assert.ok(job.intervalMs <= 10 * 60_000);
  });
});
