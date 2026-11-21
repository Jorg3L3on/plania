// PLA-I67-6: «Probar» and «Traer de un enlace» on the Oficio page (sketch PLA-IDEA31 frames 3 and 8).
//   TrialPanel   the side column: the delivery to repeat, «Probar con la vN» (it says it uses plan), and this skill's
//                trials. Opening one shows TrialCompare in the drawing's place.
//   TrialCompare before and after side by side: what each run said and changed, and the version each carried. It
//                reads itself again while the trial waits or runs.
//   ImportPanel  a link → every file as fetched → «Guardar apagada».
//   LinkUpdate   on an imported skill's card: look at the link again, see the diff, accept or keep.
// Each sits in the existing columns and scrolls inside itself, so the page keeps one screen.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { words } from "@/lib/i18n";
import { dayLabel, type Oficio } from "@/lib/oficio";
import { changedOnly, scopeOptions, type SkillCard, type SkillScope } from "@/lib/oficio-skills";
import { IMPORT_WORDS, TRIAL_WORDS } from "@/lib/oficio-trial-words";
import { SKILL_CARD_WORDS } from "@/lib/oficio-skill-words";
import { hostOf, importError, othersCount, stampWords, trialError, trialLine, trialLive, updateDiff, type ImportPreview, type TrialView, type UpdateCheck } from "@/lib/oficio-trials";
import { Btn, Label, ReadError, useSingleFlight } from "./parts";

const codeOf = (e: unknown): string | null => (e instanceof ApiError ? e.code : e ? "NETWORK" : null);

const SideHead = ({ label, onClose, closeLabel }: { label: string; onClose: () => void; closeLabel: string }) => (
  <div className="ofi-side-head">
    <Label as="h3">{label}</Label>
    <Btn kind="quiet" small onClick={onClose} aria-label={closeLabel} data-control="cerrar-panel">
      ×
    </Btn>
  </div>
);

const DiffBlock = ({ lines, label }: { lines: ReturnType<typeof changedOnly>; label: string }) => (
  <pre className="ofi-diff" aria-label={label}>
    {lines.map((l, i) =>
      l.kind === "gap" ? (
        <span key={i} className="ofi-diff-gap">
          {"…\n"}
        </span>
      ) : (
        <span key={i} className={`ofi-diff-${l.kind}`}>
          {`${l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}${l.text}\n`}
        </span>
      ),
    )}
  </pre>
);

// ---- Probar

export const TrialPanel = ({ o, slug, name, n, onClose, onShow, now, timeZone }: { o: Oficio; slug: string; name: string; n: number; onClose: () => void; onShow: (id: string) => void; now: number; timeZone?: string }) => {
  const w = words(TRIAL_WORDS);
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ["trials", o.project, o.agent, slug],
    queryFn: () => api.skillTrials(o.project, o.agent, slug),
    refetchInterval: (query) => (query.state.data?.trials.some(trialLive) ? 5_000 : false),
  });
  const [pick, setPick] = useState<string>("");
  const chosen = pick || q.data?.deliveries[0]?.run_id || "";
  const start = useMutation({
    mutationFn: () => api.startTrial(o.project, o.agent, slug, chosen),
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: ["trials", o.project, o.agent, slug] });
      onShow(r.trial.id);
    },
  });
  const err = trialError(codeOf(start.error));
  return (
    <section className="cor-card ofi-side-card ofi-skill" aria-label={w.title(name)} data-trial-panel={slug}>
      <SideHead label={w.title(name)} onClose={onClose} closeLabel={w.close} />
      {q.isError ? (
        <ReadError what={w.readError} onRetry={() => void q.refetch()} />
      ) : (
        <div className="ofi-shelf-scroll ofi-skill-body">
          <p className="cor-text">{w.lead(n)}</p>
          <p className="cor-cap ofi-trial-plan" data-uses-plan>
            {w.plan}
          </p>
          {q.data && q.data.deliveries.length === 0 ? (
            <p className="cor-cap">{w.none}</p>
          ) : (
            <div className="ofi-field">
              <label htmlFor="ofi-trial-pick"><Label>{w.pick}</Label></label>
              <select id="ofi-trial-pick" className="cor-select" value={chosen} disabled={!q.data} onChange={(e) => setPick(e.target.value)}>
                {(q.data?.deliveries ?? []).map((d) => (
                  <option key={d.run_id} value={d.run_id}>
                    {`${d.title}${d.ended_at ? ` · ${dayLabel(d.ended_at, now, timeZone)}` : ""}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="cor-cap" role="status">
            {start.isPending ? w.starting : err ? <span className="cor-state bad">{err}</span> : ""}
          </p>
          <Btn kind="primary" className="ofi-wide" disabled={!chosen || start.isPending} onClick={() => start.mutate()} data-control="probar-empezar">
            {w.start(n)}
          </Btn>
          {!!q.data?.trials.length && (
            <>
              <Label as="p" className="ofi-shelf-group">
                {w.past}
              </Label>
              <ul className="ofi-shelf-list ofi-trial-list">
                {q.data.trials.map((t) => (
                  <li key={t.id} data-trial={t.id}>
                    <button type="button" className="ofi-shelf-open cor-cap" onClick={() => onShow(t.id)} aria-label={w.openOf(t.delivery.title)} data-control="ver-prueba">
                      <span className="ofi-shelf-line">
                        <span className="cor-text">{t.delivery.title}</span> · {trialLine(t)}
                      </span>
                      <span aria-hidden>›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
};

const Side = ({ title, t, side, versions, slug }: { title: string; t: TrialView; side: "before" | "after"; versions: SkillCard["versions"]; slug: string }) => {
  const w = words(TRIAL_WORDS);
  const s = t[side];
  const live = side === "after" && trialLive(t);
  return (
    <div className="ofi-trial-col" data-trial-side={side}>
      <div className="ofi-trial-col-head">
        <Label as="h3">{title}</Label>
        <p className="cor-cap" data-trial-version={s.version ?? ""}>
          {stampWords(s.version, versions)} · {w.others(othersCount(s.skills, slug))}
        </p>
      </div>
      <div className="ofi-trial-scroll" tabIndex={0} role="region" aria-label={title}>
        <Label as="p">{w.answer}</Label>
        {live ? <p className="cor-cap" role="status">{trialLine(t)}</p> : <p className="cor-text ofi-trial-answer">{s.output ?? w.noAnswer}</p>}
        <Label as="p">{w.changes}</Label>
        {live ? <p className="cor-cap">{w.waiting}</p> : s.diff ? <pre className="ofi-diff ofi-trial-diff">{s.diff}</pre> : <p className="cor-cap">{w.noChanges}</p>}
      </div>
    </div>
  );
};

export const TrialCompare = ({ o, id, card, onClose }: { o: Oficio; id: string; card: SkillCard | undefined; onClose: () => void }) => {
  const w = words(TRIAL_WORDS);
  const q = useQuery({
    queryKey: ["trial", o.project, o.agent, id],
    queryFn: () => api.trial(o.project, o.agent, id),
    refetchInterval: (query) => (query.state.data && trialLive(query.state.data) ? 5_000 : false),
  });
  const t = q.data;
  const versions = card?.versions ?? [];
  return (
    <div className="ofi-trial" data-trial-compare={id}>
      {q.isError ? (
        <ReadError what={w.readError} onRetry={() => void q.refetch()} />
      ) : !t ? (
        <p className="cor-cap" role="status" aria-busy="true">
          {w.loading}
        </p>
      ) : (
        <>
          <div className="ofi-trial-head">
            <div>
              <h2 className="ofi-trial-title">{w.compareTitle(card?.name ?? t.skill, t.delivery.title)}</h2>
              <p className="cor-cap" role="status" data-trial-status={t.status}>
                {trialLine(t)} · {w.plan}
              </p>
            </div>
            <Btn kind="secondary" onClick={onClose} data-control="cerrar-prueba">
              {w.close}
            </Btn>
          </div>
          <div className="ofi-trial-cols">
            <Side title={w.before} t={t} side="before" versions={versions} slug={t.skill} />
            <Side title={w.after} t={t} side="after" versions={versions} slug={t.skill} />
          </div>
        </>
      )}
    </div>
  );
};

// ---- Traer de un enlace

export const ImportPanel = ({ o, seat, onClose, onOpen }: { o: Oficio; seat: string; onClose: () => void; onOpen: (slug: string) => void }) => {
  const w = words(IMPORT_WORDS);
  const client = useQueryClient();
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState<SkillScope>("agent");
  const [shown, setShown] = useState<ImportPreview | null>(null);
  const look = useMutation({ mutationFn: () => api.previewImport(o.project, o.agent, url.trim()), onSuccess: (p) => setShown(p) });
  const save = useMutation({
    mutationFn: useSingleFlight(() => api.importSkill(o.project, o.agent, { url: shown!.url, source_hash: shown!.source_hash, scope })),
    onSuccess: (c) => {
      void client.invalidateQueries({ queryKey: ["oficio", o.project, o.agent] });
      void client.invalidateQueries({ queryKey: ["skill", o.project, o.agent] });
      onOpen(c.slug);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "SKILL_IMPORT_CHANGED") setShown(null);
    },
  });
  const err = importError(codeOf(look.error ?? save.error));
  return (
    <section className="cor-card ofi-side-card ofi-skill" aria-label={w.title} data-import>
      <SideHead label={w.title} onClose={onClose} closeLabel={words(TRIAL_WORDS).close} />
      <div className="ofi-shelf-scroll ofi-skill-body">
        <p className="cor-cap">{w.lead}</p>
        <form
          className="ofi-import-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) {
              setShown(null);
              look.mutate();
            }
          }}
        >
          <div className="ofi-field">
            <label htmlFor="ofi-import-url"><Label>{w.url}</Label></label>
            <input id="ofi-import-url" className="cor-input" type="url" inputMode="url" value={url} placeholder={w.urlPlaceholder} maxLength={2048} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <Btn kind="secondary" className="ofi-wide" type="submit" disabled={!url.trim() || look.isPending} data-control="traer-enlace">
            {w.fetch}
          </Btn>
        </form>
        <p className="cor-cap" role="status">
          {look.isPending ? w.fetching : save.isPending ? w.saving : err ? <span className="cor-state bad">{err}</span> : ""}
        </p>
        {shown && (
          <div className="ofi-import-preview" data-import-preview={shown.slug}>
            <h4 className="ofi-puesto-seat">{shown.name}</h4>
            <p className="cor-cap">{shown.description}</p>
            <Label as="p">{w.files(shown.files.length)}</Label>
            {shown.files.map((f) => (
              <figure key={f.path} className="ofi-import-file" data-import-file={f.path}>
                <figcaption className="cor-cap ofi-mono">{f.path}</figcaption>
                <pre className="ofi-diff">{f.content}</pre>
              </figure>
            ))}
            {shown.taken ? (
              <p className="cor-cap cor-state warn">{w.taken}</p>
            ) : (
              <>
                <div className="ofi-field">
                  <label htmlFor="ofi-import-scope"><Label>{words(SKILL_CARD_WORDS).forWhom}</Label></label>
                  <select id="ofi-import-scope" className="cor-select" value={scope} onChange={(e) => setScope(e.target.value as SkillScope)}>
                    {scopeOptions(seat).map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="cor-cap">{w.savedHint}</p>
                <Btn kind="primary" className="ofi-wide" disabled={save.isPending} onClick={() => save.mutate()} data-control="guardar-importada">
                  {w.save}
                </Btn>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export const LinkUpdate = ({ o, card }: { o: Oficio; card: SkillCard }) => {
  const w = words(IMPORT_WORDS);
  const client = useQueryClient();
  const [seen, setSeen] = useState<UpdateCheck | null>(null);
  const check = useMutation({ mutationFn: () => api.checkSkillLink(o.project, o.agent, card.slug), onSuccess: (u) => setSeen(u) });
  const accept = useMutation({
    mutationFn: useSingleFlight(() => api.updateSkillLink(o.project, o.agent, card.slug, seen!.source_hash)),
    onSuccess: () => {
      setSeen(null);
      void client.invalidateQueries({ queryKey: ["skill", o.project, o.agent] });
      void client.invalidateQueries({ queryKey: ["oficio", o.project, o.agent] });
    },
  });
  // PLA-I71-5: «No, quedarme con la mía» keeps the pin and stops offering that upstream content.
  const decline = useMutation({
    mutationFn: useSingleFlight(() => api.declineSkillLink(o.project, o.agent, card.slug)),
    onSuccess: () => {
      setSeen(null);
      void client.invalidateQueries({ queryKey: ["skill", o.project, o.agent] });
      void client.invalidateQueries({ queryKey: ["tienda", o.project] });
    },
  });
  const lines = useMemo(() => (seen?.changed ? changedOnly(updateDiff(seen)) : []), [seen]);
  const err = importError(codeOf(check.error ?? accept.error ?? decline.error));
  if (!card.link) return null;
  return (
    <div className="ofi-link-update" data-link-update={card.slug}>
      <p className="cor-cap">
        {w.from(hostOf(card.link.url))} · {w.pinned(card.link.hash)}
      </p>
      <p className="cor-cap" role="status">
        {check.isPending ? w.checking : accept.isPending ? w.saving : err ? <span className="cor-state bad">{err}</span> : accept.isSuccess ? w.updated : seen && !seen.changed ? w.unchanged : ""}
      </p>
      {seen?.changed ? (
        <div className="ofi-confirm" role="group" aria-label={w.changed} data-link-diff>
          <p className="cor-text">{w.changed}</p>
          <DiffBlock lines={lines} label={w.changed} />
          <div className="ofi-actions">
            <Btn kind="primary" disabled={accept.isPending} onClick={() => accept.mutate()} data-control="aceptar-cambios-enlace">
              {w.accept}
            </Btn>
            <Btn kind="quiet" disabled={decline.isPending} onClick={() => (card.link?.upstream_hash ? decline.mutate() : setSeen(null))} data-control="dejar-como-esta">
              {w.keep}
            </Btn>
          </div>
        </div>
      ) : (
        <>
          {card.link.upstream_hash && <p className="cor-state warn" data-upstream>{w.newVersion}</p>}
          <Btn kind="link" disabled={check.isPending} onClick={() => check.mutate()} data-control="buscar-cambios-enlace">
            {card.link.upstream_hash ? w.seeNew : w.check}
          </Btn>
        </>
      )}
    </div>
  );
};
