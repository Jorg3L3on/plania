// PLA-I39-3: one project is one floor: its plate on the left, its team as windows on the right. The floor's
// colour is one of six fixed hues picked from the slug.
import type { CSSProperties, ReactNode } from "react";
import type { OrgMember, OrgProject } from "@/lib/api";
import { floorHue } from "@/lib/edificio";
import { byRole } from "@/lib/org";
import { Window } from "./window";

export const Floor = ({
  project: p,
  now,
  companyPaused,
  plate,
  onOpen,
  children,
}: {
  project: OrgProject;
  now: number;
  companyPaused?: boolean;
  plate?: ReactNode;
  onOpen?: (m: OrgMember, el: HTMLElement) => void;
  children?: ReactNode;
}) => (
  <article
    id={`piso-${p.slug}`}
    className="edi-floor"
    data-floor={p.slug}
    data-light={p.light}
    style={{ "--c": floorHue(p.slug) } as CSSProperties}
    aria-label={p.title}
  >
    <div className="edi-plate">
      {plate ?? (
        <h2 className="edi-fname">
          <span className="edi-bullet" aria-hidden>
            {p.title.charAt(0).toUpperCase()}
          </span>
          <span className="edi-nm" title={p.title}>
            {p.title}
          </span>
        </h2>
      )}
    </div>
    <div className="edi-wins">
      {[...p.team].sort(byRole).map((m) => (
        <Window key={m.agent} member={m} project={p.title} now={now} companyPaused={companyPaused} onOpen={onOpen} />
      ))}
      {children}
    </div>
  </article>
);
