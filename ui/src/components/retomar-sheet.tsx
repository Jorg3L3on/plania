// Retomar: get_resume for one project, in a sheet. The headline, live claims, note and next
// ticket sit on top; ResumeView is the same block the project page uses underneath.
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ReactNode } from "react";
import { ResumeView } from "@/components/resume";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { retomarOf } from "@/lib/ahora";

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
  open,
  onOpenChange,
}: {
  slug: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const project = useQuery({
    queryKey: ["project", slug],
    queryFn: () => api.project(slug),
    enabled: open && slug.length > 0,
  });
  const resume = project.data?.resume;
  const summary = resume ? retomarOf(resume) : null;

  const handleOpen = (key: string) => {
    onOpenChange(false);
    navigate(`/p/${slug}?task=${encodeURIComponent(key)}`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-8 font-display text-xl font-extrabold tracking-tight">{title || slug}</SheetTitle>
          <SheetDescription>Dónde quedó, para seguir.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 px-4 pb-6">
          {project.isPending && <Skeleton className="h-40 rounded-xl" />}
          {project.isError && <p className="text-sm text-destructive">No se pudo cargar el proyecto.</p>}
          {resume && summary && (
            <>
              <div className="grid gap-4">
                <Line label="En qué va">{summary.headline || "Sin ficha."}</Line>
                <Line label="Nota">
                  {summary.note ? summary.note : <span className="text-muted-foreground italic">Sin nota.</span>}
                  {summary.note && summary.noteStale && (
                    <span className="ml-2 inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-400">
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
                  {summary.next ? (
                    <>
                      <Button type="button" variant="link" className="h-auto p-0 text-left whitespace-normal" onClick={() => handleOpen(summary.next?.key ?? "")}>
                        {summary.next.title}
                      </Button>
                      <span className="font-mono text-xs text-muted-foreground"> · {summary.next.key}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Nada en cola.</span>
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
