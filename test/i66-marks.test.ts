// PLA-I66-5: Artist's logo marks. The request and its wake (injected: no runner, no claude), the run's prompt, what
// deliver_marks keeps and refuses, the pixel tests on each mark, «Más como esta», and using a mark.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const STORE = mkdtempSync(path.join(tmpdir(), "plania-i66k-"));
process.env.PLANIA_CAPTURES_DIR = STORE;

const marks = await import("../src/brand/marks.js");
const logos = await import("../src/brand/logos.js");
const { bus } = await import("../src/events.js");
const { makeDb } = await import("../src/db/client.js");
const { ensureMember } = await import("../src/runner/team.js");
const ui = await import("../ui/src/lib/marca.js");

const icon = (bg: string, stroke = 12, extra = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${extra}<rect width="100" height="100" fill="${bg}"/><path d="M32 68V32h36" stroke="#ffffff" stroke-width="${stroke}" fill="none" stroke-linecap="round"/></svg>`;

describe("Artist's marks", () => {
  let raw: Awaited<ReturnType<typeof resetTestDb>>;
  let db: ReturnType<typeof makeDb>["db"];
  let project: import("../src/db/schema.js").Project;
  let artist: { slug: string; name: string };
  const woke: { reason: string; agent: string | null }[] = [];
  const wake: import("../src/brand/marks.js").Wake = async (_db, input) => {
    woke.push({ reason: input.reason, agent: input.agent?.slug ?? null });
    return { runId: "0123abcd-0000-4000-8000-000000000000" };
  };
  // PLA-119: the runner's session form since PLA-I60-1 (16 hex).
  const RUN = { agent: "plania-runner", session_id: "run-0123abcd00004000" };

  before(async () => {
    raw = await resetTestDb();
    db = makeDb().db;
  });
  after(async () => {
    await raw.end();
    rmSync(STORE, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await raw.query("delete from project_logos");
    await raw.query("delete from agents where project_id in (select id from projects where slug = 'tienda')");
    await raw.query("delete from projects where slug = 'tienda'");
    await raw.query("insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND')");
    project = (await raw.query("select * from projects where slug = 'tienda'")).rows[0];
    project.settings ??= {};
    await ensureMember(db, project as never, "artist", { note: "test" } as never);
    artist = (await raw.query("select slug, name from agents where project_id = $1 and role_template = 'artist'", [project.id])).rows[0];
    rmSync(path.join(STORE, "_marca", "tienda", "marks"), { recursive: true, force: true });
    woke.length = 0;
  });

  test("a request keeps the hints and queues the project's Artist with its marker; a second one while drawing is the same", async () => {
    const r = await marks.requestMarks(db, project, { about: "Una tienda de barrio", feel: ["cálida", "cálida", "  simple "], avoid: ["carritos"], colors: ["#c2410c", "rojo"], images: [`${"a".repeat(64)}.png`, "../etc/passwd"] }, { wake });
    assert.equal(r.status, "drawing");
    assert.deepEqual(r.hints.feel, ["cálida", "simple"]);
    assert.deepEqual(r.hints.colors, ["#c2410c"]);
    assert.deepEqual(r.hints.images, [`${"a".repeat(64)}.png`]);
    assert.equal(woke.length, 1);
    assert.equal(woke[0]!.agent, artist.slug);
    assert.equal(marks.marksIdOf(woke[0]!.reason), r.id);
    assert.equal(marks.marksRequestOfRun("tienda", woke[0]!.reason)?.id, r.id);
    assert.equal((await marks.requestMarks(db, project, { about: "otra" }, { wake })).id, r.id);
    assert.equal(woke.length, 1);
  });

  test("the run's prompt carries the hints, the images to look at, the drawing rules and the one call to make", async () => {
    const r = await marks.requestMarks(db, project, { about: "Una tienda de barrio", feel: ["cálida"], avoid: ["carritos"], colors: ["#c2410c"], images: [`${"b".repeat(64)}.png`] }, { wake });
    const text = marks.marksPrompt({ agent: "Artist", project: { slug: "tienda", title: "Tienda" }, request: r, sessionId: "run-x", imageDir: "/store/up" });
    for (const bit of ['"Una tienda de barrio"', "cálida", "carritos", "#c2410c", `/store/up/${"b".repeat(64)}.png`, "viewBox 0 0 100 100", "radius 38", `id: "${r.id}"`, "deliver_marks", "Spanish"]) assert.ok(text.includes(bit), bit);
  });

  test("deliver_marks: only the run it woke; marks cleaned, rendered and tested; unusable ones said with the reason", async () => {
    const r = await marks.requestMarks(db, project, { about: "Tienda" }, { wake });
    await assert.rejects(marks.deliverMarks(db, { project: "tienda", id: r.id, marks: [{ name: "A", idea: "a", svg: icon("#1d4ed8") }] }, { agent: "someone-else", session_id: "x" }), { code: "MARKS_FORBIDDEN" });
    const events: string[] = [];
    const off = bus.subscribe((e) => events.push(`${e.type}:${e.project}`));
    const out = await marks.deliverMarks(
      db,
      {
        project: "tienda",
        id: r.id,
        marks: [
          { name: "Esquina", idea: "La esquina del barrio.", svg: icon("#1d4ed8", 12, "<script>alert(1)</script>") },
          { name: "Hilo", idea: "Una línea fina.", svg: icon("#1d4ed8", 2) },
          { name: "Ancha", idea: "No es cuadrada.", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80"><rect width="300" height="80"/></svg>` },
          { name: "Texto", idea: "Nada.", svg: "hola" },
        ],
      },
      RUN,
    );
    off();
    assert.equal(out.kept, 2);
    assert.deepEqual(out.rejected.map((x) => x.name), ["Ancha", "Texto"]);
    const ready = marks.latestRequest("tienda")!;
    assert.equal(ready.status, "ready");
    const [good, thin] = ready.marks;
    assert.equal(ui.passesAll(good!.tests), true);
    assert.equal(thin!.tests.small.ok, false);
    assert.doesNotMatch(marks.markFile("tienda", r.id, good!.file)!.toString(), /<script/);
    assert.equal(marks.markFile("tienda", r.id, "../request.json"), null);
    assert.ok(events.includes("project:tienda"));
    await assert.rejects(marks.deliverMarks(db, { project: "tienda", id: r.id, marks: [{ name: "x", idea: "", svg: icon("#000") }] }, RUN), { code: "MARKS_NOT_FOUND" });
  });

  test("a mark on a gradient is judged against its own gradient, not one flat colour", async () => {
    const r = await marks.requestMarks(db, project, { about: "Tienda" }, { wake });
    const grad = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6B3F69"/><stop offset="1" stop-color="#2E1C33"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><path d="M34 66V34h32" stroke="#fff" stroke-width="10" fill="none"/></svg>`;
    await marks.deliverMarks(db, { project: "tienda", id: r.id, marks: [{ name: "G", idea: "g", svg: grad }] }, RUN);
    const t = marks.latestRequest("tienda")!.marks[0]!.tests;
    assert.deepEqual([t.small.ok, t.circle.ok, t.contrast.ok], [true, true, true]);
  });

  test("when nothing is usable the request stays open and says why", async () => {
    const r = await marks.requestMarks(db, project, { about: "Tienda" }, { wake });
    await assert.rejects(marks.deliverMarks(db, { project: "tienda", id: r.id, marks: [{ name: "x", idea: "", svg: "<html/>" }] }, RUN), { code: "MARKS_INVALID" });
    assert.equal(marks.latestRequest("tienda")!.status, "drawing");
  });

  test("«Más como esta» carries the liked mark's name and idea into the next round; a mark becomes the chosen original", async () => {
    const r = await marks.requestMarks(db, project, { about: "Tienda" }, { wake });
    await marks.deliverMarks(db, { project: "tienda", id: r.id, marks: [{ name: "Esquina", idea: "La esquina del barrio.", svg: icon("#1d4ed8") }] }, RUN);
    const first = marks.latestRequest("tienda")!;
    const logo = await marks.useMark(db, project, first.id, first.marks[0]!.id, { agent: "owner", session_id: "web" });
    assert.deepEqual([logo.source, logo.chosen, logo.mime, logo.variant, logo.sourcePath], ["artist", true, "image/svg+xml", "icon", "Esquina"]);
    assert.equal((await logos.logosRead(db)).tienda?.source, "artist");
    const again = await marks.requestMarks(db, project, { about: "Tienda", like: first.marks[0]!.id }, { wake });
    assert.equal(again.hints.like, "Esquina: La esquina del barrio.");
    assert.ok(marks.marksPrompt({ agent: "A", project: { slug: "tienda", title: "T" }, request: again, sessionId: "s", imageDir: "/x" }).includes("variations"));
  });

  test("PLA-119: the run it woke may answer in the 16-hex or the old 8-hex form; another run's session is refused", async () => {
    const r = await marks.requestMarks(db, project, { about: "Tienda" }, { wake });
    const one = [{ name: "A", idea: "a", svg: icon("#1d4ed8") }];
    await assert.rejects(marks.deliverMarks(db, { project: "tienda", id: r.id, marks: one }, { agent: "plania-runner", session_id: "run-ffffffff00004000" }), { code: "MARKS_FORBIDDEN" });
    const out = await marks.deliverMarks(db, { project: "tienda", id: r.id, marks: one }, { agent: "plania-runner", session_id: "run-0123abcd" });
    assert.equal(out.id, r.id);
  });

  test("a project with no Artist and no run gets a failed request, not a silent wait", async () => {
    await raw.query("delete from agents where project_id = $1", [project.id]);
    const r = await marks.requestMarks(db, project, { about: "Tienda" }, { wake: async () => ({ runId: null, why: "no agent" }) });
    assert.equal(r.status, "failed");
  });

  test("PLA-130: a drawing request can be cancelled, one older than 30 minutes fails as timeout, and neither blocks a new one", async () => {
    const r = await marks.requestMarks(db, project, { about: "Tienda" }, { wake });
    assert.equal(r.status, "drawing");
    const c = marks.cancelMarks("tienda", r.id)!;
    assert.deepEqual([c.status, c.why], ["failed", "cancelled"]);
    assert.equal(marks.cancelMarks("tienda", r.id)!.why, "cancelled", "cancelling twice changes nothing");
    const again = await marks.requestMarks(db, project, { about: "Tienda otra vez" }, { wake });
    assert.notEqual(again.id, r.id, "a cancelled request does not block a new one");
    const late = await marks.settle(db, marks.loadRequest("tienda", again.id), Date.parse(again.at) + marks.MARKS_STALE_MS + 1000);
    assert.deepEqual([late!.status, late!.why], ["failed", "timeout"]);
    const fresh = await marks.settle(db, marks.loadRequest("tienda", (await marks.requestMarks(db, project, { about: "tercera" }, { wake })).id));
    assert.equal(fresh!.status, "drawing", "a young request keeps drawing");
  });
});
