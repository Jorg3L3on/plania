// PLA-I63-3: the card in hand, at the right of the delta (PLA-IDEA26, sketch 2). It carries what the city's ficha
// carried (city.tsx, PLA-I51, retired in I63-5), in La corriente's look and words: the evidence for what the row is
// about now (Live), every action the row's state offers (RowAction, by its level instant / confirm / wake), the
// confirm inside the card, the cost line before waking someone, an answer by option or text, a note for Pedir ajuste,
// an idea's five fates and the reasons to discard, Send to Plania's progress, the stamp with its time and Deshacer.
// One white button (the first action, Enter); Después (L) and No aplica (X) are quiet. Every action goes through
// POST /api/brief/act and its undo, unchanged.
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CrossMark } from "@/components/plania-mark";
import { corLabels, type BriefLabels, type DeskAction } from "@/lib/brief-i18n";
import { INK, confirmText, evidence, kindOf, pressOf, type Ink } from "@/lib/brief-row";
import {
  CROSS,
  DISCARD_REASONS,
  parseFlag,
  planLine,
  requestId,
  safeUrl,
  type ActionId,
  type ActReply,
  type BriefData,
  type BriefLanguage,
  type BriefStateReply,
  type IdeaAction,
  type IdeaFate,
  type Item,
  type ItemState,
  type PlanIdeaProgress,
  type RowAction,
} from "@/lib/brief";
import type { CityCard, KeyCommand, Station } from "@/lib/brief-city";
import { hhmm, type Light, type Local } from "@/lib/brief-delta";
import { getLanguage, words, type Language } from "@/lib/i18n";
import { BRIEF_CARD_WORDS } from "@/lib/brief-card-words";
import { Btn, Logo } from "./parts";

/** The card's place when nothing is in hand: loading, no brief yet, off, could not read. */
export function EmptyHand({ state, onRetry, line, language }: { state: "loading" | "empty" | "off" | "failed" | "brief"; onRetry?: () => void; line?: string; language?: Language }) {
  const w = words(BRIEF_CARD_WORDS, language);
  if (state === "loading") return <div className="cor-bf-hand cor-skel" role="status" aria-label={w.reading} data-brief="loading" />;
  const text =
    line ??
    (state === "empty"
      ? w.empty
      : state === "off"
        ? w.off
        : state === "failed"
          ? w.failed
          : "");
  return (
    <section className="cor-bf-hand" aria-label={w.inHand} data-brief="empty-hand">
      <h2 className="cor-h3">{w.nothingInHand}</h2>
      {text && <p className="cor-text">{text}</p>}
      {state === "failed" && onRetry && (
        <Btn kind="secondary" onClick={onRetry} data-brief="retry">
          {w.retry}
        </Btn>
      )}
    </section>
  );
}

/** The card's head: «En la mano · i de n» and the two steps (K, J). */
export function HandHead({ position, onStep, language }: { position: [number, number] | null; onStep: (d: 1 | -1) => void; language?: Language }) {
  const w = words(BRIEF_CARD_WORDS, language);
  return (
    <div className="cor-bf-fh">
      <span className="cor-label">{`${w.inHand}${position ? w.position(position[0], position[1]) : ""}`}</span>
      <span className="cor-bf-step">
        <button type="button" aria-label={w.prev} onClick={() => onStep(-1)} data-step="-1">
          ↑
        </button>
        <button type="button" aria-label={w.next} onClick={() => onStep(1)} data-step="1">
          ↓
        </button>
      </span>
    </div>
  );
}

export type ActBody = { item_id: string; action: ActionId | IdeaAction; target?: number; input?: Record<string, unknown>; request_id: string };
type Pending =
  | { kind: "confirm"; action: ActionId; target: number | null }
  | { kind: "answer"; target: number | null }
  | { kind: "changes"; target: number | null }
  | { kind: "wake"; action: ActionId; target: number | null }
  | { kind: "idea-wake"; action: "plan" | "sketch" | "research" }
  | { kind: "discard" }
  | { kind: "failed"; action: ActionId | IdeaAction; target: number | null; error: string; hint: string; input?: Record<string, unknown> }
  | null;

/** What the card's keys do, registered by the card for the page's key handler. true = handled. */
export type CardKeys = (cmd: KeyCommand) => boolean;

export type CardProps = {
  light: Light | null;
  station: Station | undefined;
  data: BriefData;
  /** The rows' state with what was settled in this visit laid over it. */
  state: BriefStateReply | undefined;
  local: Record<string, Local>;
  language: BriefLanguage;
  readOnly: boolean;
  acting: boolean;
  position: [number, number] | null;
  onStep: (d: 1 | -1) => void;
  onAct: (body: ActBody) => Promise<ActReply>;
  onHandled: (cd: CityCard, l: Local) => void;
  onUndo: (actionId: string, itemId: string) => Promise<void>;
  ideaCost: (ids: ReadonlySet<string>) => { bots: number; low: number; high: number } | null;
  plans: Map<string, PlanIdeaProgress>;
  links: { paso: (slug: string, key: string) => string; idea: (slug: string, key: string) => string };
  keys?: { current: CardKeys | null };
  runAt?: string;
  /** For tests and the browser pass: a pending state from the start. */
  initialPending?: Pending;
};

const FATE: Record<IdeaAction, IdeaFate> = { keep: "kept", discard: "discarded", research: "research", sketch: "sketch", plan: "planned" };
const FATE_INK: Record<IdeaAction, Ink> = { keep: "go", discard: "stop", research: "route", sketch: "route", plan: "route" };
const WAKES: ActionId[] = ["give_to_po", "start_now", "start_building"];
const isWake = (a: RowAction) => a.level === "wake" || WAKES.includes(a.id);

export const appLabel = (st: Station | undefined, t: BriefLabels) => (!st ? "" : st.slug === CROSS ? t.c.cross : st.app.name || st.slug);

/** The stamp of a settled card: its word, when, the result line and whether Deshacer can bring it back. */
export function stampOf(cd: CityCard, state: BriefStateReply | undefined, local: Local | undefined, t: BriefLabels, language: Language = getLanguage()) {
  const d = t.d;
  const w = words(BRIEF_CARD_WORDS, language);
  if (cd.kind === "item") {
    const s = state?.items[cd.id];
    if (s && s.state !== "open") {
      const word = s.action ? d.stamps[s.action as DeskAction] : s.state === "dismissed" ? d.stamps.dismiss : s.state === "later" ? d.stamps.later : s.state === "gone" ? w.gone : w.settled;
      return { word: local?.word ?? word, at: s.at ?? local?.at ?? null, line: s.line ?? local?.line ?? null, actionId: s.action_id ?? local?.actionId ?? null, undo: s.undo || !!local?.undo };
    }
    return local ? { word: local.word, at: local.at, line: local.line ?? null, actionId: local.actionId, undo: local.undo } : null;
  }
  if (cd.open) return null;
  const s = state?.ideas?.[cd.id];
  const fate = s?.state && s.state !== "open" ? s.state : "planned";
  return { word: local?.word ?? d.idea.fate[fate] ?? fate, at: s?.at ?? local?.at ?? null, line: s?.line ?? local?.line ?? null, actionId: s?.action_id ?? local?.actionId ?? null, undo: !!(s?.undo || local?.undo) };
}

export function BriefCard(p: CardProps) {
  // A fresh card (pending, text, notice) for each light in hand.
  if (!p.light || !p.station) return <EmptyHand state="brief" language={p.language} line={words(BRIEF_CARD_WORDS, p.language).nothingToday(p.runAt ?? "07:00")} />;
  return <Card key={p.light.id} {...p} light={p.light} station={p.station} />;
}

function Card(p: CardProps & { light: Light; station: Station }) {
  const { light, station, language } = p;
  const t = corLabels(language);
  const d = t.d;
  const c = t.c;
  const w = words(BRIEF_CARD_WORDS, language);
  const cd = light.card;
  const name = appLabel(station, t);
  const [pending, setPending] = useState<Pending>(p.initialPending ?? null);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // The action on its way (en curso): its buttons wait and the card says so.
  const [busy, setBusy] = useState<string | null>(null);
  const reset = () => {
    setPending(null);
    setText("");
  };
  const s = stampOf(cd, p.state, p.local[cd.id], t, language);
  const item: Item | null = cd.kind === "item" ? cd.item : null;
  const ist: ItemState | undefined = item ? p.state?.items[cd.id] : undefined;
  const actions = ist?.actions ?? [];
  const own = actions.filter((a) => a.id !== "later" && a.id !== "dismiss" && !isWake(a));
  const wakes = actions.filter(isWake);
  const later = actions.find((a) => a.id === "later");
  const dismiss = actions.find((a) => a.id === "dismiss");
  const acting = p.acting || !!busy;
  const canAct = !p.readOnly && !acting && cd.open && !s;
  const app = p.data.apps.find((a) => a.id === station.slug);
  const l = ist?.live ?? null;

  const fail = (e: unknown, action: ActionId | IdeaAction, target: number | null, input?: Record<string, unknown>) => {
    const err = e as { code?: string; message?: string; detail?: { hint?: string } };
    const offline = e instanceof TypeError;
    setPending({ kind: "failed", action, target, error: offline ? "OFFLINE" : (err.code ?? "ERROR"), hint: offline ? d.offline : (err.detail?.hint ?? err.message ?? ""), input });
  };
  const runItem = async (action: ActionId, target: number | null, input?: Record<string, unknown>) => {
    if (!item) return;
    setNotice(null);
    setBusy(action);
    try {
      const reply = await p.onAct({ item_id: cd.id, action, ...(target !== null ? { target } : {}), ...(input ? { input } : {}), request_id: requestId() });
      if (reply.status === "done") {
        reset();
        p.onHandled(cd, { word: d.stamps[action as DeskAction], ink: INK[action], at: new Date().toISOString(), actionId: reply.action_id, undo: reply.undo, line: reply.line, action });
      } else if (reply.status === "stale") {
        reset();
        setNotice(reply.line ?? d.stale);
      } else if (reply.status === "running") setNotice(w.running);
      else setPending({ kind: "failed", action, target, error: reply.error, hint: reply.hint, input });
    } catch (e) {
      fail(e, action, target, input);
    } finally {
      setBusy(null);
    }
  };
  const runIdea = async (action: IdeaAction, input?: Record<string, unknown>) => {
    setNotice(null);
    setBusy(action);
    try {
      const reply = await p.onAct({ item_id: cd.id, action, ...(input ? { input } : {}), request_id: requestId() });
      if (reply.status === "done") {
        reset();
        const fate = FATE[action];
        p.onHandled(cd, { word: d.idea.fate[fate]!, ink: FATE_INK[action], at: new Date().toISOString(), actionId: reply.action_id, undo: reply.undo, fate, line: reply.line });
      } else if (reply.status === "stale") {
        reset();
        setNotice(reply.line ?? d.stale);
      } else if (reply.status === "running") setNotice(w.running);
      else setPending({ kind: "failed", action, target: null, error: reply.error, hint: reply.hint, input });
    } catch (e) {
      fail(e, action, null, input);
    } finally {
      setBusy(null);
    }
  };
  const press = (a: RowAction) => {
    if (isWake(a)) return (setText(""), setPending({ kind: "wake", action: a.id, target: a.target }));
    const how = pressOf(a);
    if (how === "instant") return void runItem(a.id, a.target);
    setText("");
    setPending(how === "confirm" ? { kind: "confirm", action: a.id, target: a.target } : how === "answer" ? { kind: "answer", target: a.target } : { kind: "changes", target: a.target });
  };
  const first = own[0] ?? wakes[0];

  // What Enter does in this state (the white button's action), for the key and the ↵ hint.
  const enter = (): (() => void) | null => {
    if (!canAct && pending?.kind !== "failed") return null;
    if (pending?.kind === "confirm") return () => void runItem(pending.action, pending.target);
    if (pending?.kind === "wake") return () => void runItem(pending.action, pending.target, pending.action === "give_to_po" && text.trim() ? { note: text.trim() } : undefined);
    if (pending?.kind === "idea-wake") return () => void runIdea(pending.action);
    if (pending?.kind === "answer") return text.trim() ? () => void runItem("answer", pending.target, { text: text.trim() }) : null;
    if (pending?.kind === "changes") return text.trim() ? () => void runItem("request_changes", pending.target, { text: text.trim() }) : null;
    if (pending?.kind === "failed") return retry;
    if (pending) return null;
    if (cd.kind === "idea") return () => setPending({ kind: "idea-wake", action: "plan" });
    return first ? () => press(first) : null;
  };
  const retry = () => {
    if (pending?.kind !== "failed") return;
    if (cd.kind === "idea") return void runIdea(pending.action as IdeaAction, pending.input);
    return void runItem(pending.action as ActionId, pending.target, pending.input);
  };
  if (p.keys)
    p.keys.current = (cmd) => {
      if (cmd === "escape") {
        if (!pending) return false;
        reset();
        return true;
      }
      if (cmd === "primary") {
        const f = enter();
        if (f) f();
        return !!f;
      }
      if (!canAct || pending) return false;
      if (cmd === "later" && later) return (void runItem("later", null), true);
      if (cmd === "dismiss") {
        if (cd.kind === "idea") return (setPending({ kind: "discard" }), true);
        if (dismiss) return (void runItem("dismiss", null), true);
      }
      return false;
    };

  // ---- the head of the card
  const kd = !cd.open || s ? "g" : light.kind === "block" ? "r" : light.kind === "toca" ? "a" : "v";
  const kindWord =
    cd.kind === "idea"
      ? `${c.newIdea}${cd.idea.code ? ` · ${cd.idea.code}` : ""}`
      : `${!cd.open || s ? w.settled : light.kind === "block" ? w.kind.block : light.kind === "toca" ? w.kind.toca : w.kind.next} · ${releaseOr(item!, ist, t, language)}`;
  const tone = !cd.open || s ? "done" : light.kind === "block" || light.kind === "toca" ? "you" : "live";

  const stampLine = s && (
    <div className="cor-bf-stamp" data-brief="stamp">
      <i aria-hidden />
      {s.word}
      {s.at ? ` · ${hhmm(s.at)}` : ""}
    </div>
  );

  const link = (() => {
    if (cd.kind === "idea") return null;
    const key = item!.targets?.[0]?.key ?? (l && "key" in l && typeof l.key === "string" ? l.key : l?.kind === "pr" ? l.ticket?.key : undefined);
    const project = item!.targets?.[0]?.project ?? station.slug;
    if (!key || project === CROSS) return null;
    return { key, to: key.includes("IDEA") ? p.links.idea(project, key) : p.links.paso(project, key) };
  })();
  const gh = item ? safeUrl(item.url) : null;

  return (
    <>
      <HandHead position={p.position} onStep={p.onStep} language={language} />
      <section className={`cor-bf-card ${tone}`} aria-label={w.cardLabel(light.title)} data-brief="card" data-card={cd.id}>
        <div className="cor-bf-ck">
          {station.slug === CROSS ? <CrossMark className="cor-logo" /> : <Logo slug={station.slug} title={name} />}
          <span className="pn">{name}</span>
          <span className={`cor-bf-kd ${kd}`}>{kindWord}</span>
        </div>
        <h2>{light.title}</h2>
        {cd.kind === "item" ? item!.detail && !(l?.kind === "question" && l.question.trim() === item!.detail.trim()) && <p className="cor-text cor-bf-tx">{item!.detail}</p> : <p className="cor-text cor-bf-tx">{cd.idea.why}</p>}
        {cd.kind === "item" ? <Evidence rows={evidence(l, language).map(([k, v]) => [k === BRIEF_TICKET[language] ? d.ev.ticket : k, v])} /> : <IdeaFacts cd={cd} t={t} language={language} />}
        {(link || gh) && (
          <div className="cor-bf-links">
            {link && (
              <Link className="cor-btn link" to={link.to} data-see={link.key}>
                {w.see(link.key)}
              </Link>
            )}
            {gh && (
              <a className="cor-btn link" href={gh} target="_blank" rel="noopener noreferrer">
                GitHub ↗
              </a>
            )}
          </div>
        )}
        {notice && (
          <p className="cor-bf-note amber" role="status" data-brief="stale">
            {notice}
          </p>
        )}
        {stampLine}
        {busy && !s && (
          <p className="cor-bf-note" role="status" data-brief="running">
            <span className="cor-live" aria-hidden /> {w.underWay} {busy in d.verbs ? d.verbs[busy as DeskAction] : busy in d.idea ? (d.idea as unknown as Record<string, string>)[busy] : busy}…
          </p>
        )}
        <div className="cor-bf-you">{body()}</div>
      </section>
    </>
  );

  function body(): ReactNode {
    if (s) return done(s);
    if (p.readOnly) return <p className="cor-bf-note" data-brief="read-only">{d.readOnly}</p>;
    if (pending?.kind === "failed")
      return (
        <div className="cor-bf-ask bad" role="alert" data-brief="failed">
          <p>
            <b>
              {d.failed}: {pending.hint || pending.error}
            </b>{" "}
            {d.nothingChanged}
          </p>
          <div className="cor-bf-row">
            <Btn kind="primary" disabled={acting} onClick={retry} data-act="try-again">
              {d.tryAgain} <kbd>↵</kbd>
            </Btn>
            <Btn kind="quiet" onClick={reset} data-act="cancel">
              {d.cancel}
            </Btn>
          </div>
        </div>
      );
    return cd.kind === "idea" ? ideaBody(cd) : itemBody();
  }

  function done(st: NonNullable<ReturnType<typeof stampOf>>) {
    const plan = cd.kind === "idea" ? p.plans.get(cd.idea.code) : undefined;
    return (
      <>
        {(st.line || plan) && (
          <p className="cor-text" data-brief="outcome">
            {plan ? t.planLine(planLine(plan)) : st.line}
          </p>
        )}
        {!p.readOnly && st.undo && st.actionId && (
          <div className="cor-bf-row">
            <Btn kind="secondary" disabled={acting} onClick={() => void p.onUndo(st.actionId!, cd.id)} data-undo={cd.id}>
              {d.undo} <kbd>Z</kbd>
            </Btn>
          </div>
        )}
        {p.readOnly && <p className="cor-bf-note">{d.readOnly}</p>}
      </>
    );
  }

  function itemBody(): ReactNode {
    const paused = (l?.kind === "ticket" || l?.kind === "initiative") && l.paused;
    const runsWhy = l?.kind !== "runs" && own.some((a) => a.id === "resume_runs");
    if (pending?.kind === "confirm")
      return (
        <div className="cor-bf-ask" data-brief="confirm">
          <p className="cor-text">{confirmText(pending.action, item!, app, l, language).replace(/Aprobar y pasar a prueba|Publicar a main|Pedir cambios/g, (m) => (m === "Publicar a main" ? d.verbs.publish : m === "Pedir cambios" ? d.verbs.request_changes : d.verbs.accept_pr))}</p>
          <div className="cor-bf-row">
            <Btn kind="primary" disabled={acting} onClick={() => void runItem(pending.action, pending.target)} data-act={`confirm-${pending.action}`}>
              {acting ? d.working : d.verbs[pending.action as DeskAction]} <kbd>↵</kbd>
            </Btn>
            <Btn kind="quiet" onClick={reset} data-act="cancel">
              {d.cancel}
            </Btn>
          </div>
        </div>
      );
    if (pending?.kind === "answer")
      return (
        <div className="cor-bf-ask" data-brief="answer">
          <p className="cor-label">{d.yourAnswer}</p>
          {l?.kind === "question" && l.options.length > 0 && (
            <div className="cor-bf-row">
              {l.options.map((o, i) => (
                <button key={o} type="button" className="cor-opt" disabled={acting} onClick={() => void runItem("answer", pending.target, { option: i + 1 })} data-act={`option-${i + 1}`}>
                  {o}
                </button>
              ))}
            </div>
          )}
          <label className="cor-bf-field">
            <span className="cor-cap">{d.answerText}</span>
            <textarea className="cor-textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={2} data-brief="answer-text" />
          </label>
          <div className="cor-bf-row">
            <Btn kind="primary" disabled={acting || !text.trim()} onClick={() => void runItem("answer", pending.target, { text: text.trim() })} data-act="answer-text">
              {d.verbs.answer}
            </Btn>
            <Btn kind="quiet" onClick={reset} data-act="cancel">
              {d.cancel}
            </Btn>
          </div>
        </div>
      );
    if (pending?.kind === "changes")
      return (
        <div className="cor-bf-ask" data-brief="changes">
          <label className="cor-bf-field">
            <span className="cor-text">{d.changesAsk}</span>
            <textarea className="cor-textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={2} placeholder={w.changesPlaceholder} data-brief="changes-text" />
          </label>
          <div className="cor-bf-row">
            <Btn kind="primary" disabled={acting || !text.trim()} onClick={() => void runItem("request_changes", pending.target, { text: text.trim() })} data-act="changes-send">
              {d.send}
            </Btn>
            <Btn kind="quiet" onClick={reset} data-act="cancel">
              {d.cancel}
            </Btn>
          </div>
        </div>
      );
    if (pending?.kind === "wake") {
      const w = actions.find((a) => a.id === pending.action)?.wake;
      return (
        <div className="cor-bf-ask" data-brief="wake">
          <p className="cor-text">
            <b>{d.verbs[pending.action as DeskAction]}</b>: {pending.action === "start_building" && l?.kind === "initiative" && l.next_phase ? d.buildWhat(l.next_phase.keys) : item!.title}
          </p>
          {w && (
            <p className="cor-bf-cost" data-brief="cost">
              {[d.wakeCost(w.agent ?? d.roles.po, w.low, w.high), w.company_paused ? d.waitsCompany : w.paused ? d.waitsPaused(name) : w.busy ? d.afterRun(w.agent ?? "") : null].filter(Boolean).join(" · ")}
            </p>
          )}
          {pending.action === "give_to_po" && (
            <label className="cor-bf-field">
              <span className="cor-cap">{d.noteForPo}</span>
              <textarea className="cor-textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={2} data-brief="po-note" />
            </label>
          )}
          <div className="cor-bf-row">
            <Btn kind="primary" disabled={acting} onClick={() => void runItem(pending.action, pending.target, pending.action === "give_to_po" && text.trim() ? { note: text.trim() } : undefined)} data-act={`wake-${pending.action}`}>
              {acting ? d.working : `${d.wake} ${w?.agent ?? (pending.action === "give_to_po" ? d.roles.po : d.roles.taller)}`} <kbd>↵</kbd>
            </Btn>
            <Btn kind="quiet" onClick={reset} data-act="cancel">
              {d.cancel}
            </Btn>
          </div>
        </div>
      );
    }
    if (!ist) return <p className="cor-bf-note">{d.loading}</p>;
    const buttons = [...own, ...wakes];
    return (
      <>
        {paused && !runsWhy && (
          <p className="cor-bf-note" data-brief="waiting-paused">
            {d.waitingPaused(name)}
          </p>
        )}
        {buttons.length > 0 && (
          <div className="cor-bf-row" data-brief="actions">
            {buttons.map((a, n) => {
              const w = isWake(a) ? a.wake : null;
              const sub = w ? (w.company_paused || w.paused ? d.paused : w.busy ? d.working : `${w.low}–${w.high} min`) : null;
              return (
                <Btn key={`${a.id}-${a.target}`} kind={n === 0 ? "primary" : "secondary"} disabled={!canAct} onClick={() => press(a)} data-act={a.id} title={sub ? `${w?.agent ?? ""} · ${sub}`.replace(/^ · /, "") : undefined}>
                  {d.verbs[a.id as DeskAction]}
                  {n === 0 && <kbd>↵</kbd>}
                </Btn>
              );
            })}
          </div>
        )}
        {runsWhy && (
          <p className="cor-bf-note" data-brief="runs-why">
            {c.runsWhy(name)}
          </p>
        )}
        {(later || dismiss) && (
          <div className="cor-bf-away">
            {later && (
              <Btn kind="quiet" small disabled={!canAct} onClick={() => void runItem("later", null)} data-act="later">
                {d.later} <kbd>L</kbd>
              </Btn>
            )}
            {dismiss && (
              <Btn kind="quiet" small disabled={!canAct} onClick={() => void runItem("dismiss", null)} data-act="dismiss">
                {d.notRelevant} <kbd>X</kbd>
              </Btn>
            )}
          </div>
        )}
        {!buttons.length && !later && !dismiss && <p className="cor-bf-note">{d.none}</p>}
      </>
    );
  }

  function ideaBody(ic: Extract<CityCard, { kind: "idea" }>): ReactNode {
    const ideaState = p.state?.ideas?.[ic.id];
    const paused = !!ideaState?.paused;
    const po = station.slug !== CROSS ? w.poOf(d.roles.po, name) : d.roles.po;
    if (pending?.kind === "discard")
      return (
        <div className="cor-bf-ask" data-brief="discard">
          <p className="cor-text">
            <b>{d.idea.why}</b> {d.idea.discardHint}.
          </p>
          <div className="cor-bf-row">
            {DISCARD_REASONS.map((r) => (
              <button key={r} type="button" className="cor-opt" disabled={acting} onClick={() => void runIdea("discard", { reason: r })} data-act={`reason-${r}`}>
                {d.idea.reasons[r]}
              </button>
            ))}
          </div>
          <div className="cor-bf-row">
            <Btn kind="quiet" onClick={reset} data-act="cancel">
              {d.cancel}
            </Btn>
          </div>
        </div>
      );
    if (pending?.kind === "idea-wake") {
      const action = pending.action;
      const plan = action === "plan" ? p.ideaCost(new Set([ic.id])) : null;
      const role = action === "plan" ? po : action === "sketch" ? d.roles.artist : d.roles.research;
      const cost = plan ? d.ideaCost(plan.bots, plan.low, plan.high) : d.wakeCost(role, 10, 20);
      return (
        <div className="cor-bf-ask" data-brief="wake">
          <p className="cor-text">
            <b>{d.idea[action]}</b>: {ic.idea.title}
          </p>
          <p className="cor-bf-cost" data-brief="cost">
            {[cost, paused ? d.waitsPaused(name) : null].filter(Boolean).join(" · ")}
          </p>
          <div className="cor-bf-row">
            <Btn kind="primary" disabled={acting} onClick={() => void runIdea(action)} data-act={`wake-${action}`}>
              {acting ? d.working : `${d.wake} ${role}`} <kbd>↵</kbd>
            </Btn>
            <Btn kind="quiet" onClick={reset} data-act="cancel">
              {d.cancel}
            </Btn>
          </div>
        </div>
      );
    }
    return (
      <>
        <div className="cor-bf-row" data-brief="actions">
          <Btn kind="primary" disabled={!canAct} onClick={() => setPending({ kind: "idea-wake", action: "plan" })} data-act="plan">
            {d.idea.plan} <kbd>↵</kbd>
          </Btn>
          <Btn kind="secondary" disabled={!canAct} onClick={() => setPending({ kind: "idea-wake", action: "sketch" })} data-act="sketch">
            {d.idea.sketch}
          </Btn>
          <Btn kind="secondary" disabled={!canAct} onClick={() => setPending({ kind: "idea-wake", action: "research" })} data-act="research">
            {d.idea.research}
          </Btn>
          <Btn kind="secondary" disabled={!canAct} onClick={() => void runIdea("keep")} data-act="keep">
            {d.idea.keep}
          </Btn>
        </div>
        {paused && <p className="cor-bf-note">{d.waitsPaused(name)}</p>}
        <div className="cor-bf-away">
          <Btn kind="quiet" small disabled={!canAct} onClick={() => setPending({ kind: "discard" })} data-act="discard">
            {d.idea.discard} <kbd>X</kbd>
          </Btn>
        </div>
      </>
    );
  }
}

const BRIEF_TICKET: Record<BriefLanguage, string> = { es: "Ticket", en: "Ticket" };

/** The kind of row, as the card's head says it (a release says whether it is ready). */
function releaseOr(item: Item, st: ItemState | undefined, t: BriefLabels, language: Language): string {
  const w = words(BRIEF_CARD_WORDS, language);
  const l = st?.live;
  if (l?.kind === "release") {
    const why = l.reason ?? (l.unknown ? "no_github_data" : null);
    return l.ready && l.pending ? w.ready : w.notReady(why ? (t.d.reasons[why] ?? why) : "—");
  }
  return t.d.kinds[kindOf(item, st)];
}

function Evidence({ rows }: { rows: [string, string][] }) {
  if (!rows.length) return null;
  return (
    <dl className="cor-bf-ev" data-brief="evidence">
      {rows.map(([k, v], i) => (
        <div key={`${k}-${i}`}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function IdeaFacts({ cd, t, language }: { cd: Extract<CityCard, { kind: "idea" }>; t: BriefLabels; language: Language }) {
  const w = words(BRIEF_CARD_WORDS, language);
  const flags = (cd.idea.flags ?? []).map((f) => parseFlag(f)).filter((f): f is NonNullable<ReturnType<typeof parseFlag>> => !!f);
  const rows: [string, string][] = [[w.from, cd.idea.source || "—"]];
  if (flags.length) rows.push([w.watch, flags.map((f) => (f.key === "overlap" ? t.flags.overlap(f.ref ?? "") : t.flags[f.key])).join(" · ")]);
  if (cd.idea.seen) rows.push([w.seen, t.d.idea.seen(cd.idea.seen)]);
  return <Evidence rows={rows} />;
}
