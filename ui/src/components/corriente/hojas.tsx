// PLA-I62-8: the sheets (board A5). Each opens alone over the dimmed screen and says what happens before the click:
//   Agregar un proyecto  where its code is (Local, Nube, SSH, Sin código), name and goal; its key, its PO and that it
//                  starts paused (POST /company/projects); its ready state
//                   (NEWPROJ-4: the readiness list, and «listo» only when nothing stops a run). F2: with a repository
//                   given, whether gh can write to GitHub, and the fix.
//   Pausar          what closes (the runs live now), what does not start, what stays; Pausar <proyecto>.
//   Reanudar        a paused project, or the company stopped (that one is resumed from Plomería). NEWPROJ-4: a project
//                   with no steps is started, not resumed, and the sheet names what will make the first run fail.
//                   F6: with both paused, its one button resumes the project and the company.
//   Publicar        what goes out (the release's steps and its reel), what blocks it (open checks, a step of yours
//                   first) and the ship call's progress, result and refusal words (POST …/release/ship).
//   Meta            the goal and its date (the goal routes /ceo's dialog uses).
// Esc and Cancelar close; focus starts inside and returns where it was.
import { migrationLine, prodFixLink, prodWaits, publicarWords } from "@/lib/publicar";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";
import { toast } from "sonner";
import { ApiError, api, type Decision, type OrgProject } from "@/lib/api";
import { linkTo, seatName } from "@/lib/corriente";
import { META_MAX, NOMBRE_MAX, agregarError, agregarWords, codigoOpciones, fondoMouseDown, nuevoProyectoSinTexto } from "@/lib/nuevo-proyecto";
import { creadoTitulo, listoAviso, reanudarAlReanudar, reanudarFalla } from "@/lib/listo";
import { ListoLista, ListoSecciones } from "@/components/listo";
import { useAgregarProyecto } from "@/components/agregar/use-agregar-proyecto";
import type { GoalWrite } from "@/components/goals/model";
import { words } from "@/lib/i18n";
import { HOJAS_WORDS } from "@/lib/hojas-words";
import { pausaDe, pausasWords } from "@/lib/pausas";
import { githubAvisoWords } from "@/lib/github-aviso";
import { CopyCommand } from "@/components/copy-command";
import { Btn, Key, Label, You } from "./parts";

// NEWPROJ-6: the readiness list's way to the project's Ajustes door (opening it closes the sheet).
const AjustesLink = ({ slug }: { slug: string }) => (
  <Link className="cor-btn secondary cor-listo-ajustes" to={linkTo({ slug, tab: "ajustes" })} data-control="ir-ajustes">
    {words(HOJAS_WORDS).openSettings}
  </Link>
);

// NEWPROJ-7: borrar is Borrar proyecto (hoja-borrar.tsx).
export type HojaKind = "nuevo" | "pausar" | "reanudar" | "publicar" | "meta" | "borrar";

// NEWPROJ-8: closeOnBack false keeps the sheet open on a mouse-down on the dimmed background (Esc still closes).
// PLA-I3-7: bottom draws it from the foot of a phone, above the app's tab bar (an initiative's steps, tramos.tsx); its
// label may carry a key.
export const Hoja = ({ label, title, onClose, children, wide, bottom, closeOnBack = true }: { label: ReactNode; title: string; onClose: () => void; children: ReactNode; wide?: boolean; bottom?: boolean; closeOnBack?: boolean }) => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("input, textarea, button:not([data-x])")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && box.current) {
        const f = [...box.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input, textarea, select")];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) (e.preventDefault(), f.at(-1)!.focus());
        else if (!e.shiftKey && document.activeElement === f.at(-1)) (e.preventDefault(), f[0]!.focus());
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (back?.isConnected) back.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="cor-hoja-back" onMouseDown={fondoMouseDown(closeOnBack, onClose)}>
      <div ref={box} className={`cor-hoja ${wide ? "wide" : bottom ? "abajo" : ""}`} role="dialog" aria-modal="true" aria-labelledby="hoja-t">
        <Label>{label}</Label>
        <h2 id="hoja-t" className="cor-h2">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
};

const Rows = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="cor-hoja-rows">
    {rows.map(([k, v]) => (
      <div key={k}>
        <dt>{k}</dt>
        <dd>{v}</dd>
      </div>
    ))}
  </dl>
);

export const NuevoProyecto = ({ onClose, onOpen }: { onClose: () => void; onOpen: (slug: string) => void }) => {
  const w = words(HOJAS_WORDS);
  const ag = agregarWords();
  // The form's state and calls are shared with step 2 of the first-delivery wizard (components/agregar).
  const { name, setName, setNameTouched, goal, setGoal, codigo, elegir, carpeta, setCarpeta, repo, setRepo, ssh, setSsh, sinVentana, code, pideMeta, follow, usaGithub, github, aviso, ventana, make, err, sinRama, send, busy } =
    useAgregarProyecto();
  // NEWPROJ-4: what the new project still lacks. Until it answers, the title says only that it was created.
  const listo = useQuery({ queryKey: ["readiness", make.data?.slug], queryFn: () => api.readiness(make.data!.slug), enabled: !!make.data });
  if (make.data) {
    const aviso = listo.data ? listoAviso(listo.data) : null;
    const resumen = (
      <>
        <Rows rows={[[w.key, <Key key="k">{make.data.key_prefix}</Key>], [w.po, make.data.po], [w.paused, w.pausedRow]]} />
        {goal.trim() ? <p className="cor-text">{w.quoted(goal.trim())}</p> : null}
        {aviso && (
          <p className="cor-listo-aviso" role="status" data-listo-aviso>
            {aviso}
          </p>
        )}
      </>
    );
    return (
      <Hoja label={w.newProject} title={creadoTitulo(name.trim(), listo.data ?? null)} onClose={onClose}>
        {/* The added project in three sections (Resumen, Falta, Listo), so the sheet stays short. */}
        {listo.data ? (
          <ListoSecciones r={listo.data} resumen={resumen} ajustes={<AjustesLink slug={make.data.slug} />} />
        ) : (
          <>
            {resumen}
            {listo.isError ? <p className="cor-cap">{w.readinessFailed}</p> : <div className="cor-skel" style={{ height: 80 }} aria-busy="true" />}
          </>
        )}
        <div className="cor-acts">
          <Btn kind="primary" onClick={() => onOpen(make.data!.slug)} data-control="abrir-proyecto">
            {w.openProject}
          </Btn>
          <Btn kind="quiet" onClick={onClose}>
            {w.close}
          </Btn>
        </div>
      </Hoja>
    );
  }
  return (
    <Hoja label={w.newProject} title={w.whatBuild} onClose={onClose} closeOnBack={nuevoProyectoSinTexto([name, goal, carpeta, repo, ssh])}>
      <form
        className="cor-hoja-form cor-hoja-nuevo"
        onSubmit={(e) => {
          e.preventDefault();
          send(sinRama);
        }}
      >
        <fieldset className="cor-hoja-codigo" data-codigo={codigo ?? "none"}>
          <legend className="cor-text">{w.whereCode}</legend>
          <div className="cor-opts" role="radiogroup" aria-label={w.whereCodeLabel}>
            {codigoOpciones().map((o) => (
              <button key={o.key} type="button" role="radio" aria-checked={codigo === o.key} className="cor-opt" onClick={() => elegir(o.key)} data-codigo-opcion={o.key}>
                {o.label}
              </button>
            ))}
          </div>
          {codigo && <p className="cor-text">{codigoOpciones().find((o) => o.key === codigo)!.hint}</p>}
          {codigo === "carpeta" && (
            <label className="cor-hoja-one">
              <span className="cor-text">{w.folder}</span>
              <span className="cor-hoja-carpeta">
                <input
                  className="cor-input cor-mono"
                  value={carpeta}
                  onChange={(e) => {
                    setCarpeta(e.target.value);
                    follow("carpeta", e.target.value);
                  }}
                  placeholder={w.folderPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  required
                  data-campo="carpeta"
                />
                <Btn disabled={ventana.isPending} onClick={() => ventana.mutate()} data-control="elegir-carpeta">
                  {ventana.isPending ? ag.eligiendo : ag.elegir}
                </Btn>
              </span>
              {sinVentana && <span className="cor-cap">{ag.sinVentana}</span>}
            </label>
          )}
          {codigo === "github" && (
            <label className="cor-hoja-one">
              <span className="cor-text">{w.githubRepo}</span>
              <input
                className="cor-input cor-mono"
                value={repo}
                onChange={(e) => {
                  setRepo(e.target.value);
                  follow("github", e.target.value);
                }}
                placeholder={ag.nubePlaceholder}
                autoComplete="off"
                spellCheck={false}
                required
                data-campo="repo"
              />
              {repo.trim() && !code && <span className="cor-cap">{ag.repoMal}</span>}
            </label>
          )}
          {codigo === "ssh" && (
            <label className="cor-hoja-one">
              <span className="cor-text">{ag.sshLabel}</span>
              <input
                className="cor-input cor-mono"
                value={ssh}
                onChange={(e) => {
                  setSsh(e.target.value);
                  follow("ssh", e.target.value);
                }}
                placeholder={ag.sshPlaceholder}
                autoComplete="off"
                spellCheck={false}
                required
                data-campo="ssh"
              />
              {ssh.trim() && !code && <span className="cor-cap">{ag.sshMal}</span>}
            </label>
          )}
        </fieldset>
        <span className="cor-hoja-two">
          <label>
            <span className="cor-text">{w.name}</span>
            <input
              className="cor-input"
              value={name}
              maxLength={NOMBRE_MAX}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
              placeholder={w.namePlaceholder}
              required
              data-campo="nombre"
            />
          </label>
          <label style={{ flex: 2 }}>
            <span className="cor-text">{pideMeta || !codigo ? w.goal : ag.metaOpcional}</span>
            <input className="cor-input" value={goal} maxLength={META_MAX} onChange={(e) => setGoal(e.target.value)} placeholder={w.goalPlaceholder} required={pideMeta} data-campo="meta" />
          </label>
        </span>
        {usaGithub && github.isPending && <p className="cor-cap" aria-busy="true">{githubAvisoWords().revisando}</p>}
        {aviso && (
          <div className="cor-listo-aviso" role="status" data-github-aviso>
            <p className="cor-text">
              <b>{githubAvisoWords().titulo}</b> {aviso.por}.
            </p>
            <p className="cor-text">{aviso.arregla}</p>
            {aviso.comando && <CopyCommand command={aviso.comando} />}
            <p className="cor-cap">{githubAvisoWords().puedes}</p>
          </div>
        )}
        <Rows rows={[[w.key, w.keyRow], [w.po, w.poRow], [w.paused, w.pausedRow]]} />
        {make.isError && (
          <p className={sinRama ? "cor-text cor-hoja-refusal" : "cor-state bad cor-hoja-refusal"} role="alert" data-refusal={err?.code ?? "red"}>
            {err ? agregarError(err.code, err.detail) : agregarError(null)}
          </p>
        )}
        <div className="cor-acts">
          {sinRama ? (
            <Btn kind="primary" type="submit" disabled={make.isPending || !name.trim() || !code} data-control="crear-rama-y-agregar">
              {busy ?? ag.crearRama}
            </Btn>
          ) : (
            <Btn kind="primary" type="submit" disabled={make.isPending || !name.trim() || !code || (pideMeta && !goal.trim())} data-control="crear-proyecto">
              {busy ?? w.create}
            </Btn>
          )}
          <Btn kind="quiet" onClick={onClose}>
            {w.cancel}
          </Btn>
        </div>
      </form>
    </Hoja>
  );
};

export const Pausar = ({ p, onClose, onDone }: { p: OrgProject; onClose: () => void; onDone: () => void }) => {
  const w = words(HOJAS_WORDS);
  const live = p.team.filter((m) => m.state === "running");
  const pause = useMutation({ mutationFn: () => api.setProjectPaused(p.slug, true), onSuccess: () => (toast(w.pausedToast(p.title)), onDone()), onError: () => toast.error(w.pauseFailed) });
  return (
    <Hoja label={w.pause} title={w.pauseQ(p.title)} onClose={onClose}>
      <Rows
        rows={[
          [w.closes, live.length ? w.closesLive(live.map((m) => `${seatName(m.role)}${m.now?.ticket ? ` (${m.now.ticket})` : ""}`).join(", ")) : w.nothingRunning],
          [w.noStart, w.noStartRow(p.title)],
          [w.stays, w.staysRow],
        ]}
      />
      <p className="cor-cap">{w.undo}</p>
      <div className="cor-acts">
        <Btn kind="primary" disabled={pause.isPending} onClick={() => pause.mutate()} data-control="pausar-si">
          {pause.isPending ? w.pausing : w.pauseIt(p.title)}
        </Btn>
        <Btn kind="quiet" onClick={onClose}>
          {w.cancel}
        </Btn>
      </div>
    </Hoja>
  );
};

export const Reanudar = ({ p, companyPaused, onClose, onDone, plomeriaTo }: { p: OrgProject | null; companyPaused: boolean; onClose: () => void; onDone: () => void; plomeriaTo: string }) => {
  const w = words(HOJAS_WORDS);
  // F6: with the company stopped too, the one button resumes both (the project first, then the company).
  const both = !!p && pausaDe(companyPaused, p.paused) === "ambas";
  const go = useMutation({
    mutationFn: async () => {
      await api.setProjectPaused(p!.slug, false);
      if (both) await api.setCompanyPaused(false);
    },
    onSuccess: () => (toast(both ? pausasWords().ambasHecho(p!.title) : w.resumedToast(p!.title)), onDone()),
    onError: () => toast.error(w.resumeFailed),
  });
  // NEWPROJ-4: whether there is anything to take back up, and what will make the first run fail. Resuming stays allowed.
  const listo = useQuery({ queryKey: ["readiness", p?.slug], queryFn: () => api.readiness(p!.slug), enabled: !!p });
  const falla = reanudarFalla(listo.data ?? null);
  return (
    <Hoja label={w.resumeLabel} title={p ? w.isPaused(p.title) : w.companyStopped} onClose={onClose}>
      <Rows
        rows={[
          [w.onResume, reanudarAlReanudar(listo.data ?? null)],
          [w.ifAll, w.ifAllRow],
        ]}
      />
      {falla && (
        <p className="cor-listo-aviso" role="status" data-reanudar-falla>
          {falla}
        </p>
      )}
      {listo.data && listo.data.blocking > 0 && (
        <details className="cor-listo-mas" data-reanudar-lista>
          <summary className="cor-cap">{w.whatLacks}</summary>
          <ListoLista r={listo.data} look="cor" ajustes={p && <AjustesLink slug={p.slug} />} />
        </details>
      )}
      {companyPaused && <p className="cor-state amber">{both ? pausasWords().ambasNota : w.companyStoppedNote}</p>}
      <div className="cor-acts">
        {p && (
          <Btn kind="primary" disabled={go.isPending} onClick={() => go.mutate()} data-control="reanudar-si">
            {go.isPending ? w.resuming : both ? pausasWords().ambasBoton(p.title) : w.resumeIt(p.title)}
          </Btn>
        )}
        <Link className="cor-btn secondary" to={plomeriaTo} data-control="ir-plomeria">
          {w.goPlomeria}
        </Link>
        <Btn kind="quiet" onClick={onClose}>
          {w.close}
        </Btn>
      </div>
    </Hoja>
  );
};

const publishError = (code: string, detail: Record<string, unknown> = {}): string => {
  const w = words(HOJAS_WORDS);
  if (code === "RELEASE_NOT_READY") {
    const why = String(detail.reason ?? "");
    if (why === "open_checks") return w.openChecks;
    if (why === "before_steps") return w.beforeSteps;
    if (why === "merged" || why === "nothing_to_ship") return w.alreadyMerged;
    if (why === "mode_command") return w.byCommand;
    if (why === "prod_migration_unhandled") return publicarWords().prodUnset("");
    if (why === "freeze") return w.freeze;
    return w.notHere;
  }
  if (code === "RELEASE_MERGE_FAILED") return w.githubRefused(detail.output ? String(detail.output) : null);
  if (code === "CAMINO_RULE_BLOCKS") return w.ruleBlocks(Array.isArray(detail.checks) ? detail.checks.join(", ") : "");
  return w.publishFailed(code);
};

// PLA-I68-6: Camino's production environment reviews the SQL and asks for the owner's approval of the exact file of a
// destructive migration; the sheet lists them, approves each one, and Publicar can then run again.
type HoldFile = { path: string; sha256?: string; statements?: string[]; issues?: { rule: string; message: string }[] };
const MigrationHold = ({ slug, code, detail }: { slug: string; code: string; detail: Record<string, unknown> }) => {
  const w = words(HOJAS_WORDS);
  const [done, setDone] = useState<Set<string>>(new Set());
  const files = (Array.isArray(detail.files) ? detail.files : []) as HoldFile[];
  return (
    <div className="cor-state bad" role="alert" data-publish-hold={code}>
      <p>{code === "CAMINO_SQL_REVIEW" ? w.sqlReview : w.needsApproval}</p>
      <ul className="cor-hoja-list">
        {files.map((f) => (
          <li key={f.path} className="cor-row" data-migracion={f.path}>
            <span className="cor-mono cor-ellipsis">{f.path}</span>
            <span className="cor-cap">{(f.statements ?? f.issues?.map((i) => `${i.rule}: ${i.message}`) ?? []).join(" · ")}</span>
            {code === "CAMINO_NEEDS_APPROVAL" && f.sha256 && (
              <Btn
                kind="secondary"
                small
                disabled={done.has(f.path)}
                onClick={() => void api.caminoApprove(slug, f.path, f.sha256!).then(() => setDone((s) => new Set(s).add(f.path)))}
                data-control={`aprobar-${f.path}`}
              >
                {done.has(f.path) ? w.approved : w.approveFile}
              </Btn>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export const Publicar = ({ p, release, first, firstTo, onClose }: { p: OrgProject; release: Decision | null; first: Decision | null; firstTo: string | null; onClose: () => void }) => {
  const w = words(HOJAS_WORDS);
  const client = useQueryClient();
  const [kept] = useState(release);
  const [since, setSince] = useState<number | null>(null);
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    if (since === null) return;
    const id = window.setInterval(() => setT(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  const ship = useMutation({
    mutationFn: () => api.shipRelease(p.slug),
    onMutate: () => setSince(Date.now()),
    onSuccess: () => toast.success(w.publishedToast(p.title)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
  const r = (release ?? kept)?.release ?? null;
  // PLA-160 (F-35): an empty sheet asks GitHub once more (the server throttles it), then reads the plan again.
  const recheck = useQuery({
    queryKey: ["release-recheck", p.slug],
    queryFn: async () => {
      const out = await api.releaseRecheck(p.slug);
      await client.invalidateQueries({ queryKey: ["company"] });
      return out;
    },
    enabled: !r,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  if (!r)
    return (
      <Hoja label={w.publish} title={w.publishIt(p.title)} onClose={onClose}>
        <p className="cor-text" data-publish-empty={recheck.isFetching ? "checking" : "empty"}>
          {recheck.isFetching ? w.recheckingPublish : w.nothingToPublish(p.title)}
        </p>
        <div className="cor-acts">
          <Btn kind="secondary" onClick={onClose}>
            {w.close}
          </Btn>
        </div>
      </Hoja>
    );
  const n = r.tickets.length;
  const blocked = r.open_checks > 0 || r.before > 0;
  // PLA-I68-1: migrations with nobody named for production: the sheet offers the setting instead of Publicar.
  const waits = prodWaits(r);
  const pw = publicarWords();
  const prodFix = prodFixLink(r);
  const done = ship.isSuccess ? ship.data : null;
  return (
    <Hoja label={w.publish} title={w.publishIt(p.title)} onClose={onClose} wide>
      <div className="cor-card cor-hoja-what">
        <Label>{w.whatUsersSee(p.title)}</Label>
        <p className="cor-text">{w.changesGo(n, r.from, r.into, r.ahead ?? null)}</p>
      </div>
      <ul className="cor-hoja-list" data-publish-list={n}>
        {r.tickets.slice(0, 4).map((x) => (
          // PLA-158 (F-30): the owner reads what changes, not ticket keys (rule 9): the title only.
          <li key={x.key} className="cor-row">
            <span className="cor-ellipsis" title={x.title}>
              {x.title}
            </span>
          </li>
        ))}
        {n > 4 && <li className="cor-cap">{w.andMore(n - 4)}</li>}
      </ul>
      {!!r.migrations?.length && (
        <p className="cor-text" data-publish-migrations={r.migrate ?? ""} data-publish-prod={r.prod_migrations ?? "unset"}>
          {migrationLine(r.migrations, r.migrate ?? null, p.title, undefined, r.prod_migrations ?? null)}
        </p>
      )}
      {waits && prodFix.why && (
        <p className="cor-text" data-publish-prod-fix={prodFix.focus ?? ""}>
          {prodFix.why}
        </p>
      )}
      {!!r.reel?.length && (
        <div className="cor-reel" data-publish-reel={r.reel.length}>
          {r.reel.slice(0, 3).map((x) => (
            <figure key={x.key}>
              <img src={x.image_url} alt={`${x.title}: ${x.label}`} loading="lazy" />
              <figcaption className="cor-cap">{`${x.kind === "nueva" ? w.reelNew : w.reelChanged} · ${x.label}`}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {blocked && !done && (
        <p className="cor-hoja-block" data-publish-blocked>
          <You small flat />
          {r.open_checks > 0 ? w.openPoints(r.open_checks) : first ? w.yourStepFirst(first.kind === "deliverable" || first.kind === "pr" ? w.acceptRef(first.ref ?? null) : first.title) : w.yourSteps(r.before)}
          {firstTo && (
            <Link className="cor-inline" to={firstTo}>
              {w.doItFirst}
            </Link>
          )}
        </p>
      )}
      {ship.isPending && since !== null && (
        <p className="cor-text" role="status" data-publish-working>
          {w.publishingGithub} <span className="cor-mono">{`${Math.floor((t - since) / 60000)}:${String(Math.floor(((t - since) / 1000) % 60)).padStart(2, "0")}`}</span> {w.proposalOpens(r.from, r.into)}
        </p>
      )}
      {done && (
        <p className="cor-state ok" role="status" data-publish-done>
          {w.published(n, done.merge_sha.slice(0, 7))}
          {done.migrate === "auto" ? w.migrateAuto : ""}
          {done.prod_migrations ? ` ${pw.prod[done.prod_migrations]}` : ""}{" "}
          <a className="cor-inline" href={done.pr.url} target="_blank" rel="noreferrer">
            {w.seeGithub}
          </a>
        </p>
      )}
      {ship.isError && ship.error instanceof ApiError && (ship.error.code === "CAMINO_NEEDS_APPROVAL" || ship.error.code === "CAMINO_SQL_REVIEW") ? (
        <MigrationHold slug={p.slug} code={ship.error.code} detail={ship.error.detail} />
      ) : (
        ship.isError && <p className="cor-state bad" role="alert" data-publish-error>{ship.error instanceof ApiError ? publishError(ship.error.code, ship.error.detail) : w.notNow}</p>
      )}
      <div className="cor-acts">
        {done ? (
          <Btn kind="primary" onClick={onClose} data-control="publicar-listo">
            {w.done}
          </Btn>
        ) : (
          <>
            {waits ? (
              // PLA-158 (F-25): to Camino's production environment, on the field that is missing.
              <Link className="cor-btn primary" to={prodFix.env ? `${linkTo({ slug: p.slug, tab: "camino", ver: { kind: "camino", sec: `env:${prodFix.env}` } })}#${prodFix.focus}` : `${linkTo({ slug: p.slug, tab: "camino" })}`} onClick={onClose} data-control="publicar-ajustes">
                {prodFix.label}
              </Link>
            ) : (
              <Btn kind="primary" disabled={ship.isPending || blocked} onClick={() => ship.mutate()} data-control="publicar-si">
                {ship.isPending ? w.publishing : w.publishChanges}
              </Btn>
            )}
            <Btn kind="quiet" disabled={ship.isPending} onClick={onClose}>
              {w.close}
            </Btn>
          </>
        )}
      </div>
    </Hoja>
  );
};

export const Meta = ({ p, onClose }: { p: OrgProject; onClose: () => void }) => {
  const w = words(HOJAS_WORDS);
  const client = useQueryClient();
  const goalId = p.rumbo?.goal_id ?? null;
  const [title, setTitle] = useState(p.rumbo?.goal ?? "");
  const [date, setDate] = useState(p.rumbo?.target_on ?? "");
  const save = useMutation({
    mutationFn: (body: GoalWrite) => (goalId ? api.patchGoal(goalId, body) : api.createGoal({ ...body, project: p.slug })),
    onSuccess: () => {
      toast(goalId ? w.goalUpdated : w.goalCreated);
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["goals"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? w.goalFailedCode(e.code) : w.goalFailed),
  });
  return (
    <Hoja label={w.goalLabel} title={w.whereGoes(p.title)} onClose={onClose} wide>
      <form
        className="cor-hoja-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) save.mutate({ title: title.trim(), why: p.rumbo?.why ?? "", status: "active", target_on: date.trim() ? date.trim() : null });
        }}
      >
        <span className="cor-hoja-two">
          <label style={{ flex: 3 }}>
            <span className="cor-text">{w.goal}</span>
            <input className="cor-input" value={title} maxLength={240} onChange={(e) => setTitle(e.target.value)} required data-control="meta-titulo" />
          </label>
          <label>
            <span className="cor-text">{w.date}</span>
            <input type="date" className="cor-input" value={date} onChange={(e) => setDate(e.target.value)} data-control="meta-fecha" />
          </label>
        </span>
        <p className="cor-cap">{w.goalHint}</p>
        <div className="cor-acts">
          <Btn kind="primary" type="submit" disabled={save.isPending || !title.trim()} data-control="guardar-meta">
            {save.isPending ? w.saving : w.saveGoal}
          </Btn>
          <Btn kind="quiet" onClick={onClose}>
            {w.cancel}
          </Btn>
        </div>
      </form>
    </Hoja>
  );
};

/** A doc linked from a message or a role (?doc=<id>, the address lib/org.ts gives company docs). */
export const DocHoja = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const w = words(HOJAS_WORDS);
  const q = useQuery({ queryKey: ["prompt-doc", id], queryFn: () => api.promptDoc(id) });
  return (
    <Hoja label={q.data ? `Doc · v${q.data.version}` : "Doc"} title={q.data?.title ?? "Doc"} onClose={onClose} wide>
      {q.isError ? (
        <p className="cor-state bad">{w.docFailed}</p>
      ) : q.data ? (
        <div className="cor-md cor-hoja-doc" tabIndex={0} role="region" aria-label={q.data.title}>
          <Markdown remarkPlugins={[remarkGfm]}>{q.data.markdown}</Markdown>
        </div>
      ) : (
        <div className="cor-skel" style={{ height: 200 }} aria-busy="true" />
      )}
      <div className="cor-acts">
        <Btn kind="secondary" onClick={onClose}>
          {w.close}
        </Btn>
      </div>
    </Hoja>
  );
};
