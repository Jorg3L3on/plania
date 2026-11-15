// PLA-I42-2: the /brief page. PLA-I51: with a brief on screen it is the city at dawn (src/components/brief/city.tsx);
// before one exists, the same sky with the V1 texts (no brief yet, brief off, could not load), and a quiet loading
// form on the first load. The cached brief stays with "Couldn't refresh" when the API fails; a past day is
// read-only; a failed run after the brief keeps that brief on screen and says why (PLA-33's last_run). Labels follow
// the brief's language, Spanish by default (PLA-I51-1).
import { useState } from "react";
import { BriefCity, SkyFrame } from "@/components/brief/city";
import { BriefSettingsSheet } from "@/components/brief/brief-settings";
import { BRIEF_LABELS, briefStamp } from "@/lib/brief-i18n";
import {
  type BriefLanguage,
  planCost,
  useBriefAct,
  useBriefByDate,
  useBriefState,
  useBriefHistory,
  useBriefLatest,
  useBriefSettings,
  usePlanProgress,
  useRunBrief,
  type PlanIdeaProgress,
} from "@/lib/brief";

export { briefStamp };

export function BriefPage() {
  const latest = useBriefLatest();
  const settings = useBriefSettings();
  const history = useBriefHistory(15);
  const run = useRunBrief();
  const [date, setDate] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const past = useBriefByDate(date);

  const shown = date ? past.data : latest.data;
  const stored = shown?.brief ?? null;
  const data = stored?.data;
  const checks = shown?.checks ?? [];
  const language: BriefLanguage = data?.language ?? latest.data?.brief?.data.language ?? settings.data?.settings.language ?? "es";
  const t = BRIEF_LABELS[language];
  const enabled = settings.data?.settings.enabled ?? true;
  const stamp = data ? briefStamp(data.generatedAt, data.timezone, data.timezoneLabel, language) : null;
  const readOnly = !!date;

  let empty: string | null = null;
  if (!enabled && !date) empty = t.off;
  else if (!date && latest.isError && !latest.data) empty = t.failed;
  else if (date && past.isError) empty = t.failed;
  else if (!date && latest.isSuccess && !latest.data.brief) empty = t.empty(settings.data?.settings.run_at ?? "07:00");
  const refreshFailed = !date && latest.isError && !!latest.data;

  const briefId = stored?.id ?? null;
  // Send to Plania's progress for today's brief (an idea's Plan fate goes through it).
  const planId = readOnly ? null : latest.data?.brief?.id === briefId ? (latest.data?.plan_id ?? null) : null;
  const progress = usePlanProgress(planId);
  const plan = progress.data && progress.data.brief_id === briefId ? progress.data : null;
  const plans = new Map<string, PlanIdeaProgress>((plan?.ideas ?? []).map((p) => [p.code, p]));
  const rows = useBriefState(briefId);
  const acts = useBriefAct(briefId);
  const generate = (passes?: ("brief" | "ideas")[]) => run.mutate(passes);

  const sheet = <BriefSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} language={language} />;

  if (data && stamp && briefId) {
    return (
      <>
        {sheet}
        <BriefCity
          key={briefId}
          data={data}
          briefId={briefId}
          state={rows.data && rows.data.brief_id === briefId ? rows.data : undefined}
          stateLoading={rows.isLoading}
          checks={checks}
          language={language}
          readOnly={readOnly || !!rows.data?.read_only}
          stamp={stamp}
          run={latest.data?.run ?? null}
          lastRun={date ? null : (latest.data?.last_run ?? null)}
          generating={run.isPending}
          canGenerate={enabled}
          onGenerate={generate}
          history={history.data ?? []}
          todayDate={latest.data?.brief?.local_date ?? null}
          date={date}
          onDate={setDate}
          onSettings={() => setSettingsOpen(true)}
          banner={refreshFailed ? "refresh-failed" : readOnly ? "past" : null}
          onRetry={() => void latest.refetch()}
          onAct={(body) => acts.act.mutateAsync({ ...body, brief_id: briefId })}
          onUndo={(actionId, itemId) => acts.undo.mutateAsync({ actionId, itemId })}
          acting={acts.act.isPending || acts.undo.isPending}
          ideaCost={(ids) => planCost(data, ids, latest.data?.home_project ?? null)}
          plans={plans}
          maxItems={settings.data?.settings.max_items_per_app}
          runAt={settings.data?.settings.run_at}
        />
      </>
    );
  }

  const loading = !empty && (latest.isLoading || (date ? past.isLoading : false));
  return (
    <>
      {sheet}
      <BriefEmpty
        language={language}
        text={loading ? null : (empty ?? t.failed)}
        busy={!!latest.data?.run || run.isPending}
        canGenerate={enabled && !date}
        onGenerate={() => generate()}
        onSettings={() => setSettingsOpen(true)}
        onToday={date ? () => setDate(null) : null}
      />
    </>
  );
}

/** No brief on screen: the sky with its tools and one line (or, on the first load, the page's quiet loading form). */
export function BriefEmpty({ language, text, busy, canGenerate, onGenerate, onSettings, onToday }: { language: BriefLanguage; text: string | null; busy: boolean; canGenerate: boolean; onGenerate: () => void; onSettings: () => void; onToday: (() => void) | null }) {
  const t = BRIEF_LABELS[language];
  return (
    <div className="bc" lang={language} data-brief="page">
      <SkyFrame
        p={0}
        busy={busy}
        stamp={null}
        title={t.title}
        tools={
          <>
            <button type="button" className="bc-chip" disabled={busy || !canGenerate} onClick={onGenerate} data-brief="generate">
              {busy ? t.generating : t.generate}
            </button>
            {onToday && (
              <button type="button" className="bc-chip" onClick={onToday} data-brief="back-today">
                {t.d.backToday}
              </button>
            )}
            <button type="button" className="bc-chip" onClick={onSettings} data-brief="settings">
              {t.settings}
            </button>
          </>
        }
      >
        <div className="bc-stations-x">
          <div className="bc-stations" aria-hidden style={{ ["--n" as string]: "6" }}>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="bc-stn bc-stn-sk">
                <span className="bc-twr">
                  <i className="bc-w" data-t="lit" />
                  <i className="bc-w" data-t="lit" />
                </span>
              </span>
            ))}
          </div>
        </div>
      </SkyFrame>
      <div className="bc-body bc-body-empty">
        {text === null ? (
          <div className="bc-loading" data-brief="loading" aria-busy="true">
            <p className="bc-note">{t.d.loading}</p>
            <div className="bc-grid">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="bc-c bc-c-sk" />
              ))}
            </div>
          </div>
        ) : (
          <div className="bc-cleared" data-brief="empty">
            <span>{text}</span>
          </div>
        )}
      </div>
    </div>
  );
}
