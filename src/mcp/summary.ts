import { LEGACY_EVENT_PREFIX } from "../db/legacy-names.js";
import type { Actor } from "../db/schema.js";
import { isOwnerAgent, ownerEs, ownerName } from "../owner.js";
import { defineWords, say } from "../words.js";

// 2.7: one line per event, for assistants that read the cross-project feed and the digest without knowing every
// payload shape. Unknown types fall back to "<key> · <type>".
// PLA-I2-10: in the install's language (src/words.ts). The Spanish output is unchanged.

type Ev = { type: string; task_key: string | null; actor: Actor; payload: Record<string, unknown> };

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const prNum = (p: Record<string, unknown>) => (p.number !== undefined ? `PR #${str(p.number)}` : str(p.url || p.pr) ? `PR ${str(p.url || p.pr)}` : "PR");
const cut = (v: unknown) => str(v).slice(0, 140);
const ownerOf = (p: Record<string, unknown>) => str((p.owner as Actor | undefined)?.agent);
const branchOf = (p: Record<string, unknown>) => (p.workspace as { branch?: string } | undefined)?.branch;
const branchIn = (v: unknown) => str((v as Record<string, unknown> | undefined)?.branch);
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
// PLA-158 (F-17): the merge base and the deploy target under every payload shape that writes them (the GitHub poll
// writes base_branch, the thread action base; a release by branch writes branch, by env env). Empty when none.
const baseOf = (p: Record<string, unknown>) => str(p.base_branch || p.base);
const targetOf = (p: Record<string, unknown>) => str(p.branch || p.env);
const inPart = (word: string, v: string) => (v ? ` ${word} ${v}` : "");

// k: the task key ("" when none). p: the payload (with __type for the fallback). by: who did it.
type Line = (k: string, p: Record<string, unknown>, by: string) => string;
type SummaryWords = {
  // PLA-I2-14: the screen's actor reads as the owner's display name, never the stored "owner".
  owner: () => string;
  old: Line;
  lines: Record<string, Line>;
  fallback: Line;
};

export const SUMMARY = defineWords<SummaryWords>({
  es: {
    owner: () => ownerEs(),
    old: (k) => `${k ? `${k} ` : ""}evento antiguo`,
    lines: {
      "task.created": (k, p, by) => `${k} creado${p.title ? `: ${str(p.title)}` : ""} (${by})`,
      "task.status": (k, p, by) => `${k} → ${str(p.to)}${p.from ? ` (desde ${str(p.from)})` : ""} (${by})`,
      "task.updated": (k, p, by) => `${k} actualizado${Array.isArray(p.fields) ? `: ${(p.fields as unknown[]).map(str).join(", ")}` : ""} (${by})`,
      "task.rekeyed": (k, p) => `${str(p.from) || k} ahora es ${str(p.to) || k}`,
      "task.delegated_move": (k, p, by) => (p.quote ? `${k} movimiento por encargo ${ownerEs("de")}: ${cut(p.quote)}` : `${k} movimiento registrado: ${cut(p.reason)} (${by})`),
      note: (k, p, by) => `${k} nota (${by}): ${cut(p.text ?? p.note)}`,
      "claim.acquired": (k, p, by) => `${k} tomado por ${by}${branchOf(p) ? ` en ${branchOf(p)}` : ""}`,
      "claim.released": (k, _p, by) => `${k} liberado por ${by}`,
      "claim.expiring": (k, p) => `${k}: la sesión de ${ownerOf(p)} expira en ${str(p.minutes_left)} min`,
      "claim.expired": (k, p) => `${k}: la sesión de ${ownerOf(p)} expiró${p.to && p.from !== p.to ? ` → ${str(p.to)}` : ""}`,
      "claim.stale": (k, p) => `${k}: el worktree de ${ownerOf(p)} ya no está en la máquina (${str(p.worktree_path)})`,
      "claim.handoff": (k, p, by) => `${k} pasado por ${by}${p.to ? ` a ${str(p.to)}` : ""}`,
      "claim.workspace": (k, _p, by) => `${k} workspace actualizado (${by})`,
      "question.asked": (k, p) => `${k} pregunta ${ownerEs("a")}: ${cut(p.question)}`,
      "question.answered": (k, p) => `${k} respondida: ${cut(p.answer)}`,
      "pr.opened": (k, p) => `${prNum(p)} abierto${k ? ` (${k})` : ""}: ${str(p.title)}`,
      "pr.merged": (k, p) => `${prNum(p)} mezclado${inPart("en", baseOf(p))}${k ? ` (${k})` : ""}`,
      "pr.status_drift": (k, p) => `${prNum(p)} mezclado pero ${k} sigue en ${str(p.status)}`,
      "pr.closed": (k, p) => `${prNum(p)} cerrado sin mezclar${k ? ` (${k})` : ""}`,
      "pr.ci_failed": (k, p) => `${k}: CI en rojo (${str(p.check)})`,
      "branch.deleted": (_k, p) => `rama ${str(p.branch)} borrada`,
      "release.merged": (_k, p, by) => {
        const n = count(p.tickets);
        return `${branchIn(p.from)} → ${branchIn(p.into)} fusionado por ${by} (${n} ${n === 1 ? "ticket" : "tickets"}, ${str(p.merge_sha).slice(0, 7)})`;
      },
      "task.muestra": (k, p) => {
        const n = count(p.vistas);
        return `${k} entregó su muestra (${n} ${n === 1 ? "vista" : "vistas"})`;
      },
      "task.no_pr": (k, p) => `${k} cerrado sin PR: ${cut(p.reason)}`,
      "release.recorded": (k, p) => `${k ? `${k} ` : ""}desplegado${inPart("en", targetOf(p))}`,
      "blocker.parsed": (k, p) => `${k} paso para ${ownerEs()}: ${cut(p.text)}`,
      "blocker.withdrawn": (k, p, by) => `${k} paso retirado por ${by}: ${cut(p.text)}`,
      "result.added": (k, p, by) => `${k} evidencia ${str(p.kind)}: ${str(p.verdict)} (${by})`,
      "decision.added": (k, p) => `decisión${k ? ` ${k}` : ""}: ${cut(p.text)}`,
      "project.created": (_k, p) => `proyecto ${str(p.slug)} creado (${str(p.title)})`,
    },
    fallback: (k, p, by) => `${k ? `${k} · ` : ""}${str(p.__type)} (${by})`,
  },
  en: {
    owner: () => ownerName("en"),
    old: (k) => `${k ? `${k} ` : ""}old event`,
    lines: {
      "task.created": (k, p, by) => `${k} created${p.title ? `: ${str(p.title)}` : ""} (${by})`,
      "task.status": (k, p, by) => `${k} → ${str(p.to)}${p.from ? ` (from ${str(p.from)})` : ""} (${by})`,
      "task.updated": (k, p, by) => `${k} updated${Array.isArray(p.fields) ? `: ${(p.fields as unknown[]).map(str).join(", ")}` : ""} (${by})`,
      "task.rekeyed": (k, p) => `${str(p.from) || k} is now ${str(p.to) || k}`,
      "task.delegated_move": (k, p, by) => (p.quote ? `${k} moved on behalf of ${ownerName("en")}: ${cut(p.quote)}` : `${k} move recorded: ${cut(p.reason)} (${by})`),
      note: (k, p, by) => `${k} note (${by}): ${cut(p.text ?? p.note)}`,
      "claim.acquired": (k, p, by) => `${k} taken by ${by}${branchOf(p) ? ` on ${branchOf(p)}` : ""}`,
      "claim.released": (k, _p, by) => `${k} released by ${by}`,
      "claim.expiring": (k, p) => `${k}: ${ownerOf(p)}'s session expires in ${str(p.minutes_left)} min`,
      "claim.expired": (k, p) => `${k}: ${ownerOf(p)}'s session expired${p.to && p.from !== p.to ? ` → ${str(p.to)}` : ""}`,
      "claim.stale": (k, p) => `${k}: ${ownerOf(p)}'s worktree is no longer on the machine (${str(p.worktree_path)})`,
      "claim.handoff": (k, p, by) => `${k} handed off by ${by}${p.to ? ` to ${str(p.to)}` : ""}`,
      "claim.workspace": (k, _p, by) => `${k} workspace updated (${by})`,
      "question.asked": (k, p) => `${k} question for ${ownerName("en")}: ${cut(p.question)}`,
      "question.answered": (k, p) => `${k} answered: ${cut(p.answer)}`,
      "pr.opened": (k, p) => `${prNum(p)} opened${k ? ` (${k})` : ""}: ${str(p.title)}`,
      "pr.merged": (k, p) => `${prNum(p)} merged${inPart("into", baseOf(p))}${k ? ` (${k})` : ""}`,
      "pr.status_drift": (k, p) => `${prNum(p)} merged but ${k} is still ${str(p.status)}`,
      "pr.closed": (k, p) => `${prNum(p)} closed without merging${k ? ` (${k})` : ""}`,
      "pr.ci_failed": (k, p) => `${k}: CI failed (${str(p.check)})`,
      "branch.deleted": (_k, p) => `branch ${str(p.branch)} deleted`,
      "release.merged": (_k, p, by) => {
        const n = count(p.tickets);
        return `${branchIn(p.from)} → ${branchIn(p.into)} merged by ${by} (${n} ${n === 1 ? "ticket" : "tickets"}, ${str(p.merge_sha).slice(0, 7)})`;
      },
      "task.muestra": (k, p) => {
        const n = count(p.vistas);
        return `${k} delivered its preview (${n} ${n === 1 ? "view" : "views"})`;
      },
      "task.no_pr": (k, p) => `${k} closed without a PR: ${cut(p.reason)}`,
      "release.recorded": (k, p) => `${k ? `${k} ` : ""}deployed${inPart("to", targetOf(p))}`,
      "blocker.parsed": (k, p) => `${k} step for ${ownerName("en")}: ${cut(p.text)}`,
      "blocker.withdrawn": (k, p, by) => `${k} step withdrawn by ${by}: ${cut(p.text)}`,
      "result.added": (k, p, by) => `${k} evidence ${str(p.kind)}: ${str(p.verdict)} (${by})`,
      "decision.added": (k, p) => `decision${k ? ` ${k}` : ""}: ${cut(p.text)}`,
      "project.created": (_k, p) => `project ${str(p.slug)} created (${str(p.title)})`,
    },
    fallback: (k, p, by) => `${k ? `${k} · ` : ""}${str(p.__type)} (${by})`,
  },
});

// Old event types: one neutral line, whatever the payload was.
const OLD_TYPES = new Set(["task.approved_move", "approval.requested", "approval.granted", "approval.denied", "approval.used", "approval.archived", "question.archived"]);

export function summarize(e: Ev): string {
  const w = say(SUMMARY);
  const k = e.task_key ?? "";
  const by = isOwnerAgent(e.actor.agent) ? w.owner() : e.actor.agent;
  if (e.type.startsWith(LEGACY_EVENT_PREFIX) || OLD_TYPES.has(e.type)) return w.old(k, e.payload, by);
  const line = w.lines[e.type];
  return line ? line(k, e.payload, by) : w.fallback(k, { ...e.payload, __type: e.type }, by);
}
