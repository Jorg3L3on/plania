// PLA-I48: Máquinas, the floor's second level (Design frames 1-12). The reads the server sends (src/api/maquinas.ts)
// and the one view the floor draws from them: the state word, each lever's next action, the pipes, the window and
// the two lights by the level switch. Pure, so the tests drive it with fake reads.
import type { PruebaRead } from "./ventana";

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
export type Table = { name: string; rows: number; columns: Column[]; indexes: { name: string; definition: string }[]; relations: { column: string; table: string; foreign: string }[] };
export type Migrations = { dir: string | null; files: { name: string; applied: boolean | null }[]; applied: number; pending: number; table: string | null };
export type TablesRead = { connection: { host: string; port: number; database: string }; tables: Table[]; total_rows: number; sample: boolean; migrations: Migrations };
export type RowsRead = { table: string; columns: string[]; hidden: string[]; rows: Record<string, string | null>[]; offset: number; limit: number; total: number };
export type SeedResult = { ok: boolean; steps: { command: string; ok: boolean; tail: string[] }[]; tables: TablesRead | null };
export type Llave = { name: string; set: boolean; from: string[]; public: boolean };
export type LlavesRead = { env_file: string | null; where: "prueba" | "repo" | null; example_file: string | null; llaves: Llave[]; set: number; missing: number };
export type PruebaStep = { name: string; command: string; ok: boolean; code: number | null; ms: number; passed: number | null; failed: number | null; tail: string[] };
export type PruebasResult = { ok: boolean; started_at: string; ended_at: string; duration_ms: number; passed: number | null; failed: number | null; steps: PruebaStep[] };
export type PruebasRead = { running: { started_at: string; step: string | null } | null; last: PruebasResult | null; commands: { name: string; command: string }[]; can: boolean; reason: string | null };
export type Paso = { n: number; text: string; page: string | null; path: string | null };
export type RecorridoRead = { from: "doc" | "pages" | "none"; doc_id: string | null; steps: Paso[]; user: string | null; can_password: boolean };
export type TableroRow = { project: string; title: string; configured: boolean; phase: string; managed: boolean; port: number | null; url: string | null; error: string | null };
export type TableroRead = { floors: TableroRow[]; on: number };

// The five states of the sketch, plus the moment it is starting.
// NEWPROJ-3: no-code, the project has no code yet on purpose; nothing to configure, so no Configurar.
export type MaqState = "on" | "off" | "failed" | "base-down" | "unconfigured" | "no-code" | "starting";
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

// NEWPROJ-3: what Máquinas says for a project created with «Todavía no hay código».
export const NO_CODE_SAY = "Este proyecto todavía no tiene código. Cuando tenga su carpeta en esta Mac, aquí se podrá encender.";
/** The line under the app's window when it has no picture: what is missing, or why there is nothing to do. */
export function setupLine(r: MaquinasRead): string {
  if (!r.configured && r.no_code) return NO_CODE_SAY;
  return r.found?.missing.length ? `Falta: ${r.found.missing.join(", ")}.` : "Configurar busca cómo arrancarla en el repo.";
}

export function maqView(r: MaquinasRead): MaqView {
  const ph = r.server.phase;
  const baseOn = r.base.state === "on";
  const baseNone = r.base.state === "none";
  const serverLight: Light = LIVE.has(ph) ? "on" : ph === "starting" ? "starting" : ph === "failed" ? "error" : "off";
  const baseLight: Light = baseNone ? "none" : baseOn ? "on" : "off";
  const outside = ph === "running" && !r.server.managed;
  const port = r.server.port ?? null;
  const baseSub = baseNone ? "Sin base encontrada" : [r.base.databases.find((d) => d.app)?.name ?? r.base.databases[0]?.name, r.base.port ? `puerto ${r.base.port}` : null].filter(Boolean).join(" · ");
  const shared = r.base.shared_with.length ? `La comparten ${r.base.shared_with.join(", ")}.` : null;
  const base: MaqView["base"] = {
    light: baseLight,
    word: baseNone ? "Sin base" : baseOn ? "Encendida" : "Apagada",
    sub: baseSub,
    lever: baseNone || !r.base.lever.can ? null : baseOn ? { act: "apagar", label: "Apagar", on: true } : { act: "encender", label: "Encender", on: false },
    reason: r.base.lever.can ? null : r.base.lever.reason,
    // The server is shared by every floor on it: the lever says so (Plan, decision 2).
    warn: r.base.lever.can && baseOn ? ["Este Postgres es de toda la Mac.", shared].filter(Boolean).join(" ") : null,
  };
  const server = (word: string, sub: string, lever: MaqView["server"]["lever"]): MaqView["server"] => ({ light: serverLight, word, sub, lever, outside });
  const common = { base, lights: { server: serverLight, base: baseLight }, drawers: baseOn };
  if (!r.configured && r.no_code)
    return { ...common, state: "no-code", word: "Todavía sin código", say: NO_CODE_SAY, server: server("Sin código", "No hay nada que encender todavía", null), pipes: { window: "dark", base: "dark" }, window: "setup", lights: { server: "none", base: baseLight } };
  if (!r.configured)
    return { ...common, state: "unconfigured", word: "Sin configurar", say: "Este piso no sabe cómo encenderse.", server: server("Sin configurar", "Falta cómo arrancarla", null), pipes: { window: "dark", base: "dark" }, window: "setup", lights: { server: "none", base: baseLight } };
  if (ph === "starting")
    return { ...common, state: "starting", word: "Encendiendo", say: "Trae la copia de prueba, instala y arranca.", server: server("Encendiendo…", port ? `puerto ${port}` : "buscando un puerto", null), pipes: { window: "dark", base: baseOn ? "lit" : "dark" }, window: "starting" };
  if (ph === "failed")
    return { ...common, state: "failed", word: "No arrancó", say: r.server.error ?? "La copia de prueba no arrancó.", server: server("No arrancó", r.server.error ?? "", { act: "encender", label: "Reintentar", on: false }), pipes: { window: "dark", base: baseOn ? "lit" : "dark" }, window: "failed" };
  if (LIVE.has(ph)) {
    const sub = r.server.url ? r.server.url.replace(/^https?:\/\//, "") : "";
    const lever = outside ? null : { act: "apagar" as const, label: "Apagar", on: true };
    if (!baseOn && !baseNone)
      return { ...common, state: "base-down", word: "Base caída", say: "La app está encendida, pero no llega a su base.", server: server("Encendida", sub, lever), pipes: { window: "lit", base: "red" }, window: "live" };
    return { ...common, state: "on", word: "Encendida", say: outside ? "La encendiste fuera de Plania; aquí solo se mira." : "La app corre en tu Mac.", server: server("Encendida", sub, lever), pipes: { window: "lit", base: baseOn ? "lit" : "dark" }, window: "live" };
  }
  return { ...common, state: "off", word: "Apagada", say: "Nada arranca sin tu clic.", server: server("Apagada", `puerto ${port ?? "libre desde el suyo"}`, { act: "encender", label: "Encender", on: false }), pipes: { window: "dark", base: baseOn ? "lit" : "dark" }, window: "blinds" };
}

// The level switch's lights, when the room has not been read yet.
export const NO_LIGHTS = { server: "none" as Light, base: "none" as Light };

export const bytes = (n: number | null): string => {
  if (n === null) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
};
export const filas = (n: number) => (n === 1 ? "1 fila" : `${n.toLocaleString("es-MX")} filas`);

// The tablero (frame 10): rows in the building's order, the count in the link, and what Apagar todo stops.
export function tableroView(t: TableroRead) {
  const on = (r: TableroRow) => LIVE.has(r.phase) || r.phase === "starting";
  return {
    rows: t.floors.map((r) => ({
      ...r,
      on: on(r),
      word: !r.configured ? "Sin configurar" : r.phase === "failed" ? "No arrancó" : r.phase === "starting" ? "Encendiendo" : r.phase === "running" && !r.managed ? "Encendida fuera de Plania" : on(r) ? "Encendida" : "Apagada",
    })),
    count: t.floors.filter(on).length,
    // Only Plania's own copies can be turned off from here.
    stoppable: t.floors.filter((r) => r.managed && (on(r) || r.phase === "failed")).map((r) => r.project),
  };
}
export const tableroLabel = (count: number) => `Tablero · ${count} ${count === 1 ? "encendida" : "encendidas"}`;

// Cómo probarla's ticks, per browser.
export const tickKey = (slug: string, docId: string | null) => `edi-probar:${slug}:${docId ?? "paginas"}`;
// «Algo falló» fills Pedir with the step.
export const pedirFallo = (p: Paso) => `Al probar la app, el paso ${p.n} falló: «${p.text}». `;
