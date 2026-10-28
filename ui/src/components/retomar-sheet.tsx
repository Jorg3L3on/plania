// Read-only summary of one project. get_resume (GET /api/projects/:slug) only.
// Reasons sit above the same ResumeView the project page uses. Nothing here writes.
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ResumeView } from "@/components/resume";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { READINESS_BADGE, READ_ONLY_LINE, retomarOf, type Readiness } from "@/lib/ahora";

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <div className="text-sm leading-snug whitespace-pre-wrap">{children}</div>
    </div>
  );
}

export function RetomarSheet({
  slug,
  title,
  readiness,
  open,
  onOpenChange,
}: {
  slug: string;
  title: string;
  readiness: Readiness | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  // The page clears slug and title as soon as the sheet starts closing. Keep showing the last
  // project through that render, so the exit animation does not go blank. Readiness is a new
  // object whenever the parent renders, so the hold key is the text, not the object.
  const holdKey = `${slug}\n${title}\n${readiness?.state ?? ""}\n${readiness?.line ?? ""}`;
  const [held, setHeld] = useState({ key: holdKey, slug, title, readiness });
  if (slug.length > 0 && held.key !== holdKey) setHeld({ key: holdKey, slug, title, readiness });
  const shown = slug.length > 0 ? { slug, title, readiness } : held;

  const project = useQuery({
    queryKey: ["project", shown.slug],
    queryFn: () => api.project(shown.slug),
    enabled: shown.slug.length > 0,
  });
  const resume = project.data?.resume;
  const summary = resume ? retomarOf(resume) : null;
  const nextKey = summary?.next?.key ?? "";
  const shownReadiness = resume?.readiness ?? shown.readiness;
  const badge = shownReadiness && shownReadiness.state !== "no_context" ? READINESS_BADGE[shownReadiness.state] : null;
  const sheetLabel = `Resumen de ${shown.title || shown.slug}${badge ? `, ${badge}` : ""}, solo lectura`;

  const handleOpen = (key: string) => {
    if (!key || !shown.slug) return;
    onOpenChange(false);
    navigate(`/p/${shown.slug}?task=${encodeURIComponent(key)}`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" aria-label={sheetLabel} className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-8 font-display text-xl font-extrabold tracking-tight">Resumen de {shown.title || shown.slug}</SheetTitle>
          <SheetDescription>{READ_ONLY_LINE}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 px-4 pb-6">
          {shownReadiness && shownReadiness.reasons.length > 0 && (
            <ul className="grid gap-1" aria-label={`Razones de ${shown.title || shown.slug}`}>
              {shownReadiness.reasons.map((reason) => (
                <li key={`${reason.code}/${reason.task_key ?? ""}`} className="text-sm leading-snug">
                  {reason.text}
                </li>
              ))}
            </ul>
          )}
          {shownReadiness && shownReadiness.reasons.length === 0 && shownReadiness.line && (
            <p className="text-sm leading-snug">{shownReadiness.line}</p>
          )}
          {!resume && project.isPending && <Skeleton className="h-40 rounded-xl" />}
          {!resume && project.isError && <p className="text-sm text-destructive">No se pudo cargar el proyecto.</p>}
          {resume && summary && (
            <>
              <div className="grid gap-4">
                <Line label="En qué va">{summary.headline || "Sin ficha."}</Line>
                <Line label="Nota">
                  {summary.note ? summary.note : <span className="text-muted-foreground italic">Sin nota.</span>}
                  {summary.note && summary.noteStale && (
                    <span className="ml-2 inline-flex rounded-full bg-status-now/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-ink-now uppercase">
                      desactualizada
                    </span>
                  )}
                </Line>
                <Line label="En curso">
                  {summary.claims.length === 0 && <span className="text-muted-foreground">Nadie en curso.</span>}
                  {summary.claims.length > 0 && (
                    <ul className="grid gap-1">
                      {summary.claims.map((claim) => (
                        <li key={claim.key}>
                          <Button type="button" variant="link" className="h-auto p-0 text-left whitespace-normal" onClick={() => handleOpen(claim.key)}>
                            {claim.title}
                          </Button>
                          <span className="text-muted-foreground"> · {claim.agent ?? "sin agente"}</span>
                          <span className="font-mono text-xs text-muted-foreground"> · {claim.key}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Line>
                <Line label="Siguiente">
                  {summary.next && nextKey ? (
                    <>
                      <Button type="button" variant="link" className="h-auto p-0 text-left whitespace-normal" onClick={() => handleOpen(nextKey)}>
                        {summary.next.title}
                      </Button>
                      <span className="font-mono text-xs text-muted-foreground"> · {nextKey}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{summary.next?.title || "Nada en cola."}</span>
                  )}
                </Line>
              </div>
              <ResumeView resume={resume} onOpen={handleOpen} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
