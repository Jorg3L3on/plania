// PLA-I72-1: the copies of a project in Máquinas. One start copy (the start branch, src/captures/prueba.ts «sandbox»)
// and one per open initiative, built from its integration branch with its own port, worktree and base
// (<db>_ini_<key>). The processes live in memory; maquina_copias keeps the names, «No apagarla sola» and what the owner
// last asked, so a Plania restart lists them again (reconcileCopias). Borrar la copia stops the server, drops the
// base and removes the worktree; the start copy and the app's own base are never deleted from here.
import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { maquinaCopias, projects, tasks, type MaquinaCopia } from "../db/schema.js";
import { writeTx } from "../mcp/tx.js";
import {
  apagar,
  apagarIni,
  appBaseUrl,
  borrarIni,
  encender,
  encenderIni,
  entregaUrl,
  iniDatabaseName,
  iniRead,
  iniSuffix,
  iniWorktree,
  keepOf,
  pruebaInfo,
  pruebaRead,
  reiniciar,
  setKeep,
  type BorrarResult,
  type PruebaPhase,
} from "../captures/prueba.js";
import { liveDatabaseName } from "../self/plania-self.js";
import { existsSync } from "node:fs";
import { defineWords, say } from "../words.js";
import { MaquinaError } from "./errors.js";
import { ctx, menv, projectOf, type ProjectRow } from "./machines.js";
import { appDirs } from "./env.js";

export const COPIAS_WORDS = defineWords({
  es: {
    notFound: "No encuentro esa copia",
    closed: "La iniciativa ya está cerrada; su copia no se enciende",
    noBranch: "La iniciativa no tiene rama todavía",
    startCopy: "La copia de inicio no se borra; solo se apaga",
    protectedBase: "Esa base es de la app o de la copia de inicio; no la borro",
    inicio: "Inicio",
  },
  en: {
    notFound: "I can't find that copy",
    closed: "The initiative is closed; its copy does not start",
    noBranch: "The initiative has no branch yet",
    startCopy: "The start copy is not deleted; it is only turned off",
    protectedBase: "That database is the app's or the start copy's; I do not delete it",
    inicio: "Start",
  },
});

export const START_ID = "inicio";
const CLOSED = ["Done", "Won't do"];

export type CopiaRead = {
  id: string; // "inicio" or the initiative's key
  kind: "inicio" | "iniciativa";
  key: string | null;
  title: string;
  status: string | null; // the initiative's status
  branch: string | null;
  phase: PruebaPhase;
  managed: boolean;
  port: number | null;
  url: string | null;
  started_at: string | null;
  error: string | null;
  detail: string | null;
  keep: boolean;
  database: string | null;
  worktree: string | null;
  made: boolean; // its worktree exists on this machine
};
export type CopiasRead = { project: string; configured: boolean; copias: CopiaRead[] };

type Ini = { id: string; key: string; title: string; status: string; branch: string | null; baseBranch: string | null };

async function openInitiatives(db: Db, p: ProjectRow): Promise<Ini[]> {
  return db
    .select({ id: tasks.id, key: tasks.key, title: tasks.title, status: tasks.status, branch: tasks.branch, baseBranch: tasks.baseBranch })
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "initiative"), notInArray(tasks.status, CLOSED)))
    .orderBy(asc(tasks.createdAt));
}

async function liveRows(db: Db, projectId: string): Promise<MaquinaCopia[]> {
  return db.select().from(maquinaCopias).where(and(eq(maquinaCopias.projectId, projectId), isNull(maquinaCopias.deletedAt)));
}

/** The names Plania never deletes for a project: the app's own base and the start copy's. */
export function protectedBases(p: ProjectRow): Set<string> {
  const out = new Set<string>();
  const base = appBaseUrl(p);
  const app = base ? (liveDatabaseName(base) ?? null) : null;
  if (app) {
    out.add(app);
    out.add(`${app}_prueba`);
    out.add(`${app}_entrega`);
  }
  const start = base ? entregaUrl(base, "_prueba")?.name : null;
  if (start) out.add(start);
  return out;
}

function startCopy(p: ProjectRow, r: Awaited<ReturnType<typeof pruebaRead>>): CopiaRead {
  const info = pruebaInfo(p.slug);
  const base = appBaseUrl(p);
  return {
    id: START_ID,
    kind: "inicio",
    key: null,
    title: say(COPIAS_WORDS).inicio,
    status: null,
    branch: info?.branch ?? (p.settings.capture ? (p.settings.local as { start_branch?: string } | undefined)?.start_branch ?? "sandbox" : null),
    phase: r.phase,
    managed: r.managed,
    port: r.port,
    url: r.url,
    started_at: r.started_at,
    error: r.error,
    detail: r.detail,
    keep: keepOf(p.slug),
    database: p.settings.capture?.database && base ? (entregaUrl(base, "_prueba")?.name ?? null) : null,
    worktree: info?.worktree ?? appDirs(p.slug, p.settings, menv()).prueba,
    made: !!(info?.worktree ?? appDirs(p.slug, p.settings, menv()).prueba),
  };
}

function iniCopy(p: ProjectRow, i: Ini, row: MaquinaCopia | undefined, look: boolean): CopiaRead {
  const live = iniRead(p.slug, i.key, look);
  const worktree = row?.worktree ?? iniWorktree(p.slug, i.key);
  return {
    id: i.key,
    kind: "iniciativa",
    key: i.key,
    title: i.title,
    status: i.status,
    branch: live?.branch ?? row?.branch ?? i.branch ?? i.baseBranch,
    phase: live?.phase ?? "off",
    managed: live?.managed ?? false,
    port: live?.port ?? null,
    url: live?.url ?? null,
    started_at: live?.started_at ?? null,
    error: live?.error ?? null,
    detail: live?.detail ?? null,
    keep: live?.keep ?? row?.keep ?? false,
    database: live?.database ?? row?.database ?? null,
    worktree: row || live ? worktree : null,
    made: existsSync(worktree),
  };
}

/** Every copy of a project: the start copy first, then one per open initiative (the ones with a copy first). */
export async function copiasRead(db: Db, slug: string, look = true): Promise<CopiasRead> {
  const p = await projectOf(db, slug);
  const s = p.settings.capture;
  const rows = await liveRows(db, p.id);
  const byKey = new Map(rows.map((r) => [r.initiativeKey, r]));
  const inis = await openInitiatives(db, p);
  const list = inis.map((i) => iniCopy(p, i, byKey.get(i.key), look));
  list.sort((a, b) => Number(!!b.worktree) - Number(!!a.worktree));
  return { project: slug, configured: !!s, copias: [startCopy(p, await pruebaRead(slug, s)), ...list] };
}

async function initiativeOf(db: Db, p: ProjectRow, key: string): Promise<Ini & { closed: boolean }> {
  const [t] = await db
    .select({ id: tasks.id, key: tasks.key, title: tasks.title, status: tasks.status, branch: tasks.branch, baseBranch: tasks.baseBranch })
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "initiative"), eq(tasks.key, key)));
  if (!t) throw new MaquinaError("COPY_NOT_FOUND", say(COPIAS_WORDS).notFound);
  return { ...t, closed: CLOSED.includes(t.status) };
}

async function rowOf(db: Db, projectId: string, key: string): Promise<MaquinaCopia | undefined> {
  const [r] = await db
    .select()
    .from(maquinaCopias)
    .where(and(eq(maquinaCopias.projectId, projectId), eq(maquinaCopias.initiativeKey, key), isNull(maquinaCopias.deletedAt)));
  return r;
}

export type CopiaAction = "encender" | "apagar" | "reiniciar" | "borrar" | "quedarse";

/** One action on one copy. id is "inicio" or an initiative key. The answer is the copies again (and, for borrar,
 * what was dropped and removed). */
export async function copiaAction(db: Db, slug: string, id: string, action: CopiaAction, body: { keep?: unknown } = {}): Promise<CopiasRead & { borrada?: BorrarResult }> {
  const W = say(COPIAS_WORDS);
  const p = await projectOf(db, slug);
  if (!p.settings.capture) throw new MaquinaError("NOT_CONFIGURED", "settings.capture");
  if (id === START_ID) {
    if (action === "borrar") throw new MaquinaError("COPY_NOT_DELETABLE", W.startCopy);
    if (action === "encender") await encender(db, slug, { stills: false });
    else if (action === "apagar") await apagar(db, slug);
    else if (action === "reiniciar") await reiniciar(db, slug, { stills: false });
    else if (action === "quedarse") {
      if (!setKeep(slug, "sandbox", null, body.keep === true)) throw new MaquinaError("COPY_NOT_FOUND", W.notFound);
    }
    return copiasRead(db, slug);
  }
  const ini = await initiativeOf(db, p, id);
  const row = await rowOf(db, p.id, ini.key);
  if (action === "encender" || action === "reiniciar") {
    if (ini.closed) throw new MaquinaError("INITIATIVE_CLOSED", W.closed);
    const branch = ini.branch ?? ini.baseBranch;
    if (!branch) throw new MaquinaError("NO_BRANCH", W.noBranch);
    if (action === "reiniciar") await apagarIni(db, slug, ini.key);
    const database = iniDatabaseName(p, ini.key);
    const worktree = iniWorktree(slug, ini.key);
    if (row) {
      await db.update(maquinaCopias).set({ state: "on", startedAt: new Date(), branch, worktree, database, updatedAt: new Date() }).where(eq(maquinaCopias.id, row.id));
    } else {
      await writeTx(db, p, ctx(), async (tx, emit) => {
        await tx.insert(maquinaCopias).values({ projectId: p.id, initiativeId: ini.id, initiativeKey: ini.key, branch, worktree, database, state: "on", startedAt: new Date() });
        await emit("machine.copy_created", { id: ini.id, key: ini.key }, { branch, worktree, database });
      });
    }
    await encenderIni(db, slug, { key: ini.key, branch, keep: row?.keep ?? iniRead(slug, ini.key, false)?.keep ?? false });
  } else if (action === "apagar") {
    await apagarIni(db, slug, ini.key);
    if (row) await db.update(maquinaCopias).set({ state: "off", updatedAt: new Date() }).where(eq(maquinaCopias.id, row.id));
  } else if (action === "quedarse") {
    const keep = body.keep === true;
    if (!row && !iniRead(slug, ini.key, false)) throw new MaquinaError("COPY_NOT_FOUND", W.notFound);
    setKeep(slug, "iniciativa", ini.key, keep);
    if (row) await db.update(maquinaCopias).set({ keep, updatedAt: new Date() }).where(eq(maquinaCopias.id, row.id));
  } else if (action === "borrar") {
    const borrada = await deleteCopy(db, p, ini.key, ini.id, row, "owner");
    return { ...(await copiasRead(db, slug)), borrada };
  }
  return copiasRead(db, slug);
}

/** Stops, drops and removes an initiative's copy (Borrar la copia, and step 3's clean-up on close). Refuses a
 * protected base name before touching anything. */
export async function deleteCopy(db: Db, p: ProjectRow, key: string, initiativeId: string | null, row: MaquinaCopia | undefined, why: "owner" | "closed" | "sweep"): Promise<BorrarResult> {
  const database = row?.database ?? iniDatabaseName(p, key);
  const worktree = row?.worktree ?? iniWorktree(p.slug, key);
  if (database && (protectedBases(p).has(database) || !database.endsWith(iniSuffix(key)))) throw new MaquinaError("BASE_PROTECTED", say(COPIAS_WORDS).protectedBase, { database });
  const r = await borrarIni(db, p.slug, key, { database, worktree });
  await writeTx(db, p, ctx(), async (tx, emit) => {
    if (row) await tx.update(maquinaCopias).set({ deletedAt: new Date(), state: "off", updatedAt: new Date() }).where(eq(maquinaCopias.id, row.id));
    await emit("machine.copy_deleted", initiativeId ? { id: initiativeId, key } : null, { key, database: r.database, dropped: r.dropped, worktree: r.worktree, removed: r.removed, why });
  });
  return r;
}

/** At Plania's start: nothing it started survives a stop, so every copy row still marked on is set off. The rows
 * stay (names, keep), so the copies are listed again and Encender brings them back with their base as it was. */
export async function reconcileCopias(db: Db): Promise<number> {
  const rows = await db.select({ id: maquinaCopias.id, projectId: maquinaCopias.projectId, key: maquinaCopias.initiativeKey }).from(maquinaCopias).where(and(isNull(maquinaCopias.deletedAt), eq(maquinaCopias.state, "on")));
  let n = 0;
  for (const r of rows) {
    const [p] = await db.select({ slug: projects.slug }).from(projects).where(eq(projects.id, r.projectId));
    if (p && iniRead(p.slug, r.key, false)) continue;
    await db.update(maquinaCopias).set({ state: "off", updatedAt: new Date() }).where(eq(maquinaCopias.id, r.id));
    n += 1;
  }
  return n;
}

/** PLA-I72-4: after a key changed, every running copy is restarted so it reads its env file again. */
export async function reiniciarEncendidas(db: Db, slug: string): Promise<CopiasRead & { reiniciadas: string[] }> {
  const before = await copiasRead(db, slug, false);
  const on = before.copias.filter((c) => c.managed && ["live", "capturing", "starting"].includes(c.phase));
  for (const c of on) await copiaAction(db, slug, c.id, "reiniciar");
  return { ...(await copiasRead(db, slug)), reiniciadas: on.map((c) => c.id) };
}
