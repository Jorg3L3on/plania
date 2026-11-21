// PLA-135 (PLA-IDEA35, canvas «Docs del proyecto en Ajustes», pass 2): the project's own docs in Ajustes, drawn as
// who reads what. Left, the three context notes: every run reads them before it starts, so they are wired to every
// seat with a solid line that flows. Middle, the team's seats. Right, the library: the project's other docs, wired
// with a dashed line because the team looks one up when a task asks. A doc opens across the whole page (DocLector):
// every doc on the left, a wide reading column, a margin with Editar and who reads it; Editar splits the page into
// the text and how it reads. A thing's paper (Idea, Research, Design, Plan) opens in the same reader from its ficha,
// read-only, with the way back to the thing. Words and pure logic: @/lib/docs-proyecto.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useNavigate } from "react-router";
import { ApiError, api, type OrgProject } from "@/lib/api";
import { ajustesError, type Ajustes as AjustesRead, type AjustesContexto } from "@/lib/ajustes";
import { centres, ctxRef, docDay, docMatches, docRefOf, docsWords, initials, LIB_SHOWN, notaEstado, seatLabel, sinTitulo, tituloOk } from "@/lib/docs-proyecto";
import { Btn, BtnLink, ReadError } from "./parts";
import { useFicha } from "./listas";
import { ajustesWords } from "@/lib/ajustes";

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
const NOTE_H = 112;
const NOTE_GAP = 12;
const SEAT_H = 56;
const SEAT_GAP = 12;
const MAP_H = 3 * NOTE_H + 2 * NOTE_GAP;
const WIRE_W = 72;

export type Seat = { role: string };
type ProjectLike = { slug: string; title: string; team?: Seat[] };

const notaTitulo = (c: AjustesContexto) => ajustesWords().contexto[c.id].titulo;

/** The band in Ajustes. */
export const DocsProyecto = ({ a, p, docTo }: { a: AjustesRead; p: ProjectLike; docTo: (id: string) => string }) => {
  const w = docsWords();
  const [q, setQ] = useState("");
  const [todos, setTodos] = useState(false);
  const library = a.library ?? [];
  const seats = (p.team ?? []).filter((s, i, all) => all.findIndex((x) => x.role === s.role) === i);
  const noteY = centres(3, NOTE_H, NOTE_GAP, MAP_H);
  const seatY = centres(seats.length, SEAT_H, SEAT_GAP, MAP_H);
  const ys = [...noteY, ...seatY];
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const mid = Math.round(MAP_H / 2);
  const found = library.filter((d) => docMatches(d, q));
  // The band stays about one screen tall: the newest pages, and the rest behind «Ver los N» (a search shows all).
  const shown = todos || q.trim() ? found : found.slice(0, LIB_SHOWN);
  return (
    <section className="cor-docs-band" aria-labelledby="ajustes-contexto-h" id="ajustes-contexto" data-ajustes="contexto">
      <div className="cor-docs-band-head">
        <div className="cor-docs-band-tx">
          <h3 id="ajustes-contexto-h" className="cor-docs-band-h">
            {w.titulo}
          </h3>
          <p className="cor-text">{w.texto(p.title)}</p>
        </div>
        <label className="cor-docs-find">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <span className="sr-only">{w.buscar}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={w.buscar} data-campo="buscar-doc" />
        </label>
      </div>
      <div className="cor-docs-map">
        <div className="cor-docs-col">
          <span className="cor-label violet">{w.notas}</span>
          <div className="cor-docs-notes" style={{ height: MAP_H }}>
            {a.context.map((c) => (
              <Link key={c.id} to={docTo(ctxRef(c))} className={cls("cor-docs-note", !c.doc_id && "miss")} style={{ height: NOTE_H }} data-contexto={c.id} data-existe={c.doc_id ? "1" : "0"}>
                <b>{notaTitulo(c)}</b>
                <span className="peek">{(c.markdown || ajustesWords().contexto[c.id].para).replace(/^#.*\n+/, "")}</span>
                <span className="cor-cap">{notaEstado(c, docDay(c.updated_at ?? null))}</span>
              </Link>
            ))}
          </div>
        </div>
        <svg className="cor-docs-wires" width={WIRE_W} height={MAP_H} viewBox={`0 0 ${WIRE_W} ${MAP_H}`} aria-hidden>
          {seats.length > 0 && (
            <>
              <path className="s" d={[...noteY.map((y) => `M0 ${y} H${WIRE_W / 2}`), `M${WIRE_W / 2} ${lo} V${hi}`, ...seatY.map((y) => `M${WIRE_W / 2} ${y} H${WIRE_W}`)].join(" ")} />
              {noteY.map((y, i) => (
                <path key={i} className="fl" style={{ animationDelay: `${-i * 1.1}s` }} d={`M0 ${y} H${WIRE_W / 2} V${seatY[Math.round((i * (seatY.length - 1)) / 2)]} H${WIRE_W}`} />
              ))}
            </>
          )}
        </svg>
        <div className="cor-docs-col seats">
          <span className="cor-label">{w.equipo}</span>
          <div className="cor-docs-seats" style={{ height: MAP_H }}>
            {seats.length === 0 ? (
              <p className="cor-text cor-muted">{w.sinEquipo}</p>
            ) : (
              seats.map((s, i) => (
                <div key={s.role} className="cor-docs-seat" style={{ top: seatY[i]! - SEAT_H / 2, height: SEAT_H }} data-asiento={s.role}>
                  <span className="gl" aria-hidden>
                    {initials(seatLabel(s.role))}
                  </span>
                  <b className="cor-ellipsis">{seatLabel(s.role)}</b>
                </div>
              ))
            )}
          </div>
        </div>
        <svg className="cor-docs-wires" width={WIRE_W} height={MAP_H} viewBox={`0 0 ${WIRE_W} ${MAP_H}`} aria-hidden>
          {seats.length > 0 && <path className="d" d={[...seatY.map((y) => `M0 ${y} H${WIRE_W / 2}`), `M${WIRE_W / 2} ${Math.min(lo, mid)} V${Math.max(hi, mid)}`, `M${WIRE_W / 2} ${mid} H${WIRE_W}`].join(" ")} />}
        </svg>
        <div className="cor-docs-col lib">
          <span className="cor-label amber">{w.biblioteca(library.length)}</span>
          <div className="cor-docs-lib" data-biblioteca={library.length}>
            {shown.map((d) => (
              <Link key={d.id} to={docTo(d.id)} className="cor-docs-pg" data-doc={d.id}>
                <b>{d.title}</b>
                <span className="lines">{d.first}</span>
                <span className="cor-cap">{docDay(d.updated_at).toUpperCase()}</span>
              </Link>
            ))}
            <Link to={docTo("nuevo")} className="cor-docs-pg add" data-control="nuevo-doc">
              {`+ ${w.nuevo}`}
            </Link>
          </div>
          {!q.trim() && library.length > LIB_SHOWN && (
            <Btn kind="link" className="cor-docs-more" aria-expanded={todos} onClick={() => setTodos((x) => !x)} data-control="ver-biblioteca">
              {todos ? w.verMenos : w.verTodos(library.length)}
            </Btn>
          )}
          {library.length === 0 && <p className="cor-text cor-muted">{w.vacia}</p>}
          {library.length > 0 && shown.length === 0 && <p className="cor-text cor-muted">{w.ninguno(q.trim())}</p>}
        </div>
      </div>
      <div className="cor-docs-key">
        <span>
          <i aria-hidden />
          {w.leyendaNotas}
        </span>
        <span>
          <i className="d" aria-hidden />
          {w.leyendaBiblio}
        </span>
      </div>
    </section>
  );
};

/** The names of a project's things, for a paper's way back (no keys on the screen). */
const namesOf = (p: OrgProject): Map<string, string> =>
  new Map([...(p.tablero?.initiatives ?? []).map((i) => [i.key, i.title] as const), ...(p.tablero?.loose ?? []).map((t) => [t.key, t.title] as const), ...(p.tablero?.done_initiatives ?? []).map((i) => [i.key, i.title] as const)]);

/** The reader: a doc across the whole page. id is a doc id, ctx-<id> for a context note not written yet, or nuevo. */
export const DocLector = ({
  p,
  id,
  back,
  backTo,
  docTo,
  thingTo,
}: {
  p: OrgProject;
  id: string;
  back: "ajustes" | "todo";
  backTo: string;
  docTo: (id: string) => string;
  thingTo: (key: string) => string;
}) => {
  const w = docsWords();
  const navigate = useNavigate();
  const client = useQueryClient();
  const ref = docRefOf(id);
  const aj = useQuery({ queryKey: ["ajustes", p.slug], queryFn: () => api.ajustes(p.slug) });
  const body = useQuery({ queryKey: ["ficha-doc", p.slug, id], queryFn: () => api.projectDoc(p.slug, id), enabled: ref.kind === "doc" });
  const ficha = useFicha(p.slug, true);
  const a = aj.data;
  const ctx = a?.context.find((c) => (ref.kind === "ctx" ? c.id === ref.id : c.doc_id === id)) ?? null;
  const lib = a?.library?.find((d) => d.id === id) ?? null;
  const taskKey = body.data?.task_key ?? null;
  const kind: "ctx" | "lib" | "papel" | "nuevo" = ref.kind === "nuevo" ? "nuevo" : ctx ? "ctx" : taskKey ? "papel" : "lib";
  const editable = kind !== "papel";
  const [edit, setEdit] = useState<{ title: string; text: string } | null>(ref.kind === "nuevo" ? { title: "", text: "" } : null);
  const startEdit = () => setEdit({ title: ctx ? notaTitulo(ctx) : (body.data?.title ?? ""), text: ref.kind === "ctx" ? (ctx?.markdown || ctx?.template || "") : (body.data?.markdown ?? "") });
  // A context note not written yet opens straight into its template.
  if (ref.kind === "ctx" && ctx && !ctx.doc_id && !edit) setEdit({ title: notaTitulo(ctx), text: ctx.template });
  const save = useMutation({
    mutationFn: async (e: { title: string; text: string }) => {
      if (kind === "ctx" && ctx) return api.ajustesContexto(p.slug, ctx.id, ctx.doc_id ? { markdown: e.text, version: ctx.version! } : { markdown: e.text });
      if (kind === "nuevo") return api.ajustesDoc(p.slug, { title: e.title.trim(), markdown: e.text });
      return api.ajustesDoc(p.slug, { title: body.data!.title, markdown: e.text, version: body.data!.version });
    },
    onSuccess: (next, e) => {
      client.setQueryData(["ajustes", p.slug], next);
      void client.invalidateQueries({ queryKey: ["ficha-doc", p.slug] });
      void client.invalidateQueries({ queryKey: ["company-ficha", p.slug] });
      setEdit(null);
      // A new doc, or a note written for the first time, now has an id: the address follows it.
      const made = kind === "nuevo" ? next.library?.find((d) => d.title === e.title.trim())?.id : kind === "ctx" && ref.kind === "ctx" ? next.context.find((c) => c.id === ref.id)?.doc_id : null;
      if (made) navigate(docTo(made), { replace: true });
    },
  });
  const err = save.error ? (save.error instanceof ApiError ? ajustesError(save.error.code, save.error.detail) : ajustesError(null)) : null;

  if (aj.isError && !a) return <ReadError what={w.elDoc} onRetry={() => void aj.refetch()} />;
  if (body.isError) return <ReadError what={w.elDoc} onRetry={() => void body.refetch()} />;
  const loading = !a || (ref.kind === "doc" && !body.data);
  const title = kind === "nuevo" ? w.nuevoTitulo : ctx ? notaTitulo(ctx) : (body.data?.title ?? "");
  const markdown = sinTitulo(ref.kind === "ctx" ? (ctx?.markdown ?? "") : (body.data?.markdown ?? ""));
  const names = namesOf(p);
  const thingName = taskKey ? names.get(taskKey) || ficha.data?.ideas.find((i) => i.key === taskKey)?.title || title : "";
  const sibling = taskKey ? (ficha.data?.docs ?? []).filter((d) => d.task_key === taskKey) : [];
  const label = kind === "ctx" ? w.leen : kind === "papel" ? w.papel : w.consultan;
  const labelCls = kind === "ctx" ? "violet" : kind === "papel" ? "" : "amber";
  const updated = ctx?.updated_at ?? lib?.updated_at ?? ficha.data?.docs.find((d) => d.id === id)?.updated_at ?? null;
  const version = ctx?.version ?? body.data?.version ?? null;
  const seats = (p.team ?? []).map((m) => seatLabel(m.role)).filter((r, i, all) => all.indexOf(r) === i);
  const ix = (to: string, on: boolean, name: string, meta: string, key: string) => (
    <Link key={key} to={to} className={cls("cor-lector-ix", on && "on")} aria-current={on ? "page" : undefined} data-doc-ix={key}>
      <span className="cor-ellipsis">{name}</span>
      <span className="cor-cap">{meta}</span>
    </Link>
  );
  return (
    <div className={cls("cor-lector", edit && "editing")} data-lector={id} data-lector-kind={kind}>
      <nav className="cor-lector-idx" aria-label={w.titulo}>
        <Link to={backTo} className="cor-strip-back" data-control={`volver-${back}`}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9.5 3.5 5 8l4.5 4.5" />
          </svg>
          {w.volver(back === "ajustes" ? w.ajustes : w.todo)}
        </Link>
        {sibling.length > 0 && (
          <>
            <span className="cor-label">{w.papeles}</span>
            {sibling.map((d) => ix(docTo(d.id), d.id === id, d.title, docDay(d.updated_at), d.id))}
          </>
        )}
        <span className="cor-label violet">{w.notas}</span>
        {(a?.context ?? []).map((c) => ix(docTo(ctxRef(c)), c === ctx, notaTitulo(c), notaEstado(c, ""), c.id))}
        <span className="cor-label amber">{w.biblioteca(a?.library?.length ?? 0)}</span>
        {(a?.library ?? []).map((d) => ix(docTo(d.id), d.id === id, d.title, docDay(d.updated_at), d.id))}
        {ix(docTo("nuevo"), kind === "nuevo", `+ ${w.nuevo}`, "", "nuevo")}
      </nav>
      {loading ? (
        <div className="cor-skel cor-lector-skel" role="status" aria-busy="true" aria-label={w.leyendo} />
      ) : edit ? (
        <form
          className="cor-lector-split"
          onSubmit={(e) => {
            e.preventDefault();
            if (kind === "nuevo" && !tituloOk(edit.title)) return;
            save.mutate(edit);
          }}
        >
          <div className="cor-lector-write">
            <div className="cor-lector-bar">
              <span className="cor-label violet">{w.escribes}</span>
              <span className="cor-acts">
                <Btn kind="primary" type="submit" disabled={save.isPending || (kind === "nuevo" && !tituloOk(edit.title))} data-control="guardar-doc">
                  {save.isPending ? w.guardando : w.guardar}
                </Btn>
                <Btn kind="secondary" onClick={() => (save.reset(), kind === "nuevo" || (ref.kind === "ctx" && !ctx?.doc_id) ? navigate(backTo) : setEdit(null))} data-control="cancelar-doc">
                  {w.cancelar}
                </Btn>
              </span>
            </div>
            <label className="cor-lector-field">
              {w.tituloCampo}
              <input className="cor-input cor-lector-title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} readOnly={kind !== "nuevo"} placeholder={w.tituloEjemplo} maxLength={120} data-campo="titulo-doc" />
            </label>
            {kind === "nuevo" && edit.title.trim() !== "" && !tituloOk(edit.title) && <p className="cor-state amber">{w.tituloMal}</p>}
            <label className="cor-lector-field grow">
              {w.textoCampo}
              <textarea className="cor-textarea cor-mono cor-lector-area" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} placeholder={w.textoEjemplo} spellCheck={false} data-campo="texto-doc" />
            </label>
            <p className="cor-cap">{kind === "ctx" ? w.notaNotas : kind === "nuevo" ? w.notaNuevo : w.notaBiblio}</p>
            {err && (
              <p className="cor-state amber" role="alert">
                {err}
              </p>
            )}
          </div>
          <div className="cor-lector-preview" aria-label={w.asi}>
            <span className="cor-label">{w.asi}</span>
            <h2 className="cor-lector-h">{edit.title || title}</h2>
            <div className="cor-md cor-lector-md">{edit.text.trim() ? <Markdown remarkPlugins={[remarkGfm]}>{sinTitulo(edit.text)}</Markdown> : <p className="cor-muted">{w.sinTexto}</p>}</div>
          </div>
        </form>
      ) : (
        <>
          <article className="cor-lector-page" aria-label={title}>
            <div className="cor-lector-col">
              <span className={cls("cor-label", labelCls)}>{label}</span>
              <h2 className="cor-lector-h">{title}</h2>
              <div className="cor-md cor-lector-md" data-doc-body tabIndex={0} role="region" aria-label={title}>
                {markdown.trim() ? <Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown> : <p className="cor-muted">{w.sinTexto}</p>}
              </div>
            </div>
          </article>
          <aside className="cor-lector-margin" aria-label={w.quien}>
            <div className="cor-acts">
              {editable && (
                <Btn kind="primary" onClick={startEdit} data-control="editar-doc">
                  {w.editar}
                </Btn>
              )}
              {kind === "papel" && taskKey && (
                <BtnLink kind="primary" to={thingTo(taskKey)} data-control="ver-cosa">
                  {w.verla}
                </BtnLink>
              )}
              <BtnLink kind="secondary" to={backTo}>
                {w.cerrar}
              </BtnLink>
            </div>
            <div className="cor-lector-who">
              <span className="cor-label">{w.quien}</span>
              {kind === "papel" ? (
                <span className="cor-lector-wr">
                  <i className="d" aria-hidden />
                  {w.quienPapel(thingName)}
                </span>
              ) : (
                <>
                  <span className="cor-lector-wr">
                    <i className={kind === "ctx" ? "" : "d"} aria-hidden />
                    {kind === "ctx" ? w.quienNotas : w.quienBiblio}
                  </span>
                  {seats.length > 0 && <span className="cor-cap">{seats.join(" · ")}</span>}
                </>
              )}
            </div>
            {version !== null && (
              <div className="cor-lector-who">
                <span className="cor-label">{w.cambio}</span>
                <span className="cor-text">{w.cambioEl(docDay(updated ?? null) || "—", version)}</span>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
};
