// PLA-I71-3: Sumar (PLA-IDEA34 board Sumar). The PO's proposal on top (Sí / No por ahora), the role catalog as cards
// (free, already in, proposed, the owner's own) and «Un puesto nuevo» (two lines on a base role); on the right, who
// joins: who it reports to, its motor, the skills it brings, and that it arrives paused. At most eight seats.
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type OrgProject, type PuestoView } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { words } from "@/lib/i18n";
import { skillName } from "@/lib/oficio";
import { MODELS, type ModelId } from "@/lib/motores";
import { suggestedPacks } from "@/lib/sumar";
import { SUMAR_PAGE_WORDS } from "@/lib/sumar-page-words";
import { ROLE_LINE } from "./equipo-roles";
import { Btn, Label, ReadError, useOnce } from "./parts";

const NEW = "__nuevo";
const BASES = ["research", "artist", "taller", "qa", "copy", "seguridad", "marketing", "data"];
const errText = (e: unknown) => {
  const w = words(SUMAR_PAGE_WORDS);
  return e instanceof ApiError ? (e.code === "TEAM_FULL" ? w.full : e.code === "PUESTO_IN_USE" ? w.inUse : w.failed(e.code)) : e ? w.failed("NETWORK") : null;
};
export const roleTitle = (x: Pick<PuestoView, "slug" | "title" | "origin">) => (x.origin === "owner" ? x.title : seatName(x.slug));

export const SumarPage = ({ p, back }: { p: OrgProject; back: string }) => {
  const w = words(SUMAR_PAGE_WORDS);
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["equipo", p.slug], queryFn: () => api.equipo(p.slug) });
  const packs = useQuery({ queryKey: ["company-packs"], queryFn: () => api.packs() });
  const proposals = q.data?.proposals ?? [];
  const list = (q.data?.puestos ?? []).filter((x) => x.origin === "owner" || !x.taken || proposals.some((pr) => pr.role === x.slug));
  const free = list.filter((x) => !x.taken);
  const [picked, setPicked] = useState<string | null>(null);
  const role = picked ?? proposals[0]?.role ?? free[0]?.slug ?? NEW;
  const chosen = list.find((x) => x.slug === role) ?? null;
  const po = p.team.find((m) => m.template === "product-owner");
  const [boss, setBoss] = useState<string>("");
  const [model, setModel] = useState<ModelId | null>(null);
  const [own, setOwn] = useState({ title: "", line: "", base: "taller" });
  const [done, setDone] = useState<string | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["equipo", p.slug] });
    void client.invalidateQueries({ queryKey: ["company"] });
  };
  const pk = chosen ? suggestedPacks(chosen.origin === "owner" ? chosen.base : chosen.slug, packs.data?.packs ?? []) : [];
  const onceAdd = useOnce({ sticky: true, key: role });
  const add = useMutation({
    mutationFn: async () => {
      const r = await api.addToTeam(p.slug, role, pk, model ? { model } : undefined);
      if (boss && boss !== (po?.agent ?? "")) await api.moveSeat(p.slug, r.agent.agent, boss === "__owner" ? null : boss);
      return r;
    },
    onSuccess: () => {
      setDone(chosen ? roleTitle(chosen) : role);
      setPicked(null);
      refresh();
    },
  });
  const onceDecide = useOnce({ sticky: true, key: proposals.map((x) => x.id).join() });
  const decide = useMutation({ mutationFn: (v: { id: string; accept: boolean }) => api.decideProposal(p.slug, v.id, v.accept), onSuccess: refresh });
  const onceCreate = useOnce();
  const create = useMutation({
    mutationFn: () => api.createPuesto(own),
    onSuccess: (x) => {
      setPicked(x.slug);
      setOwn({ title: "", line: "", base: "taller" });
      refresh();
    },
  });
  // PLA-142: a role of the owner's own can be deleted (the server refuses while a live seat holds it).
  const [asking, setAsking] = useState(false);
  const onceRemove = useOnce();
  const remove = useMutation({
    mutationFn: (slug: string) => api.deletePuesto(slug),
    onSuccess: () => {
      setAsking(false);
      setPicked(null);
      refresh();
    },
  });
  const full = p.team.length >= 8;
  const card = (x: PuestoView) => {
    const prop = proposals.find((pr) => pr.role === x.slug);
    const tag = prop ? w.proposed : x.taken ? w.taken : x.origin === "owner" ? w.yours : w.free;
    return (
      <li key={x.slug}>
        <button type="button" className={`sum-card ${role === x.slug ? "sel" : ""}`} aria-pressed={role === x.slug} disabled={x.taken} onClick={() => setPicked(x.slug)} data-puesto={x.slug}>
          <span className="sum-card-top">
            <b>{roleTitle(x)}</b>
            <span className={`org-tag ${prop ? "am" : ""}`}>{tag}</span>
          </span>
          <span className="sum-card-line">{x.origin === "owner" ? x.line : (ROLE_LINE[x.slug] ?? "")}</span>
        </button>
      </li>
    );
  };
  return (
    <div className="sum" data-sumar>
      <div className="sum-head">
        <Link to={back} className="cor-strip-back" data-control="volver-organigrama">
          ‹ {w.back}
        </Link>
        <h2 className="eq-title">{w.title(p.title)}</h2>
        <p className="cor-cap sum-hint">{w.hint}</p>
      </div>
      {proposals.map((pr) => {
        const named = (q.data?.puestos ?? []).find((x) => x.slug === pr.role);
        const title = named ? roleTitle(named) : pr.title;
        return (
        <section key={pr.id} className="sum-prop" aria-label={w.proposes(pr.title)} data-proposal={pr.id}>
          <i className="org-dot espera" aria-hidden />
          <span className="sum-prop-text">
            <b>{w.proposes(title)}</b>
            <span>
              {w.quoted(pr.reason)} {w.proposalNote}
            </span>
          </span>
          <Btn kind="secondary" className="sum-prop-yes" disabled={decide.isPending || full} onClick={() => onceDecide(() => decide.mutateAsync({ id: pr.id, accept: true }))} data-control="propuesta-si">
            {w.yes(title)}
          </Btn>
          <Btn kind="quiet" disabled={decide.isPending} onClick={() => onceDecide(() => decide.mutateAsync({ id: pr.id, accept: false }))} data-control="propuesta-no">
            {w.notNow}
          </Btn>
        </section>
        );
      })}
      {q.isError ? (
        <ReadError what={w.roles} onRetry={() => void q.refetch()} />
      ) : (
        <div className="sum-body">
          <div className="sum-main">
            <ul className="sum-grid" aria-label={w.roles}>
              {list.map(card)}
              <li>
                <button type="button" className={`sum-card new ${role === NEW ? "sel" : ""}`} aria-pressed={role === NEW} onClick={() => setPicked(NEW)} data-puesto={NEW}>
                  <span className="sum-card-top">
                    <b>{w.newOne}</b>
                    <span className="org-tag">{w.yours}</span>
                  </span>
                  <span className="sum-card-line">{w.newLine}</span>
                </button>
              </li>
            </ul>
            <p className="cor-cap">{w.already(p.team.map((m) => m.puesto ?? seatName(m.role)).join(", "))}</p>
            {(decide.error || create.error) && <p className="cor-state bad">{errText(decide.error ?? create.error)}</p>}
          </div>
          <aside className="cor-card eq-side sum-side" aria-label={w.whoArrives}>
            <Label as="h3">{w.whoArrives}</Label>
            {role === NEW ? (
              <form
                className="sum-own"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (own.title.trim()) onceCreate(() => create.mutateAsync());
                }}
              >
                <label className="cor-label" htmlFor="sum-own-title">
                  {w.ownTitle}
                </label>
                <input id="sum-own-title" className="cor-input" maxLength={60} value={own.title} onChange={(e) => setOwn({ ...own, title: e.target.value })} data-control="puesto-nombre" />
                <label className="cor-label" htmlFor="sum-own-line">
                  {w.ownLine}
                </label>
                <input id="sum-own-line" className="cor-input" maxLength={200} value={own.line} onChange={(e) => setOwn({ ...own, line: e.target.value })} data-control="puesto-linea" />
                <label className="cor-label" htmlFor="sum-own-base">
                  {w.ownBase}
                </label>
                <select id="sum-own-base" className="cor-select" value={own.base} onChange={(e) => setOwn({ ...own, base: e.target.value })} data-control="puesto-base">
                  {BASES.map((b) => (
                    <option key={b} value={b}>
                      {seatName(b)}
                    </option>
                  ))}
                </select>
                <p className="cor-cap">{w.ownHint}</p>
                <Btn kind="primary" type="submit" disabled={!own.title.trim() || create.isPending} data-control="crear-puesto">
                  {create.isPending ? w.creating : w.ownCreate}
                </Btn>
              </form>
            ) : chosen ? (
              <>
                <span className="eq-side-head">
                  <span className="org-glyph" aria-hidden>
                    {roleTitle(chosen).slice(0, 2)}
                  </span>
                  <span className="org-who">
                    <b className="eq-side-name">{roleTitle(chosen)}</b>
                    <span className="org-line">{chosen.origin === "owner" ? chosen.line : ROLE_LINE[chosen.slug]}</span>
                  </span>
                </span>
                <div className="agt-kv">
                  <label htmlFor="sum-boss">{w.reportsTo}</label>
                  <select id="sum-boss" className="cor-select" value={boss || (po?.agent ?? "__owner")} onChange={(e) => setBoss(e.target.value)} data-control="sumar-jefe">
                    <option value="__owner">{w.you}</option>
                    {p.team.map((m) => (
                      <option key={m.agent} value={m.agent}>
                        {m.puesto ?? seatName(m.role)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="agt-kv">
                  <label htmlFor="sum-motor">{w.motor}</label>
                  <select id="sum-motor" className="cor-select" value={model ?? ""} onChange={(e) => setModel((e.target.value || null) as ModelId | null)} data-control="sumar-modelo">
                    <option value="">{w.companyMotor}</option>
                    {MODELS.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Label as="p">{w.brings(pk.length)}</Label>
                <span className="org-tags sum-brings">
                  {pk.map((s) => (
                    <span key={s} className="org-tag vi">
                      {skillName(s)}
                    </span>
                  ))}
                </span>
                <p className="cor-cap">{w.arrivesPaused}</p>
                <p className="cor-cap" role="status">
                  {add.isError ? <span className="cor-state bad">{errText(add.error)}</span> : done ? w.added(done) : full ? w.full : ""}
                </p>
                <Btn kind="primary" disabled={full || chosen.taken || add.isPending} onClick={() => onceAdd(() => add.mutateAsync())} data-control="sumar-rol">
                  {add.isPending ? w.adding : w.add(roleTitle(chosen))}
                </Btn>
                {chosen.origin === "owner" &&
                  (asking ? (
                    <div className="agt-retire" role="group" aria-label={w.removePuesto}>
                      <p className="cor-text">{w.removeAsk(roleTitle(chosen))}</p>
                      <Btn kind="secondary" disabled={remove.isPending} onClick={() => onceRemove(() => remove.mutateAsync(chosen.slug))} data-control="borrar-puesto-si">
                        {w.removeYes}
                      </Btn>
                      <Btn kind="quiet" onClick={() => setAsking(false)} data-control="borrar-puesto-no">
                        {w.removeNo}
                      </Btn>
                    </div>
                  ) : (
                    <Btn kind="link" onClick={() => (remove.reset(), setAsking(true))} data-control="borrar-puesto">
                      {w.removePuesto}
                    </Btn>
                  ))}
                {remove.isError && <p className="cor-cap cor-state bad">{errText(remove.error)}</p>}
              </>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
};
