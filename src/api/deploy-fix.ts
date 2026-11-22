// PLA-I74-8: the production deploy as the ficha shows it, and «Pedir arreglo».
//   deployCardOf  for an initiative with merged steps not yet released: the newest production deploy that carries
//                 (or came after) their merge commits, when it failed, still builds, or waits for the live answer.
//                 Null once released, and when nothing of the initiative is waiting on a deploy.
//   pedirArreglo  a failed deploy becomes a Taller step under the initiative that carries the build log. One step
//                 per failed deploy: asking again returns the same key.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { pullRequests, tasks, type Task } from "../db/schema.js";
import { readDeployTruth, setDeployFix, type DeployState, type DeployTruth } from "../jobs/deploy-truth.js";
import { findProject } from "../mcp/queries.js";
import { ST } from "../state/status.js";
import { webCtx } from "../mcp/tx.js";
import { createTask } from "../mcp/writes.js";
import { serviceAgent } from "../runner/events.js";
import { defineWords, say } from "../words.js";

export type DeployCard = {
  state: Exclude<DeployState, "live">;
  sha: string | null;
  url: string | null;
  probe_url: string | null;
  log: string | null;
  at: string;
  fix_key: string | null;
};

// The step Taller gets. Agents read it; the owner reads its title on the board.
export const DEPLOY_FIX_WORDS = defineWords({
  es: {
    title: "Arreglar la construcción de producción",
    summary: "El servicio que publica no pudo construir la versión de producción.",
    scope: (init: string, sha: string | null, url: string | null, log: string) =>
      [
        `La construcción de producción falló después de integrar ${init}${sha ? ` (commit ${sha.slice(0, 7)})` : ""}.`,
        url ? `Página del despliegue: ${url}` : "",
        "",
        "Extracto del registro del servicio:",
        "```",
        log,
        "```",
        "",
        "Reproduce la construcción con el mismo comando que corre el servicio, arréglala en una rama nueva y abre el PR. No toques la configuración del servicio.",
      ]
        .filter((l, i) => l !== "" || i > 1)
        .join("\n"),
    checks: ["La construcción de producción pasa en local con el mismo comando que corre el servicio", "El siguiente despliegue de producción queda listo y la dirección de producción responde"],
    noLog: "(el servicio no dio registro)",
  },
  en: {
    title: "Fix the production build",
    summary: "The host could not build the production version.",
    scope: (init: string, sha: string | null, url: string | null, log: string) =>
      [
        `The production build failed after ${init} was merged${sha ? ` (commit ${sha.slice(0, 7)})` : ""}.`,
        url ? `Deploy page: ${url}` : "",
        "",
        "Excerpt of the host's log:",
        "```",
        log,
        "```",
        "",
        "Reproduce the build with the same command the host runs, fix it on a new branch and open the PR. Do not touch the host's settings.",
      ]
        .filter((l, i) => l !== "" || i > 1)
        .join("\n"),
    checks: ["The production build passes locally with the same command the host runs", "The next production deploy is ready and the production URL answers"],
    noLog: "(the host gave no log)",
  },
});

type Refusal = { error: string; status: 400 | 404 | 409; hint: string };
const LANDED_NOT_OUT: string[] = [ST.merged];

/** The merges of the initiative's steps that wait on a deploy: Merged, with a merge commit. */
async function waitingMerges(db: Db, kids: Pick<Task, "id" | "status">[]): Promise<{ sha: string; at: Date }[]> {
  const ids = kids.filter((k) => LANDED_NOT_OUT.includes(k.status)).map((k) => k.id);
  if (!ids.length) return [];
  const rows = await db
    .select({ sha: pullRequests.mergeSha, at: pullRequests.mergedAt })
    .from(pullRequests)
    .where(and(inArray(pullRequests.taskId, ids), isNotNull(pullRequests.mergedAt)));
  return rows.filter((r) => r.sha && r.at).map((r) => ({ sha: r.sha!.toLowerCase(), at: r.at! }));
}

/** The deploy is the one these merges wait on: it names one of their commits, or it was made after the first merge. */
export function carries(t: Pick<DeployTruth, "sha" | "created_at">, merges: { sha: string; at: Date }[]): boolean {
  if (!merges.length) return false;
  const sha = t.sha?.toLowerCase();
  if (sha && merges.some((m) => m.sha.startsWith(sha) || sha.startsWith(m.sha))) return true;
  const first = Math.min(...merges.map((m) => m.at.getTime()));
  return Date.parse(t.created_at) >= first;
}

export async function deployCardOf(db: Db, projectId: string, kids: Pick<Task, "id" | "status">[]): Promise<DeployCard | null> {
  const merges = await waitingMerges(db, kids);
  if (!merges.length) return null;
  const t = await readDeployTruth(db, projectId);
  if (!t || t.state === "live" || !carries(t, merges)) return null;
  return { state: t.state, sha: t.sha, url: t.url, probe_url: t.probe_url, log: t.log, at: t.created_at, fix_key: t.fix_key };
}

/** «Pedir arreglo»: a Ready Taller step under the initiative with the failed build's log. */
export async function pedirArreglo(db: Db, slug: string, key: string): Promise<{ key: string; existing: boolean } | Refusal> {
  const p = await findProject(db, slug);
  const [init] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  if (!init || init.kind !== "initiative") return { error: "TASK_NOT_FOUND", status: 404, hint: "no such initiative" };
  const kids = await db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(and(eq(tasks.parentId, init.id), eq(tasks.kind, "ticket")));
  const t = await readDeployTruth(db, p.id);
  if (!t || t.state !== "error" || !carries(t, await waitingMerges(db, kids))) return { error: "DEPLOY_NOT_FAILED", status: 409, hint: "the production deploy of this initiative has not failed" };
  if (t.fix_key) return { key: t.fix_key, existing: true };
  const w = say(DEPLOY_FIX_WORDS);
  const taller = await serviceAgent(db, "taller", p);
  const made = (await createTask(
    db,
    {
      project: p.slug,
      parent_key: init.key,
      ...(taller ? { owner_agent: taller.slug } : {}),
      title: w.title,
      summary: w.summary,
      scope: w.scope(init.key, t.sha, t.url, t.log ?? w.noLog),
      checks: w.checks,
      status: ST.ready,
      work_type: "bug",
      // Production is down for the new version: high, not total (the previous version keeps serving).
      severity: "S2",
      found_in: "prod",
      priority: "P1",
    } as never,
    { ...webCtx, tool: "company.deploy_fix", requestId: `deploy-fix:${p.id}:${t.deployment_id}` },
  )) as { key: string };
  await setDeployFix(db, p.id, t.deployment_id, made.key);
  return { key: made.key, existing: false };
}
