import type { ReactNode } from "react";
import { AgentCard } from "@/components/team/agent-card";
import { studioLayout, type StudioLayout } from "@/components/team/studio";
import type { TeamMember } from "@/components/team/types";
import { cn } from "@/lib/utils";

const Stem = () => <span aria-hidden className="mx-auto h-4 w-px bg-border" />;

const Section = ({ title, cols, children }: { title: string; cols: 2 | 3; children: ReactNode }) => (
  <section className="grid gap-1.5">
    <h2 className="text-[11px] tracking-[0.08em] text-status-idle uppercase">{title}</h2>
    <div className={cn("grid gap-2", cols === 2 ? "grid-cols-2" : "grid-cols-3")}>{children}</div>
  </section>
);

const cards = (rows: TeamMember[], onOpen: (slug: string) => void) =>
  rows.map((agent) => <AgentCard key={agent.slug} agent={agent} onOpen={onOpen} />);

type OrgChartProps = {
  agents: TeamMember[];
  onOpen: (slug: string) => void;
};

const leadIn = (layout: StudioLayout) => layout.ceo || layout.asistente || layout.leads.length > 0;

export const OrgChart = ({ agents, onOpen }: OrgChartProps) => {
  const layout = studioLayout(agents);
  return (
    <div className="mx-auto grid w-full max-w-xl gap-2">
      {layout.ceo && <AgentCard agent={layout.ceo} onOpen={onOpen} />}
      {layout.ceo && layout.asistente && <Stem />}
      {layout.asistente && <AgentCard agent={layout.asistente} onOpen={onOpen} />}
      {layout.asistente && layout.leads.length > 0 && <Stem />}
      {layout.leads.length > 0 && <div className="grid grid-cols-2 gap-2">{cards(layout.leads, onOpen)}</div>}
      {layout.engineering.length > 0 && (
        <Section title="Ingeniería · reporta a Taller" cols={2}>
          {cards(layout.engineering, onOpen)}
        </Section>
      )}
      {layout.shared.length > 0 && (
        <Section title="Servicios compartidos" cols={3}>
          {cards(layout.shared, onOpen)}
        </Section>
      )}
      {(layout.owners.length > 0 || leadIn(layout)) && (
        <Section title="Product owners · uno por negocio" cols={3}>
          {cards(layout.owners, onOpen)}
          <div className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-[14px] border border-dashed border-status-idle/70 px-2 py-2.5 text-center text-status-idle">
            <span className="font-display text-[15px] font-bold">Siguiente app</span>
            <span className="text-[11px] leading-snug">Contratar un PO nuevo</span>
          </div>
        </Section>
      )}
      {layout.extra.length > 0 && (
        <Section title="También en el roster" cols={2}>
          {cards(layout.extra, onOpen)}
        </Section>
      )}
      <p className="mt-2 rounded-[14px] border border-border bg-card px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        Cómo corre el trabajo: <span className="text-foreground">meta del CEO</span> → Asistente y Plania la parten → el{" "}
        <span className="text-foreground">PO</span> escribe las iniciativas → <span className="text-foreground">Taller</span> construye → los PO verifican. Sin compuertas: el CEO solo recibe el aviso de que quedó listo.
      </p>
    </div>
  );
};
