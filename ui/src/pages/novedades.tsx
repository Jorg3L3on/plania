import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker } from "@/components/plan/visuals";
import { api } from "@/lib/api";
import { NOVEDADES, versionLine, type ReleaseReading } from "@/lib/version";

// PLA-I2-17: the release notes in the owner's words (CHANGELOG.md, GET /api/release), under the version line.

export function NovedadesPage() {
  const release = useQuery({ queryKey: ["release"], queryFn: api.releaseInfo, staleTime: 5 * 60_000 });
  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <Kicker>{NOVEDADES.kicker}</Kicker>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{NOVEDADES.title}</h1>
      </header>
      {release.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : release.isError ? (
        <p className="text-sm text-muted-foreground">{NOVEDADES.error}</p>
      ) : (
        <NovedadesView release={release.data} />
      )}
    </div>
  );
}

/** The reading apart from the query, so a test renders it. */
export function NovedadesView({ release }: { release: ReleaseReading }) {
  return (
    <section className="grid gap-4" data-version={release.version}>
      <p className="text-muted-foreground" data-version-line>
        {versionLine(release)}
      </p>
      {release.notes.trim() ? (
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown>{release.notes}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{NOVEDADES.empty}</p>
      )}
    </section>
  );
}
