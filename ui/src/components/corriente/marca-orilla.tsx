// PLA-I69-2: Marca's waterline (design PLA-IDEA33, «el reflejo»). Each surface stands in its real place (a tab, a
// home screen, the install prompt, a chat) as Plania would make it now; under the line, its mirrored reflection is the
// file the repo has. A light line from the original drops to each surface: flowing when it follows the logo, with a
// knob when it is a variant, cut when it has its own picture. A surface opens its drawer over the water.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  FACE_FILES, SURFACE_OF, fileUrl, madeUrl, rowWhy, sentence, shoreState, tieOf,
  type Face, type MarcaRead, type MarcaRow, type MarcaWords, type Surface, type Tie,
} from "@/lib/marca";

export const SHORE: Face[] = ["nav", "ios", "and", "pwa", "share", "cia"];
type ShoreFace = Exclude<Face, "cia">;

/** The stamp that busts a made image: the logo version, and every surface's recipe or picture. */
const stampOf = (r: MarcaRead) => `${r.logo?.v ?? 0}-${Object.entries(r.surfaces ?? {}).map(([s, v]) => `${s}:${(v as { at?: string }).at ?? ""}:${v?.bg ?? ""}:${v?.scale ?? ""}`).join(",")}-${r.logo?.theme ?? ""}`;
const repoRow = (r: MarcaRead, f: ShoreFace): MarcaRow | null => {
  for (const id of FACE_FILES[f].rows) {
    const row = r.rows.find((x) => x.id === id);
    if (row?.path && row.state !== "falta" && /\.(png|svg|ico|jpe?g)$/.test(row.path)) return row;
  }
  return null;
};
const Pic = ({ src, alt = "" }: { src: string | null; alt?: string }) => (src ? <img src={src} alt={alt} loading="lazy" /> : <span className="dv-none" aria-hidden />);

/** One surface in its place: Plania's picture (side p) or the repo's (side r). */
function Device({ f, src, title, ask }: { f: ShoreFace | "more"; src: string | null; title: string; ask: string }) {
  const ic = (size: number, radius: string) => (
    <span className="ic" style={{ width: size, height: size, borderRadius: radius }}>
      <Pic src={src} />
    </span>
  );
  if (f === "nav")
    return (
      <div className="dv dv-nav">
        <div className="tabs"><span className="tab">{ic(13, "3px")}{title}</span><span className="tab off">+</span></div>
        <div className="url">{title.toLowerCase().replace(/\s+/g, "")}.app</div>
        <div className="lines"><i /><i className="s" /></div>
        <div className="g"><span className="gl">Google</span><div className="gr">{ic(24, "50%")}<span><b>{title}</b><em>{title.toLowerCase().replace(/\s+/g, "")}.app</em></span></div></div>
      </div>
    );
  if (f === "ios")
    return (
      <div className="dv dv-ios">
        <div className="grid">{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div>
        <div className="row"><i /><i /><i /><span className="app">{ic(38, "22%")}<span>{title}</span></span></div>
      </div>
    );
  if (f === "and")
    return (
      <div className="dv dv-and">
        <div><div className="clock">9:41</div></div>
        <div className="row"><i /><span className="app">{ic(38, "50%")}<span>{title}</span></span><i /><i /></div>
      </div>
    );
  if (f === "pwa")
    return (
      <div className="dv dv-pwa">
        <div className="dlg"><div className="t">{ask}</div><div className="r">{ic(32, "8px")}<span><b>{title}</b></span></div></div>
      </div>
    );
  if (f === "share")
    return (
      <div className="dv dv-share">
        <div className="out"><Pic src={src} /></div>
      </div>
    );
  return <div className="dv dv-more" />;
}

export function Orilla({ r, w, title, sel, core, onPick }: { r: MarcaRead; w: MarcaWords; title: string; sel: Face | null; core: ReactNode; onPick: (f: Face) => void }) {
  const field = useRef<HTMLDivElement>(null);
  const [rail, setRail] = useState<{ main: string; drops: { f: Face; x: number; y1: number; y2: number; tie: Tie | "more" }[]; box: [number, number] } | null>(null);
  // The wave: when the logo version moves while the door is open, the light runs and each surface flips in turn.
  const lastV = useRef(r.logo?.v ?? 0);
  const [wave, setWave] = useState(0);
  useEffect(() => {
    const v = r.logo?.v ?? 0;
    if (v !== lastV.current) {
      lastV.current = v;
      setWave((n) => n + 1);
    }
  }, [r.logo?.v]);
  const stamp = stampOf(r);
  const draw = useCallback(() => {
    const el = field.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const orig = el.querySelector(".mk-orig")?.getBoundingClientRect();
    if (!orig) return;
    const Y = 12;
    const ox = orig.left + orig.width / 2 - b.left;
    const drops = [...el.querySelectorAll<HTMLElement>(".mk-lab[data-face]")].map((lab) => {
      const lr = lab.getBoundingClientRect();
      const f = lab.dataset.face as Face;
      const s = SURFACE_OF[f];
      return { f, x: lr.left + Math.min(lr.width / 2, 40) - b.left, y1: Y, y2: lr.top - b.top - 1, tie: (f === "cia" ? "more" : tieOf(r, s)) as Tie | "more" };
    });
    const last = drops.length ? drops[drops.length - 1]!.x : ox;
    setRail({ main: `M${ox} ${orig.top - b.top} V${Y + 10} Q${ox} ${Y} ${ox + 10} ${Y} H${last}`, drops, box: [b.width, b.height] });
  }, [r]);
  useLayoutEffect(draw, [draw]);
  useEffect(() => {
    const el = field.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);
  return (
    <div className={`mk-shore${sel ? " open" : ""}`} ref={field} data-wave={wave}>
      {rail && (
        <svg className="mk-railsvg" viewBox={`0 0 ${rail.box[0]} ${rail.box[1]}`} aria-hidden>
          <path className="base" d={rail.main} />
          <path className="sigue" d={rail.main} />
          {wave > 0 && <path key={wave} className="lit" d={rail.main} />}
          {rail.drops.map((d) => {
            const mid = (d.y1 + d.y2) / 2;
            if (d.tie === "variante") return <g key={d.f}><path className="variante" d={`M${d.x} ${d.y1} V${d.y2}`} /><circle className="knob" cx={d.x} cy={mid} r={4} /></g>;
            if (d.tie === "propia") return <g key={d.f}><path className="propia" d={`M${d.x} ${d.y1} V${mid - 4} M${d.x} ${mid + 4} V${d.y2}`} /><path className="cut" d={`M${d.x - 5} ${mid - 2} l10 -3 M${d.x - 5} ${mid + 4} l10 -3`} /></g>;
            if (d.tie === "more") return <path key={d.f} className="more" d={`M${d.x} ${d.y1} V${d.y2}`} />;
            return <path key={d.f} className="sigue" d={`M${d.x} ${d.y1} V${d.y2}`} />;
          })}
        </svg>
      )}
      <div className="mk-c mk-srcc">{core}</div>
      {SHORE.map((f, i) => {
        if (f === "cia")
          return (
            <div className="mk-c" key={f} data-col="more">
              <button type="button" className="mk-lab" data-face="cia" onClick={() => onPick("cia")}>
                <span>{w.orilla.more}</span>
              </button>
              <button type="button" className="mk-dev" data-face="cia" aria-pressed={sel === "cia"} onClick={() => onPick("cia")} aria-label={w.orilla.more}>
                <div className="dv dv-more"><span className="plus">+</span><span>{w.orilla.moreHint}</span></div>
              </button>
              <span className="mk-hz none"><b>+</b></span>
              <div className="mk-refl none" aria-hidden />
              <span className="mk-cap">{w.orilla.alsoCia}</span>
            </div>
          );
        const s = SURFACE_OF[f];
        const tie = tieOf(r, s);
        const st = shoreState(r, f);
        const row = repoRow(r, f);
        const made = r.logo ? madeUrl(r.slug, FACE_FILES[f].made, stamp) : null;
        const repoSrc = row?.path ? fileUrl(r.slug, row.path, r.commit) : null;
        const knot = s ? (r.surfaces?.[s] as { knot?: boolean } | undefined)?.knot : false;
        const delay = `${0.25 + i * 0.25}s`;
        const cap = st.st === "aldia" ? w.orilla.same : st.st === "camino" ? w.orilla.onWay : w.trip.why[st.why ?? "falta"] ?? "";
        return (
          <div className="mk-c" key={f} data-col={f}>
            <button type="button" className="mk-lab" data-face={f} onClick={() => onPick(f)}>
              <span>{w.face[f].name}</span>
              {s && <span className={`mk-tie ${tie}`}>{w.tie[tie]}</span>}
            </button>
            <button type="button" className={`mk-dev${wave ? " flip" : ""}${knot ? " knot" : ""}`} key={`d${wave}`} style={{ animationDelay: delay }} data-face={f} aria-pressed={sel === f} onClick={() => onPick(f)} aria-label={w.face[f].name}>
              <Device f={f} src={made} title={title} ask={w.orilla.install} />
              {knot && <span className="mk-knot-tag">{w.knot.text}</span>}
            </button>
            <span className={`mk-hz ${st.st}`} title={cap}><b>{st.st === "aldia" ? "=" : st.st === "camino" ? "↓" : "≠"}</b></span>
            <button type="button" className={`mk-refl ${st.st}`} data-face={f} onClick={() => onPick(f)} aria-label={w.orilla.reflection(w.face[f].name)}>
              <div className="mir"><Device f={f} src={repoSrc} title={title} ask={w.orilla.install} /></div>
            </button>
            <span className={`mk-cap ${st.st}`}>{row || st.st !== "llevar" ? cap : w.orilla.none}</span>
          </div>
        );
      })}
    </div>
  );
}

const SWATCHES = ["#ffffff", "#000000", "#0f766e", "#1f2b5c", "#8c2f39"];

/** A surface's drawer: where it comes from (three ways, the recipe, its own picture), how it looks, its files, why a
 * phone may not show it yet, and its history. */
export function Cajon({ r, w, face, onClose, took, onOwn }: { r: MarcaRead; w: MarcaWords; face: Face; onClose: () => void; took: (next: MarcaRead) => void; onOwn: (s: Surface) => void }) {
  const s = SURFACE_OF[face];
  const tie = tieOf(r, s);
  const entry = s ? (r.surfaces?.[s] as { mode?: string; bg: string | null; scale: number; knot?: boolean } | undefined) : undefined;
  const [bg, setBg] = useState<string | null>(entry?.mode === "variante" ? entry.bg : r.logo?.theme ?? "#0f766e");
  const [scale, setScale] = useState<number>(entry?.mode === "variante" ? entry.scale : 70);
  const [busy, setBusy] = useState(false);
  const [cmp, setCmp] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  const client = useQueryClient();
  // The switch moves at once; the read that comes back from the server confirms it.
  const optimistic = (mode: Tie) =>
    client.setQueryData<MarcaRead>(["marca", r.slug], (old) => {
      if (!old || !s) return old;
      const next = { ...(old.surfaces ?? {}) };
      if (mode === "sigue") delete next[s];
      else next[s] = { ...(next[s] ?? { file: null }), mode, bg, scale, knot: false };
      return { ...old, surfaces: next };
    });
  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  // A recipe change is saved a moment after the last move, so dragging the size does not send every step.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveVariant = (next: { bg: string | null; scale: number }) => {
    if (!s) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setBusy(true);
      try { took(await api.marcaVariant(r.slug, s, next)); } finally { setBusy(false); }
    }, 350);
  };
  const setTie = async (t: Tie) => {
    if (!s || t === tie) return;
    setBusy(true);
    try {
      if (t === "sigue") { optimistic("sigue"); took(await api.marcaSurfaceReset(r.slug, s)); }
      else if (t === "variante") { optimistic("variante"); took(await api.marcaVariant(r.slug, s, { bg, scale })); }
      else onOwn(s);
    } finally {
      setBusy(false);
    }
  };
  const rows = r.rows.filter((x) => x.face === face || (face === "pwa" && x.id === "man"));
  const stamp = stampOf(r);
  const files = face === "cia" ? null : FACE_FILES[face as ShoreFace];
  const made = files && r.logo ? madeUrl(r.slug, files.made, stamp) : null;
  const repo = files ? (() => { for (const id of files.rows) { const x = r.rows.find((y) => y.id === id); if (x?.path && x.state !== "falta" && /\.(png|svg|ico)$/.test(x.path)) return fileUrl(r.slug, x.path, r.commit); } return null; })() : null;
  const st = face === "cia" ? null : shoreState(r, face);
  const carried = r.requests?.filter((q) => rows.some((x) => q.rows.includes(x.id))) ?? [];
  const steps = [true, !!r.pedido || st?.st === "aldia", st?.st === "aldia", st?.st === "aldia", false];
  const note = w.cajon[face === "cia" ? "more" : face] as string;
  const look = (shape: string, cls: string, src: string | null) => (
    <div key={shape}>
      <span className={`tile ${cls}`}><Pic src={src} /></span>
      {w.cajon.shapes[shape]}
    </div>
  );
  return (
    <section className="mk-drawer" aria-label={w.face[face].name} data-cajon={face}>
      <header className="mk-dh">
        <div>
          <h3>{w.face[face].name} {s && <span className={`mk-tie ${tie}`}>{w.tie[tie]}</span>}</h3>
          <p>{w.face[face].what}</p>
        </div>
        {st && <span className={`mk-dh-st ${st.st}`}>{st.st === "aldia" ? w.orilla.same : st.st === "camino" ? w.orilla.onWay : w.trip.why[st.why ?? "falta"]}</span>}
        <button ref={first} type="button" className="mk-x" onClick={onClose} aria-label={w.cajon.close}>×</button>
      </header>
      <div className="mk-dcols">
        <div className="mk-dcol">
          {s ? (
            <>
              <div className="mk-dl">{w.cajon.from}</div>
              <div className="mk-ways" role="radiogroup" aria-label={w.cajon.from}>
                {(["sigue", "variante", "propia"] as Tie[]).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={tie === t} className={`mk-tway ${t}`} disabled={busy} onClick={() => void setTie(t)} data-control={`marca-forma-${t}`}>
                    {w.tie[t]}
                  </button>
                ))}
              </div>
              <p className="mk-way-say">{w.tieSay[tie]}</p>
              {entry?.knot && (
                <div className="mk-knotbox" role="status">
                  <p>{w.knot.text}</p>
                  <div className="mk-knot-row">
                    <button type="button" className="cor-btn primary small" onClick={async () => took(await api.marcaSurfaceReset(r.slug, s))} data-control="marca-nudo-seguir">{w.knot.follow}</button>
                    <button type="button" className="cor-btn secondary small" onClick={async () => took(await api.marcaSurfaceKeep(r.slug, s))} data-control="marca-nudo-mantener">{w.knot.keep}</button>
                    <button type="button" className="cor-btn secondary small" onClick={() => onOwn(s)} data-control="marca-nudo-otra">{w.knot.another}</button>
                  </div>
                </div>
              )}
              {tie === "variante" && (
                <div className="mk-recipe">
                  <div className="mk-recipe-row">
                    <span>{w.cajon.bg}</span>
                    <div className="mk-sws" role="radiogroup" aria-label={w.cajon.bg}>
                      {[...new Set([...(r.logo?.colors ?? []).slice(0, 2), ...SWATCHES])].slice(0, 6).map((c) => (
                        <button key={c} type="button" role="radio" aria-checked={bg === c} aria-label={c} style={{ background: c }} onClick={() => { setBg(c); saveVariant({ bg: c, scale }); }} />
                      ))}
                      <input type="color" aria-label={w.cajon.bg} value={bg ?? "#000000"} onChange={(e) => { setBg(e.target.value); saveVariant({ bg: e.target.value, scale }); }} />
                    </div>
                  </div>
                  <label className="mk-recipe-row">
                    <span>{w.cajon.size}</span>
                    <input type="range" min={40} max={100} value={scale} onChange={(e) => { const v = Number(e.target.value); setScale(v); saveVariant({ bg, scale: v }); }} />
                    <b>{scale} %</b>
                  </label>
                  {busy && <span className="mk-saving" role="status">{w.cajon.saving}</span>}
                </div>
              )}
              {tie === "propia" && (
                <button type="button" className="cor-btn secondary small" onClick={() => onOwn(s)} data-control="marca-propia-subir">{w.cajon.upload}</button>
              )}
            </>
          ) : null}
          <p className="mk-dnote">{note}</p>
        </div>
        <div className="mk-dcol">
          <div className="mk-dl">
            {w.cajon.look}
            {files && <button type="button" className="mk-dlink" onClick={() => setCmp((c) => !c)} data-control="marca-comparar">{cmp ? w.cajon.back : w.cajon.compare}</button>}
          </div>
          {cmp && files ? (
            <div className="mk-cmp">
              <div><span className="tile old"><Pic src={repo} /></span>{w.cajon.inRepo}</div>
              <span aria-hidden>→</span>
              <div><span className="tile"><Pic src={made} /></span>{w.cajon.willBe}</div>
            </div>
          ) : face === "and" ? (
            <div className="mk-shapes">{[look("circle", "c", made), look("squircle", "sq", made), look("drop", "dr", made)]}</div>
          ) : face === "ios" ? (
            <div className="mk-shapes">{[look("home", "ios", made), look("dark", "ios dk", made)]}</div>
          ) : face === "nav" ? (
            <div className="mk-shapes">{[look("tab", "tab", made), look("dark", "tab dk", made), look("google", "g", made)]}</div>
          ) : face === "share" || face === "pwa" ? (
            <div className="mk-shapes wide"><div><span className={`tile ${face === "share" ? "og" : "ios"}`}><Pic src={made} /></span></div></div>
          ) : null}
        </div>
        <div className="mk-dcol">
          <div className="mk-dl">{w.cajon.files} · {rows.length}</div>
          <ul className="mk-dfiles">
            {rows.map((x) => {
              const why = rowWhy(r, x);
              return (
                <li key={x.id} className={x.state}>
                  <i className={`mk-st ${why === "camino" ? "camino" : x.optional && x.state === "falta" ? "opt" : x.state}`} aria-hidden />
                  <b>{w.row[x.id].name}</b>
                  <code>{x.path ?? w.row[x.id].spec}</code>
                  {why && why !== "camino" && <span>{w.trip.why[why]}{x.checks.find((c) => !c.ok) ? ` · ${sentence(w.check, x.checks.find((c) => !c.ok)!)}` : ""}</span>}
                </li>
              );
            })}
          </ul>
          {face !== "cia" && (
            <>
              <div className="mk-dl">{w.cajon.notSeen}</div>
              <ol className="mk-dsteps">
                {w.cajon.steps.map((t, i) => (
                  <li key={t} className={steps[i] ? "ok" : ""}>{t}{i === 4 ? ` · ${w.cajon.phoneLate}` : ""}</li>
                ))}
              </ol>
              <div className="mk-dl">{w.cajon.history}</div>
              <ul className="mk-dhist">
                <li><b>{tie === "sigue" ? w.cajon.hFollows(r.logo?.v ?? 1) : tie === "variante" ? w.cajon.hVariant : w.cajon.hOwn}</b><span>{w.cajon.hNow}</span></li>
                {carried.slice(0, 3).map((q) => (
                  <li key={q.key}><b>{w.cajon.hReq(q.rows.length)}</b><span>{new Date(q.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span></li>
                ))}
                {carried.length === 0 && <li className="none"><span>{w.cajon.hNone}</span></li>}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
