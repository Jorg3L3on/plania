import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { words } from "@/lib/i18n";
import { NOVEDADES, versionLine, type ReleaseReading } from "@/lib/version";
import { ACTUALIZAR, kitFileLine, kitRoleLine, type UpdateReport } from "@/lib/actualizar";

// PLA-I2-17: the release notes in the owner's words (CHANGELOG.md, GET /api/release), under the version line.

export function NovedadesPage() {
  const release = useQuery({ queryKey: ["release"], queryFn: api.releaseInfo, staleTime: 5 * 60_000 });
  const nw = words(NOVEDADES);
  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <Kicker>{nw.kicker}</Kicker>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{nw.title}</h1>
      </header>
      {release.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : release.isError ? (
        <p className="text-sm text-muted-foreground">{nw.error}</p>
      ) : (
        <NovedadesView release={release.data} />
      )}
    </div>
  );
}

/** The reading apart from the query, so a test renders it. */
export function NovedadesView({ release }: { release: ReleaseReading }) {
  const nw = words(NOVEDADES);
  return (
    <section className="grid gap-4" data-version={release.version}>
      <p className="text-muted-foreground" data-version-line>
        {versionLine(release)}
      </p>
      {release.last_update && <LastUpdate report={release.last_update} />}
      {release.notes.trim() ? (
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown>{release.notes}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{nw.empty}</p>
      )}
    </section>
  );
}

// PLA-I2-8: what the update to this version kept of the owner's own kit, and what to do about it.
function LastUpdate({ report }: { report: UpdateReport }) {
  const aw = words(ACTUALIZAR);
  const lines = [...report.kit_files.map((k) => ({ key: k.file, text: kitFileLine(k), todo: k.kind === "both" })), ...report.kit_roles.map((r) => ({ key: r.role, text: kitRoleLine(r), todo: true }))];
  return (
    <section className="grid gap-2 rounded-lg border p-4" data-last-update={report.to}>
      <h2 className="font-semibold">{aw.title}</h2>
      <p className="text-sm text-muted-foreground">{aw.headline(report)}</p>
      {lines.length === 0 ? (
        <p className="text-sm">{aw.nothingKept}</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {lines.map((l) => (
            <li key={l.key} data-kit-todo={l.todo ? "1" : "0"}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{aw.backup(report.backup)}</p>
    </section>
  );
}
