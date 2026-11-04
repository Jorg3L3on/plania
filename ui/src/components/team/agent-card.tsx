import type { TeamMember } from "@/components/team/types";
import { STATUS_DOT, STATUS_WORD } from "@/components/team/types";
import { cn } from "@/lib/utils";

type AgentCardProps = {
  agent: TeamMember;
  onOpen: (slug: string) => void;
  featured?: boolean;
};

export const AgentCard = ({ agent, onOpen, featured = false }: AgentCardProps) => {
  const handleOpen = () => onOpen(agent.slug);
  const word = STATUS_WORD[agent.status] ?? agent.status;
  const taskLabel = agent.tasks.length === 1 ? "1 tarea" : `${agent.tasks.length} tareas`;
  return (
    <button
      type="button"
      onClick={handleOpen}
      aria-label={`${agent.name}, ${word}`}
      className={cn(
        "flex min-h-11 w-full flex-col gap-0.5 rounded-xl bg-card px-3 py-2.5 text-left ring-1 ring-foreground/10 transition hover:ring-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        featured && "py-3",
        agent.status === "stuck" && "ring-status-blocked/70",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[agent.status] ?? "bg-status-idle")} aria-hidden />
        <span className={cn("truncate font-display font-bold tracking-tight", featured ? "text-lg" : "text-[15px]")}>{agent.name}</span>
      </span>
      <span className="truncate pl-4 text-xs text-muted-foreground">{agent.title}</span>
      {agent.tasks.length > 0 && <span className="pl-4 text-[11px] text-foreground/80">{taskLabel}</span>}
    </button>
  );
};
