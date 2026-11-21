// PLA-I67-3: lessons on the Oficio page (sketch PLA-IDEA31 frames 2, 4, 5): the proposal waiting on the owner (amber,
// with their own words and the delivery they came from: Aprobar, Editar, Fue solo esa vez, No es una lección), the list
// of lessons it carries (each can be retired), the "reading your correction" line, and the teach bar at the bottom
// («Enséñale»: a rule, active at once; or a skill, which opens the new skill form).
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { words } from "@/lib/i18n";
import { dayLabel, skillWords, type Oficio } from "@/lib/oficio";
import { LESSON_WORDS } from "@/lib/oficio-lesson-words";
import { budgetShare, historyLine, lessonError, type Budget, type LessonAction, type LessonView, type LessonsRead } from "@/lib/oficio-lessons";
import { Btn, Label, Opt, useSingleFlight } from "./parts";

function useDecide(o: Oficio) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, text, applies_when, keep }: { id: string; action: LessonAction; text?: string; applies_when?: string | null; keep?: "new" | "old" }) =>
      api.decideLesson(o.project, o.agent, id, action, { ...(text !== undefined ? { text, applies_when } : {}), ...(keep ? { keep } : {}) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["lessons", o.project, o.agent] });
      void client.invalidateQueries({ queryKey: ["company"] });
    },
  });
}
const errOf = (e: unknown) => (e instanceof ApiError ? (e.code === "LESSON_CONFLICT" ? null : lessonError(e.code)) : e ? lessonError("NETWORK") : null);
// PLA-I67-5: the active lesson a proposal clashes with, from the refusal.
const conflictOf = (e: unknown): { id: string; text: string } | null =>
  e instanceof ApiError && e.code === "LESSON_CONFLICT" && e.detail.other && typeof e.detail.other === "object" ? (e.detail.other as { id: string; text: string }) : null;

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
      {/* Scrolls when the text is long, so it takes keyboard focus too. */}
      <div className="ofi-shelf-scroll ofi-skill-body" tabIndex={0} aria-label={w.proposalHead}>
        {editing ? (
          <>
            <div className="ofi-field">
              <label htmlFor={`ofi-lesson-${lesson.id}`}><Label>{w.editLabel}</Label></label>
              <textarea id={`ofi-lesson-${lesson.id}`} className="cor-textarea" rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <div className="ofi-field">
              <label htmlFor={`ofi-lesson-when-${lesson.id}`}><Label>{w.whenLabel}</Label></label>
              <input id={`ofi-lesson-when-${lesson.id}`} className="cor-input" maxLength={200} value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
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
      </div>
      {/* The decision stays in view however long the lesson and the owner's words are (seen live: a long correction
          pushed Aprobar under the card). Only the text above scrolls. */}
      <div className="ofi-proposal-foot">
        {conflictOf(decide.error) ? (
          <div className="ofi-confirm" role="group" aria-label={w.conflictAsk} data-conflict>
            <p className="cor-text">{w.conflictAsk}</p>
            <blockquote className="ofi-quote">{w.quote(conflictOf(decide.error)!.text)}</blockquote>
            <div className="ofi-actions ofi-actions-two">
              <Btn kind="primary" disabled={busy} onClick={() => decide.mutate({ id: lesson.id, action: "approve", keep: "new", ...(editing ? { text, applies_when: when } : {}) })} data-control="queda-nueva">
                {w.keepNew}
              </Btn>
              <Btn kind="secondary" disabled={busy} onClick={() => decide.mutate({ id: lesson.id, action: "approve", keep: "old" })} data-control="queda-antes">
                {w.keepOld}
              </Btn>
            </div>
          </div>
        ) : editing ? (
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

// PLA-I67-5: each lesson with its repeats (a suggestion to confirm, the owner's own mark), the flag after two with
// «Unirla a» a skill or «Volverla habilidad», and the 90-day retirement proposal with «Mantener».
const LessonItem = ({ o, x, skills }: { o: Oficio; x: LessonView; skills: { slug: string; name: string }[] }) => {
  const w = words(LESSON_WORDS);
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["lessons", o.project, o.agent] });
    void client.invalidateQueries({ queryKey: ["oficio", o.project, o.agent] });
  };
  const decide = useDecide(o);
  const [target, setTarget] = useState(skills[0]?.slug ?? "");
  const repeat = useMutation({ mutationFn: useSingleFlight(() => api.markRepeat(o.project, o.agent, x.id)), onSuccess: refresh });
  const confirm = useMutation({ mutationFn: useSingleFlight(({ rid, yes }: { rid: string; yes: boolean }) => api.confirmRepeat(o.project, o.agent, rid, yes)), onSuccess: refresh });
  const merge = useMutation({ mutationFn: useSingleFlight((skill: string | null) => api.mergeLesson(o.project, o.agent, x.id, skill)), onSuccess: refresh });
  const keep = useMutation({ mutationFn: useSingleFlight(() => api.keepLesson(o.project, o.agent, x.id)), onSuccess: refresh });
  const busy = decide.isPending || repeat.isPending || confirm.isPending || merge.isPending || keep.isPending;
  const err = errOf(decide.error ?? repeat.error ?? confirm.error ?? merge.error ?? keep.error);
  const r = x.repeats;
  return (
    <li data-lesson-item={x.id}>
      <span className="ofi-lesson-text">{x.text}</span>
      <span className="ofi-lesson-foot">
        <span className="cor-cap">
          {x.proposed_by === "owner" ? w.byYou : w.byCorrection} · {w.carried(x.carried)}
          {r?.confirmed ? ` · ${w.repeated(r.confirmed)}` : ""}
        </span>
        <span className="ofi-lesson-acts">
          <Btn kind="link" disabled={busy} onClick={() => repeat.mutate()} aria-label={w.markRepeatOf(x.text)} data-control={`repetida-${x.id}`}>
            {w.markRepeat}
          </Btn>
          <Btn kind="link" disabled={busy} onClick={() => decide.mutate({ id: x.id, action: "retire" })} aria-label={w.retireOf(x.text)} data-control={`retirar-${x.id}`}>
            {w.retire}
          </Btn>
        </span>
      </span>
      {r?.suggested.map((s) => (
        <span key={s.id} className="ofi-lesson-ask" data-suggested={s.id}>
          <span className="cor-cap">{w.suggested(s.task_key)}</span>
          <Btn kind="link" disabled={busy} onClick={() => confirm.mutate({ rid: s.id, yes: true })} data-control={`repite-si-${s.id}`}>
            {w.yes}
          </Btn>
          <Btn kind="link" disabled={busy} onClick={() => confirm.mutate({ rid: s.id, yes: false })} data-control={`repite-no-${s.id}`}>
            {w.no}
          </Btn>
        </span>
      ))}
      {r?.flagged && (
        <div className="ofi-flag" data-flagged={x.id}>
          <p className="cor-cap">
            <b>{w.notHolding(r.confirmed)}</b>
          </p>
          <div className="ofi-actions">
            {skills.length > 0 && (
              <>
                <select className="cor-select ofi-merge-pick" aria-label={w.mergeInto} value={target} onChange={(e) => setTarget(e.target.value)} data-control={`unir-a-${x.id}`}>
                  {skills.map((s) => (
                    <option key={s.slug} value={s.slug}>
                      {`${w.mergeInto} ${s.name}`}
                    </option>
                  ))}
                </select>
                <Btn kind="secondary" disabled={busy || !target} onClick={() => merge.mutate(target)} data-control={`unir-${x.id}`}>
                  {w.mergeBtn}
                </Btn>
              </>
            )}
            <Btn kind="link" disabled={busy} onClick={() => merge.mutate(null)} data-control={`habilidad-${x.id}`}>
              {w.toSkill}
            </Btn>
          </div>
        </div>
      )}
      {x.retire_due && (
        <div className="ofi-flag" data-retire-due={x.id}>
          <p className="cor-cap">{w.unusedLong}</p>
          <div className="ofi-actions">
            <Btn kind="secondary" disabled={busy} onClick={() => decide.mutate({ id: x.id, action: "retire" })} data-control={`retirar-viejo-${x.id}`}>
              {w.retire}
            </Btn>
            <Btn kind="link" disabled={busy} onClick={() => keep.mutate()} data-control={`mantener-${x.id}`}>
              {w.keep}
            </Btn>
          </div>
        </div>
      )}
      {merge.isSuccess && <span className="cor-cap" role="status">{w.merged(merge.data.skill)}</span>}
      {err && <span className="cor-state bad">{err}</span>}
    </li>
  );
};

export const LessonsPanel = ({ o, l, onClose }: { o: Oficio; l: LessonsRead | undefined; onClose: () => void }) => {
  const w = words(LESSON_WORDS);
  const active = (l?.lessons ?? []).filter((x) => x.state === "active");
  const skills = o.skills.filter((s) => s.on).map((s) => ({ slug: s.slug, name: skillWords(s).name }));
  return (
    <section className="cor-card ofi-side-card ofi-skill" aria-label={w.listTitle} data-lessons-panel>
      <div className="ofi-side-head">
        <Label as="h3">{w.listTitle}</Label>
        <Btn kind="quiet" small onClick={onClose} aria-label="×" data-control="cerrar-panel">
          ×
        </Btn>
      </div>
      {l?.budget?.over && <p className="cor-cap cor-state warn" data-over>{w.budgetOver}</p>}
      <div className="ofi-shelf-scroll">
        {active.length === 0 ? (
          <p className="cor-text cor-muted">{w.none}</p>
        ) : (
          <ul className="ofi-shelf-list">
            {active.map((x) => (
              <LessonItem key={x.id} o={o} x={x} skills={skills} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

export const BudgetBar = ({ b }: { b: Budget | undefined }) => {
  const w = words(LESSON_WORDS);
  if (!b) return null;
  return (
    <div className="ofi-budget" data-budget={`${b.used}/${b.budget}`}>
      <span className="ofi-budget-head">
        <Label>{w.budget}</Label>
        <span className="cor-cap">{w.budgetLine(b.used, b.budget)}</span>
      </span>
      <span className={`ofi-budget-bar ${b.over ? "over" : ""}`} role="img" aria-label={w.budgetLine(b.used, b.budget)}>
        <i style={{ width: `${Math.round(budgetShare(b) * 100)}%` }} />
      </span>
      <span className="cor-cap">{w.budgetParts(b.role, b.manner, b.skills, b.lessons)}</span>
      {b.over && <span className="cor-cap cor-state warn">{w.budgetOver}</span>}
    </div>
  );
};

export const HistoryPanel = ({ l, onClose, now, timeZone }: { l: LessonsRead | undefined; onClose: () => void; now: number; timeZone?: string }) => {
  const w = words(LESSON_WORDS);
  const list = l?.history ?? [];
  return (
    <section className="cor-card ofi-side-card ofi-skill" aria-label={w.historyTitle} data-history>
      <div className="ofi-side-head">
        <Label as="h3">{w.historyTitle}</Label>
        <Btn kind="quiet" small onClick={onClose} aria-label="×" data-control="cerrar-panel">
          ×
        </Btn>
      </div>
      {/* PLA-I71: the section already names it; a second region of the same name is a duplicate landmark. */}
      <div className="ofi-shelf-scroll" tabIndex={0}>
        {list.length === 0 ? (
          <p className="cor-text cor-muted">{w.historyNone}</p>
        ) : (
          <ul className="ofi-history">
            {list.map((h, i) => (
              <li key={i}>
                <span className="cor-cap ofi-history-at">{dayLabel(h.at, now, timeZone)}</span>
                <span>{historyLine(h)}</span>
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
    mutationFn: useSingleFlight(() => api.teachRule(o.project, o.agent, text)),
    onSuccess: () => {
      setText("");
      void client.invalidateQueries({ queryKey: ["lessons", o.project, o.agent] });
    },
  });
  const err = errOf(teach.error);
  // PLA-141: «Lista…» is said once; it stayed on after the lesson was retired.
  useEffect(() => {
    if (!teach.isSuccess) return;
    const t = window.setTimeout(() => teach.reset(), 6000);
    return () => window.clearTimeout(t);
  }, [teach.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
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
      <input className="cor-input ofi-teach-input" aria-label={w.ruleLabel(seat)} placeholder={w.rulePlaceholder(seat)} maxLength={300} value={text} onChange={(e) => (setText(e.target.value), teach.isSuccess && teach.reset())} data-control="regla" />
      <span className="cor-cap ofi-teach-status" role="status">
        {teach.isPending ? "…" : err ? <span className="cor-state bad">{err}</span> : teach.isSuccess ? w.taught : ""}
      </span>
      <Btn kind="secondary" type="submit" disabled={teach.isPending || text.trim().length < 3} data-control="ensenar">
        {w.teachBtn}
      </Btn>
    </form>
  );
};
