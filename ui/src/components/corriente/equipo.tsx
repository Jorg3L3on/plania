// PLA-I62-6: a project's team (board B5). Whoever works is a lit card: what it is on, since when, Detener; what is
// in its line, the last thing it delivered and its last run (Reanudar corrida when that run was stopped); Dile algo
// (a note on what it does now, else an order to the PO for that seat). The rest are rows with their state and the
// nudge the building gives (Que empiece ya, or Seguir de todos modos past the guard). Sumar: role, packs and motor,
// the building's form (GET /company/projects/:slug for the free roles, GET /company/packs, POST …/team).
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ApiError, api, type MotorPatch, type OrgMember, type OrgProject } from "@/lib/api";
import { hrefOf, seatName } from "@/lib/corriente";
import { caption, sayTo, startsLine } from "@/lib/edificio";
import { MODELS, motorLine, type ModelId } from "@/lib/motores";
import { linkHref } from "@/lib/org";
import { firstFree, hireLabel, roleChoices, suggestedPacks } from "@/lib/sumar";
import type { CorrienteActs } from "./acts";
import { Agent, Btn, Key, Label, State } from "./parts";

export const ROLE_LINE: Record<string, string> = {
  "product-owner": "Entiende lo que pides y lo planea",
  research: "Investiga antes de diseñar",
  artist: "Dibuja bocetos y pantallas",
  taller: "Construye lo que está en el plan",
  qa: "Prueba cada entrega antes de la revisión",
};
const NUM = ["Nadie", "Uno", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho"];
export function teamHeadline(team: OrgMember[], paused: boolean): { now: string; rest: string | null } {
  if (paused) return { now: "El equipo está en pausa.", rest: null };
  const w = team.filter((m) => m.state === "running").length;
  const free = team.length - w;
  return { now: w ? `${NUM[w] ?? w} trabajando.` : "Nadie trabajando.", rest: free ? `${NUM[free] ?? free} ${free === 1 ? "libre" : "libres"}.` : null };
}
const mins = (since: string | undefined, now: number) => (since ? Math.max(0, Math.round((now - Date.parse(since)) / 60_000)) : 0);

const Say = ({ p, m, acts }: { p: OrgProject; m: OrgMember; acts: CorrienteActs }) => {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const say = sayTo(m, text);
    if (!say) return;
    if (say.kind === "note") {
      acts.note(p.slug, say.key, say.text);
      setSent("Se lo dijiste; lo lee en su siguiente paso.");
    } else {
      try {
        await api.askProject(p.slug, { text: say.text, now: false });
        acts.refresh();
        setSent("Se lo pediste al PO.");
      } catch (err) {
        setSent(err instanceof ApiError ? `No se pudo (${err.code}).` : "No se pudo. Si la máquina está dormida, intenta al despertar.");
      }
    }
    setText("");
  };
  return (
    <form className="cor-say" onSubmit={(e) => void submit(e)} data-say={m.agent}>
      <Label as="p">Dile algo</Label>
      <span className="cor-ajuste-row">
        <input className="cor-input" value={text} maxLength={1000} aria-label={`Dile algo a ${seatName(m.role)}`} placeholder={m.now?.ticket ? "Lo lee en su siguiente paso" : "Va al PO como pedido para este puesto"} onChange={(e) => setText(e.target.value)} />
        <Btn kind="secondary" type="submit" disabled={text.trim().length < 2} data-control="decir">
          Enviar
        </Btn>
      </span>
      <span className="cor-cap" role="status">
        {sent ?? (m.now?.ticket ? "Se anota en lo que hace ahora." : "No está en nada: se lo pides al PO.")}
      </span>
    </form>
  );
};

const LitCard = ({ p, m, now, acts, motorTo }: { p: OrgProject; m: OrgMember; now: number; acts: CorrienteActs; motorTo: string }) => {
  const live = m.state === "running" && m.now?.run_id ? m.now.run_id : null;
  const stopped = !live && m.last?.status === "stopped" && m.last.run_id ? m.last.run_id : null;
  const href = m.produced ? linkHref(m.produced, p.slug) : null;
  const c = caption(m, now);
  return (
    <section className={`cor-card ${live ? "live" : ""} cor-litcard`} aria-label={seatName(m.role)} data-member={m.agent}>
      <div className="cor-lit-top">
        {live ? <Agent /> : <i className="cor-ring" aria-hidden />}
        <div className="cor-lit-who">
          <b>{seatName(m.role)}</b>
          <span className="cor-cap">{ROLE_LINE[m.role] ?? ""}</span>
        </div>
        <div className="cor-lit-now">
          <span className={`cor-state ${live ? "live" : ""}`}>{live ? `Trabajando · ${mins(m.now?.since, now)} min` : m.state === "waiting_owner" ? "Te espera" : "Libre"}</span>
          <span className="cor-ellipsis">
            {/* PLA-67 (F-6): what a seat works on opens from here, an idea or a step. */}
            {m.now?.ticket && (
              <Link to={hrefOf({ slug: p.slug, ver: /-IDEA\d+$/.test(m.now.ticket) ? { kind: "idea", key: m.now.ticket } : { kind: "paso", key: m.now.ticket } })} data-control="abrir-trabajo">
                <Key>{m.now.ticket}</Key>
              </Link>
            )}{" "}
            {m.now?.title ?? c.doing}
          </span>
          {live && (
            <span className="cor-bar" aria-hidden>
              <i className="cor-bar-fill" />
            </span>
          )}
        </div>
        <Link className="cor-btn quiet" to={motorTo} data-control="motor">
          Motor
        </Link>
        {live && (
          <Btn kind="secondary" onClick={() => acts.stopRun(live)} disabled={acts.busy === `stop-${live}`} data-control="detener">
            {acts.busy === `stop-${live}` ? "Deteniendo…" : "Detener"}
          </Btn>
        )}
        {stopped && (
          <Btn kind="secondary" onClick={() => acts.resumeRun(stopped)} disabled={acts.busy === `resume-${stopped}`} data-control="reanudar-corrida">
            Reanudar corrida
          </Btn>
        )}
      </div>
      <div className="cor-lit-grid">
        <div>
          <Label as="p">En fila</Label>
          {(m.queue ?? []).length ? (
            <ol className="cor-queue">
              {m.queue!.slice(0, 2).map((q, i) => (
                <li key={q.key}>
                  <span className="cor-cap">{i + 1}</span> <span className="cor-ellipsis">{q.title}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="cor-text">Nada en fila para este puesto.</p>
          )}
        </div>
        <div>
          <Label as="p">Lo último que entregó</Label>
          {m.produced ? (
            href ? (
              /^https?:/.test(href) ? (
                <a className="cor-inline" href={href} target="_blank" rel="noreferrer">
                  {m.produced.title}
                </a>
              ) : (
                <Link className="cor-inline" to={href}>
                  {m.produced.title}
                </Link>
              )
            ) : (
              <p className="cor-text">{m.produced.title}</p>
            )
          ) : (
            <p className="cor-text">Todavía nada entregado.</p>
          )}
          {m.last && <p className="cor-cap">{`Su última corrida: ${c.sub || "hace un rato"}`}</p>}
        </div>
        <Say p={p} m={m} acts={acts} />
      </div>
    </section>
  );
};

const Row = ({ p, m, now, acts, timeZone, motorTo, open, onOpen }: { p: OrgProject; m: OrgMember; now: number; acts: CorrienteActs; timeZone?: string; motorTo: string; open: boolean; onOpen: () => void }) => {
  const n = m.next_start;
  const start = n && (n.hold === "rest" || n.hold === "usage" || n.hold === "unqueued") ? { label: n.hold === "usage" ? "Seguir de todos modos" : "Que empiece ya", past: n.hold === "usage" } : null;
  const c = caption(m, now, { timeZone });
  const line = n ? startsLine(n, now, timeZone) : m.state === "waiting_owner" ? c.sub : m.role === "product-owner" ? "Recibiría el siguiente pedido que hagas." : c.doing;
  return (
    <li className="cor-trow" data-member={m.agent}>
      <i className="cor-ring" aria-hidden />
      <button type="button" className="cor-trow-who" aria-expanded={open} onClick={onOpen}>
        <b>{seatName(m.role)}</b>
        <span className="cor-cap">{ROLE_LINE[m.role] ?? ""}</span>
      </button>
      <State tone={m.state === "waiting_owner" ? "amber" : undefined}>{p.paused ? "En pausa" : m.state === "waiting_owner" ? "Te espera" : "Libre"}</State>
      <span className="cor-text cor-clamp2">{line}</span>
      {start && !p.paused && (
        <Btn kind="secondary" onClick={() => acts.start(p.slug, m.agent, start.past)} disabled={acts.busy === `${p.slug}:start`} data-control="arrancar">
          {start.label}
        </Btn>
      )}
      <Link className="cor-btn quiet" to={motorTo} data-control="motor">
        Motor
      </Link>
    </li>
  );
};

const Sumar = ({ p, motorDefault, focus }: { p: OrgProject; motorDefault?: { model: string | null; effort: string | null }; focus: boolean }) => {
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ["company-project", p.slug], queryFn: () => api.companyProject(p.slug) });
  const packs = useQuery({ queryKey: ["company-packs"], queryFn: () => api.packs() });
  const choices = roleChoices(detail.data?.hire ?? []);
  const free = [...choices.main, ...choices.otros].filter((c) => c.state === "free");
  const [picked, setPicked] = useState<string | null>(null);
  const role = picked && free.some((c) => c.slug === picked) ? picked : firstFree(choices);
  const [chosen, setChosen] = useState<{ role: string | null; packs: string[] } | null>(null);
  const pk = chosen && chosen.role === role ? chosen.packs : suggestedPacks(role, packs.data?.packs ?? []);
  const [model, setModel] = useState<ModelId | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (v: { template: string; packs: string[]; motor?: MotorPatch }) => api.addToTeam(p.slug, v.template, v.packs, v.motor),
    onSuccess: (_r, v) => {
      setAdded(hireLabel(v.template));
      void client.invalidateQueries({ queryKey: ["company"] });
      void client.invalidateQueries({ queryKey: ["company-project", p.slug] });
    },
  });
  if (p.team.length >= 8) return null;
  return (
    <aside className={`cor-card cor-sumar ${focus ? "focus" : ""}`} aria-label="Sumar a alguien" data-sumar>
      <Label>Sumar a alguien</Label>
      {detail.isPending ? (
        // PLA-82 (F-5): an empty grey box for ~2 s read as broken; it says what it is doing.
        <p className="cor-text cor-muted" style={{ minHeight: 160 }} role="status" aria-busy="true" data-sumar-loading>
          Buscando los puestos libres…
        </p>
      ) : free.length === 0 ? (
        <p className="cor-text">Todos los puestos con su doc ya están en el equipo.</p>
      ) : (
        <>
          <h3 className="cor-h3">{role ? `Puesto vacío: ${hireLabel(role)}` : "Elige un puesto"}</h3>
          {role && ROLE_LINE[role] && <p className="cor-text">{ROLE_LINE[role]}.</p>}
          <label className="cor-label" htmlFor="sumar-rol">
            Plantilla de puesto
          </label>
          <select id="sumar-rol" className="cor-select" value={role ?? ""} onChange={(e) => setPicked(e.target.value)} data-control="sumar-plantilla">
            {free.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
          <details className="cor-sumar-more">
            <summary className="cor-btn link">{`Paquetes · ${pk.length} elegidos`}</summary>
            {packs.isError ? (
              <p className="cor-cap">No se pudieron leer los paquetes. Puedes sumar sin ellos.</p>
            ) : (
              <ul>
                {(packs.data?.packs ?? []).map((x) => (
                  <li key={x.slug}>
                    <label className="cor-check" data-inline-ok>
                      <input type="checkbox" checked={pk.includes(x.slug)} onChange={() => setChosen({ role, packs: pk.includes(x.slug) ? pk.filter((s) => s !== x.slug) : [...pk, x.slug] })} data-pack={x.slug} />
                      <span>{x.name}</span>
                    </label>
                  </li>
                ))}
                {(packs.data?.packs ?? []).length === 0 && <li className="cor-cap">Aún no hay paquetes.</li>}
              </ul>
            )}
          </details>
          <label className="cor-label" htmlFor="sumar-motor">
            Motor
          </label>
          <select id="sumar-motor" className="cor-select" value={model ?? ""} onChange={(e) => setModel((e.target.value || null) as ModelId | null)} data-control="sumar-modelo">
            <option value="">{`El de la compañía · ${motorLine(motorDefault?.model ?? null, motorDefault?.effort ?? null)}`}</option>
            {MODELS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <Btn kind="secondary" disabled={!role || add.isPending} onClick={() => role && add.mutate({ template: role, packs: pk, motor: model ? { model } : undefined })} data-control="sumar-rol">
            {add.isPending ? "Sumando…" : "Añadir al equipo"}
          </Btn>
          {add.isError && <p className="cor-state bad">{add.error instanceof ApiError ? `No se pudo sumar (${add.error.code}).` : "No se pudo. Si la máquina está dormida, intenta al despertar."}</p>}
          {added && (
            <p className="cor-state ok" role="status">
              ✓ {added} se suma al equipo.
            </p>
          )}
          <p className="cor-cap">Una plantilla de puesto; quien llega trabaja solo en este proyecto y usa el motor de la compañía hasta que le pongas uno en Motores.</p>
        </>
      )}
    </aside>
  );
};

export const Equipo = ({ p, now, timeZone, companyPaused, acts, focus, motorTo, sumarTo, motorDefault }: { p: OrgProject; now: number; timeZone?: string; companyPaused: boolean; acts: CorrienteActs; focus: string | null; motorTo: string; sumarTo: string; motorDefault?: { model: string | null; effort: string | null } }) => {
  const paused = companyPaused || p.paused;
  const lit = (focus && focus !== "sumar" ? p.team.find((m) => m.agent === focus) : null) ?? p.team.find((m) => m.state === "running" && !paused) ?? null;
  const rest = p.team.filter((m) => m !== lit);
  const [open, setOpen] = useState<string | null>(null);
  const h = teamHeadline(p.team, paused);
  return (
    <div className="cor-equipo" data-equipo={p.team.length}>
      <div className="cor-equipo-main">
        <div className="cor-pedidos-head" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <h2 className="cor-h3" style={{ fontSize: 22 }}>
            {h.now} {h.rest && <span className="cor-muted">{h.rest}</span>}
          </h2>
          {p.team.length < 8 && (
            <Link className="cor-btn primary" to={sumarTo} data-control="sumar">
              Sumar a alguien
            </Link>
          )}
        </div>
        {lit && <LitCard p={p} m={lit} now={now} acts={acts} motorTo={motorTo} />}
        {!lit && (
          <div className="cor-card cor-empty" data-nadie>
            <p className="cor-text">{paused ? "Nada arranca mientras está en pausa." : "Nadie trabaja ahora. Abre un puesto para decirle algo o hazlo arrancar."}</p>
          </div>
        )}
        {rest.length > 0 && (
          <section aria-label="El resto del equipo">
            <Label as="h3">{lit ? "El resto del equipo" : "El equipo"}</Label>
            <ul>
              {rest.map((m) => (
                <Row key={m.agent} p={p} m={m} now={now} acts={acts} timeZone={timeZone} motorTo={motorTo} open={open === m.agent} onOpen={() => setOpen(open === m.agent ? null : m.agent)} />
              ))}
            </ul>
            {open && (
              <div className="cor-card" style={{ padding: "12px 16px" }}>
                <Say p={p} m={rest.find((m) => m.agent === open)!} acts={acts} />
              </div>
            )}
          </section>
        )}
      </div>
      <Sumar p={p} motorDefault={motorDefault} focus={focus === "sumar"} />
    </div>
  );
};
