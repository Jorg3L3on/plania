// PLA-I39-3: one teammate is one window. Its light is the server's state (windowState): lit with a laptop while
// its run is live, orange with a raised hand when it waits on the owner, blinds down when paused, dark when
// idle. Under it: the role with its verb, what it is on, else its queue, else its last delivery.
// PLA-I39-6: a window opens its teammate in the side page (onOpen). PLA-I39-7: hint replaces the caption while the
// owner types in the floor's box ("Recibiría tu pedido").
import type { OrgMember } from "@/lib/api";
import { caption, windowLabel, windowState, type WindowState } from "@/lib/edificio";
import { Figure } from "./figure";

export const Glass = ({ role, state }: { role: string; state: WindowState | "ghost" }) => (
  <span className="edi-win" data-state={state}>
    <span className="edi-glass">
      <Figure role={role} />
    </span>
  </span>
);

export const Window = ({
  member: m,
  project,
  now,
  companyPaused,
  hint,
  timeZone,
  onOpen,
}: {
  member: OrgMember;
  project: string;
  now: number;
  companyPaused?: boolean;
  hint?: string | null;
  timeZone?: string;
  onOpen?: (m: OrgMember, el: HTMLElement) => void;
}) => {
  const state = hint ? "ghost" : windowState(m, companyPaused);
  const c = caption(m, now, { companyPaused, timeZone });
  const doing = hint ?? c.doing;
  const sub = hint ? "" : c.sub;
  const label = windowLabel(m, project, now, companyPaused);
  const body = (
    <>
      <span className="edi-glass">
        <Figure role={m.role} />
      </span>
      <span className="edi-who">
        <b>{c.who}</b>
        <i>{c.verb}</i>
      </span>
      <span className="edi-do" data-doing>
        {doing}
      </span>
      {sub && <span className="edi-sub">{sub}</span>}
    </>
  );
  return onOpen ? (
    <button
      type="button"
      className="edi-win"
      data-state={state}
      data-agent={m.agent}
      data-role={m.role}
      aria-label={label}
      onClick={(e) => onOpen(m, e.currentTarget)}
    >
      {body}
    </button>
  ) : (
    <div className="edi-win" data-state={state} data-agent={m.agent} data-role={m.role} role="group" aria-label={label}>
      {body}
    </div>
  );
};
