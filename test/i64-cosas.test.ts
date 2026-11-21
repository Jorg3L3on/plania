// PLA-I64-1: a project's things in one list (ui/src/lib/cosas.ts), pure. Cases shaped like Mianovia and Filmia on
// 2026-11-17 (fictional data): a quiet thing with its reason, a paused project, a pedido stuck at the valve with no
// live run, deliveries waiting inside an initiative, a loose step in review; a promoted idea never shows twice and
// never waits on «Constrúyelo»; groups and rows keep their order from one read to the next.
import assert from "node:assert/strict";
import { test } from "node:test";

const { cosasOf, GRUPOS, PARADAS } = (await import(new URL("../ui/src/lib/cosas.ts", import.meta.url).href)) as Record<string, any>;

const etapa = (e: string, over: Record<string, unknown> = {}) => ({ etapa: e, qa: null, holder: null, live: false, since: "2026-11-17T10:00:00Z", ci: null, reason: null, ...over });
const tk = (key: string, e: string, over: Record<string, unknown> = {}, et: Record<string, unknown> = {}) => ({ key, title: `Paso ${key}`, status: "Ready", phase: 1, parent_key: null, etapa: etapa(e, et), ...over });
const ini = (key: string, tickets: any[], over: Record<string, unknown> = {}) => ({
  key,
  title: `Iniciativa ${key}`,
  status: "Active",
  done: tickets.filter((t) => ["hecho", "publicado", "integrado"].includes(t.etapa.etapa)).length,
  total: tickets.length,
  tickets,
  ...over,
});
const member = (agent: string, role: string, ticket: string | null = null, run = "run-1") => ({ agent, role, template: role, state: ticket ? "running" : "idle", now: ticket ? { ticket, since: "2026-11-17T18:00:00Z", run_id: run } : null, last: null, produced: null, waiting: null });
const project = (slug: string, over: Record<string, unknown> = {}): any => ({
  slug,
  title: slug,
  paused: false,
  light: "ok",
  goal: null,
  usage: { used: 0 },
  team: [member(`po-${slug}`, "product-owner"), member(`taller-${slug}`, "taller")],
  thread: { id: "t", unread: 0, last: null },
  plan: null,
  this_week: { done: 0, docs: 0, prs: 0, last_at: null },
  next: null,
  work: { open: 0, in_progress: 0 },
  tablero: { initiatives: [], loose: [], loose_done: 0, done_initiatives: [] },
  pedidos: [],
  ...over,
});
const fIdea = (key: string, over: Record<string, unknown> = {}) => ({ key, title: `Idea ${key}`, stage: "ready", waits: "Lista para promover", updated_at: "2026-11-17T08:53:00Z", docs: { Idea: null, Research: null, Design: null, Plan: null }, summary: "", unseen: 0, promoted_to: null, origin: null, stop: null, state: null, guardada: false, question: null, ...over });
const delivery = (id: string, ref: string, slug: string) => ({ id, project: slug, title: `Entrega ${ref}`, kind: "deliverable", options: null, actions: ["aceptar", "cambios"], state: null, at: "2026-11-17T12:00:00Z", ref, detail: null });
const flat = (c: any) => c.grupos.flatMap((g: any) => g.cosas.map((x: any) => `${g.grupo}:${x.key}`));
const find = (c: any, key: string) => c.grupos.flatMap((g: any) => g.cosas).find((x: any) => x.key === key);

// Mianovia: a pedido stuck at the valve, two quiet initiatives (one in Backlog, one postponed), two done.
const mianovia = () => {
  const p = project("mianovia", {
    tablero: {
      initiatives: [
        ini("MIA-I1", [tk("MIA-1", "hecho"), tk("MIA-2", "hecho"), tk("MIA-3", "despues", { status: "Backlog", phase: 2, title: "Hosting, dominio y despliegue" }, { reason: "Está en Backlog: nadie la pasó a Lista." })]),
        ini("MIA-I5", [tk("MIA-10", "hecho"), tk("MIA-11", "pospuesto", { status: "Backlog", phase: 2, title: "Puesta en marcha en la boutique" }, { reason: "Espera a «Hosting, dominio y despliegue»" })]),
      ],
      loose: [],
      loose_done: 16,
      loose_done_title: "Arreglo del logo",
      done_initiatives: [
        { key: "MIA-I7", title: "Toda la app con piezas", done_at: "2026-11-17T15:00:00Z" },
        { key: "MIA-I2", title: "Formulario de bienvenida", done_at: "2026-11-16T12:00:00Z" },
      ],
    },
    pedidos: [{ key: "MIA-IDEA2", title: "Usuarios en el panel", stop: "lista", state: "valvula", who: "product-owner", images: 0, understood: null, question: null, guardada: false, at: "2026-11-17T08:53:00Z" }],
  });
  const ficha = {
    ideas: [fIdea("MIA-IDEA2", { origin: "owner", stop: "lista", state: "valvula" }), fIdea("MIA-IDEA1", { origin: "owner", promoted_to: "MIA-I7" })],
    promoted: [{ idea: "MIA-IDEA1", initiative: "MIA-I7" }, { idea: "MIA-IDEA0", initiative: "MIA-I1" }],
  };
  return { p, ficha };
};

test("I64-1 #1 Mianovia: the stuck pedido is yours with Despertar; quiet things say what they wait for", () => {
  const { p, ficha } = mianovia();
  const c = cosasOf({ p, decisions: [], ficha });
  assert.deepEqual(flat(c), ["toca:MIA-IDEA2", "quieto:MIA-I1", "quieto:MIA-I5"]);
  const stuck = find(c, "MIA-IDEA2");
  assert.equal(stuck.tipo, "pedido");
  assert.equal(stuck.hilo.valvula, "atorada");
  assert.equal(stuck.hilo.at, "valvula");
  assert.deepEqual(stuck.palanca, { kind: "despertar", key: "MIA-IDEA2" });
  const i1 = find(c, "MIA-I1");
  assert.equal(i1.espera, "Falta «Hosting, dominio y despliegue». Está en Backlog: nadie la pasó a Lista.");
  assert.deepEqual(i1.palanca, { kind: "lista", key: "MIA-3" }, "Pasar a Lista on a step that only sits in Backlog");
  assert.equal(i1.cap, "2 DE 3 · DESPUÉS");
  assert.equal(i1.idea_key, "MIA-IDEA0");
  assert.deepEqual(i1.hilo.tramos.map((t: any) => t.tono), ["hecho", "hecho", "quieto"]);
  const i5 = find(c, "MIA-I5");
  assert.match(i5.espera, /^Falta «Puesta en marcha en la boutique»\. Espera a «Hosting/);
  assert.equal(i5.palanca, null, "a step that waits on another is not passed to Lista from here");
  assert.deepEqual(c.hecho.iniciativas.map((h: any) => [h.key, h.idea_key]), [["MIA-I7", "MIA-IDEA1"], ["MIA-I2", null]]);
  assert.equal(c.hecho.sueltos, 16);
  assert.equal(c.abiertas, 3);
});

test("I64-1 #1 a valve with a live run moves; a pedido at Lista waits for «Constrúyelo»; a question is yours", () => {
  const { p, ficha } = mianovia();
  p.team = [member("po-mianovia", "product-owner", "MIA-IDEA2", "run-po")];
  const moving = find(cosasOf({ p, decisions: [], ficha }), "MIA-IDEA2");
  assert.equal(moving.grupo, "mueve");
  assert.deepEqual(moving.palanca, { kind: "detener", run: "run-po" });
  const p2 = project("mianovia");
  const f2 = { ideas: [fIdea("MIA-IDEA3", { origin: "owner", stop: "lista", state: "quieta" }), fIdea("MIA-IDEA4", { stage: "design", stop: "diseno", state: "espera", question: { id: "q1", text: "¿Azul o verde?" } }), fIdea("MIA-IDEA5", { stage: "research", stop: "investigacion", state: "quieta", waits: "Doc Research" }), fIdea("MIA-IDEA6", { stage: null, stop: "buzon", state: "cola", origin: "owner" })], promoted: [] };
  const c = cosasOf({ p: p2, decisions: [], ficha: f2 });
  assert.deepEqual(find(c, "MIA-IDEA3").palanca, { kind: "construir", key: "MIA-IDEA3" });
  assert.equal(find(c, "MIA-IDEA3").grupo, "toca");
  assert.deepEqual([find(c, "MIA-IDEA4").grupo, find(c, "MIA-IDEA4").espera, find(c, "MIA-IDEA4").tipo], ["toca", "¿Azul o verde?", "idea"]);
  assert.deepEqual([find(c, "MIA-IDEA5").grupo, find(c, "MIA-IDEA5").espera], ["quieto", "Nadie la trabaja. Falta el doc Research."]);
  assert.deepEqual(find(c, "MIA-IDEA5").palanca, { kind: "despertar", key: "MIA-IDEA5" });
  assert.equal(find(c, "MIA-IDEA6").grupo, "fila");
  assert.equal(find(c, "MIA-IDEA6").hilo.idea, 0);
});

test("I64-1 #1 Filmia paused: seven deliveries in one initiative are yours; the rest waits in line; a loose step in review needs nothing", () => {
  const steps = [1, 2, 3, 4, 5, 6, 7].map((n) => tk(`FIL-${n}`, "te_toca", { phase: n }, { reason: "Entregada: espera que la aceptes." }));
  const p = project("filmia", {
    paused: true,
    team: [member("taller-filmia", "taller", "FIL-40")],
    tablero: {
      initiatives: [ini("FIL-I60", [...steps, tk("FIL-8", "lista", { phase: 8 })]), ini("FIL-I50", [tk("FIL-20", "hecho"), tk("FIL-21", "lista", { phase: 2 })]), ini("FIL-I42", [tk("FIL-40", "despues", { status: "Backlog" }, { reason: "Está en Backlog: nadie la pasó a Lista.", live: true })])],
      loose: [tk("FIL-35", "en_revision", {}, { reason: "Las pruebas del PR corren." }), tk("FIL-36", "hecho")],
      loose_done: 3,
      done_initiatives: [],
    },
  });
  const decisions = [1, 2, 3, 4, 5, 6, 7].map((n) => delivery(`d${n}`, `FIL-${n}`, "filmia"));
  const c = cosasOf({ p, decisions, ficha: { ideas: [], promoted: [{ idea: "FIL-IDEA9", initiative: "FIL-I50" }] } });
  assert.deepEqual(flat(c), ["toca:FIL-I60", "fila:FIL-35", "fila:FIL-I50", "quieto:FIL-I42"]);
  const i60 = find(c, "FIL-I60");
  assert.deepEqual(i60.palanca, { kind: "entregas", ids: ["d1", "d2", "d3", "d4", "d5", "d6", "d7"] });
  assert.equal(i60.cap, "0 DE 8 · 7 TE ESPERAN");
  assert.equal(i60.decisions.length, 7);
  assert.equal(find(c, "FIL-I50").espera, "«Paso FIL-21» está lista: arranca cuando reanudes.");
  assert.equal(find(c, "FIL-I50").idea_key, "FIL-IDEA9");
  assert.equal(find(c, "FIL-I50").hilo.idea, 5, "born from an idea: the idea stops are behind it");
  assert.equal(find(c, "FIL-35").tipo, "suelto");
  assert.equal(find(c, "FIL-35").espera, "Las pruebas del PR corren. No te necesita.");
  assert.equal(find(c, "FIL-I42").grupo, "quieto", "a paused project moves nothing, even with a run still marked live");
  assert.equal(c.grupos.find((g: any) => g.grupo === "mueve").cosas.length, 0);
});

test("I64-1 #1 the server's move, Cerrar, a request nobody took, a stray question and Publicar", () => {
  const p = project("micasa", {
    next_move: { verbo: "aceptar", texto: "Acepta MIC-5", accion: { kind: "decision", id: "d5", action: "aceptar", label: "Aceptar" }, origen: { kind: "decision", id: "d5", decision: "deliverable" } },
    stale_requests: [{ key: "MIC-9", title: "Cambiar el color", since: "2026-11-16T10:00:00Z" }],
    tablero: { initiatives: [ini("MIC-I1", [tk("MIC-5", "te_toca")]), ini("MIC-I2", [tk("MIC-6", "hecho")], { can_close: true, version: 4 })], loose: [], loose_done: 0, done_initiatives: [] },
  });
  const decisions = [delivery("d5", "MIC-5", "micasa"), { ...delivery("q1", "", "micasa"), ref: null, kind: "question", actions: ["responder"], title: "¿Qué dominio?", asker: { agent: "po", role: "product-owner" } }, { ...delivery("r1", "", "micasa"), ref: null, kind: "release", actions: [], title: "Publicar MiCasa" }];
  const c = cosasOf({ p, decisions, ficha: { ideas: [], promoted: [] } });
  assert.deepEqual(find(c, "MIC-I1").palanca, { kind: "jugada", action: p.next_move.accion, decision: "d5" });
  assert.equal(c.grupos[0].cosas[0].key, "MIC-I1", "the server's move leads Te toca (one white button, the sentence's)");
  assert.deepEqual(find(c, "MIC-I2").palanca, { kind: "cerrar", key: "MIC-I2", version: 4 });
  assert.deepEqual(find(c, "MIC-9").palanca, { kind: "reenviar", key: "MIC-9" });
  assert.equal(find(c, "q1").tipo, "decision");
  assert.equal(find(c, "q1").cap, "PO PREGUNTA");
  assert.deepEqual(find(c, "publicar").palanca, { kind: "publicar" });
  assert.ok(c.grupos[0].cosas.every((x: any) => x.grupo === "toca"));
  assert.equal(c.grupos[0].cosas.length, 5);
});

test("I64-1 #2 #3 a promoted idea is not a row of its own and never waits on «Constrúyelo»", () => {
  const { p, ficha } = mianovia();
  const c = cosasOf({ p, decisions: [], ficha });
  const all = c.grupos.flatMap((g: any) => g.cosas);
  assert.ok(!all.some((x: any) => x.key === "MIA-IDEA1"), "MIA-IDEA1 became MIA-I7: no row of its own");
  assert.ok(!all.some((x: any) => x.palanca?.kind === "construir" && x.key === "MIA-IDEA1"));
  // Even if the tube still lists it (an older server), a promoted idea in the ficha hides its pedido.
  const p2 = { ...p, pedidos: [...p.pedidos, { key: "MIA-IDEA1", title: "x", stop: "lista", state: "quieta", who: "po", images: 0, understood: null, question: null, guardada: false, at: "2026-11-10T10:00:00Z" }] };
  const c2 = cosasOf({ p: p2, decisions: [], ficha });
  const rows2 = c2.grupos.flatMap((g: any) => g.cosas);
  assert.ok(!rows2.some((x: any) => x.key === "MIA-IDEA1"));
  assert.ok(!rows2.some((x: any) => /Constrúyelo/.test(x.espera) && x.key !== "MIA-IDEA2"));
});

test("I64-1 #4 groups always in one order; rows stable between reads (input order does not matter)", () => {
  assert.deepEqual([...GRUPOS], ["toca", "mueve", "fila", "quieto", "hecho"]);
  assert.equal(PARADAS.length, 9);
  const { p, ficha } = mianovia();
  const a = cosasOf({ p, decisions: [], ficha });
  const b = cosasOf({ p: { ...p, tablero: { ...p.tablero, initiatives: [...p.tablero.initiatives].reverse() } }, decisions: [], ficha: { ...ficha, ideas: [...ficha.ideas].reverse() } });
  assert.deepEqual(a.grupos.map((g: any) => g.grupo), ["toca", "mueve", "fila", "quieto"]);
  assert.deepEqual(flat(a), flat(b));
  assert.deepEqual(a, cosasOf({ p, decisions: [], ficha }));
});

test("I64-1 while the ficha loads, the pedidos stand in; a shelved request is counted, not listed", () => {
  const { p } = mianovia();
  p.pedidos.push({ key: "MIA-IDEA8", title: "Guardada", stop: "plan", state: "quieta", who: "po", images: 0, understood: null, question: null, guardada: true, at: "2026-11-10T10:00:00Z" });
  const c = cosasOf({ p, decisions: [], ficha: null });
  assert.equal(find(c, "MIA-IDEA2").grupo, "toca");
  assert.equal(c.guardadas, 1);
  assert.ok(!find(c, "MIA-IDEA8"));
});

// ---- PLA-I64-3: the sentence on top.
const { fraseOf } = (await import(new URL("../ui/src/lib/cosas.ts", import.meta.url).href)) as Record<string, any>;
const NOW = Date.parse("2026-11-17T13:18:00Z");
const quiet = { state: "idle", say: "Nadie tiene trabajo ahora.", why: "" };

test("I64-3 #1 the sentence: quiet, someone working, paused with deliveries, empty, a stuck pedido", () => {
  // Mianovia: stuck pedido (since 08:53Z → 4 h), nobody works, steps left.
  const { p, ficha } = mianovia();
  const f = fraseOf(p, cosasOf({ p, decisions: [], ficha }), quiet, { now: NOW, totals: { open: 2, done: 46 } });
  assert.deepEqual(f, { mueve: "Nadie trabaja ahora.", toca: "Tu «Constrúyelo» lleva 4 h sin subir al tablero.", falta: "Faltan 2 pasos de 48 para terminar mianovia. Falta «Hosting, dominio y despliegue». Está en Backlog: nadie la pasó a Lista." });
  // Someone works: today's line says who (nowLine, wrapped as is).
  const w = project("micasa", { team: [member("taller-micasa", "taller", "MIC-1")], tablero: { initiatives: [ini("MIC-I1", [tk("MIC-1", "construyendo", {}, { live: true }), tk("MIC-2", "lista")])], loose: [], loose_done: 0, done_initiatives: [] } });
  const fw = fraseOf(w, cosasOf({ p: w, decisions: [], ficha: { ideas: [], promoted: [] } }), { state: "work", say: "Taller construye «Paso MIC-1».", why: "Trabaja 20 min." }, { now: NOW, totals: { open: 2, done: 0 } });
  assert.equal(fw.mueve, "Taller construye «Paso MIC-1».");
  assert.equal(fw.toca, null, "amber only when something waits on him");
  // Filmia paused with seven deliveries.
  const steps = [1, 2, 3, 4, 5, 6, 7].map((n) => tk(`FIL-${n}`, "te_toca", { phase: n }));
  const fp = project("filmia", { title: "Filmia", paused: true, tablero: { initiatives: [ini("FIL-I60", steps), ini("FIL-I50", [tk("FIL-21", "lista")])], loose: [], loose_done: 0, done_initiatives: [] } });
  const ff = fraseOf(fp, cosasOf({ p: fp, decisions: [1, 2, 3, 4, 5, 6, 7].map((n) => delivery(`d${n}`, `FIL-${n}`, "filmia")), ficha: { ideas: [], promoted: [] } }), { state: "off", say: "Este proyecto está en pausa.", why: "Nada arranca hasta que lo reanudes." }, { now: NOW });
  assert.deepEqual(ff, { mueve: "Filmia está en pausa.", toca: "Siete entregas te esperan.", falta: "Puedes aceptarlas en pausa. Nada nuevo arranca hasta que lo reanudes: una cosa tiene un paso listo." });
  // Empty.
  const e = project("nueva", { title: "Tienda Nueva" });
  const fe = fraseOf(e, cosasOf({ p: e, decisions: [], ficha: { ideas: [], promoted: [] } }), quiet, { now: NOW });
  assert.deepEqual(fe, { mueve: "Todavía no hay nada aquí.", toca: null, sub: "Pide lo primero y se vuelve una fila.", falta: "Cada cosa que pidas avanza sola de Buzón a Lista. Nadie escribe código hasta que digas «Constrúyelo»." });
  // Only quiet things: what they wait for.
  const q = project("workia", { tablero: { initiatives: [ini("WRK-I1", [tk("WRK-1", "despues", { status: "Backlog", title: "Alta" }, { reason: "Está en Backlog: nadie la pasó a Lista." })])], loose: [], loose_done: 0, done_initiatives: [] } });
  assert.equal(fraseOf(q, cosasOf({ p: q, decisions: [], ficha: { ideas: [], promoted: [] } }), quiet, { now: NOW, totals: { open: 1, done: 0 } }).falta, "Falta 1 paso de 1 para terminar workia. Falta «Alta». Está en Backlog: nadie la pasó a Lista.");
});

test("I64-3 #3 amber only when something is the owner's", () => {
  const { p, ficha } = mianovia();
  p.pedidos = [];
  const f2 = { ...ficha, ideas: ficha.ideas.filter((i: any) => i.key !== "MIA-IDEA2") };
  assert.equal(fraseOf(p, cosasOf({ p, decisions: [], ficha: f2 }), quiet, { now: NOW, totals: null }).toca, null);
  const withMove = fraseOf(p, cosasOf({ p, decisions: [], ficha }), { state: "you", say: "Despierta al PO.", why: "" }, { now: NOW, totals: null });
  assert.ok(withMove.toca);
});

test("I64-7: a server move that is no decision (start, plan, goal) is a Te toca row; an empty project gets none", () => {
  const p = project("workia", {
    next_move: { verbo: "arrancar", texto: "Que Taller empiece «Alta».", accion: { kind: "start", agent: "taller-workia", label: "Que empiece ya" }, origen: { kind: "hold", agent: "taller-workia", hold: "rest" } },
    tablero: { initiatives: [ini("WRK-I1", [tk("WRK-1", "lista")])], loose: [], loose_done: 0, done_initiatives: [] },
  });
  const c = cosasOf({ p, decisions: [], ficha: { ideas: [], promoted: [] } });
  assert.deepEqual(find(c, "jugada").palanca, { kind: "jugada", action: p.next_move.accion, decision: null });
  assert.equal(c.grupos[0].cosas[0].key, "jugada");
  const e = project("nueva", { next_move: { verbo: "planear", texto: "Pide el plan.", accion: { kind: "plan", text: "x", label: "Arma el plan" }, origen: { kind: "route", leg: "x" } } });
  assert.equal(cosasOf({ p: e, decisions: [], ficha: { ideas: [], promoted: [] } }).abiertas, 0);
});

test("PLA-62 #4: a stuck pedido's clock is its «Constrúyelo», not the idea's last edit", () => {
  const p = project("mianovia");
  const ficha = { ideas: [fIdea("MIA-IDEA2", { origin: "owner", stop: "lista", state: "valvula", updated_at: "2026-11-17T17:00:00Z", ordered_at: "2026-11-17T08:53:00Z" })], promoted: [] };
  const c = cosasOf({ p, decisions: [], ficha });
  assert.equal(find(c, "MIA-IDEA2").since, "2026-11-17T08:53:00Z");
  assert.equal(fraseOf(p, c, quiet, { now: Date.parse("2026-11-17T13:18:00Z") }).toca, "Tu «Constrúyelo» lleva 4 h sin subir al tablero.");
  // Without the event (an older server) it falls back to the idea's time.
  const f2 = { ideas: [fIdea("MIA-IDEA2", { origin: "owner", stop: "lista", state: "valvula", updated_at: "2026-11-17T12:00:00Z" })], promoted: [] };
  assert.equal(find(cosasOf({ p, decisions: [], ficha: f2 }), "MIA-IDEA2").since, "2026-11-17T12:00:00Z");
});

// PLA-I68-1: a release that carries migrations with nobody named to migrate production waits: its row says so and its
// lever is the setting, never Publicar.
test("Publicar espera: migrations and no production path turn the row's lever into the setting", () => {
  const p = project("micasa");
  const rel = (prod: string | null) => ({ ...delivery("r1", "", "micasa"), ref: null, kind: "release", actions: [], title: "Publicar MiCasa", release: { from: "sandbox", into: "main", env: "prod", ahead: 2, tickets: [], open_checks: 0, before: 0, migrations: ["0007"], migrate: null, prod_migrations: prod } });
  const waits = cosasOf({ p, decisions: [rel(null)], ficha: { ideas: [], promoted: [] } }, "es").grupos[0].cosas.find((x: any) => x.key === "publicar");
  assert.equal(waits.title, "Publicar espera");
  assert.equal(waits.espera, "Lleva cambios a la base y nadie dijo quién migra producción.");
  // PLA-132: the setting is Despliegue's production environment.
  assert.deepEqual(waits.palanca, { kind: "camino", sec: "resumen", label: "Decir quién migra" });
  const ok = cosasOf({ p, decisions: [rel("deploy")], ficha: { ideas: [], promoted: [] } }, "es").grupos[0].cosas.find((x: any) => x.key === "publicar");
  assert.equal(ok.title, "Publicar MiCasa");
  assert.deepEqual(ok.palanca, { kind: "publicar" });
});
