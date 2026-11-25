// PLA-181: the first-delivery guide on Inicio as a short card and a three-step wizard (ui/src/components/home/guia-wizard.tsx,
// after the form-wizard-dialog pattern): requisitos, proyecto and iniciar (start the project, then its first task). The
// card counts those three; plan and entrega wait for the team and show on the card once they are done. Pure, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listoSeccionWords } from "../ui/src/lib/listo.js";
import { test } from "node:test";
import { PASOS_ASISTENTE, PASOS_DE_ASISTENTE, alcanzable, pasoInicial, pasosDe, primeraEntregaWords, puedeSeguir, tarjetaDe, type GuiaRead } from "../ui/src/lib/primera-entrega.js";

const base: GuiaRead = {
  visible: true,
  proyecto: null,
  maquina: "sin_revisar",
  company_paused: true,
  project_paused: true,
  pedido: false,
  plan: "nada",
  entrega: "nada",
  fallo: null,
  est_pct_per_run: 3,
};
const read = (over: Partial<GuiaRead>): GuiaRead => ({ ...base, ...over });
const proyecto = { slug: "zeep", title: "zeep" };

const corre = { company_paused: false, project_paused: false };

test("wizard: three steps; the third holds the start and the first task; plan and delivery stay out", () => {
  assert.deepEqual([...PASOS_ASISTENTE], ["maquina", "proyecto", "iniciar"]);
  assert.deepEqual(PASOS_DE_ASISTENTE.iniciar, ["reanudar", "pedido"]);
  for (const lang of ["es", "en"] as const) {
    const w = primeraEntregaWords(lang).asistente;
    assert.deepEqual(Object.keys(w.etiquetas), [...PASOS_ASISTENTE]);
  }
});

test("wizard: it opens at the first of its steps not done", () => {
  assert.equal(pasoInicial(pasosDe(base)), 0, "a fresh install: the requirements first");
  assert.equal(pasoInicial(pasosDe(read({ maquina: "lista" }))), 1);
  assert.equal(pasoInicial(pasosDe(read({ maquina: "lista", proyecto }))), 2);
  assert.equal(pasoInicial(pasosDe(read({ maquina: "lista", proyecto, ...corre }))), 2, "started, the first task still to send: the same step");
  // The requirements never hold the rest back: once a later step is done, the wizard opens at the next open one.
  assert.equal(pasoInicial(pasosDe(read({ maquina: "falta", proyecto }))), 2);
  assert.equal(pasoInicial(pasosDe(read({ maquina: "lista", proyecto, ...corre, pedido: true }))), 2, "all three done: the last one");
});

test("wizard: Continuar waits for its step, except the requirements'; the stepper opens what the required steps allow", () => {
  const fresh = pasosDe(base);
  assert.equal(puedeSeguir("maquina", fresh), true, "the requirements never hold the rest back");
  assert.equal(puedeSeguir("proyecto", fresh), false);
  const conProyecto = pasosDe(read({ proyecto }));
  assert.equal(puedeSeguir("proyecto", conProyecto), true);
  assert.equal(puedeSeguir("iniciar", conProyecto), false);
  assert.equal(puedeSeguir("iniciar", pasosDe(read({ proyecto, ...corre }))), false, "started but no task yet");
  assert.equal(puedeSeguir("iniciar", pasosDe(read({ proyecto, ...corre, pedido: true }))), true);
  // Clicking a step: the project step is always open (the requirements are optional), the third needs a project.
  assert.deepEqual([0, 1, 2].map((i) => alcanzable(i, fresh)), [true, true, false]);
  assert.deepEqual([0, 1, 2].map((i) => alcanzable(i, conProyecto)), [true, true, true]);
});

test("card: the wizard's three steps, the next one, and the team's turn after them", () => {
  const t1 = tarjetaDe(pasosDe(base));
  assert.deepEqual([t1.hechos, t1.total, t1.n, t1.actual?.id, t1.enAsistente], [0, 3, 1, "maquina", true]);
  assert.deepEqual(t1.segmentos, [{ id: "maquina", hecho: false }, { id: "proyecto", hecho: false }, { id: "iniciar", hecho: false }]);
  const t2 = tarjetaDe(pasosDe(read({ maquina: "lista" })));
  assert.deepEqual([t2.hechos, t2.n, t2.actual?.id, t2.enAsistente], [1, 2, "proyecto", true]);
  // Inside step 3 the card names the part it is on: the start, then the first task.
  const t3 = tarjetaDe(pasosDe(read({ maquina: "lista", proyecto })));
  assert.deepEqual([t3.hechos, t3.n, t3.actual?.id, t3.actual?.titulo], [2, 3, "reanudar", "Iniciar proyecto"]);
  const t3b = tarjetaDe(pasosDe(read({ maquina: "lista", proyecto, ...corre })));
  assert.deepEqual([t3b.hechos, t3b.n, t3b.actual?.id, t3b.actual?.titulo], [2, 3, "pedido", "Define una primera tarea"]);
  // After the three the team works: the card points at the plan, with no step number and outside the wizard.
  const t4 = tarjetaDe(pasosDe(read({ maquina: "lista", proyecto, ...corre, pedido: true })));
  assert.deepEqual([t4.hechos, t4.n, t4.actual?.id, t4.enAsistente], [3, null, "plan", false]);
  const t5 = tarjetaDe(pasosDe(read({ maquina: "lista", proyecto, ...corre, pedido: true, plan: "aprobado", entrega: "espera" })));
  assert.deepEqual([t5.n, t5.actual?.id, t5.enAsistente], [null, "entrega", false]);
  // Seen in the browser: the wizard done with the requirements never checked. The plan shows, the requirements aside.
  const sinMaquina = tarjetaDe(pasosDe(read({ maquina: "sin_revisar", proyecto, ...corre, pedido: true })));
  assert.deepEqual([sinMaquina.hechos, sinMaquina.n, sinMaquina.actual?.id, sinMaquina.maquinaPendiente], [2, null, "plan", true]);
  const conProyecto = tarjetaDe(pasosDe(read({ maquina: "falta", proyecto })));
  assert.deepEqual([conProyecto.n, conProyecto.actual?.id, conProyecto.maquinaPendiente], [3, "reanudar", true]);
  assert.deepEqual([t1.maquinaPendiente], [false]);
  for (const lang of ["es", "en"] as const) {
    const w = primeraEntregaWords(lang).tarjeta;
    assert.ok(w.progreso(1, 3).includes("1") && w.progreso(1, 3).includes("3") && w.paso(2, 3).includes("2"));
  }
  // The card draws one segment per wizard step and the step number only inside the wizard.
  const card = readFileSync(new URL("../ui/src/components/home/guia-primera-entrega.tsx", import.meta.url), "utf8");
  assert.match(card, /t\.segmentos\.map/);
  assert.match(card, /\{t\.n \? <span/);
});

test("wizard: the pattern's rules hold in the component", () => {
  const src = readFileSync(new URL("../ui/src/components/home/guia-wizard.tsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("../ui/src/components/home/guia-primera-entrega.tsx", import.meta.url), "utf8");
  // A stray click outside does not throw a half-filled step away; Escape and the close button still close.
  assert.match(src, /onInteractOutside=\{\(e\) => e\.preventDefault\(\)\}/);
  // The stepper: spread out, and a step is a button only where alcanzable allows it, never while something runs.
  const stepper = src.slice(src.indexOf("function Stepper"), src.indexOf("function PasoRequisitos"));
  assert.match(stepper, /justify-around/);
  assert.match(stepper, /const abre = !aqui && !bloqueado && alcanzable\(i, pasos\);/);
  assert.match(stepper, /disabled=\{!abre\}/);
  assert.match(src, /<Stepper actual=\{actual\} pasos=\{pasos\} onIr=\{setActual\} bloqueado=\{busy\} \/>/);
  // Step 2 draws the form in place with the shared state: no second sheet opens from the dialog.
  assert.match(src, /useAgregarProyecto\(\)/);
  assert.doesNotMatch(src, /\?nuevo|NuevoProyecto/);
  // It never opens on its own: the card opens it from a button, closed at first.
  assert.match(card, /useState\(false\)/);
  assert.match(card, /onClick=\{\(\) => setAbierto\(true\)\}/);
});

test("wizard step 2: once added, the project's line and the pending items, centred in the step", () => {
  const w = primeraEntregaWords("es").asistente;
  assert.equal(w.agregadoCuerpo("CV", true), "El proyecto CV ya existe y está agregado, pero permanece en pausa junto con su equipo.");
  assert.equal(w.pendientes(5), "Hay 5 elementos pendientes de configuración.");
  assert.equal(w.pendientes(1), "Hay 1 elemento pendiente de configuración.");
  const lugar = listoSeccionWords("es").lugar;
  assert.equal(`${w.pendientesNinguno} ${lugar.ajustes}.`, "Ninguno impide iniciar el proyecto; pueden completarse posteriormente desde Ajustes.");
  // PLA-132: the code's folder and repository are fixed in Despliegue, so the sentence names the places the items need.
  assert.equal(`${w.pendientesNinguno} ${lugar.ajustes} ${w.o} ${lugar.camino}.`, "Ninguno impide iniciar el proyecto; pueden completarse posteriormente desde Ajustes o Despliegue.");
  assert.equal(w.pendientesNingunoSolo, "Ninguno impide iniciar el proyecto.");
  const src = readFileSync(new URL("../ui/src/components/home/guia-wizard.tsx", import.meta.url), "utf8");
  const paso = src.slice(src.indexOf("function PasoProyecto"), src.indexOf("/**\n * Step 3"));
  assert.match(paso, /<ol className="grid list-decimal/);
  // The body is a column so my-auto centres the warning in the free space under the step's header.
  assert.match(paso, /className="my-auto grid gap-2 rounded-md border border-amber-500\/40/);
  assert.match(src, /className="flex min-h-80 flex-col gap-3" data-paso-alto/);
});

test("wizard step 3: «Estado del proyecto» with its badge, the start that folds away, then the first task", () => {
  const w = primeraEntregaWords("es").asistente;
  assert.equal(w.iniciarTitulo, "Estado del proyecto");
  assert.deepEqual([w.enPausa, w.activo, w.iniciar], ["En pausa", "Activo", "Iniciar proyecto"]);
  assert.equal(w.iniciarCuerpo("CV"), "El proyecto CV y su compañía ya están configurados y listos para iniciar su ejecución.");
  assert.equal(w.tareaTitulo, "Define una primera tarea");
  assert.equal(w.tareaCuerpo, "Establece una tarea sencilla y corta que permita completar una primera ejecución. El ejemplo puede modificarse.");
  const src = readFileSync(new URL("../ui/src/components/home/guia-wizard.tsx", import.meta.url), "utf8");
  const paso = src.slice(src.indexOf("function PasoIniciar"), src.indexOf("export function GuiaWizard"));
  // The badge and the fold follow the server's state, never the press: a failed start never reads as Activo.
  assert.match(paso, /const activo = !r\.company_paused && !r\.project_paused;/);
  assert.match(paso, /\{activo \? w\.activo : w\.enPausa\}/);
  assert.match(paso, /\{activo \? null : \(\s*<motion\.div/);
  // 300 ms, ease-in-out, height, opacity and spacing together; none of it with reduced motion.
  assert.match(paso, /duration: reducido \? 0 : 0\.3, ease: "easeInOut"/);
  assert.match(paso, /exit=\{\{ height: 0, opacity: 0, paddingTop: 0 \}\}/);
  assert.match(paso, /<ActionButton/);
  // The press waits for the start and the guide's refresh before the button settles.
  assert.match(src, /onIniciar=\{\(\) => reanudar\.mutateAsync\(aReanudar\(r\)\)\}/);
});

test("wizard step 1: «Requisitos del entorno», its body, and Revisar that turns into Reintentar under the list", () => {
  const es = primeraEntregaWords("es");
  assert.equal(es.maquina.titulo, "Requisitos del entorno");
  assert.equal(es.asistente.maquinaCuerpo, "Valida los requisitos necesarios para iniciar el proyecto. Esta revisión no impide continuar con los siguientes pasos.");
  assert.equal(es.asistente.revisar, "Revisar");
  assert.equal(es.asistente.reintentar, "Reintentar");
  // The card names the step the same way.
  const t = tarjetaDe(pasosDe(base));
  assert.equal(t.actual?.titulo, "Requisitos del entorno");
  assert.match(es.tarjeta.maquina, /requisitos del entorno/);
  const src = readFileSync(new URL("../ui/src/components/home/guia-wizard.tsx", import.meta.url), "utf8");
  const paso = src.slice(src.indexOf("function PasoRequisitos"), src.indexOf("/** Step 2"));
  // Secondary style; the same list as the machine page, drawn in place without that page's own button.
  assert.match(paso, /variant="secondary"/);
  assert.match(paso, /<FaltaView reading=\{lectura\} againButton=\{false\} \/>/);
  // First press: the recent reading if any (no ?fresh); Reintentar: a new check, as «Revisar otra vez» does.
  assert.match(paso, /api\.machineCheck\(fresh\)/);
  assert.match(paso, /revisar\(fase !== "sin_revisar"\)/);
  // While a check runs only its line shows (a spinner and the state's words): no list, no button to press twice.
  const corriendo = paso.slice(paso.indexOf('if (fase === "revisando" || fase === "revisando_otra_vez")'), paso.indexOf("const boton"));
  assert.match(corriendo, /animate-spin/);
  assert.match(corriendo, /w\.revisandoPrimera : w\.revisandoOtraVez/);
  assert.doesNotMatch(corriendo, /<Button|FaltaView|boton/);
  assert.match(paso, /if \(corriendo\) return;/);
  // The button sits after the list.
  assert.ok(paso.lastIndexOf("{boton}") > paso.indexOf("<FaltaView"));
  // The dialog is wider than the shadcn default for this list (768px).
  assert.match(src, /sm:max-w-3xl/);
  // Every step keeps the project step's height, so going from 1 to 2 does not grow the dialog; it sits inside the
  // scroller, so a short window still scrolls instead of pushing the footer out.
  assert.match(src, /overflow-y-auto px-5 py-4" data-paso-cuerpo/);
  assert.ok(src.indexOf("data-paso-cuerpo") < src.indexOf("data-paso-alto"));
  assert.match(src, /className="flex min-h-80 flex-col gap-3" data-paso-alto/);
  // Continuar stays at the foot and is never held by this step.
  assert.equal(puedeSeguir("maquina", pasosDe(read({ maquina: "falta" }))), true);
});

test("wizard step 1: one line per state; a check in progress never reads as a failed one", async () => {
  const { requisitosFase } = await import("../ui/src/lib/primera-entrega.js");
  const f = (o: Partial<{ pedido: boolean; corriendo: boolean; hayLectura: boolean; fallo: boolean }>) => requisitosFase({ pedido: false, corriendo: false, hayLectura: false, fallo: false, ...o });
  assert.equal(f({}), "sin_revisar");
  assert.equal(f({ pedido: true, corriendo: true }), "revisando", "first press: checking, not failed");
  assert.equal(f({ pedido: true, corriendo: true, fallo: true }), "revisando", "the case the owner saw: an earlier failure while a new check runs");
  assert.equal(f({ pedido: true, corriendo: true, hayLectura: true }), "revisando_otra_vez");
  assert.equal(f({ pedido: true, hayLectura: true }), "listo");
  assert.equal(f({ pedido: true, fallo: true }), "error");
  assert.equal(f({ pedido: true, fallo: true, hayLectura: true }), "error");
  for (const lang of ["es", "en"] as const) {
    const w = primeraEntregaWords(lang).asistente;
    const lines = [w.revisandoPrimera, w.revisandoOtraVez, w.revisarFallo];
    assert.equal(new Set(lines).size, 3, "each state says its own thing");
  }
  // The headline once nothing is missing.
  const { machineHeadline } = await import("../ui/src/lib/falta.js");
  assert.equal(machineHeadline([{ state: "ok" }] as never, "es"), "El entorno está listo para continuar.");
});
