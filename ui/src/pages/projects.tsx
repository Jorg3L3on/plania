import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

export function ProjectsPage() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });

  return (
    <div className="grid gap-6">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">Proyectos</h1>
      {projects.isPending && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      )}
      {projects.isError && <p className="text-sm text-destructive">No se pudieron cargar los proyectos.</p>}
      {projects.data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.data.map((p) => (
            <Link key={p.slug} to={`/p/${p.slug}`} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-colors group-hover:border-foreground/20">
                <CardHeader>
                  <CardTitle className="flex items-baseline gap-2">
                    {p.title}
                    <span className="font-mono text-xs font-normal text-muted-foreground">{p.slug}</span>
                  </CardTitle>
                  <CardDescription className="line-clamp-2">
                    {p.resume.in_progress || p.resume.next_action || "Sin ficha."}
                  </CardDescription>
                  {p.resume.in_progress && p.resume.next_action && (
                    <p className="line-clamp-1 text-sm">
                      <span className="text-muted-foreground">Siguiente: </span>
                      {p.resume.next_action}
                    </p>
                  )}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
