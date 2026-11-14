// PLA-I42-2: the /brief page (spec "Spec: Morning brief" §8, layout items 1–3 and 5, Behavior): header, summary with
// filters, Needs you and Up next, footer, empty states, and the cached brief with "Couldn't refresh" when the API
// fails. Today's ideas (item 4) and the send bar (item 6) come in PLA-I42-3; the settings sheet in PLA-I42-4.
// Labels follow the brief's language (D5).
import { useState } from "react";
import { BriefFooter } from "@/components/brief/brief-footer";
import { BriefHeader } from "@/components/brief/brief-header";
import { BriefSection, EmptyRow, NeedsRow, NextRow } from "@/components/brief/brief-items";
import { BriefSummary } from "@/components/brief/brief-summary";
import { BRIEF_LABELS, briefStamp } from "@/components/brief/labels";
import { Card, CardContent } from "@/components/ui/card";
import {
  type BriefLanguage,
  type BriefView,
  NEEDS,
  UP_NEXT,
  sectionItems,
  useBriefByDate,
  useBriefCheck,
  useBriefHistory,
  useBriefLatest,
  useBriefSettings,
  useRunBrief,
} from "@/lib/brief";

export { briefStamp };

export function BriefPage() {
  const latest = useBriefLatest();
  const settings = useBriefSettings();
  const history = useBriefHistory(15);
  const run = useRunBrief();
  const check = useBriefCheck();
  const [date, setDate] = useState<string | null>(null);
  const [view, setView] = useState<BriefView>("open");
  const [app, setApp] = useState<string | null>(null);
  const past = useBriefByDate(date);

  const shown = date ? past.data : latest.data;
  const stored = shown?.brief ?? null;
  const data = stored?.data;
  const checks = shown?.checks ?? [];
  const language: BriefLanguage = data?.language ?? latest.data?.brief?.data.language ?? settings.data?.settings.language ?? "en";
  const t = BRIEF_LABELS[language];
  const enabled = settings.data?.settings.enabled ?? true;
  const stamp = data ? briefStamp(data.generatedAt, data.timezone, data.timezoneLabel, language) : null;
  const readOnly = !!date;
  // A filter on an app this brief doesn't have would hide everything; drop it.
  const appFilter = app && data?.apps.some((a) => a.id === app) ? app : null;

  let empty: string | null = null;
  if (!enabled && !date) empty = t.off;
  else if (!date && latest.isError && !latest.data) empty = t.failed;
  else if (date && past.isError) empty = t.failed;
  else if (!date && latest.isSuccess && !latest.data.brief) empty = t.empty(settings.data?.settings.run_at ?? "07:00");
  const refreshFailed = !date && latest.isError && !!latest.data;

  const appOf = (id: string) => data?.apps.find((a) => a.id === id);
  const onCheck = (id: string, checked: boolean) => check.mutate({ id, checked });
  const needs = data ? sectionItems(data.items, NEEDS, { app: appFilter, view, checks }) : [];
  const next = data ? sectionItems(data.items, UP_NEXT, { app: appFilter, view, checks }) : [];
  const isChecked = new Set(checks);

  return (
    <div className="grid gap-6 sm:gap-8" lang={language} data-brief="page">
      <BriefHeader
        language={language}
        stamp={stamp}
        run={latest.data?.run ?? null}
        pending={run.isPending}
        canGenerate={enabled}
        onGenerate={() => run.mutate(undefined)}
        history={history.data ?? []}
        todayDate={latest.data?.brief?.local_date ?? null}
        date={date}
        onDate={setDate}
      />

      {(refreshFailed || readOnly) && (
        <p className="-mt-3 text-sm text-muted-foreground" role="status" data-brief={refreshFailed ? "refresh-failed" : "past"}>
          {refreshFailed ? t.refreshFailed : t.pastDay}
        </p>
      )}

      {empty && (
        <Card className="rounded-2xl">
          <CardContent>
            <p className="text-muted-foreground" data-brief="empty">
              {empty}
            </p>
          </CardContent>
        </Card>
      )}

      {data && stamp && (
        <>
          <BriefSummary data={data} checks={checks} language={language} view={view} onView={setView} app={appFilter} onApp={setApp} />

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <BriefSection id="needs" title={t.needsYou} count={needs.filter((i) => !isChecked.has(i.id)).length}>
              {needs.length ? (
                <ul className="divide-y divide-border">
                  {needs.map((item, i) => (
                    <NeedsRow key={item.id} item={item} index={i} app={appOf(item.app)} checked={isChecked.has(item.id)} readOnly={readOnly} onCheck={onCheck} language={language} />
                  ))}
                </ul>
              ) : (
                <EmptyRow>{t.noNeeds}</EmptyRow>
              )}
            </BriefSection>
            <BriefSection id="next" title={t.upNext} count={next.filter((i) => !isChecked.has(i.id)).length}>
              {next.length ? (
                <ul className="divide-y divide-border">
                  {next.map((item) => (
                    <NextRow key={item.id} item={item} app={appOf(item.app)} checked={isChecked.has(item.id)} readOnly={readOnly} onCheck={onCheck} language={language} />
                  ))}
                </ul>
              ) : (
                <EmptyRow>{t.noNext}</EmptyRow>
              )}
            </BriefSection>
          </div>

          <BriefFooter data={data} stamp={stamp} language={language} />
        </>
      )}
    </div>
  );
}
