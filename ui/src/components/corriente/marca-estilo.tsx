// PLA-I69-4: Marca → Estilo (design: PLA-IDEA33 pass 3). The left starts easy: three directions from the logo (all,
// colours only, type only) and a rail of the style's parts, each with plain choices (swatches, a font list with
// search, tiles). The right shows a small app made with the style, light and dark, over the reflection of what the
// repo has today. «Modo experto» adds every value's variable and the code (Tailwind 4, shadcn/ui, W3C tokens), which
// can be edited and applied. Every change is a version kept in Plania; «Llevar al repo» asks Taller.
// Logic and words: @/lib/estilo. Styles: corriente.css («Marca · Estilo»).
import { Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { contrast, scale, STEPS } from "@/lib/color";
import {
  FONT_CAT, LIBS, PAIRS, RATIOS, SECS, SYSTEM, applyDirection, changesOf, codeOf, directions, estiloWords, family, fontHref, fromCode, repoAsStyle, tokens,
  type CodeFmt, type EstiloWords, type Sec, type Style, type StyleRead,
} from "@/lib/estilo";
import { ReadError } from "./parts";

const loaded = new Set<string>();
/** Loads a font from Google Fonts the first time the screen shows it. */
export function useFonts(names: string[]) {
  const key = names.join("|");
  useEffect(() => {
    for (const n of names) {
      const href = fontHref(n);
      if (!href || loaded.has(n)) continue;
      loaded.add(n);
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      l.dataset.estiloFont = n;
      document.head.appendChild(l);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// Icon shapes after Lucide (ISC licence).
const IC: Record<string, string> = {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const FILLABLE = new Set(["bell", "heart", "star", "home", "user", "cal"]);
export const Icon = ({ n, s, size = 16 }: { n: string; s: Pick<Style, "stroke" | "fill">; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={s.fill && FILLABLE.has(n) ? "currentColor" : "none"} stroke="currentColor" strokeWidth={s.stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden dangerouslySetInnerHTML={{ __html: IC[n] ?? "" }} />
);

/** A small drawing in the chosen illustration style, for the Imágenes part and the empty state. */
export function Illus({ x, kind = x.img }: { x: Style; kind?: Style["img"] }) {
  const b = x.imgBrand ? x.brand : "#3b4a6b";
  const a = x.imgBrand ? x.accent : "#e5c07b";
  const line = kind === "linea";
  const f = (c: string) => (line ? { fill: "none", stroke: b, strokeWidth: 3 } : { fill: c });
  const gid = `gg-${kind}-${b.slice(1)}`;
  return (
    <svg viewBox="0 0 160 100" width="100%" height="100%" aria-hidden>
      {kind === "degradado" && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={a} stopOpacity=".5" />
            <stop offset="1" stopColor="#ffffff" />
          </linearGradient>
        </defs>
      )}
      <rect width="160" height="100" fill={kind === "degradado" ? `url(#${gid})` : "#f6f5f2"} />
      <rect x="54" y="26" width="52" height="40" rx="6" {...f(b)} />
      <circle cx="80" cy="46" r="10" {...(line ? { fill: "none", stroke: a, strokeWidth: 3 } : { fill: a })} />
      <path d="M0 84 Q20 76 40 84 T80 84 T120 84 T160 84 V100 H0Z" {...(line ? { fill: "none", stroke: b, strokeWidth: 3 } : { fill: b, opacity: 0.85 })} />
      {x.people && (
        <g>
          <circle cx="32" cy="56" r="6" {...f(a)} />
          <path d="M32 63 v12 M25 68 h14" stroke={line ? b : a} strokeWidth="3" />
        </g>
      )}
    </svg>
  );
}

/** The small app drawn with a style (600 × 360, scaled by its frame). */
export function Spec({ x, dark, logo, title, w, play }: { x: Style; dark: boolean; logo: string | null; title: string; w: EstiloWords; play?: number }) {
  const t = tokens(x);
  const c = dark ? t.dark : t.light;
  const pad = x.density === "compacto" ? 6 : x.density === "amplio" ? 11 : 8;
  const vars = {
    "--b": c.brand, "--on": c["on-brand"], "--a": c.accent, "--oa": c["on-accent"], "--bg": c.background, "--card": c.card, "--fg": c.foreground, "--mu": c.muted, "--bd": c.border,
    "--ok": c.success, "--wa": c.warning, "--er": c.danger, "--p": `${pad}px`, "--r": `${t.radius}px`, "--rb": `${t.button}px`, "--sh": t.shadow, "--fh": family(x.head), "--fb": family(x.body),
    "--fs": `${x.base}px`, "--h1": `${Math.min(t.sizes.h1, 40)}px`, "--h3": `${t.sizes.h3}px`, "--sm": `${t.sizes.small}px`, "--wh": x.wHead, "--bw": `${x.border}px`, "--dur": `${t.duration}ms`, "--ease": t.ease, "--lh": x.lh,
  } as React.CSSProperties;
  const bars = [0.55, 0.85, 0.4, 0.95, 0.7];
  return (
    <div className={`es-sp${dark ? " dk" : ""}`} style={vars} aria-hidden>
      <header className="es-sp-bar">
        {logo ? <img alt="" src={logo} /> : <i className="es-sp-dot" />}
        <b>{title}</b>
        <nav>
          {w.spec.nav.map((n, i) => (
            <span key={n} className={i === 0 ? "on" : ""}>{n}</span>
          ))}
        </nav>
        <span className="es-sp-i"><Icon n="bell" s={x} size={18} /></span>
        <span className="es-sp-av">{title.slice(0, 2).toUpperCase()}</span>
      </header>
      <div className="es-sp-main">
        <div className="es-sp-top">
          <div>
            <h1>{w.spec.title}</h1>
            <p>{w.spec.sub}</p>
          </div>
          <div className="es-sp-acts">
            <span className="es-sp-btn sec"><Icon n="heart" s={x} />{w.spec.save}</span>
            <span className="es-sp-btn pri"><Icon n="plus" s={x} />{w.spec.main}</span>
          </div>
        </div>
        <div className="es-sp-search"><Icon n="search" s={x} /><span>{w.spec.search}</span></div>
        <div className="es-sp-cards">
          <div className="es-sp-card">
            <div className="es-sp-ch"><b>{w.spec.cards[0]}</b><span className="es-sp-badge ok">{w.spec.open}</span></div>
            <span className="es-sp-meta"><Icon n="cal" s={x} size={14} />{w.spec.meta[0]}</span>
            <div className="es-sp-bars">{bars.map((h, i) => <i key={i} style={{ height: `${h * 100}%`, background: t.chart[i] }} />)}</div>
          </div>
          <div className="es-sp-card">
            <div className="es-sp-ch"><b>{w.spec.cards[1]}</b><span className="es-sp-badge wa"><Icon n="star" s={x} size={12} />{w.spec.wait}</span></div>
            <span className="es-sp-meta"><Icon n="cal" s={x} size={14} />{w.spec.meta[1]}</span>
            <div className="es-sp-tog"><i />{w.spec.toggle}</div>
            <span className="es-sp-link">{w.spec.link}</span>
          </div>
        </div>
      </div>
      <div key={play ?? 0} className={`es-sp-toast${play ? " go" : ""}`}><Icon n="check" s={x} size={15} />{w.spec.toast}</div>
    </div>
  );
}

function Seg<T extends string | number | boolean>({ value, opts, onPick, label }: { value: T; opts: [T, string][]; onPick: (v: T) => void; label: string }) {
  return (
    <div className="es-seg" role="radiogroup" aria-label={label}>
      {opts.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onPick(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}
const H = ({ children, tok, expert }: { children: ReactNode; tok?: string; expert?: boolean }) => (
  <div className="es-h">
    <span>{children}</span>
    {expert && tok && <span className="es-tok">{tok}</span>}
  </div>
);
const fmtRatio = (r: number) => `${r.toFixed(1).replace(".", ",")} : 1`;

/** The font list: search, kinds, a sample of each in its own letters, and any Google font typed by name. */
function FontPick({ cur, which, w, fonts, onPick }: { cur: string; which: "head" | "body" | "mono"; w: EstiloWords; fonts: string[]; onPick: (f: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"todas" | "sans" | "serif" | "display" | "mono">(which === "mono" ? "mono" : "todas");
  const box = useRef<HTMLDivElement>(null);
  useFonts(open ? fonts : [cur]);
  useEffect(() => {
    if (!open) return;
    // The list opens downward: bring the picker to the top of its pane so the list is seen whole.
    const pane = box.current?.closest(".es-pane");
    if (pane && box.current) pane.scrollTop += box.current.getBoundingClientRect().top - pane.getBoundingClientRect().top - 6;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const list = fonts.filter((f) => (cat === "todas" || FONT_CAT[f] === cat) && (!q.trim() || f.toLowerCase().includes(q.trim().toLowerCase())));
  const typed = q.trim();
  const canType = /^[A-Za-z0-9 -]{2,40}$/.test(typed) && !list.length;
  const name = which === "head" ? w.letra.head : which === "body" ? w.letra.body : w.letra.mono;
  return (
    <div className="es-fwrap" ref={box}>
      <button type="button" className="es-sel" aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen((o) => !o); setQ(""); }} data-control={`estilo-font-${which}`}>
        <span className="nm" style={{ fontFamily: family(cur) }}>{cur === SYSTEM ? w.letra.say[SYSTEM] : cur}</span>
        <small>{w.letra.say[cur] ?? ""} ▾</small>
      </button>
      {open && (
        <div className="es-fpop" role="dialog" aria-label={name} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
          <input autoFocus placeholder={w.letra.search} value={q} onChange={(e) => setQ(e.target.value)} aria-label={w.letra.search} autoComplete="off" />
          <div className="es-cats">
            {(["todas", "sans", "serif", "display", "mono"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={cat === k} onClick={() => setCat(k)}>{w.letra.cats[k]}</button>
            ))}
          </div>
          <div className="es-flist" role="listbox" aria-label={name} tabIndex={0}>
            {list.map((f) => (
              <button key={f} type="button" role="option" aria-selected={f === cur} className="es-fo" onClick={() => { onPick(f); setOpen(false); }}>
                <span className="nm" style={{ fontFamily: family(f) }}>
                  {f}
                  <span style={{ fontFamily: family(f) }}>{w.letra.sample}</span>
                </span>
                <small>{w.letra.say[f] ?? ""}<br />{w.letra.free}</small>
              </button>
            ))}
            {!list.length && <p className="es-fnone">{w.letra.none(typed)}</p>}
            {canType && (
              <button type="button" className="es-fo typed" onClick={() => { onPick(typed); setOpen(false); }}>
                <span className="nm">{w.letra.useTyped(typed)}</span>
              </button>
            )}
          </div>
          <div className="es-fpop-f">{w.letra.footer(name)}</div>
        </div>
      )}
    </div>
  );
}

export function Estilo({ slug, title, logo }: { slug: string; title: string; logo: string | null }) {
  const w = estiloWords();
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["estilo", slug], queryFn: () => api.marcaEstilo(slug), staleTime: 30_000 });
  const [x, setX] = useState<Style | null>(null);
  const [sec, setSec] = useState<Sec>("color");
  const [scope, setScope] = useState<"todo" | "color" | "letra">("todo");
  const [dir, setDir] = useState<string | null>(null);
  const [hoverDir, setHoverDir] = useState<string | null>(null);
  const [adv, setAdv] = useState(false);
  const [expert, setExpert] = useState(false);
  const [fmt, setFmt] = useState<CodeFmt>("tailwind");
  const [mode, setMode] = useState<"claro" | "oscuro">("claro");
  const [code, setCode] = useState<string | null>(null);
  const [codeMsg, setCodeMsg] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [play, setPlay] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const r = q.data;
  useEffect(() => {
    if (r && !dirty.current) setX(r.base);
  }, [r]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useFonts(x ? [x.head, x.body] : []);
  const repoX = useMemo(() => (r && x ? repoAsStyle(r.repo, x) : null), [r, x]);
  useFonts(repoX ? [repoX.head, repoX.body] : []);

  const save = (next: Style) => {
    if (timer.current) clearTimeout(timer.current);
    setSaving("saving");
    timer.current = setTimeout(async () => {
      try {
        const back = await api.marcaEstiloSave(slug, next);
        client.setQueryData(["estilo", slug], back);
        dirty.current = false;
        setSaving("saved");
      } catch (e) {
        setSaving("idle");
        toast.error(e instanceof ApiError ? e.message : String(e));
      }
    }, 650);
  };
  const edit = (patch: Partial<Style>, keepDir = false) => {
    if (!x) return;
    const next = { ...x, ...patch };
    dirty.current = true;
    setX(next);
    setCode(null);
    if (!keepDir) setDir(null);
    save(next);
  };

  if (q.isError && !r) return <ReadError what={w.readError} onRetry={() => void q.refetch()} />;
  if (!r || !x || !repoX) return <div className="cor-skel" style={{ flex: 1 }} role="status" aria-busy="true" aria-label={w.loading} />;

  const t = tokens(x);
  const ch = changesOf(x, r.repo);
  const nFiles = 2 + (x.head !== SYSTEM || x.body !== SYSTEM ? 1 : 0);
  const dirs = directions(r.logo, x);
  const changed = (k: Sec) => ch.some((c) => c.part === k);
  const fromLogo = [...new Set([r.logo.theme, ...r.logo.colors].filter((c): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c)))].slice(0, 3);
  const ideas = ["#0f766e", "#8c2f39", "#2563eb", "#7c3aed", "#ea580c"];
  const summary = (k: Sec): ReactNode => {
    if (k === "color")
      return (
        <>
          <i className="sw" style={{ background: x.brand }} />
          <i className="sw" style={{ background: x.accent }} />
          {x.brandTie === "sigue" ? w.sum.follows : w.sum.chosen}
        </>
      );
    if (k === "letra") return <span style={{ fontFamily: family(x.head) }}>{x.head === SYSTEM ? w.letra.say[SYSTEM] : x.head}</span>;
    if (k === "forma") return `${x.pill ? w.sum.pill : `${x.radius} px`} · ${w.sum.shadow(w.forma.shadow[x.shadow]!.toLowerCase())}`;
    if (k === "espacio") return w.espacio.density[x.density];
    if (k === "iconos") return `${x.lib} · ${w.sum.stroke(x.stroke)}`;
    if (k === "mov") return w.mov.motion[x.motion];
    if (k === "img") return `${w.img.styles[x.img]}${x.people ? ` · ${w.sum.people}` : ""}`;
    return w.sum.versions(r.versions);
  };

  const paneColor = () => {
    const checks: [string, number, number][] = [
      [w.color.checks[0]!, contrast(t.light.brand!, t.light["on-brand"]!), 4.5],
      [w.color.checks[1]!, contrast(t.light.brand!, t.light.background!), 4.5],
      [w.color.checks[2]!, contrast(t.dark.brand!, t.dark.background!), 3],
      [w.color.checks[3]!, contrast(x.accent, t.light.background!), 4.5],
    ];
    return (
      <>
        <div>
          {/* PLA-130: the expert label is the variable this colour really lands in. */}
          <H expert={expert} tok={r.cssOpts.shadcn ? "--primary" : "--color-brand"}>
            {w.color.brand}{" "}
            {x.brandTie === "sigue" ? (
              <span className="es-tie">{w.color.follows}</span>
            ) : r.logo.theme ? (
              <button type="button" className="es-more" onClick={() => edit({ brandTie: "sigue", brand: r.logo.theme! })} data-control="estilo-seguir-logo">
                {w.color.followAgain}
              </button>
            ) : null}
          </H>
          <div className="es-color">
            <input type="color" value={x.brand} onChange={(e) => edit({ brand: e.target.value.toLowerCase(), brandTie: "fijo" })} aria-label={w.color.brandLabel} data-control="estilo-marca" />
            <HexInput value={x.brand} label={w.color.hexLabel} onValid={(v) => edit({ brand: v, brandTie: "fijo" })} />
            {fromLogo.length > 0 && (
              <div className="es-fromlogo">
                <span>{w.color.fromLogo}</span>
                <div className="es-row">
                  {fromLogo.map((c) => (
                    <button key={c} type="button" className="es-swb" style={{ background: c }} aria-pressed={x.brand === c} aria-label={c} onClick={() => edit({ brand: c, brandTie: c === r.logo.theme ? "sigue" : "fijo" })} />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="es-row" style={{ marginTop: 7 }}>
            <span className="es-lbl opts">{w.color.ideas}</span>
            {ideas.map((c) => (
              <button key={c} type="button" className="es-swb sm" style={{ background: c }} aria-pressed={x.brand === c} aria-label={c} onClick={() => edit({ brand: c, brandTie: "fijo" })} />
            ))}
          </div>
        </div>
        <div>
          <H expert={expert} tok="50 … 950 · OKLCH">{w.color.scale}</H>
          <div className="es-ramp">{scale(x.brand).map((c, i) => <i key={i} style={{ background: c }} title={`${STEPS[i]} · ${c}`} />)}</div>
        </div>
        <div>
          <H expert={expert} tok={r.cssOpts.shadcn ? "--color-brand-accent" : "--color-accent"}>{w.color.accent} <span className="es-sub">({w.color.accentNote})</span></H>
          <div className="es-row">
            <input type="color" className="es-cin" value={x.accent} onChange={(e) => edit({ accent: e.target.value.toLowerCase() })} aria-label={w.color.accentLabel} data-control="estilo-acento" />
            {[...new Set([...fromLogo.filter((c) => c !== x.brand), "#ffd36e", "#ff6b4a", "#5eead4"])].slice(0, 5).map((c) => (
              <button key={c} type="button" className="es-swb sm" style={{ background: c }} aria-pressed={x.accent === c} aria-label={c} onClick={() => edit({ accent: c })} />
            ))}
          </div>
        </div>
        <div>
          <H>{w.color.greys}</H>
          <Seg label={w.color.greys} value={x.neutral} opts={(["frio", "neutro", "calido"] as const).map((k) => [k, w.color.neutral[k]!])} onPick={(v) => edit({ neutral: v })} />
        </div>
        <div>
          <H>{w.color.contrast}</H>
          <div className="es-checks">
            {checks.map(([l, ratio, min]) => (
              <div key={l} className="es-chk">
                <span>{l}</span>
                <b className={ratio >= min ? "" : "no"}>
                  {fmtRatio(ratio)} {ratio >= min ? "✓" : min === 4.5 && ratio >= 3 ? w.color.onlyBig : w.color.onlyBg}
                </b>
              </div>
            ))}
          </div>
        </div>
        {adv || expert ? (
          <div className="es-adv">
            <div>
              <H>{w.color.states}</H>
              <div className="es-row">
                {[t.light.success, t.light.warning, t.light.danger].map((c, i) => (
                  <span key={i} className="es-state"><i style={{ background: c }} />{w.color.stateNames[i]}</span>
                ))}
              </div>
            </div>
            <div>
              <H expert={expert} tok="--color-chart-1 … 5">{w.color.charts}</H>
              <div className="es-row">
                {t.chart.map((c) => <i key={c} className="es-chart" style={{ background: c }} />)}
                <span className="es-okline">✓ {w.color.chartsOk}</span>
              </div>
            </div>
            <p className="es-note">{w.color.darkNote}</p>
          </div>
        ) : (
          <button type="button" className="es-more" onClick={() => setAdv(true)}>{w.color.more}</button>
        )}
      </>
    );
  };
  const paneLetra = () => {
    const pair = PAIRS.find((p) => p[1] === x.head && p[2] === x.body)?.[0];
    const levels: [string, number, string, number][] = [
      [w.letra.levels[0]!, t.sizes.h1, x.head, x.wHead],
      [w.letra.levels[1]!, t.sizes.h2, x.head, x.wHead],
      [w.letra.levels[2]!, t.sizes.h3, x.head, x.wHead],
      [w.letra.levels[3]!, x.base, x.body, 400],
      [w.letra.levels[4]!, t.sizes.small, x.body, 400],
    ];
    return (
      <>
        <div>
          <H>{w.letra.pairs}</H>
          <PairFonts />
          <div className="es-pairs">
            {PAIRS.map(([k, h, b]) => (
              <button key={k} type="button" className="es-pair" aria-pressed={pair === k} onClick={() => edit({ head: h, body: b })} data-control={`estilo-par-${k}`}>
                <span className="aa" style={{ fontFamily: family(h) }}>
                  Aa<span style={{ fontFamily: family(b) }}>aa</span>
                </span>
                <span>{w.letra.pairNames[k]}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <H expert={expert} tok="--font-heading">{w.letra.head}</H>
          <FontPick cur={x.head} which="head" w={w} fonts={r.fonts} onPick={(f) => edit({ head: f })} />
        </div>
        <div>
          <H expert={expert} tok="--font-sans">{w.letra.body}</H>
          <FontPick cur={x.body} which="body" w={w} fonts={r.fonts} onPick={(f) => edit({ body: f })} />
        </div>
        <div>
          <H expert={expert} tok="--text-base">{w.letra.size}</H>
          <Seg label={w.letra.size} value={x.base} opts={[14, 15, 16, 17, 18].map((n) => [n, String(n)])} onPick={(v) => edit({ base: v })} />
        </div>
        <div>
          <H expert={expert} tok={`ratio ${x.ratio}`}>{w.letra.ratio}</H>
          <Seg label={w.letra.ratio} value={x.ratio} opts={RATIOS.map((n, i) => [n, w.letra.ratios[i]!])} onPick={(v) => edit({ ratio: v })} />
          <div className="es-levels">
            {levels.map(([l, s, f, wt]) => (
              <div key={l}>
                <span style={{ fontFamily: family(f), fontSize: Math.min(s, 30), fontWeight: wt }}>{l}</span>
                <small>{s} px</small>
              </div>
            ))}
          </div>
        </div>
        {adv || expert ? (
          <div className="es-adv">
            <div>
              <H>{w.letra.weight}</H>
              <Seg label={w.letra.weight} value={x.wHead} opts={[500, 600, 700, 800].map((n) => [n, String(n)])} onPick={(v) => edit({ wHead: v })} />
            </div>
            <div>
              <H>{w.letra.lh}</H>
              <Seg label={w.letra.lh} value={x.lh} opts={[1.4, 1.5, 1.6].map((n) => [n, String(n).replace(".", ",")])} onPick={(v) => edit({ lh: v })} />
            </div>
            <div>
              <H expert={expert} tok="--font-mono">{w.letra.mono}</H>
              <FontPick cur={x.mono} which="mono" w={w} fonts={r.fonts} onPick={(f) => edit({ mono: f })} />
            </div>
            <p className="es-note">{w.letra.note}</p>
          </div>
        ) : (
          <button type="button" className="es-more" onClick={() => setAdv(true)}>{w.letra.more}</button>
        )}
      </>
    );
  };
  const paneForma = () => (
    <>
      <div>
        <H expert={expert} tok="--radius">{w.forma.corners}</H>
        <div className="es-tiles">
          {[0, 6, 12, 20].map((rad, i) => (
            <button key={rad} type="button" className="es-tile" aria-pressed={x.radius === rad && !x.pill} onClick={() => edit({ radius: rad, pill: false })}>
              <span className="demo" style={{ borderRadius: rad, background: x.brand }} />
              {w.forma.tiles[i]}
            </button>
          ))}
        </div>
        <div className="es-row" style={{ marginTop: 8 }}>
          <input type="range" className="es-range" min={0} max={24} value={x.radius} onChange={(e) => edit({ radius: Number(e.target.value), pill: false })} aria-label={w.forma.radiusLabel} />
          <span className="es-val">{x.radius} px</span>
        </div>
        <label className="es-row es-check">
          <button type="button" className="es-sw" role="switch" aria-checked={x.pill} onClick={() => edit({ pill: !x.pill })} aria-label={w.forma.pill} />
          {w.forma.pill}
        </label>
      </div>
      <div>
        <H expert={expert} tok="--shadow-card">{w.forma.shadows}</H>
        <Seg label={w.forma.shadows} value={x.shadow} opts={(["plana", "suave", "marcada"] as const).map((k) => [k, w.forma.shadow[k]!])} onPick={(v) => edit({ shadow: v })} />
      </div>
      <div>
        <H>{w.forma.borders}</H>
        <Seg label={w.forma.borders} value={x.border} opts={([0, 1, 2] as const).map((k) => [k, w.forma.border[k]!])} onPick={(v) => edit({ border: v })} />
      </div>
    </>
  );
  const paneEspacio = () => (
    <>
      <div>
        <H expert={expert} tok="--spacing">{w.espacio.air}</H>
        <div className="es-tiles three">
          {([["compacto", 3], ["comodo", 5], ["amplio", 8]] as const).map(([k, g]) => (
            <button key={k} type="button" className="es-tile" aria-pressed={x.density === k} onClick={() => edit({ density: k })}>
              <span className="es-dens" style={{ gap: g }}><i /><i /><i /></span>
              {w.espacio.density[k]}
            </button>
          ))}
        </div>
      </div>
      <p className="es-note">{w.espacio.note}</p>
    </>
  );
  const paneIconos = () => (
    <>
      <div>
        <H>{w.iconos.lib}</H>
        <select className="es-native" value={x.lib} onChange={(e) => edit({ lib: e.target.value })} aria-label={w.iconos.libLabel} data-control="estilo-iconos">
          {LIBS.map((l) => <option key={l} value={l}>{w.iconos.libs[l]}</option>)}
        </select>
        {x.lib !== "Lucide" && <p className="es-note am" style={{ marginTop: 6 }}>{w.iconos.libNote}</p>}
      </div>
      <div>
        <H expert={expert} tok="--icon-stroke">{w.iconos.stroke}</H>
        <Seg label={w.iconos.stroke} value={x.stroke} opts={[1.5, 2, 2.5].map((n, i) => [n, w.iconos.strokes[i]!])} onPick={(v) => edit({ stroke: v })} />
      </div>
      <div>
        <H>{w.iconos.style}</H>
        <Seg label={w.iconos.style} value={x.fill} opts={[[false, w.iconos.fill[0]!], [true, w.iconos.fill[1]!]]} onPick={(v) => edit({ fill: v })} />
      </div>
      <div className="es-icons" style={{ color: x.brand }}>
        {["home", "search", "bell", "heart", "star", "cal", "user", "gear"].map((n) => <Icon key={n} n={n} s={x} size={22} />)}
      </div>
      <p className="es-sub">{w.iconos.note}</p>
    </>
  );
  const paneMov = () => (
    <>
      <div>
        <H expert={expert} tok="--default-transition-duration">{w.mov.how}</H>
        <Seg label={w.mov.how} value={x.motion} opts={(["ninguno", "calmo", "normal", "vivo"] as const).map((k) => [k, w.mov.motion[k]!])} onPick={(v) => { edit({ motion: v }); setPlay((n) => n + 1); }} />
      </div>
      <div className="es-row">
        <button type="button" className="cor-btn secondary small" onClick={() => setPlay((n) => n + 1)} data-control="estilo-ver-aviso">{w.mov.play}</button>
        <span className="es-lbl wide">{w.mov.says[x.motion]}</span>
      </div>
      <p className="es-note">{w.mov.note}</p>
    </>
  );
  const paneImg = () => (
    <>
      <div>
        <H>{w.img.style}</H>
        <div className="es-tiles three">
          {(["linea", "plano", "degradado"] as const).map((k) => (
            <button key={k} type="button" className="es-tile" aria-pressed={x.img === k} onClick={() => edit({ img: k })}>
              <span className="es-ill"><Illus x={x} kind={k} /></span>
              {w.img.styles[k]}
            </button>
          ))}
        </div>
      </div>
      <label className="es-row es-check">
        <button type="button" className="es-sw" role="switch" aria-checked={x.people} onClick={() => edit({ people: !x.people })} aria-label={w.img.people} />
        {w.img.people}
      </label>
      <label className="es-row es-check">
        <button type="button" className="es-sw" role="switch" aria-checked={x.imgBrand} onClick={() => edit({ imgBrand: !x.imgBrand })} aria-label={w.img.brandOnly} />
        {w.img.brandOnly}
      </label>
      <p className="es-note">{w.img.note}</p>
    </>
  );
  const paneLogo = () =>
    logo ? (
      <>
        <div>
          <H>{w.logo.title}</H>
          <div className="es-lock">
            {[["#0c0c10", "#ffffff"], ["#f4f4f6", "#0c0c10"], [x.brand, t.light["on-brand"]!]].map(([bg, fg], i) => (
              <div key={i} style={{ background: bg, color: fg }}>
                <img alt="" src={logo} />
                <span style={{ fontFamily: family(x.head), fontWeight: x.wHead }}>{title}</span>
                <small>{w.logo.kinds[i]}</small>
              </div>
            ))}
          </div>
        </div>
        <p className="es-note">{w.logo.note}</p>
      </>
    ) : (
      <p className="es-note am">{w.logo.none}</p>
    );
  const panes: Record<Sec, () => ReactNode> = { color: paneColor, letra: paneLetra, forma: paneForma, espacio: paneEspacio, iconos: paneIconos, mov: paneMov, img: paneImg, logo: paneLogo };

  const repoSay = [r.repo.head ?? r.repo.body ?? w.caps.sys, (r.repo.brand ?? r.repo.theme)?.toUpperCase(), r.repo.radius !== undefined ? w.caps.corners(r.repo.radius) : null].filter(Boolean).join(" · ");
  const knows = !!(r.repo.brand || r.repo.theme || r.repo.body || r.repo.radius !== undefined);
  const reflection = (dark: boolean, one = false) => (
    <div className={`es-waters${one ? " one" : ""}`}>
      {dark && !r.repo.dark ? (
        <div className="es-water empty"><span>{w.caps.noDark}</span></div>
      ) : (
        <div className="es-water" aria-hidden>
          <Fit className="mirw"><Spec x={repoX} dark={dark} logo={logo} title={title} w={w} /></Fit>
        </div>
      )}
      {(!dark || r.repo.dark) && <span className="es-cap am">{dark ? w.caps.repoDark : knows ? w.caps.repo(repoSay) : w.caps.unknown}</span>}
    </div>
  );
  const send = async () => {
    setSending(true);
    try {
      if (timer.current || !r.style) {
        if (timer.current) clearTimeout(timer.current);
        client.setQueryData(["estilo", slug], await api.marcaEstiloSave(slug, x));
        dirty.current = false;
      }
      const back = await api.marcaEstiloPedido(slug);
      client.setQueryData(["estilo", slug], back);
      setSendOpen(false);
      toast(w.send.sent(back.key));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };
  const bar = (
    <div className="es-bar">
      <div className="say">
        {r.pedido ? <b>{w.bar.way(r.pedido.key)}</b> : ch.length ? <><b>{w.bar.pending(ch.map((c) => (w.secs[c.part] ?? c.part).toLowerCase()))}</b> · {w.bar.files(nFiles)}</> : <b>{w.bar.same}</b>}
        {saving !== "idle" && <span className="es-saving" role="status"> · {saving === "saving" ? w.bar.saving : w.bar.saved}</span>}
      </div>
      <label className="es-exp">
        <button type="button" className="es-sw" role="switch" aria-checked={expert} onClick={() => { setExpert((e) => !e); setCode(null); setCodeMsg(""); }} aria-label={w.expert.label} data-control="estilo-experto" />
        {w.expert.label}
      </label>
      <button type="button" className={`cor-btn ${ch.length && !r.pedido ? "primary" : "secondary"} small`} disabled={!!r.pedido} onClick={() => setSendOpen((o) => !o)} data-control="estilo-llevar">
        {r.pedido ? w.bar.way(r.pedido.key) : w.bar.sendNone}
      </button>
      {sendOpen && (
        <div className="es-send" role="dialog" aria-label={w.send.title(nFiles)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setSendOpen(false); } }}>
          <h4>{w.send.title(nFiles)}</h4>
          <p>{w.send.lead}</p>
          <ul>
            {w.send.items.slice(0, nFiles).map(([a, b]) => (
              <li key={a}><b>{a}</b><span>{b}</span></li>
            ))}
            {r.old.length > 0 && <li><b>{r.old.length}</b><span>{w.send.old(r.old.length)}</span></li>}
          </ul>
          <footer>
            <button type="button" className="cor-btn secondary small" onClick={() => setSendOpen(false)}>{w.send.cancel}</button>
            <button type="button" className="cor-btn primary small" autoFocus disabled={sending} onClick={() => void send()} data-control="estilo-pedir">{w.send.go}</button>
          </footer>
        </div>
      )}
    </div>
  );
  const codeText = code ?? codeOf(x, fmt, r.cssOpts);
  const codePanel = (
    <aside className="es-code" aria-label={w.expert.code}>
      <div className="es-h">
        <span>{w.expert.code}</span>
        <Seg label={w.expert.code} value={fmt} opts={(["tailwind", "shadcn", "w3c"] as const).map((k) => [k, w.expert.fmts[k]!])} onPick={(v) => { setFmt(v); setCode(null); }} />
      </div>
      <textarea value={codeText} onChange={(e) => setCode(e.target.value)} spellCheck={false} aria-label={w.expert.codeLabel} data-control="estilo-codigo" />
      <div className="es-row">
        <button type="button" className="cor-btn secondary small" onClick={() => { edit({ brand: r.repo.brand ?? r.repo.theme ?? x.brand, accent: r.repo.accent ?? x.accent, head: r.repo.head ?? r.repo.body ?? SYSTEM, body: r.repo.body ?? SYSTEM, radius: r.repo.radius ?? x.radius, brandTie: "fijo" }); setCodeMsg(w.expert.imported); }} data-control="estilo-importar">
          {w.expert.importRepo}
        </button>
        <button type="button" className="cor-btn secondary small" onClick={() => { void navigator.clipboard?.writeText(codeText).catch(() => {}); setCodeMsg(w.expert.copied); }}>{w.expert.copy}</button>
        <button type="button" className="cor-btn primary small" style={{ marginLeft: "auto" }} disabled={code === null} onClick={() => { const { next, n } = fromCode(codeText, x, r.fonts); if (n) edit(next); setCode(null); setCodeMsg(w.expert.applied(n)); }} data-control="estilo-aplicar">
          {w.expert.apply}
        </button>
      </div>
      {codeMsg && <p className="es-msg" role="status">{codeMsg}</p>}
      <div>
        <H>{w.expert.diff(ch.length)}</H>
        <div className="es-diff">
          {ch.length ? ch.map((c) => <div key={c.part}><b>{w.expert.parts[c.part]}</b><span>{c.from} → {c.to}</span></div>) : <div><span>{w.expert.same}</span></div>}
        </div>
      </div>
      <div>
        <H>{w.expert.read}</H>
        <div className="es-diff">
          {knows ? (
            <>
              {(r.repo.brand || r.repo.theme) && <div><b>{w.expert.parts.color}</b><span className="plain">{r.repo.brand ?? r.repo.theme}{r.repo.accent ? ` · ${r.repo.accent}` : ""}</span></div>}
              {(r.repo.head || r.repo.body) && <div><b>{w.expert.parts.letra}</b><span className="plain">{[r.repo.head, r.repo.body].filter(Boolean).join(" + ")}</span></div>}
              {r.repo.radius !== undefined && <div><b>{w.expert.parts.forma}</b><span className="plain">{r.repo.radius} px</span></div>}
              {r.repo.files.map((f) => <div key={f}><b /><span className="plain">{f}</span></div>)}
            </>
          ) : (
            <div><span className="plain">{w.expert.readNone}</span></div>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <div className={`es-wrap${expert ? " expert" : ""}`} data-estilo={slug}>
      <div className="es-left">
        <span className="es-h" style={{ margin: 0 }}>{w.start}</span>
        <div className="es-dirs" onMouseLeave={() => setHoverDir(null)}>
          <DirFonts dirs={dirs.map((d) => d.s.head!)} />
          {dirs.map((d) => (
            <button key={d.k} type="button" className="es-dir" aria-pressed={dir === d.k} onMouseEnter={() => setHoverDir(d.k)} onFocus={() => setHoverDir(d.k)} onBlur={() => setHoverDir(null)} onClick={() => { const next = applyDirection(x, d.s, scope); dirty.current = true; setX(next); setCode(null); setDir(scope === "todo" ? d.k : null); save(next); }} data-control={`estilo-dir-${d.k}`}>
              <span className="es-row nowrap">
                <span className="sw"><i style={{ background: d.s.brand }} /><i style={{ background: d.s.accent }} /></span>
                <span className="aa" style={{ fontFamily: family(d.s.head!) }}>Aa</span>
                <i className="es-dir-r" style={{ borderRadius: Math.min(d.s.radius ?? 6, 8) }} />
              </span>
              <b>{w.dirs[d.k]![0]}</b>
              <span>{w.dirs[d.k]![1]}</span>
            </button>
          ))}
        </div>
        {/* PLA-130: the scope sits under the cards it applies to, and says what the next click changes. */}
        <div className="es-scope">
          <div className="es-row nowrap">
            <span className="es-lbl wide">{w.apply}</span>
            <Seg label={w.apply} value={scope} opts={(["todo", "color", "letra"] as const).map((k) => [k, w.scope[k]])} onPick={setScope} />
          </div>
          <p className="es-sub" role="status">{hoverDir ? w.willChange(w.dirs[hoverDir]![0], w.scopeSay[scope]!) : w.pickOne(w.scopeSay[scope]!)}</p>
        </div>
        <div className="es-ed">
          <nav className="es-rail" aria-label={w.rail} role="tablist">
            {SECS.map((k) => (
              <button key={k} type="button" role="tab" className="es-ri" aria-selected={sec === k} onClick={() => setSec(k)} data-control={`estilo-parte-${k}`}>
                <b>
                  {w.secs[k]}
                  {k !== "logo" && k !== "img" && changed(k) && <i className="dot" title={w.differs} />}
                </b>
                <span>{summary(k)}</span>
              </button>
            ))}
          </nav>
          <div className="es-pane" role="tabpanel" aria-label={w.secs[sec]} tabIndex={0}>
            {panes[sec]()}
          </div>
        </div>
      </div>
      {expert ? (
        <div className="es-right">
          {bar}
          <div className="es-row nowrap">
            <span className="es-lbl wide"><b>{w.expert.mode[mode]}</b> · {w.expert.live}</span>
            <Seg label={w.expert.mode.claro!} value={mode} opts={[["claro", w.expert.mode.claro!], ["oscuro", w.expert.mode.oscuro!]]} onPick={setMode} />
          </div>
          {mode === "oscuro" && !r.repo.dark ? (
            <Locked title={w.caps.lockedDark} line={w.caps.lockedDarkLine} />
          ) : (
            <>
              <Fit className="es-spec one"><Spec x={x} dark={mode === "oscuro"} logo={logo} title={title} w={w} play={play} /></Fit>
              {reflection(mode === "oscuro", true)}
            </>
          )}
        </div>
      ) : (
        <div className="es-right">
          {bar}
          <div className="es-specs">
            <div>
              <span className="es-cap">{w.caps.light}</span>
              <Fit className="es-spec"><Spec x={x} dark={false} logo={logo} title={title} w={w} play={play} /></Fit>
            </div>
            <div>
              <span className="es-cap">{r.repo.dark ? w.caps.dark : w.caps.darkLocked}</span>
              {r.repo.dark ? <Fit className="es-spec"><Spec x={x} dark logo={logo} title={title} w={w} play={play} /></Fit> : <Locked title={w.caps.lockedDark} line={w.caps.lockedDarkLine} />}
            </div>
          </div>
          <div className="es-specs">
            {reflection(false)}
            {r.repo.dark ? reflection(true) : <div />}
          </div>
        </div>
      )}
      {expert && codePanel}
    </div>
  );
}

/** PLA-130: a theme the app does not have: locked, never redrawn, and the request does not add it. */
function Locked({ title, line }: { title: string; line: string }) {
  return (
    <div className="es-locked" role="note">
      <Lock aria-hidden size={22} strokeWidth={1.8} />
      <b>{title}</b>
      <span>{line}</span>
    </div>
  );
}

/** The 600 × 360 sample scaled to the width it is given (and as tall as that makes it). */
export function Fit({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.7);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setK(Math.max(0.2, el.clientWidth / 600)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={{ height: Math.round(360 * k) }}>
      <div className="sc" style={{ transform: `scale(${k})` }}>{children}</div>
    </div>
  );
}

/** The fonts the pair and direction buttons draw with. */
const PairFonts = () => {
  useFonts([...new Set(PAIRS.flatMap(([, h, b]) => [h, b]))]);
  return null;
};
const DirFonts = ({ dirs }: { dirs: string[] }) => {
  useFonts(dirs);
  return null;
};

/** A colour code typed by hand: applied once it is a full #rrggbb. */
function HexInput({ value, label, onValid }: { value: string; label: string; onValid: (v: string) => void }) {
  const [v, setV] = useState(value.toUpperCase());
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setV(value.toUpperCase()); }, [value, focus]);
  return (
    <input
      className="es-hex"
      value={v}
      spellCheck={false}
      aria-label={label}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onChange={(e) => {
        setV(e.target.value);
        const t = e.target.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(t)) onValid(t.toLowerCase());
      }}
      data-control="estilo-hex"
    />
  );
}

export type { StyleRead };
