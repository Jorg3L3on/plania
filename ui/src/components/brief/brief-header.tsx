// PLA-I42-2: the /brief header (spec §8 item 1). Stamp, H1, Generate now ("Generating… 3 min" / "Waiting for the
// current build" while a run goes), the history select (Today plus the past 14 days, read-only) and the settings
// gear (the sheet itself is PLA-I42-4; until then the gear is disabled).
import { SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Kicker } from "@/components/plan/visuals";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type BriefHistoryRow, type BriefLanguage, type BriefRun, runMinutes } from "@/lib/brief";
import { BRIEF_LABELS, dayLabel } from "./labels";

const TODAY = "today";

/** A clock that ticks every 30 s while on (for the run's minutes). */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

export function generateLabel(language: BriefLanguage, run: BriefRun | null, pending: boolean, now: number): string {
  const t = BRIEF_LABELS[language];
  if (run?.waiting_for_build) return t.waitingBuild;
  if (run) return t.generatingMin(runMinutes(run.started_at, now));
  return pending ? t.generating : t.generate;
}

export function BriefHeader({
  language,
  stamp,
  run,
  pending,
  canGenerate,
  onGenerate,
  history,
  todayDate,
  date,
  onDate,
  onSettings,
}: {
  language: BriefLanguage;
  stamp: string | null;
  run: BriefRun | null;
  pending: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  history: BriefHistoryRow[];
  /** Today's local date, left out of the past days. */
  todayDate: string | null;
  date: string | null;
  onDate: (date: string | null) => void;
  onSettings?: () => void;
}) {
  const t = BRIEF_LABELS[language];
  const busy = !!run || pending;
  const now = useNow(!!run);
  const past = history.filter((h) => h.local_date !== todayDate).slice(0, 14);

  return (
    <header className="flex flex-wrap items-end justify-between gap-4" data-brief="header">
      <div className="grid min-w-0 gap-2">
        <Kicker className="text-muted-foreground">{stamp ?? t.kicker}</Kicker>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t.title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy || !canGenerate || !!date} onClick={onGenerate} aria-live="polite" data-brief="generate">
          {generateLabel(language, run, pending, now)}
        </Button>
        <Select value={date ?? TODAY} onValueChange={(v) => onDate(v === TODAY ? null : v)}>
          <SelectTrigger className="min-h-11 sm:min-h-9" aria-label={t.history} data-brief="history">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAY}>{t.today}</SelectItem>
            {past.map((h) => (
              <SelectItem key={h.local_date} value={h.local_date}>
                {dayLabel(h.local_date, language)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 pointer-coarse:size-11 sm:size-9"
          aria-label={onSettings ? t.settings : t.settingsSoon}
          title={onSettings ? t.settings : t.settingsSoon}
          disabled={!onSettings}
          onClick={onSettings}
        >
          <SettingsIcon />
        </Button>
      </div>
    </header>
  );
}
