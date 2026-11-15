// PLA-I49-4: the one paper in front of the owner (Design doc on PLA-IDEA15, "The paper"). What the row is, its detail,
// the evidence read from Plania now (GET /api/brief/:id/state, the main target's live state), links into Plania before
// GitHub, then "Do it yourself" with its stamps. A confirm action first shows a box that says exactly what happens; an
// answer shows the question's options; Ask for changes takes a line of text; a failure says what failed and that
// nothing changed. Text from the brief renders as plain text only.
import { useState, type CSSProperties, type ReactNode } from "react";
import { BRIEF_LABELS, type DeskAction, type DeskKind } from "@/lib/brief-i18n";
import { type ActionId, type BriefApp, type BriefLanguage, type Item, type ItemState, type Live, type RowAction, safeUrl, slotVar, targetHref } from "@/lib/brief";

export type Pending =
  | { kind: "confirm"; action: ActionId; target: number | null }
  | { kind: "answer"; target: number | null }
  | { kind: "changes"; target: number | null }
  | { kind: "failed"; action: ActionId; target: number | null; error: string; hint: string; input?: Record<string, unknown> }
  | { kind: "wake"; action: ActionId; target: number | null }
  | null;

export const INK: Record<ActionId, "go" | "route" | "wait" | "no" | "stop"> = {
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

export const appStyle = (app: BriefApp | undefined): CSSProperties => ({ ["--app" as string]: slotVar(app?.color ?? "other") });

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

function confirmText(a: ActionId, item: Item, app: BriefApp | undefined, l: Live | null | undefined, language: BriefLanguage): string {
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

export function Stamp({ action, solid, small, quiet, disabled, onClick, children, label }: { action?: ActionId; solid?: boolean; small?: boolean; quiet?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      className={`dk-st dk-${action ? INK[action] : "no"}`}
      data-solid={solid || undefined}
      data-sm={small || undefined}
      data-quiet={quiet || undefined}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      data-stamp={action}
    >
      {children}
    </button>
  );
}

type PaperProps = {
  item: Item;
  app: BriefApp | undefined;
  st: ItemState | undefined;
  language: BriefLanguage;
  readOnly: boolean;
  busy: boolean;
  pending: Pending;
  fresh: boolean;
  deal: boolean;
  onPress: (a: RowAction) => void;
  onRun: (action: ActionId, target: number | null, input?: Record<string, unknown>) => void;
  onCancel: () => void;
  onUndo: (() => void) | null;
};

export function Paper({ item, app, st, language, readOnly, busy, pending, fresh, deal, onPress, onRun, onCancel, onUndo }: PaperProps) {
  const t = BRIEF_LABELS[language];
  const d = t.d;
  const [text, setText] = useState("");
  const l = st?.live ?? null;
  const open = !st || st.state === "open";
  // Wake actions live with the people on the right; the paper's stamps are what the owner does himself.
  const stamps = (st?.actions ?? []).filter((a) => a.id !== "later" && a.id !== "dismiss" && a.level !== "wake");
  const wakeAct = pending?.kind === "wake" ? (st?.actions ?? []).find((a) => a.id === pending.action) : undefined;
  const paused = (l?.kind === "ticket" || l?.kind === "initiative") && l.paused && open;
  const url = safeUrl(item.url);
  const href = targetHref(item.targets?.[0], l);
  const ev = evidence(l, language);
  const done = st && st.state !== "open";
  const stampWord = done ? (st.action ? d.stamps[st.action as DeskAction] : st.state === "dismissed" ? d.stamps.dismiss : st.state === "later" ? d.stamps.later : st.state === "gone" ? "—" : "✓") : null;
  const ink = done ? (st.action ? INK[st.action] : st.state === "dismissed" ? "no" : st.state === "later" ? "wait" : "go") : "go";

  return (
    <article className="dk-paper" style={appStyle(app)} data-deal={deal || undefined} data-paper={item.id} aria-labelledby={`dk-h-${item.id}`}>
      {done && stampWord && (
        <div className={`dk-imprint dk-${ink}`} data-new={fresh || undefined} aria-hidden>
          {stampWord}
          {st.at && <small>{d.handledAt(new Date(st.at).toLocaleTimeString(language === "es" ? "es-MX" : "en-US", { hour: "2-digit", minute: "2-digit" }))}</small>}
        </div>
      )}
      <div className="dk-kick">
        <b className="dk-app">{app?.name ?? item.app}</b> · {kindLabel(item, st, language)}
        {item.status === "blocker" && <> · {t.blocker}</>}
      </div>
      <h2 id={`dk-h-${item.id}`}>{item.title}</h2>
      {item.detail && <p className="dk-det">{item.detail}</p>}
      {ev.length > 0 && (
        <div className="dk-ev" data-brief="evidence">
          {ev.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      )}
      <div className="dk-links">
        {item.ref && <span>{item.ref}</span>}
        {href && <a href={href}>{d.openInPlania}</a>}
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            {d.openOnGithub} ↗
          </a>
        )}
      </div>
      {done && st.line && (
        <p className="dk-note" data-brief="outcome">
          {st.line}
          {onUndo && (
            <>
              {" · "}
              <button type="button" className="underline" onClick={onUndo}>
                {d.undo}
              </button>
            </>
          )}
        </p>
      )}

      {paused && open && !pending && <p className="dk-note" data-brief="waiting-paused">{d.waitingPaused(app?.name ?? item.app)}</p>}
      {pending?.kind === "wake" && (
        <div className="dk-ask dk-route" data-brief="wake">
          <p>
            <b>{d.verbs[pending.action as DeskAction]}</b>: {pending.action === "start_building" && l?.kind === "initiative" && l.next_phase ? d.buildWhat(l.next_phase.keys) : item.title}
          </p>
          {wakeAct?.wake && (
            <div className="dk-cost" data-brief="cost">
              {[
                d.wakeCost(wakeAct.wake.agent ?? d.roles.po, wakeAct.wake.low, wakeAct.wake.high),
                wakeAct.wake.company_paused ? d.waitsCompany : wakeAct.wake.paused ? d.waitsPaused(app?.name ?? item.app) : wakeAct.wake.busy ? d.afterRun(wakeAct.wake.agent ?? "") : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
          {pending.action === "give_to_po" && (
            <label className="grid gap-1 text-sm">
              <span>{d.noteForPo}</span>
              <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
            </label>
          )}
          <div className="dk-r">
            <Stamp action={pending.action} small solid disabled={busy} onClick={() => onRun(pending.action, pending.target, pending.action === "give_to_po" && text.trim() ? { note: text.trim() } : undefined)}>
              {busy ? d.working : `${d.wake} ${wakeAct?.wake?.agent ?? ""}`.trim()}
            </Stamp>
            <Stamp small quiet onClick={onCancel}>
              {d.cancel}
            </Stamp>
          </div>
        </div>
      )}
      {pending?.kind === "failed" && (
        <div className="dk-ask dk-stop" role="alert" data-brief="failed">
          <p>
            <b>
              {d.failed}: {pending.hint || pending.error}
            </b>{" "}
            {d.nothingChanged}
          </p>
          <div className="dk-r">
            <Stamp action="dismiss" small solid onClick={() => onRun(pending.action, pending.target, pending.input)} disabled={busy}>
              {d.tryAgain}
            </Stamp>
            <Stamp small quiet onClick={onCancel}>
              {d.cancel}
            </Stamp>
          </div>
        </div>
      )}
      {pending?.kind === "confirm" && (
        <div className={`dk-ask dk-${INK[pending.action]}`} data-brief="confirm">
          <p>{confirmText(pending.action, item, app, l, language)}</p>
          <div className="dk-r">
            <Stamp action={pending.action} small solid disabled={busy} onClick={() => onRun(pending.action, pending.target)}>
              {busy ? d.working : d.verbs[pending.action as DeskAction]}
            </Stamp>
            <Stamp small quiet onClick={onCancel}>
              {d.cancel}
            </Stamp>
          </div>
        </div>
      )}
      {pending?.kind === "answer" && (
        <div className="dk-ask dk-go" data-brief="answer">
          <p>
            <b>{d.yourAnswer}</b>
          </p>
          {l?.kind === "question" && l.options.length > 0 && (
            <div className="dk-r">
              {l.options.map((o, i) => (
                <Stamp key={o} action="answer" small disabled={busy} onClick={() => onRun("answer", pending.target, { option: i + 1 })}>
                  {o}
                </Stamp>
              ))}
            </div>
          )}
          <label className="grid gap-1 text-sm">
            <span>{d.answerText}</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          </label>
          <div className="dk-r">
            <Stamp action="answer" small solid disabled={busy || !text.trim()} onClick={() => onRun("answer", pending.target, { text: text.trim() })}>
              {d.verbs.answer}
            </Stamp>
            <Stamp small quiet onClick={onCancel}>
              {d.cancel}
            </Stamp>
          </div>
        </div>
      )}
      {pending?.kind === "changes" && (
        <div className="dk-ask dk-wait" data-brief="changes">
          <label className="grid gap-1">
            <span className="text-sm">{d.changesAsk}</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          </label>
          <div className="dk-r">
            <Stamp action="request_changes" small solid disabled={busy || !text.trim()} onClick={() => onRun("request_changes", pending.target, { text: text.trim() })}>
              {d.send}
            </Stamp>
            <Stamp small quiet onClick={onCancel}>
              {d.cancel}
            </Stamp>
          </div>
        </div>
      )}

      {readOnly ? (
        <div className="dk-you">
          <p className="dk-note">{d.readOnly}</p>
        </div>
      ) : (
        open &&
        !pending && (
          <div className="dk-you">
            <div className="dk-kick">{d.you}</div>
            {stamps.length ? (
              <div className="dk-stamps">
                {stamps.map((a, n) => (
                  <Stamp key={`${a.id}-${a.target}`} action={a.id} solid={n === 0} disabled={busy} onClick={() => onPress(a)}>
                    {d.verbs[a.id as DeskAction]}
                  </Stamp>
                ))}
              </div>
            ) : (
              <p className="dk-note">{st ? d.none : d.loading}</p>
            )}
          </div>
        )
      )}
    </article>
  );
}
