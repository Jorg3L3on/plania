// PLA-I69-6: Marca → Historial. Everything the brand has been in one list (logo, style, voice and name, requests to
// Taller), newest first, with a filter. A line picked shows next to today's: the two logos, the two sample apps with
// what changed, the two voices; «Volver a esta» brings it back as a new version (nothing is deleted). A request shows
// where it stands and its PR. Logic and words: @/lib/historial. Styles: corriente.css («Marca · Historial»).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { estiloWords } from "@/lib/estilo";
import { entries, historialWords, runs, styleDiff, voiceDiff, type Entry, type Lane } from "@/lib/historial";
import { versionUrl } from "@/lib/marca";
import { guideOf, vozWords } from "@/lib/voz";
import { Fit, Spec, useFonts } from "./marca-estilo";
import { ReadError } from "./parts";

export function Historial({ slug, title }: { slug: string; title: string }) {
  const w = historialWords();
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["marca-historial", slug], queryFn: () => api.marcaHistorial(slug), staleTime: 10_000 });
  const [lane, setLane] = useState<Lane | "todo">("todo");
  const [sel, setSel] = useState<string | null>(null);
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const h = q.data;
  const fontsOf = h ? [...new Set(h.style.flatMap((s) => [s.style.head, s.style.body]))] : [];
  useFonts(fontsOf);
  if (q.isError && !h) return <ReadError what={w.readError} onRetry={() => void q.refetch()} />;
  if (!h) return <div className="cor-skel" style={{ flex: 1 }} role="status" aria-busy="true" aria-label={w.loading} />;
  const list = entries(h, lane);
  const picked = list.find((e) => e.id === sel) ?? null;
  const laneName = (l: Lane) => w.lanes[l]!;
  const back = async (e: Entry) => {
    setBusy(true);
    try {
      if (e.lane === "logo") client.setQueryData(["marca", slug], await api.marcaGoBack(slug, e.v.v));
      if (e.lane === "estilo") client.setQueryData(["estilo", slug], await api.marcaEstiloBack(slug, e.v));
      if (e.lane === "voz") client.setQueryData(["voz", slug], await api.marcaVozBack(slug, e.v));
      void client.invalidateQueries({ queryKey: ["marca", slug] });
      await q.refetch();
      setSel(null);
      toast(w.goneBack(laneName(e.lane), e.lane === "logo" ? e.v.v : e.lane === "pedido" ? 0 : e.v));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const curStyle = h.style.find((s) => s.current)?.style ?? null;
  const row = (e: Entry) => (
                <button type="button" className="hi-row" aria-pressed={sel === e.id} onClick={() => setSel(e.id)} data-entry={e.id}>
                  <span className={`hi-lane ${e.lane === "voz" ? "estilo" : e.lane}`}>{w.lanes[e.lane === "voz" ? "estilo" : e.lane]}</span>
                  <span className="hi-what">
                    {e.lane === "logo" && (
                      <>
                        <img src={versionUrl(slug, e.v.v)} alt="" />
                        <b>{w.vShort(e.v.v)}</b>
                        <small>{w.source[e.v.source] ?? e.v.source}</small>
                      </>
                    )}
                    {e.lane === "estilo" && (
                      <>
                        <i className="sw" style={{ background: e.style.brand }} />
                        <i className="sw" style={{ background: e.style.accent }} />
                        <b>{w.vShort(e.v)}</b>
                        <small>{e.style.head === e.style.body ? e.style.head : `${e.style.head} + ${e.style.body}`} · {e.style.radius} px</small>
                      </>
                    )}
                    {e.lane === "voz" && (
                      <>
                        <b>{w.tratoRow(vw.tratos[e.voice.trato] ?? e.voice.trato)}</b>
                      </>
                    )}
                    {e.lane === "pedido" && (
                      <>
                        <b>{w.kinds[e.r.kind]} · {e.r.key}</b>
                        <small>{w.status[e.r.status] ?? e.r.status}</small>
                      </>
                    )}
                  </span>
                  <span className="hi-when">{e.current ? <em>{w.current}</em> : w.whenShort(e.at)}{"keep" in e && e.keep && <em className="hi-kept" title={w.keptWhy}>{w.kept}</em>}</span>
                </button>
  );
  const curVoice = h.voice.find((s) => s.current)?.voice ?? null;
  const curLogo = h.logo.find((v) => v.active) ?? null;
  const ew = estiloWords();
  const vw = vozWords();
  return (
    <div className="hi-wrap" data-historial={slug}>
      <div className="hi-left">
        <div className="es-seg" role="radiogroup" aria-label={w.lanesLabel}>
          {/* PLA-130: no Trato filter; «Cómo trata a la gente» lives in Estilo, so its changes list under Estilo. */}
          {(["todo", "logo", "estilo", "pedido"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={lane === k} onClick={() => { setLane(k); setSel(null); }} data-control={`historial-${k}`}>
              {w.lanes[k]}
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <p className="es-note">{w.empty}</p>
        ) : (
          <ul className="hi-list" aria-label={w.lanes[lane]}>
            {/* PLA-130: runs of quick versions fold into one row; the current and kept ones stand alone. */}
            {runs(list).map((x) =>
              "run" in x ? (
                <li key={x.id}>
                  <button type="button" className="hi-row hi-run" aria-expanded={openRuns.has(x.id)} onClick={() => setOpenRuns((o) => { const n = new Set(o); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })} data-run={x.id}>
                    <span className={`hi-lane ${x.lane}`}>{w.lanes[x.lane]}</span>
                    <span className="hi-what"><b>{w.run(x.items.length)}</b><small>{w.span(x.from, x.to)}</small></span>
                    <span className="hi-when">{openRuns.has(x.id) ? w.runClose : w.runOpen}</span>
                  </button>
                  {openRuns.has(x.id) && <ul className="hi-sub">{x.items.map((e) => <li key={e.id}>{row(e)}</li>)}</ul>}
                </li>
              ) : (
                <li key={x.id}>{row(x)}</li>
              ),
            )}
          </ul>
        )}
      </div>
      <section className="hi-right" aria-live="polite">
        {!picked ? (
          <p className="hi-pick">{w.pick}</p>
        ) : (
          <>
            <header className="hi-head">
              {/* PLA-130: h2, right under the page's h1. */}
              <h2>
                {picked.lane === "pedido" ? `${w.kinds[picked.r.kind]} · ${picked.r.key}` : picked.lane === "voz" ? w.tratoRow(vw.tratos[picked.voice.trato] ?? picked.voice.trato) : w.version(laneName(picked.lane), picked.lane === "logo" ? picked.v.v : picked.v)}
              </h2>
              <span className="hi-when">{w.when(picked.at)}</span>
              {picked.lane !== "pedido" && !picked.current && !(picked.lane === "estilo" && curStyle && !styleDiff(picked.style, curStyle).length) && !(picked.lane === "voz" && curVoice && !voiceDiff(picked.voice, curVoice).length) && (
                <button type="button" className="cor-btn primary small" disabled={busy} onClick={() => void back(picked)} data-control="historial-volver">
                  {w.goBack}
                </button>
              )}
              {picked.current && <em className="hi-cur">{w.current}</em>}
            </header>
            {picked.lane === "logo" && (
              <div className="hi-two">
                <figure><figcaption>{w.then}</figcaption><img src={versionUrl(slug, picked.v.v)} alt="" /></figure>
                <figure><figcaption>{w.now}</figcaption>{curLogo ? <img src={versionUrl(slug, curLogo.v)} alt="" /> : null}</figure>
              </div>
            )}
            {picked.lane === "estilo" && (
              <>
                <div className="hi-two">
                  <figure><figcaption>{w.then}</figcaption><Fit className="hi-spec"><Spec x={picked.style} dark={false} logo={curLogo ? versionUrl(slug, curLogo.v) : null} title={title} w={ew} /></Fit></figure>
                  <figure><figcaption>{w.now}</figcaption>{curStyle ? <Fit className="hi-spec"><Spec x={curStyle} dark={false} logo={curLogo ? versionUrl(slug, curLogo.v) : null} title={title} w={ew} /></Fit> : null}</figure>
                </div>
                <Diff rows={curStyle ? styleDiff(picked.style, curStyle) : []} w={w} />
              </>
            )}
            {picked.lane === "voz" && (
              <>
                <div className="hi-two">
                  <figure><figcaption>{w.then}</figcaption><pre className="hi-guide">{guideOf(vw, picked.voice)}</pre></figure>
                  <figure><figcaption>{w.now}</figcaption><pre className="hi-guide">{curVoice ? guideOf(vw, curVoice) : ""}</pre></figure>
                </div>
                <Diff rows={curVoice ? voiceDiff(picked.voice, curVoice) : []} w={w} />
              </>
            )}
            {picked.lane === "pedido" && (
              <div className="hi-req">
                <p>{picked.r.title}</p>
                <p><span className="hi-lane pedido">{w.status[picked.r.status] ?? picked.r.status}</span></p>
                {picked.r.pr && <a className="cor-btn secondary small" href={picked.r.pr} target="_blank" rel="noreferrer">{w.pr}</a>}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Diff({ rows, w }: { rows: { k: string; from: string; to: string }[]; w: ReturnType<typeof historialWords> }) {
  if (!rows.length) return <p className="es-sub">{w.same}</p>;
  return (
    <div className="es-diff hi-diff">
      {rows.map((r) => (
        <div key={r.k}>
          <b>{w.fields[r.k] ?? r.k}</b>
          <span>{r.from} → {r.to}</span>
        </div>
      ))}
    </div>
  );
}
