// PLA-I67-2: the side panel's skill parts on the Oficio page (sketch PLA-IDEA31 frames 3, 8, 9): the skill card (name,
// when, what, for whom, its use, versions with what changed and roll back, duplicate, delete into a 30-day archive),
// the new skill form, and «Su puesto y tu manera» (the owner's text for this agent, its motor, the limits it cannot
// change). Each sits in the 320px side column and scrolls inside itself, so the page keeps one screen.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { words } from "@/lib/i18n";
import { skillWords, shelfNext, type Oficio } from "@/lib/oficio";
import { SKILL_CARD_WORDS, PUESTO_WORDS } from "@/lib/oficio-skill-words";
import { cardHead, changedOnly, draftChanged, saveError, scopeOptions, versionDiff, versionNote, type SkillCard, type SkillDraft, type SkillScope } from "@/lib/oficio-skills";
import { Btn, Label, ReadError, Switch, useSingleFlight } from "./parts";
import { LinkUpdate } from "./oficio-trial";
import { TRIAL_WORDS } from "@/lib/oficio-trial-words";

const errOf = (e: unknown): string | null => (e instanceof ApiError ? saveError(e.code, typeof e.detail.field === "string" ? e.detail.field : null) : e ? saveError("NETWORK") : null);

function useRefresh(o: Oficio) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["oficio", o.project, o.agent] });
    void client.invalidateQueries({ queryKey: ["skill", o.project, o.agent] });
    void client.invalidateQueries({ queryKey: ["puesto", o.project, o.agent] });
    void client.invalidateQueries({ queryKey: ["company"] });
  };
}

const Head = ({ label, onClose, children }: { label: string; onClose: () => void; children?: React.ReactNode }) => {
  const w = words(SKILL_CARD_WORDS);
  return (
    <div className="ofi-side-head">
      <Label as="h3">{label}</Label>
      <span className="ofi-side-tools">
        {children}
        <Btn kind="quiet" small onClick={onClose} aria-label={w.close} data-control="cerrar-panel">
          ×
        </Btn>
      </span>
    </div>
  );
};

const Fields = ({ d, set, seat, idPrefix }: { d: SkillDraft; set: (d: SkillDraft) => void; seat: string; idPrefix: string }) => {
  const w = words(SKILL_CARD_WORDS);
  return (
    <>
      <div className="ofi-field">
        <label htmlFor={`${idPrefix}-name`}><Label>{w.name}</Label></label>
        <input id={`${idPrefix}-name`} className="cor-input" value={d.name} maxLength={80} placeholder={w.namePlaceholder} onChange={(e) => set({ ...d, name: e.target.value })} />
      </div>
      <div className="ofi-field">
        <label htmlFor={`${idPrefix}-when`}><Label>{w.when}</Label></label>
        <textarea id={`${idPrefix}-when`} className="cor-textarea" rows={2} value={d.description} maxLength={1024} placeholder={w.whenPlaceholder} onChange={(e) => set({ ...d, description: e.target.value })} />
      </div>
      <div className="ofi-field">
        <label htmlFor={`${idPrefix}-what`}><Label>{w.what}</Label></label>
        <textarea id={`${idPrefix}-what`} className="cor-textarea ofi-mono" rows={4} value={d.body} placeholder={w.whatPlaceholder} onChange={(e) => set({ ...d, body: e.target.value })} />
      </div>
      <div className="ofi-field">
        <label htmlFor={`${idPrefix}-scope`}><Label>{w.forWhom}</Label></label>
        <select id={`${idPrefix}-scope`} className="cor-select" value={d.scope} onChange={(e) => set({ ...d, scope: e.target.value as SkillScope })}>
          {scopeOptions(seat).map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
};

const Diff = ({ card, onBack, onRollback, busy }: { card: SkillCard; onBack: () => void; onRollback: (n: number) => void; busy: boolean }) => {
  const w = words(SKILL_CARD_WORDS);
  const latest = card.versions[0]?.n ?? 1;
  const [n, setN] = useState(latest);
  const v = card.versions.find((x) => x.n === n) ?? card.versions[0]!;
  const prev = card.versions.find((x) => x.n === v.n - 1) ?? null;
  const lines = useMemo(() => changedOnly(versionDiff(prev, v)), [prev, v]);
  return (
    <>
      <div className="ofi-field ofi-field-row">
        <label htmlFor="ofi-diff-n"><Label>{w.diffPick}</Label></label>
        <select id="ofi-diff-n" className="cor-select" value={n} onChange={(e) => setN(Number(e.target.value))}>
          {card.versions.map((x) => (
            <option key={x.n} value={x.n}>
              {`${w.version(x.n)}${versionNote(x) ? ` · ${versionNote(x)}` : ""}`}
            </option>
          ))}
        </select>
      </div>
      <p className="cor-cap">{prev ? w.diffTitle(v.n) : w.diffFirst}</p>
      <pre className="ofi-diff" data-diff={v.n} aria-label={prev ? w.diffTitle(v.n) : w.diffFirst}>
        {prev && lines.length === 0 ? (
          <span className="cor-muted">{w.diffNone}</span>
        ) : (
          lines.map((l, i) =>
            l.kind === "gap" ? (
              <span key={i} className="ofi-diff-gap">
                {"…\n"}
              </span>
            ) : (
              <span key={i} className={`ofi-diff-${l.kind}`}>
                {`${l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}${l.text}\n`}
              </span>
            ),
          )
        )}
      </pre>
      <div className="ofi-actions">
        {v.n !== latest && (
          <Btn kind="secondary" disabled={busy} onClick={() => onRollback(v.n)} data-control="volver-a-version">
            {w.backTo(v.n)}
          </Btn>
        )}
        <Btn kind="quiet" onClick={onBack} data-control="cerrar-diff">
          {w.diffBack}
        </Btn>
      </div>
    </>
  );
};

export const SkillPanel = ({ o, seat, slug, onClose, onOpen, onTry }: { o: Oficio; seat: string; slug: string; onClose: () => void; onOpen: (slug: string) => void; onTry?: (slug: string) => void }) => {
  const w = words(SKILL_CARD_WORDS);
  const refresh = useRefresh(o);
  const q = useQuery({ queryKey: ["skill", o.project, o.agent, slug], queryFn: () => api.skillCard(o.project, o.agent, slug) });
  const card = q.data;
  const shown = card ? skillWords({ slug: card.slug, name: card.name, when: card.when, source: card.source }) : null;
  const blank: SkillDraft = { name: "", description: "", body: "", scope: "agent" };
  const [d, setD] = useState<SkillDraft>(blank);
  const [mode, setMode] = useState<"card" | "diff" | "remove">("card");
  useEffect(() => {
    if (card) setD({ name: shown!.name, description: card.when, body: card.body, scope: card.scope ?? "agent" });
    // Re-seed only when another version or skill arrives, never while the owner types.
  }, [card?.version, card?.scope, slug]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setMode("card"), [slug]);
  const done = (next?: SkillCard) => {
    refresh();
    if (next && next.slug !== slug) onOpen(next.slug);
  };
  const save = useMutation({ mutationFn: useSingleFlight(() => api.editSkill(o.project, o.agent, slug, d)), onSuccess: (c) => done(c) });
  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      if (card?.source === "owner") return api.setSkillOn(o.project, o.agent, slug, on);
      await api.setSeatPacks(o.project, o.agent, shelfNext(o.skills.filter((s) => s.on && !s.owner).map((s) => s.slug), slug, on));
      return undefined;
    },
    onSuccess: () => done(),
  });
  const rollback = useMutation({ mutationFn: useSingleFlight((n: number) => api.rollbackSkill(o.project, o.agent, slug, n)), onSuccess: () => (setMode("card"), done()) });
  const dup = useMutation({ mutationFn: useSingleFlight(() => api.duplicateSkill(o.project, o.agent, slug)), onSuccess: (c) => done(c) });
  const remove = useMutation({ mutationFn: useSingleFlight(() => api.deleteSkill(o.project, o.agent, slug)), onSuccess: () => (refresh(), onClose()) });
  const busy = save.isPending || toggle.isPending || rollback.isPending || dup.isPending || remove.isPending;
  const err = errOf(save.error ?? toggle.error ?? rollback.error ?? dup.error ?? remove.error);
  const use = o.skills.find((s) => s.slug === slug);
  const n = card?.n ?? null;
  if (q.isError) return <ReadError what={w.readError} onRetry={() => void q.refetch()} />;
  return (
    <section className="cor-card ofi-side-card ofi-skill" aria-label={shown?.name ?? slug} data-skill-card={slug}>
      <Head label={card ? cardHead(card) : w.loading} onClose={onClose}>
        {card && card.state !== "archived" && <Switch on={card.on} label={w.switchLabel} disabled={busy} onChange={(on) => toggle.mutate(on)} data-control="prender-habilidad" />}
      </Head>
      {!card ? (
        <p className="cor-cap" role="status" aria-busy="true">
          {w.loading}
        </p>
      ) : (
        <div className="ofi-shelf-scroll ofi-skill-body">
          {mode === "diff" ? (
            <Diff card={card} onBack={() => setMode("card")} onRollback={(v) => rollback.mutate(v)} busy={busy} />
          ) : (
            <>
              {card.source !== "owner" && <p className="cor-cap">{w.factoryHint}</p>}
              {card.factory_changed && <p className="cor-cap cor-state warn">{w.factoryChanged}</p>}
              {!card.on && <p className="cor-cap">{w.off}</p>}
              <Fields d={d} set={setD} seat={seat} idPrefix={`ofi-skill-${slug}`} />
              <p className="cor-cap">{use && use.deliveries_carried ? w.usedIn(use.deliveries_used, use.deliveries_carried) : w.notUsedYet}</p>
              <p className="cor-cap" role="status">
                {busy ? w.saving : err ? <span className="cor-state bad">{err}</span> : save.isSuccess ? w.saved : ""}
              </p>
              {mode === "remove" ? (
                <div className="ofi-confirm" role="group" aria-label={w.remove}>
                  <p className="cor-text">{w.removeAsk}</p>
                  <div className="ofi-actions">
                    <Btn kind="danger" disabled={busy} onClick={() => remove.mutate()} data-control="borrar-si">
                      {w.removeYes}
                    </Btn>
                    <Btn kind="quiet" onClick={() => setMode("card")} data-control="borrar-no">
                      {w.removeNo}
                    </Btn>
                  </div>
                </div>
              ) : (
                <>
                  {/* PLA-I67-6: «Probar» beside «Guardar» (sketch frame 3): it tries the saved version of an owner skill. */}
                  <div className="ofi-actions-two">
                    <Btn kind="primary" disabled={busy || !draftChanged({ ...card, name: shown!.name }, d)} onClick={() => save.mutate()} data-control="guardar-habilidad">
                      {w.save}
                    </Btn>
                    <Btn
                      kind="secondary"
                      disabled={busy || card.source !== "owner" || draftChanged({ ...card, name: shown!.name }, d) || !onTry}
                      title={card.source !== "owner" || draftChanged({ ...card, name: shown!.name }, d) ? words(TRIAL_WORDS).tryHint : undefined}
                      onClick={() => onTry?.(slug)}
                      data-control="probar"
                    >
                      {words(TRIAL_WORDS).try}
                    </Btn>
                  </div>
                  {(card.source !== "owner" || draftChanged({ ...card, name: shown!.name }, d)) && <p className="cor-cap">{words(TRIAL_WORDS).tryHint}</p>}
                  <LinkUpdate o={o} card={card} />
                  <div className="ofi-links">
                    {n && n > 1 && (
                      <Btn kind="link" onClick={() => setMode("diff")} data-control="que-cambio">
                        {w.whatChanged(n)}
                      </Btn>
                    )}
                    {n && n > 1 && (
                      <Btn kind="link" disabled={busy} onClick={() => rollback.mutate(n - 1)} data-control="volver-anterior">
                        {w.backTo(n - 1)}
                      </Btn>
                    )}
                    <Btn kind="link" disabled={busy} onClick={() => dup.mutate()} data-control="duplicar">
                      {w.duplicate}
                    </Btn>
                    {card.source === "owner" && (
                      <Btn kind="link" className="bad" onClick={() => setMode("remove")} data-control="borrar">
                        {w.remove}
                      </Btn>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
};

export const NewSkillPanel = ({ o, seat, onClose, onOpen }: { o: Oficio; seat: string; onClose: () => void; onOpen: (slug: string) => void }) => {
  const w = words(SKILL_CARD_WORDS);
  const refresh = useRefresh(o);
  const [d, setD] = useState<SkillDraft>({ name: "", description: "", body: "", scope: "agent" });
  const make = useMutation({
    mutationFn: useSingleFlight(() => api.createSkill(o.project, o.agent, d)),
    onSuccess: (c) => {
      refresh();
      onOpen(c.slug);
    },
  });
  const ready = d.name.trim() && d.description.trim() && d.body.trim();
  return (
    <section className="cor-card ofi-side-card ofi-skill" aria-label={w.newTitle} data-new-skill>
      <Head label={w.newTitle} onClose={onClose} />
      <div className="ofi-shelf-scroll ofi-skill-body">
        <p className="cor-cap">{w.newHint}</p>
        <Fields d={d} set={setD} seat={seat} idPrefix="ofi-new" />
        <p className="cor-cap" role="status">
          {make.isPending ? w.creating : make.error ? <span className="cor-state bad">{errOf(make.error)}</span> : ""}
        </p>
        <Btn kind="primary" className="ofi-wide" disabled={!ready || make.isPending} onClick={() => make.mutate()} data-control="crear-habilidad">
          {w.create}
        </Btn>
      </div>
    </section>
  );
};

export const PuestoPanel = ({ o, seat, motorLink, onClose }: { o: Oficio; seat: string; motorLink: string; onClose: () => void }) => {
  const w = words(PUESTO_WORDS);
  const refresh = useRefresh(o);
  const q = useQuery({ queryKey: ["puesto", o.project, o.agent], queryFn: () => api.puesto(o.project, o.agent) });
  const [text, setText] = useState("");
  useEffect(() => setText(q.data?.manner ?? ""), [q.data?.manner_version, o.agent]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({ mutationFn: useSingleFlight(() => api.setManner(o.project, o.agent, text)), onSuccess: () => refresh() });
  const err = save.error instanceof ApiError ? (save.error.code === "TOO_LARGE" ? w.tooLong : w.notAllowed) : null;
  const motor = q.data?.motor;
  return (
    <section className="cor-card ofi-side-card ofi-skill" aria-label={w.title} data-puesto>
      <Head label={w.title} onClose={onClose} />
      {q.isError ? (
        <ReadError what={w.title} onRetry={() => void q.refetch()} />
      ) : (
        <div className="ofi-shelf-scroll ofi-skill-body">
          <h4 className="ofi-puesto-seat">{seat}</h4>
          <p className="cor-cap">{w.roleLine}</p>
          <div className="ofi-field">
            <label htmlFor="ofi-manner"><Label>{w.manner}</Label></label>
            <textarea id="ofi-manner" className="cor-textarea" rows={4} maxLength={2000} value={text} placeholder={w.mannerPlaceholder} onChange={(e) => setText(e.target.value)} />
          </div>
          <p className="cor-cap">{w.mannerHint}</p>
          <div>
            <Label as="p">{w.motor}</Label>
            <p className="cor-text ofi-motor">
              {motor?.model ? `${motor.model}${motor.effort ? ` · ${w.effort(motor.effort)}` : ""}` : w.motorDefault}{" "}
              <Link to={motorLink} className="cor-btn link ofi-inline-link" data-control="motor-puesto">
                {w.motorChange}
              </Link>
            </p>
          </div>
          <div>
            <Label as="p">{w.limits}</Label>
            <ul className="ofi-limits">
              <li>{w.limit1}</li>
              <li>{w.limit2}</li>
              <li>{w.limit3}</li>
            </ul>
          </div>
          <p className="cor-cap" role="status">
            {save.isPending ? w.saving : err ? <span className="cor-state bad">{err}</span> : save.isSuccess ? w.saved : ""}
          </p>
          <Btn kind="primary" className="ofi-wide" disabled={save.isPending || !q.data || text.trim() === (q.data.manner ?? "").trim()} onClick={() => save.mutate()} data-control="guardar-manera">
            {w.save}
          </Btn>
        </div>
      )}
    </section>
  );
};
