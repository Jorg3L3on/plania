// PLA-I66-2: a project's Marca door (design: PLA-IDEA30, frames A1 to A3). The original in the middle, six cards around
// it with the repo's real files (browser, iPhone, Android, install, sharing, Compañía) joined to it by threads (lit:
// the file is there and passes; dotted: missing; red: wrong), and the list of files on the right; a card or a row
// opens its sheet with the path and every check. Words and logic: @/lib/marca. Styles: corriente.css («Marca»).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { logoUrl } from "@/lib/logos";
import { RING, type Surface, counts, pending, pendingSay, doorCount, fileUrl, markUrl, marcaWords, onItsWay, passesAll, sentence, sortedRows, startAdjust, testLines, versionUrl, zipUrl, type Face, type MarcaRead, type MarcaWords, type PixelTests, type Plan, type Staged, type MarksRequest } from "@/lib/marca";
import { ApiError } from "@/lib/api";
import { toast } from "sonner";
import { Logo, ReadError, Switch } from "./parts";
import { Link } from "react-router";
import { Cajon, MasCaras, Orilla } from "./marca-orilla";
import { linkTo } from "@/lib/corriente";
import { useSearchParams } from "react-router";
import { Estilo } from "./marca-estilo";
import { Historial } from "./marca-historial";
import { changesOf, estiloWords } from "@/lib/estilo";


export const useMarca = (slug: string) => useQuery({ queryKey: ["marca", slug], queryFn: () => api.marca(slug), staleTime: 30_000, refetchInterval: 60_000 });

const StIcon = ({ st }: { st: string }) => <i className={`mk-st ${st}`} aria-hidden />;

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function Marca({ p }: { p: { slug: string; title: string } }) {
  const w = marcaWords();
  const q = useMarca(p.slug);
  const client = useQueryClient();
  // PLA-I69-4: Marca's own doors (Caras · Estilo · Voz y nombre · Historial), kept in the address as ?m=.
  const [params, setParams] = useSearchParams();
  // An old link to Voz y nombre opens Estilo, where «Cómo trata a la gente» is now.
  const asked = params.get("m") === "voz" ? "estilo" : params.get("m");
  const door: Door = DOORS.includes(asked as Door) ? (asked as Door) : "caras";
  const goDoor = (d: Door) => {
    const next = new URLSearchParams(params);
    if (d === "caras") next.delete("m");
    else next.set("m", d);
    setParams(next, { replace: true });
  };
  const [sel, setSel] = useState<Face | null>(null);
  const [hover, setHover] = useState<Face | null>(null);
  // PLA-130: «Revisar el repo ahora» says it is reading, then that it finished (or failed), instead of only greying out.
  const [reread_, setReread] = useState<"idle" | "busy" | "done">("idle");
  const rereadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (rereadTimer.current) clearTimeout(rereadTimer.current); }, []);
  // PLA-I66-3: the aside shows the repo's candidates or the versions instead of the files; the upload takes the door.
  const [panel, setPanel] = useState<"repo" | "versiones" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [drawing, setDrawing] = useState(false);
  // PLA-122: «Solo este» on a card, and the sheet for that surface only.
  const [soloFor, setSoloFor] = useState<Surface | null>(null);
  const [sheetSurface, setSheetSurface] = useState<Surface | null>(null);
  const took = (next: MarcaRead) => {
    client.setQueryData(["marca", p.slug], next);
    void client.invalidateQueries({ queryKey: ["logos"] });
    void client.invalidateQueries({ queryKey: ["marca-versions", p.slug] });
  };
  const reread = async () => {
    if (rereadTimer.current) clearTimeout(rereadTimer.current);
    setReread("busy");
    const t0 = Date.now();
    try {
      const next = await api.marca(p.slug, true);
      // A read from the cache answers in a blink; hold the working state long enough to be seen.
      await new Promise((ok) => setTimeout(ok, Math.max(0, 700 - (Date.now() - t0))));
      client.setQueryData(["marca", p.slug], next);
      const c = counts(next.rows);
      toast.success(w.rereadToast(c.ok, c.missing + c.wrong + c.old));
      setReread("done");
      rereadTimer.current = setTimeout(() => setReread("idle"), 4000);
    } catch (e) {
      setReread("idle");
      toast.error(w.rereadFailed(e instanceof ApiError ? String(e.detail.message ?? e.code) : String(e)));
    }
  };
  if (q.isError && !q.data) return <ReadError what={w.readError} onRetry={() => void q.refetch()} />;
  const r = q.data;
  if (!r) return <div className="cor-skel" style={{ flex: 1 }} role="status" aria-busy="true" aria-label={w.loading} />;
  if (drawing) return <Generate p={p} w={w} onBack={() => setDrawing(false)} onUsed={(next) => { took(next); setDrawing(false); toast(w.gen.used); }} />;
  if (uploading) return <Upload p={p} r={r} w={w} onBack={() => setUploading(false)} onUsed={(next) => { took(next); setUploading(false); toast(w.up.saved); }} />;
  if (soloFor)
    return (
      <Upload
        p={p}
        r={r}
        w={w}
        surface={soloFor}
        onBack={() => setSoloFor(null)}
        onUsed={(next) => {
          took(next);
          // PLA-124: with an icons ticket still open, this one waits until that one is accepted.
          if (next.pedido) toast(w.solo.waits(w.solo.name[soloFor], next.pedido.key));
          else {
            toast(w.solo.saved(w.solo.name[soloFor]));
            setSheetSurface(soloFor);
            setSheet(true);
          }
          setSoloFor(null);
        }}
      />
    );
  const doors = <MarcaDoors door={door} onGo={goDoor} r={r} slug={p.slug} />;
  if (door !== "caras")
    return (
      <div className="mk" data-marca={p.slug} data-door={door}>
        {/* PLA-130: the tabs are Marca's first level; each page brings its own bar under them. */}
        {doors}
        {door === "estilo" && <Estilo slug={p.slug} title={p.title} logo={r.logo ? logoUrl(p.slug, r.logo) : null} />}
        {door === "historial" && <Historial slug={p.slug} title={p.title} />}
      </div>
    );
  const c = counts(r.rows);
  const lit = hover ?? sel;
  const actions: CoreActions = {
    upload: () => setUploading(true),
    artist: () => setDrawing(true),
    repo: () => { setSel(null); setPanel("repo"); },
    versions: () => { setSel(null); setPanel("versiones"); },
    solo: (s) => setSoloFor(s),
    send: (s) => { setSheetSurface(s); setSheet(true); },
    reset: async (s) => { took(await api.marcaSurfaceReset(p.slug, s)); toast(w.solo.reset(w.solo.name[s])); },
    release: async () => took(await api.marcaRelease(p.slug)),
  };
  return (
    <div className={`mk${lit ? " hl" : ""}`} data-marca={p.slug}>
      {doors}
      {/* PLA-130: Caras' own bar, under the tabs: what the repo holds on the left, Caras' actions on the right. */}
      <header className="mk-head mk-toolbar" aria-label={w.toolbar}>
        <div className="mk-head-l">
          {r.repo === "ok" && (
            <p className="mk-sum" data-sum>
              <span className="mk-sum-l">{w.repoFiles}</span>
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
              {c.old > 0 && (
                <span>
                  <b className="a">{c.old}</b> {w.count.old}
                </span>
              )}
            </p>
          )}
          {/* PLA-130: the lead sentence is gone; only a repo Plania cannot read still says so here. */}
          {r.repo !== "ok" && (
            <p className="cor-text">
              {r.repo === "none" && r.folder ? (
                <>
                  {/* PLA-120: a folder Plania cannot read is not a project with no code. */}
                  {w.noRepoFound(r.folder)}{" "}
                  <Link className="cor-btn link small" to={linkTo({ slug: p.slug, tab: "ajustes" })} data-control="marca-elegir-carpeta">
                    {w.noRepoLink}
                  </Link>
                </>
              ) : (
                w.noRepo
              )}
            </p>
          )}
        </div>
        <div className="mk-head-r">
          {r.repo === "ok" && (
            <button
              type="button"
              className={`cor-btn secondary small mk-reread ${reread_}`}
              onClick={() => void reread()}
              disabled={reread_ === "busy"}
              aria-busy={reread_ === "busy"}
              data-control="marca-revisar"
              data-reread={reread_}
            >
              {reread_ === "busy" ? <i className="mk-spin" aria-hidden /> : reread_ === "done" ? <i className="mk-tick" aria-hidden>✓</i> : null}
              {reread_ === "busy" ? w.rereadBusy : reread_ === "done" ? w.rereadDone : w.reread}
            </button>
          )}
          {/* PLA-130: the request's buttons, once at the bottom of Caras, live here now. */}
          {r.repo === "ok" && <TripActions r={r} w={w} slug={p.slug} onSend={() => setSheet(true)} />}
        </div>
      </header>
      {reread_ === "busy" && <div className="mk-reread-line" role="progressbar" aria-label={w.rereadBusy} />}

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
          surface={sheetSurface}
          onClose={() => { setSheet(false); setSheetSurface(null); }}
          onSent={(key, next) => {
            took(next);
            setSheet(false);
            setSheetSurface(null);
            toast(w.sheet.sent(key));
          }}
        />
      )}
      {/* PLA-I69-2: the waterline. Each surface as Plania would make it, its reflection from the repo, and a drawer. */}
      <div className={`mk-world${sel || panel ? " open" : ""}`}>
        <Orilla r={r} w={w} title={p.title} sel={sel} core={<Core r={r} w={w} title={p.title} actions={actions} />} onPick={(f) => { setPanel(null); setSel((cur) => (cur === f ? null : f)); }} />
        {sel && sel !== "cia" && sel !== "more" && <Cajon key={sel} r={r} w={w} face={sel} onClose={() => setSel(null)} took={took} onOwn={(s) => setSoloFor(s)} onGo={(f) => setSel(f)} onStyle={() => goDoor("estilo")} />}
        {sel === "more" && !panel && (
          <section className="mk-drawer list" role="dialog" aria-modal="false" aria-label={w.extras.title}>
            <button type="button" className="mk-x" onClick={() => setSel(null)} aria-label={w.cajon.close}>×</button>
            <MasCaras r={r} w={w} took={took} onNative={async (on) => took(await api.marcaNative(p.slug, on))} onAll={() => setSel("cia")} onClose={() => setSel(null)} />
          </section>
        )}
        {(sel === "cia" || panel) && (
          <section className="mk-drawer list" role="dialog" aria-modal="false" aria-label={panel ? w.files : w.orilla.more}>
            <button type="button" className="mk-x" onClick={() => { setSel(null); setPanel(null); }} aria-label={w.cajon.close}>×</button>
            {panel === "repo" ? (
              <RepoPanel r={r} w={w} onBack={() => setPanel(null)} onUse={async (path) => took(await api.marcaCandidate(p.slug, path))} />
            ) : panel === "versiones" ? (
              <VersionsPanel r={r} w={w} onBack={() => setPanel(null)} onGoBack={async (v) => took(await api.marcaGoBack(p.slug, v))} />
            ) : (
              <Rows r={r} w={w} onPick={(f) => setSel(f)} onHover={setHover} onNative={async (on) => took(await api.marcaNative(p.slug, on))} />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// PLA-130: Voz y nombre left Marca; its form of address lives in Estilo.
const DOORS = ["caras", "estilo", "historial"] as const;
type Door = (typeof DOORS)[number];
/** PLA-I69-4: Marca's doors, as tabs under the title. */
/** PLA-130: Marca's first level, a tab bar across the page; each tab says in a word where its part stands (what
 * waits for the repo, a request on its way, or up to date), from the reads its page makes anyway (cached). */
function MarcaDoors({ door, onGo, r, slug }: { door: Door; onGo: (d: Door) => void; r: MarcaRead; slug: string }) {
  const w = estiloWords();
  const est = useQuery({ queryKey: ["estilo", slug], queryFn: () => api.marcaEstilo(slug), staleTime: 30_000 });
  const state = (d: Door): { k: "todo" | "way" | "ok"; n?: number } | null => {
    if (d === "caras") return r.pedido ? { k: "way" } : r.repo !== "ok" ? null : pending(r).files ? { k: "todo", n: pending(r).files } : { k: "ok" };
    if (d === "estilo") { const e = est.data; if (!e) return null; const n = changesOf(e.base, e.repo, e.start).length; return e.pedido ? { k: "way" } : n ? { k: "todo", n } : { k: "ok" }; }
    return null;
  };
  return (
    <nav className="mk-doors" role="tablist" aria-label={w.doorsLabel}>
      {DOORS.map((d) => {
        const st = state(d);
        const say = st ? (st.k === "todo" ? w.doorState[d === "estilo" ? "changes" : "files"](st.n!) : w.doorState[st.k]) : null;
        return (
          <button key={d} type="button" role="tab" aria-selected={door === d} onClick={() => onGo(d)} data-control={`marca-puerta-${d}`}>
            <span>{w.doors[d]}</span>
            {say && <small className={`mk-door-st ${st!.k}`}>{say}</small>}
          </button>
        );
      })}
    </nav>
  );
}

/** PLA-130: the request's buttons in the head (the bar under the cards is gone): the last request's PR, the .zip, and
 * the one button that brings what is pending, or the request on its way, its step as the button's title. */
function TripActions({ r, w, slug, onSend }: { r: MarcaRead; w: MarcaWords; slug: string; onSend: () => void }) {
  const p = pending(r);
  const t = r.trip && !r.trip.cancelled ? r.trip : null;
  const open = !!r.pedido;
  const step = t ? t.step : -1;
  const why = p.files ? pendingSay(p, w) : "";
  return (
    <>
      {t?.pr && (
        <a className="cor-btn secondary small" href={t.pr} target="_blank" rel="noreferrer" data-control="marca-ver-pr">
          {w.trip.pr}
        </a>
      )}
      {r.logo && (
        <a className="cor-btn secondary small" href={zipUrl(slug)} download data-control="marca-zip">
          {w.sheet.zip}
        </a>
      )}
      {open ? (
        <TripSteps w={w} step={step} pedido={r.pedido!.key} />
      ) : (
        p.files > 0 &&
        r.logo && (
          <button type="button" className="cor-btn primary small" onClick={onSend} title={why || undefined} data-control="marca-al-repo">
            {w.trip.send(p.files)}
          </button>
        )
      )}
    </>
  );
}

/** PLA-130: «En camino» opens the request's six steps (the rail that lived in the bottom bar), the current one lit. */
function TripSteps({ w, step, pedido }: { w: MarcaWords; step: number; pedido: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const out = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", esc);
    window.addEventListener("mousedown", out);
    return () => { window.removeEventListener("keydown", esc); window.removeEventListener("mousedown", out); };
  }, [open]);
  const now = Math.min(Math.max(step, 0), 5);
  return (
    <div className="mk-steps-box" ref={box}>
      <button type="button" className="cor-btn secondary small mk-onway" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} data-pedido={pedido} data-control="marca-en-camino">
        <i className="mk-trip-dot" aria-hidden />
        {w.trip.onWay}
      </button>
      {open && (
        <div className="mk-steps" role="dialog" aria-label={w.trip.open}>
          <b>{w.trip.open}</b>
          <ol>
            {w.trip.stations.map((st, i) => (
              <li key={st} className={i < now ? "done" : i === now ? (i === 3 ? "you" : "now") : ""} aria-current={i === now ? "step" : undefined}>
                <i aria-hidden />
                {st}
              </li>
            ))}
          </ol>
          <p>{w.trip.waiting[now]}</p>
        </div>
      )}
    </div>
  );
}

type CoreActions = { artist: () => void; upload: () => void; repo: () => void; versions: () => void; release: () => Promise<void>; solo: (s: Surface) => void; reset: (s: Surface) => Promise<void>; send: (s: Surface) => void };

function Core({ r, w, title, actions }: { r: MarcaRead; w: MarcaWords; title: string; actions: CoreActions }) {
  const l = r.logo;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // PLA-130: the menu opens upward when the window has no room for it under the button.
  const menu = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    if (!open || !box.current || !menu.current) return setUp(false);
    const b = box.current.getBoundingClientRect();
    const h = menu.current.offsetHeight + 12;
    setUp(window.innerHeight - b.bottom < h && b.top > h);
  }, [open]);
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
            {w.variant[l.variant]}
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
          {/* PLA-130: the logo's theme colour can also be in its palette; one swatch each. */}
          {[...new Set(l.colors.map((c) => c.toLowerCase()))].map((c) => (
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
          <div className={`mk-menu${up ? " up" : ""}`} role="menu" ref={menu}>
            <button type="button" role="menuitem" onClick={pick(actions.upload)} data-control="marca-subir">
              <b>{w.menu.upload}</b>
              <span>{w.menu.uploadHint}</span>
            </button>
            <button type="button" role="menuitem" onClick={pick(actions.artist)} data-control="marca-artist">
              <b>{w.gen.menu}</b>
              <span>{w.gen.menuHint}</span>
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
      <p>{w.repoLead}</p>
      <ul className="mk-picks">
        {r.candidates.map((c) => (
          <li key={c.path} data-candidate={c.path}>
            <img src={fileUrl(r.slug, c.path, r.commit)} alt="" className={c.variant === "icon" ? "tile" : ""} />
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
function Upload({ p, r, w, onBack, onUsed, surface }: { p: { slug: string; title: string }; r: MarcaRead; w: MarcaWords; onBack: () => void; onUsed: (next: MarcaRead) => void; surface?: Surface }) {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [scale, setScale] = useState(100);
  const [bg, setBg] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ png: string; tests: PixelTests } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [ov, setOv] = useState({ circle: false, iphone: false });
  const input = useRef<HTMLInputElement>(null);
  // PLA-122: «Solo este» starts from the current original (or the surface's own picture) with its size and background.
  useEffect(() => {
    if (!surface) return;
    let live = true;
    setBusy(true);
    api.marcaSurfaceStart(p.slug, surface).then(
      (s) => {
        if (!live) return;
        const own = r.surfaces?.[surface];
        const start = startAdjust(s);
        setStaged(s);
        setScale(own?.scale ?? start.scale);
        setBg(own ? own.bg : start.bg); // PLA-124: an icon with its own background starts on it
        setBusy(false);
      },
      (e) => { if (live) { setError(e instanceof ApiError ? String(e.detail.message ?? e.code) : String(e)); setBusy(false); } },
    );
    return () => { live = false; };
  }, [p.slug, surface]); // eslint-disable-line react-hooks/exhaustive-deps
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
      onUsed(surface ? await api.marcaSurfaceSet(p.slug, surface, { up: staged.up, name: staged.name, scale, bg }) : await api.marcaUse(p.slug, { up: staged.up, name: staged.name, scale, bg }));
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
          {/* PLA-130: a small line, like the rest of Marca's heads, not the old big title. */}
          <h2 className="mk-screen-h">{surface ? w.solo.title(w.solo.name[surface], p.title) : w.up.title(p.title)}</h2>
          <p className="cor-text">{surface ? w.solo.lead(w.solo.name[surface]) : w.up.lead}</p>
        </div>
        <div className="mk-head-r">
          <button type="button" className="cor-btn secondary small" onClick={onBack} data-control="marca-subir-volver">
            {w.up.back}
          </button>
          <button type="button" className="cor-btn primary" disabled={!staged || !!staged.block || busy || !preview} onClick={() => void use()} data-control="marca-usar">
            {surface ? w.solo.use(w.solo.name[surface]) : w.up.use}
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
                {/* PLA-124: Android's circle is not a test for an iPhone or browser icon of its own. */}
                {preview?.tests && testLines(preview.tests, w).filter((_, i) => !(surface && surface !== "android" && i === 1)).map((t, i) => (
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

function Rows({ r, w, onPick, onHover, onNative }: { r: MarcaRead; w: MarcaWords; onPick: (f: Face) => void; onHover: (f: Face | null) => void; onNative: (on: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <header className="mk-list-h">
        <span className="mk-list-t">{w.files}</span>
        <span className="mk-list-n">{r.rows.length}</span>
        <span className="mk-list-f">{w.checked(clock(r.checkedAt))}</span>
      </header>
      <ul className="mk-rows">
        {sortedRows(r.rows).map((x) => {
          const img = x.state !== "falta" && x.path && /\.(png|svg|ico)$/.test(x.path) ? fileUrl(r.slug, x.path, r.commit) : x.id === "pl" && r.logo ? logoUrl(r.slug, r.logo) : null;
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
      {/* PLA-I66-6: off by default; on, the list and the request also cover the native icons and the launch screens. */}
      <footer className="mk-list-native">
        <Switch on={r.native} label={w.native} disabled={busy} onChange={async (on) => { setBusy(true); try { await onNative(on); } finally { setBusy(false); } }} data-control="marca-nativo" />
      </footer>
    </>
  );
}

/** The door's count in the project bar (shares the door's read). */
export function MarcaCount({ slug }: { slug: string }) {
  const q = useMarca(slug);
  if (!q.data) return null;
  const c = counts(q.data.rows);
  const bad = c.missing + c.wrong + c.old;
  return <span className={`n${bad ? "" : " ok"}`}>{doorCount(q.data.rows)}</span>;
}

/** PLA-I66-4: «Ponerlos en el repo» (design frame D1): what changes, file by file, and how it arrives. */
function Sheet({ p, w, onClose, onSent, surface }: { p: { slug: string; title: string }; w: MarcaWords; onClose: () => void; onSent: (key: string, next: MarcaRead) => void; surface?: Surface | null }) {
  const [mode, setMode] = useState<"faltan" | "todo">("faltan");
  const plan = useQuery({ queryKey: ["marca-plan", p.slug, mode, surface ?? null], queryFn: () => api.marcaPlan(p.slug, mode, surface) });
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
      const r = await api.marcaRequest(p.slug, mode, surface);
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
            {surface ? (
              <div className="mk-opts" data-solo={surface}>
                <button type="button" role="radio" aria-checked="true">{w.solo.sheet(w.solo.name[surface])}</button>
              </div>
            ) : (
              <div className="mk-opts" role="radiogroup" aria-label={w.sheet.changes}>
                {(["faltan", "todo"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} data-control={`marca-modo-${m}`}>
                    {w.sheet[m]}
                  </button>
                ))}
              </div>
            )}
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
          <a className="cor-btn secondary" href={zipUrl(p.slug, mode, surface)} download data-control="marca-zip-hoja">
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

/** PLA-I66-5: Artist's marks (design frames B1, B2): hints and inspiration, six marks with their tests, pick one. */
function Generate({ p, w, onBack, onUsed }: { p: { slug: string; title: string }; w: MarcaWords; onBack: () => void; onUsed: (next: MarcaRead) => void }) {
  const q = useQuery({
    queryKey: ["marca-marks", p.slug],
    queryFn: () => api.marcaMarks(p.slug),
    refetchInterval: (query) => (query.state.data?.request?.status === "drawing" ? 4000 : false),
  });
  const client = useQueryClient();
  // PLA-I69-3: a request made for one surface belongs to that surface's drawer, not to the logo's marks.
  const req: MarksRequest | null = q.data?.request && !q.data.request.hints.surface ? q.data.request : null;
  const [about, setAbout] = useState("");
  const [feel, setFeel] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [images, setImages] = useState<{ up: string; name: string; src: string; palette: string[] }[]>([]);
  // PLA-120: colours the owner types (#c48b9f), and what they would change in the next round.
  const [typed, setTyped] = useState<string[]>([]);
  const [change, setChange] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!req) return;
    setAbout((a) => a || req.hints.about);
    setFeel((f) => (f.length ? f : req.hints.feel));
    setAvoid((f) => (f.length ? f : req.hints.avoid));
    setTyped((c) => (c.length ? c : req.hints.colors));
  }, [req?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const colors = [...new Set([...typed, ...images.flatMap((i) => i.palette)].map((c) => c.toLowerCase()))].slice(0, 6);
  const marks = req?.status === "ready" ? req.marks : [];
  const picked = marks.find((m) => m.id === sel) ?? marks.find((m) => passesAll(m.tests)) ?? marks[0] ?? null;
  const ask = async (like?: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.marcaAskMarks(p.slug, { about, feel, avoid, colors, images: images.map((i) => i.up), like: like ?? null, change: change.trim() || null });
      setChange("");
      q.refetch();
      setSel(null);
      void r;
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail.message ?? e.code) : String(e));
    } finally {
      setBusy(false);
    }
  };
  const addImage = async (file: File) => {
    setError(null);
    try {
      const s = await api.marcaUpload(p.slug, file);
      setImages((l) => [...l, { up: s.up, name: s.name, src: URL.createObjectURL(file), palette: s.palette }].slice(0, 6));
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail.message ?? e.code) : String(e));
    }
  };
  const use = async () => {
    if (!req || !picked) return;
    setBusy(true);
    try {
      onUsed(await api.marcaUseMark(p.slug, req.id, picked.id));
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail.message ?? e.code) : String(e));
    } finally {
      setBusy(false);
    }
  };
  const words = (list: string[], set: (l: string[]) => void, label: string, kind: "feel" | "avoid") => (
    <div className={`mk-chips${kind === "avoid" ? " no" : ""}`}>
      {list.map((x) => (
        <button key={x} type="button" className="mk-chip" onClick={() => set(list.filter((y) => y !== x))} aria-label={w.gen.remove(x)}>
          {x}
        </button>
      ))}
      <input
        className="mk-chip-in"
        placeholder={w.gen.wordPh}
        aria-label={label}
        data-control={`marca-${kind}`}
        onKeyDown={(e) => {
          const v = e.currentTarget.value.trim();
          if (e.key === "Enter" && v) {
            e.preventDefault();
            if (!list.includes(v) && list.length < 6) set([...list, v]);
            e.currentTarget.value = "";
          }
        }}
      />
    </div>
  );
  // PLA-130: a request that keeps drawing can be stopped, and says when it takes longer than usual.
  const slow = req?.status === "drawing" && Date.now() - Date.parse(req.at) > 5 * 60_000;
  const cancel = async () => {
    if (!req) return;
    try { const back = await api.marcaCancelMarks(p.slug, req.id); client.setQueryData(["marca-marks", p.slug], back); toast(w.gen.cancelled); }
    catch (e) { toast.error(e instanceof ApiError ? String(e.detail.message ?? e.code) : String(e)); }
  };
  const status = req?.status === "drawing" ? <><span className="mk-live"><i aria-hidden />{slow ? w.gen.slow : w.gen.drawing}</span><button type="button" className="cor-btn secondary small" onClick={() => void cancel()} data-control="marca-artist-cancelar">{w.gen.cancel}</button></> : req?.status === "ready" ? <span className="mk-status">{w.gen.passed(marks.filter((m) => passesAll(m.tests)).length, marks.length)}</span> : null;
  return (
    <div className="mk mk-gen" data-marca-artist={p.slug}>
      <header className="mk-head">
        <div className="mk-head-l">
          <h2 className="mk-screen-h">{w.gen.title(p.title)}</h2>
          <p className="cor-text">{w.gen.lead}</p>
        </div>
        <div className="mk-head-r">
          {status}
          <button type="button" className="cor-btn secondary small" onClick={onBack} data-control="marca-artist-volver">
            {w.gen.back}
          </button>
        </div>
      </header>
      <div className="mk-ggrid">
        <section className="mk-pistas" aria-label={w.gen.about}>
          <label className="mk-p-lbl" htmlFor="mk-about">{w.gen.about}</label>
          <textarea id="mk-about" className="mk-ta" rows={3} value={about} placeholder={w.gen.aboutPh} onChange={(e) => setAbout(e.target.value)} />
          <div className="mk-p-lbl">{w.gen.inspiration}</div>
          <div className="mk-insp">
            {images.map((i) => (
              <span key={i.up} className="mk-in-img" title={i.name}>
                <img src={i.src} alt="" />
                <em>{i.name}</em>
              </span>
            ))}
            {images.length < 6 && (
              <button type="button" className="mk-in-add" onClick={() => input.current?.click()} aria-label={w.gen.add} data-control="marca-inspiracion">
                +
              </button>
            )}
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,.svg,image/svg+xml" className="sr-only" aria-label={w.gen.add} onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImage(f); e.target.value = ""; }} data-control="marca-inspiracion-archivo" />
          </div>
          <div className="mk-p-lbl">{w.gen.feel}</div>
          {words(feel, setFeel, w.gen.feel, "feel")}
          <div className="mk-p-lbl">{w.gen.avoid}</div>
          {words(avoid, setAvoid, w.gen.avoid, "avoid")}
          <div className="mk-p-lbl">
            {w.gen.colors} <span>{w.gen.colorsHint}</span>
          </div>
          <div className="mk-chips mk-sw" data-colores={colors.join(",")}>
            {colors.map((c) => (
              <button key={c} type="button" className="mk-chip" onClick={() => setTyped((l) => l.filter((x) => x !== c))} aria-label={w.gen.remove(c)} title={c} disabled={!typed.includes(c)}>
                <i style={{ background: c }} aria-hidden />
                {c}
              </button>
            ))}
            {colors.length < 6 && (
              <input
                className="mk-chip-in"
                placeholder={w.gen.colorPh}
                aria-label={w.gen.colors}
                data-control="marca-color"
                onKeyDown={(e) => {
                  const v = e.currentTarget.value.trim().toLowerCase();
                  const hex = /^#?[0-9a-f]{6}$/.test(v) ? (v.startsWith("#") ? v : `#${v}`) : null;
                  if (e.key === "Enter" && hex) {
                    e.preventDefault();
                    if (!colors.includes(hex)) setTyped((l) => [...l, hex]);
                    e.currentTarget.value = "";
                  }
                }}
              />
            )}
          </div>
          <button type="button" className="cor-btn primary mk-go" disabled={busy || req?.status === "drawing"} onClick={() => void ask()} data-control="marca-generar">
            {req?.status === "ready" ? w.gen.again : w.gen.go}
          </button>
          {error && <p className="mk-block" role="alert">{error}</p>}
          {req?.status === "failed" && <p className="mk-block">{req.why ? w.gen.failedWhy(req.why) : w.gen.failed}</p>}
        </section>
        <section className="mk-ring" aria-label={w.gen.pick}>
          <svg className="mk-r-orbit" viewBox="-260 -230 520 460" aria-hidden>
            <ellipse cx="0" cy="0" rx="205" ry="178" />
          </svg>
          <div className={`mk-r-center${picked ? " has" : ""}`}>
            {picked && req ? <img src={markUrl(p.slug, req.id, picked.tile)} alt="" /> : <span>{req?.status === "drawing" ? w.gen.drawing : w.gen.none}</span>}
          </div>
          {RING.map(([x, y], i) => {
            const m = marks[i];
            const style = { left: `calc(50% + ${x * 205}px)`, top: `calc(50% + ${y * 178}px)` };
            if (!m || !req) return <div key={i} className="mk-slot empty" style={style}><i /></div>;
            return (
              <button key={m.id} type="button" className={`mk-slot${picked?.id === m.id ? " on" : ""}`} style={style} aria-pressed={picked?.id === m.id} onClick={() => setSel(m.id)} data-mark={m.id}>
                <img src={markUrl(p.slug, req.id, m.tile)} alt="" />
                <span className="mk-slot-n">{m.name}</span>
                <span className="mk-slot-t" aria-hidden>
                  {[m.tests.small, m.tests.circle, m.tests.contrast].map((t, k) => (
                    <i key={k} className={t.ok ? "y" : "n"} />
                  ))}
                </span>
              </button>
            );
          })}
        </section>
        <aside className="mk-pick">
          {picked && req ? (
            <>
              <div className="mk-pick-big">
                <img src={markUrl(p.slug, req.id, picked.tile)} alt="" />
              </div>
              <h3 className="mk-pick-h">{picked.name}</h3>
              <p className="mk-pick-p">{picked.idea}</p>
              <ul className="mk-res">
                {testLines(picked.tests, w).map((t, i) => (
                  <li key={i} className={t.ok ? "y" : "n"}>{t.text}</li>
                ))}
              </ul>
              <input className="mk-chip-in mk-change" value={change} maxLength={200} placeholder={w.gen.changePh} aria-label={w.gen.changePh} onChange={(e) => setChange(e.target.value)} data-control="marca-que-cambiarias" />
              <div className="mk-pick-btns">
                <button type="button" className="cor-btn primary" disabled={busy} onClick={() => void use()} data-control="marca-usar-marca">
                  {w.gen.use}
                </button>
                <button type="button" className="cor-btn secondary small" disabled={busy || req.status === "drawing"} onClick={() => void ask(picked.id)} data-control="marca-mas-como-esta">
                  {w.gen.more}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mk-p-lbl">{w.gen.how}</div>
              <ul className="mk-tests">
                {w.gen.tests.map(([b, t]) => (
                  <li key={b}>
                    <b>{b}</b>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
