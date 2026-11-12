// PLA-I39-5: a decision hangs under the window of the teammate who asked it, with a notch pointing at that window.
// Its body is Te toca's row body (DecisionBody in v2.tsx), so every kind keeps its actions, evidence, links and hold
// line. On a Mac it sits in a row under the windows; on a phone under the asker's row (CSS order, two columns).
// Two or more from one asker: the oldest shows and "+N más" lists the rest. The app's dark tokens apply inside,
// so the bubble reads on the night panel in both themes.
import type { CSSProperties } from "react";
import type { Decision, DecisionInput } from "@/lib/api";
import type { Hanging } from "@/lib/edificio";
import { roleName } from "@/lib/org";
import { DecisionBody, type DecisionBusy } from "@/components/compania/v2";

export const WIDE_COLS = 5;
export const PHONE_COLS = 2;
// Where the bubble goes in the windows' grid (after the asker's row) and where its notch points, per layout.
export function bubblePlace(index: number, count: number) {
  const at = (cols: number) => {
    const rowEnd = Math.min(count - 1, Math.floor(index / cols) * cols + cols - 1);
    return { order: rowEnd * 2 + 1, nx: (((index % cols) + 0.5) / cols) * 100 };
  };
  const wide = at(WIDE_COLS);
  const phone = at(PHONE_COLS);
  return { "--o-wide": wide.order, "--o-phone": phone.order, "--nx-wide": `${wide.nx}%`, "--nx-phone": `${phone.nx}%` } as CSSProperties;
}

export type QuestionActs = {
  now: number;
  busy: DecisionBusy;
  errors?: Record<string, string>;
  opened?: string | null;
  disabled?: boolean;
  onAct: (d: Decision, input: DecisionInput, key: string) => void;
};

export const Question = ({ hanging, role, anchor, style, acts }: { hanging: Hanging; role: string; anchor?: string; style?: CSSProperties; acts: QuestionActs }) => {
  const d = hanging.decision;
  const body = (x: Decision) => (
    <DecisionBody key={x.id} d={x} now={acts.now} busy={acts.busy} error={acts.errors?.[x.id] ?? null} opened={acts.opened === x.id} onAct={acts.onAct} />
  );
  return (
    <div
      id={anchor}
      className="dark edi-bubble"
      data-bubble={d.id}
      data-kind={d.kind}
      data-asker={d.asker?.agent}
      data-acted={d.state ? "1" : undefined}
      style={style}
      inert={acts.disabled || undefined}
    >
      <p className="edi-bq">
        {roleName(role)} {d.state ? "te preguntó" : "te pregunta"}
      </p>
      {body(d)}
      {hanging.more.length > 0 && (
        <details className="edi-more" data-more={hanging.more.length}>
          <summary>+{hanging.more.length} más</summary>
          <div className="edi-more-list">
            {hanging.more.map((m) => (
              <div key={m.id} className="edi-more-row">
                {body(m)}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

// A decision nobody on a team asked (a release, a manual step), opened from its roof chip.
export const RoofQuestion = ({ d, title, acts }: { d: Decision; title: string; acts: QuestionActs }) => (
  <div className="dark edi-bubble edi-roof-q" data-bubble={d.id} data-kind={d.kind} inert={acts.disabled || undefined}>
    <p className="edi-bq">{title}</p>
    <DecisionBody d={d} now={acts.now} busy={acts.busy} error={acts.errors?.[d.id] ?? null} opened={acts.opened === d.id} onAct={acts.onAct} />
  </div>
);
