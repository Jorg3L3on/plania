// PLA-136..143: the fixes from a live QA pass of Equipo. Each write fired twice at once leaves one row (PLA-136);
// a seat goes back to its factory skill list (PLA-140); a custom post and a saved team can be deleted (PLA-142).
// Throwaway DB, no network.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const scratch = mkdtempSync(path.join(tmpdir(), "plania-equipo-qa-"));
const kit = path.join(scratch, "kit");
for (const s of ["tdd", "pr", "cited-research"]) {
  mkdirSync(path.join(kit, "skills", s), { recursive: true });
  writeFileSync(path.join(kit, "skills", s, "SKILL.md"), `---\nname: ${s}\ndescription: ${s} skill.\n---\n\n# ${s}\n`);
}
writeFileSync(path.join(kit, "kits.json"), JSON.stringify({ research: ["cited-research"], taller: ["tdd", "pr"] }));
process.env.PLANIA_KIT_DIR = kit;
process.env.PLANIA_CAPTURES_DIR = path.join(scratch, "captures");
useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "tienda";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { ensureTeam } = await import("../src/runner/team.js");
const skills = await import("../src/runner/skills.js");
const lessons = await import("../src/runner/lessons.js");
const refs = await import("../src/references/store.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const owner = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const call = async (method: string, url: string, body?: unknown) => {
  const res = await app.request(url, { method, headers: owner(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
};
const T = "/api/company/projects/tienda";
const n = async (q: string, args: unknown[] = []) => (await raw.query(q, args)).rows[0].n as number;
const actor = { agent: "test", session_id: "s" };

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await raw.query(`insert into agents (slug, name, role, kind) values ('ceo', 'CEO', 'ceo', 'human')`);
  const pid = (await raw.query(`insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND') returning id`)).rows[0].id;
  for (const t of ["Product owner", "Taller", "Research", "Artist", "QA"]) await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, '{"agent":"t","session_id":"s"}'::jsonb)`, [pid, `Prompt: ${t}`, `# ${t}`]);
  await ensureTeam(db, { id: pid, slug: "tienda", title: "Tienda" });
});
after(async () => {
  await closeDb();
  await raw.end();
});

test("PLA-136: the same rule taught twice at once is one lesson", async () => {
  const [a, b] = await Promise.all([
    lessons.teachRule(db, "tienda", "taller-tienda", { text: "Corre las pruebas antes de cerrar." }, { owner: true }),
    lessons.teachRule(db, "tienda", "taller-tienda", { text: "Corre las pruebas antes de cerrar." }, { owner: true }),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(await n(`select count(*)::int as n from lessons where text = 'Corre las pruebas antes de cerrar.'`), 1);
  // Another text, or the same text on another seat, is a new lesson.
  await lessons.teachRule(db, "tienda", "taller-tienda", { text: "Otra regla distinta." }, { owner: true });
  await lessons.teachRule(db, "tienda", "research-tienda", { text: "Corre las pruebas antes de cerrar." }, { owner: true });
  assert.equal(await n(`select count(*)::int as n from lessons`), 3);
});

test("PLA-136: the same link saved twice at once is one reference", async () => {
  // A private address: the read is refused at once, the address is kept with its refusal. No network.
  const deps = { fetch: { resolve: async () => [{ address: "10.0.0.7", family: 4 }] } } as never;
  const input = { slug: "tienda", agent: "taller-tienda", url: "https://ejemplo.test/guia", actor };
  const [a, b] = await Promise.all([refs.addLinkReference(db, input, deps), refs.addLinkReference(db, input, deps)]);
  assert.equal(a.reference.id, b.reference.id);
  assert.equal(await n(`select count(*)::int as n from agent_references where url = 'https://ejemplo.test/guia'`), 1);
});

test("PLA-136: two duplicates at once both land under their own name; two creates of one name give one skill and a code", async () => {
  const [x, y] = await Promise.all([skills.duplicateSkill(db, "tienda", "research-tienda", "cited-research"), skills.duplicateSkill(db, "tienda", "research-tienda", "cited-research")]);
  assert.notEqual(x, y);
  assert.deepEqual([x, y].sort(), ["cited-research-2", "cited-research-3"]);
  const body = { name: "Regla de prueba", description: "Cuando se prueba.", body: "1. Nada." };
  const both = await Promise.all([call("POST", `${T}/team/taller-tienda/skills`, body), call("POST", `${T}/team/taller-tienda/skills`, body)]);
  const statuses = both.map((r) => r.status).sort();
  assert.notEqual(statuses[1], 500, JSON.stringify(both.map((r) => r.json)));
  assert.equal(await n(`select count(*)::int as n from skills where slug = 'regla-de-prueba'`), 1);
  const lost = both.find((r) => r.status >= 400);
  if (lost) assert.equal(lost.json.error, "SKILL_EXISTS");
});

test("PLA-137: the store's search finds what the card shows", async () => {
  const lib = await import("../ui/src/lib/tienda.js");
  const sk = (slug: string, when: string) => ({ slug, name: slug, when, source: "kit", origin: "factory", version: "1", scope: null, carriers: [], runs_carried: 0, runs_used: 0 });
  const list = [sk("tdd", "Drives a code change through tests written first."), sk("pruebas-primero", "antes de cambiar código"), sk("verify-before-done", "Requires fresh proof before a delivery is declared done."), sk("pr", "Writes the pull request.")] as never;
  const find = (q: string) => lib.searchOf(list, q, "es").map((s: { slug: string }) => s.slug);
  assert.deepEqual(find("Pruebas primero"), ["pruebas-primero"]);
  assert.deepEqual(find("construir"), ["tdd"]);
  assert.deepEqual(find("pruebas").sort(), ["pruebas-primero", "tdd", "verify-before-done"]);
  assert.deepEqual(find("primero PRUEBAS"), ["pruebas-primero"]);
  assert.deepEqual(find("codigo"), ["tdd", "pruebas-primero", "pr"]);
  assert.deepEqual(find("pull request"), ["pr"]);
  assert.equal(find("   ").length, 4);
});

test("PLA-139: a wrapped level is joined by a spine inside the drawing, and every card hangs from its row's line", async () => {
  const o = await import("../ui/src/lib/organigrama.js");
  const m = (agent: string, role: string, reports_to: string) => ({ agent, role, template: role, reports_to, state: "idle" }) as never;
  const team = [m("po", "product-owner", "ceo"), ...["research", "artist", "taller", "qa", "copy", "marketing", "seguridad"].map((r) => m(r, r, "po"))];
  for (const width of [736, 836, 960]) {
    const l = o.layoutOf(o.treeOf(team), width, {});
    const h = l.lines.map((x: { d: string }) => /^M([\d.]+) ([\d.]+)H([\d.]+)$/.exec(x.d)).filter(Boolean).map((r: RegExpExecArray) => ({ x1: +r[1]!, y: +r[2]!, x2: +r[3]! }));
    const v = l.lines.map((x: { d: string }) => /^M([\d.]+) ([\d.]+)V([\d.]+)$/.exec(x.d)).filter(Boolean).map((r: RegExpExecArray) => ({ x: +r[1]!, y1: +r[2]!, y2: +r[3]! }));
    const rows = [...new Set(["research", "copy"].map((id) => l.boxes.get(id)!.y))];
    if (rows.length < 2) continue; // it fit on one row at this width
    const buses = h.filter((b: { y: number }) => b.y > 60).sort((a: { y: number }, b: { y: number }) => a.y - b.y);
    const spine = Math.min(...buses.map((b: { x1: number }) => b.x1));
    assert.ok(spine >= 4, `spine at ${spine} is on the edge (width ${width})`);
    const first = Math.min(...[...l.boxes.values()].filter((b: { id: string }) => !b.id.startsWith("__")).map((b: { x: number }) => b.x));
    assert.ok(spine < first, "the spine is left of the first card");
    assert.ok(v.some((s: { x: number; y1: number; y2: number }) => s.x === spine && s.y1 <= buses[0]!.y && s.y2 >= buses[buses.length - 1]!.y), "one spine joins every row's line");
    for (const id of ["research", "artist", "taller", "qa", "copy", "marketing", "seguridad"]) {
      const b = l.boxes.get(id)!;
      const cx = b.x + b.w / 2;
      const drop = v.find((s: { x: number; y2: number }) => Math.abs(s.x - cx) < 0.6 && s.y2 === b.y);
      assert.ok(drop, `${id} has a line into its top (width ${width})`);
      assert.ok(buses.some((bus: { y: number; x1: number; x2: number }) => bus.y === drop!.y1 && bus.x1 <= cx && bus.x2 >= cx - 0.6), `${id}'s line meets its row's line`);
    }
  }
});

test("PLA-140: a seat whose list became its own goes back to its role's factory set", async () => {
  const put = (packs: string[], own: boolean) => call("PUT", `${T}/team/research-tienda/packs`, { packs, own });
  const mine = await put(["cited-research", "tdd"], true);
  assert.equal(mine.status, 200);
  assert.equal(mine.json.own, true);
  const back = await put([], false);
  assert.equal(back.status, 200);
  assert.equal(back.json.own, false);
  assert.deepEqual(back.json.packs.map((p: { slug: string }) => p.slug), ["cited-research"]);
  assert.equal(await n(`select count(*)::int as n from agents where slug = 'research-tienda' and skill_packs = '{}'`), 1);
});
