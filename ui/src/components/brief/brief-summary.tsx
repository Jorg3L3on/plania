// PLA-I42-2: the summary card (spec §8 item 2). Big line, sub-line counts, the Not checked / All toggle, a stacked
// bar of open items per app (dimmed when another app is picked) and the app chips that filter every section.
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type BriefData, type BriefLanguage, type BriefView, briefCounts, openPerApp } from "@/lib/brief";
import { AppDot, SLOT_BG } from "./app-badge";
import { BRIEF_LABELS } from "@/lib/brief-i18n";

const chip =
  "inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9";
const chipOn = "border-foreground bg-foreground text-background";
const chipOff = "border-border bg-background hover:bg-muted";

export function BriefSummary({
  data,
  checks,
  language,
  view,
  onView,
  app,
  onApp,
}: {
  data: BriefData;
  checks: string[];
  language: BriefLanguage;
  view: BriefView;
  onView: (v: BriefView) => void;
  app: string | null;
  onApp: (app: string | null) => void;
}) {
  const t = BRIEF_LABELS[language];
  const c = briefCounts(data, checks, app);
  const per = openPerApp(data, checks);
  const total = per.reduce((s, p) => s + p.open, 0);

  return (
    <Card className="rounded-2xl" data-brief="summary">
      <CardContent className="grid gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1.5">
            <p className="font-display text-2xl font-bold tracking-tight sm:text-3xl" data-brief="big-line">
              {c.needs > 0 ? t.needLine(c.needs) : t.nothingNeeds}
            </p>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground" data-brief="sub-line">
              {c.blockers > 0 && <span className="font-semibold text-destructive">{t.blockers(c.blockers)}</span>}
              <span>{t.ready(c.next)}</span>
              <span>{t.ideas(c.ideas)}</span>
              <span>{t.checked(c.checked)}</span>
            </p>
          </div>
          <div role="group" aria-label={t.view} className="inline-flex rounded-full border border-border p-0.5" data-brief="view">
            {(["open", "all"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => onView(v)}
                className={cn(
                  "min-h-11 rounded-full px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8",
                  view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "open" ? t.notChecked : t.all}
              </button>
            ))}
          </div>
        </div>

        {total > 0 && (
          <div role="img" aria-label={t.openPerApp} className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" data-brief="bar">
            {per
              .filter((p) => p.open > 0)
              .map((p) => (
                <span
                  key={p.app.id}
                  title={`${p.app.name} · ${p.open}`}
                  style={{ flexGrow: p.open }}
                  className={cn("basis-0 transition-opacity", SLOT_BG[p.app.color], app && app !== p.app.id && "opacity-25")}
                  data-brief-bar={p.app.id}
                />
              ))}
          </div>
        )}

        <div role="group" aria-label={t.appFilter} className="flex flex-wrap gap-2" data-brief="chips">
          <button type="button" aria-pressed={app === null} onClick={() => onApp(null)} className={cn(chip, app === null ? chipOn : chipOff)}>
            {t.allApps}
            <span className="tabular-nums opacity-70">{total}</span>
          </button>
          {per.map((p) => (
            <button
              key={p.app.id}
              type="button"
              aria-pressed={app === p.app.id}
              onClick={() => onApp(app === p.app.id ? null : p.app.id)}
              className={cn(chip, app === p.app.id ? chipOn : chipOff)}
              data-brief-chip={p.app.id}
            >
              <AppDot slot={p.app.color} />
              {p.app.name}
              <span className="tabular-nums opacity-70">{p.open}</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
