// PLA-I39-3: one project is one floor: its plate on the left, its team as windows on the right. The floor's
// colour is one of six fixed hues picked from the slug. PLA-I39-4: the plate (plate.tsx).
import type { CSSProperties, ReactNode } from "react";
import type { OrgMember, OrgProject } from "@/lib/api";
import { floorHue } from "@/lib/edificio";
import { byRole } from "@/lib/org";
import { Plate } from "./plate";
import { Window } from "./window";

export const Floor = ({
  project: p,
  now,
  companyPaused,
  plate,
  onOpen,
  onFijar,
  onPlan,
  children,
}: {
  project: OrgProject;
  now: number;
  companyPaused?: boolean;
  plate?: ReactNode;
  onOpen?: (m: OrgMember, el: HTMLElement) => void;
  onFijar?: (p: OrgProject) => void;
  onPlan?: (p: OrgProject, el: HTMLElement) => void;
  children?: ReactNode;
}) => (
  <article id={`piso-${p.slug}`} className="edi-floor" data-floor={p.slug} data-light={p.light} style={{ "--c": floorHue(p.slug) } as CSSProperties} aria-label={p.title}>
    <div className="edi-plate">{plate ?? <Plate project={p} onFijar={onFijar} onPlan={onPlan} />}</div>
    <div className="edi-wins">
      {[...p.team].sort(byRole).map((m) => (
        <Window key={m.agent} member={m} project={p.title} now={now} companyPaused={companyPaused} onOpen={onOpen} />
      ))}
      {children}
    </div>
  </article>
);
