// PLA-I42-2: the /brief page (spec "Spec: Morning brief" §8, layout items 1–3 and 5, Behavior): header, summary with
// filters, Needs you and Up next, footer, empty states, and the cached brief with "Couldn't refresh" when the API
// fails. PLA-I42-3 adds Today's ideas (item 4) and the floating send bar (item 6); PLA-I42-4 the settings sheet.
// PLA-I43-4: Send to Plania from the bar (cost line first, then progress until every target is done; a reload finds
// today's request through latest.plan_id).
// Labels follow the brief's language (D5).
import { useState } from "react";
import { BriefIdeas } from "@/components/brief/brief-ideas";
import { BriefSendBar } from "@/components/brief/brief-send-bar";
import { BriefSettingsSheet } from "@/components/brief/brief-settings";
import { BriefFooter } from "@/components/brief/brief-footer";
import { BriefHeader } from "@/components/brief/brief-header";
import { BriefSection, EmptyRow, NeedsRow, NextRow } from "@/components/brief/brief-items";
import { BriefSummary } from "@/components/brief/brief-summary";
import { BRIEF_LABELS, briefStamp } from "@/lib/brief-i18n";
import { Card, CardContent } from "@/components/ui/card";
import {
  type BriefLanguage,
  type BriefView,
  NEEDS,
  UP_NEXT,
  ideaGroups,
  planCost,
  replyText,
  selectedCodes,
  sectionItems,
  useBriefByDate,
  useBriefCheck,
  useBriefHistory,
  useBriefLatest,
  useBriefSettings,
  usePlanProgress,
  useRunBrief,
  useSendPlan,
  type PlanIdeaProgress,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [picked, setPicked] = useState<{ brief: string | null; ids: Set<string> }>({ brief: null, ids: new Set() });
  const past = useBriefByDate(date);
  const send = useSendPlan();
  const [sent, setSent] = useState<{ id: string; already: string[] } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

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
  // Selection belongs to the brief on screen; a checked (hidden) idea leaves it.
  const selected = new Set(picked.brief === (stored?.id ?? null) ? [...picked.ids].filter((id) => !checks.includes(id) && data?.ideas.some((i) => i.id === id)) : []);
  const briefId = stored?.id ?? null;
  const onSelect = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev.brief === briefId ? prev.ids : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { brief: briefId, ids: next };
    });
  const onCheck = (id: string, checked: boolean) => check.mutate({ id, checked });
  const groups = data ? ideaGroups(data, { app: appFilter, view, checks }) : [];
  const needs = data ? sectionItems(data.items, NEEDS, { app: appFilter, view, checks }) : [];
  const next = data ? sectionItems(data.items, UP_NEXT, { app: appFilter, view, checks }) : [];
  const isChecked = new Set(checks);

  // Send to Plania: the request sent from this page, else today's brief's request (after a reload). Past days never send.
  const planId = readOnly ? null : (sent?.id ?? (latest.data?.brief?.id === briefId ? (latest.data?.plan_id ?? null) : null));
  const progress = usePlanProgress(planId);
  const plan = progress.data && progress.data.brief_id === briefId && dismissed !== progress.data.id ? progress.data : null;
  // A finished request from an earlier visit stays out of the way; one sent now shows until closed.
  const planShown = plan && (plan.status === "open" || sent?.id === plan.id) ? plan : null;
  const plans = new Map<string, PlanIdeaProgress>((plan?.ideas ?? []).map((p) => [p.code, p]));
  const cost = data ? planCost(data, selected, latest.data?.home_project ?? null) : null;
  const onSend = () => {
    if (!data || !briefId) return;
    const codes = selectedCodes(data, selected);
    if (!codes.length) return;
    send.mutate(
      { briefId, codes },
      {
        onSuccess: (res) => {
          setSent({ id: res.request_id, already: res.already_sent });
          setDismissed(null);
          setPicked({ brief: briefId, ids: new Set() });
        },
      },
    );
  };

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
        onSettings={() => setSettingsOpen(true)}
      />
      <BriefSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} language={language} />

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

          <BriefIdeas groups={groups} checks={checks} selected={selected} readOnly={readOnly} onCheck={onCheck} onSelect={onSelect} language={language} plans={plans} />

          <BriefFooter data={data} stamp={stamp} language={language} />

          <BriefSendBar
            count={selected.size}
            reply={replyText(data, selected)}
            onClear={() => setPicked({ brief: briefId, ids: new Set() })}
            language={language}
            canSend={!readOnly}
            onSend={onSend}
            cost={cost}
            sending={send.isPending}
            sendError={send.isError}
            alreadySent={sent && sent.id === planShown?.id ? sent.already : []}
            plan={planShown}
            onDismiss={() => {
              if (plan) setDismissed(plan.id);
              setSent(null);
            }}
          />
        </>
      )}
    </div>
  );
}
