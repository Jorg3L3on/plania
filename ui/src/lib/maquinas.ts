// PLA-I48: Máquinas, the floor's second level (Design frames 1-12). The reads the server sends (src/api/maquinas.ts)
// and the one view the floor draws from them: the state word, each lever's next action, the pipes, the window and
// the two lights by the level switch. Pure, so the tests drive it with fake reads.
// PLA-I2-10: its words in both languages (lib/i18n.ts); NO_CODE_SAY stays the Spanish.
import type { PruebaRead } from "./ventana";
import { noDisponible } from "./sistema";
import { LOCALE } from "./locale.js";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type Nivel = "trabajo" | "maquinas";
export const nivelOf = (search: string): Nivel => (new URLSearchParams(search).get("nivel") === "maquinas" ? "maquinas" : "trabajo");
export function nivelSearch(search: string, n: Nivel): string {
  const q = new URLSearchParams(search);
  if (n === "maquinas") q.set("nivel", "maquinas");
  else q.delete("nivel");
  const s = q.toString();
  return s ? `?${s}` : "";
}

export type Found = { manager: "npm" | "pnpm" | "yarn" | null; scripts: { name: string; command: string }[]; dev: string | null; port: number | null; migrate: string | null; seed: string | null; test: string | null; missing: string[] };
export type BaseRead = {
  state: "on" | "off" | "none";
  engine: string | null;
  version: string | null;
  host: string | null;
  port: number | null;
  databases: { name: string; size_bytes: number | null; app: boolean }[];
  size_bytes: number | null;
  service: string | null;
  shared_with: string[];
  lever: { can: boolean; reason: string | null };
  env_file: string | null;
};
export type ServerRead = PruebaRead & { command: string | null; commit: string | null; branch: string | null; worktree: string | null; started_by: string | null; frameable?: boolean };
export type MaqPage = { key: string; path: string; label: string; session?: boolean };
export type MaquinasRead = { project: string; configured: boolean; no_code?: boolean; server: ServerRead; base: BaseRead; found: Found | null; pages: MaqPage[]; test_user: string | null };

export type Column = { name: string; type: string; not_null: boolean; key: boolean; unique: boolean; default: string | null; references: { table: string; column: string } | null; hidden: boolean };
export type Table = { name: string; rows: number; size_bytes?: number | null; columns: Column[]; indexes: { name: string; definition: string }[]; relations: { column: string; table: string; foreign: string }[] };
export type Migrations = { dir: string | null; files: { name: string; applied: boolean | null }[]; applied: number; pending: number; table: string | null };
export type TablesRead = { connection: { host: string; port: number; database: string }; tables: Table[]; total_rows: number; sample: boolean; migrations: Migrations };
export type RowsRead = { table: string; columns: string[]; hidden: string[]; rows: Record<string, string | null>[]; offset: number; limit: number; total: number };
export type SeedResult = { ok: boolean; steps: { command: string; ok: boolean; tail: string[] }[]; tables: TablesRead | null };
// PLA-I72-4: iniciativas: the initiatives whose branch asks for a key the start copy's does not; reiniciar: after a
// save, the running copies to restart.
export type Llave = { name: string; set: boolean; from: string[]; public: boolean; iniciativas?: string[] };
export type LlavesRead = { env_file: string | null; where: "prueba" | "repo" | null; example_file: string | null; llaves: Llave[]; set: number; missing: number; reiniciar?: { id: string; title: string }[] };
export type PruebaStep = { name: string; command: string; ok: boolean; code: number | null; ms: number; passed: number | null; failed: number | null; tail: string[] };
export type PruebasResult = { ok: boolean; started_at: string; ended_at: string; duration_ms: number; passed: number | null; failed: number | null; steps: PruebaStep[] };
export type PruebasRead = { running: { started_at: string; step: string | null } | null; last: PruebasResult | null; commands: { name: string; command: string }[]; can: boolean; reason: string | null };
export type Paso = { n: number; text: string; page: string | null; path: string | null };
export type RecorridoRead = { from: "doc" | "pages" | "none"; doc_id: string | null; steps: Paso[]; user: string | null; can_password: boolean };
export type TableroRow = { project: string; title: string; configured: boolean; phase: string; managed: boolean; port: number | null; url: string | null; error: string | null };
export type TableroRead = { floors: TableroRow[]; on: number };

// The five states of the sketch, plus the moment it is starting.
// NEWPROJ-3: no-code, the project has no code yet on purpose; nothing to configure, so no Configurar.
// PLA-I2-4: unavailable: this system cannot run a test copy (ui/src/lib/sistema.ts).
export type MaqState = "on" | "off" | "failed" | "base-down" | "unconfigured" | "no-code" | "starting" | "unavailable";
export type Light = "on" | "off" | "starting" | "error" | "none";
export type ServerAct = "encender" | "apagar" | "reiniciar";

export type MaqView = {
  state: MaqState;
  word: string; // the state word, in the room's header
  say: string; // one line under it
  server: { light: Light; word: string; sub: string; lever: { act: ServerAct; label: string; on: boolean } | null; outside: boolean };
  base: { light: Light; word: string; sub: string; lever: { act: "encender" | "apagar"; label: string; on: boolean } | null; reason: string | null; warn: string | null };
  pipes: { window: "lit" | "dark"; base: "lit" | "dark" | "red" };
  window: "live" | "blinds" | "starting" | "failed" | "setup";
  lights: { server: Light; base: Light }; // the level switch's two lights
  drawers: boolean; // tables open only while the base is on
};

const LIVE = new Set(["live", "running", "capturing"]);
// PLA-116: a server that is up reads its env file only when it starts.
export const serverUp = (phase: string): boolean => LIVE.has(phase) || phase === "starting";

export const MAQ = defineWords({
  es: {
    noCodeSay: "Este proyecto todavía no tiene código. Cuando tenga su carpeta en esta máquina, aquí se podrá encender.",
    falta: (list: string) => `Falta: ${list}.`,
    configurarBusca: "Configurar busca cómo arrancarla en el repo.",
    sinBaseEncontrada: "Sin base encontrada",
    puerto: (port: number) => `puerto ${port}`,
    puertoOff: (port: number | null) => `puerto ${port ?? "libre desde el suyo"}`,
    compartida: (list: string) => `La comparten ${list}.`,
    sinBase: "Sin base",
    encendida: "Encendida",
    apagada: "Apagada",
    encender: "Encender",
    apagar: "Apagar",
    reintentar: "Reintentar",
    deLaMaquina: "Este Postgres es de toda la máquina.",
    todaviaSinCodigo: "Todavía sin código",
    sinCodigo: "Sin código",
    nadaQueEncender: "No hay nada que encender todavía",
    sinConfigurar: "Sin configurar",
    noSabe: "Este piso no sabe cómo encenderse.",
    faltaComo: "Falta cómo arrancarla",
    encendiendo: "Encendiendo",
    encendiendoDots: "Encendiendo…",
    traeCopia: "Trae la copia de prueba, instala y arranca.",
    buscandoPuerto: "buscando un puerto",
    noArranco: "No arrancó",
    copiaNoArranco: "La copia de prueba no arrancó.",
    baseCaida: "Base caída",
    noLlega: "La app está encendida, pero no llega a su base.",
    fuera: "La encendiste fuera de Plania; aquí solo se mira.",
    corre: "La app corre en tu máquina.",
    sinClic: "Nada arranca sin tu clic.",
    encendidaFuera: "Encendida fuera de Plania",
    filas: (n: number, shown: string) => (n === 1 ? "1 fila" : `${shown} filas`),
    tablero: (count: number) => `Tablero · ${count} ${count === 1 ? "encendida" : "encendidas"}`,
    pedirFallo: (n: number, text: string) => `Al probar la app, el paso ${n} falló: «${text}». `,
  },
  en: {
    noCodeSay: "This project has no code yet. Once its folder is on this machine, it can be turned on here.",
    falta: (list: string) => `Missing: ${list}.`,
    configurarBusca: "Configurar looks in the repo for how to start it.",
    sinBaseEncontrada: "No database found",
    puerto: (port: number) => `port ${port}`,
    puertoOff: (port: number | null) => `port ${port ?? "free, from its own"}`,
    compartida: (list: string) => `Shared with ${list}.`,
    sinBase: "No database",
    encendida: "On",
    apagada: "Off",
    encender: "Turn on",
    apagar: "Turn off",
    reintentar: "Try again",
    deLaMaquina: "This Postgres belongs to the whole machine.",
    todaviaSinCodigo: "No code yet",
    sinCodigo: "No code",
    nadaQueEncender: "Nothing to turn on yet",
    sinConfigurar: "Not set up",
    noSabe: "This floor does not know how to turn on.",
    faltaComo: "How to start it is missing",
    encendiendo: "Turning on",
    encendiendoDots: "Turning on…",
    traeCopia: "Fetches the test copy, installs and starts.",
    buscandoPuerto: "looking for a port",
    noArranco: "Did not start",
    copiaNoArranco: "The test copy did not start.",
    baseCaida: "Database down",
    noLlega: "The app is on, but it cannot reach its database.",
    fuera: "You turned it on outside Plania; here you can only look.",
    corre: "The app runs on your machine.",
    sinClic: "Nothing starts without your click.",
    encendidaFuera: "On outside Plania",
    filas: (n: number, shown: string) => (n === 1 ? "1 row" : `${shown} rows`),
    tablero: (count: number) => `Tablero · ${count} on`,
    pedirFallo: (n: number, text: string) => `While testing the app, step ${n} failed: «${text}». `,
  },
});

// NEWPROJ-3: what Máquinas says for a project created with «Todavía no hay código».
export const NO_CODE_SAY = MAQ.es.noCodeSay;
/** The line under the app's window when it has no picture: what is missing, or why there is nothing to do. */
export function setupLine(r: MaquinasRead, language: Language = getLanguage()): string {
  const W = words(MAQ, language);
  if (!r.configured && r.no_code) return W.noCodeSay;
  return r.found?.missing.length ? W.falta(r.found.missing.join(", ")) : W.configurarBusca;
}

export function maqView(r: MaquinasRead, language: Language = getLanguage()): MaqView {
  const W = words(MAQ, language);
  const nd = noDisponible(language);
  const ph = r.server.phase;
  const baseOn = r.base.state === "on";
  const baseNone = r.base.state === "none";
  const serverLight: Light = LIVE.has(ph) ? "on" : ph === "starting" ? "starting" : ph === "failed" ? "error" : "off";
  const baseLight: Light = baseNone ? "none" : baseOn ? "on" : "off";
  const outside = ph === "running" && !r.server.managed;
  const port = r.server.port ?? null;
  const baseSub = baseNone ? W.sinBaseEncontrada : [r.base.databases.find((d) => d.app)?.name ?? r.base.databases[0]?.name, r.base.port ? W.puerto(r.base.port) : null].filter(Boolean).join(" · ");
  const shared = r.base.shared_with.length ? W.compartida(r.base.shared_with.join(", ")) : null;
  const base: MaqView["base"] = {
    light: baseLight,
    word: baseNone ? W.sinBase : baseOn ? W.encendida : W.apagada,
    sub: baseSub,
    lever: baseNone || !r.base.lever.can ? null : baseOn ? { act: "apagar", label: W.apagar, on: true } : { act: "encender", label: W.encender, on: false },
    reason: r.base.lever.can ? null : r.base.lever.reason,
    // The server is shared by every floor on it: the lever says so (Plan, decision 2).
    warn: r.base.lever.can && baseOn ? [W.deLaMaquina, shared].filter(Boolean).join(" ") : null,
  };
  const server = (word: string, sub: string, lever: MaqView["server"]["lever"]): MaqView["server"] => ({ light: serverLight, word, sub, lever, outside });
  const common = { base, lights: { server: serverLight, base: baseLight }, drawers: baseOn };
  if (ph === "unavailable")
    return { ...common, state: "unavailable", word: nd.unavailable, say: nd.by.test_copy, server: server(nd.unavailable, nd.by.test_copy, null), pipes: { window: "dark", base: baseOn ? "lit" : "dark" }, window: "blinds", lights: { server: "none", base: baseLight } };
  if (!r.configured && r.no_code)
    return { ...common, state: "no-code", word: W.todaviaSinCodigo, say: W.noCodeSay, server: server(W.sinCodigo, W.nadaQueEncender, null), pipes: { window: "dark", base: "dark" }, window: "setup", lights: { server: "none", base: baseLight } };
  if (!r.configured)
    return { ...common, state: "unconfigured", word: W.sinConfigurar, say: W.noSabe, server: server(W.sinConfigurar, W.faltaComo, null), pipes: { window: "dark", base: "dark" }, window: "setup", lights: { server: "none", base: baseLight } };
  if (ph === "starting")
    return { ...common, state: "starting", word: W.encendiendo, say: W.traeCopia, server: server(W.encendiendoDots, port ? W.puerto(port) : W.buscandoPuerto, null), pipes: { window: "dark", base: baseOn ? "lit" : "dark" }, window: "starting" };
  if (ph === "failed")
    return { ...common, state: "failed", word: W.noArranco, say: r.server.error ?? W.copiaNoArranco, server: server(W.noArranco, r.server.error ?? "", { act: "encender", label: W.reintentar, on: false }), pipes: { window: "dark", base: baseOn ? "lit" : "dark" }, window: "failed" };
  if (LIVE.has(ph)) {
    const sub = r.server.url ? r.server.url.replace(/^https?:\/\//, "") : "";
    const lever = outside ? null : { act: "apagar" as const, label: W.apagar, on: true };
    if (!baseOn && !baseNone)
      return { ...common, state: "base-down", word: W.baseCaida, say: W.noLlega, server: server(W.encendida, sub, lever), pipes: { window: "lit", base: "red" }, window: "live" };
    return { ...common, state: "on", word: W.encendida, say: outside ? W.fuera : W.corre, server: server(W.encendida, sub, lever), pipes: { window: "lit", base: baseOn ? "lit" : "dark" }, window: "live" };
  }
  return { ...common, state: "off", word: W.apagada, say: W.sinClic, server: server(W.apagada, W.puertoOff(port), { act: "encender", label: W.encender, on: false }), pipes: { window: "dark", base: baseOn ? "lit" : "dark" }, window: "blinds" };
}

// The level switch's lights, when the room has not been read yet.
export const NO_LIGHTS = { server: "none" as Light, base: "none" as Light };

export const bytes = (n: number | null): string => {
  if (n === null) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
};
export const filas = (n: number, language: Language = getLanguage()) => words(MAQ, language).filas(n, n.toLocaleString(LOCALE));

// The tablero (frame 10): rows in the building's order, the count in the link, and what Apagar todo stops.
export function tableroView(t: TableroRead, language: Language = getLanguage()) {
  const W = words(MAQ, language);
  const on = (r: TableroRow) => LIVE.has(r.phase) || r.phase === "starting";
  return {
    rows: t.floors.map((r) => ({
      ...r,
      on: on(r),
      word: !r.configured ? W.sinConfigurar : r.phase === "failed" ? W.noArranco : r.phase === "starting" ? W.encendiendo : r.phase === "running" && !r.managed ? W.encendidaFuera : on(r) ? W.encendida : W.apagada,
    })),
    count: t.floors.filter(on).length,
    // Only Plania's own copies can be turned off from here.
    stoppable: t.floors.filter((r) => r.managed && (on(r) || r.phase === "failed")).map((r) => r.project),
  };
}
export const tableroLabel = (count: number, language: Language = getLanguage()) => words(MAQ, language).tablero(count);

// Cómo probarla's ticks, per browser.
export const tickKey = (slug: string, docId: string | null) => `edi-probar:${slug}:${docId ?? "paginas"}`;
// «Algo falló» fills Pedir with the step.
export const pedirFallo = (p: Paso, language: Language = getLanguage()) => words(MAQ, language).pedirFallo(p.n, p.text);
