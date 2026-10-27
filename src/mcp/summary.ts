import type { Actor } from "../db/schema.js";

// 2.7: one Spanish line per event, for assistants that read the cross-project feed and the digest
// without knowing every payload shape. Unknown types fall back to "<key> · <type>".

type Ev = { type: string; task_key: string | null; actor: Actor; payload: Record<string, unknown> };

const who = (a: Actor) => a.agent;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const prNum = (p: Record<string, unknown>) => (p.number !== undefined ? `PR #${str(p.number)}` : str(p.url || p.pr) ? `PR ${str(p.url || p.pr)}` : "PR");

export function summarize(e: Ev): string {
  const k = e.task_key ?? "";
  const p = e.payload;
  const by = who(e.actor);
  switch (e.type) {
    case "task.created":
      return `${k} creado${p.title ? `: ${str(p.title)}` : ""} (${by})`;
    case "task.status":
      return `${k} → ${str(p.to)}${p.from ? ` (desde ${str(p.from)})` : ""} (${by})`;
    case "task.updated":
      return `${k} actualizado${Array.isArray(p.fields) ? `: ${(p.fields as unknown[]).map(str).join(", ")}` : ""} (${by})`;
    case "task.rekeyed":
      return `${str(p.from) || k} ahora es ${str(p.to) || k}`;
    case "task.approved_move":
      return `${k} movido con aprobación → ${str(p.to)} (${by})`;
    case "note":
      return `${k} nota (${by}): ${str(p.text ?? p.note).slice(0, 140)}`;
    case "claim.acquired":
      return `${k} tomado por ${by}${(p.workspace as { branch?: string } | undefined)?.branch ? ` en ${(p.workspace as { branch?: string }).branch}` : ""}`;
    case "claim.released":
      return `${k} liberado por ${by}`;
    case "claim.expiring":
      return `${k}: la sesión de ${str((p.owner as Actor | undefined)?.agent)} expira en ${str(p.minutes_left)} min`;
    case "claim.expired":
      return `${k}: la sesión de ${str((p.owner as Actor | undefined)?.agent)} expiró${p.to && p.from !== p.to ? ` → ${str(p.to)}` : ""}`;
    case "claim.stale":
      return `${k}: el worktree de ${str((p.owner as Actor | undefined)?.agent)} ya no está en la Mac (${str(p.worktree_path)})`;
    case "claim.handoff":
      return `${k} pasado por ${by}${p.to ? ` a ${str(p.to)}` : ""}`;
    case "claim.workspace":
      return `${k} workspace actualizado (${by})`;
    case "question.asked":
      return `${k} pregunta a Jorge: ${str(p.question).slice(0, 140)}`;
    case "question.answered":
      return `${k} respondida: ${str(p.answer).slice(0, 140)}`;
    case "gate.challenge.created":
      return `${k} compuerta: código pedido${p.gate ? ` (${str(p.gate)})` : ""}`;
    case "gate.answered":
      return `${k} compuerta respondida en pantalla${p.gate ? ` (${str(p.gate)})` : ""}`;
    case "gate.code.rejected":
      return `${k} código de compuerta rechazado (${str(p.reason)})`;
    case "gate.enrolled":
      return `Compuerta: autenticador ${p.replaced ? "reemplazado" : "enrolado"}`;
    case "approval.requested":
      return `${k} pide aprobación: ${str(p.action)}`;
    case "approval.granted":
      return `${k} aprobación concedida: ${str(p.action)}`;
    case "approval.denied":
      return `${k} aprobación negada: ${str(p.action)}`;
    case "pr.opened":
      return `${prNum(p)} abierto${k ? ` (${k})` : ""}: ${str(p.title)}`;
    case "pr.merged":
      return `${prNum(p)} mezclado en ${str(p.base_branch)}${k ? ` (${k})` : ""}`;
    case "pr.closed":
      return `${prNum(p)} cerrado sin mezclar${k ? ` (${k})` : ""}`;
    case "pr.ci_failed":
      return `${k}: CI en rojo (${str(p.check)})`;
    case "branch.deleted":
      return `rama ${str(p.branch)} borrada`;
    case "release.merged": {
      const from = (p.from ?? {}) as Record<string, unknown>;
      const into = (p.into ?? {}) as Record<string, unknown>;
      const keys = Array.isArray(p.tickets) ? p.tickets.length : 0;
      return `${str(from.branch)} → ${str(into.branch)} fusionado por ${by} (${keys} ${keys === 1 ? "ticket" : "tickets"}, ${str(p.merge_sha).slice(0, 7)})`;
    }
    case "task.no_pr":
      return `${k} cerrado sin PR: ${str(p.reason).slice(0, 140)}`;
    case "release.recorded":
      return `${k ? `${k} ` : ""}desplegado en ${str(p.env)}`;
    case "blocker.parsed":
      return `${k} paso para Jorge: ${str(p.text).slice(0, 140)}`;
    case "blocker.withdrawn":
      return `${k} paso retirado por ${by}: ${str(p.text).slice(0, 140)}`;
    case "result.added":
      return `${k} evidencia ${str(p.kind)}: ${str(p.verdict)} (${by})`;
    case "decision.added":
      return `decisión${k ? ` ${k}` : ""}: ${str(p.text).slice(0, 140)}`;
    case "project.created":
      return `proyecto ${str(p.slug)} creado (${str(p.title)})`;
    default:
      return `${k ? `${k} · ` : ""}${e.type} (${by})`;
  }
}
