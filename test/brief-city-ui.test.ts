// PLA-I51: the Morning brief as the city at dawn (ui/src/components/brief/city.tsx, ui/src/lib/brief-city.ts).
// Server-rendered with react-dom/server against the §17 sample with v2 targets and fake state replies; the pure model
// (stations, windows, counts, picking, keys) is called directly. No browser, no database: the clicks themselves (every
// action of the registry pressed from the ficha with fake writes, keys, undo, the task sheet, axe) run in the
// real-browser pass on the demo server and are recorded as Plania results.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { React?: unknown }).React = React;
const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const city = await load("components/brief/city.tsx");
const model = await load("lib/brief-city.ts");
const marks = await load("components/plania-mark.tsx");
const i18n = await load("lib/brief-i18n.ts");
const pageMod = await load("pages/brief.tsx");

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, null, el)));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const sample = JSON.parse(readFileSync(new URL("./fixtures/brief-sample.json", import.meta.url), "utf8"));
const noop = () => {};
type Json = Record<string, any>;

// The sample with v2 targets and a blocker on MiCasa.
const data = {
  ...sample,
  version: 2,
  language: "es",
  items: sample.items.map((i: Json, n: number) =>
    n === 2 ? { ...i, status: "blocker", targets: [{ kind: "release", project: "micasa" }] } : n === 5 ? { ...i, targets: [{ kind: "ticket", project: "workia", key: "WRK-13" }] } : i,
  ),
};
const LEVEL: Record<string, string> = { publish: "confirm", accept_pr: "confirm", fix_finding: "confirm", resume_runs: "confirm", add_to_pr: "confirm", request_changes: "confirm", give_to_po: "wake", start_now: "wake", start_building: "wake" };
const open = (actions: string[], live: Json | null = null) => ({
  state: "open",
  line: null,
  actions: actions.map((id) => ({ id, level: LEVEL[id] ?? "instant", undo: true, target: ["later", "dismiss"].includes(id) ? null : 0, ...(LEVEL[id] === "wake" ? { wake: { agent: id === "give_to_po" ? "po-demo" : "taller-demo", role: null, low: 10, high: 25, paused: false, company_paused: false, busy: false } } : {}) })),
  action_id: null,
  undo: false,
  live,
});
const handled = (action: string) => ({ ...open([]), state: "handled", line: `${action} hecho`, at: "2026-11-13T13:10:00Z", action, action_id: "a-1", undo: true });
const stateOf = (items: Json, extra: Json = {}) => ({ brief_id: "b1", read_only: false, items, ideas: {}, in_motion: [], ...extra });
const ids = data.items.map((i: Json) => i.id);

function props(over: Json = {}) {
  return {
    data,
    briefId: "b1",
    state: undefined,
    stateLoading: false,
    checks: [],
    language: "es",
    readOnly: false,
    stamp: "vie · 13 nov · 07:04 CDMX",
    run: null,
    lastRun: null,
    generating: false,
    canGenerate: true,
    onGenerate: noop,
    history: [],
    todayDate: "2026-11-13",
    date: null,
    onDate: noop,
    onSettings: noop,
    banner: null,
    onRetry: noop,
    onAct: async () => ({ status: "done" }),
    onUndo: async () => ({}),
    acting: false,
    ideaCost: () => ({ bots: 1, low: 10, high: 25 }),
    plans: new Map(),
    ...over,
  };
}
const render = (over: Json = {}) => html(h(city.BriefCity, props(over)));

// ---- PLA-I51-1: house look and Spanish

/** Every key of a label table, nested, with the type of each value. */
function shape(t: unknown): unknown {
  if (t && typeof t === "object" && !Array.isArray(t)) return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, shape(v)]).sort());
  return Array.isArray(t) ? `array:${t.length}` : typeof t;
}
function strings(t: unknown): string[] {
  if (typeof t === "string") return [t];
  if (typeof t === "function") {
    const out = (t as (...a: unknown[]) => unknown)(2, { blocked: 1, needs: 2, next: 1, ideas: 3 });
    return Array.isArray(out) ? out.map((p: Json) => p.text) : [String(out)];
  }
  if (t && typeof t === "object") return Object.values(t).flatMap(strings);
  return [];
}

test("PLA-I51-1 check 1: every V3 label exists in es and en, and none is empty", () => {
  const es = i18n.BRIEF_LABELS.es.c;
  const en = i18n.BRIEF_LABELS.en.c;
  assert.deepEqual(shape(es), shape(en));
  assert.ok(Object.keys(es).length >= 50);
  for (const [lang, table] of [["es", es], ["en", en]] as const) for (const s of strings(table)) assert.ok(s.trim().length > 0, `${lang}: empty label`);
  // The words the sketch uses.
  const all = strings(es).join(" | ");
  for (const w of ["Pendientes", "Nuevas", "Ya en Plania", "Leído de Plania ahora", "Dásela a", "Dáselo a", "al día", "Tu mesa está limpia.", "Pendientes e ideas", "Solo pendientes", "Solo ideas", "Entre apps", "Cómo arreglarlo"]) assert.ok(all.includes(w), w);
  // The voice line: colours on blockers and the owner's turn, "y" before the last part, a capital and a full stop.
  const v = es.voice({ blocked: 1, needs: 2, next: 0, ideas: 3 });
  assert.equal(v.map((p: Json) => p.text).join(""), "Un bloqueo va primero, dos cosas te tocan y hay tres ideas nuevas.");
  assert.deepEqual(v.filter((p: Json) => p.tone).map((p: Json) => p.tone), ["blocked", "jorge"]);
  assert.equal(en.voice({ blocked: 0, needs: 1, next: 1, ideas: 0 }).map((p: Json) => p.text).join(""), "One thing is your turn and one is next.");
  assert.equal(es.tower("Filmia", { blocked: 0, needs: 0, next: 0, ideas: 0 }), "Filmia: al día");
});

test("PLA-I51-1 check 3: ProjectMark draws Plania's mark, a monogram only when asked, and the cross mark", () => {
  const plania = html(h(marks.ProjectMark, { slug: "plania" }));
  assert.match(plania, /<svg/);
  assert.match(plania, /#5B6CFF/i, "Plania's own gradient");
  assert.equal(marks.hasProjectMark("plania"), true);
  assert.equal(marks.projectBrandAccent("plania"), "#a58bff");
  assert.notEqual(marks.projectBrandAccent("plania"), marks.projectBrandAccent("micasa"));
  // Inicio keeps nothing for a project without a logo; the brief asks for the monogram.
  assert.equal(html(h(marks.ProjectMark, { slug: "mianovia" })), "");
  const mono = html(h(marks.ProjectMark, { slug: "mianovia", name: "Mianovia", fallback: true }));
  assert.match(mono, /<text[^>]*>M<\/text>/);
  assert.match(html(h(marks.CrossMark, {})), /<circle/);
  // Inicio's tiles (ciudad.tsx, parts.tsx) render ProjectMark by slug, so Plania's mark shows there with no change.
  for (const f of ["components/home/ciudad.tsx", "components/home/parts.tsx"]) assert.match(readFileSync(new URL(`../ui/src/${f}`, import.meta.url), "utf8"), /<ProjectMark slug=/);
});

test("the brief's apps take Inicio's accent and the logo's stops; Entre apps is neutral; slots are not used", () => {
  const style = city.appColors("filmia");
  assert.equal(style["--app"], "#FF6A3D");
  assert.equal(style["--from"], "#FF6A3D");
  assert.equal(style["--to"], "#C4237F");
  assert.match(city.appColors("cross")["--app"], /status-idle/);
  const src = readFileSync(new URL("../ui/src/components/brief/city.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /slotVar|--brief-c\d/, "no colour by slot c0..c5");
  const out = render({ state: stateOf({}) });
  assert.match(text(out), /Entre apps/);
  assert.doesNotMatch(text(out), /Cross-app/);
});

// ---- PLA-I51-2: the sky

test("PLA-I51-2 check 1 and 2: one window per row with its tone, handled rows pale, counts by kind, al día", () => {
  const st = stateOf({ [ids[0]]: handled("answer"), [ids[1]]: open(["later"]) }, { ideas: { [data.ideas[3].id]: { state: "kept", line: "Guardada", key: "FIL-IDEA9", action_id: "x", undo: true, at: "2026-11-13T13:00:00Z", project: "filmia", paused: false } } });
  const list = model.stations(data, st);
  assert.deepEqual(list.map((s: Json) => s.slug), ["workia", "zigzag", "filmia", "micasa", "cross"]);
  const filmia = list.find((s: Json) => s.slug === "filmia");
  // items (blockers first, then brief order), then ideas.
  assert.equal(filmia.windows.length, filmia.items.length + filmia.ideas.length);
  assert.deepEqual(filmia.windows.map((w: Json) => w.tone), ["lit", "jorge", "ready", "lit", "review"]);
  assert.deepEqual(filmia.counts, { blocked: 0, needs: 1, next: 1, ideas: 1 });
  const micasa = list.find((s: Json) => s.slug === "micasa");
  assert.equal(micasa.windows[0].tone, "blocked");
  // The page opens on the first project with a blocker.
  assert.equal(model.firstStation(list), list.indexOf(micasa));
  const out = render({ state: st });
  assert.equal((out.match(/class="bc-w"/g) ?? []).length, data.items.length + data.ideas.length);
  assert.match(out, /data-station="micasa"[^>]*|aria-selected="true"[^>]*data-station="micasa"/);
  assert.match(out, /role="tab" id="bc-tab-micasa" aria-selected="true"/);
  assert.match(out, /aria-label="Filmia: 1 te toca, 1 sigue, 1 idea"/);
  // Everything handled on a project: "al día".
  const all = Object.fromEntries(data.items.filter((i: Json) => i.app === "workia").map((i: Json) => [i.id, handled("later")]));
  const ideasDone = Object.fromEntries(data.ideas.filter((i: Json) => i.app === "workia").map((i: Json) => [i.id, { state: "discarded", line: "x", key: null, action_id: "y", undo: true, at: null, project: "workia", paused: false }]));
  const w = render({ state: stateOf(all, { ideas: ideasDone }) });
  assert.match(text(w), /Workia ✓ al día/);
  assert.match(w, /aria-label="Workia: al día"/);
});

test("PLA-I51-2 check 3: Generar is a menu of passes with their time, and is disabled while a run is live", () => {
  const menu = text(render({ initial: { pop: "gen" } }));
  assert.match(menu, /Generar ahora · usa tu plan, \$0/);
  assert.match(menu, /Pendientes e ideas unos 3 min/);
  assert.match(menu, /Solo pendientes 1 min/);
  assert.match(menu, /Solo ideas 2 min/);
  const src = readFileSync(new URL("../ui/src/components/brief/city.tsx", import.meta.url), "utf8");
  assert.match(src, /\["brief", c\.genBrief, \["brief"\]\]/);
  assert.match(src, /\["ideas", c\.genIdeas, \["ideas"\]\]/);
  const live = render({ run: { id: "r", status: "running", started_at: new Date().toISOString(), waiting_for_build: false }, initial: { pop: "gen" } });
  assert.match(live, /disabled=""[^>]*data-brief="generate"/);
  assert.doesNotMatch(live, /data-brief="gen-menu"/);
  assert.match(live, /data-brief="sun" data-busy=""|data-busy="" data-brief="sun"/);
});

test("PLA-I51-2 check 4: the sun and the sky follow handled over total; reduced motion turns movement off", () => {
  const none = render({ state: stateOf({}) });
  assert.match(none, /--p:0\.000/);
  const st = stateOf({ [ids[0]]: handled("answer"), [ids[1]]: handled("later") });
  const two = render({ state: st });
  const total = data.items.length + data.ideas.length;
  assert.match(two, new RegExp(`--p:${(2 / total).toFixed(3)}`));
  assert.deepEqual(model.skyCounts(model.stations(data, st)), { left: total - 2, handled: 2, total, p: 2 / total });
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.match(css, /\.bc-sun \{[^}]*left: calc\(14% \+ var\(--p\) \* 69%\)/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.bc \*, \.bc \*::before, \.bc \*::after \{ animation: none !important; transition: none !important; \}/);
  // No entrance starts at opacity 0.
  assert.doesNotMatch(css.slice(css.indexOf("PLA-I51: the Morning brief as the city")), /from \{[^}]*opacity: 0/);
});

// ---- PLA-I51-3: la mesa and la ficha

test("PLA-I51-3: the ficha of a release shows the evidence, Hazlo tú with the first solid, Dáselo a only with wake actions, Guárdalo", () => {
  const live = { kind: "release", pending: true, unknown: false, ready: true, reason: null, ahead: 10, tickets: ["MIC-I16-1"], migrations: ["0031"], before: 0, open_checks: 0, from: "sandbox", into: "main", env: "prod" };
  const out = render({ state: stateOf({ [ids[2]]: open(["publish", "later", "dismiss"], live) }) });
  const s = text(out);
  assert.match(s, /Leído de Plania ahora/);
  assert.match(s, /sandbox → main · prod · 10 adelante/);
  assert.match(out, /data-solid="true"[^>]*data-act="publish"|data-act="publish"[^>]*data-solid/);
  assert.match(s, /Hazlo tú/);
  assert.match(s, /Guárdalo Después L No aplica X/);
  assert.doesNotMatch(s, /Dáselo a/, "check 4: no teammate without a wake action");
  assert.match(s, /1 de 2/, "position in the project");
  const withPo = text(render({ state: stateOf({ [ids[2]]: open(["publish", "give_to_po", "later", "dismiss"], live) }) }));
  assert.match(withPo, /Dáselo a .*Dárselo al PO po-demo · 10–25 min/);
  assert.doesNotMatch(withPo, /Empezar ya/);
});

test("PLA-I51-3: confirm, answer, changes, wake and failure boxes keep V2's texts", () => {
  const live = { kind: "release", pending: true, unknown: false, ready: true, reason: null, ahead: 10, tickets: ["MIC-I16-1", "MIC-I16-2"], migrations: ["0031"], before: 0, open_checks: 0, from: "sandbox", into: "main", env: "prod" };
  const st = stateOf({ [ids[2]]: open(["publish", "give_to_po"], live) });
  assert.match(text(render({ state: st, initial: { pending: { kind: "confirm", action: "publish", target: 0 } } })), /Esto fusiona sandbox en main para MiCasa: 2 tickets, migraciones 0031\. Prod se despliega desde main\./);
  const failed = render({ state: st, initial: { pending: { kind: "failed", action: "publish", target: 0, error: "X", hint: "GitHub rechazó el merge" } } });
  assert.match(text(failed), /No se pudo: GitHub rechazó el merge Nada cambió\. Intentar otra vez/);
  assert.match(failed, /role="alert"/);
  const wake = text(render({ state: st, initial: { pending: { kind: "wake", action: "give_to_po", target: 0 } } }));
  assert.match(wake, /Despierta a po-demo · unos 10–25 min · usa tu plan, \$0/);
  assert.match(wake, /Una nota para el PO/);
  const q = { kind: "question", question: "¿Lo mandamos?", options: ["sí", "no"], human_only: false, answered: false, answer: null, key: "WRK-1" };
  const ans = render({ initial: { station: "workia", card: ids[3], pending: { kind: "answer", target: 0 } }, state: stateOf({ [ids[3]]: open(["answer"], q) }) });
  assert.equal((ans.match(/data-act="option-\d"/g) ?? []).length, 2);
  assert.match(text(ans), /O escríbela/);
  const ch = text(render({ initial: { station: "workia", card: ids[3], pending: { kind: "changes", target: 0 } }, state: stateOf({ [ids[3]]: open(["request_changes"]) }) }));
  assert.match(ch, /¿Qué debe cambiar\? Vuelve a su dueño con tu nota\./);
});

test("PLA-I51-3: a handled card stays in place, dashed, with its stamp and time; the ficha says it and offers Deshacer", () => {
  const out = render({ initial: { station: "filmia", card: ids[0] }, state: stateOf({ [ids[0]]: handled("answer"), [ids[1]]: open(["step_done"]) }) });
  assert.match(out, new RegExp(`data-done="true" data-card="${ids[0].replace(/\|/g, "\\|")}"`));
  assert.match(out, /class="bc-tag bc-go">Respondido/);
  assert.match(out, /data-brief="stamp"/);
  assert.match(text(out), /answer hecho · a las \d\d:\d\d · Deshacer/);
});

test("PLA-I51-3 check 3: the keys, and nothing while typing", () => {
  const k = (key: string, tagName = "BODY", extra: Json = {}) => model.keyCommand({ key, target: { tagName }, ...extra });
  assert.equal(k("j"), "next");
  assert.equal(k("ArrowDown"), "next");
  assert.equal(k("K"), "prev");
  assert.equal(k("ArrowRight"), "nextProject");
  assert.equal(k("ArrowLeft"), "prevProject");
  assert.equal(k("Enter"), "primary");
  assert.equal(k("Enter", "BUTTON"), null, "Enter on a focused button presses that button");
  assert.equal(k("l"), "later");
  assert.equal(k("x"), "dismiss");
  assert.equal(k("z"), "undo");
  for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) for (const key of ["j", "k", "Enter", "l", "x", "z", "ArrowRight"]) assert.equal(k(key, tag), null, `${key} in ${tag}`);
  assert.equal(model.keyCommand({ key: "j", target: { tagName: "DIV", isContentEditable: true } }), null);
  assert.equal(k("z", "BODY", { metaKey: true }), null);
  assert.equal(k("Escape", "TEXTAREA"), "escape");
});

test("PLA-I51-3: picking walks the project's cards; after an action the next open card is picked", () => {
  const st = stateOf({ [ids[1]]: handled("step_done") });
  const filmia = model.stations(data, st).find((s: Json) => s.slug === "filmia");
  const cards = model.cardsOf(filmia).map((c: Json) => c.id);
  assert.equal(model.pickCard(filmia, null).id, cards[0]);
  assert.equal(model.pickCard(filmia, "gone").id, cards[0]);
  assert.equal(model.nextOpenCard(filmia, cards[0]).id, cards[2], "skips the handled one");
  assert.equal(model.stepCard(filmia, cards[cards.length - 1], 1).id, cards[0], "wraps");
  const list = model.stations(data, st);
  assert.equal(model.nextWithWork(list, 0), 1);
});

// ---- PLA-I51-4: ideas and opening in place

test("PLA-I51-4 check 1: no anchor on /brief points to /p/; GitHub and sketch links open in a new tab", () => {
  const motion = [{ project: "filmia", key: "FIL-IDEA14", title: "Quiniela", stage: "design", next: "sketch_ready", sketch: true, research: true, doc_url: "https://claude.ai/artifact/x", promoted_to: null }];
  const st = stateOf({ [ids[5]]: open(["put_first"], { kind: "ticket", key: "WRK-13", status: "Ready", title: "x", first: false, paused: false, owner: null }) }, { in_motion: motion });
  const outs: string[] = [render({ state: st, initial: { station: "workia", card: ids[5] } }), render({ state: st, initial: { station: "filmia", tab: "plania", card: "m|FIL-IDEA14" } })];
  const [first, second] = outs as [string, string];
  for (const out of outs) {
    assert.doesNotMatch(out, /href="\/p\//);
    for (const m of out.matchAll(/<a [^>]*href="(https?:[^"]+)"[^>]*>/g)) assert.match(m[0], /target="_blank"/, String(m[1]));
  }
  assert.match(first, /data-see="WRK-13">Ver WRK-13 aquí/);
  assert.doesNotMatch(first, /data-cur="false"/);
  assert.equal((first.match(/data-cur=""/g) ?? []).length, 1, "only the card in hand is outlined");
  assert.match(second, /href="https:\/\/claude\.ai\/artifact\/x"/);
  const src = readFileSync(new URL("../ui/src/components/brief/city.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\/p\/\$\{|targetHref|planLink/);
  assert.match(src, /<TaskSheet slug=\{sheet\.slug\} taskKey=\{sheet\.key\}/);
});

test("PLA-I51-4 check 2: an open idea in Plania opens in the ficha with its stage; planned ideas are a count", () => {
  const motion = [
    { project: "filmia", key: "FIL-IDEA14", title: "Quiniela", stage: "design", next: "sketch_ready", sketch: true, research: true, doc_url: null, promoted_to: null },
    { project: "filmia", key: "FIL-IDEA12", title: "Juegos", stage: "ready", next: "planned", sketch: false, research: true, doc_url: null, promoted_to: "FIL-I40" },
    { project: "filmia", key: "FIL-IDEA11", title: "Diario", stage: "ready", next: "planned", sketch: false, research: true, doc_url: null, promoted_to: "FIL-I41" },
  ];
  const st = stateOf({}, { in_motion: motion });
  const filmia = model.stations(data, st).find((s: Json) => s.slug === "filmia");
  assert.deepEqual(filmia.inPlania.map((m: Json) => m.key), ["FIL-IDEA14"]);
  assert.equal(filmia.planned, 2);
  const out = render({ state: st, initial: { station: "filmia", tab: "plania", card: "m|FIL-IDEA14" } });
  const s = text(out);
  assert.match(s, /Ya en Plania · 1/);
  assert.match(s, /y 2 más, ya planeadas/);
  assert.match(out, /aria-current="step"[^>]*>Diseño</);
  assert.match(s, /Idea en Plania/);
  assert.match(s, /Leer sus docs aquí/);
  assert.match(s, /Su siguiente paso se decide en Plania/);
  // Only planned ones: the count line alone.
  const only = text(render({ state: stateOf({}, { in_motion: motion.slice(1) }), initial: { station: "filmia", tab: "plania" } }));
  assert.match(only, /2 ideas ya planeadas/);
  assert.match(only, /No hay ideas abiertas en Plania/);
});

test("PLA-I51-4 check 3: a new idea offers the five fates, the reason chips and the cost line", () => {
  const z1 = data.ideas.find((i: Json) => i.code === "Z1");
  const base = { state: stateOf({}), initial: { station: "zigzag", card: z1.id } };
  const s = text(render(base));
  assert.match(s, /Idea nueva · Z1/);
  assert.match(s, /Hazlo tú Guardar ⏎ Descartar X/);
  assert.match(s, /Dásela a .*Boceto Artist.*Investigar Research.*Que lo planee PO ZigZag/);
  const reasons = text(render({ ...base, initial: { ...base.initial, pending: { kind: "discard" } } }));
  for (const r of ["Ahora no", "No es para este producto", "Ya existe", "Muy grande", "Cuesta dinero", "Otra razón"]) assert.ok(reasons.includes(r), r);
  assert.match(text(render({ ...base, initial: { ...base.initial, pending: { kind: "idea-wake", action: "plan" } } })), /Despierta 1 bot de proyecto · unos 10–25 min · usa tu plan, \$0/);
  assert.match(text(render({ ...base, initial: { ...base.initial, pending: { kind: "idea-wake", action: "sketch" } } })), /Despierta a Artist · unos 10–20 min/);
  // Choosing several ideas at once is gone.
  assert.doesNotMatch(render(base), /role="checkbox"/);
});

// ---- PLA-I51-5: states

const lastRun = { status: "fail", kind: "auth", reason: "Failed to authenticate", ended_at: "2026-11-14T03:10:00Z" };

test("PLA-I51-5 check 2: a failed run after a full brief keeps the brief and says when, why and the fix; Generar reads Reintentar", () => {
  const out = render({ lastRun, state: stateOf({}) });
  const s = text(out);
  assert.match(s, /No se pudo actualizar a las 21:10\. Claude perdió su sesión en esta Mac/);
  assert.match(s, /Sigues viendo el brief de las \d\d:\d\d\./);
  assert.match(s, /Cómo arreglarlo/);
  assert.match(out, /data-brief="generate">Reintentar</);
  assert.equal((out.match(/class="bc-c"/g) ?? []).length > 0, true, "the cards are still on screen");
  const steps = text(render({ lastRun, initial: { pop: "fix" } }));
  assert.match(steps, /Abre Terminal en la Mac\. Escribe claude y luego \/login\. Vuelve aquí y pulsa Reintentar\./);
  const other = text(render({ lastRun: { ...lastRun, kind: "other", reason: "pass brief timed out" }, initial: { pop: "fix" } }));
  assert.match(other, /pass brief timed out/);
  assert.match(other, /pnpm brief:doctor/);
});

test("PLA-I51-5 check 3: the steps open over the page and do not change its height", () => {
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.match(css, /\.bc-fixpop \{ position: absolute;/);
  assert.match(css, /\.bc-alert \{ position: relative; z-index: 20;/);
  assert.match(css, /\.bc-pop \{ position: absolute;/);
});

test("PLA-I51-5 check 4: a past day shows no action control and a way back to today", () => {
  const st = { ...stateOf({ [ids[0]]: handled("answer"), [ids[2]]: open(["publish", "give_to_po", "later", "dismiss"]) }), read_only: true };
  for (const card of [ids[0], ids[2]]) {
    const out = render({ state: st, readOnly: true, date: "2026-11-12", banner: "past", initial: { station: data.items.find((i: Json) => i.id === card).app, card } });
    assert.match(out, /data-brief="past"/);
    assert.match(text(out), /Un día pasado: solo lectura\. Volver a hoy/);
    assert.doesNotMatch(out, /data-act="(publish|later|dismiss|keep|discard)"/);
    assert.doesNotMatch(out, /data-who=/);
    assert.doesNotMatch(out, /data-undo=/);
  }
  const idea = render({ readOnly: true, date: "2026-11-12", banner: "past", state: { ...stateOf({}), read_only: true }, initial: { station: "zigzag", card: data.ideas.find((i: Json) => i.code === "Z1").id } });
  assert.doesNotMatch(idea, /data-act="keep"/);
});

test("PLA-I51-5 check 1: first load, no brief, brief off, API down, one pass failed, a project done, all handled, long text", () => {
  // First load: the sky's towers and the cards in a quiet form.
  const loading = html(h(pageMod.BriefEmpty, { language: "es", text: null, busy: false, canGenerate: true, onGenerate: noop, onSettings: noop, onToday: null }));
  assert.match(loading, /data-brief="loading" aria-busy="true"/);
  assert.equal((loading.match(/bc-c bc-c-sk/g) ?? []).length, 6);
  assert.equal((loading.match(/bc-stn bc-stn-sk/g) ?? []).length, 6);
  // No brief, off, could not load: the V1 texts in the new look.
  const t = i18n.BRIEF_LABELS.es;
  for (const line of [t.empty("07:00"), t.off, t.failed]) {
    const out = html(h(pageMod.BriefEmpty, { language: "es", text: line, busy: false, canGenerate: true, onGenerate: noop, onSettings: noop, onToday: null }));
    assert.match(text(out), new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(out, /class="bc-sky"/);
  }
  // The API down with a cached brief.
  const down = render({ banner: "refresh-failed" });
  assert.match(text(down), /No se pudo actualizar Reintentar/);
  // One pass failed: the line names the missing part; the rows still act.
  const partial = { ...data, mode: "partial", sources: [{ name: "plania", ok: true }, { name: "github", ok: true }, { name: "claude_brief", ok: true }, { name: "claude_ideas", ok: false }] };
  const p = render({ data: partial, state: stateOf({ [ids[2]]: open(["publish"]) }) });
  assert.match(text(p), /No llegaron las ideas de hoy\./);
  assert.match(p, /data-act="publish"/);
  assert.equal(model.missingPart({ ...partial, sources: [{ name: "claude_brief", ok: false }] }), "brief");
  assert.equal(model.missingPart({ ...partial, mode: "facts_only" }), "both");
  assert.equal(model.missingPart({ ...partial, sources: [{ name: "github", ok: false }] }), "github");
  // A project with nothing open: al día and the way to the next one.
  const filmiaDone = Object.fromEntries(data.items.filter((i: Json) => i.app === "filmia").map((i: Json) => [i.id, handled("later")]));
  const filmiaIdeas = Object.fromEntries(data.ideas.filter((i: Json) => i.app === "filmia").map((i: Json) => [i.id, { state: "kept", line: "Guardada", key: "K", action_id: "z", undo: true, at: null, project: "filmia", paused: false }]));
  const done = render({ state: stateOf(filmiaDone, { ideas: filmiaIdeas }), initial: { station: "filmia" } });
  assert.match(text(done), /Filmia está al día\./);
  assert.match(done, /data-act="next-project"/);
  // Everything handled: day sky and "Tu mesa está limpia".
  const every = Object.fromEntries(data.items.map((i: Json) => [i.id, handled("later")]));
  const everyIdea = Object.fromEntries(data.ideas.map((i: Json) => [i.id, { state: "kept", line: "Guardada", key: "K", action_id: "z", undo: true, at: null, project: i.app, paused: false }]));
  const clear = render({ state: stateOf(every, { ideas: everyIdea }), runAt: "07:00" });
  assert.match(clear, /--p:1\.000/);
  assert.match(text(clear), /Tu mesa está limpia\./);
  assert.match(text(clear), /resueltos hoy\. El brief de mañana llega a las 07:00\./);
  // Long text: a 90-character title and a 600-character detail are whole in the ficha and clamped on the card.
  const long = { ...data.items[2], title: "T".repeat(45) + " " + "u".repeat(44), detail: "d ".repeat(300) };
  const ld = render({ data: { ...data, items: [long, ...data.items.slice(3)] }, state: stateOf({ [long.id]: open(["publish"]) }), initial: { station: "micasa", card: long.id } });
  assert.ok(text(ld).includes(long.title));
  assert.ok(ld.includes(long.detail.trim()));
  const css = readFileSync(new URL("../ui/src/index.css", import.meta.url), "utf8");
  assert.match(css, /\.bc-c-t \{[^}]*-webkit-line-clamp: 2/);
  assert.match(css, /\.bc-c-d \{[^}]*-webkit-line-clamp: 1/);
  assert.match(css, /\.bc-f-in \{[^}]*overflow: auto/);
});

test("handled list: rows and ideas no longer open, newest first, with undo where it exists", () => {
  const st = stateOf({ [ids[0]]: handled("answer"), [ids[1]]: { ...handled("step_done"), at: "2026-11-13T14:00:00Z", undo: false } }, { ideas: { [data.ideas[0].id]: { state: "discarded", line: "Descartada", key: null, action_id: "q", undo: true, at: "2026-11-13T15:00:00Z", project: "workia", paused: false } } });
  const rows = city.handledList(model.stations(data, st), st, i18n.BRIEF_LABELS.es, "es");
  assert.deepEqual(rows.map((r: Json) => r.word), ["Descartada", "Hecho", "Respondido"]);
  assert.deepEqual(rows.map((r: Json) => r.undo), [true, false, true]);
  const out = text(render({ state: st, initial: { pop: "handled" } }));
  assert.match(out, /Resueltos hoy · 3/);
  assert.match(out, /3 resueltos hoy/);
});
