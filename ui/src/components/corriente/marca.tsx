// PLA-I66-2: a project's Marca door (design: PLA-IDEA30, frames A1 to A3). The original in the middle, six cards around
// it with the repo's real files (browser, iPhone, Android, install, sharing, Compañía) joined to it by threads (lit:
// the file is there and passes; dotted: missing; red: wrong), and the list of files on the right; a card or a row
// opens its sheet with the path and every check. Words and logic: @/lib/marca. Styles: corriente.css («Marca»).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { logoUrl } from "@/lib/logos";
import { FACES, counts, faceState, fileUrl, has, marcaWords, onItsWay, sentence, sortedRows, startAdjust, testLines, versionUrl, zipUrl, type Face, type MarcaRead, type MarcaRow, type MarcaWords, type PixelTests, type Plan, type Staged } from "@/lib/marca";
import { ApiError } from "@/lib/api";
import { toast } from "sonner";
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
  // PLA-I66-3: the aside shows the repo's candidates or the versions instead of the files; the upload takes the door.
  const [panel, setPanel] = useState<"repo" | "versiones" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sheet, setSheet] = useState(false);
  const took = (next: MarcaRead) => {
    client.setQueryData(["marca", p.slug], next);
    void client.invalidateQueries({ queryKey: ["logos"] });
    void client.invalidateQueries({ queryKey: ["marca-versions", p.slug] });
  };
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
  if (uploading) return <Upload p={p} r={r} w={w} onBack={() => setUploading(false)} onUsed={(next) => { took(next); setUploading(false); toast(w.up.saved); }} />;
  const c = counts(r.rows);
  const lit = hover ?? sel;
  const actions: CoreActions = {
    upload: () => setUploading(true),
    repo: () => { setSel(null); setPanel("repo"); },
    versions: () => { setSel(null); setPanel("versiones"); },
    release: async () => took(await api.marcaRelease(p.slug)),
  };
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
          {r.logo && (
            <a className="cor-btn secondary small" href={zipUrl(p.slug)} download data-control="marca-zip">
              {w.sheet.zip}
            </a>
          )}
          {r.pedido ? (
            <span className="mk-live" data-pedido={r.pedido.key}>
              <i aria-hidden />
              {w.inPr(r.pedido.key)}
            </span>
          ) : (
            r.logo &&
            r.repo === "ok" &&
            c.missing + c.wrong > 0 && (
              <button type="button" className="cor-btn primary" onClick={() => setSheet(true)} data-control="marca-al-repo">
                {w.sheet.open}
              </button>
            )
          )}
        </div>
      </header>
      {r.drift && (
        <div className="mk-drift" role="status" data-drift={r.drift.path}>
          <span>{w.drift.text(r.drift.path)}</span>
          <button type="button" className="cor-btn amber small" onClick={async () => took(await api.marcaCandidate(p.slug, r.drift!.path))} data-control="marca-usar-repo">
            {w.drift.use}
          </button>
          <button type="button" className="cor-btn secondary small" onClick={async () => took(await api.marcaKeep(p.slug, r.drift!.sha))} data-control="marca-mantener">
            {w.drift.keep}
          </button>
        </div>
      )}
      {sheet && (
        <Sheet
          p={p}
          w={w}
          onClose={() => setSheet(false)}
          onSent={(key, next) => {
            took(next);
            setSheet(false);
            toast(w.sheet.sent(key));
          }}
        />
      )}
      <div className="mk-grid">
        <Scene r={r} w={w} title={p.title} lit={lit} sel={sel} onPick={(f) => { setPanel(null); setSel(f); }} onHover={setHover} actions={actions} />
        <aside className="mk-list" aria-label={w.files}>
          {panel === "repo" ? (
            <RepoPanel r={r} w={w} onBack={() => setPanel(null)} onUse={async (path) => took(await api.marcaCandidate(p.slug, path))} />
          ) : panel === "versiones" ? (
            <VersionsPanel r={r} w={w} onBack={() => setPanel(null)} onGoBack={async (v) => took(await api.marcaGoBack(p.slug, v))} />
          ) : sel ? (
            <Ficha r={r} face={sel} w={w} onBack={() => setSel(null)} />
          ) : (
            <Rows r={r} w={w} onPick={setSel} onHover={setHover} />
          )}
        </aside>
      </div>
    </div>
  );
}

type CoreActions = { upload: () => void; repo: () => void; versions: () => void; release: () => Promise<void> };

function Scene({ r, w, title, lit, sel, onPick, onHover, actions }: { r: MarcaRead; w: MarcaWords; title: string; lit: Face | null; sel: Face | null; onPick: (f: Face) => void; onHover: (f: Face | null) => void; actions: CoreActions }) {
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
  const fav = src("ico") ?? src("svg");
  const apple = has(r.rows, "apple") ? src("apple") : null;
  const masked = has(r.rows, "mask") ? src("mask") : has(r.rows, "a512") ? src("a512") : null;
  const mono = has(r.rows, "mono") ? src("mono") : null;
  const theme = String(row("man")?.checks.find((x) => x.k === "man_colors")?.v?.theme ?? "#0e0e12");
  const ogRow = row("og");
  const og = ogRow?.state === "ok" && ogRow.path?.endsWith(".png") ? fileUrl(r.slug, ogRow.path) : null;
  const ogCode = ogRow?.state === "ok" && !og;
  const installIcon = src("a192") ?? src("a512");
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
      <Core r={r} w={w} title={title} actions={actions} />
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

function Core({ r, w, title, actions }: { r: MarcaRead; w: MarcaWords; title: string; actions: CoreActions }) {
  const l = r.logo;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", off);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", off); window.removeEventListener("keydown", esc); };
  }, [open]);
  const pick = (fn: () => void | Promise<void>) => () => { setOpen(false); void fn(); };
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
      <div className="mk-change" ref={box}>
        <button type="button" className="cor-btn secondary small" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-control="marca-cambiar">
          {w.change}
        </button>
        {open && (
          <div className="mk-menu" role="menu">
            <button type="button" role="menuitem" onClick={pick(actions.upload)} data-control="marca-subir">
              <b>{w.menu.upload}</b>
              <span>{w.menu.uploadHint}</span>
            </button>
            {r.candidates.length > 0 && (
              <button type="button" role="menuitem" onClick={pick(actions.repo)} data-control="marca-del-repo">
                <b>{w.menu.repo}</b>
                <span>{w.menu.repoHint(r.candidates.length)}</span>
              </button>
            )}
            {l && l.versions > 1 && (
              <button type="button" role="menuitem" onClick={pick(actions.versions)} data-control="marca-versiones">
                <b>{w.menu.versions}</b>
                <span>{w.menu.versionsHint(l.versions)}</span>
              </button>
            )}
            {l?.chosen && r.repo === "ok" && (
              <button type="button" role="menuitem" onClick={pick(actions.release)} data-control="marca-que-mande-el-repo">
                <b>{w.menu.release}</b>
                <span>{w.menu.releaseHint}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RepoPanel({ r, w, onBack, onUse }: { r: MarcaRead; w: MarcaWords; onBack: () => void; onUse: (path: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="mk-ficha" data-panel="repo">
      <button type="button" className="mk-back" onClick={onBack} data-control="marca-volver">
        {w.back}
      </button>
      <h3>{w.repoTitle}</h3>
      <p>{w.repoLead(r.branch)}</p>
      <ul className="mk-picks">
        {r.candidates.map((c) => (
          <li key={c.path} data-candidate={c.path}>
            <img src={fileUrl(r.slug, c.path)} alt="" className={c.variant === "icon" ? "tile" : ""} />
            <span className="mk-pick-tx">
              <code>{c.path}</code>
              <span>{w.variant[c.variant]}</span>
            </span>
            {c.inUse ? (
              <span className="mk-fi-st ok">{w.inUse}</span>
            ) : (
              <button type="button" className="mk-mini" disabled={busy !== null} onClick={async () => { setBusy(c.path); try { await onUse(c.path); } finally { setBusy(null); } }}>
                {w.useThis}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VersionsPanel({ r, w, onBack, onGoBack }: { r: MarcaRead; w: MarcaWords; onBack: () => void; onGoBack: (v: number) => Promise<void> }) {
  const q = useQuery({ queryKey: ["marca-versions", r.slug], queryFn: () => api.marcaVersions(r.slug) });
  const [busy, setBusy] = useState<number | null>(null);
  return (
    <div className="mk-ficha" data-panel="versiones">
      <button type="button" className="mk-back" onClick={onBack} data-control="marca-volver">
        {w.back}
      </button>
      <h3>{w.versionsTitle}</h3>
      <p>{w.versionsLead}</p>
      <ul className="mk-picks">
        {(q.data?.versions ?? []).map((v) => (
          <li key={v.v} data-version={v.v}>
            <img src={versionUrl(r.slug, v.v)} alt="" className={v.variant === "icon" ? "tile" : ""} />
            <span className="mk-pick-tx">
              <b>
                {w.version(v.v)} · {w.source[v.source]}
              </b>
              <span>{w.when(v.at)}</span>
            </span>
            {v.active ? (
              <span className="mk-fi-st ok">{w.active}</span>
            ) : (
              <button type="button" className="mk-mini" disabled={busy !== null} onClick={async () => { setBusy(v.v); try { await onGoBack(v.v); } finally { setBusy(null); } }}>
                {w.goBack}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** PLA-I66-3: the upload view (design frames C1, C2): drop or pick, fit and pick a background, see the six faces, use it. */
function Upload({ p, r, w, onBack, onUsed }: { p: { slug: string; title: string }; r: MarcaRead; w: MarcaWords; onBack: () => void; onUsed: (next: MarcaRead) => void }) {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [scale, setScale] = useState(100);
  const [bg, setBg] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ png: string; tests: PixelTests } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [ov, setOv] = useState({ circle: false, iphone: false });
  const input = useRef<HTMLInputElement>(null);
  const take = async (file: File) => {
    setError(null);
    setBusy(true);
    setPreview(null);
    try {
      const s = await api.marcaUpload(p.slug, file);
      const start = startAdjust(s);
      setStaged(s);
      setScale(start.scale);
      setBg(start.bg);
    } catch (e) {
      setStaged(null);
      setError(e instanceof ApiError ? String(e.detail.message ?? e.code) : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!staged) return;
    const t = setTimeout(() => {
      api.marcaPreview(p.slug, { up: staged.up, scale, bg }).then(setPreview, (e) => setError(e instanceof ApiError ? String(e.detail.message ?? e.code) : String(e)));
    }, 140);
    return () => clearTimeout(t);
  }, [p.slug, staged, scale, bg]);
  const use = async () => {
    if (!staged) return;
    setBusy(true);
    try {
      onUsed(await api.marcaUse(p.slug, { up: staged.up, name: staged.name, scale, bg }));
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail.message ?? e.code) : String(e));
    } finally {
      setBusy(false);
    }
  };
  const swatches = staged ? [...new Set([...staged.palette, ...(r.logo?.colors ?? []), "#ffffff", "#000000"])].slice(0, 6) : [];
  const img = preview?.png;
  const face = (key: keyof MarcaWords["up"]["faces"], body: ReactNode) => (
    <div className="mk-uf" data-uf={key}>
      <div className="mk-uf-b">{body}</div>
      <span>{w.up.faces[key]}</span>
    </div>
  );
  return (
    <div className="mk mk-up" data-marca-subir={p.slug}>
      <header className="mk-head">
        <div className="mk-head-l">
          <h2 className="cor-door-h">{w.up.title(p.title)}</h2>
          <p className="cor-text">{w.up.lead}</p>
        </div>
        <div className="mk-head-r">
          <button type="button" className="cor-btn secondary small" onClick={onBack} data-control="marca-subir-volver">
            {w.up.back}
          </button>
          <button type="button" className="cor-btn primary" disabled={!staged || !!staged.block || busy || !preview} onClick={() => void use()} data-control="marca-usar">
            {w.up.use}
          </button>
        </div>
      </header>
      <div className="mk-ugrid">
        <section className="mk-drop-col">
          <label
            className={`mk-drop${staged ? " has" : ""}${over ? " over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) void take(f); }}
          >
            {staged && img ? (
              <span className="mk-u-tile">
                <img src={img} alt="" />
                {ov.circle && <i className="ov circ" />}
                {ov.iphone && <i className="ov sq" />}
              </span>
            ) : (
              <span className="mk-drop-t">
                <b>{busy ? w.up.reading : w.up.drop}</b>
                <span>{w.up.dropHint}</span>
              </span>
            )}
            <input ref={input} type="file" accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp" className="sr-only" aria-label={w.up.drop} onChange={(e) => { const f = e.target.files?.[0]; if (f) void take(f); e.target.value = ""; }} data-control="marca-archivo" />
          </label>
          {staged && (
            <>
              <div className="mk-u-ov">
                <button type="button" className="mk-mini" aria-pressed={ov.circle} onClick={() => setOv((o) => ({ ...o, circle: !o.circle }))}>{w.up.circle}</button>
                <button type="button" className="mk-mini" aria-pressed={ov.iphone} onClick={() => setOv((o) => ({ ...o, iphone: !o.iphone }))}>{w.up.iphone}</button>
                <button type="button" className="mk-mini" onClick={() => input.current?.click()}>{w.up.other}</button>
              </div>
              <div className="mk-u-ctl">
                <label htmlFor="mk-scale">
                  {w.up.size} <b>{scale} %</b>
                </label>
                <input id="mk-scale" type="range" min={40} max={100} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
                <div className="mk-u-bg" role="radiogroup" aria-label={w.up.background}>
                  <span>{w.up.background}</span>
                  {swatches.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={bg === c} className={`sw${bg === c ? " on" : ""}`} style={{ background: c }} aria-label={c} title={c} onClick={() => setBg(c)} />
                  ))}
                  <button type="button" role="radio" aria-checked={bg === null} className={`sw none${bg === null ? " on" : ""}`} aria-label={w.up.none} title={w.up.none} onClick={() => setBg(null)} />
                </div>
              </div>
            </>
          )}
        </section>
        <section className="mk-u-faces" aria-label={w.files}>
          {img ? (
            <>
              {face("tab", <span className="mk-tabs light mini"><span className="mk-tab on"><img src={img} width={16} height={16} alt="" />{p.title}</span></span>)}
              {face("ios", <span className="mk-uf-ios"><img src={img} alt="" /></span>)}
              {face("and", <span className="mk-uf-and"><img src={img} alt="" /></span>)}
              {face("pwa", <span className="mk-uf-pwa"><img src={img} alt="" /><b>{p.title}</b></span>)}
              {face("share", <span className="mk-uf-og"><img src={img} alt="" /><b>{p.title}</b></span>)}
              {face("cia", <span className="mk-uf-cia"><img src={img} alt="" /><b>{p.title}</b></span>)}
            </>
          ) : (
            <div className="mk-u-empty">{w.up.empty}</div>
          )}
        </section>
        <aside className="mk-u-checks">
          {staged ? (
            <>
              <div className="mk-p-lbl">{w.up.checks(staged.name)}</div>
              <ul className="mk-res">
                {staged.checks.map((c, i) => (
                  <li key={i} className={c.ok === true ? "y" : c.ok === "warn" ? "w" : "n"}>{sentence(w.upCheck, c)}</li>
                ))}
                {preview && testLines(preview.tests, w).map((t, i) => (
                  <li key={`t${i}`} className={t.ok ? "y" : "n"}>{t.text}</li>
                ))}
              </ul>
              {staged.block && <p className="mk-block">{staged.block}</p>}
            </>
          ) : (
            <>
              <div className="mk-p-lbl">{w.up.rulesTitle}</div>
              <ul className="mk-tests">
                {w.up.rules.map(([b, t]) => (
                  <li key={b}>
                    <b>{b}</b>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && <p className="mk-block" role="alert">{error}</p>}
        </aside>
      </div>
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
                <StIcon st={onItsWay(r, x) ? "camino" : x.optional && x.state === "falta" ? "opt" : x.state} />
                <span className="mk-row-tx">
                  <b>{w.row[x.id].name}</b>
                  <span>{onItsWay(r, x) ? `${w.camino} · ` : x.size ? `${x.size} · ` : ""}{x.path ?? w.row[x.id].spec}</span>
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

/** PLA-I66-4: «Ponerlos en el repo» (design frame D1): what changes, file by file, and how it arrives. */
function Sheet({ p, w, onClose, onSent }: { p: { slug: string; title: string }; w: MarcaWords; onClose: () => void; onSent: (key: string, next: MarcaRead) => void }) {
  const [mode, setMode] = useState<"faltan" | "todo">("faltan");
  const plan = useQuery({ queryKey: ["marca-plan", p.slug, mode], queryFn: () => api.marcaPlan(p.slug, mode) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.marcaRequest(p.slug, mode);
      onSent(r.key, r.read);
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail.message ?? e.code) : String(e));
    } finally {
      setBusy(false);
    }
  };
  const pl: Plan | undefined = plan.data?.plan;
  const n = pl ? pl.items.length + pl.edits.length : 0;
  return (
    <div className="cor-hoja-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cor-hoja mk-sheet" role="dialog" aria-modal="true" aria-labelledby="mk-sheet-h" data-sheet="marca">
        <header className="mk-sh-head">
          <h3 id="mk-sheet-h">{w.sheet.title(p.title)}</h3>
          <button ref={first} type="button" className="mk-x" onClick={onClose} aria-label={w.sheet.cancel}>
            ×
          </button>
        </header>
        <p className="cor-text">{w.sheet.lead}</p>
        <div className="mk-sh-grid">
          <div>
            <div className="mk-sh-lbl">
              {w.sheet.changes} {pl && <span>{w.sheet.framework[pl.framework]}</span>}
            </div>
            <div className="mk-opts" role="radiogroup" aria-label={w.sheet.changes}>
              {(["faltan", "todo"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} data-control={`marca-modo-${m}`}>
                  {w.sheet[m]}
                </button>
              ))}
            </div>
            {!pl ? (
              <p className="cor-text" role="status">{w.sheet.loading}</p>
            ) : (
              <ul className="mk-tree">
                {pl.items.map((i) => (
                  <li key={i.path} data-op={i.op}>
                    <i className={i.op === "+" ? "ka" : "km"}>{i.op}</i>
                    <code>{i.path}</code>
                    <span>{w.sheet.file[i.key] ?? ""}</span>
                  </li>
                ))}
                {pl.edits.map((e) => (
                  <li key={`${e.path}-${e.what}`} data-op="~">
                    <i className="km">~</i>
                    <code>{e.path}</code>
                    <span>{w.sheet.edit[e.what] ?? ""}</span>
                  </li>
                ))}
                {pl.kept > 0 && (
                  <li className="same">
                    <i className="ks">=</i>
                    <span>{w.sheet.kept(pl.kept)}</span>
                  </li>
                )}
              </ul>
            )}
          </div>
          <div>
            <div className="mk-sh-lbl">{w.sheet.way}</div>
            <ol className="mk-way">
              {w.sheet.steps.map(([b, t]) => (
                <li key={b}>
                  <b>{b}</b>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        {error && <p className="mk-block" role="alert">{error}</p>}
        <footer className="mk-sh-foot">
          <span className="mk-sh-note">{pl ? w.sheet.count(n) : ""}</span>
          <a className="cor-btn secondary" href={zipUrl(p.slug, mode)} download data-control="marca-zip-hoja">
            {w.sheet.zip}
          </a>
          <button type="button" className="cor-btn secondary" onClick={onClose}>
            {w.sheet.cancel}
          </button>
          <button type="button" className="cor-btn primary" disabled={!pl || n === 0 || busy} onClick={() => void send()} data-control="marca-pedir">
            {w.sheet.send}
          </button>
        </footer>
      </div>
    </div>
  );
}
