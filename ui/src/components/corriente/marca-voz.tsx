// PLA-I69-5: Marca → Voz y nombre (design: PLA-IDEA33 pass 3). Left: how the project speaks (four presets, four
// sliders, how it addresses people, words it uses and avoids; an expert edits the guide itself). Middle: three moments
// of the app written in that voice and drawn with the brand's style, changing as the sliders move. Right: the name and
// short texts with their limits, and the request that brings them to the repo. Every change is a version in Plania.
// Logic and words: @/lib/voz. Styles: corriente.css («Marca · Voz»).
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { family, tokens } from "@/lib/estilo";
import { PRESETS, example, guideOf, vozWords, type Moment, type Voice, type VozWords } from "@/lib/voz";
import { Icon, Illus } from "./marca-estilo";
import { ReadError } from "./parts";

const SLIDERS = ["cerca", "humor", "breve", "sencillo"] as const;

function Words({ list, kind, label, w, onChange }: { list: string[]; kind: "ok" | "no"; label: string; w: VozWords; onChange: (next: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    if (t && !list.includes(t)) onChange([...list, t]);
    setText("");
    setAdding(false);
  };
  return (
    <div className="es-row">
      {list.map((x) => (
        <button key={x} type="button" className={`vz-word ${kind}`} onClick={() => onChange(list.filter((y) => y !== x))} aria-label={w.remove(x)} title={w.remove(x)}>
          {x}
        </button>
      ))}
      {adding ? (
        <input
          className="vz-wordin"
          autoFocus
          value={text}
          maxLength={40}
          aria-label={w.addLabel(label)}
          onChange={(e) => setText(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
            if (e.key === "Escape") { e.stopPropagation(); setText(""); setAdding(false); }
          }}
        />
      ) : (
        <button type="button" className="vz-word add" onClick={() => setAdding(true)} aria-label={w.addLabel(label)} data-control={`voz-agregar-${kind}`}>
          {w.add}
        </button>
      )}
    </div>
  );
}

export function Voz({ slug, title, logo }: { slug: string; title: string; logo: string | null }) {
  const w = vozWords();
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["voz", slug], queryFn: () => api.marcaVoz(slug), staleTime: 30_000 });
  const st = useQuery({ queryKey: ["estilo", slug], queryFn: () => api.marcaEstilo(slug), staleTime: 30_000 });
  const [x, setX] = useState<Voice | null>(null);
  const [expert, setExpert] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [sending, setSending] = useState(false);
  // PLA-130: the request asks first, like Estilo and Caras.
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const r = q.data;
  useEffect(() => {
    if (r && !dirty.current) setX(r.base);
  }, [r]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flush = async (next: Voice) => {
    const back = await api.marcaVozSave(slug, next);
    client.setQueryData(["voz", slug], back);
    dirty.current = false;
    setSaving("saved");
    return back;
  };
  const edit = (patch: Partial<Voice>) => {
    if (!x) return;
    const next = { ...x, ...patch };
    dirty.current = true;
    setX(next);
    setSaving("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(next).catch((e) => { setSaving("idle"); toast.error(e instanceof ApiError ? e.message : String(e)); }), 650);
  };
  if (q.isError && !r) return <ReadError what={w.readError} onRetry={() => void q.refetch()} />;
  if (!r || !x) return <div className="cor-skel" style={{ flex: 1 }} role="status" aria-busy="true" aria-label={w.loading} />;

  const style = st.data?.base;
  const t = style ? tokens(style) : null;
  const vars = (t && style
    ? { "--b": t.light.brand, "--on": t.light["on-brand"], "--bg": t.light.background, "--card": t.light.card, "--fg": t.light.foreground, "--mu": t.light.muted, "--bd": t.light.border, "--er": t.light.danger, "--r": `${t.radius}px`, "--rb": `${t.button}px`, "--fh": family(style.head), "--fb": family(style.body) }
    : {}) as React.CSSProperties;
  // Which texts differ from the repo right now (the draft, not only what was saved).
  const repoNames = [...new Set([r.repo.name, r.repo.title].filter((n): n is string => !!n))];
  const repoOf = { name: repoNames.join(" · "), short: r.repo.short ?? "", desc: r.repo.desc ?? "" };
  const differ = (["name", "short", "desc"] as const).filter((k) => (k === "name" ? !repoNames.length || repoNames.some((n) => n !== x.name) : (x[k] ?? "") !== repoOf[k]));
  const send = async () => {
    setSending(true);
    try {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current || !r.voice) await flush(x);
      const back = await api.marcaVozPedido(slug);
      client.setQueryData(["voz", slug], back);
      toast(w.sent(back.key));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };
  const moment = (m: Moment) => example(w, m, x);
  return (
    <div className={`vz-wrap${expert ? " expert" : ""}`} data-voz={slug}>
      <div className="vz-left">
        <div className="es-row" style={{ justifyContent: "space-between" }}>
          <h2 className="es-h" style={{ margin: 0 }}>{w.how(x.name || title)}</h2>
          <label className="es-exp">
            <button type="button" className="es-sw" role="switch" aria-checked={expert} onClick={() => setExpert((e) => !e)} aria-label={w.expert} data-control="voz-experto" />
            {w.expert}
          </label>
        </div>
        <div className="es-row">
          {PRESETS.map(([k, v]) => {
            const on = SLIDERS.every((s) => x[s] === v[s]);
            return (
              <button key={k} type="button" className="vz-chip" aria-pressed={on} onClick={() => edit({ ...v, guide: null })} data-control={`voz-${k}`}>
                {w.presets[k]}
              </button>
            );
          })}
        </div>
        {SLIDERS.map((k) => {
          const [a, b] = w.sliders[k]!;
          return (
            <div key={k} className="vz-sl">
              <div className="vz-sl-l"><span>{a}</span><span>{b}</span></div>
              {/* PLA-130: where the slider sits, in words, on screen and for screen readers. */}
              <input type="range" className="es-range" min={0} max={100} value={x[k]} onChange={(e) => edit({ [k]: Number(e.target.value), guide: null })} aria-label={w.sliderLabel(a, b)} aria-valuetext={w.stop(x[k], a, b)} data-control={`voz-${k}`} />
              <span className="vz-sl-v">{w.stop(x[k], a, b)}</span>
            </div>
          );
        })}
        <div>
          <div className="es-h">{w.trato}</div>
          <div className="es-seg" role="radiogroup" aria-label={w.trato}>
            {(["tu", "usted", "vos"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={x.trato === k} onClick={() => edit({ trato: k, guide: null })} data-control={`voz-trato-${k}`}>
                {w.tratos[k]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="es-h">{w.yes}</div>
          <Words list={x.yes} kind="ok" label={w.yes} w={w} onChange={(yes) => edit({ yes, guide: null })} />
        </div>
        <div>
          <div className="es-h">{w.no}</div>
          <Words list={x.no} kind="no" label={w.no} w={w} onChange={(no) => edit({ no, guide: null })} />
        </div>
        {expert ? (
          <div className="es-adv">
            <div className="es-h" style={{ margin: 0 }}>{w.guideTitle}</div>
            <textarea className="vz-guide" value={guideOf(w, x, title)} onChange={(e) => edit({ guide: e.target.value.trim() ? e.target.value : null })} spellCheck={false} aria-label={w.guideLabel} data-control="voz-guia" />
            <p className="es-sub">{w.guideNote}</p>
          </div>
        ) : (
          <p className="es-note">{w.agentsNote}</p>
        )}
      </div>
      <div className="vz-mid">
        <div className="es-bar">
          <div className="say">
            <b>{w.sounds}</b> · {w.soundsSay}
            {saving !== "idle" && <span className="es-saving" role="status"> · {saving === "saving" ? w.saving : w.saved}</span>}
          </div>
        </div>
        <div className="vz-voices" style={vars} tabIndex={0} aria-label={w.sounds}>
          <div className="vx">
            <span className="vx-k">{w.moments.err}</span>
            <div className="vx-t"><Icon n="alert" s={{ stroke: style?.stroke ?? 2, fill: false, lib: style?.lib }} size={18} /><p>{moment("err")}</p></div>
          </div>
          <div className="vx">
            <span className="vx-k">{w.moments.vacio}</span>
            <div className="vx-e">
              {/* PLA-130: Imágenes left Estilo; the example keeps one plain drawing in the brand's colours. */}
              {style && <span className="vx-ill"><Illus x={{ ...style, people: false, imgBrand: true }} kind="plano" /></span>}
              <p>{moment("vacio")}</p>
              <span className="vx-btn"><Icon n="plus" s={{ stroke: style?.stroke ?? 2, fill: false, lib: style?.lib }} size={14} />{x.cerca >= 50 ? w.emptyBtn[1] : w.emptyBtn[0]}</span>
            </div>
          </div>
          <div className="vx">
            <span className="vx-k">{w.moments.aviso}</span>
            <div className="vx-n">
              {logo ? <img alt="" src={logo} /> : <i />}
              <div><b>{x.short || title}</b><p>{moment("aviso")}</p></div>
              <small>{w.now}</small>
            </div>
          </div>
        </div>
      </div>
      <aside className="vz-names" aria-label={w.names}>
        <div className="es-h" style={{ margin: 0 }}>{w.names}</div>
        {(["name", "short", "desc", "tag"] as const).map((k) => {
          const [label, why] = w.fields[k]!;
          const max = r.limits[k];
          const over = x[k].length > max;
          const repo = k === "tag" ? null : repoOf[k];
          return (
            <div key={k} className="vz-f">
              <div className="es-row" style={{ justifyContent: "space-between" }}>
                <label htmlFor={`vz-${k}`}>{label}</label>
                <small className={over ? "no" : ""}>{x[k].length} / {max}{over ? ` · ${w.over}` : ""}</small>
              </div>
              {k === "desc" ? (
                <textarea id={`vz-${k}`} className="vz-in" rows={3} value={x[k]} aria-invalid={over || undefined} onChange={(e) => edit({ [k]: e.target.value })} data-control={`voz-${k}`} />
              ) : (
                <input id={`vz-${k}`} className="vz-in" value={x[k]} aria-invalid={over || undefined} onChange={(e) => edit({ [k]: e.target.value })} data-control={`voz-${k}`} />
              )}
              {/* PLA-130: a short name over its limit shows how the phone will cut it. */}
              {over && k === "short" && <span className="w am">{w.cut(`${x[k].slice(0, max - 1)}…`)}</span>}
              <span className="w">{why}</span>
              {repo !== null && (differ.includes(k as "name") ? <span className="w am">{repo ? w.inRepo(repo) : w.notInRepo}</span> : null)}
            </div>
          );
        })}
        <button type="button" className={`cor-btn ${differ.length && !r.pedido ? "primary" : "secondary"} small`} disabled={!!r.pedido || !differ.length || sending} onClick={() => setConfirm((c) => !c)} aria-expanded={confirm} data-control="voz-llevar">
          {r.pedido ? w.way(r.pedido.key) : differ.length ? w.bring(differ.length) : w.same}
        </button>
        <p className="vz-only">{w.onlyNames}</p>
        {confirm && differ.length > 0 && !r.pedido && (
          <div className="vz-confirm" role="dialog" aria-label={w.confirmTitle} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setConfirm(false); } }}>
            <b>{w.confirmTitle}</b>
            <ul>
              {differ.map((k) => (
                <li key={k}><span>{w.fields[k]![0]}</span><span>{repoOf[k] || w.none} → {x[k]}</span></li>
              ))}
            </ul>
            <p>{w.confirmLead}</p>
            <div className="es-row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="cor-btn secondary small" onClick={() => setConfirm(false)}>{w.cancel}</button>
              <button type="button" className="cor-btn primary small" autoFocus disabled={sending} onClick={() => { setConfirm(false); void send(); }} data-control="voz-pedir">{w.go}</button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
