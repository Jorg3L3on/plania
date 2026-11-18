// PLA-I63: the Morning brief as a Compañía place (/ceo?v=brief), drawn in La corriente's look (PLA-IDEA26, sketch 2).
// The data, the passes and the API are the brief's own (lib/brief.ts, /api/brief/*); only the drawing is new.
// I63-1: the address, the page, the date line and headline, its tools (Generar ahora with the three passes, Días
// anteriores, Ajustes) and the states with no brief on screen. I63-2: the delta (brief-delta.tsx), the light in hand,
// J K and the arrows. The card in hand's evidence and actions come in I63-3.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { BriefSettingsSheet } from "@/components/brief/brief-settings";
import { ApiError } from "@/lib/api";
import { BRIEF_LABELS } from "@/lib/brief-i18n";
import { CROSS, type BriefHistoryRow, type BriefLanguage, type BriefPass, type BriefStateReply, runMinutes, useBriefByDate, useBriefHistory, useBriefLatest, useBriefSettings, useBriefState, usePlanProgress, useRunBrief } from "@/lib/brief";
import { keyCommand, stations, type Station } from "@/lib/brief-city";
import { dayLine, deltaOf, firstLight, headlineOf, hopStream, kickOf, noBriefHeadline, stepLight, type Delta, type Headline, type Light } from "@/lib/brief-delta";
import { CrossMark } from "@/components/plania-mark";
import { BriefDelta, useStage } from "./brief-delta";
import { Btn, Logo } from "./parts";

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
          Volver a hoy
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
      <MenuButton label="Días anteriores" open={menu === "dias"} onOpen={(o) => setMenu(o ? "dias" : null)} data="days">
        <p className="cor-bf-menu-h">Días anteriores · solo lectura</p>
        {p.date && (
          <button type="button" role="menuitem" className="cor-bf-mi" onClick={() => (setMenu(null), p.onDate(null))} data-dia="hoy">
            <b>Hoy</b>
            <small>volver al de hoy</small>
          </button>
        )}
        {days.length === 0 && <p className="cor-bf-menu-none">Todavía no hay días anteriores.</p>}
        {days.map((h) => {
          const l = dayLine(h);
          return (
            <button key={h.local_date} type="button" role="menuitem" className="cor-bf-mi" aria-current={p.date === h.local_date || undefined} onClick={() => (setMenu(null), p.onDate(h.local_date))} data-dia={h.local_date}>
              <b>{l.day}</b>
              <small>{l.line}</small>
            </button>
          );
        })}
      </MenuButton>
      <Btn kind="quiet" small onClick={p.onSettings} data-brief="settings">
        Ajustes
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
};

export function BriefView(p: BriefViewProps) {
  return (
    <div className="cor-bf" data-brief-state={p.state} aria-busy={p.state === "loading" || undefined}>
      <div className="cor-bf-main">
        {p.delta}
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
          {p.card ?? <EmptyHand state={p.state} onRetry={p.onRetry} />}
        </div>
      </div>
      <footer className="cor-bf-foot">
        <span className="cor-bf-foot-l">{p.footLeft ?? (p.state === "brief" ? "J K mover · ← → proyecto · Enter primera acción · L después · X no aplica · Z deshacer" : null)}</span>
        <span className="cor-bf-foot-r">{p.footRight ?? (p.state === "brief" ? "pendientes e ideas completos · usa tu plan, $0" : "corre cada día a la hora de Ajustes · usa tu plan, $0")}</span>
      </footer>
    </div>
  );
}

/** The card's place when nothing is in hand: loading, no brief yet, off, could not read. */
export function EmptyHand({ state, onRetry, line }: { state: BriefEmptyKind | "brief"; onRetry?: () => void; line?: string }) {
  if (state === "loading") return <div className="cor-bf-hand cor-skel" role="status" aria-label="Leyendo el brief" data-brief="loading" />;
  const text =
    line ??
    (state === "empty"
      ? "Cuando el brief llegue, lo primero que te toca aparece aquí."
      : state === "off"
        ? "Con el brief apagado no llega nada cada mañana. Ajustes lo enciende."
        : state === "failed"
          ? "No se pudo leer el brief."
          : "");
  return (
    <section className="cor-bf-hand" aria-label="En la mano" data-brief="empty-hand">
      <h2 className="cor-h3">Nada en la mano.</h2>
      {text && <p className="cor-text">{text}</p>}
      {state === "failed" && onRetry && (
        <Btn kind="secondary" onClick={onRetry} data-brief="retry">
          Reintentar
        </Btn>
      )}
    </section>
  );
}

// ---- the container: the brief's hooks, as the old /brief page used them

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
        toast.error(e instanceof ApiError ? `No se pudo generar (${e.code}).` : "No se pudo generar. Si la Mac está dormida, intenta al despertar.");
      },
    });

  let state: BriefEmptyKind | "brief" = "brief";
  if (!data) {
    if (!enabled && !date) state = "off";
    else if ((date ? past.isError : latest.isError) && !shown) state = "failed";
    else if (!date && latest.isSuccess && !latest.data.brief) state = "empty";
    else state = "loading";
  }

  const genLabel = live?.waiting_for_build ? "Esperando la construcción" : generating ? (live ? `Generando… ${runMinutes(live.started_at, now)} min` : "Generando…") : "Generar ahora";
  const kick = date
    ? kickOf({ kind: "past", localDate: date })
    : generating
      ? kickOf({ kind: "generating", minutes: live ? runMinutes(live.started_at, now) : 1, waitingBuild: live?.waiting_for_build, generatedAt: data?.generatedAt ?? null, timeZone: tz })
      : data
        ? kickOf({ kind: "today", generatedAt: data.generatedAt, timeZone: tz })
        : kickOf({ kind: "none", now, timeZone });

  // The rows' live state (and Send to Plania's progress for today's ideas), as the old page read them.
  const briefId = stored?.id ?? null;
  const rows = useBriefState(briefId);
  const planId = date ? null : latest.data?.brief?.id === briefId ? (latest.data?.plan_id ?? null) : null;
  const progress = usePlanProgress(planId);
  const sentCodes = useMemo(() => new Set(progress.data && progress.data.brief_id === briefId ? progress.data.ideas.map((x) => x.code) : []), [progress.data, briefId]);
  const live_ = rows.data && rows.data.brief_id === briefId ? rows.data : undefined;
  const list = useMemo(() => (data ? stations(data, live_, { checks: shown?.checks ?? [], sentCodes, maxItems: settings.data?.settings.max_items_per_app }) : []), [data, live_, shown?.checks, sentCodes, settings.data?.settings.max_items_per_app]);
  const [stageRef, size] = useStage();
  const delta = useMemo(() => deltaOf({ list, w: size.w, h: size.h, states: live_?.items, settled: settledOrder(live_) }), [list, size.w, size.h, live_]);
  const [picked, setPicked] = useState<string | null>(null);
  const all = useMemo(() => [...delta.streams.flatMap((x) => x.lights), ...delta.river], [delta]);
  const selected = picked && all.some((l) => l.id === picked) ? picked : firstLight(delta);
  const light = all.find((l) => l.id === selected) ?? null;

  // Keys: J K and ↑ ↓ walk the lights, ← → hop streams (I63-3 adds Enter, L, X, Z).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (document.querySelector("[role=dialog]")) return;
    const cmd = keyCommand({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLElement | null });
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

  const headline: Headline = data ? headlineOf({ total: delta.counts.total, open: delta.counts.total - delta.counts.done, blocked: delta.counts.blocked, needs: delta.counts.needs }, runAt) : noBriefHeadline(state === "brief" ? "loading" : state, runAt);
  const walk = useMemo(() => [...delta.streams.flatMap((x) => x.lights), ...delta.river].map((l) => l.id), [delta]);
  const streamOf = (l: Light | null): Station | undefined => (l ? list.find((st) => st.items.some((x) => x.id === l.id) || st.ideas.some((x) => x.id === l.id)) : undefined);
  const card = data ? (
    <HandCard light={light} station={streamOf(light)} position={light ? [walk.indexOf(light.id) + 1, walk.length] : null} onStep={(d) => setPicked(stepLight(delta, selected, d))} />
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
        delta={data ? <BriefDelta delta={delta} selected={selected} onPick={setPicked} inHand={!!light?.card.open} stageRef={stageRef} /> : <div className="cor-bf-delta" ref={stageRef} aria-hidden />}
        card={card}
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

const KIND_WORD: Record<Light["kind"], [string, string]> = { idea: ["Idea nueva", "v"], next: ["Sigue", "v"], toca: ["Te toca", "a"], block: ["Bloquea", "r"] };

/** The card's head: «En la mano · i de n» and the two steps (K, J). */
export function HandHead({ position, onStep }: { position: [number, number] | null; onStep: (d: 1 | -1) => void }) {
  return (
    <div className="cor-bf-fh">
      <span className="cor-label">En la mano{position ? ` · ${position[0]} de ${position[1]}` : ""}</span>
      <span className="cor-bf-step">
        <button type="button" aria-label="Anterior (K)" onClick={() => onStep(-1)} data-step="-1">
          ↑
        </button>
        <button type="button" aria-label="Siguiente (J)" onClick={() => onStep(1)} data-step="1">
          ↓
        </button>
      </span>
    </div>
  );
}

/** I63-2's card in hand: the project, the kind and the title. I63-3 adds the evidence and every action. */
export function HandCard({ light, station, position, onStep }: { light: Light | null; station: Station | undefined; position: [number, number] | null; onStep: (d: 1 | -1) => void }) {
  if (!light || !station) return <EmptyHand state="brief" line="Nada en el brief de hoy." />;
  const name = station.slug === CROSS ? "Entre apps" : station.app.name || station.slug;
  const [word, tone] = light.card.open ? KIND_WORD[light.kind] : (["Resuelto", "g"] as const);
  return (
    <>
      <HandHead position={position} onStep={onStep} />
      <section className={`cor-bf-card ${!light.card.open ? "done" : tone === "a" || tone === "r" ? "you" : "live"}`} aria-label="En la mano" data-brief="card" data-card={light.id}>
        <div className="cor-bf-ck">
          {station.slug === CROSS ? <CrossMark className="cor-logo" /> : <Logo slug={station.slug} title={name} />}
          <span className="pn">{name}</span>
          <span className={`cor-bf-kd ${tone}`}>{word}</span>
        </div>
        <h2>{light.title}</h2>
      </section>
    </>
  );
}

export type { Delta };
