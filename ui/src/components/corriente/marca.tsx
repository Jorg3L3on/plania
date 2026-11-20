// PLA-I66-2: a project's Marca door (design: PLA-IDEA30, frames A1 to A3). The original in the middle, six cards around
// it with the repo's real files (browser, iPhone, Android, install, sharing, Compañía) joined to it by threads (lit:
// the file is there and passes; dotted: missing; red: wrong), and the list of files on the right; a card or a row
// opens its sheet with the path and every check. Words and logic: @/lib/marca. Styles: corriente.css («Marca»).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { logoUrl } from "@/lib/logos";
import { FACES, counts, faceState, fileUrl, has, marcaWords, sentence, sortedRows, type Face, type MarcaRead, type MarcaRow, type MarcaWords } from "@/lib/marca";
import { Logo, ReadError } from "./parts";

type Shape = "circle" | "squircle" | "drop";

export const useMarca = (slug: string) => useQuery({ queryKey: ["marca", slug], queryFn: () => api.marca(slug), staleTime: 30_000, refetchInterval: 60_000 });

const StIcon = ({ st }: { st: string }) => <i className={`mk-st ${st}`} aria-hidden />;

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function Marca({ p }: { p: { slug: string; title: string } }) {
  const w = marcaWords();
  const q = useMarca(p.slug);
  const client = useQueryClient();
  const [sel, setSel] = useState<Face | null>(null);
  const [hover, setHover] = useState<Face | null>(null);
  const [rereading, setRereading] = useState(false);
  const reread = async () => {
    setRereading(true);
    try {
      client.setQueryData(["marca", p.slug], await api.marca(p.slug, true));
    } finally {
      setRereading(false);
    }
  };
  if (q.isError && !q.data) return <ReadError what={w.readError} onRetry={() => void q.refetch()} />;
  const r = q.data;
  if (!r) return <div className="cor-skel" style={{ flex: 1 }} role="status" aria-busy="true" aria-label={w.loading} />;
  const c = counts(r.rows);
  const lit = hover ?? sel;
  return (
    <div className={`mk${lit ? " hl" : ""}`} data-marca={p.slug}>
      <header className="mk-head">
        <div className="mk-head-l">
          <h2 className="cor-door-h">{w.title(p.title)}</h2>
          <p className="cor-text">{r.repo === "ok" ? w.lead : w.noRepo}</p>
        </div>
        <div className="mk-head-r">
          <p className="mk-sum" data-sum>
            {c.ok > 0 && (
              <span>
                <b>{c.ok}</b> {w.count.ok}
              </span>
            )}
            {c.missing > 0 && (
              <span>
                <b>{c.missing}</b> {w.count.missing(c.missing)}
              </span>
            )}
            {c.wrong > 0 && (
              <span>
                <b className="r">{c.wrong}</b> {w.count.wrong}
              </span>
            )}
          </p>
          {r.repo === "ok" && (
            <button type="button" className="cor-btn secondary small" onClick={() => void reread()} disabled={rereading} data-control="marca-revisar">
              {w.reread}
            </button>
          )}
        </div>
      </header>
      <div className="mk-grid">
        <Scene r={r} w={w} title={p.title} lit={lit} sel={sel} onPick={setSel} onHover={setHover} />
        <aside className="mk-list" aria-label={w.files}>
          {sel ? <Ficha r={r} face={sel} w={w} onBack={() => setSel(null)} /> : <Rows r={r} w={w} onPick={setSel} onHover={setHover} />}
        </aside>
      </div>
    </div>
  );
}

function Scene({ r, w, title, lit, sel, onPick, onHover }: { r: MarcaRead; w: MarcaWords; title: string; lit: Face | null; sel: Face | null; onPick: (f: Face) => void; onHover: (f: Face | null) => void }) {
  const scene = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ face: Face; d: string; x: number; y: number }[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [shape, setShape] = useState<Shape>("circle");
  const [themed, setThemed] = useState(false);
  const [dark, setDark] = useState(false);
  const draw = useCallback(() => {
    const el = scene.current;
    if (!el) return;
    const base = el.getBoundingClientRect();
    const orig = el.querySelector(".mk-orig")?.getBoundingClientRect();
    if (!orig) return;
    const cy = orig.top + orig.height / 2 - base.top;
    const out: typeof paths = [];
    for (const f of FACES) {
      const card = el.querySelector(`.mk-face[data-face="${f.id}"]`)?.getBoundingClientRect();
      if (!card) continue;
      const tx = (f.side === "l" ? card.right : card.left) - base.left;
      const ty = card.top + card.height / 2 - base.top;
      const sx = (f.side === "l" ? orig.left + 6 : orig.right - 6) - base.left;
      const dx = (tx - sx) * 0.55;
      out.push({ face: f.id, d: `M${sx} ${cy}C${sx + dx} ${cy} ${tx - dx} ${ty} ${tx} ${ty}`, x: tx, y: ty });
    }
    setBox({ w: base.width, h: base.height });
    setPaths(out);
  }, []);
  useLayoutEffect(draw, [draw, r]);
  useEffect(() => {
    const el = scene.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);
  const face = (f: Face, body: ReactNode, extra?: ReactNode) => {
    const s = faceState(r.rows, f);
    const label = s.worst === "ok" ? w.faceCount(s.ok, s.n) : w.state[s.worst];
    return (
      <article
        key={f}
        className={`mk-face${lit === f ? " on" : ""}`}
        data-face={f}
        tabIndex={0}
        aria-label={w.face[f].name}
        aria-current={sel === f ? "true" : undefined}
        onClick={() => onPick(f)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPick(f);
          }
        }}
        onMouseEnter={() => onHover(f)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(f)}
        onBlur={() => onHover(null)}
      >
        <header>
          <span className="mk-face-n">{w.face[f].name}</span>
          <span className={`mk-cnt ${s.worst}`}>{label}</span>
        </header>
        <div className="mk-face-b">{body}</div>
        {extra && (
          <div className="mk-face-x" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {extra}
          </div>
        )}
      </article>
    );
  };
  const row = (id: MarcaRow["id"]) => r.rows.find((x) => x.id === id);
  const src = (id: MarcaRow["id"]) => {
    const x = row(id);
    return x && x.state !== "falta" && x.path && /\.(png|svg|ico)$/.test(x.path) ? fileUrl(r.slug, x.path) : null;
  };
  const orig = r.logo ? logoUrl(r.slug, r.logo) : null;
  const fav = src("ico") ?? src("svg") ?? orig;
  const apple = has(r.rows, "apple") ? src("apple") : null;
  const masked = has(r.rows, "mask") ? src("mask") : has(r.rows, "a512") ? src("a512") : null;
  const mono = has(r.rows, "mono") ? src("mono") : null;
  const theme = String(row("man")?.checks.find((x) => x.k === "man_colors")?.v?.theme ?? "#0e0e12");
  const ogRow = row("og");
  const og = ogRow?.state === "ok" && ogRow.path?.endsWith(".png") ? fileUrl(r.slug, ogRow.path) : null;
  const ogCode = ogRow?.state === "ok" && !og;
  const installIcon = src("a192") ?? src("a512") ?? orig;
  return (
    <div className="mk-scene" ref={scene}>
      <svg className="mk-threads" width={box.w} height={box.h} viewBox={`0 0 ${box.w || 1} ${box.h || 1}`} aria-hidden>
        {paths.map((t) => (
          <g key={t.face} className={`mk-thread th-${faceState(r.rows, t.face).worst}${lit === t.face ? " on" : ""}`}>
            <path className="base" d={t.d} />
            <path className="flow" d={t.d} />
            <circle cx={t.x} cy={t.y} r={3.5} />
          </g>
        ))}
      </svg>
      <div className="mk-col l">
        {face(
          "nav",
          <>
            <div className={`mk-tabs ${dark ? "dark" : "light"}`}>
              <span className="mk-tab on">
                {fav ? <img src={fav} width={16} height={16} alt="" /> : <i className="mk-tab-blank" />}
                <span className="cor-ellipsis">{title}</span>
              </span>
              <span className="mk-tab">{w.newTab}</span>
            </div>
          </>,
          <>
            <span className="mk-zoom">
              {fav && <img src={fav} alt="" />}
              {w.zoom}
            </span>
            <button type="button" className="mk-mini" onClick={() => setDark((d) => !d)} aria-pressed={dark} data-control="marca-oscuro">
              {dark ? w.lighter : w.darker}
            </button>
          </>,
        )}
        {face(
          "ios",
          <div className="mk-phone ios">
            <div className="mk-home">
              <span className="mk-app ph" />
              <span className="mk-app ph" />
              <span className="mk-app me">
                {apple ? <img src={apple} alt="" /> : <span className="mk-shot">{w.noIcon}</span>}
                <em>{title}</em>
              </span>
            </div>
            <div className="mk-splash" style={{ background: theme }}>
              {r.splash ? <img src={fileUrl(r.slug, r.splash)} alt="" /> : <span>{w.splashNone}</span>}
            </div>
          </div>,
        )}
        {face(
          "and",
          <div className="mk-phone and">
            <div className="mk-home">
              <span className="mk-app ph r" />
              <span className={`mk-app me shape-${shape}`}>
                {!masked ? <span className="mk-shot">{w.noIcon}</span> : themed && mono ? <span className="mk-themed"><img src={mono} alt="" /></span> : <img src={masked} alt="" />}
                <em>{title}</em>
              </span>
              <span className="mk-app ph r" />
            </div>
          </div>,
          <>
            {(["circle", "squircle", "drop"] as Shape[]).map((s) => (
              <button key={s} type="button" className="mk-mini" aria-pressed={shape === s} onClick={() => setShape(s)} data-control={`marca-forma-${s}`}>
                {w.shapes[s]}
              </button>
            ))}
            <button type="button" className="mk-mini" aria-pressed={themed} onClick={() => setThemed((t) => !t)} data-control="marca-tematico">
              {w.themed}
            </button>
          </>,
        )}
      </div>
      <Core r={r} w={w} title={title} />
      <div className="mk-col r">
        {face(
          "pwa",
          <div className="mk-install">
            <div className="mk-install-bar" style={{ background: theme }} />
            <div className="mk-install-b">
              <b>{w.install}</b>
              <div className="mk-install-app">
                {installIcon ? <img src={installIcon} alt="" /> : <span className="mk-blank" />}
                <span>
                  <b>{title}</b>
                  <em>{w.ownWindow}</em>
                </span>
              </div>
            </div>
          </div>,
        )}
        {face(
          "share",
          <div className="mk-chat">
            <div className="mk-bubble">
              {og ? <img className="mk-og-img" src={og} alt="" /> : ogCode ? <div className="mk-og code" style={{ background: theme }}>{orig && <img src={orig} alt="" />}<b>{title}</b></div> : null}
              <div className="mk-link">
                <b>{title}</b>
                {!og && !ogCode && <span>{w.noImage}</span>}
              </div>
            </div>
          </div>,
        )}
        {face(
          "cia",
          <div className="mk-lane">
            <Logo slug={r.slug} title={title} />
            <span>
              <b>{title}</b>
              <em>{w.lane(!!r.logo)}</em>
            </span>
          </div>,
        )}
      </div>
    </div>
  );
}

function Core({ r, w, title }: { r: MarcaRead; w: MarcaWords; title: string }) {
  const l = r.logo;
  return (
    <div className="mk-core">
      <div className={`mk-orig${l?.variant === "mark" ? " bare" : ""}`}>
        <i className="mk-glow" aria-hidden />
        {l ? <img src={logoUrl(r.slug, l)} alt={title} /> : <Logo slug={r.slug} title={title} />}
      </div>
      <div className="mk-core-lbl">
        {w.original}
        {l && <span>{w.version(l.v)}</span>}
      </div>
      {l ? (
        <div className="mk-src">
          {w.source[l.source]}
          {l.path && <code>{l.path}</code>}
          <span>
            {w.variant[l.variant]} · {r.branch}
          </span>
        </div>
      ) : (
        <div className="mk-src">
          <b>{w.noOriginal}</b>
          <span>{w.noOriginalLead}</span>
        </div>
      )}
      {l && l.colors.length > 0 && (
        <div className="mk-colors">
          {l.colors.map((c) => (
            <i key={c} style={{ background: c }} title={c} />
          ))}
          <span>{w.colors}</span>
        </div>
      )}
    </div>
  );
}

function Rows({ r, w, onPick, onHover }: { r: MarcaRead; w: MarcaWords; onPick: (f: Face) => void; onHover: (f: Face | null) => void }) {
  return (
    <>
      <header className="mk-list-h">
        <span className="mk-list-t">{w.files}</span>
        <span className="mk-list-n">{r.rows.length}</span>
        <span className="mk-list-f">{w.checked(clock(r.checkedAt), r.branch)}</span>
      </header>
      <ul className="mk-rows">
        {sortedRows(r.rows).map((x) => {
          const img = x.state !== "falta" && x.path && /\.(png|svg|ico)$/.test(x.path) ? fileUrl(r.slug, x.path) : x.id === "pl" && r.logo ? logoUrl(r.slug, r.logo) : null;
          return (
            <li key={x.id} data-row={x.id} data-st={x.state}>
              <button type="button" className="mk-row" onClick={() => onPick(x.face)} onMouseEnter={() => onHover(x.face)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(x.face)} onBlur={() => onHover(null)}>
                <StIcon st={x.optional && x.state === "falta" ? "opt" : x.state} />
                <span className="mk-row-tx">
                  <b>{w.row[x.id].name}</b>
                  <span>{x.size ? `${x.size} · ` : ""}{x.path ?? w.row[x.id].spec}</span>
                </span>
                {img ? <img className="mk-row-img" src={img} alt="" /> : <span className="mk-row-img none" />}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Ficha({ r, face, w, onBack }: { r: MarcaRead; face: Face; w: MarcaWords; onBack: () => void }) {
  const rows = r.rows.filter((x) => x.face === face);
  return (
    <div className="mk-ficha" data-ficha={face}>
      <button type="button" className="mk-back" onClick={onBack} data-control="marca-volver">
        {w.back}
      </button>
      <h3>{w.face[face].name}</h3>
      <p>{w.face[face].what}</p>
      <ul>
        {rows.map((x) => (
          <li key={x.id} data-st={x.state}>
            <div className="mk-fi-h">
              <StIcon st={x.optional && x.state === "falta" ? "opt" : x.state} />
              <b>{w.row[x.id].name}</b>
              <span className={`mk-fi-st ${x.state}`}>{x.optional && x.state === "falta" ? w.optional : (x.id === "pl" ? w.plState : w.state)[x.state]}</span>
            </div>
            {x.path && <code>{x.path}</code>}
            {x.note && <p>{sentence(w.note, x.note)}</p>}
            <ul className="mk-fi-ck">
              {x.checks.map((ck, i) => (
                <li key={i} className={ck.ok ? "y" : "n"}>
                  {sentence(w.check, ck)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The door's count in the project bar (shares the door's read). */
export function MarcaCount({ slug }: { slug: string }) {
  const q = useMarca(slug);
  if (!q.data) return null;
  const c = counts(q.data.rows);
  const bad = c.missing + c.wrong;
  return <span className={`n${bad ? "" : " ok"}`}>{bad ? marcaWords().doorCount(bad) : marcaWords().doorComplete}</span>;
}
