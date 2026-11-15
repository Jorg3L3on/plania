// PLA-I42-2: the /brief page (spec "Spec: Morning brief" §8, layout items 1–3 and 5, Behavior): header, summary with
// filters, Needs you and Up next, footer, empty states, and the cached brief with "Couldn't refresh" when the API
// fails. PLA-I42-3 adds Today's ideas (item 4) and the floating send bar (item 6); PLA-I42-4 the settings sheet.
// PLA-I43-4: Send to Plania from the bar (cost line first, then progress until every target is done; a reload finds
// today's request through latest.plan_id).
// Labels follow the brief's language (D5).
import { useState } from "react";
import { BriefDesk } from "@/components/brief/desk";
import { BriefSettingsSheet } from "@/components/brief/brief-settings";
import { BriefHeader } from "@/components/brief/brief-header";
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
  useBriefAct,
  useBriefByDate,
  useBriefState,
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
  const rows = useBriefState(briefId);
  const acts = useBriefAct(briefId);
  const onSendIds = (ids: string[]) => {
    if (!data || !briefId) return;
    const codes = selectedCodes(data, new Set(ids));
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

  // PLA-I49-4: with a brief on screen the page is the desk (src/components/brief/desk.tsx); before that, the V1 header
  // and its empty or error card.
  if (data && stamp && briefId) {
    return (
      <>
        <BriefSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} language={language} />
        <BriefDesk
          data={data}
          briefId={briefId}
          state={rows.data && rows.data.brief_id === briefId ? rows.data : undefined}
          stateLoading={rows.isLoading}
          checks={checks}
          language={language}
          readOnly={readOnly || !!rows.data?.read_only}
          stamp={stamp}
          run={latest.data?.run ?? null}
          generating={run.isPending}
          canGenerate={enabled}
          onGenerate={() => run.mutate(undefined)}
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
          onHideIdea={(id) => onCheck(id, true)}
          selected={selected}
          onSelect={onSelect}
          onClearSelection={() => setPicked({ brief: briefId, ids: new Set() })}
          onSendIdeas={(ids) => {
            setPicked({ brief: briefId, ids: new Set(ids) });
            onSendIds(ids);
          }}
          ideaCost={(ids) => planCost(data, ids, latest.data?.home_project ?? null)}
          sending={send.isPending}
          plans={plans}
        />
      </>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1480px] gap-6 px-4 pt-5 sm:gap-8 sm:px-6" lang={language} data-brief="page">
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
      <Card className="rounded-2xl">
        <CardContent>
          <p className="text-muted-foreground" data-brief="empty">
            {empty ?? (latest.isLoading ? t.d.loading : t.failed)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
