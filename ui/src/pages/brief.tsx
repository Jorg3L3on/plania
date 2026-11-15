// PLA-I42-2: the /brief page. PLA-I49-4: with a brief on screen it is the desk (src/components/brief/desk.tsx); before
// one exists, the V1 header with its empty or error card. The cached brief stays with "Couldn't refresh" when the API
// fails; a past day is read-only. PLA-I49-6: ideas get their fates on the desk (Keep, Discard, Sketch, Research, Plan);
// Copy reply and the reply box are gone. Send to Plania's progress (latest.plan_id) still shows on ideas in motion.
// Labels follow the brief's language (D5).
import { useState } from "react";
import { BriefDesk } from "@/components/brief/desk";
import { BriefSettingsSheet } from "@/components/brief/brief-settings";
import { BriefHeader } from "@/components/brief/brief-header";
import { BRIEF_LABELS, briefStamp } from "@/lib/brief-i18n";
import { Card, CardContent } from "@/components/ui/card";
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
  const [picked, setPicked] = useState<{ brief: string | null; ids: Set<string> }>({ brief: null, ids: new Set() });
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

  let empty: string | null = null;
  if (!enabled && !date) empty = t.off;
  else if (!date && latest.isError && !latest.data) empty = t.failed;
  else if (date && past.isError) empty = t.failed;
  else if (!date && latest.isSuccess && !latest.data.brief) empty = t.empty(settings.data?.settings.run_at ?? "07:00");
  const refreshFailed = !date && latest.isError && !!latest.data;

  // Selection belongs to the brief on screen.
  const briefId = stored?.id ?? null;
  const selected = new Set(picked.brief === briefId ? [...picked.ids].filter((id) => data?.ideas.some((i) => i.id === id)) : []);
  const onSelect = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev.brief === briefId ? prev.ids : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { brief: briefId, ids: next };
    });

  // Send to Plania's progress for today's brief (an idea's Plan fate goes through it).
  const planId = readOnly ? null : latest.data?.brief?.id === briefId ? (latest.data?.plan_id ?? null) : null;
  const progress = usePlanProgress(planId);
  const plan = progress.data && progress.data.brief_id === briefId ? progress.data : null;
  const plans = new Map<string, PlanIdeaProgress>((plan?.ideas ?? []).map((p) => [p.code, p]));
  const rows = useBriefState(briefId);
  const acts = useBriefAct(briefId);

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
          selected={selected}
          onSelect={onSelect}
          onClearSelection={() => setPicked({ brief: briefId, ids: new Set() })}
          ideaCost={(ids) => planCost(data, ids, latest.data?.home_project ?? null)}
          sending={false}
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
