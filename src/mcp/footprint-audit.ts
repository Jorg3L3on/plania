import { describeStale, primaryPgPort, spanAgo } from "../jobs/machine/infer.js";
import { readerOf } from "../store/port.js";
import type { Finding } from "./audit.js";
import type { Q } from "./tx.js";

// The audit findings about what runs on the Mac (PLA-I1-5). Pure reads of `footprints`. A row with a
// project goes to that project's audit; the ones without (Plania's own repo, shared servers and
// services, anything nobody owns) are served with GET /api/machine, since no project audit can hold them.
// fix_hint is the row's teardown when it has one; Plania only shows it, never runs it.

// A service that was there before the machine job first ran was installed before Plania was watching:
// Google's and Apple's updaters, an old brew service. One that shows up afterwards was started while
// agents were working, which is what SERVICE_STARTS_AT_LOGIN is about. The first run sees everything at
// once (the 5-minute collectors can be a tick late), so the baseline gets this much slack.
export const WATCHING_GRACE_MS = 15 * 60_000;

type Scope = { projectId: string } | { projectless: true };

export async function footprintFindings(db: Q, scope: Scope, now = new Date()): Promise<Finding[]> {
  const r = readerOf(db);
  const found = await r.find(
    "footprints",
    { releasedAt: null, projectId: "projectId" in scope ? scope.projectId : null },
    { orderBy: [{ column: "kind" }, { column: "locator" }] },
  );
  if (!found.length) return [];
  // The ticket key of each row, when its ticket still exists.
  const taskIds = [...new Set(found.map((f) => f.taskId).filter((id): id is string => !!id))];
  const keys = new Map(taskIds.length ? (await r.find("tasks", { id: taskIds })).map((t) => [t.id, t.key]) : []);
  const rows = found.map((f) => ({ f, key: (f.taskId && keys.get(f.taskId)) ?? null }));

  const out: Finding[] = [];
  const hint = (teardown: string, otherwise: string) => teardown || otherwise;
  // When each machine was first watched: its earliest first sighting over every row, released ones too.
  let baseline: Map<string, number> | undefined;
  const watchStart = async (machine: string) => {
    if (!baseline) {
      baseline = new Map();
      for (const f of await r.find("footprints")) {
        if (!f.firstSeenAt) continue;
        const at = f.firstSeenAt.getTime();
        if (at < (baseline.get(f.machine) ?? Infinity)) baseline.set(f.machine, at);
      }
    }
    return baseline.get(machine) ?? null;
  };

  for (const { f, key } of rows) {
    if (f.state === "gone" || f.state === "released") continue;
    const label = `${f.kind} ${f.locator}`;
    const d = f.details;
    if (f.state === "orphan") {
      const seen = f.firstSeenAt ? ` (visto hace ${spanAgo(now.getTime() - f.firstSeenAt.getTime())})` : "";
      out.push({ code: "FOOTPRINT_ORPHAN", key, detail: `${label}: nadie lo declaró y no se sabe de quién es${seen}`, fix_hint: hint(f.teardown, "register_footprint with its purpose and teardown if it is yours, or ask Jorge") });
    }
    if (f.state === "stale") {
      const why = describeStale(d, now) ?? "obsoleto";
      if (f.kind === "worktree") {
        out.push({ code: "WORKTREE_MERGED_NOT_REMOVED", key, detail: `${label}: ${why}`, fix_hint: hint(f.teardown, "remove the worktree once nothing in it is needed"), id: f.locator, ...(f.teardown ? { command: f.teardown } : {}) });
      } else {
        out.push({ code: "FOOTPRINT_STALE", key, detail: `${label}: ${why}`, fix_hint: hint(f.teardown, "release_footprint once it is gone, or ask Jorge") });
      }
    }
    // A <project>_test_<hash> database the tests of a checkout made: the hash is the checkout's path
    // (test/helpers.ts). The job matched it against the main checkout and every known worktree of the
    // repo and stored repo_path; null means none of them is left.
    if (f.kind === "database" && typeof d.test_hash === "string" && d.repo_path === null) {
      out.push({ code: "DATABASE_WITHOUT_WORKTREE", key, detail: `${label}: la copia de pruebas ${d.test_hash} era de un checkout que ya no existe`, fix_hint: hint(f.teardown, "drop the database") });
    }
    // A Postgres nobody declared on a port other than the main one: a scratch server an agent started.
    // It is primary (no teardown), so the hint never stops it.
    if (f.kind === "db_server" && f.source === "observed" && d.engine === "postgres" && Number(d.port) !== primaryPgPort()) {
      out.push({
        code: "SECONDARY_DB_SERVER",
        key,
        detail: `${label}: servidor de bases secundario (principal :${primaryPgPort()}) que ningún proyecto declaró`,
        fix_hint: "register_footprint kind db_server with its purpose and teardown, or ask Jorge whether it should stay",
      });
    }
    // Started at login, not attributed to a repo, and first seen after Plania began watching.
    if (f.kind === "service" && f.source === "observed" && d.attributed === false && f.firstSeenAt && (d.manager !== "brew" || d.status === "started")) {
      const start = await watchStart(f.machine);
      if (start !== null && f.firstSeenAt.getTime() > start + WATCHING_GRACE_MS) {
        out.push({
          code: "SERVICE_STARTS_AT_LOGIN",
          key,
          detail: `${label}: apareció hace ${spanAgo(now.getTime() - f.firstSeenAt.getTime())} y arranca al iniciar sesión; ningún proyecto lo declaró`,
          // Never a stop command: it may hold a database someone uses. Declare it, or ask.
          fix_hint: "register_footprint kind service with its purpose and teardown, or ask Jorge whether it should stay",
        });
      }
    }
  }
  return out;
}
