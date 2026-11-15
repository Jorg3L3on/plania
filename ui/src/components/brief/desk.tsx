// PLA-I49-4: the Morning brief as a desk (Design doc v3 on PLA-IDEA15, "your desk at sunrise"). The sky says how much
// is left and how much was handled today; the sun climbs as the desk clears. Left: three piles (Needs you, Up next,
// Ideas) and the index tabs of the pile in hand. Middle: the one paper in front of the owner (desk-paper.tsx). Right:
// the people of the paper's project (their wake actions arrive with PLA-I49-5; for ideas the PO plans them through
// Send to Plania), the drawer (Later) and the bin (Not relevant), and the out tray: what was handled today, with
// Undo where it exists. Every action goes through POST /api/brief/act; the rows' state comes from GET
// /api/brief/:id/state, polled every 30 s while the tab is visible, so a row handled in Bandeja leaves by itself.
import { useEffect, useMemo, useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateLabel } from "@/components/brief/brief-header";
import { BRIEF_LABELS, dayLabel, type DeskAction } from "@/lib/brief-i18n";
import {
  CROSS,
  NEEDS,
  UP_NEXT,
  requestId,
  type ActionId,
  type ActReply,
  type BriefApp,
  type BriefData,
  type BriefHistoryRow,
  type BriefLanguage,
  type BriefRun,
  type BriefStateReply,
  type Idea,
  type Item,
  type ItemState,
  type PlanIdeaProgress,
  type RowAction,
  DISCARD_REASONS,
  planLine as planLineOf,
} from "@/lib/brief";
import { INK, Paper, Stamp, appStyle, kindLabel, pressOf, type Pending } from "./desk-paper";

export type PileId = "needs" | "next" | "ideas";

/** The rows of a pile that are still open, blockers first, else brief order. */
export function openRows(items: Item[], state: BriefStateReply | undefined, pile: "needs" | "next"): Item[] {
  const statuses = pile === "needs" ? NEEDS : UP_NEXT;
  const rank = { blocker: 0, needs_you: 1, next: 2, open_pr: 3 } as const;
  return items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => statuses.includes(it.status) && (state?.items[it.id]?.state ?? "open") === "open")
    .sort((a, b) => rank[a.it.status] - rank[b.it.status] || a.i - b.i)
    .map(({ it }) => it);
}

/** Rows no longer open (handled, later, not relevant, gone), newest first: the out tray. */
export function trayRows(items: Item[], state: BriefStateReply | undefined): { item: Item; st: ItemState }[] {
  return items
    .map((item) => ({ item, st: state?.items[item.id] }))
    .filter((r): r is { item: Item; st: ItemState } => !!r.st && r.st.state !== "open")
    .sort((a, b) => (b.st.at ?? "").localeCompare(a.st.at ?? ""));
}

/** Left on the desk and handled today, for the sky. Ideas count as left until hidden or sent. */
export function deskCounts(data: BriefData, state: BriefStateReply | undefined, checks: string[], sentCodes: ReadonlySet<string>, ideaDone: ReadonlySet<string> = new Set()) {
  const rows = data.items.filter((i) => [...NEEDS, ...UP_NEXT].includes(i.status));
  const open = rows.filter((i) => (state?.items[i.id]?.state ?? "open") === "open").length;
  const ideasOpen = data.ideas.filter((i) => !checks.includes(i.id) && !sentCodes.has(i.code) && !ideaDone.has(i.id)).length;
  const total = rows.length + data.ideas.length;
  const left = open + ideasOpen;
  return { left, handled: total - left, total, p: total ? (total - left) / total : 0 };
}

const hhmm = (iso: string | null | undefined, language: BriefLanguage) =>
  iso ? new Date(iso).toLocaleTimeString(language === "es" ? "es-MX" : "en-US", { hour: "2-digit", minute: "2-digit" }) : null;

const letterOf = (app: BriefApp | undefined, fallback: string) => (app?.id === CROSS ? "X" : (app?.name ?? fallback).slice(0, 1).toUpperCase());

type Acting = Promise<ActReply>;
type Undoing = Promise<unknown>;
type Toast = { text: string; actionId: string | null; itemId: string | null } | null;

export type DeskProps = {
  data: BriefData;
  briefId: string;
  state: BriefStateReply | undefined;
  stateLoading: boolean;
  checks: string[];
  language: BriefLanguage;
  readOnly: boolean;
  stamp: string;
  // the sky's tools
  run: BriefRun | null;
  generating: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  history: BriefHistoryRow[];
  todayDate: string | null;
  date: string | null;
  onDate: (date: string | null) => void;
  onSettings: () => void;
  banner: "refresh-failed" | "past" | null;
  onRetry: () => void;
  // acting
  onAct: (body: { item_id: string; action: ActionId; target?: number; input?: Record<string, unknown>; request_id: string }) => Acting;
  onUndo: (actionId: string, itemId: string) => Undoing;
  acting: boolean;
  // ideas: the selection for several at once, the plan cost line, Send to Plania's progress per code
  selected: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  ideaCost: (ids: ReadonlySet<string>) => { bots: number; low: number; high: number } | null;
  sending: boolean;
  plans: Map<string, PlanIdeaProgress>;
};

export function BriefDesk(props: DeskProps) {
  const { data, state, language, readOnly } = props;
  const t = BRIEF_LABELS[language];
  const d = t.d;
  const apps = useMemo(() => new Map(data.apps.map((a) => [a.id, a])), [data.apps]);
  const appOf = (id: string) => apps.get(id) ?? apps.get(CROSS);
  const sentCodes = useMemo(() => new Set(props.plans.keys()), [props.plans]);

  const needs = openRows(data.items, state, "needs");
  const next = openRows(data.items, state, "next");
  // PLA-I49-6: an idea card leaves Today's ideas once it has a fate (or was hidden, or sent in V1).
  const fateOf = (i: Idea) => state?.ideas?.[i.id]?.state ?? "open";
  const ideaDone = new Set(data.ideas.filter((i) => fateOf(i) !== "open" || sentCodes.has(i.code) || props.checks.includes(i.id)).map((i) => i.id));
  const ideasOpen = data.ideas.filter((i) => !ideaDone.has(i.id));
  const ideasMoving = data.ideas.filter((i) => ideaDone.has(i.id) && !props.checks.includes(i.id));
  const inMotion = state?.in_motion ?? [];
  const tray = trayRows(data.items, state);
  const counts = deskCounts(data, state, props.checks, sentCodes, ideaDone);

  const [pile, setPile] = useState<PileId>(needs.length ? "needs" : next.length ? "next" : "ideas");
  const [sel, setSel] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [deal, setDeal] = useState(0);
  const [toast, setToast] = useState<Toast>(null);
  // The idea in hand: a wake (plan, sketch, research) waiting for its Wake, or a discard waiting for its reason.
  const [ideaPending, setIdeaPending] = useState<{ kind: "wake"; action: "plan" | "sketch" | "research" } | { kind: "discard" } | { kind: "failed"; hint: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paperRef = useRef<HTMLDivElement>(null);

  const pileRows: (Item | Idea)[] = pile === "needs" ? needs : pile === "next" ? next : ideasOpen;
  const isIdea = (x: Item | Idea | undefined): x is Idea => !!x && "why" in x;
  const all: (Item | Idea)[] = [...data.items, ...data.ideas];
  // The paper: the selected id if it still exists (a row that left keeps its paper until another is picked), else the pile's first.
  const current = (sel ? all.find((x) => x.id === sel) : undefined) ?? pileRows[0];
  const many = pile === "ideas" && props.selected.size > 1;

  useEffect(() => () => void (toastTimer.current && clearTimeout(toastTimer.current)), []);
  const say = (text: string, actionId: string | null = null, itemId: string | null = null) => {
    setToast({ text, actionId, itemId });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };

  const pick = (id: string) => {
    setSel(id);
    setPending(null);
    setIdeaPending(null);
    setDeal((n) => n + 1);
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 63.99rem)").matches) paperRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const choosePile = (p: PileId) => {
    setPile(p);
    setSel(null);
    setPending(null);
    setIdeaPending(null);
    props.onClearSelection();
    setDeal((n) => n + 1);
  };

  /** After a row leaves: the next open row of the same pile is dealt. */
  const dealNext = (itemId: string) => {
    const rest = pileRows.filter((x) => x.id !== itemId);
    setSel(rest[0]?.id ?? itemId);
    setDeal((n) => n + 1);
  };

  const run = async (item: Item, action: ActionId, target: number | null, input?: Record<string, unknown>) => {
    try {
      const reply = await props.onAct({ item_id: item.id, action, ...(target !== null ? { target } : {}), ...(input ? { input } : {}), request_id: requestId() });
      if (reply.status === "done") {
        setPending(null);
        setFresh(item.id);
        setTimeout(() => setFresh(null), 600);
        say(`${d.stamps[action as DeskAction]} · ${item.title}`, reply.undo ? reply.action_id : null, item.id);
        dealNext(item.id);
      } else if (reply.status === "stale") {
        setPending(null);
        say(d.stale);
      } else if (reply.status === "failed") {
        setPending({ kind: "failed", action, target, error: reply.error, hint: reply.hint, input });
      }
    } catch (e) {
      const err = e as { code?: string; message?: string; detail?: { hint?: string } };
      // No answer at all (the server restarting, the Mac asleep): say so in words, not the browser's.
      const offline = e instanceof TypeError;
      setPending({ kind: "failed", action, target, error: offline ? "OFFLINE" : (err.code ?? "ERROR"), hint: offline ? d.offline : (err.detail?.hint ?? err.message ?? ""), input });
    }
  };

  const press = (item: Item, a: RowAction) => {
    const how = pressOf(a);
    if (how === "instant") return void run(item, a.id, a.target);
    setPending(how === "confirm" ? { kind: "confirm", action: a.id, target: a.target } : how === "answer" ? { kind: "answer", target: a.target } : { kind: "changes", target: a.target });
  };

  /** One fate for the idea in hand, or for every selected idea, one call each. */
  const runIdeas = async (ids: string[], action: "keep" | "discard" | "research" | "sketch" | "plan", input?: Record<string, unknown>) => {
    let done = 0;
    let last: { action_id: string; id: string } | null = null;
    let failed: string | null = null;
    for (const id of ids) {
      try {
        const reply = await props.onAct({ item_id: id, action: action as never, ...(input ? { input } : {}), request_id: requestId() });
        if (reply.status === "done") {
          done += 1;
          last = reply.undo ? { action_id: reply.action_id, id } : null;
        } else if (reply.status === "failed") failed = reply.hint || reply.error;
      } catch (e) {
        failed = e instanceof TypeError ? d.offline : (e as Error).message;
      }
    }
    props.onClearSelection();
    if (failed && !done) return setIdeaPending({ kind: "failed", hint: failed });
    setIdeaPending(null);
    setSel(null);
    setDeal((n) => n + 1);
    const word = action === "plan" ? d.idea.fate.planned : action === "keep" ? d.idea.fate.kept : action === "discard" ? d.idea.fate.discarded : d.idea.fate[action];
    say(`${word} · ${ids.length === 1 ? (data.ideas.find((i) => i.id === ids[0])?.title ?? "") : d.idea.many(done)}`, ids.length === 1 && last ? last.action_id : null, last?.id ?? null);
  };

  const undo = async (actionId: string, itemId: string) => {
    try {
      await props.onUndo(actionId, itemId);
      setToast(null);
      setSel(itemId);
      const it = data.items.find((i) => i.id === itemId);
      if (it) setPile(NEEDS.includes(it.status) ? "needs" : "next");
      setDeal((n) => n + 1);
      say(d.undone);
    } catch {
      say(d.failed);
    }
  };

  const curItem = current && !isIdea(current) ? current : null;
  const curIdea = current && isIdea(current) ? current : null;
  const curState = curItem ? state?.items[curItem.id] : undefined;
  const curOpen = !!curItem && (curState?.state ?? "open") === "open";
  const curIdeaOpen = !!curIdea && !ideaDone.has(curIdea.id);
  const ideaMode = pile === "ideas" && (many || curIdeaOpen) && !readOnly;
  const canPutAway = !readOnly && !props.acting && ((curItem && curOpen && !!curState) || ideaMode);
  const sky = { ["--p" as string]: String(counts.p) };
  const ideaTargets = many ? [...props.selected] : curIdea && curIdeaOpen ? [curIdea.id] : [];
  const ideaPaused = ideaTargets.some((id) => state?.ideas?.[id]?.paused);
  const homeApp = curItem ? appOf(curItem.app) : curIdea ? appOf(curIdea.app) : undefined;

  return (
    <div className="dk" lang={language} data-brief="desk">
      <header className="dk-sky" style={sky} data-brief="sky">
        <div className="dk-sun" aria-hidden data-generating={props.run || props.generating ? "" : undefined} />
        <div className="relative grid gap-1">
          <div className="dk-kick">{props.stamp}</div>
          <h1>{t.title}</h1>
        </div>
        <div className="dk-count" aria-live="polite" data-brief="count">
          <b>{counts.left}</b> {d.left(counts.left)} · {props.run ? generateLabel(language, props.run, props.generating, Date.now()) : d.handledToday(counts.handled)}
        </div>
        <div className="dk-tools">
          <button type="button" className="dk-chip" disabled={!!props.run || props.generating || !props.canGenerate || !!props.date} onClick={props.onGenerate} data-brief="generate">
            {generateLabel(language, props.run, props.generating, Date.now())}
          </button>
          <Select value={props.date ?? "today"} onValueChange={(v) => props.onDate(v === "today" ? null : v)}>
            <SelectTrigger className="dk-chip h-auto! border-0 py-0" aria-label={t.history} data-brief="history">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{t.today}</SelectItem>
              {props.history
                .filter((h) => h.local_date !== props.todayDate)
                .slice(0, 14)
                .map((h) => (
                  <SelectItem key={h.local_date} value={h.local_date}>
                    {dayLabel(h.local_date, language)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <button type="button" className="dk-chip" onClick={props.onSettings} data-brief="settings">
            {t.settings}
          </button>
        </div>
      </header>

      {data.mode !== "full" && !props.banner && (
        <div className="dk-banner" role="status" data-brief="missing">
          <span>{t.missing}</span>
        </div>
      )}
      {props.banner && (
        <div className="dk-banner" role="status" data-brief={props.banner}>
          {props.banner === "refresh-failed" ? (
            <>
              <span>{t.refreshFailed}</span>
              <button type="button" onClick={props.onRetry}>
                {d.retry}
              </button>
            </>
          ) : (
            <>
              <b>{d.readOnly}</b>
              <button type="button" onClick={() => props.onDate(null)}>
                {d.backToday}
              </button>
            </>
          )}
        </div>
      )}

      <div className="dk-desk">
        <section className="dk-col" aria-label={d.piles.needs + " · " + d.piles.next + " · " + d.piles.ideas}>
          <div className="dk-piles" role="tablist">
            {(["needs", "next", "ideas"] as const).map((k) => {
              const n = k === "needs" ? needs.length : k === "next" ? next.length : ideasOpen.length;
              return (
                <button key={k} type="button" role="tab" className="dk-pile" aria-selected={pile === k} onClick={() => choosePile(k)} data-pile={k}>
                  <span className="dk-sheet" style={{ ["--k" as string]: String(Math.min(n, 3)) }}>
                    {n}
                  </span>
                  <span>{d.piles[k]}</span>
                </button>
              );
            })}
          </div>
          <div className="dk-ixs" role="tabpanel" data-brief="tabs">
            {pile === "ideas" && ideasMoving.length + inMotion.length > 0 && <div className="dk-sub">{d.idea.inMotion}</div>}
            {pile === "ideas" &&
              ideasMoving.map((i) => {
                const st = state?.ideas?.[i.id];
                const fate = st?.state && st.state !== "open" ? st.state : "planned";
                const ink = fate === "discarded" ? "stop" : fate === "kept" ? "wait" : "route";
                return (
                  <div key={i.id} className="dk-ix opacity-80" style={appStyle(appOf(i.app))} data-moving={i.id}>
                    <span className="dk-t">{letterOf(appOf(i.app), i.app)}</span>
                    <span className="min-w-0">
                      <b>{i.title}</b>
                      <small>{st?.line ?? (props.plans.get(i.code) ? t.planLine(planLineOf(props.plans.get(i.code)!)) : i.code)}</small>
                    </span>
                    <span className={`dk-tag dk-${ink}`}>{d.idea.fate[fate]}</span>
                  </div>
                );
              })}
            {pile === "ideas" &&
              inMotion.map((m) => {
                const app = appOf(m.project);
                return (
                  <a key={m.key} className="dk-ix opacity-80" style={appStyle(app)} href={m.doc_url ?? `/p/${encodeURIComponent(m.project)}?task=${encodeURIComponent(m.key)}`} {...(m.doc_url ? { target: "_blank", rel: "noopener noreferrer" } : {})} data-motion={m.key}>
                    <span className="dk-t">{letterOf(app, m.project)}</span>
                    <span className="min-w-0">
                      <b>{m.title}</b>
                      <small>
                        {m.key}
                        {m.stage ? ` · ${m.stage}` : ""}
                      </small>
                    </span>
                    <span className={`dk-tag dk-${m.next === "sketch_ready" || m.next === "research_ready" ? "go" : "route"}`}>{d.idea.next[m.next]}</span>
                  </a>
                );
              })}
            {pile === "ideas" && ideasMoving.length + inMotion.length > 0 && <div className="dk-sub">{d.idea.today}</div>}
            {pileRows.length === 0 && <div className="dk-empty">{d.pileEmpty}</div>}
            {pileRows.map((x) => {
              const app = appOf(x.app);
              const idea = isIdea(x);
              return (
                <div key={x.id} className="relative">
                  <button
                    type="button"
                    className="dk-ix"
                    style={appStyle(app)}
                    aria-current={current?.id === x.id && !many}
                    data-blocker={!idea && x.status === "blocker" ? "" : undefined}
                    onClick={() => pick(x.id)}
                    data-tab={x.id}
                  >
                    <span className="dk-t">{letterOf(app, x.app)}</span>
                    <span className="min-w-0">
                      <b>{x.title}</b>
                      <small>{idea ? `${x.code} · ${app?.name ?? x.app}${x.seen ? ` · ${d.idea.seen(x.seen)}` : ""}` : `${kindLabel(x, state?.items[x.id], language)} · ${app?.name ?? x.app}`}</small>
                    </span>
                    {idea && <span className="w-7" aria-hidden />}
                  </button>
                  {idea && !readOnly && (
                    <button
                      type="button"
                      role="checkbox"
                      className="dk-pick absolute top-1/2 right-3 -translate-y-1/2"
                      aria-checked={props.selected.has(x.id)}
                      aria-label={t.selectIdea(x.title)}
                      onClick={() => {
                        props.onSelect(x.id);
                        setIdeaPending(null);
                      }}
                      data-pick={x.id}
                    >
                      {props.selected.has(x.id) ? "✓" : ""}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="dk-col dk-mid" ref={paperRef} aria-label={d.you} data-brief="paper">
          {many ? (
            <article className="dk-paper" data-paper="many">
              <div className="dk-kick">{d.piles.ideas}</div>
              <h2>{d.ideasInHand(props.selected.size)}</h2>
              <p className="dk-det">{data.ideas.filter((i) => props.selected.has(i.id)).map((i) => i.title).join(" · ")}</p>
              <p className="dk-note">{d.ideaHint}</p>
              {ideaBox()}
              <div className="dk-you">
                <div className="dk-kick">{d.you}</div>
                <div className="dk-stamps">
                  {ideaStamps()}
                  <Stamp small quiet onClick={props.onClearSelection}>
                    {d.dropSelection}
                  </Stamp>
                </div>
              </div>
            </article>
          ) : curItem ? (
            <Paper
              key={`${curItem.id}-${deal}`}
              item={curItem}
              app={appOf(curItem.app)}
              st={curState}
              language={language}
              readOnly={readOnly}
              busy={props.acting}
              pending={pending}
              fresh={fresh === curItem.id}
              deal={deal > 0}
              onPress={(a) => press(curItem, a)}
              onRun={(action, target, input) => void run(curItem, action, target, input)}
              onCancel={() => setPending(null)}
              onUndo={!readOnly && curState?.undo && curState.action_id ? () => void undo(curState.action_id!, curItem.id) : null}
            />
          ) : curIdea ? (
            <article className="dk-paper" style={appStyle(appOf(curIdea.app))} data-paper={curIdea.id} key={`${curIdea.id}-${deal}`} data-deal={deal > 0 || undefined}>
              <div className="dk-kick">
                <b className="dk-app">{appOf(curIdea.app)?.name ?? curIdea.app}</b> · {d.kinds.idea} · {curIdea.code}
                {(curIdea.flags ?? []).map((f) => (
                  <span key={f} className="ml-2 rounded-full border px-2 text-[10px] normal-case">
                    {f}
                  </span>
                ))}
              </div>
              <h2>{curIdea.title}</h2>
              <p className="dk-det">{curIdea.why}</p>
              {curIdea.seen ? <p className="dk-note">{d.idea.seen(curIdea.seen)}</p> : null}
              {!curIdeaOpen && state?.ideas?.[curIdea.id]?.line && <p className="dk-note" data-brief="outcome">{state.ideas[curIdea.id]!.line}</p>}
              {ideaBox()}
              <div className="dk-you">
                {readOnly ? (
                  <p className="dk-note">{d.readOnly}</p>
                ) : curIdeaOpen && !ideaPending ? (
                  <>
                    <div className="dk-kick">{d.you}</div>
                    <div className="dk-stamps">{ideaStamps()}</div>
                  </>
                ) : null}
              </div>
            </article>
          ) : (
            <article className="dk-paper items-center justify-center text-center" data-paper="empty">
              <h2 className="mx-auto">{props.stateLoading && !state ? d.loading : counts.left ? d.pileEmpty : d.clear}</h2>
            </article>
          )}
        </section>

        <aside className="dk-col" aria-label={`${d.hand} · ${d.away} · ${d.out}`}>
          <div className="dk-lab">
            <span>{d.hand}</span>
            <span>{homeApp?.name ?? ""}</span>
          </div>
          <div className="dk-people" style={appStyle(homeApp)} data-brief="people">
            {(["po", "artist", "research", "taller"] as const).map((role) => {
              // PLA-I49-6: for ideas the PO plans it, Artist sketches it, Research researches it.
              const ideaAct = ideaMode ? ({ po: "plan", artist: "sketch", research: "research" } as const)[role as "po" | "artist" | "research"] : undefined;
              const ideaPo = !!ideaAct;
              // PLA-I49-5: the row's wake actions. PO: Give to PO (any row). Taller: Start now, or Start building.
              const rowWake = curItem && curOpen && !readOnly ? (curState?.actions ?? []).find((a) => (role === "po" ? a.id === "give_to_po" : role === "taller" ? a.id === "start_now" || a.id === "start_building" : false)) : undefined;
              const on = ideaPo || !!rowWake;
              const who = rowWake?.wake;
              const status = who ? (who.company_paused || who.paused ? d.paused : who.busy ? d.working : (who.agent ?? d.roles[role])) : null;
              return (
                <button
                  key={role}
                  type="button"
                  className="dk-who"
                  data-on={on || undefined}
                  disabled={!on || props.sending || props.acting}
                  onClick={() => {
                    if (ideaAct) setIdeaPending({ kind: "wake", action: ideaAct });
                    else if (rowWake && curItem) setPending({ kind: "wake", action: rowWake.id, target: rowWake.target });
                  }}
                  data-person={role}
                  title={on ? undefined : d.soon}
                >
                  <span className="dk-face" aria-hidden>
                    {d.roles[role].slice(0, 1)}
                  </span>
                  <span className="min-w-0">
                    <b>{ideaAct ? d.idea[ideaAct] : rowWake ? d.verbs[rowWake.id as DeskAction] : role === "po" ? d.giveToPo : d.roles[role]}</b>
                    <small>{ideaAct ? (ideaPaused ? d.paused : `${d.roles[role]}${homeApp && homeApp.id !== CROSS ? ` ${homeApp.name}` : ""}`) : (status ?? d.soon)}</small>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="dk-lab">
            <span>{d.away}</span>
          </div>
          <div className="dk-away" data-brief="away">
            {pile === "ideas" ? (
              <>
                <button type="button" className="dk-box" disabled={!canPutAway} onClick={() => void runIdeas(ideaTargets, "keep")} data-away="keep">
                  <b>▤ {d.idea.keep}</b>
                  <small>{d.idea.keepHint}</small>
                </button>
                <button type="button" className="dk-box" disabled={!canPutAway} onClick={() => setIdeaPending({ kind: "discard" })} data-away="discard">
                  <b>✕ {d.idea.discard}</b>
                  <small>{d.idea.discardHint}</small>
                </button>
              </>
            ) : (
              <>
                <button type="button" className="dk-box" disabled={!canPutAway} onClick={() => curItem && void run(curItem, "later", null)} data-away="later">
                  <b>▤ {d.later}</b>
                  <small>{d.laterHint}</small>
                </button>
                <button type="button" className="dk-box" disabled={!canPutAway} onClick={() => curItem && void run(curItem, "dismiss", null)} data-away="dismiss">
                  <b>✕ {d.notRelevant}</b>
                  <small>{d.notRelevantHint}</small>
                </button>
              </>
            )}
          </div>
          <div className="dk-lab">
            <span>
              {d.out}
              {tray.length ? ` · ${tray.length}` : ""}
            </span>
          </div>
          <div className="dk-tray" data-brief="tray">
            {tray.length === 0 && <div className="dk-empty">{d.outEmpty}</div>}
            {tray.map(({ item, st }) => {
              const ink = st.action ? INK[st.action] : st.state === "dismissed" ? "no" : st.state === "later" ? "wait" : st.state === "gone" ? "no" : "go";
              const word = st.action ? d.stamps[st.action as DeskAction] : st.state === "dismissed" ? d.stamps.dismiss : st.state === "later" ? d.stamps.later : "✓";
              return (
                <div key={item.id} className="dk-slip" data-slip={item.id}>
                  <button type="button" className="min-w-0 truncate text-left no-underline!" onClick={() => pick(item.id)}>
                    <b>{item.title}</b>
                  </button>
                  <span className={`dk-tag dk-${ink}`}>{word}</span>
                  <small>
                    {[hhmm(st.at, language), st.line].filter(Boolean).join(" · ")}
                    {!readOnly && st.undo && st.action_id && (
                      <>
                        {" · "}
                        <button type="button" onClick={() => void undo(st.action_id!, item.id)}>
                          {d.undo}
                        </button>
                      </>
                    )}
                  </small>
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {toast && (
        <div className="dk-toast" role="status" aria-live="polite" data-brief="toast">
          <span className="truncate">{toast.text}</span>
          {toast.actionId && toast.itemId && (
            <button type="button" onClick={() => void undo(toast.actionId!, toast.itemId!)}>
              {d.undo}
            </button>
          )}
        </div>
      )}
    </div>
  );

  /** Keep and Discard as stamps on the idea's paper (the drawer and the bin do the same). */
  function ideaStamps() {
    return (
      <>
        <Stamp action="later" solid disabled={props.acting} onClick={() => void runIdeas(ideaTargets, "keep")}>
          {d.idea.keep}
        </Stamp>
        <Stamp action="close_idea" disabled={props.acting} onClick={() => setIdeaPending({ kind: "discard" })}>
          {d.idea.discard}
        </Stamp>
      </>
    );
  }

  /** The idea in hand: the cost line before a wake, the reason chips before a discard, or what failed. */
  function ideaBox() {
    if (!ideaPending || !ideaTargets.length) return null;
    if (ideaPending.kind === "failed")
      return (
        <div className="dk-ask dk-stop" role="alert" data-brief="failed">
          <p>
            <b>
              {d.failed}: {ideaPending.hint}
            </b>{" "}
            {d.nothingChanged}
          </p>
          <div className="dk-r">
            <Stamp small quiet onClick={() => setIdeaPending(null)}>
              {d.cancel}
            </Stamp>
          </div>
        </div>
      );
    if (ideaPending.kind === "discard")
      return (
        <div className="dk-ask dk-stop" data-brief="discard">
          <p>
            <b>{d.idea.why}</b>
          </p>
          <div className="dk-r">
            {DISCARD_REASONS.map((r) => (
              <Stamp key={r} action="close_idea" small disabled={props.acting} onClick={() => void runIdeas(ideaTargets, "discard", { reason: r })}>
                {d.idea.reasons[r]}
              </Stamp>
            ))}
            <Stamp small quiet onClick={() => setIdeaPending(null)}>
              {d.cancel}
            </Stamp>
          </div>
        </div>
      );
    const action = ideaPending.action;
    const plan = action === "plan" ? props.ideaCost(new Set(ideaTargets)) : null;
    const role = action === "plan" ? d.roles.po : action === "sketch" ? d.roles.artist : d.roles.research;
    const cost = plan ? d.ideaCost(plan.bots, plan.low, plan.high) : d.wakeCost(role, 10, 20);
    const project = homeApp?.name ?? "";
    return (
      <div className="dk-ask dk-route" data-brief="wake">
        <p>
          <b>{d.idea[action]}</b>: {ideaTargets.length === 1 ? (data.ideas.find((i) => i.id === ideaTargets[0])?.title ?? "") : d.idea.many(ideaTargets.length)}
        </p>
        <div className="dk-cost" data-brief="cost">
          {[cost, ideaPaused ? d.waitsPaused(project) : null].filter(Boolean).join(" · ")}
        </div>
        <div className="dk-r">
          <Stamp action="give_to_po" small solid disabled={props.acting} onClick={() => void runIdeas(ideaTargets, action)}>
            {d.wake} {role}
          </Stamp>
          <Stamp small quiet onClick={() => setIdeaPending(null)}>
            {d.cancel}
          </Stamp>
        </div>
      </div>
    );
  }
}
