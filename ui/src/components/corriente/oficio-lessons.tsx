// PLA-I67-3: lessons on the Oficio page (sketch PLA-IDEA31 frames 2, 4, 5): the proposal waiting on the owner (amber,
// with their own words and the delivery they came from: Aprobar, Editar, Fue solo esa vez, No es una lección), the list
// of lessons it carries (each can be retired), the "reading your correction" line, and the teach bar at the bottom
// («Enséñale»: a rule, active at once; or a skill, which opens the new skill form).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { words } from "@/lib/i18n";
import type { Oficio } from "@/lib/oficio";
import { LESSON_WORDS } from "@/lib/oficio-lesson-words";
import { lessonError, type LessonAction, type LessonView, type LessonsRead } from "@/lib/oficio-lessons";
import { Btn, Label, Opt } from "./parts";

function useDecide(o: Oficio) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, text, applies_when }: { id: string; action: LessonAction; text?: string; applies_when?: string | null }) =>
      api.decideLesson(o.project, o.agent, id, action, text !== undefined ? { text, applies_when } : {}),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["lessons", o.project, o.agent] });
      void client.invalidateQueries({ queryKey: ["company"] });
    },
  });
}
const errOf = (e: unknown) => (e instanceof ApiError ? lessonError(e.code) : e ? lessonError("NETWORK") : null);

export const Reading = ({ l }: { l: LessonsRead | undefined }) => {
  const w = words(LESSON_WORDS);
  if (!l?.reading.length) return null;
  return (
    <p className="cor-cap ofi-reading" role="status" data-reading>
      <i className="ofi-reading-dot" aria-hidden /> {w.reading(l.reading[0]!.task_key)}
    </p>
  );
};

export const ProposalCard = ({ o, seat, lesson, onClose }: { o: Oficio; seat: string; lesson: LessonView; onClose?: () => void }) => {
  const w = words(LESSON_WORDS);
  const decide = useDecide(o);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lesson.text);
  const [when, setWhen] = useState(lesson.applies_when ?? "");
  const busy = decide.isPending;
  const err = errOf(decide.error);
  return (
    <section className="cor-card ofi-side-card ofi-proposal" aria-label={w.proposalHead} data-proposal={lesson.id}>
      <div className="ofi-side-head">
        <Label as="h3" tone="amber">
          {w.proposalHead}
        </Label>
        {onClose && (
          <Btn kind="quiet" small onClick={onClose} aria-label="×" data-control="cerrar-propuesta">
            ×
          </Btn>
        )}
      </div>
      <div className="ofi-shelf-scroll ofi-skill-body">
        {editing ? (
          <>
            <label className="ofi-field" htmlFor={`ofi-lesson-${lesson.id}`}>
              <Label>{w.editLabel}</Label>
              <textarea id={`ofi-lesson-${lesson.id}`} className="cor-textarea" rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <label className="ofi-field" htmlFor={`ofi-lesson-when-${lesson.id}`}>
              <Label>{w.whenLabel}</Label>
              <input id={`ofi-lesson-when-${lesson.id}`} className="cor-input" maxLength={200} value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
          </>
        ) : (
          <p className="ofi-proposal-text">{lesson.text}</p>
        )}
        {lesson.owner_words ? (
          <>
            <p className="cor-cap">{w.fromCorrection(lesson.task_title ?? lesson.task_key ?? "")}</p>
            <blockquote className="ofi-quote ofi-quote-amber">{w.quote(lesson.owner_words)}</blockquote>
          </>
        ) : (
          <p className="cor-cap">{w.fromYou}</p>
        )}
        {lesson.conflicts_with && <p className="cor-cap cor-state warn">{w.conflicts(lesson.conflicts_with.text)}</p>}
        <p className="cor-cap">{w.wouldApply(seat)}</p>
        <p className="cor-cap" role="status">
          {busy ? w.deciding : err ? <span className="cor-state bad">{err}</span> : ""}
        </p>
        {editing ? (
          <div className="ofi-actions">
            <Btn kind="primary" disabled={busy || text.trim().length < 3} onClick={() => decide.mutate({ id: lesson.id, action: "approve", text, applies_when: when })} data-control="aprobar-editada">
              {w.approveEdited}
            </Btn>
            <Btn kind="quiet" onClick={() => setEditing(false)} data-control="cancelar-edicion">
              {w.cancelEdit}
            </Btn>
          </div>
        ) : (
          <>
            <div className="ofi-actions ofi-actions-two">
              <Btn kind="primary" disabled={busy} onClick={() => decide.mutate({ id: lesson.id, action: "approve" })} data-control="aprobar-leccion">
                {w.approve}
              </Btn>
              <Btn kind="secondary" disabled={busy} onClick={() => setEditing(true)} data-control="editar-leccion">
                {w.edit}
              </Btn>
            </div>
            <div className="ofi-links">
              <Btn kind="link" disabled={busy} onClick={() => decide.mutate({ id: lesson.id, action: "one-off" })} data-control="solo-esa-vez">
                {w.once}
              </Btn>
              <Btn kind="link" disabled={busy} onClick={() => decide.mutate({ id: lesson.id, action: "reject" })} data-control="no-es-leccion">
                {w.reject}
              </Btn>
            </div>
          </>
        )}
      </div>
    </section>
  );
};

export const LessonsPanel = ({ o, l, onClose }: { o: Oficio; l: LessonsRead | undefined; onClose: () => void }) => {
  const w = words(LESSON_WORDS);
  const decide = useDecide(o);
  const active = (l?.lessons ?? []).filter((x) => x.state === "active");
  return (
    <section className="cor-card ofi-side-card ofi-skill" aria-label={w.listTitle} data-lessons-panel>
      <div className="ofi-side-head">
        <Label as="h3">{w.listTitle}</Label>
        <Btn kind="quiet" small onClick={onClose} aria-label="×" data-control="cerrar-panel">
          ×
        </Btn>
      </div>
      <div className="ofi-shelf-scroll">
        {active.length === 0 ? (
          <p className="cor-text cor-muted">{w.none}</p>
        ) : (
          <ul className="ofi-shelf-list">
            {active.map((x) => (
              <li key={x.id} data-lesson-item={x.id}>
                <span className="ofi-lesson-text">{x.text}</span>
                <span className="ofi-lesson-foot">
                  <span className="cor-cap">
                    {x.proposed_by === "owner" ? w.byYou : w.byCorrection} · {w.carried(x.carried)}
                  </span>
                  <Btn kind="link" disabled={decide.isPending} onClick={() => decide.mutate({ id: x.id, action: "retire" })} aria-label={w.retireOf(x.text)} data-control={`retirar-${x.id}`}>
                    {w.retire}
                  </Btn>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

export const TeachBar = ({ o, seat, onSkill }: { o: Oficio; seat: string; onSkill: () => void }) => {
  const w = words(LESSON_WORDS);
  const client = useQueryClient();
  const [text, setText] = useState("");
  const teach = useMutation({
    mutationFn: () => api.teachRule(o.project, o.agent, text),
    onSuccess: () => {
      setText("");
      void client.invalidateQueries({ queryKey: ["lessons", o.project, o.agent] });
    },
  });
  const err = errOf(teach.error);
  return (
    <form
      className="ofi-teach"
      aria-label={w.teach}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim().length >= 3) teach.mutate();
      }}
      data-teach
    >
      <Label>{w.teach}</Label>
      <div className="ofi-teach-modes" role="group" aria-label={w.teach}>
        <Opt on onClick={() => undefined} data-control="ensenar-regla">
          {w.modeRule}
        </Opt>
        <Opt on={false} onClick={onSkill} data-control="ensenar-habilidad">
          {w.modeSkill}
        </Opt>
      </div>
      <input className="cor-input ofi-teach-input" aria-label={w.ruleLabel(seat)} placeholder={w.rulePlaceholder(seat)} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} data-control="regla" />
      <span className="cor-cap ofi-teach-status" role="status">
        {teach.isPending ? "…" : err ? <span className="cor-state bad">{err}</span> : teach.isSuccess ? w.taught : ""}
      </span>
      <Btn kind="secondary" type="submit" disabled={teach.isPending || text.trim().length < 3} data-control="ensenar">
        {w.teachBtn}
      </Btn>
    </form>
  );
};
