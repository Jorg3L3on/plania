// PLA-I63: the Morning brief as a Compañía place (/ceo?v=brief), drawn in La corriente's look (PLA-IDEA26, sketch 2).
// The data, the passes and the API are the brief's own (lib/brief.ts, /api/brief/*); only the drawing is new.
// I63-1: the address, the page, the date line and headline, its tools (Generar ahora with the three passes, Días
// anteriores, Ajustes) and the states with no brief on screen. The delta and the card in hand come in I63-2 and I63-3.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { BriefSettingsSheet } from "@/components/brief/brief-settings";
import { ApiError } from "@/lib/api";
import { BRIEF_LABELS } from "@/lib/brief-i18n";
import { type BriefHistoryRow, type BriefLanguage, type BriefPass, runMinutes, useBriefByDate, useBriefHistory, useBriefLatest, useBriefSettings, useRunBrief } from "@/lib/brief";
import { dayLine, headlineOf, kickOf, noBriefHeadline, type Headline } from "@/lib/brief-delta";
import { Btn } from "./parts";

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

  // I63-1: the counts for the headline come from the rows as they are; I63-2 counts what is settled.
  const headline: Headline = data
    ? headlineOf({ total: data.items.length + data.ideas.length, open: data.items.length + data.ideas.length, blocked: data.items.filter((i) => i.status === "blocker").length, needs: data.items.filter((i) => i.status === "needs_you").length }, runAt)
    : noBriefHeadline(state === "brief" ? "loading" : state, runAt);

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
      <BriefView kick={kick} live={generating} headline={headline} tools={tools} state={state} onRetry={() => void (date ? past.refetch() : latest.refetch())} />
    </>
  );
}
