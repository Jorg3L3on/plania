// PLA-I53-4: la línea de Ahora (lib/ahora-piso.ts). A dot in the stage colour that pulses while someone works, one
// sentence per piece of work (newest first), and a second line: who is idle, or, when nobody works, «Nadie trabaja en
// este piso ahora.» with the true reason. Hook-free; the floor and the project page pass the same view.
import type { CSSProperties } from "react";
import { QUIET_SAY, type AhoraView } from "@/lib/ahora-piso";
import type { StageTone } from "@/lib/etapas";

const TONE_VAR: Record<StageTone | "idle", string> = {
  idle: "var(--status-idle)",
  pending: "var(--status-idle)",
  ready: "var(--status-ready)",
  blocked: "var(--status-blocked)",
  now: "var(--status-now)",
  review: "var(--status-review)",
  jorge: "var(--status-jorge)",
  done: "var(--status-done)",
};
// More than this many at once fold into «y n más».
const SHOWN = 3;

export const AhoraLine = ({ view, className }: { view: AhoraView; className?: string }) => {
  const shown = view.lines.slice(0, SHOWN);
  const rest = view.lines.length - shown.length;
  return (
    <div className={className ? `ahl ${className}` : "ahl"} data-ahora={view.working ? "work" : "quiet"} data-reason={view.quiet?.kind} style={{ "--ac": TONE_VAR[view.tone] } as CSSProperties} role="status" aria-label="Ahora">
      <span className="ahl-dot" data-pulse={view.working ? "" : undefined} aria-hidden />
      <div className="ahl-text">
        {view.working ? (
          <ul className="ahl-list">
            {shown.map((l) => (
              <li key={l.key} className="ahl-say" data-ahora-item={l.key} data-agent={l.agent} data-station={l.station ?? undefined} title={l.text} style={{ "--ac": TONE_VAR[l.tone] } as CSSProperties}>
                {l.text}
              </li>
            ))}
            {rest > 0 && <li className="ahl-more">y {rest === 1 ? "1 más" : `${rest} más`}</li>}
          </ul>
        ) : (
          <p className="ahl-say" data-ahora-quiet>
            {QUIET_SAY}
          </p>
        )}
        {view.why && (
          <p className="ahl-why" data-ahora-why title={view.why}>
            {view.why}
          </p>
        )}
        {view.returned && (
          <p className="ahl-why" data-ahora-returned>
            {view.returned}
          </p>
        )}
      </div>
    </div>
  );
};
