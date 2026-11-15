// PLA-I51: what a brief row is and how its actions are pressed, shared by the ficha (city.tsx). Moved from V2's
// desk-paper.tsx (PLA-I49-4) unchanged: the evidence rows for the object as it is now, the ink of each action, how
// an action is pressed (at once, with a confirm box, with options, or with a line of text) and the confirm texts.
import { BRIEF_LABELS, type DeskAction, type DeskKind } from "@/lib/brief-i18n";
import type { ActionId, BriefApp, BriefLanguage, Item, ItemState, Live, RowAction } from "@/lib/brief";

export type Ink = "go" | "route" | "wait" | "no" | "stop";

export const INK: Record<ActionId, Ink> = {
  answer: "go",
  step_done: "go",
  add_to_pr: "go",
  publish: "go",
  accept_pr: "go",
  request_changes: "wait",
  resume_runs: "go",
  postpone: "wait",
  put_first: "route",
  hold: "wait",
  fix_finding: "go",
  close_idea: "stop",
  later: "wait",
  dismiss: "no",
  give_to_po: "route",
  start_now: "route",
  start_building: "route",
};

/** How a stamp is pressed: at once, with a box first (confirm), with the options, or with a line of text. */
export function pressOf(a: RowAction): "instant" | "confirm" | "answer" | "changes" {
  if (a.id === "answer") return "answer";
  if (a.id === "request_changes") return "changes";
  return a.level === "instant" ? "instant" : "confirm";
}


export function kindOf(item: Item, st: ItemState | undefined): DeskKind {
  return (st?.live && st.live.kind !== "gone" ? st.live.kind : item.targets?.[0]?.kind) ?? "none";
}

export function kindLabel(item: Item, st: ItemState | undefined, language: BriefLanguage): string {
  const d = BRIEF_LABELS[language].d;
  const l = st?.live;
  if (l?.kind === "release") {
    const why = l.reason ?? (l.unknown ? "no_github_data" : null);
    return l.ready && l.pending ? d.releaseReady : d.releaseNotReady(why ? (d.reasons[why] ?? why) : "—");
  }
  return d.kinds[kindOf(item, st)];
}

/** The evidence rows for the object as it is now. */
export function evidence(l: Live | null | undefined, language: BriefLanguage): [string, string][] {
  const d = BRIEF_LABELS[language].d;
  const e = d.ev;
  if (!l) return [];
  switch (l.kind) {
    case "question":
      return [[e.asked, l.question], ...(l.options.length ? ([[e.options, l.options.join(" · ")]] as [string, string][]) : [])];
    case "step":
      return [[e.step, l.text], [e.ticket, l.key], ...(l.file ? ([["File", l.file.path]] as [string, string][]) : [])];
    case "release":
      return [
        [e.state, `${l.from} → ${l.into} · ${l.env}${l.ahead !== null ? ` · ${l.ahead} ${e.ahead.toLowerCase()}` : ""}`],
        [e.tickets, l.tickets.length ? l.tickets.join(" · ") : d.none_],
        [e.migrations, l.migrations.length ? l.migrations.join(" · ") : d.none_],
        ...(l.before ? ([[e.before, String(l.before)]] as [string, string][]) : []),
        ...(l.open_checks ? ([[e.checks, String(l.open_checks)]] as [string, string][]) : []),
      ];
    case "pr":
      return [[e.pr, `#${l.number} · ${l.state}${l.base ? ` → ${l.base}` : ""}`], ...(l.ticket ? ([[e.ticket, `${l.ticket.key} · ${l.ticket.status}`]] as [string, string][]) : [])];
    case "ticket":
    case "initiative":
      return [[e.status, `${l.key} · ${l.status}`]];
    case "idea":
      return [[e.status, `${l.key} · ${l.status}${l.stage ? ` · ${l.stage}` : ""}`]];
    case "runs":
      return [[e.runs, l.paused ? d.paused : d.on]];
    case "env":
      return [[e.record, `${l.env} · ${l.commit ?? "?"} · ${l.updated_at.slice(0, 10)}`]];
    case "finding":
      return l.detail ? [[e.finding, `${l.code}${l.key ? ` · ${l.key}` : ""}: ${l.detail}`]] : [[e.finding, l.code]];
    case "gone":
      return [];
  }
}

export function confirmText(a: ActionId, item: Item, app: BriefApp | undefined, l: Live | null | undefined, language: BriefLanguage): string {
  const c = BRIEF_LABELS[language].d.confirm;
  const project = app?.name ?? item.app;
  const t = item.targets?.[0];
  if (a === "publish" && l?.kind === "release") return c.publish({ project, from: l.from, into: l.into, tickets: l.tickets.length, migrations: l.migrations });
  if (a === "accept_pr") return c.accept_pr({ project, pr: l?.kind === "pr" ? l.number : (t?.pr ?? null), key: l?.kind === "pr" ? (l.ticket?.key ?? null) : (t?.key ?? null) });
  if (a === "add_to_pr") return c.add_to_pr({ project, path: l?.kind === "step" ? (l.file?.path ?? null) : null, key: l?.kind === "step" ? l.key : null });
  if (a === "resume_runs") return c.resume_runs({ project });
  if (a === "fix_finding") return c.fix_finding({ project, code: l?.kind === "finding" ? l.code : t?.code, key: l?.kind === "finding" ? l.key : t?.key });
  return BRIEF_LABELS[language].d.verbs[a as DeskAction];
}

