// PLA-32: on Oficina the headline and the plates read one source (teammates whose run is live), and /ceo with no
// floor named opens on Oficina. Pure functions with fake data; no browser, no database.
import assert from "node:assert/strict";
import { test } from "node:test";

const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const lib = await load("lib/edificio.ts");
const home = await load("lib/home.ts");
const cityLib = await load("lib/city.ts");
const await_city = () => cityLib;

type Json = Record<string, any>;
const NOW = new Date("2026-11-10T18:00:00Z").getTime();
const member = (slug: string, role: string, state = "idle"): Json => ({ agent: `${role}-${slug}`, role, template: role, state, now: null, last: null, produced: null, waiting: null, queue: [] });
const project = (slug: string, team: Json[], patch: Json = {}): Json => ({
  slug, title: slug[0]!.toUpperCase() + slug.slice(1), paused: false, light: "ok", light_reason: null, goal: null, rumbo: null, usage: { used: 0 }, team,
  thread: { id: `t-${slug}`, unread: 0, last: null }, plan: null, route: null, this_week: { done: 0, docs: 0, prs: 0, last_at: null }, next: null, ready: [], work: { open: 0, in_progress: 0 }, orders: [], next_move: null, ...patch,
});
const headline = (projects: Json[], companyPaused = false) =>
  home.headlineOf({ projects: projects.map((p) => ({ slug: p.slug, title: p.title, tasks: [] })), flights: lib.workingNow(projects, companyPaused), inbox: { count: 0, by_project: {} }, totals: null, nowMs: NOW }).title as string;
const words = (projects: Json[], companyPaused = false) => projects.filter((p) => !p.paused).map((p) => lib.nowLine(p, [], NOW, { companyPaused }).state as string);

test("PLA-32 #1: the headline counts what the plates show: nobody, one, several, a paused floor, a paused company", () => {
  const nobody = [project("alba", [member("alba", "taller")]), project("brisa", [member("brisa", "product-owner")])];
  assert.equal(headline(nobody), "Nadie trabaja ahora.");
  assert.equal(words(nobody).includes("work"), false);

  const one = [project("alba", [member("alba", "taller", "running")]), project("brisa", [member("brisa", "taller")])];
  assert.match(headline(one), /^Un agente trabaja ahora\./);
  assert.deepEqual(words(one), ["work", words(one)[1]]);
  assert.notEqual(words(one)[1], "work");

  const several = [project("alba", [member("alba", "taller", "running"), member("alba", "research", "running")]), project("brisa", [member("brisa", "taller", "running")])];
  assert.match(headline(several), /^Tres agentes trabajan ahora\./i);
  assert.deepEqual(words(several), ["work", "work"]);

  // A paused floor is under the street: its running row does not count, as its plate is not drawn.
  const paused = [project("alba", [member("alba", "taller", "running")], { paused: true, light: "paused" }), project("brisa", [member("brisa", "taller")])];
  assert.equal(headline(paused), "Nadie trabaja ahora.");
  // The company paused: every plate says off and nobody works.
  assert.equal(headline(one, true), "Nadie trabaja ahora.");
  assert.deepEqual([...new Set(words(one, true))], ["off"]);
});

test("PLA-32 #2: /ceo opens on Oficina unless the address names a floor", () => {
  for (const s of ["", "?", "?edificio", "?asistente", "?doc=abc", "?nuevo", "?piso=alba&edificio"]) assert.equal(lib.oficinaOf(s), true, s);
  for (const s of ["?piso=alba", "?piso=alba&nivel=maquinas", "?f=member:taller-alba", "?m=alba:taller", "?plan=alba", "?add=alba", "?decision=d1"]) assert.equal(lib.oficinaOf(s), false, s);
});

test("PLA-32 #3: cranes come from the same reading: on the ticket's initiative, else the first tower; a tower with a crane stands", () => {
  const city = await_city();
  const tower = (key: string, working: boolean, agents: Json[] = []): Json => ({ key, slug: key.split("-")[0]!.toLowerCase(), title: key, working, agents, windows: [], columns: 2 });
  const districts = [
    { slug: "mia", title: "Mia", towers: [tower("MIA-I3", true, [{ key: "MIA-I3-9", agent: "claim-only" }]), tower("MIA-I4", false)] },
    { slug: "lum", title: "Lum", towers: [tower("LUM-I1", true)] },
    { slug: "cer", title: "Cer", towers: [tower("CER-I1", false)] },
  ];
  const out = city.crewCity(districts, [
    { slug: "mia", agent: "taller-mia", ticket: "MIA-I4-2", title: "Recordatorios" },
    { slug: "cer", agent: "po-cer", ticket: null, title: null },
  ]);
  const by = Object.fromEntries(out.map((d: Json) => [d.slug, d]));
  assert.deepEqual(by.mia.towers.map((t: Json) => [t.key, t.agents.map((a: Json) => a.agent)]), [["MIA-I3", []], ["MIA-I4", ["taller-mia"]]], "the claim-only crane is gone; MIA-I4 stands with its crane");
  assert.deepEqual(by.lum.towers.map((t: Json) => t.agents.length), [0], "nobody running, no crane");
  assert.deepEqual(by.cer.towers.map((t: Json) => [t.key, t.agents.map((a: Json) => a.agent)]), [["CER-I1", ["po-cer"]]], "a run with no ticket stands on the first tower");
});
