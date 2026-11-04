import { AgentCard } from "@/components/team/agent-card";
import { childrenOf, rootsOf, type TeamMember } from "@/components/team/types";
import { cn } from "@/lib/utils";

type BranchProps = {
  agent: TeamMember;
  agents: TeamMember[];
  depth: number;
  onOpen: (slug: string) => void;
};

const Branch = ({ agent, agents, depth, onOpen }: BranchProps) => {
  const children = childrenOf(agent.slug, agents);
  return (
    <div className={cn("grid min-w-0 gap-2", depth === 0 && "justify-items-center")}>
      <div className={cn(depth === 0 && "w-full max-w-xs")}>
        <AgentCard agent={agent} onOpen={onOpen} featured={depth === 0} />
      </div>
      {children.length > 0 && depth === 0 && <span aria-hidden className="hidden h-4 w-px bg-border md:block" />}
      {children.length > 0 && (
        <div
          className={cn(
            "grid w-full min-w-0 gap-3",
            depth === 0 && "md:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] md:items-start md:gap-6",
            depth > 0 && "border-l border-border/80 pl-3 md:border-l-0 md:border-t md:pt-3 md:pl-0",
          )}
        >
          {children.map((child) => (
            <Branch key={child.slug} agent={child} agents={agents} depth={depth + 1} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
};

type OrgChartProps = {
  agents: TeamMember[];
  onOpen: (slug: string) => void;
};

export const OrgChart = ({ agents, onOpen }: OrgChartProps) => {
  const roots = rootsOf(agents);
  if (roots.length === 0) return null;
  return (
    <div className="grid gap-10">
      {roots.map((root) => (
        <Branch key={root.slug} agent={root} agents={agents} depth={0} onOpen={onOpen} />
      ))}
    </div>
  );
};
