import { HeartPulseIcon } from "lucide-react";
import { faceOf } from "@/components/team/studio";
import { STATUS_DOT, STATUS_WORD, type TeamMember } from "@/components/team/types";
import { cn } from "@/lib/utils";

type AgentCardProps = {
  agent: TeamMember;
  onOpen: (slug: string) => void;
};

export const AgentCard = ({ agent, onOpen }: AgentCardProps) => {
  const face = faceOf(agent);
  const handleOpen = () => onOpen(agent.slug);
  const word = STATUS_WORD[agent.status] ?? agent.status;
  const taskLabel = agent.tasks.length === 1 ? "1 tarea" : `${agent.tasks.length} tareas`;
  const workingKey = agent.working_on?.key;
  return (
    <button
      type="button"
      onClick={handleOpen}
      aria-label={workingKey ? `${face.title}, ${word}, ${workingKey}` : `${face.title}, ${word}`}
      className={cn(
        "flex min-h-11 w-full flex-col items-center gap-0.5 rounded-[14px] border bg-card px-2.5 py-2.5 text-center transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        face.border,
        face.wash,
        agent.status === "stuck" && "ring-2 ring-status-blocked",
      )}
    >
      <span className="flex max-w-full items-center justify-center gap-1.5">
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[agent.status] ?? "bg-status-idle")} aria-hidden />
        <span className="truncate font-display text-[15px] font-bold tracking-tight">{face.title}</span>
      </span>
      <span className="text-[11px] leading-snug text-muted-foreground">{face.line}</span>
      {face.beat && (
        <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] leading-tight text-ink-done">
          <HeartPulseIcon className="size-3 shrink-0" aria-hidden />
          {face.beat}
        </span>
      )}
      {workingKey && <span className="font-mono text-[10px] text-foreground/80">{workingKey}</span>}
      {agent.tasks.length > 0 && <span className="text-[10px] text-foreground/80">{taskLabel}</span>}
    </button>
  );
};
