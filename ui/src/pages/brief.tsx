// PLA-I42-1: the /brief page, placeholder. Header and empty states only; the summary, Needs you, Up next, ideas and
// the settings sheet come in PLA-I42-2…4 (spec "Spec: Morning brief" §8). Labels follow the brief's language (D5);
// the full en/es tables move to ui/src/lib/brief-i18n.ts in PLA-I42-4.
import { Kicker } from "@/components/plan/visuals";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { type BriefLanguage, useBriefLatest, useBriefSettings, useRunBrief } from "@/lib/brief";

const T = {
  en: {
    kicker: "Today",
    title: "Morning brief",
    generate: "Generate now",
    generating: "Generating…",
    empty: "No brief yet. It runs at {time}, or press Generate now.",
    off: "Morning brief is off. Turn it on in settings.",
    ready: "Generated {stamp}. The full page is on its way.",
    failed: "Couldn't load the brief.",
  },
  es: {
    kicker: "Hoy",
    title: "Brief de la mañana",
    generate: "Generar ahora",
    generating: "Generando…",
    empty: "Aún no hay brief. Corre a las {time}, o pulsa Generar ahora.",
    off: "El brief de la mañana está apagado. Enciéndelo en ajustes.",
    ready: "Generado {stamp}. La página completa viene en camino.",
    failed: "No se pudo cargar el brief.",
  },
} satisfies Record<BriefLanguage, Record<string, string>>;

/** The header stamp, e.g. "Fri · Nov 13 · 07:04 CDMX", in the brief's zone and language. */
export function briefStamp(iso: string, timezone: string, label: string, language: BriefLanguage): string {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(language, { timeZone: timezone, ...o }).format(d);
  const time = part({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${part({ weekday: "short" })} · ${part({ month: "short", day: "numeric" })} · ${time} ${label}`;
}

export function BriefPage() {
  const latest = useBriefLatest();
  const settings = useBriefSettings();
  const run = useRunBrief();

  const data = latest.data?.brief?.data;
  const language: BriefLanguage = data?.language ?? settings.data?.settings.language ?? "en";
  const t = T[language];
  const running = !!latest.data?.run || run.isPending;
  const enabled = settings.data?.settings.enabled ?? true;
  const stamp = data ? briefStamp(data.generatedAt, data.timezone, data.timezoneLabel, language) : null;

  let body: string | null = null;
  if (latest.isError && !latest.data) body = t.failed;
  else if (latest.isSuccess && !latest.data.brief) body = enabled ? t.empty.replace("{time}", settings.data?.settings.run_at ?? "07:00") : t.off;
  else if (stamp) body = t.ready.replace("{stamp}", stamp);

  return (
    <div className="grid gap-8" lang={language}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid min-w-0 gap-2">
          <Kicker>{stamp ?? t.kicker}</Kicker>
          <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t.title}</h1>
        </div>
        <Button variant="outline" className="min-h-11" disabled={running || !enabled} onClick={() => run.mutate(undefined)}>
          {running ? t.generating : t.generate}
        </Button>
      </header>
      {body && (
        <Card className="rounded-2xl">
          <CardContent>
            <p className="text-muted-foreground" data-brief="empty">{body}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
