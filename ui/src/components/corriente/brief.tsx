// PLA-I63: the Morning brief as a Compañía place (/ceo?v=brief), drawn in La corriente's look (PLA-IDEA26, sketch 2).
// The data, the passes and the API are the brief's own (lib/brief.ts, /api/brief/*); only the drawing is new.
// I63-1: the address, the page, the date line and headline, its tools (Generar ahora with the three passes, Días
// anteriores, Ajustes) and the states with no brief on screen. I63-2: the delta (brief-delta.tsx), the light in hand,
// J K and the arrows. I63-3: the card in hand (brief-card.tsx) with its evidence and every action, Enter L X Z, and
// what was settled dropping into the river at once (with Deshacer on the card and in the footer). I63-4: the states and
// edges: a failed run (the brief stays, the reason and «Cómo arreglarlo»), a refresh that failed, a missing part, all
// settled, and the phone (under 640px: no curves, a list per project with the card under the chosen light).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { BriefSettingsSheet } from "@/components/brief/brief-settings";
import { ApiError } from "@/lib/api";
import { BRIEF_LABELS } from "@/lib/brief-i18n";
import { type BriefHistoryRow, type BriefLanguage, type BriefLastRun, type BriefPass, type BriefStateReply, type PlanIdeaProgress, planCost, runMinutes, useBriefAct, useBriefByDate, useBriefHistory, useBriefLatest, useBriefSettings, useBriefState, usePlanProgress, useRunBrief } from "@/lib/brief";
import { keyCommand, missingPart, stations, type CityCard, type Station } from "@/lib/brief-city";
import { dayLine, hhmm, deltaOf, firstLight, headlineOf, hopStream, kickOf, mergeLocal, nextAfter, noBriefHeadline, stepLight, type Delta, type Headline, type Light, type Local } from "@/lib/brief-delta";
import { linkTo } from "@/lib/corriente";
import { BriefCard, EmptyHand, stampOf, type CardKeys } from "./brief-card";
import { BriefDelta, BriefPhone, useStage } from "./brief-delta";
import { Btn } from "./parts";
import { corLabels } from "@/lib/brief-i18n";
import { words } from "@/lib/i18n";
import { BRIEF_PAGE_WORDS } from "@/lib/brief-words";

export type BriefEmptyKind = "loading" | "empty" | "off" | "failed";

// ---- the tools: Generar ahora (three passes), Días anteriores, Ajustes

/** A button with a small menu under it; Esc and a click outside close it. */
function MenuButton({ label, open, onOpen, disabled, primary, data, children }: { label: string; open: boolean; onOpen: (open: boolean) => void; disabled?: boolean; primary?: boolean; data: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpen(false);
      }
    };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", click);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, onOpen]);
  return (
    <div className="cor-menu" ref={ref}>
      <Btn kind={primary ? "primary" : "secondary"} small disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => onOpen(!open)} data-brief={data}>
        {label}
      </Btn>
      {open && !disabled && (
        <div className="cor-menu-list down right cor-bf-menu" role="menu" data-brief={`${data}-menu`}>
          {children}
        </div>
      )}
    </div>
  );
}

export type ToolsProps = {
  language: BriefLanguage;
  genLabel: string;
  canGenerate: boolean;
  /** No brief yet: Generar ahora is the page's one white button. */
  genPrimary: boolean;
  onGenerate: (passes?: BriefPass[]) => void;
  history: BriefHistoryRow[];
  todayDate: string | null;
  date: string | null;
  onDate: (date: string | null) => void;
  onSettings: () => void;
  /** For tests: a menu open from the start. */
  initialMenu?: "gen" | "dias" | null;
};

export function BriefTools(p: ToolsProps) {
  const c = BRIEF_LABELS[p.language].c;
  const w = words(BRIEF_PAGE_WORDS, p.language);
  const [menu, setMenu] = useState<"gen" | "dias" | null>(p.initialMenu ?? null);
  const days = p.history.filter((h) => h.local_date !== p.todayDate).slice(0, 14);
  const passes: [string, [string, string], BriefPass[] | undefined][] = [
    ["both", c.genBoth, undefined],
    ["brief", c.genBrief, ["brief"]],
    ["ideas", c.genIdeas, ["ideas"]],
  ];
  return (
    <div className="cor-bf-tools" data-brief="tools">
      {p.date && (
        <Btn kind="secondary" small onClick={() => p.onDate(null)} data-brief="back-today">
          {w.backToday}
        </Btn>
      )}
      <MenuButton label={p.genLabel} open={menu === "gen"} onOpen={(o) => setMenu(o ? "gen" : null)} disabled={!p.canGenerate || !!p.date} primary={p.genPrimary} data="generate">
        <p className="cor-bf-menu-h">{c.genMenu}</p>
        {passes.map(([k, [label, time], ps]) => (
          <button
            key={k}
            type="button"
            role="menuitem"
            className="cor-bf-mi"
            onClick={() => {
              setMenu(null);
              p.onGenerate(ps);
            }}
            data-gen={k}
          >
            <b>{label}</b>
            <small>{time}</small>
          </button>
        ))}
      </MenuButton>
      <MenuButton label={w.days} open={menu === "dias"} onOpen={(o) => setMenu(o ? "dias" : null)} data="days">
        <p className="cor-bf-menu-h">{w.daysMenu}</p>
        {p.date && (
          <button type="button" role="menuitem" className="cor-bf-mi" onClick={() => (setMenu(null), p.onDate(null))} data-dia="hoy">
            <b>{w.today}</b>
            <small>{w.backToTodays}</small>
          </button>
        )}
        {days.length === 0 && <p className="cor-bf-menu-none">{w.noDays}</p>}
        {days.map((h) => {
          const l = dayLine(h, p.language);
          return (
            <button key={h.local_date} type="button" role="menuitem" className="cor-bf-mi" aria-current={p.date === h.local_date || undefined} onClick={() => (setMenu(null), p.onDate(h.local_date))} data-dia={h.local_date}>
              <b>{l.day}</b>
              <small>{l.line}</small>
            </button>
          );
        })}
      </MenuButton>
      <Btn kind="quiet" small onClick={p.onSettings} data-brief="settings">
        {w.settings}
      </Btn>
    </div>
  );
}

// ---- the page's frame: date line, headline, tools; the delta, the card and the footer come as parts

export type BriefViewProps = {
  kick: string;
  /** The kick shows the live light while a run goes. */
  live: boolean;
  headline: Headline;
  tools: ReactNode;
  state: BriefEmptyKind | "brief";
  /** The delta (I63-2). */
  delta?: ReactNode;
  /** The card in hand (I63-3). */
  card?: ReactNode;
  /** A line over the footer's left side (a failed run, a missing part) or the keys. */
  footLeft?: ReactNode;
  footRight?: ReactNode;
  onRetry?: () => void;
  /** Under 640px: the delta is a list and the card rides inside it. */
  phone?: boolean;
};

export function BriefView(p: BriefViewProps) {
  const w = words(BRIEF_PAGE_WORDS);
  return (
    <div className={`cor-bf${p.phone ? " phone" : ""}`} data-brief-state={p.state} aria-busy={p.state === "loading" || undefined}>
      <div className="cor-bf-main">
        {!p.phone && p.delta}
        <div className="cor-bf-hero">
          <span className="cor-bf-kick" data-brief="kick">
            {p.live && <span className="cor-live" aria-hidden />}
            {p.kick}
          </span>
          <h1 className="cor-bf-h1" data-brief="headline">
            <span>{p.headline.l1}</span>
            {p.headline.l2 && <span className={p.headline.tone}>{p.headline.l2}</span>}
          </h1>
        </div>
        <div className="cor-bf-rt">
          {p.tools}
          {p.phone ? p.state !== "brief" && <EmptyHand state={p.state} onRetry={p.onRetry} /> : (p.card ?? <EmptyHand state={p.state} onRetry={p.onRetry} />)}
        </div>
        {p.phone && p.delta}
      </div>
      <footer className="cor-bf-foot">
        <span className="cor-bf-foot-l">{p.footLeft ?? (p.state === "brief" ? w.keys : null)}</span>
        {!p.footLeft || p.footRight ? <span className="cor-bf-foot-r">{p.footRight ?? (p.state === "brief" ? w.footBrief : w.footEmpty)}</span> : null}
      </footer>
    </div>
  );
}

// ---- I63-4: the footer's notices (a failed run, a refresh that failed, a missing part)

export type NoticeProps = { language: BriefLanguage; lastRun: BriefLastRun | null; refreshFailed: boolean; missing: ReturnType<typeof missingPart>; generatedAt: string | null; timeZone?: string; canRetry: boolean; onRetryRun: () => void; onRefresh: () => void; initialFix?: boolean };

export function BriefNotice(p: NoticeProps) {
  const c = corLabels(p.language).c;
  const w = words(BRIEF_PAGE_WORDS, p.language);
  const [fix, setFix] = useState(!!p.initialFix);
  if (p.lastRun) {
    const steps = p.lastRun.kind === "auth" ? c.fixAuth : c.fixOther;
    const why = p.lastRun.kind === "auth" ? c.authReason : p.lastRun.reason;
    return (
      <div className="cor-bf-notice bad" role="status" data-brief="last-run">
        <span className="cor-bf-notice-t" title={`${c.failedAt(hhmm(p.lastRun.ended_at, p.timeZone))} ${why}`}>
          <b>{c.failedAt(hhmm(p.lastRun.ended_at, p.timeZone))}</b> {why} {p.generatedAt ? c.stillShowing(hhmm(p.generatedAt, p.timeZone)) : ""}
        </span>
        <span className="cor-bf-notice-b">
          <Btn kind="link" small aria-expanded={fix} onClick={() => setFix(!fix)} data-brief="how-to-fix">
            {fix ? c.hide : c.howToFix}
          </Btn>
          <Btn kind="link" small disabled={!p.canRetry} onClick={p.onRetryRun} data-brief="retry-run">
            {w.retry}
          </Btn>
        </span>
        {fix && (
          <ol className="cor-bf-fix" data-brief="fix-steps">
            {steps.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
        )}
      </div>
    );
  }
  if (p.refreshFailed)
    return (
      <div className="cor-bf-notice bad" role="status" data-brief="refresh-failed">
        <span className="cor-bf-notice-t">
          <b>{w.refreshFailed}</b> {w.stillShowing}
        </span>
        <Btn kind="link" small onClick={p.onRefresh} data-brief="refresh">
          {w.retry}
        </Btn>
      </div>
    );
  if (p.missing)
    return (
      <div className="cor-bf-notice" role="status" data-brief="missing">
        <span className="cor-bf-notice-t">{c.partial[p.missing]}</span>
      </div>
    );
  return null;
}

/** Under 640px the page is a phone (as the rest of Compañía). */
export function useNarrow(): boolean {
  const q = "(max-width: 639px)";
  const [on, setOn] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const f = () => setOn(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return on;
}

// ---- the container: the brief's hooks, as the old /brief page used them

/** PLA-I63-5: the Brief tab's count: open blockers and «te toca» in today's brief (the same reads as the page). */
export function useBriefToca(): number {
  const latest = useBriefLatest();
  const settings = useBriefSettings();
  const b = latest.data?.brief ?? null;
  const rows = useBriefState(b?.id ?? null);
  return useMemo(() => {
    if (!b) return 0;
    const st = rows.data && rows.data.brief_id === b.id ? rows.data : undefined;
    const list = stations(b.data, st, { checks: latest.data?.checks ?? [], maxItems: settings.data?.settings.max_items_per_app });
    return list.reduce((n, s) => n + s.counts.blocked + s.counts.needs, 0);
  }, [b, rows.data, latest.data?.checks, settings.data?.settings.max_items_per_app]);
}

/** ?dia=YYYY-MM-DD opens an earlier day, read-only. */
export function diaOf(search: string): string | null {
  const v = new URLSearchParams(search).get("dia");
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function BriefPlace({ now, timeZone }: { now: number; timeZone: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const latest = useBriefLatest();
  const settings = useBriefSettings();
  const history = useBriefHistory(15);
  const run = useRunBrief();
  const date = diaOf(location.search);
  const past = useBriefByDate(date);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const shown = date ? past.data : latest.data;
  const stored = shown?.brief ?? null;
  const data = stored?.data;
  const language: BriefLanguage = data?.language ?? latest.data?.brief?.data.language ?? settings.data?.settings.language ?? "es";
  const enabled = settings.data?.settings.enabled ?? true;
  const runAt = settings.data?.settings.run_at ?? "07:00";
  const tz = data?.timezone ?? timeZone;
  const live = latest.data?.run ?? null;
  const generating = !date && (!!live || run.isPending);
  const w = words(BRIEF_PAGE_WORDS, language);

  const setDate = (d: string | null) => {
    const q = new URLSearchParams(location.search);
    if (d) q.set("dia", d);
    else q.delete("dia");
    navigate(`${location.pathname}?${q.toString()}`, { replace: true });
  };
  const generate = (passes?: BriefPass[]) =>
    run.mutate(passes, {
      onError: (e) => {
        if (e instanceof ApiError && e.code === "BRIEF_RUNNING") return;
        toast.error(e instanceof ApiError ? w.genFailedCode(e.code) : w.genFailed);
      },
    });

  let state: BriefEmptyKind | "brief" = "brief";
  if (!data) {
    if (!enabled && !date) state = "off";
    else if ((date ? past.isError : latest.isError) && !shown) state = "failed";
    else if (!date && latest.isSuccess && !latest.data.brief) state = "empty";
    else state = "loading";
  }

  const genLabel = live?.waiting_for_build ? w.waitingBuild : generating ? (live ? w.generatingMin(runMinutes(live.started_at, now)) : w.generating) : w.generate;
  const kick = date
    ? kickOf({ kind: "past", localDate: date }, language)
    : generating
      ? kickOf({ kind: "generating", minutes: live ? runMinutes(live.started_at, now) : 1, waitingBuild: live?.waiting_for_build, generatedAt: data?.generatedAt ?? null, timeZone: tz }, language)
      : data
        ? kickOf({ kind: "today", generatedAt: data.generatedAt, timeZone: tz }, language)
        : kickOf({ kind: "none", now, timeZone }, language);

  // The rows' live state (and Send to Plania's progress for today's ideas), as the old page read them.
  const briefId = stored?.id ?? null;
  const rows = useBriefState(briefId);
  const planId = date ? null : latest.data?.brief?.id === briefId ? (latest.data?.plan_id ?? null) : null;
  const progress = usePlanProgress(planId);
  const sentCodes = useMemo(() => new Set(progress.data && progress.data.brief_id === briefId ? progress.data.ideas.map((x) => x.code) : []), [progress.data, briefId]);
  const server = rows.data && rows.data.brief_id === briefId ? rows.data : undefined;
  const acts = useBriefAct(briefId);
  // What was settled in this visit, laid over the server's state until its poll catches up; reset with the brief.
  const [localBy, setLocalBy] = useState<{ id: string | null; local: Record<string, Local> }>({ id: null, local: {} });
  const local = localBy.id === briefId ? localBy.local : {};
  const setLocal = (f: (l: Record<string, Local>) => Record<string, Local>) => setLocalBy((x) => ({ id: briefId, local: f(x.id === briefId ? x.local : {}) }));
  const live_ = useMemo(() => mergeLocal(server, local), [server, local]);
  const readOnly = !!date || !!server?.read_only;
  const plans = useMemo(() => new Map<string, PlanIdeaProgress>((progress.data && progress.data.brief_id === briefId ? progress.data.ideas : []).map((x) => [x.code, x])), [progress.data, briefId]);
  const list = useMemo(() => (data ? stations(data, live_, { checks: shown?.checks ?? [], sentCodes, maxItems: settings.data?.settings.max_items_per_app }) : []), [data, live_, shown?.checks, sentCodes, settings.data?.settings.max_items_per_app]);
  const [stageRef, size] = useStage();
  // The phone wraps its rows, so its labels follow the full stage's rule (not the phone's width).
  const phone = useNarrow();
  const sw = phone ? 1440 : size.w;
  const h = phone ? 650 : size.h;
  const delta = useMemo(() => deltaOf({ list, w: sw, h, states: live_?.items, settled: settledOrder(live_), language }), [list, sw, h, live_, language]);
  const [picked, setPicked] = useState<string | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const cardKeys = useRef<CardKeys | null>(null);
  const all = useMemo(() => [...delta.streams.flatMap((x) => x.lights), ...delta.river], [delta]);
  const clear = delta.counts.total > 0 && delta.counts.done === delta.counts.total;
  const selected = picked && all.some((l) => l.id === picked) ? picked : clear ? null : firstLight(delta);
  const light = all.find((l) => l.id === selected) ?? null;

  const t = corLabels(language);
  // The settled lights that can come back, newest first (Z and the footer's Deshacer).
  const undoable = useMemo(() => {
    const out: { id: string; actionId: string; word: string; title: string; at: string }[] = [];
    for (const st of list)
      for (const cd of [...st.items, ...st.ideas]) {
        if (cd.open) continue;
        const s = stampOf(cd, live_, local[cd.id], t, language);
        if (s?.undo && s.actionId) out.push({ id: cd.id, actionId: s.actionId, word: s.word, title: cd.kind === "item" ? (cd.item.ref || cd.item.title) : cd.idea.title, at: s.at ?? "" });
      }
    return out.sort((a, b) => (a.id === last ? -1 : b.id === last ? 1 : b.at.localeCompare(a.at)));
  }, [list, live_, local, last, t, language]);
  const onHandled = (cd: CityCard, l: Local) => {
    setLocal((x) => ({ ...x, [cd.id]: l }));
    setLast(cd.id);
    setArrived(cd.id);
    setTimeout(() => setArrived((a) => (a === cd.id ? null : a)), 900);
    setPicked(nextAfter(delta, cd.id) ?? cd.id);
  };
  const onUndo = async (actionId: string, itemId: string) => {
    try {
      await acts.undo.mutateAsync({ actionId, itemId });
      setLocal((x) => {
        const n = { ...x };
        delete n[itemId];
        return n;
      });
      if (last === itemId) setLast(null);
      setPicked(itemId);
    } catch {
      toast.error(`${t.d.failed}. ${t.d.nothingChanged}`);
    }
  };

  // Keys: J K and ↑ ↓ walk the lights, ← → hop streams, Enter the card's white button, L Después, X No aplica,
  // Z Deshacer, Esc closes what the card has open. Nothing acts while typing in a field.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (document.querySelector("[role=dialog]")) return;
    const cmd = keyCommand({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLElement | null });
    if (!cmd) return;
    if (cmd === "primary" || cmd === "later" || cmd === "dismiss" || cmd === "escape") {
      if (cardKeys.current?.(cmd)) e.preventDefault();
      return;
    }
    if (cmd === "undo") {
      const u = undoable[0];
      if (u && !readOnly) {
        e.preventDefault();
        void onUndo(u.actionId, u.id);
      }
      return;
    }
    if (cmd === "next" || cmd === "prev") {
      e.preventDefault();
      setPicked(stepLight(delta, selected, cmd === "next" ? 1 : -1));
    } else if (cmd === "nextProject" || cmd === "prevProject") {
      e.preventDefault();
      setPicked(hopStream(delta, selected, cmd === "nextProject" ? 1 : -1));
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const headline: Headline = data ? headlineOf({ total: delta.counts.total, open: delta.counts.total - delta.counts.done, blocked: delta.counts.blocked, needs: delta.counts.needs }, runAt, language) : noBriefHeadline(state === "brief" ? "loading" : state, runAt, language);
  const walk = useMemo(() => [...delta.streams.flatMap((x) => x.lights), ...delta.river].map((l) => l.id), [delta]);
  const streamOf = (l: Light | null): Station | undefined => (l ? list.find((st) => st.items.some((x) => x.id === l.id) || st.ideas.some((x) => x.id === l.id)) : undefined);
  const allClear = delta.counts.total > 0 && delta.counts.done === delta.counts.total;
  const card = data ? (
    allClear && !picked ? (
      <EmptyHand state="brief" language={language} line={t.c.clearLine(delta.counts.done, runAt)} />
    ) : (
    <BriefCard
      light={light}
      station={streamOf(light)}
      data={data}
      state={live_}
      local={local}
      language={language}
      readOnly={readOnly}
      acting={acts.act.isPending || acts.undo.isPending}
      position={light ? [walk.indexOf(light.id) + 1, walk.length] : null}
      onStep={(d) => setPicked(stepLight(delta, selected, d))}
      onAct={(body) => acts.act.mutateAsync({ ...body, brief_id: briefId! })}
      onHandled={onHandled}
      onUndo={onUndo}
      ideaCost={(ids) => planCost(data, ids, latest.data?.home_project ?? null)}
      plans={plans}
      links={{ paso: (slug, key) => linkTo({ slug, ver: { kind: "paso", key } }), idea: (slug, key) => linkTo({ slug, ver: { kind: "idea", key } }) }}
      keys={cardKeys}
      runAt={runAt}
    />
    )
  ) : undefined;
  const notice = data ? (
    <BriefNotice
      language={language}
      lastRun={date ? null : (latest.data?.last_run ?? null)}
      refreshFailed={!date && latest.isError && !!latest.data}
      missing={missingPart(data)}
      generatedAt={data.generatedAt}
      timeZone={tz}
      canRetry={enabled && !generating}
      onRetryRun={() => generate()}
      onRefresh={() => void latest.refetch()}
    />
  ) : null;
  const hasNotice = !!data && (!!(!date && latest.data?.last_run) || (!date && latest.isError && !!latest.data) || !!missingPart(data));
  const lastUndo = !readOnly && last ? undoable.find((u) => u.id === last) : undefined;
  const footRight = lastUndo ? (
    <span className="cor-bf-undo" data-brief="last">
      {lastUndo.word}: {lastUndo.title}
      <Btn kind="link" small onClick={() => void onUndo(lastUndo.actionId, lastUndo.id)} data-undo-last={lastUndo.id}>
        {w.undo}
      </Btn>
    </span>
  ) : undefined;
  const tools = (
    <BriefTools
      language={language}
      genLabel={genLabel}
      canGenerate={enabled && !generating}
      genPrimary={state === "empty"}
      onGenerate={generate}
      history={history.data ?? []}
      todayDate={latest.data?.brief?.local_date ?? null}
      date={date}
      onDate={setDate}
      onSettings={() => setSettingsOpen(true)}
    />
  );

  return (
    <>
      <BriefSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} language={language} />
      <BriefView
        kick={kick}
        live={generating}
        headline={headline}
        tools={tools}
        state={state}
        onRetry={() => void (date ? past.refetch() : latest.refetch())}
        delta={
          data ? (
            phone ? (
              <BriefPhone delta={delta} selected={selected} onPick={setPicked} card={card} />
            ) : (
              <BriefDelta delta={delta} selected={selected} onPick={setPicked} inHand={!!light?.card.open} arrived={arrived} stageRef={stageRef} />
            )
          ) : (
            <div className="cor-bf-delta" ref={stageRef} aria-hidden />
          )
        }
        card={card}
        phone={phone}
        footLeft={hasNotice ? notice : undefined}
        footRight={footRight}
      />
    </>
  );
}

/** The river's order: settled rows and ideas by the time they were settled. */
export function settledOrder(st: BriefStateReply | undefined): string[] {
  if (!st) return [];
  const xs: [string, string][] = [];
  for (const [id, v] of Object.entries(st.items)) if (v.state !== "open") xs.push([id, v.at ?? ""]);
  for (const [id, v] of Object.entries(st.ideas ?? {})) if (v.state !== "open") xs.push([id, v.at ?? ""]);
  return xs.sort((a, b) => a[1].localeCompare(b[1])).map(([id]) => id);
}

export type { Delta };
