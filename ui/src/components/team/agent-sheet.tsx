import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { faceOf } from "@/components/team/studio";
import { KIND_WORD, STATUS_DOT, STATUS_WORD, type TeamMember } from "@/components/team/types";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";

const useWide = () => {
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 640px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const handleChange = () => setWide(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);
  return wide;
};

type AgentSheetProps = {
  agent: TeamMember | null;
  reportsTo: TeamMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const AgentSheet = ({ agent, reportsTo, open, onOpenChange }: AgentSheetProps) => {
  const wide = useWide();
  const handleOpenChange = (next: boolean) => onOpenChange(next);
  if (!agent) return null;
  const face = faceOf(agent);
  const word = STATUS_WORD[agent.status] ?? agent.status;
  const kind = KIND_WORD[agent.kind] ?? agent.kind;
  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side={wide ? "right" : "bottom"}
        className="max-h-[85svh] overflow-y-auto bg-background sm:max-h-none sm:max-w-md"
      >
        <SheetHeader className="pr-10">
          <SheetTitle className="flex items-center gap-2 font-display text-xl font-extrabold tracking-tight">
            <span className={cn("size-2.5 rounded-full", STATUS_DOT[agent.status] ?? "bg-status-idle")} aria-hidden />
            {agent.name}
          </SheetTitle>
          <SheetDescription>
            {face.line} · {word}
            {face.beat ? ` · ${face.beat}` : ""}
          </SheetDescription>
        </SheetHeader>
        <dl className="grid gap-4 px-4 pb-6 text-sm">
          <div className="grid gap-1">
            <dt className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Rol</dt>
            <dd>
              {agent.role} · {kind}
              <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{agent.slug}</span>
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Reporta a</dt>
            <dd>{reportsTo ? `${reportsTo.name} · ${reportsTo.title}` : "Nadie"}</dd>
          </div>
          <div className="grid gap-1.5">
            <dt className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Capacidades</dt>
            <dd>
              {agent.capabilities.length === 0 ? (
                <span className="text-muted-foreground">Sin capacidades</span>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {agent.capabilities.map((cap) => (
                    <li key={cap} className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px]">
                      {cap}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Último check-in</dt>
            <dd>{agent.last_check_in_at ? ago(agent.last_check_in_at) : "Sin check-in"}</dd>
          </div>
          {agent.note && (
            <div className="grid gap-1">
              <dt className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Nota</dt>
              <dd>{agent.note}</dd>
            </div>
          )}
          <div className="grid gap-1.5">
            <dt className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Tareas a su nombre</dt>
            <dd>
              {agent.tasks.length === 0 ? (
                <span className="text-muted-foreground">Ninguna abierta.</span>
              ) : (
                <ul className="grid gap-2">
                  {agent.tasks.map((task) => (
                    <li key={`${task.project}:${task.key}`}>
                      <Link
                        to={`/p/${encodeURIComponent(task.project)}?task=${encodeURIComponent(task.key)}`}
                        onClick={() => onOpenChange(false)}
                        className="grid min-h-11 gap-0.5 rounded-lg bg-surface-sunken px-3 py-2 hover:underline"
                      >
                        <span className="font-mono text-xs">{task.key}</span>
                        <span>
                          {task.title}
                          <span className="text-muted-foreground"> · {task.status}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </SheetContent>
    </Sheet>
  );
};
