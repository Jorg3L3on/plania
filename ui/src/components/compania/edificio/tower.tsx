// PLA-I47-2: the tower rail at the left of /ceo (Design frame 1). Tu oficina on top with the Te toca count, one tile
// per running project in floorOrder (its initial, one small window per teammate lit while it works, the delivery's
// progress), the street, the paused projects under it, and «+» for a new floor. A tile opens its floor; ↑ ↓ move
// between floors (Building owns the keys). The open tile is aria-current and joins its floor with a line.
import type { CSSProperties } from "react";
import type { Decision, OrgProject } from "@/lib/api";
import { floorHue, roofChips, seatIn, waitsOnOwner, windowState } from "@/lib/edificio";
import { byRole } from "@/lib/org";
import { Glass } from "./window";

const progress = (p: OrgProject): number => {
  const legs = p.route?.legs ?? [];
  const total = legs.reduce((n, l) => n + l.total, 0);
  if (total > 0) return Math.round((legs.reduce((n, l) => n + l.done, 0) / total) * 100);
  return p.plan && p.plan.total > 0 ? Math.round((p.plan.done / p.plan.total) * 100) : 0;
};

const Tile = ({ p, open, toca, off, app, companyPaused, onPiso }: { p: OrgProject; open: boolean; toca: boolean; off?: boolean; app?: boolean; companyPaused?: boolean; onPiso?: (slug: string) => void }) => (
  <button
    type="button"
    className={`edi-tile-fl${off ? " is-off" : ""}`}
    style={{ "--c": floorHue(p.slug) } as CSSProperties}
    aria-current={open ? "true" : undefined}
    data-tile={p.slug}
    data-toca={toca ? "" : undefined}
    data-app={app ? "on" : undefined}
    title={p.title}
    aria-label={`${p.title}${toca ? ", te toca" : ""}${off ? ", en pausa" : ""}${app ? ", la app está encendida" : ""}`}
    onClick={() => onPiso?.(p.slug)}
  >
    <b aria-hidden>{p.title.charAt(0).toUpperCase()}</b>
    {/* PLA-I48-7: a light on the tile while the floor's app is on. */}
    {app && <i className="edi-tile-app" aria-hidden />}
    {!off && (
      <>
        <span className="edi-tile-wins" aria-hidden>
          {[...p.team].sort(byRole).map((m) => (
            <i key={m.agent} data-s={windowState(m, companyPaused, seatIn(p, m, companyPaused))} />
          ))}
        </span>
        <span className="edi-tile-bar" aria-hidden>
          <i style={{ width: `${progress(p)}%` }} />
        </span>
      </>
    )}
  </button>
);

export const Tower = ({
  floors,
  basement,
  decisions,
  projects,
  open,
  officeOpen,
  companyPaused,
  onPiso,
  onOffice,
  onNew,
  appsOn,
}: {
  appsOn?: string[];
  floors: OrgProject[];
  basement: OrgProject[];
  decisions: Decision[];
  projects: OrgProject[];
  open: string | null;
  officeOpen?: boolean;
  companyPaused?: boolean;
  onPiso?: (slug: string) => void;
  onOffice?: () => void;
  onNew: () => void;
}) => {
  const waiting = roofChips(decisions, projects).length;
  return (
    <nav className="edi-rail" aria-label="Edificio: un piso por proyecto" data-tower={floors.length}>
      <span className="edi-rail-ant" aria-hidden />
      <button type="button" className="edi-rail-roof" onClick={onOffice} aria-expanded={!!officeOpen} data-control="tu-oficina" aria-label={`Tu oficina: te toca ${waiting}`}>
        <Glass role="jorge" state={waiting > 0 ? "ask" : "idle"} />
        <small>Oficina</small>
        {waiting > 0 && (
          <span className="edi-rail-badge" data-te-toca-n={waiting}>
            {waiting}
          </span>
        )}
      </button>
      <div className="edi-rail-floors">
        {floors.map((p) => (
          <Tile key={p.slug} p={p} open={open === p.slug} toca={waitsOnOwner(p, decisions)} app={appsOn?.includes(p.slug)} companyPaused={companyPaused} onPiso={onPiso} />
        ))}
      </div>
      <span className="edi-rail-street" aria-hidden />
      {basement.length > 0 && (
        <div className="edi-rail-under" data-basement={basement.length} aria-label="Bajo la calle · en pausa" role="group">
          {basement.map((p) => (
            <Tile key={p.slug} p={p} open={open === p.slug} toca={false} off app={appsOn?.includes(p.slug)} onPiso={onPiso} />
          ))}
        </div>
      )}
      <button type="button" className="edi-rail-add" onClick={onNew} data-control="piso-nuevo" aria-label="Abrir un piso nuevo" title="Abrir un piso nuevo">
        ＋
      </button>
    </nav>
  );
};

// The floor that is open: the one the address names if it exists, else the first running floor, else the first
// paused one. The order of floors is the tower's (floorOrder), so ↑ ↓ walk it top to bottom, then the basement.
export function openFloor(floors: OrgProject[], basement: OrgProject[], piso?: string | null): OrgProject | null {
  const all = [...floors, ...basement];
  return all.find((p) => p.slug === piso) ?? all[0] ?? null;
}
export function stepFloor(floors: OrgProject[], basement: OrgProject[], open: string | null, dir: 1 | -1): string | null {
  const all = [...floors, ...basement].map((p) => p.slug);
  if (!all.length) return null;
  const i = open ? all.indexOf(open) : -1;
  const j = Math.min(all.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir));
  return all[j] ?? null;
}
