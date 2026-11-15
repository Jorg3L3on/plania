// PLA-I51: the Morning brief as the city at dawn (Design doc on PLA-IDEA17; sketch linked from PLA-I51). On top the
// sky: one tower per project with its logo, one window per row of today's brief (orange waits for the owner, red
// blocks, blue is next, violet is an idea, pale is handled); the sun climbs and the sky turns to day as rows are
// handled. Under it la mesa (every card of the project in hand) and, at the right, la ficha (the card in hand: what
// Plania says now and every way to act on it). Every action goes through POST /api/brief/act and the rows' state
// through GET /api/brief/:id/state (V2's API, unchanged). Tickets and ideas in Plania open in the task sheet over the
// page; only GitHub and a sketch link leave it.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CrossMark, ProjectMark, projectGradient } from "@/components/plania-mark";
import { accentInk, projectAccent } from "@/components/plan/visuals";
import { TaskSheet } from "@/components/task-sheet";
import { generateLabel } from "@/components/brief/brief-header";
import { BRIEF_LABELS, dayLabel, type BriefLabels, type DeskAction } from "@/lib/brief-i18n";
import {
  CROSS,
  DISCARD_REASONS,
  parseFlag,
  requestId,
  safeUrl,
  type ActionId,
  type ActReply,
  type BriefData,
  type BriefHistoryRow,
  type BriefLanguage,
  type BriefLastRun,
  type BriefPass,
  type BriefRun,
  type BriefStateReply,
  type IdeaAction,
  type IdeaCardState,
  type IdeaFate,
  type IdeaInMotion,
  type Item,
  type ItemState,
  type PlanIdeaProgress,
  type RowAction,
  type Target,
} from "@/lib/brief";
import { INK, confirmText, evidence, kindLabel, pressOf, type Ink } from "@/lib/brief-row";
import { cardsOf, firstStation, keyCommand, missingPart, nextOpenCard, nextWithWork, pickCard, skyCounts, stageIndex, STAGES, stations as stationsOf, stepCard, type CityCard, type Station } from "@/lib/brief-city";

// ---- shapes

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
/** A card handled in this visit, shown at once (the state poll catches up). */
type Local = { word: string; ink: Ink; at: string; actionId: string | null; undo: boolean; fate?: IdeaFate; line?: string; action?: ActionId };
type Toast = { text: string; actionId: string | null; itemId: string | null } | null;
type Acting = Promise<ActReply>;
type Undoing = Promise<unknown>;
type Pop = "gen" | "handled" | "fix" | null;

export type CityProps = {
  data: BriefData;
  briefId: string;
  state: BriefStateReply | undefined;
  stateLoading: boolean;
  checks: string[];
  language: BriefLanguage;
  readOnly: boolean;
  stamp: string;
  run: BriefRun | null;
  lastRun?: BriefLastRun | null;
  generating: boolean;
  canGenerate: boolean;
  onGenerate: (passes?: BriefPass[]) => void;
  history: BriefHistoryRow[];
  todayDate: string | null;
  date: string | null;
  onDate: (date: string | null) => void;
  onSettings: () => void;
  banner: "refresh-failed" | "past" | null;
  onRetry: () => void;
  onAct: (body: ActBody) => Acting;
  onUndo: (actionId: string, itemId: string) => Undoing;
  acting: boolean;
  ideaCost: (ids: ReadonlySet<string>) => { bots: number; low: number; high: number } | null;
  plans: Map<string, PlanIdeaProgress>;
  maxItems?: number;
  runAt?: string;
  /** For tests and the real-browser pass: where the page starts. */
  initial?: { station?: string; card?: string; tab?: "new" | "plania"; pop?: Pop; pending?: Pending; sheet?: string };
};

// ---- small parts

const hhmm = (iso: string | null | undefined, language: BriefLanguage, tz?: string) => {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(language === "es" ? "es-MX" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false, ...(tz ? { timeZone: tz } : {}) }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
};

export function appName(slug: string, name: string | undefined, t: BriefLabels) {
  return slug === CROSS ? t.c.cross : name || slug;
}

/** The project's colours for a station: its Inicio accent and its logo's two stops. Entre apps is neutral grey. */
export function appColors(slug: string): CSSProperties {
  if (slug === CROSS) return { ["--app" as string]: "var(--status-idle)", ["--app-ink" as string]: "var(--muted-foreground)", ["--from" as string]: "#c6cbdb", ["--to" as string]: "#7d86a3" };
  const [a] = projectAccent(slug);
  const [from, to] = projectGradient(slug);
  return { ["--app" as string]: a, ["--app-ink" as string]: accentInk(a), ["--from" as string]: from, ["--to" as string]: to };
}

export function Mark({ slug, name, className }: { slug: string; name?: string; className?: string }) {
  return slug === CROSS ? <CrossMark className={className} /> : <ProjectMark slug={slug} name={name} fallback className={className} />;
}

function Btn({ ink = "no", solid, quiet, small, kbd, disabled, onClick, children, data }: { ink?: Ink; solid?: boolean; quiet?: boolean; small?: boolean; kbd?: string; disabled?: boolean; onClick?: () => void; children: ReactNode; data?: string }) {
  return (
    <button type="button" className={`bc-b bc-${ink}`} data-solid={solid || undefined} data-quiet={quiet || undefined} data-sm={small || undefined} disabled={disabled} onClick={onClick} data-act={data}>
      {children}
      {kbd && <kbd aria-hidden>{kbd}</kbd>}
    </button>
  );
}

function Who({ face, verb, name, sub, onClick, disabled, data }: { face: string; verb: string; name: string; sub?: string; onClick: () => void; disabled?: boolean; data?: string }) {
  return (
    <button type="button" className="bc-who" onClick={onClick} disabled={disabled} data-who={data}>
      <i aria-hidden>{face}</i>
      <span>
        <b>{verb}</b>
        <small>{sub ? `${name} · ${sub}` : name}</small>
      </span>
    </button>
  );
}

const Lab = ({ children, extra }: { children: ReactNode; extra?: ReactNode }) => (
  <div className="bc-lab">
    <span>{children}</span>
    {extra}
  </div>
);

const STARS: [number, number][] = [[6, 14], [13, 40], [21, 9], [29, 52], [38, 22], [47, 8], [55, 36], [63, 15], [71, 48], [78, 10], [86, 30], [94, 17]];

/** The sky band's frame: stars, sun, the title and the tools. The towers come as children. */
export function SkyFrame({ p, busy, stamp, title, count, tools, children }: { p: number; busy: boolean; stamp: string | null; title: string; count?: ReactNode; tools: ReactNode; children?: ReactNode }) {
  return (
    <header className="bc-sky" style={{ ["--p" as string]: p.toFixed(3) }} data-brief="sky">
      <div className="bc-sky-bg" aria-hidden>
        <div className="bc-stars">
          {STARS.map(([x, y]) => (
            <i key={`${x}-${y}`} style={{ left: `${x}%`, top: `${y}%` }} />
          ))}
        </div>
        <div className="bc-sun" data-busy={busy ? "" : undefined} data-brief="sun" />
      </div>
      <div className="bc-sky-top">
        <div className="min-w-0">
          {stamp && <div className="bc-kick">{stamp}</div>}
          <h1>{title}</h1>
        </div>
        {count}
        <div className="bc-tools">{tools}</div>
      </div>
      {children}
    </header>
  );
}

// ---- the page

export function BriefCity(props: CityProps) {
  const { data, language, readOnly } = props;
  const t = BRIEF_LABELS[language];
  const c = t.c;
  const d = t.d;
  const sentCodes = useMemo(() => new Set(props.plans.keys()), [props.plans]);
  const [local, setLocal] = useState<Record<string, Local>>({});

  // The state as the server last said, with what was handled here since laid over it.
  const state = useMemo(() => mergeLocal(props.state, local), [props.state, local]);
  const list = useMemo(() => stationsOf(data, state, { checks: props.checks, sentCodes, maxItems: props.maxItems }), [data, state, props.checks, sentCodes, props.maxItems]);
  const sky = skyCounts(list);

  const startAt = props.initial?.station ? Math.max(0, list.findIndex((s) => s.slug === props.initial!.station)) : firstStation(list);
  const [si, setSi] = useState(startAt);
  const [picked, setPicked] = useState<Record<string, string>>(props.initial?.card ? { [list[startAt]?.slug ?? ""]: props.initial.card } : {});
  const [tab, setTab] = useState<Record<string, "new" | "plania">>(props.initial?.tab ? { [list[startAt]?.slug ?? ""]: props.initial.tab } : {});
  const [pending, setPending] = useState<Pending>(props.initial?.pending ?? null);
  const [pop, setPop] = useState<Pop>(props.initial?.pop ?? null);
  const [sheet, setSheet] = useState<{ slug: string; key: string } | null>(props.initial?.sheet ? { slug: list[startAt]?.slug ?? "", key: props.initial.sheet } : null);
  const [toast, setToast] = useState<Toast>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [text, setText] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fichaRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const st = list[Math.min(si, list.length - 1)];
  const slug = st?.slug ?? "";
  const name = st ? appName(slug, st.app.name, t) : "";
  const motionId = picked[slug]?.startsWith("m|") ? picked[slug]!.slice(2) : null;
  const motion = motionId ? st?.inPlania.find((m) => m.key === motionId) : undefined;
  const card = st && !motion ? pickCard(st, picked[slug]) : undefined;
  const cards = st ? cardsOf(st) : [];
  const ideaTab = tab[slug] ?? "new";
  const busy = !!props.run || props.generating;

  useEffect(() => () => void (toastTimer.current && clearTimeout(toastTimer.current)), []);
  // On a narrow screen the towers scroll sideways: keep the chosen one in view (without moving the page).
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!strip || !tab || strip.scrollWidth <= strip.clientWidth) return;
    const left = tab.offsetLeft; // the strip is the positioned parent
    if (left < strip.scrollLeft || left + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, left - 16);
  }, [si]);
  const say = (s: string, actionId: string | null = null, itemId: string | null = null) => {
    setToast({ text: s, actionId, itemId });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };

  const reset = () => {
    setPending(null);
    setText("");
  };
  const goto = (i: number) => {
    if (!list.length) return;
    setSi((i + list.length) % list.length);
    setPop(null);
    reset();
  };
  const pick = (id: string) => {
    setPicked((p) => ({ ...p, [slug]: id }));
    reset();
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 899px)").matches) fichaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const step = (dir: number) => {
    if (!st) return;
    const n = stepCard(st, card?.id, dir);
    if (n) {
      if (n.kind === "idea") setTab((p) => ({ ...p, [slug]: "new" }));
      pick(n.id);
    }
  };

  /** After a card is handled: its stamp, the toast with Undo, and the next open card of the project. */
  const handled = (cd: CityCard, l: Local) => {
    setLocal((p) => ({ ...p, [cd.id]: l }));
    reset();
    setFresh(cd.id);
    setTimeout(() => setFresh(null), 650);
    say(`${l.word} · ${cd.kind === "item" ? cd.item.title : cd.idea.title}`, l.undo ? l.actionId : null, cd.id);
    const after = st ? nextOpenCard({ ...st, items: st.items.map((x) => (x.id === cd.id ? { ...x, open: false } : x)), ideas: st.ideas.map((x) => (x.id === cd.id ? { ...x, open: false } : x)) }, cd.id) : undefined;
    if (after) setTimeout(() => setPicked((p) => (p[slug] === cd.id || !p[slug] ? { ...p, [slug]: after.id } : p)), 650);
    else setPicked((p) => ({ ...p, [slug]: cd.id }));
  };

  const fail = (e: unknown, action: ActionId | IdeaAction, target: number | null, input?: Record<string, unknown>) => {
    const err = e as { code?: string; message?: string; detail?: { hint?: string } };
    const offline = e instanceof TypeError;
    setPending({ kind: "failed", action, target, error: offline ? "OFFLINE" : (err.code ?? "ERROR"), hint: offline ? d.offline : (err.detail?.hint ?? err.message ?? ""), input });
  };

  const runItem = async (item: Item, action: ActionId, target: number | null, input?: Record<string, unknown>) => {
    const cd = cards.find((x) => x.id === item.id) ?? { kind: "item" as const, id: item.id, item, open: true };
    try {
      const reply = await props.onAct({ item_id: item.id, action, ...(target !== null ? { target } : {}), ...(input ? { input } : {}), request_id: requestId() });
      if (reply.status === "done") handled(cd, { word: d.stamps[action as DeskAction], ink: INK[action], at: new Date().toISOString(), actionId: reply.action_id, undo: reply.undo, line: reply.line, action });
      else if (reply.status === "stale") {
        reset();
        say(d.stale);
      } else if (reply.status === "failed") setPending({ kind: "failed", action, target, error: reply.error, hint: reply.hint, input });
    } catch (e) {
      fail(e, action, target, input);
    }
  };

  const FATE: Record<IdeaAction, IdeaFate> = { keep: "kept", discard: "discarded", research: "research", sketch: "sketch", plan: "planned" };
  const FATE_INK: Record<IdeaAction, Ink> = { keep: "go", discard: "stop", research: "route", sketch: "route", plan: "route" };
  const runIdea = async (cd: Extract<CityCard, { kind: "idea" }>, action: IdeaAction, input?: Record<string, unknown>) => {
    try {
      const reply = await props.onAct({ item_id: cd.id, action, ...(input ? { input } : {}), request_id: requestId() });
      if (reply.status === "done") {
        const fate = FATE[action];
        handled(cd, { word: d.idea.fate[fate]!, ink: FATE_INK[action], at: new Date().toISOString(), actionId: reply.action_id, undo: reply.undo, fate, line: reply.line });
      } else if (reply.status === "failed") setPending({ kind: "failed", action, target: null, error: reply.error, hint: reply.hint, input });
      else if (reply.status === "stale") {
        reset();
        say(d.stale);
      }
    } catch (e) {
      fail(e, action, null, input);
    }
  };

  const press = (item: Item, a: RowAction) => {
    const how = pressOf(a);
    if (how === "instant") return void runItem(item, a.id, a.target);
    setText("");
    setPending(how === "confirm" ? { kind: "confirm", action: a.id, target: a.target } : how === "answer" ? { kind: "answer", target: a.target } : { kind: "changes", target: a.target });
  };

  const undo = async (actionId: string, itemId: string) => {
    try {
      await props.onUndo(actionId, itemId);
      setLocal((p) => {
        const n = { ...p };
        delete n[itemId];
        return n;
      });
      setToast(null);
      setPop(null);
      const at = list.findIndex((s) => cardsOf(s).some((x) => x.id === itemId));
      if (at >= 0) {
        setSi(at);
        setPicked((p) => ({ ...p, [list[at]!.slug]: itemId }));
      }
      reset();
      say(d.undone);
    } catch {
      say(d.failed);
    }
  };

  // What was handled today (rows and ideas), newest first, for "N resueltos hoy" and Z.
  const tray = useMemo(() => handledList(list, state, t, language), [list, state, t, language]);

  const itemState = (id: string): ItemState | undefined => state?.items[id];
  const rowActions = card?.kind === "item" ? (itemState(card.id)?.actions ?? []) : [];
  const own = rowActions.filter((a) => a.id !== "later" && a.id !== "dismiss" && a.level !== "wake");
  const canAct = !readOnly && !props.acting && !!card?.open && !pending;

  // ---- keys
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (sheet) return;
    const cmd = keyCommand({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLElement | null });
    if (!cmd) return;
    if (cmd === "escape") {
      if (pop || pending) {
        setPop(null);
        reset();
      }
      return;
    }
    if (cmd === "next" || cmd === "prev") {
      e.preventDefault();
      return step(cmd === "next" ? 1 : -1);
    }
    if (cmd === "nextProject" || cmd === "prevProject") {
      e.preventDefault();
      return goto(si + (cmd === "nextProject" ? 1 : -1));
    }
    if (cmd === "undo") {
      const last = tray.find((r) => r.undo && r.actionId);
      if (last && !readOnly) void undo(last.actionId!, last.id);
      return;
    }
    if (!canAct || !card) return;
    if (cmd === "primary") {
      e.preventDefault();
      if (card.kind === "idea") return void runIdea(card, "keep");
      if (own[0]) press(card.item, own[0]);
      return;
    }
    if (cmd === "later" && card.kind === "item" && rowActions.some((a) => a.id === "later")) return void runItem(card.item, "later", null);
    if (cmd === "dismiss") {
      if (card.kind === "idea") return setPending({ kind: "discard" });
      if (rowActions.some((a) => a.id === "dismiss")) return void runItem(card.item, "dismiss", null);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ---- sky
  const genLabel = props.lastRun && !busy ? d.retry : generateLabel(language, props.run, props.generating, Date.now());
  const genDisabled = busy || !props.canGenerate || !!props.date;
  const tools = (
    <>
      <div className="relative">
        <button
          type="button"
          className="bc-chip"
          disabled={genDisabled}
          aria-haspopup={props.lastRun ? undefined : "menu"}
          aria-expanded={props.lastRun ? undefined : pop === "gen"}
          onClick={() => (props.lastRun ? props.onGenerate() : setPop(pop === "gen" ? null : "gen"))}
          data-brief="generate"
        >
          {genLabel}
        </button>
        {pop === "gen" && !genDisabled && (
          <div className="bc-pop" role="menu" data-brief="gen-menu">
            <div className="bc-ph">{c.genMenu}</div>
            {(
              [
                ["both", c.genBoth, undefined],
                ["brief", c.genBrief, ["brief"]],
                ["ideas", c.genIdeas, ["ideas"]],
              ] as const
            ).map(([k, [label, time], passes]) => (
              <button
                key={k}
                type="button"
                role="menuitem"
                onClick={() => {
                  setPop(null);
                  props.onGenerate(passes ? [...passes] : undefined);
                }}
                data-gen={k}
              >
                <b>{label}</b>
                <small>{time}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <Select value={props.date ?? "today"} onValueChange={(v) => props.onDate(v === "today" ? null : v)}>
        <SelectTrigger className="bc-chip h-auto! py-0" aria-label={t.history} data-brief="history">
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
      <button type="button" className="bc-chip" onClick={props.onSettings} data-brief="settings">
        {t.settings}
      </button>
    </>
  );
  const count = (
    <div className="bc-count" aria-live="polite" data-brief="count">
      <b>{sky.left}</b> {c.onDesk} ·{" "}
      <span className="relative inline-block">
        <button type="button" onClick={() => setPop(pop === "handled" ? null : "handled")} aria-expanded={pop === "handled"} data-brief="handled">
          {c.handled(sky.handled)}
        </button>
        {pop === "handled" && (
          <div className="bc-pop bc-pop-wide" data-brief="handled-list">
            <div className="bc-ph">{c.handledTitle(tray.length)}</div>
            {tray.length === 0 && <div className="bc-none">{c.handledEmpty}</div>}
            {tray.slice(0, 12).map((r) => (
              <div key={r.id} className="bc-row" data-handled={r.id}>
                <button type="button" className="truncate text-left" onClick={() => jump(r.id)}>
                  {r.title}
                </button>
                <span className={`bc-tag bc-${r.ink}`}>{r.word}</span>
                <small>
                  {[r.app, r.at ? hhmm(r.at, language) : null].filter(Boolean).join(" · ")}
                  {!readOnly && r.undo && r.actionId && (
                    <>
                      {" · "}
                      <button type="button" onClick={() => void undo(r.actionId!, r.id)} data-undo={r.id}>
                        {d.undo}
                      </button>
                    </>
                  )}
                </small>
              </div>
            ))}
          </div>
        )}
      </span>
    </div>
  );

  function jump(id: string) {
    const at = list.findIndex((s) => cardsOf(s).some((x) => x.id === id));
    if (at < 0) return;
    setSi(at);
    setPicked((p) => ({ ...p, [list[at]!.slug]: id }));
    setPop(null);
    reset();
  }

  const allClear = sky.total > 0 && sky.left === 0;

  return (
    <div className="bc" lang={language} data-brief="city">
      <SkyFrame p={sky.p} busy={busy} stamp={props.stamp} title={t.title} count={count} tools={tools}>
        <div className="bc-stations-x" ref={stripRef}>
          <div className="bc-stations" role="tablist" aria-label={c.projects} style={{ ["--n" as string]: String(Math.max(list.length, 1)) }}>
            {list.map((s, i) => {
              const nm = appName(s.slug, s.app.name, t);
              const on = i === si;
              return (
                <button
                  key={s.slug}
                  type="button"
                  role="tab"
                  id={`bc-tab-${s.slug}`}
                  aria-selected={on}
                  aria-controls="bc-body"
                  aria-label={c.tower(nm, s.counts)}
                  title={c.tower(nm, s.counts)}
                  className="bc-stn"
                  style={appColors(s.slug)}
                  onClick={() => goto(i)}
                  data-station={s.slug}
                >
                  <span className="bc-twr" aria-hidden>
                    {s.windows.map((w) => (
                      <i key={w.id} className="bc-w" data-t={w.tone} data-cur={on && card?.id === w.id ? "" : undefined} data-win={w.id} />
                    ))}
                  </span>
                  <span className="bc-stn-l">
                    <span className="bc-stn-n">
                      <Mark slug={s.slug} name={nm} className="size-[18px]" />
                      <span className="truncate">{nm}</span>
                    </span>
                    <span className="bc-stn-c" data-counts={s.slug}>
                      {s.open ? (
                        <>
                          {s.counts.blocked > 0 && <Count tone="blocked" n={s.counts.blocked} />}
                          {s.counts.needs > 0 && <Count tone="jorge" n={s.counts.needs} />}
                          {s.counts.next > 0 && <Count tone="ready" n={s.counts.next} />}
                          {s.counts.ideas > 0 && <Count tone="review" n={s.counts.ideas} />}
                        </>
                      ) : (
                        <span>✓ {c.upToDate}</span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </SkyFrame>

      <Lines {...props} t={t} pop={pop} setPop={setPop} />

      {st ? (
        <div className="bc-body" id="bc-body" role="tabpanel" aria-labelledby={`bc-tab-${slug}`} style={appColors(slug)}>
          <section className="bc-mesa" aria-label={name} data-brief="mesa">
            <div className="bc-mesa-h">
              <Mark slug={slug} name={name} className="size-[34px]" />
              <h2>{name}</h2>
              <p className="bc-voice" data-brief="voice">
                {allClear ? c.clear : st.open ? c.voice(st.counts).map((v, i) => (v.tone ? <span key={i} className={`bc-v-${v.tone}`}>{v.text}</span> : <span key={i}>{v.text}</span>)) : c.isUpToDate(name)}
              </p>
              {list.length > 1 && (
                <div className="bc-hop">
                  <button type="button" onClick={() => goto(si - 1)} aria-label={c.prevProject(appName(list[(si - 1 + list.length) % list.length]!.slug, list[(si - 1 + list.length) % list.length]!.app.name, t))} data-hop="prev">
                    ←
                  </button>
                  <button type="button" onClick={() => goto(si + 1)} aria-label={c.nextProject(appName(list[(si + 1) % list.length]!.slug, list[(si + 1) % list.length]!.app.name, t))} data-hop="next">
                    <Mark slug={list[(si + 1) % list.length]!.slug} name={list[(si + 1) % list.length]!.app.name} className="size-[14px]" />
                    {appName(list[(si + 1) % list.length]!.slug, list[(si + 1) % list.length]!.app.name, t)} →
                  </button>
                </div>
              )}
            </div>

            {allClear ? (
              <div className="bc-cleared" data-brief="clear">
                <b>{c.clear}</b>
                <span>{c.clearLine(sky.handled, props.runAt ?? "07:00")}</span>
              </div>
            ) : (
              <>
                <div className="bc-sec">
                  <Lab>
                    {c.pending} · {c.ofTotal(st.items.filter((x) => x.open).length, st.items.length)}
                  </Lab>
                  {st.items.length ? (
                    <div className="bc-grid">
                      {st.items.map((x) => (
                        <CardButton key={x.id} cd={x} current={card?.id === x.id} st={itemState(x.id)} local={local[x.id]} t={t} language={language} onPick={() => pick(x.id)} />
                      ))}
                    </div>
                  ) : (
                    <p className="bc-note">{c.noRows}</p>
                  )}
                </div>
                <div className="bc-sec">
                  <Lab
                    extra={
                      <span className="bc-tabs" role="group" aria-label={c.ideasTabs}>
                        <button type="button" aria-pressed={ideaTab === "new"} onClick={() => setTab((p) => ({ ...p, [slug]: "new" }))} data-tab="new">
                          {c.newTab} · {st.ideas.filter((x) => x.open).length}
                        </button>
                        {(st.inPlania.length > 0 || st.planned > 0) && (
                          <button type="button" aria-pressed={ideaTab === "plania"} onClick={() => setTab((p) => ({ ...p, [slug]: "plania" }))} data-tab="plania">
                            {c.inPlaniaTab} · {st.inPlania.length}
                          </button>
                        )}
                      </span>
                    }
                  >
                    {c.ideas}
                  </Lab>
                  {ideaTab === "new" ? (
                    st.ideas.length ? (
                      <div className="bc-grid">
                        {st.ideas.map((x) => (
                          <CardButton key={x.id} cd={x} current={card?.id === x.id} st={undefined} idea={state?.ideas?.[x.id]} local={local[x.id]} t={t} language={language} onPick={() => pick(x.id)} />
                        ))}
                      </div>
                    ) : (
                      <p className="bc-note">{c.noNewIdeas}</p>
                    )
                  ) : (
                    <div className="bc-grid" data-brief="in-plania">
                      {st.inPlania.map((m) => (
                        <button key={m.key} type="button" className="bc-c bc-c-mo" aria-current={motion?.key === m.key || undefined} onClick={() => pick(`m|${m.key}`)} data-motion={m.key}>
                          <span className="bc-c-k">
                            <i className="bc-dot" data-t="review" />
                            <span>{m.key}</span>
                            <em>{c.stages[(m.stage ?? "idea") as keyof typeof c.stages] ?? m.stage}</em>
                          </span>
                          <span className="bc-c-t">{m.title}</span>
                        </button>
                      ))}
                      {!st.inPlania.length && <p className="bc-note">{c.noOpenIdeas}</p>}
                      {st.planned > 0 && (
                        <p className="bc-more" data-brief="planned">
                          {st.inPlania.length ? c.morePlanned(st.planned) : c.onlyPlanned(st.planned)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
            <p className="bc-keys" aria-hidden>
              {c.keys}
            </p>
          </section>

          <aside className="bc-ficha" ref={fichaRef} aria-label={card ? (card.kind === "item" ? card.item.title : card.idea.title) : (motion?.title ?? c.emptyHand)} data-brief="ficha">
            <div className="bc-band" aria-hidden />
            <div className="bc-wm" aria-hidden>
              <Mark slug={slug} name={name} className="size-[170px]" />
            </div>
            <div className="bc-f-in">{allClear && !local[card?.id ?? ""] ? <Empty t={t} /> : motion ? motionFicha(motion) : card ? cardFicha(card) : <Empty t={t} />}</div>
          </aside>
        </div>
      ) : (
        <div className="bc-body" id="bc-body">
          <p className="bc-note">{c.noRows}</p>
        </div>
      )}

      {sheet && <TaskSheet slug={sheet.slug} taskKey={sheet.key} onOpen={(key) => setSheet({ slug: sheet.slug, key })} onClose={() => setSheet(null)} />}

      {toast && (
        <div className="bc-toast" role="status" aria-live="polite" data-brief="toast">
          <span className="truncate">{toast.text}</span>
          {toast.actionId && toast.itemId && !readOnly && (
            <button type="button" onClick={() => void undo(toast.actionId!, toast.itemId!)}>
              {d.undo}
            </button>
          )}
        </div>
      )}
    </div>
  );

  // ---- the ficha

  function head(kind: string, cd?: CityCard, ref?: string) {
    const i = cd ? cards.findIndex((x) => x.id === cd.id) : -1;
    return (
      <div className="bc-f-k">
        <Mark slug={slug} name={name} className="size-[18px]" />
        <b>{name}</b>
        <span className="truncate">· {kind}</span>
        {i >= 0 ? (
          <span className="bc-pg">
            {c.position(i + 1, cards.length)}
            <button type="button" onClick={() => step(-1)} aria-label={c.prevCard} data-step="-1">
              ‹
            </button>
            <button type="button" onClick={() => step(1)} aria-label={c.nextCard} data-step="1">
              ›
            </button>
          </span>
        ) : (
          ref && <span className="bc-pg">{ref}</span>
        )}
      </div>
    );
  }

  function stampOf(cd: CityCard): { word: string; ink: Ink; at: string | null; line: string | null; actionId: string | null; undo: boolean } | null {
    const l = local[cd.id];
    if (cd.kind === "item") {
      const s = itemState(cd.id);
      if (s && s.state !== "open") {
        const word = s.action ? d.stamps[s.action as DeskAction] : s.state === "dismissed" ? d.stamps.dismiss : s.state === "later" ? d.stamps.later : s.state === "gone" ? "—" : "✓";
        const ink: Ink = s.action ? INK[s.action] : s.state === "dismissed" ? "no" : s.state === "later" ? "wait" : "go";
        return { word: l?.word ?? word, ink: l?.ink ?? ink, at: s.at ?? l?.at ?? null, line: s.line ?? l?.line ?? null, actionId: s.action_id ?? l?.actionId ?? null, undo: s.undo || !!l?.undo };
      }
      return l ? { word: l.word, ink: l.ink, at: l.at, line: l.line ?? null, actionId: l.actionId, undo: l.undo } : null;
    }
    if (cd.open) return null;
    const s = state?.ideas?.[cd.id];
    const fate = s?.state && s.state !== "open" ? s.state : "planned";
    return { word: l?.word ?? d.idea.fate[fate] ?? fate, ink: l?.ink ?? (fate === "discarded" ? "stop" : fate === "kept" ? "go" : "route"), at: s?.at ?? l?.at ?? null, line: s?.line ?? l?.line ?? null, actionId: s?.action_id ?? l?.actionId ?? null, undo: !!(s?.undo || l?.undo) };
  }

  function done(cd: CityCard, s: NonNullable<ReturnType<typeof stampOf>>) {
    const other = nextWithWork(list, si);
    return (
      <>
        <p className="bc-note" data-brief="outcome">
          {s.line ?? s.word}
          {s.at ? ` · ${d.handledAt(hhmm(s.at, language))}` : ""}
          {!readOnly && s.undo && s.actionId && (
            <>
              {" · "}
              <button type="button" onClick={() => void undo(s.actionId!, cd.id)} data-undo={cd.id}>
                {d.undo}
              </button>{" "}
              <kbd aria-hidden>Z</kbd>
            </>
          )}
        </p>
        {st && st.open === 0 && other >= 0 && (
          <div className="bc-btns">
            <Btn ink="route" solid onClick={() => goto(other)} data="next-project">
              {c.nextWithWork} →
            </Btn>
          </div>
        )}
      </>
    );
  }

  function failedBox(retry: () => void) {
    if (pending?.kind !== "failed") return null;
    return (
      <div className="bc-ask bc-stop" role="alert" data-brief="failed">
        <p>
          <b>
            {d.failed}: {pending.hint || pending.error}
          </b>{" "}
          {d.nothingChanged}
        </p>
        <div className="bc-btns">
          <Btn ink="stop" solid small disabled={props.acting} onClick={retry} data="try-again">
            {d.tryAgain}
          </Btn>
          <Btn quiet small onClick={reset}>
            {d.cancel}
          </Btn>
        </div>
      </div>
    );
  }

  function cardFicha(cd: CityCard) {
    const s = stampOf(cd);
    const stamp = s && (
      <div className={`bc-imp bc-${s.ink}`} data-new={fresh === cd.id || undefined} aria-hidden data-brief="stamp">
        {s.word}
        {s.at && <small>{d.handledAt(hhmm(s.at, language))}</small>}
      </div>
    );
    if (cd.kind === "idea") return ideaFicha(cd, s, stamp);
    const item = cd.item;
    const ist = itemState(cd.id);
    const l = ist?.live ?? null;
    const ev = evidence(l, language);
    const url = safeUrl(item.url);
    const key = targetKey(item.targets?.[0], l);
    const wakes = rowActions.filter((a) => a.level === "wake" || a.id === "give_to_po" || a.id === "start_now" || a.id === "start_building");
    const later = rowActions.find((a) => a.id === "later");
    const dismiss = rowActions.find((a) => a.id === "dismiss");
    const paused = (l?.kind === "ticket" || l?.kind === "initiative") && l.paused && cd.open;
    const app = data.apps.find((a) => a.id === item.app);
    const wakeAct = pending?.kind === "wake" ? rowActions.find((a) => a.id === pending.action) : undefined;
    return (
      <>
        {head(`${item.status === "blocker" ? `${t.blocker} · ` : ""}${kindLabel(item, ist, language)}`, cd, item.ref)}
        {stamp}
        <h3>{item.title}</h3>
        {item.detail && <p className="bc-f-d">{item.detail}</p>}
        {ev.length > 0 && (
          <div className="bc-ev" data-brief="evidence">
            <div className="bc-eh">
              <i />
              {c.readNow}
            </div>
            {ev.map(([k, v], i) => (
              <div key={`${k}-${i}`} className="bc-r">
                <span>{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        )}
        <div className="bc-links">
          {item.ref && <span className="bc-ref">{item.ref}</span>}
          {key && (
            <button type="button" onClick={() => setSheet({ slug: key.project, key: key.key })} data-see={key.key}>
              {c.seeHere(key.key)}
            </button>
          )}
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {c.github} ↗
            </a>
          )}
        </div>
        {paused && !pending && <p className="bc-note" data-brief="waiting-paused">{d.waitingPaused(appName(slug, app?.name, t))}</p>}
        <div className="bc-you">
          {readOnly ? (
            s ? done(cd, s) : <p className="bc-note">{d.readOnly}</p>
          ) : s ? (
            done(cd, s)
          ) : pending?.kind === "failed" ? (
            failedBox(() => (pending.action === "later" || pending.action === "dismiss" ? void runItem(item, pending.action, null) : void runItem(item, pending.action as ActionId, pending.target, pending.input)))
          ) : pending?.kind === "confirm" ? (
            <div className={`bc-ask bc-${INK[pending.action]}`} data-brief="confirm">
              <p>{confirmText(pending.action, item, app, l, language)}</p>
              <div className="bc-btns">
                <Btn ink={INK[pending.action]} solid small disabled={props.acting} onClick={() => void runItem(item, pending.action, pending.target)} data={`confirm-${pending.action}`}>
                  {props.acting ? d.working : d.verbs[pending.action as DeskAction]}
                </Btn>
                <Btn quiet small onClick={reset}>
                  {d.cancel}
                </Btn>
              </div>
            </div>
          ) : pending?.kind === "answer" ? (
            <div className="bc-ask bc-go" data-brief="answer">
              <p>
                <b>{d.yourAnswer}</b>
              </p>
              {l?.kind === "question" && l.options.length > 0 && (
                <div className="bc-btns">
                  {l.options.map((o, i) => (
                    <Btn key={o} ink="go" small disabled={props.acting} onClick={() => void runItem(item, "answer", pending.target, { option: i + 1 })} data={`option-${i + 1}`}>
                      {o}
                    </Btn>
                  ))}
                </div>
              )}
              <label>
                {d.answerText}
                <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
              </label>
              <div className="bc-btns">
                <Btn ink="go" solid small disabled={props.acting || !text.trim()} onClick={() => void runItem(item, "answer", pending.target, { text: text.trim() })} data="answer-text">
                  {d.verbs.answer}
                </Btn>
                <Btn quiet small onClick={reset}>
                  {d.cancel}
                </Btn>
              </div>
            </div>
          ) : pending?.kind === "changes" ? (
            <div className="bc-ask bc-wait" data-brief="changes">
              <label>
                {d.changesAsk}
                <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
              </label>
              <div className="bc-btns">
                <Btn ink="wait" solid small disabled={props.acting || !text.trim()} onClick={() => void runItem(item, "request_changes", pending.target, { text: text.trim() })} data="changes-send">
                  {d.send}
                </Btn>
                <Btn quiet small onClick={reset}>
                  {d.cancel}
                </Btn>
              </div>
            </div>
          ) : pending?.kind === "wake" ? (
            <div className="bc-ask bc-route" data-brief="wake">
              <p>
                <b>{d.verbs[pending.action as DeskAction]}</b>: {pending.action === "start_building" && l?.kind === "initiative" && l.next_phase ? d.buildWhat(l.next_phase.keys) : item.title}
              </p>
              {wakeAct?.wake && (
                <div className="bc-cost" data-brief="cost">
                  {[
                    d.wakeCost(wakeAct.wake.agent ?? d.roles.po, wakeAct.wake.low, wakeAct.wake.high),
                    wakeAct.wake.company_paused ? d.waitsCompany : wakeAct.wake.paused ? d.waitsPaused(appName(slug, app?.name, t)) : wakeAct.wake.busy ? d.afterRun(wakeAct.wake.agent ?? "") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
              {pending.action === "give_to_po" && (
                <label>
                  {d.noteForPo}
                  <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
                </label>
              )}
              <div className="bc-btns">
                <Btn ink="route" solid small disabled={props.acting} onClick={() => void runItem(item, pending.action, pending.target, pending.action === "give_to_po" && text.trim() ? { note: text.trim() } : undefined)} data={`wake-${pending.action}`}>
                  {props.acting ? d.working : `${d.wake} ${wakeAct?.wake?.agent ?? ""}`.trim()}
                </Btn>
                <Btn quiet small onClick={reset}>
                  {d.cancel}
                </Btn>
              </div>
            </div>
          ) : !ist ? (
            <p className="bc-note">{d.loading}</p>
          ) : (
            <>
              {own.length > 0 && (
                <>
                  <Lab>{c.doIt}</Lab>
                  <div className="bc-btns">
                    {own.map((a, n) => (
                      <Btn key={`${a.id}-${a.target}`} ink={INK[a.id]} solid={n === 0} kbd={n === 0 ? "⏎" : undefined} disabled={!canAct} onClick={() => press(item, a)} data={a.id}>
                        {d.verbs[a.id as DeskAction]}
                      </Btn>
                    ))}
                  </div>
                </>
              )}
              <div className="bc-duo">
                {wakes.length > 0 && (
                  <div>
                    <Lab>{c.giveIt}</Lab>
                    <div className="bc-btns">
                      {wakes.map((a) => {
                        const w = a.wake;
                        const sub = w ? (w.company_paused || w.paused ? d.paused : w.busy ? d.working : `${w.low}–${w.high} min`) : undefined;
                        return (
                          <Who
                            key={`${a.id}-${a.target}`}
                            face={a.id === "give_to_po" ? "PO" : "T"}
                            verb={d.verbs[a.id as DeskAction]}
                            name={w?.agent ?? (a.id === "give_to_po" ? d.roles.po : d.roles.taller)}
                            sub={sub}
                            disabled={!canAct}
                            onClick={() => {
                              setText("");
                              setPending({ kind: "wake", action: a.id, target: a.target });
                            }}
                            data={a.id}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
                {(later || dismiss) && (
                  <div>
                    <Lab>{c.keepIt}</Lab>
                    <div className="bc-btns">
                      {later && (
                        <Btn ink="wait" quiet kbd="L" disabled={!canAct} onClick={() => void runItem(item, "later", null)} data="later">
                          {d.later}
                        </Btn>
                      )}
                      {dismiss && (
                        <Btn ink="no" quiet kbd="X" disabled={!canAct} onClick={() => void runItem(item, "dismiss", null)} data="dismiss">
                          {d.notRelevant}
                        </Btn>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {!own.length && !wakes.length && !later && !dismiss && <p className="bc-note">{d.none}</p>}
            </>
          )}
        </div>
      </>
    );
  }

  function ideaFicha(cd: Extract<CityCard, { kind: "idea" }>, s: ReturnType<typeof stampOf>, stamp: ReactNode) {
    const idea = cd.idea;
    const ist = state?.ideas?.[cd.id];
    const flags = (idea.flags ?? []).map((f) => parseFlag(f)).filter((f): f is NonNullable<ReturnType<typeof parseFlag>> => !!f);
    const paused = !!ist?.paused;
    const po = `${d.roles.po}${slug !== CROSS ? ` ${name}` : ""}`;
    const people: { action: "sketch" | "research" | "plan"; face: string; verb: string; who: string }[] = [
      { action: "sketch", face: "A", verb: d.idea.sketch, who: d.roles.artist },
      { action: "research", face: "R", verb: d.idea.research, who: d.roles.research },
      { action: "plan", face: "PO", verb: d.idea.plan, who: po },
    ];
    return (
      <>
        {head(`${c.newIdea} · ${idea.code}`, cd)}
        {stamp}
        <h3>{idea.title}</h3>
        <p className="bc-f-d">{idea.why}</p>
        {(flags.length > 0 || !!idea.seen) && (
          <div className="bc-flags">
            {flags.map((f) => (
              <span key={f.key + (f.ref ?? "")}>{f.key === "overlap" ? t.flags.overlap(f.ref ?? "") : t.flags[f.key]}</span>
            ))}
            {idea.seen ? <span>{d.idea.seen(idea.seen)}</span> : null}
          </div>
        )}
        <div className="bc-you">
          {s ? (
            done(cd, s)
          ) : readOnly ? (
            <p className="bc-note">{d.readOnly}</p>
          ) : pending?.kind === "failed" ? (
            failedBox(() => void runIdea(cd, pending.action as IdeaAction, pending.input))
          ) : pending?.kind === "discard" ? (
            <div className="bc-ask bc-stop" data-brief="discard">
              <p>
                <b>{d.idea.why}</b> {d.idea.discardHint}.
              </p>
              <div className="bc-btns">
                {DISCARD_REASONS.map((r) => (
                  <Btn key={r} ink="stop" small disabled={props.acting} onClick={() => void runIdea(cd, "discard", { reason: r })} data={`reason-${r}`}>
                    {d.idea.reasons[r]}
                  </Btn>
                ))}
                <Btn quiet small onClick={reset}>
                  {d.cancel}
                </Btn>
              </div>
            </div>
          ) : pending?.kind === "idea-wake" ? (
            (() => {
              const action = pending.action;
              const plan = action === "plan" ? props.ideaCost(new Set([cd.id])) : null;
              const role = action === "plan" ? po : action === "sketch" ? d.roles.artist : d.roles.research;
              const cost = plan ? d.ideaCost(plan.bots, plan.low, plan.high) : d.wakeCost(role, 10, 20);
              return (
                <div className="bc-ask bc-route" data-brief="wake">
                  <p>
                    <b>{d.idea[action]}</b>: {idea.title}
                  </p>
                  <div className="bc-cost" data-brief="cost">
                    {[cost, paused ? d.waitsPaused(name) : null].filter(Boolean).join(" · ")}
                  </div>
                  <div className="bc-btns">
                    <Btn ink="route" solid small disabled={props.acting} onClick={() => void runIdea(cd, action)} data={`wake-${action}`}>
                      {props.acting ? d.working : `${d.wake} ${role}`}
                    </Btn>
                    <Btn quiet small onClick={reset}>
                      {d.cancel}
                    </Btn>
                  </div>
                </div>
              );
            })()
          ) : (
            <>
              <Lab>{c.doIt}</Lab>
              <div className="bc-btns">
                <Btn ink="go" solid kbd="⏎" disabled={!canAct} onClick={() => void runIdea(cd, "keep")} data="keep">
                  {d.idea.keep}
                </Btn>
                <Btn ink="stop" kbd="X" disabled={!canAct} onClick={() => setPending({ kind: "discard" })} data="discard">
                  {d.idea.discard}
                </Btn>
              </div>
              <Lab>{c.giveIdea}</Lab>
              <div className="bc-btns">
                {people.map((p) => (
                  <Who key={p.action} face={p.face} verb={p.verb} name={p.who} sub={paused ? d.paused : "10–20 min"} disabled={!canAct} onClick={() => setPending({ kind: "idea-wake", action: p.action })} data={p.action} />
                ))}
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  function motionFicha(m: IdeaInMotion) {
    const at = stageIndex(m.stage);
    const doc = safeUrl(m.doc_url ?? undefined);
    return (
      <>
        {head(c.ideaInPlania, undefined, m.key)}
        <h3>{m.title}</h3>
        <div className="bc-track" role="list" aria-label={c.stage} data-brief="stage">
          {STAGES.map((s, i) => (
            <span key={s} role="listitem" data-on={i <= at || undefined} aria-current={i === at ? "step" : undefined}>
              {c.stages[s]}
            </span>
          ))}
        </div>
        <div className="bc-ev" data-brief="evidence">
          <div className="bc-eh">
            <i />
            {c.readNow}
          </div>
          <div className="bc-r">
            <span>{c.status.idea}</span>
            <span>
              {m.key} · {c.isOpen} · {c.stages[(m.stage ?? "idea") as keyof typeof c.stages] ?? m.stage}
            </span>
          </div>
          <div className="bc-r">
            <span>{c.doc}</span>
            <span>{[c.status.idea, m.research ? c.stages.research : null, m.sketch ? c.sketchLink : null].filter(Boolean).join(" · ")}</span>
          </div>
          {m.promoted_to && (
            <div className="bc-r">
              <span>{c.isPlanned}</span>
              <span>{m.promoted_to}</span>
            </div>
          )}
        </div>
        <div className="bc-links">
          <button type="button" onClick={() => setSheet({ slug: m.project, key: m.key })} data-see={m.key}>
            {c.readDocs}
          </button>
          {doc && (
            <a href={doc} target="_blank" rel="noopener noreferrer">
              {c.sketchLink} ↗
            </a>
          )}
        </div>
        <div className="bc-you">
          <p className="bc-note">{m.promoted_to ? c.plannedNote : c.inPlaniaNote}</p>
        </div>
      </>
    );
  }
}

// ---- pieces outside the page's state

function Count({ tone, n }: { tone: string; n: number }) {
  return (
    <span>
      <i className="bc-dot" data-t={tone} />
      {n}
    </span>
  );
}

function Empty({ t }: { t: BriefLabels }) {
  return (
    <div className="bc-empty" data-brief="empty-hand">
      <h3>{t.c.emptyHand}</h3>
    </div>
  );
}

function CardButton({ cd, current, st, idea, local, t, language, onPick }: { cd: CityCard; current: boolean; st: ItemState | undefined; idea?: IdeaCardState; local?: Local; t: BriefLabels; language: BriefLanguage; onPick: () => void }) {
  const d = t.d;
  const c = t.c;
  const handled = !cd.open;
  let word: string | null = null;
  let ink: Ink = "go";
  if (handled) {
    if (cd.kind === "item") {
      word = local?.word ?? (st?.action ? d.stamps[st.action as DeskAction] : st?.state === "dismissed" ? d.stamps.dismiss : st?.state === "later" ? d.stamps.later : "✓");
      ink = local?.ink ?? (st?.action ? INK[st.action] : st?.state === "dismissed" ? "no" : st?.state === "later" ? "wait" : "go");
    } else {
      const fate = idea?.state && idea.state !== "open" ? idea.state : "planned";
      word = local?.word ?? d.idea.fate[fate] ?? fate;
      ink = local?.ink ?? (fate === "discarded" ? "stop" : fate === "kept" ? "go" : "route");
    }
  }
  const at = cd.kind === "item" ? (st?.at ?? local?.at) : (idea?.at ?? local?.at);
  const tone = cd.kind === "idea" ? "review" : cd.item.status === "blocker" ? "blocked" : cd.item.status === "needs_you" ? "jorge" : "ready";
  return (
    <button type="button" className="bc-c" aria-current={current || undefined} data-done={handled || undefined} data-idea={cd.kind === "idea" || undefined} onClick={onPick} data-card={cd.id}>
      <span className="bc-c-k">
        <i className="bc-dot" data-t={handled ? "lit" : tone} />
        <span>{cd.kind === "idea" ? `${c.status.idea} ${cd.idea.code}` : `${c.status[cd.item.status]} · ${kindLabel(cd.item, st, language)}`}</span>
      </span>
      <span className="bc-c-t">{cd.kind === "item" ? cd.item.title : cd.idea.title}</span>
      {handled && word ? (
        <span className={`bc-tag bc-${ink}`}>
          {word}
          {at ? ` · ${hhmm(at, language)}` : ""}
        </span>
      ) : (
        <span className="bc-c-d">{cd.kind === "item" ? (cd.item.detail ?? cd.item.ref ?? "") : cd.idea.why}</span>
      )}
    </button>
  );
}

/** The lines under the sky: a failed refresh (with the fix over the page), the API down, a past day, a missing part. */
function Lines(props: CityProps & { t: BriefLabels; pop: Pop; setPop: (p: Pop) => void }) {
  const { t, data, language } = props;
  const c = t.c;
  const d = t.d;
  const lr = props.lastRun;
  const missing = missingPart(data);
  const out: ReactNode[] = [];
  if (lr && !props.date) {
    const steps = lr.kind === "auth" ? c.fixAuth : c.fixOther;
    out.push(
      <div key="lr" className="bc-alert" role="status" data-brief="last-run">
        <p>
          <b>{c.failedAt(hhmm(lr.ended_at, language, data.timezone))}</b> {lr.kind === "auth" ? c.authReason : lr.reason} {c.stillShowing(hhmm(data.generatedAt, language, data.timezone))}
        </p>
        <span className="relative">
          <button type="button" className="bc-ghost" aria-expanded={props.pop === "fix"} onClick={() => props.setPop(props.pop === "fix" ? null : "fix")} data-brief="how-to-fix">
            {props.pop === "fix" ? c.hide : c.howToFix}
          </button>
          {props.pop === "fix" && (
            <div className="bc-fixpop" data-brief="fix-steps">
              <ol>
                {steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          )}
        </span>
        <button type="button" className="bc-ghost" disabled={!!props.run || props.generating || !props.canGenerate} onClick={() => props.onGenerate()} data-brief="retry-run">
          {d.retry}
        </button>
      </div>,
    );
  }
  if (props.banner === "refresh-failed")
    out.push(
      <div key="rf" className="bc-alert" role="status" data-brief="refresh-failed">
        <p>{t.refreshFailed}</p>
        <button type="button" className="bc-ghost" onClick={props.onRetry}>
          {d.retry}
        </button>
      </div>,
    );
  if (props.banner === "past")
    out.push(
      <div key="past" className="bc-alert bc-alert-q" role="status" data-brief="past">
        <p>
          <b>{d.readOnly}</b>
        </p>
        <button type="button" className="bc-ghost" onClick={() => props.onDate(null)} data-brief="back-today">
          {d.backToday}
        </button>
      </div>,
    );
  if (missing && !props.banner)
    out.push(
      <div key="miss" className="bc-alert bc-alert-q" role="status" data-brief="missing">
        <p>{c.partial[missing]}</p>
      </div>,
    );
  return out.length ? <>{out}</> : null;
}

// ---- pure helpers (exported for tests)

/** The Plania key a row's "Ver <KEY> aquí" opens, and its project. */
export function targetKey(tg: Target | undefined, l: ItemState["live"] | undefined): { project: string; key: string } | null {
  if (!tg) return null;
  const liveKey = l && "key" in l && typeof l.key === "string" ? l.key : l?.kind === "pr" ? l.ticket?.key : undefined;
  const key = tg.key ?? liveKey;
  return key ? { project: tg.project, key } : null;
}

/** The state with this visit's handled cards laid over it, so a card leaves at once. */
export function mergeLocal(state: BriefStateReply | undefined, local: Record<string, Local>): BriefStateReply | undefined {
  if (!state || !Object.keys(local).length) return state;
  const items = { ...state.items };
  const ideas = { ...(state.ideas ?? {}) };
  for (const [id, l] of Object.entries(local)) {
    if (id.startsWith("d|")) {
      const was = ideas[id];
      if (!was || was.state === "open") ideas[id] = { state: l.fate ?? "kept", line: l.line ?? null, key: null, action_id: l.actionId, undo: l.undo, at: l.at, project: was?.project ?? "", paused: was?.paused ?? false };
    } else {
      const was = items[id];
      if (was && was.state === "open") items[id] = { ...was, state: l.action === "later" ? "later" : l.action === "dismiss" ? "dismissed" : "handled", line: l.line ?? was.line, action_id: l.actionId, undo: l.undo, at: l.at, action: l.action ?? null };
    }
  }
  return { ...state, items, ideas };
}

export type HandledRow = { id: string; title: string; app: string; word: string; ink: Ink; at: string | null; undo: boolean; actionId: string | null };

/** Rows and ideas no longer open, newest first: "N resueltos hoy" and Z. */
export function handledList(list: Station[], state: BriefStateReply | undefined, t: BriefLabels, _language: BriefLanguage): HandledRow[] {
  const d = t.d;
  const out: HandledRow[] = [];
  for (const s of list) {
    const app = appName(s.slug, s.app.name, t);
    for (const x of s.items) {
      const st = state?.items[x.id];
      if (!st || st.state === "open") continue;
      out.push({
        id: x.id,
        title: x.item.title,
        app,
        word: st.action ? d.stamps[st.action as DeskAction] : st.state === "dismissed" ? d.stamps.dismiss : st.state === "later" ? d.stamps.later : "✓",
        ink: st.action ? INK[st.action] : st.state === "dismissed" ? "no" : st.state === "later" ? "wait" : "go",
        at: st.at ?? null,
        undo: st.undo,
        actionId: st.action_id,
      });
    }
    for (const x of s.ideas) {
      const st = state?.ideas?.[x.id];
      if (x.open || !st || st.state === "open") continue;
      out.push({ id: x.id, title: x.idea.title, app, word: d.idea.fate[st.state] ?? st.state, ink: st.state === "discarded" ? "stop" : st.state === "kept" ? "go" : "route", at: st.at, undo: st.undo, actionId: st.action_id });
    }
  }
  return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}
