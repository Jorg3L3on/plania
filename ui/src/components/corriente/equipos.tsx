// PLA-I71-6: teams (PLA-IDEA34 boards Equipos, Adoptar, Compania). The catalog: factory teams (kit/teams), the owner's
// saved ones and those brought from a file or a repository, each adoptable in this project; «Guardar el equipo de X»
// with lessons and references only when ticked. Adopting shows the plan first (who stays, who joins paused, who does
// not fit), with a choice for seats that already exist, and writes only on confirm. «Compañía completa»: what goes in
// the file (and what never does), what it looks like inside, the tar to save; bringing one shows create / rename / skip
// per item first.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type OrgMember, type OrgProject, type PackageSource, type TeamView } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { words } from "@/lib/i18n";
import { skillName } from "@/lib/oficio";
import { EQUIPOS_WORDS } from "@/lib/equipos-words";
import { Btn, Label, ReadError, useOnce } from "./parts";
import { Organigrama } from "./organigrama";

const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : e ? "NETWORK" : null);
const roleTitle = (s: { role: string; title?: string | null }) => s.title ?? seatName(s.role);
async function sourceOf(url: string, file: File | null): Promise<PackageSource> {
  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return { tar: btoa(bin) };
  }
  return { url: url.trim() };
}

/** The seats of a team as small bars (one per seat), the board's mark. */
const Bars = ({ n }: { n: number }) => (
  <span className="eqs-bars" aria-hidden>
    {Array.from({ length: Math.min(n, 8) }, (_, i) => (
      <i key={i} className={i === 0 ? "top" : undefined} />
    ))}
  </span>
);

export type EquiposLinks = { adopt: (team: string) => string; company: string; equipos: string };

export const EquiposPage = ({ p, nav, links }: { p: OrgProject; nav: React.ReactNode; links: EquiposLinks }) => {
  const w = words(EQUIPOS_WORDS);
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["teams"], queryFn: () => api.teams() });
  const [panel, setPanel] = useState<"save" | "bring" | null>(null);
  const [name, setName] = useState(w.defaultName(p.title));
  const [withL, setWithL] = useState(false);
  const [withR, setWithR] = useState(false);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const onceSave = useOnce({ sticky: true, key: name });
  const save = useMutation({ mutationFn: () => api.saveTeam(p.slug, { name, lessons: withL, references: withR }), onSuccess: () => void client.invalidateQueries({ queryKey: ["teams"] }) });
  const onceBring = useOnce({ sticky: true, key: url + (file?.name ?? "") });
  const bring = useMutation({ mutationFn: async () => api.bringTeam(await sourceOf(url, file)), onSuccess: () => void client.invalidateQueries({ queryKey: ["teams"] }) });
  // PLA-142: a team the owner saved or brought can leave the catalog.
  const [removing, setRemoving] = useState<string | null>(null);
  const onceRemove = useOnce();
  const remove = useMutation({
    mutationFn: (slug: string) => api.deleteTeam(slug),
    onSuccess: () => {
      setRemoving(null);
      void client.invalidateQueries({ queryKey: ["teams"] });
    },
  });
  const card = (t: TeamView) => (
    <li key={t.slug}>
      <article className="cor-card eqs-card" data-team={t.slug}>
        <span className="sum-card-top">
          <b>{t.name}</b>
          <span className={`org-tag ${t.origin === "imported" ? "ok" : t.origin === "owner" ? "vi" : ""}`}>{w.origin[t.origin]}</span>
        </span>
        <span className="eqs-mid">
          <Bars n={t.seats.length} />
          <span className="sum-card-line">{t.line || t.seats.map(roleTitle).join(", ")}</span>
        </span>
        <span className="eqs-foot">
          <span className="cor-cap">
            {w.seats(t.seats.length)} · {w.skills(t.skills)}
          </span>
          <Link className="cor-btn secondary" to={links.adopt(t.slug)} data-control={`adoptar-${t.slug}`}>
            {w.adopt(p.title)}
          </Link>
        </span>
        {t.origin !== "factory" &&
          (removing === t.slug ? (
            <span className="agt-retire" role="group" aria-label={w.remove}>
              <p className="cor-text">{w.removeAsk(t.name)}</p>
              <Btn kind="secondary" disabled={remove.isPending} onClick={() => onceRemove(() => remove.mutateAsync(t.slug))} data-control={`borrar-equipo-si-${t.slug}`}>
                {w.removeYes}
              </Btn>
              <Btn kind="quiet" onClick={() => setRemoving(null)} data-control="borrar-equipo-no">
                {w.removeNo}
              </Btn>
              {remove.isError && <span className="cor-cap cor-state bad">{w.removeFailed(remove.error instanceof ApiError ? remove.error.code : "NETWORK")}</span>}
            </span>
          ) : (
            <Btn kind="link" onClick={() => (remove.reset(), setRemoving(t.slug))} data-control={`borrar-equipo-${t.slug}`}>
              {w.remove}
            </Btn>
          ))}
      </article>
    </li>
  );
  return (
    <div className="eqs" data-equipos={q.data?.teams.length ?? 0}>
      <div className="eq-head">
        {nav}
        <span className="tda-tools">
          <Btn kind="secondary" aria-expanded={panel === "bring"} onClick={() => setPanel(panel === "bring" ? null : "bring")} data-control="traer-equipo">
            {w.bring}
          </Btn>
          <Btn kind="secondary" aria-expanded={panel === "save"} onClick={() => setPanel(panel === "save" ? null : "save")} data-control="guardar-equipo">
            {w.save(p.title)}
          </Btn>
        </span>
      </div>
      <h2 className="eq-title">
        {w.title} <span className="cor-text cor-muted eqs-sub">{w.sub}</span>
      </h2>
      {panel === "save" && (
        <form
          className="cor-card eqs-form"
          aria-label={w.saveTitle}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onceSave(() => save.mutateAsync());
          }}
        >
          <label className="cor-label" htmlFor="eqs-name">
            {w.saveName}
          </label>
          <input id="eqs-name" className="cor-input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} data-control="equipo-nombre" />
          <label className="cor-check" data-inline-ok>
            <input type="checkbox" checked={withL} onChange={(e) => setWithL(e.target.checked)} data-control="con-lecciones" />
            <span>{w.saveLessons}</span>
          </label>
          <label className="cor-check" data-inline-ok>
            <input type="checkbox" checked={withR} onChange={(e) => setWithR(e.target.checked)} data-control="con-referencias" />
            <span>{w.saveRefs}</span>
          </label>
          <span className="cor-cap">{w.saveHint}</span>
          <Btn kind="primary" type="submit" disabled={save.isPending || !name.trim()} data-control="guardar-equipo-si">
            {save.isPending ? w.saving : w.saveDo}
          </Btn>
          <span className="cor-cap" role="status">
            {save.isError ? <span className="cor-state bad">{w.failed(codeOf(save.error)!)}</span> : save.data ? w.saved(save.data.name) : ""}
          </span>
        </form>
      )}
      {panel === "bring" && (
        <form
          className="cor-card eqs-form"
          aria-label={w.bringTitle}
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() || file) onceBring(() => bring.mutateAsync());
          }}
        >
          <span className="cor-cap">{w.bringHint}</span>
          <label className="cor-label" htmlFor="eqs-url">
            {w.bringUrl}
          </label>
          <input id="eqs-url" className="cor-input" placeholder="https://github.com/…" value={url} onChange={(e) => setUrl(e.target.value)} data-control="equipo-enlace" />
          <label className="cor-label" htmlFor="eqs-file">
            {w.bringFile}
          </label>
          <input id="eqs-file" type="file" accept=".tar,application/x-tar" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-control="equipo-archivo" />
          <Btn kind="primary" type="submit" disabled={bring.isPending || (!url.trim() && !file)} data-control="traer-equipo-si">
            {bring.isPending ? w.bringing : w.bringDo}
          </Btn>
          <span className="cor-cap" role="status">
            {bring.isError ? <span className="cor-state bad">{w.failed(codeOf(bring.error)!)}</span> : bring.data ? w.brought(bring.data.ignored.length) : ""}
          </span>
        </form>
      )}
      {q.isError ? (
        <ReadError what={w.readError} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <p className="cor-text cor-muted" role="status" aria-busy="true">
          {w.loading}
        </p>
      ) : (
        <ul className="eqs-grid">{q.data.teams.map(card)}</ul>
      )}
      <section className="cor-card eqs-company" aria-label={w.company}>
        <span>
          <b>{w.company}</b>
          <span className="cor-text cor-muted">{w.companyLine}</span>
        </span>
        <Link className="cor-btn secondary" to={links.company} data-control="compania">
          {w.companyOpen}
        </Link>
      </section>
    </div>
  );
};

// ---- adopting one team

export const AdoptarPage = ({ p, team, links, onDone }: { p: OrgProject; team: string; links: EquiposLinks; onDone: () => void }) => {
  const w = words(EQUIPOS_WORDS);
  const client = useQueryClient();
  const [mode, setMode] = useState<"keep" | "also">("keep");
  // A 4xx will not get better on a retry (a team that is gone): say so at once.
  const q = useQuery({ queryKey: ["adopt", p.slug, team, mode], queryFn: () => api.adoptPreview(p.slug, team, mode), retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 });
  const onceGo = useOnce({ sticky: true });
  const go = useMutation({
    mutationFn: () => api.adopt(p.slug, team, mode),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["company"] });
      onDone();
    },
  });
  const plan = q.data;
  // The chart of what it would be: today's seats, and the arrivals under whoever the team says (by role).
  const chart = useMemo<OrgMember[]>(() => {
    if (!plan) return p.team;
    const byRole = new Map(p.team.map((m) => [m.puesto ? m.role : (m.template ?? m.role), m.agent]));
    const arrivals = plan.arrives.map((a) => ({ agent: `llega:${a.role}`, role: a.role, template: a.role, state: "paused" as const, now: null, last: null, produced: null, waiting: null, puesto: a.title, reports_to: null as string | null }));
    for (const a of arrivals) byRole.set(a.role, a.agent);
    for (const [i, a] of plan.arrives.entries()) arrivals[i]!.reports_to = a.reports_to ? (byRole.get(a.reports_to) ?? null) : (byRole.get("product-owner") ?? null);
    return [...p.team, ...arrivals.map((a) => (a.reports_to === a.agent ? { ...a, reports_to: null } : a))];
  }, [plan, p.team]);
  const look = { line: (m: OrgMember) => (m.agent.startsWith("llega:") ? w.arriveLine : w.stayLine), tone: (m: OrgMember) => (m.agent.startsWith("llega:") ? "arrives" : null) };
  return (
    <div className="sum" data-adoptar={team}>
      <div className="sum-head">
        <Link to={links.equipos} className="cor-strip-back" data-control="volver-equipos">
          ‹ {w.backTeams}
        </Link>
        <h2 className="eq-title">{plan ? w.adoptTitle(plan.name, p.title) : w.adoptTitleBare(p.title)}</h2>
        <p className="cor-cap sum-hint">{w.nothingChanges}</p>
      </div>
      {q.isError && q.error instanceof ApiError && q.error.status < 500 ? (
        <div className="cor-card cor-empty" data-team-gone>
          <p className="cor-text">{w.teamGone}</p>
          <Link className="cor-btn secondary" to={links.equipos}>
            {w.backTeams}
          </Link>
        </div>
      ) : q.isError ? (
        <ReadError what={w.readError} onRetry={() => void q.refetch()} />
      ) : !plan ? (
        <p className="cor-text cor-muted" role="status" aria-busy="true">
          {w.loading}
        </p>
      ) : (
        <div className="sum-body">
          <section className="cor-card eqs-plan" aria-label={w.how}>
            <span className="sum-card-top">
              <Label as="h3">{w.how}</Label>
              <span className="cor-cap">
                {w.stays(plan.stays.length)} · <span className="eqs-green">{w.arrives(plan.arrives.length)}</span>
              </span>
            </span>
            <Organigrama team={chart} project={p.title} paused={false} selected={null} onPick={() => undefined} look={look} />
            <ul className="eqs-rows">
              {plan.arrives.map((a) => (
                <li key={a.role}>
                  <span className="org-tag ok">{w.arriveLine}</span> <b>{roleTitle(a)}</b> · {w.brings(a.skills.map((x) => skillName(x)).join(", "))}
                </li>
              ))}
              {plan.stays
                .filter((s) => s.adds.length)
                .map((s) => (
                  <li key={s.agent}>
                    <span className="org-tag vi">{w.stayLine}</span> <b>{seatName(s.role)}</b> · {w.adds(s.adds.map((x) => skillName(x)).join(", "))}
                  </li>
                ))}
            </ul>
          </section>
          <aside className="cor-card eq-side sum-side" aria-label={w.beforeConfirm}>
            <Label as="h3">{w.beforeConfirm}</Label>
            <ul className="trr-checks">
              <li className="ok">{w.newSeats(plan.arrives.length)}</li>
              <li className="ok">{w.nobodyLoses}</li>
              {plan.no_room.length > 0 && <li className="warn">{w.noRoom(plan.no_room.map((r) => seatName(r)).join(", "))}</li>}
              {plan.plan_note.more_agents > 0 && <li className="warn">{w.morePlan(plan.plan_note.more_agents)}</li>}
              <li className="ok">{w.copyNote}</li>
            </ul>
            <Label as="p">{w.ifExists}</Label>
            <div role="radiogroup" aria-label={w.ifExists} className="trr-whom">
              <label className="trr-radio" data-inline-ok>
                <input type="radio" name="eqs-mode" checked={mode === "keep"} onChange={() => setMode("keep")} data-control="modo-mio" />
                <span>{w.keepMine}</span>
              </label>
              <label className="trr-radio" data-inline-ok>
                <input type="radio" name="eqs-mode" checked={mode === "also"} onChange={() => setMode("also")} data-control="modo-tambien" />
                <span>{w.alsoGive}</span>
              </label>
            </div>
            <p className="cor-cap" role="status">
              {go.isError ? <span className="cor-state bad">{w.failed(codeOf(go.error)!)}</span> : go.isSuccess ? w.adopted : ""}
            </p>
            <Btn kind="primary" disabled={go.isPending || (plan.arrives.length === 0 && !plan.stays.some((s) => s.adds.length))} onClick={() => onceGo(() => go.mutateAsync())} data-control="adoptar-si">
              {go.isPending ? w.adopting : w.adoptDo(p.title)}
            </Btn>
            <Link className="cor-btn quiet" to={links.equipos} data-control="adoptar-no">
              {w.cancel}
            </Link>
          </aside>
        </div>
      )}
    </div>
  );
};

// ---- the whole company

export const CompaniaPage = ({ links }: { links: EquiposLinks }) => {
  const w = words(EQUIPOS_WORDS);
  const [tab, setTab] = useState<"export" | "import">("export");
  const [withL, setWithL] = useState(false);
  const [withR, setWithR] = useState(false);
  const ex = useQuery({ queryKey: ["export", withL, withR], queryFn: () => api.exportFiles({ lessons: withL, references: withR }), enabled: tab === "export" });
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState<PackageSource | null>(null);
  const [choices, setChoices] = useState<Record<string, "create" | "rename" | "skip">>({});
  const oncePv = useOnce();
  const pv = useMutation({
    mutationFn: async () => {
      const s = await sourceOf(url, file);
      setSrc(s);
      return api.importPreview(s);
    },
  });
  const onceGo = useOnce({ sticky: true });
  const go = useMutation({ mutationFn: () => api.importCompany(src!, choices) });
  const files = ex.data?.files ?? [];
  const href = `/api/company/export.tar?lessons=${withL ? 1 : 0}&references=${withR ? 1 : 0}`;
  const tick = (label: string, on: boolean, set?: (v: boolean) => void, control?: string) => (
    <label className="cor-check eqs-tick" data-inline-ok>
      <input type="checkbox" checked={on} disabled={!set} onChange={(e) => set?.(e.target.checked)} data-control={control} />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="sum" data-compania>
      <div className="sum-head">
        <Link to={links.equipos} className="cor-strip-back" data-control="volver-equipos">
          ‹ {w.backTeams}
        </Link>
        <h2 className="eq-title">{w.companyTitle}</h2>
        <span className="eq-places trr-modes" role="group" aria-label={w.companyTitle} style={{ marginLeft: "auto" }}>
          <button type="button" aria-pressed={tab === "export"} onClick={() => setTab("export")} data-control="llevar">
            {w.exportTab}
          </button>
          <button type="button" aria-pressed={tab === "import"} onClick={() => setTab("import")} data-control="traer-compania">
            {w.importTab}
          </button>
        </span>
      </div>
      <div className="trr-body">
        <section className="cor-card trr-col" aria-label={w.whatGoes}>
          <Label as="h3">{w.whatGoes}</Label>
          {tick(w.goTeams, true)}
          {tick(w.goPosts, true)}
          {tick(w.goSkills, true)}
          {tick(w.goMotors, true)}
          {tick(w.goLessons, withL, setWithL, "con-lecciones")}
          {tick(w.goRefs, withR, setWithR, "con-referencias")}
          <div className="cor-card trr-note">
            <Label as="p">{w.neverGoes}</Label>
            <p className="cor-text">{w.neverLine}</p>
          </div>
        </section>
        {tab === "export" ? (
          <section className="cor-card trr-col" aria-label={w.inside}>
            <span className="sum-card-top">
              <Label as="h3">{w.inside}</Label>
              <span className="cor-cap">{w.filesCount(files.length)}</span>
            </span>
            <pre className="agt-pre trr-pre" tabIndex={0} data-files={files.length}>
              {files.map((f) => f.path).join("\n")}
            </pre>
            <p className="cor-cap">{w.insideNote}</p>
          </section>
        ) : (
          <section className="cor-card trr-col" aria-label={w.items}>
            <Label as="h3">{w.items}</Label>
            {pv.data ? (
              <ul className="eqs-items">
                {pv.data.items.map((it) => (
                  <li key={it.key} data-item={it.key}>
                    <span>{it.kind === "team" ? w.teamItem(it.name, it.agents ?? 0) : w.skillItem(it.name, it.marks ?? 0)}</span>
                    <select className="cor-select" aria-label={it.name} value={choices[it.key] ?? it.action} onChange={(e) => setChoices({ ...choices, [it.key]: e.target.value as "create" | "rename" | "skip" })} data-control={`accion-${it.key}`}>
                      {(it.taken ? (["rename", "skip"] as const) : (["create", "skip"] as const)).map((a) => (
                        <option key={a} value={a}>
                          {a === "rename" ? `${w.act.rename} ${w.to(it.to)}` : w.act[a]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
                {pv.data.ignored.length > 0 && <li className="cor-cap">{w.ignored(pv.data.ignored.length)}</li>}
                {pv.data.secrets.length > 0 && <li className="cor-state warn">{w.secrets(pv.data.secrets.join(", "))}</li>}
              </ul>
            ) : (
              <p className="cor-text cor-muted">{w.bringHint}</p>
            )}
          </section>
        )}
        <section className="cor-card trr-col" aria-label={w.whenBringing}>
          <Label as="h3">{w.whenBringing}</Label>
          <ul className="trr-checks">
            <li className="ok">{w.b1}</li>
            <li className="ok">{w.b2}</li>
            <li className="ok">{w.b3}</li>
            <li className="ok">{w.b4}</li>
            <li className="warn">{w.b5}</li>
          </ul>
          {tab === "export" ? (
            <a className="cor-btn primary" href={href} download="compania.tar" data-control="guardar-archivo">
              {w.saveFile}
            </a>
          ) : (
            <form
              className="sum-own"
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim() || file) oncePv(() => pv.mutateAsync());
              }}
            >
              <label className="cor-label" htmlFor="cmp-url">
                {w.bringUrl}
              </label>
              <input id="cmp-url" className="cor-input" placeholder="https://github.com/…" value={url} onChange={(e) => setUrl(e.target.value)} data-control="compania-enlace" />
              <label className="cor-label" htmlFor="cmp-file">
                {w.bringFile}
              </label>
              <input id="cmp-file" type="file" accept=".tar,application/x-tar" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-control="compania-archivo" />
              <Btn kind="secondary" type="submit" disabled={pv.isPending || (!url.trim() && !file)} data-control="compania-revisar">
                {pv.isPending ? w.reviewing : w.review}
              </Btn>
              <Btn kind="primary" disabled={!pv.data || go.isPending} onClick={() => onceGo(() => go.mutateAsync())} data-control="compania-traer">
                {go.isPending ? w.importing : w.importDo}
              </Btn>
              <span className="cor-cap" role="status">
                {pv.error || go.error ? <span className="cor-state bad">{w.failed(codeOf(pv.error ?? go.error)!)}</span> : go.data ? w.imported(go.data.agents.length) : ""}
              </span>
            </form>
          )}
        </section>
      </div>
    </div>
  );
};
