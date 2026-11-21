// PLA-I71-5: the open skill catalog, reviewed before install. An injected network only (resolver and connector of the
// safe fetch): no test reaches the network. A folder with programs comes as text only and lists what was left out; a
// brought skill records its source, commit and publisher and does not change when upstream does; a newer upstream is
// marked, shown as a diff, accepted or declined (the pin stays); private addresses, redirects and oversized bodies are
// refused with the existing codes; skills.sh's search and a pick read from its GitHub folder.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const scratch = mkdtempSync(path.join(tmpdir(), "plania-i71-catalog-"));
process.env.PLANIA_KIT_DIR = path.join(scratch, "kit");
useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "tienda";
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { ensureTeam } = await import("../src/runner/team.js");
const imp = await import("../src/runner/skill-import.js");
const routes = await import("../src/api/company-oficio-trials.js");

type Json = Record<string, any>;
type Page = { status?: number; type?: string; body: string; headers?: Record<string, string> };
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const send = (method: string, p: string, body?: unknown) =>
  app.request(p, { method, headers: { Cookie: `${SESSION_COOKIE}=${createSession()}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const seat = "/api/company/projects/tienda/team/artist-tienda";

function net(pages: Record<string, Page>, dns: Record<string, string[]> = {}) {
  const asked: string[] = [];
  const resolve: import("../src/lib/safe-fetch.js").Resolver = async (host) => (dns[host] ?? ["140.82.112.3"]).map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 }));
  const connect: import("../src/lib/safe-fetch.js").Connector = async (req) => {
    asked.push(req.url.toString());
    const p = pages[req.url.toString()];
    const body = Buffer.from(p?.body ?? "not found");
    return {
      status: p ? (p.status ?? 200) : 404,
      headers: { "content-type": p?.type ?? "text/plain; charset=utf-8", ...(p?.headers ?? {}) },
      body: (async function* () {
        yield body;
      })(),
    };
  };
  return { fetch: { resolve, connect }, asked };
}

const SHA = "a41c9e7".padEnd(40, "0");
const SHA2 = "b52d0f8".padEnd(40, "0");
const API = "https://api.github.com/repos/acme/skills";
const MD = "---\nname: Revision de accesibilidad\ndescription: Al revisar una pantalla antes de entregarla.\n---\n\n# Accesibilidad\n\n1. Recorre la pantalla con el teclado.\n2. Mira https://www.w3.org/TR/WCAG21/ para los criterios.\n3. Nunca pidas el api_key del proyecto.\n";
const json = (x: unknown): Page => ({ type: "application/json", body: JSON.stringify(x) });
const listing = (entries: { path: string; type: "file" | "dir" }[]) => json(entries.map((e) => ({ ...e, name: e.path.split("/").at(-1), size: 10 })));
function repo(sha: string, md = MD): Record<string, Page> {
  return {
    [`${API}/commits/main`]: json({ sha }),
    [`${API}/contents/a11y?ref=${sha}`]: listing([
      { path: "a11y/SKILL.md", type: "file" },
      { path: "a11y/notas.md", type: "file" },
      { path: "a11y/scripts", type: "dir" },
    ]),
    [`${API}/contents/a11y/scripts?ref=${sha}`]: listing([
      { path: "a11y/scripts/contrast.py", type: "file" },
      { path: "a11y/scripts/axe.sh", type: "file" },
    ]),
    [`https://raw.githubusercontent.com/acme/skills/${sha}/a11y/SKILL.md`]: { body: md },
    [`https://raw.githubusercontent.com/acme/skills/${sha}/a11y/notas.md`]: { body: "Contraste 4.5:1.\n" },
  };
}
const TREE = "https://github.com/acme/skills/tree/main/a11y";

before(async () => {
  mkdirSync(path.join(scratch, "kit", "skills"), { recursive: true });
  writeFileSync(path.join(scratch, "kit", "kits.json"), JSON.stringify({}));
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  const pid = (await raw.query(`insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND') returning id`)).rows[0].id;
  for (const t of ["Product owner", "Taller", "Research", "Artist"]) await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, '{"agent":"t","session_id":"s"}'::jsonb)`, [pid, `Prompt: ${t}`, `# ${t}`]);
  await ensureTeam(db, { id: pid, slug: "tienda", title: "Tienda" });
});
after(async () => {
  await closeDb();
  await raw.end();
});
beforeEach(() => routes.setOficioTrialDepsForTests({}));

test("I71-5 #1: migration 0076 is the next number and safe to run twice", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../drizzle/migrations/0076_skill_catalog.sql", import.meta.url), "utf8");
  await raw.query(sql);
  await raw.query(sql);
  const cols = (await raw.query(`select column_name from information_schema.columns where table_name = 'skills' and column_name in ('source_kind','source_commit','publisher','dropped_files','review','upstream_hash') order by 1`)).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ["dropped_files", "publisher", "review", "source_commit", "source_kind", "upstream_hash"]);
});

test("I71-5 #2 #3: a folder with programs comes as text only, read at one commit; the review lists what was left out and marks secrets and links", async () => {
  const n = net(repo(SHA));
  routes.setOficioTrialDepsForTests({ fetch: n.fetch });
  const res = await send("POST", `${seat}/import/preview`, { url: TREE });
  const p = (await res.json()) as Json;
  assert.equal(res.status, 200, JSON.stringify(p));
  assert.deepEqual(p.files.map((f: Json) => f.path), ["SKILL.md", "notas.md"]);
  assert.deepEqual(p.review.dropped, ["scripts/axe.sh", "scripts/contrast.py"]);
  assert.ok(!n.asked.some((u) => /\.(py|sh)$/.test(u)), "a program is never fetched");
  assert.equal(p.commit, SHA);
  assert.equal(p.publisher, "acme");
  assert.equal(p.source_kind, "github");
  assert.equal(p.review.pinned, SHA);
  assert.ok(p.review.words > 20);
  assert.deepEqual(p.review.marks.map((m: Json) => [m.file, m.line, m.kind]), [["SKILL.md", 9, "link"], ["SKILL.md", 10, "secret"]]);
  // Saved for nobody yet («Nadie todavía»): off, with its source, commit, publisher and the files left out.
  const saved = await send("POST", `${seat}/import`, { url: TREE, source_hash: p.source_hash, scope: "agent", on: false });
  assert.equal(saved.status, 201);
  const row = (await raw.query(`select state, source_kind, source_commit, publisher, dropped_files, review->>'pinned' as pinned from skills where slug = 'revision-de-accesibilidad'`)).rows[0];
  assert.deepEqual(row, { state: "off", source_kind: "github", source_commit: SHA, publisher: "acme", dropped_files: ["scripts/axe.sh", "scripts/contrast.py"], pinned: SHA });
});

test("I71-5 #3 #4: upstream moves: the skill keeps its text, is marked «versión nueva», shows the diff; decline keeps the pin, accept moves it", async () => {
  const before = (await raw.query(`select body from skill_versions v join skills s on s.id = v.skill_id where s.slug = 'revision-de-accesibilidad' order by n desc limit 1`)).rows[0].body;
  const NEW = MD.replace("con el teclado.", "con el teclado y el lector de pantalla.");
  const moved = net(repo(SHA2, NEW));
  const tick = await imp.upstreamTick(db, { fetch: moved.fetch });
  assert.deepEqual(tick.marked, ["revision-de-accesibilidad"]);
  const after1 = (await raw.query(`select s.upstream_hash, s.source_commit, v.body from skills s join skill_versions v on v.skill_id = s.id where s.slug = 'revision-de-accesibilidad' order by v.n desc limit 1`)).rows[0];
  assert.ok(after1.upstream_hash, "marked");
  assert.equal(after1.source_commit, SHA, "still pinned");
  assert.equal(after1.body, before, "its text did not change");
  routes.setOficioTrialDepsForTests({ fetch: moved.fetch });
  const check = (await (await send("POST", `${seat}/skills/revision-de-accesibilidad/link/check`)).json()) as Json;
  assert.equal(check.changed, true);
  assert.match(check.fetched.body, /lector de pantalla/);
  assert.ok(!/lector de pantalla/.test(check.current.body));
  // Decline: the pin stays and the same upstream is not offered again.
  assert.equal((await send("POST", `${seat}/skills/revision-de-accesibilidad/link/decline`)).status, 200);
  assert.equal((await raw.query(`select upstream_hash from skills where slug = 'revision-de-accesibilidad'`)).rows[0].upstream_hash, null);
  assert.deepEqual((await imp.upstreamTick(db, { fetch: moved.fetch })).marked, []);
  // Accept: the diff's hash becomes the pin.
  const ok = await send("POST", `${seat}/skills/revision-de-accesibilidad/link/update`, { source_hash: check.source_hash });
  assert.equal(ok.status, 200);
  const after2 = (await raw.query(`select source_hash, source_commit from skills where slug = 'revision-de-accesibilidad'`)).rows[0];
  assert.deepEqual(after2, { source_hash: check.source_hash, source_commit: SHA2 });
});

test("I71-5 #5: private addresses, redirects to them and oversized bodies are refused with the existing codes", async () => {
  const inside = net({}, { "intranet.test": ["10.0.0.5"] });
  routes.setOficioTrialDepsForTests({ fetch: inside.fetch });
  assert.equal(((await (await send("POST", `${seat}/import/preview`, { url: "https://intranet.test/a/SKILL.md" })).json()) as Json).error, "FETCH_ADDRESS_REFUSED");
  const redirect = net({ "https://skills.example.test/a/SKILL.md": { status: 302, body: "", headers: { location: "http://10.0.0.5/SKILL.md" } } });
  routes.setOficioTrialDepsForTests({ fetch: redirect.fetch });
  const r = (await (await send("POST", `${seat}/import/preview`, { url: "https://skills.example.test/a/SKILL.md" })).json()) as Json;
  assert.match(String(r.error), /^FETCH_/);
  assert.ok(!redirect.asked.some((u) => u.includes("10.0.0.5")), "the redirect is not followed");
  const big = net({ "https://skills.example.test/b/SKILL.md": { body: "x".repeat(300_000) } });
  routes.setOficioTrialDepsForTests({ fetch: big.fetch });
  assert.match(String(((await (await send("POST", `${seat}/import/preview`, { url: "https://skills.example.test/b/SKILL.md" })).json()) as Json).error), /^FETCH_/);
});

test("I71-5: skills.sh's search lists picks; a pick is read from its GitHub folder and reviewed the same way", async () => {
  const pages = {
    "https://skills.sh/api/search?q=accesibilidad": json({ query: "accesibilidad", skills: [{ id: "acme/skills/a11y", source: "acme/skills", skillId: "a11y", name: "a11y", installs: 1200 }, { id: "bad", source: "../x", skillId: "y", name: "y" }] }),
    [API]: json({ default_branch: "main" }),
    [`${API}/git/trees/main?recursive=1`]: json({ tree: [{ path: "README.md" }, { path: "a11y/SKILL.md" }, { path: "otro/SKILL.md" }] }),
    ...repo(SHA),
  };
  const n = net(pages);
  routes.setOficioTrialDepsForTests({ fetch: n.fetch });
  const s = (await (await send("GET", "/api/company/catalog/skills?q=accesibilidad")).json()) as Json;
  assert.deepEqual(s.skills, [{ id: "acme/skills/a11y", name: "a11y", source: "acme/skills", skill: "a11y", installs: 1200, publisher: "acme" }]);
  await raw.query(`delete from skills where slug = 'revision-de-accesibilidad'`);
  const p = (await (await send("POST", `${seat}/import/preview`, { catalog: { source: "acme/skills", skill: "a11y" } })).json()) as Json;
  assert.equal(p.source_kind, "skills.sh");
  assert.equal(p.url, TREE);
  assert.deepEqual(p.review.dropped, ["scripts/axe.sh", "scripts/contrast.py"]);
  const saved = await send("POST", `${seat}/import`, { url: p.url, source_hash: p.source_hash, scope: "agent", on: true, via: "skills.sh" });
  assert.equal(saved.status, 201);
  assert.deepEqual((await raw.query(`select state, source_kind from skills where slug = 'revision-de-accesibilidad'`)).rows[0], { state: "on", source_kind: "skills.sh" });
  assert.ok(n.asked.every((u) => !u.includes("10.0.0")), "only public hosts");
});
