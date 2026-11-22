// PLA-I72-3: Sobrantes. What closed initiatives (and crashed servers) left on this Mac: bases named like Plania's
// copies of this project with no live copy, servers Plania registered whose copy is not running in this process, and
// copy folders with no open initiative. Each with the initiative it came from, when that closed, and its size (or
// memory for a server). Only what Plania created and registered is a candidate: a footprint of this project must
// name it. The app's own base, the start copy's base and folder, and any other project's base never appear.
// Also the clean-up: a closed initiative's copy is deleted (cleanClosedCopies, every few minutes and on any change to
// the project) and a nightly sweep does the same and records what it found.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { footprints, machineState, maquinaCopias, projects, tasks } from "../db/schema.js";
import { bus } from "../events.js";
import { releaseFootprint } from "../mcp/footprint.js";
import { appBaseUrl, copyRuntime, idOf, iniSuffix, pgPathFor } from "../captures/prueba.js";
import { checkoutEnv, shellExec } from "../captures/run.js";
import { defaultGit, repoPathOf, worktreeRoot } from "../runner/worktree.js";
import { processCommand } from "../lib/proc-command.js";
import { killTree } from "../lib/proc-tree.js";
import { liveDatabaseName } from "../self/plania-self.js";
import { defineWords, say } from "../words.js";
import { deleteCopy, protectedBases } from "./copias.js";
import { MaquinaError } from "./errors.js";
import { ctx, mdeps, menv, projectOf, type ProjectRow } from "./machines.js";
import { numerosDeps, parsePs, treeUsage } from "./numeros.js";

export const SOBRANTES_WORDS = defineWords({
  es: {
    notFound: "Ese sobrante ya no está",
    changed: "La lista de sobrantes cambió; mírala otra vez antes de borrar todo",
    failed: "No se pudo borrar",
  },
  en: {
    notFound: "That leftover is gone",
    changed: "The list of leftovers changed; look at it again before deleting everything",
    failed: "Could not delete it",
  },
});

const CLOSED = ["Done", "Won't do"];
const MERGED = ["Merged", "Released", "Done", "Won't do"];
const PLANIA_SESSION = "plania-prueba";

export type Sobrante = {
  id: string; // kind:name, stable while the thing exists
  kind: "base" | "servidor" | "carpeta";
  name: string;
  initiative: { key: string; title: string; status: string; closed_at: string | null } | null;
  size_bytes: number | null;
  mem_bytes: number | null;
  port: number | null;
};
export type SobrantesRead = { project: string; sobrantes: Sobrante[]; total: number; total_bytes: number; swept_at: string | null };

type Ini = { id: string; key: string; title: string; status: string; resolvedAt: Date | null; statusChangedAt: Date | null };

async function initiatives(db: Db, projectId: string): Promise<Map<string, Ini>> {
  const rows = await db
    .select({ id: tasks.id, key: tasks.key, title: tasks.title, status: tasks.status, resolvedAt: tasks.resolvedAt, statusChangedAt: tasks.statusChangedAt })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "initiative")));
  return new Map(rows.map((r) => [r.key, r]));
}
// A folder or base name back to the initiative it was made for (_ini_<key lowercased>).
function iniOfSuffix(inis: Map<string, Ini>, name: string): Ini | null {
  for (const i of inis.values()) if (name.endsWith(iniSuffix(i.key))) return i;
  return null;
}
const iniInfo = (i: Ini | null): Sobrante["initiative"] =>
  i ? { key: i.key, title: i.title, status: i.status, closed_at: CLOSED.includes(i.status) ? (i.resolvedAt ?? i.statusChangedAt)?.toISOString() ?? null : null } : null;
const isOpen = (i: Ini | null) => !!i && !CLOSED.includes(i.status);

async function fps(db: Db, projectId: string, kind: string) {
  return db
    .select()
    .from(footprints)
    .where(and(eq(footprints.projectId, projectId), eq(footprints.kind, kind)));
}

export async function sobrantesRead(db: Db, slug: string): Promise<SobrantesRead> {
  const p = await projectOf(db, slug);
  const list = await findLeftovers(db, p);
  const [swept] = await db.select().from(machineState).where(eq(machineState.key, `maquinas:sweep:${slug}`));
  return { project: slug, sobrantes: list, total: list.length, total_bytes: list.reduce((a, s) => a + (s.size_bytes ?? 0), 0), swept_at: (swept?.value.at as string | undefined) ?? null };
}

export async function findLeftovers(db: Db, p: ProjectRow): Promise<Sobrante[]> {
  const inis = await initiatives(db, p.id);
  const rows = await db.select().from(maquinaCopias).where(and(eq(maquinaCopias.projectId, p.id), isNull(maquinaCopias.deletedAt)));
  // A copy is still wanted while its row is live and its initiative is open.
  const wanted = new Set(rows.filter((r) => isOpen(inis.get(r.initiativeKey) ?? null)).map((r) => r.initiativeKey));
  const nd = numerosDeps();
  const out: Sobrante[] = [];

  // Bases: <app db>_ini_* and <app db>_entrega, present in the engine and once registered by Plania for this project.
  const base = appBaseUrl(p);
  const app = base ? liveDatabaseName(base) : null;
  if (base && app) {
    const keep = protectedBases(p);
    const registered = new Set((await fps(db, p.id, "database")).map((f) => f.locator.split("@")[0]!));
    let present: { name: string; size: number | null }[] = [];
    try {
      const r = await nd.query(base, `select datname as name, pg_database_size(datname) as size from pg_database where datname like $1 or datname = $2`, [`${app}\\_ini\\_%`, `${app}_entrega`]);
      present = r.map((x) => ({ name: String(x.name), size: x.size === null || x.size === undefined ? null : Number(x.size) }));
    } catch {
      present = [];
    }
    const entregaOn = !!copyRuntime(idOf(p.slug, "entrega"));
    for (const d of present) {
      if (keep.has(d.name) || !registered.has(d.name)) continue;
      if (!d.name.startsWith(`${app}_`)) continue;
      if (d.name === `${app}_entrega`) {
        if (entregaOn) continue;
        out.push({ id: `base:${d.name}`, kind: "base", name: d.name, initiative: null, size_bytes: d.size, mem_bytes: null, port: null });
        continue;
      }
      const i = iniOfSuffix(inis, d.name);
      if (i && wanted.has(i.key)) continue;
      out.push({ id: `base:${d.name}`, kind: "base", name: d.name, initiative: iniInfo(i), size_bytes: d.size, mem_bytes: null, port: null });
    }
  }

  // Servers: registered by Plania's copies, still live, but not running in this process.
  const servers = (await fps(db, p.id, "server")).filter((f) => !f.releasedAt && (f.holder as { session_id?: string } | null)?.session_id === PLANIA_SESSION);
  for (const f of servers) {
    const d = ((f.details.declared ?? f.details) as { pid?: number; copy_id?: string; task_key?: string; lane?: string }) ?? {};
    const copyId = d.copy_id ?? (d.lane === "entrega" ? idOf(p.slug, "entrega") : d.lane === "iniciativa" && d.task_key ? idOf(p.slug, "iniciativa", d.task_key) : p.slug);
    if (copyRuntime(copyId)) continue;
    const i = d.lane === "iniciativa" && d.task_key ? (inis.get(d.task_key) ?? null) : null;
    let mem: number | null = null;
    if (Number.isInteger(d.pid)) {
      try {
        mem = treeUsage(parsePs(await nd.ps()), d.pid!)?.rss ?? null;
      } catch {
        mem = null;
      }
    }
    out.push({ id: `servidor:${f.locator}`, kind: "servidor", name: f.locator, initiative: iniInfo(i), size_bytes: null, mem_bytes: mem, port: Number(f.locator.replace(/^port:/, "")) || null });
  }

  // Folders: <worktrees>/<slug>/_ini_* that Plania registered, with no wanted copy.
  const root = path.join(worktreeRoot(menv()), p.slug);
  const registeredWt = new Set((await fps(db, p.id, "worktree")).map((f) => f.locator));
  let names: string[] = [];
  try {
    names = existsSync(root) ? readdirSync(root).filter((n) => n.startsWith("_ini_")) : [];
  } catch {
    names = [];
  }
  for (const n of names) {
    const full = path.join(root, n);
    if (!registeredWt.has(full)) continue;
    const i = iniOfSuffix(inis, n);
    if (i && wanted.has(i.key)) continue;
    if (i && copyRuntime(idOf(p.slug, "iniciativa", i.key))) continue;
    out.push({ id: `carpeta:${n}`, kind: "carpeta", name: n, initiative: iniInfo(i), size_bytes: await nd.du(full).catch(() => null), mem_bytes: null, port: null });
  }
  return out;
}

// The copies' footprints are held by the copy runner's session (src/captures/prueba.ts) on the machine that registered
// them: released as that holder, found by the row itself (a database by its name, whatever host spelling it has).
async function releaseAsCopy(db: Db, p: ProjectRow, kind: "database" | "server" | "worktree", match: { locator?: string; name?: string }): Promise<void> {
  const rows = await db
    .select()
    .from(footprints)
    .where(and(eq(footprints.projectId, p.id), eq(footprints.kind, kind), isNull(footprints.releasedAt)));
  const hit = rows.filter((r) => (match.locator ? r.locator === match.locator : r.locator.split("@")[0] === match.name));
  for (const r of hit) {
    const session = (r.holder as { session_id?: string } | null)?.session_id ?? PLANIA_SESSION;
    await releaseFootprint(db, { project: p.slug, kind, locator: r.locator }, { ...ctx(), actor: { ...ctx().actor, session_id: session, machine: r.machine } }).catch((e) => console.log(`[maquinas] could not release ${kind} ${r.locator}: ${e instanceof Error ? e.message : String(e)}`));
  }
}

async function removeOne(db: Db, p: ProjectRow, s: Sobrante): Promise<void> {
  const exec = mdeps().exec ?? shellExec;
  const repo = repoPathOf(p.slug, p.settings, menv());
  if (s.kind === "base") {
    const base = appBaseUrl(p)!;
    if (protectedBases(p).has(s.name) || !/^[A-Za-z0-9_]{1,90}$/.test(s.name)) throw new MaquinaError("BASE_PROTECTED", "");
    const r = await exec(`psql "$PLANIA_BASE_URL" -X -v ON_ERROR_STOP=1 -q -c 'drop database if exists ${s.name} with (force)'`, { cwd: existsSync(repo) ? repo : "/", timeoutMs: 120_000, env: checkoutEnv({ PATH: await pgPathFor(base), PLANIA_BASE_URL: base }) });
    if (r.code !== 0) throw new MaquinaError("COMMAND_FAILED", say(SOBRANTES_WORDS).failed);
    await releaseAsCopy(db, p, "database", { name: s.name });
  } else if (s.kind === "servidor") {
    const [f] = await db.select().from(footprints).where(and(eq(footprints.projectId, p.id), eq(footprints.kind, "server"), eq(footprints.locator, s.name), isNull(footprints.releasedAt)));
    const d = ((f?.details.declared ?? f?.details) ?? {}) as { pid?: number; command?: string };
    if (Number.isInteger(d.pid) && d.pid! > 1) {
      const cmd = await (sobDeps.cmdOf ?? processCommand)(d.pid!);
      if (cmd && d.command && cmd.includes(d.command)) (sobDeps.kill ?? killTree)(d.pid!, "SIGTERM");
    }
    await releaseAsCopy(db, p, "server", { locator: s.name });
  } else {
    const full = path.join(worktreeRoot(menv()), p.slug, s.name);
    if (!/^_ini_[a-z0-9_]+$/.test(s.name)) throw new MaquinaError("BASE_PROTECTED", "");
    const g = sobDeps.git ?? defaultGit;
    if (existsSync(repo)) await g(["worktree", "remove", "--force", full], repo);
    const { rmSync } = await import("node:fs");
    if (existsSync(full)) rmSync(full, { recursive: true, force: true });
    if (existsSync(repo)) await g(["worktree", "prune"], repo);
    await releaseAsCopy(db, p, "worktree", { locator: full });
  }
  // A closed initiative's copy row goes once its pieces do.
  const i = s.initiative;
  if (i && CLOSED.includes(i.status)) {
    await db.update(maquinaCopias).set({ deletedAt: new Date(), state: "off", updatedAt: new Date() }).where(and(eq(maquinaCopias.projectId, p.id), eq(maquinaCopias.initiativeKey, i.key), isNull(maquinaCopias.deletedAt)));
  }
}

type SobDeps = { git?: typeof defaultGit; kill?: (pid: number, sig: NodeJS.Signals) => void; cmdOf?: (pid: number) => Promise<string | null> };
let sobDeps: SobDeps = {};
export function setSobrantesDeps(d: SobDeps): void {
  sobDeps = d;
}

/** Borrar one leftover (id from the list). Refused when it is no longer on the list. */
export async function borrarSobrante(db: Db, slug: string, id: string): Promise<SobrantesRead> {
  const p = await projectOf(db, slug);
  const s = (await findLeftovers(db, p)).find((x) => x.id === id);
  if (!s) throw new MaquinaError("LEFTOVER_NOT_FOUND", say(SOBRANTES_WORDS).notFound);
  await removeOne(db, p, s);
  return sobrantesRead(db, slug);
}

/** Borrar todo: every leftover, only when the list still has the total the screen showed (a guard like Vaciar y
 * sembrar's rows), so a list that changed in between is refused. */
export async function borrarTodo(db: Db, slug: string, expected: unknown): Promise<SobrantesRead & { borrados: number }> {
  const p = await projectOf(db, slug);
  const list = await findLeftovers(db, p);
  if (typeof expected !== "number" || expected !== list.length) throw new MaquinaError("LEFTOVERS_CHANGED", say(SOBRANTES_WORDS).changed, { total: list.length });
  // Servers first (they may hold a base open), then bases, then folders.
  const order = { servidor: 0, base: 1, carpeta: 2 } as const;
  let n = 0;
  for (const s of [...list].sort((a, b) => order[a.kind] - order[b.kind])) {
    await removeOne(db, p, s);
    n += 1;
  }
  return { ...(await sobrantesRead(db, slug)), borrados: n };
}

// ---- clean-up on close

/** Initiatives that closed (Done, Won't do) or whose tickets are all merged: their copy is stopped and deleted. */
export async function cleanClosedCopies(db: Db, onlyProject?: string): Promise<number> {
  const rows = await db
    .select({ row: maquinaCopias, slug: projects.slug, status: tasks.status, iniId: tasks.id })
    .from(maquinaCopias)
    .innerJoin(projects, eq(projects.id, maquinaCopias.projectId))
    .leftJoin(tasks, eq(tasks.id, maquinaCopias.initiativeId))
    .where(and(isNull(maquinaCopias.deletedAt), onlyProject ? eq(projects.slug, onlyProject) : sql`true`));
  let n = 0;
  for (const r of rows) {
    let closed = !r.status || CLOSED.includes(r.status);
    if (!closed && r.iniId) {
      const kids = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.parentId, r.iniId));
      closed = kids.length > 0 && kids.every((k) => MERGED.includes(k.status)) && kids.some((k) => k.status !== "Won't do");
    }
    if (!closed) continue;
    const p = await projectOf(db, r.slug);
    try {
      await deleteCopy(db, p, r.row.initiativeKey, r.iniId, r.row, "closed");
      n += 1;
    } catch (e) {
      console.log(`[maquinas] could not delete the copy of ${r.row.initiativeKey}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return n;
}

/** The nightly sweep: deletes closed initiatives' copies and records what is left over in every project with copies. */
export async function nightlySweep(db: Db, now: Date): Promise<{ cleaned: number; leftovers: number }> {
  const cleaned = await cleanClosedCopies(db);
  let leftovers = 0;
  const ps = await db.select().from(projects).where(sql`${projects.settings} ? 'capture'`);
  for (const p of ps) {
    const list = await findLeftovers(db, p).catch(() => []);
    leftovers += list.length;
    const value = { at: now.toISOString(), total: list.length, bytes: list.reduce((a, s) => a + (s.size_bytes ?? 0), 0) };
    await db
      .insert(machineState)
      .values({ key: `maquinas:sweep:${p.slug}`, value })
      .onConflictDoUpdate({ target: machineState.key, set: { value, updatedAt: new Date() } });
  }
  return { cleaned, leftovers };
}

// Any change to a project's tasks may close an initiative: its copy goes within a moment, not at the next tick.
let unwatch: (() => void) | null = null;
export function watchClosures(run: (slug: string) => void): () => void {
  if (unwatch) return unwatch;
  const pending = new Map<string, NodeJS.Timeout>();
  const off = bus.subscribe((e) => {
    if (e.type !== "task" || !e.project) return;
    clearTimeout(pending.get(e.project));
    const t = setTimeout(() => {
      pending.delete(e.project);
      run(e.project);
    }, 2_000);
    t.unref?.();
    pending.set(e.project, t);
  });
  unwatch = () => {
    off();
    unwatch = null;
  };
  return unwatch;
}
