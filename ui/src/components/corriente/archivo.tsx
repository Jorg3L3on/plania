// PLA-I64-6 (PLA-IDEA28, boards B2 and B3): two doors of the project.
//   Archivo  what was written, drawn and merged, together: the project's own docs and each thing's, the designs and
//            the PRs. Every doc and PR is read (ficha ?todo=1), so the one opened is the one clicked; it opens in
//            today's detail (Docs, PRs, the idea's Diseño).
//   Hecho    what happened, day by day: steps done per day for 14 days, the initiatives closed, and a summary per day
//            capped at a few titles (the rest counted); «Ver antes» walks back 14 days at a time.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, type FichaDoc, type OrgProject } from "@/lib/api";
import { useFicha } from "./listas";
import { Btn, ReadError } from "./parts";
import { LOCALE } from "@/lib/locale";
import { words } from "@/lib/i18n";
import { ARCHIVO_WORDS } from "@/lib/archivo-words";

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
const dayShort = (iso: string | null, timeZone?: string) => (iso ? new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone }).format(new Date(iso)).replace(".", "").toUpperCase() : "");
const ymd = (d: string) => new Date(`${d}T12:00:00Z`);
const dayWords = (d: string) => new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(ymd(d)).replace(/\./g, "").toUpperCase();

export type ArchivoLinks = { doc: (id: string) => string; pr: (n: number) => string; idea: (key: string) => string; todo: string };

/** Docs grouped: the project's own (no thing), then each thing's, newest first. */
export function docGroups(docs: FichaDoc[]): { own: FichaDoc[]; things: { key: string; docs: FichaDoc[] }[] } {
  const own = docs.filter((d) => !d.task_key);
  const by = new Map<string, FichaDoc[]>();
  for (const d of docs) if (d.task_key) by.set(d.task_key, [...(by.get(d.task_key) ?? []), d]);
  return { own, things: [...by.entries()].map(([key, ds]) => ({ key, docs: ds })) };
}

const SHOW = { own: 6, things: 3, prs: 8 } as const;

/** The things' names the company read carries (open and done initiatives, loose steps). */
export const namesOf = (p: OrgProject): Map<string, string> =>
  new Map([...(p.tablero?.initiatives ?? []).map((i) => [i.key, i.title] as const), ...(p.tablero?.loose ?? []).map((t) => [t.key, t.title] as const), ...(p.tablero?.done_initiatives ?? []).map((i) => [i.key, i.title] as const)]);

export const Archivo = ({ p, links, timeZone }: { p: OrgProject; links: ArchivoLinks; timeZone?: string }) => {
  const f = useFicha(p.slug, true);
  const [more, setMore] = useState<{ own?: boolean; things?: boolean; prs?: boolean }>({});
  const w = words(ARCHIVO_WORDS);
  if (f.isError) return <ReadError what={w.readWhat} onRetry={() => void f.refetch()} />;
  if (!f.data) return <div className="cor-skel" role="status" style={{ height: 420, margin: "20px 32px" }} aria-busy="true" aria-label={w.reading} />;
  const { own, things } = docGroups(f.data.docs);
  const prs = f.data.prs;
  const openPrs = prs.filter((x) => x.state === "open");
  const lienzos = f.data.lienzos ?? [];
  const linkOnly = f.data.designs.filter((d) => !lienzos.some((l) => l.key === d.idea_key));
  const linkIdeas = [...new Set(linkOnly.map((d) => d.idea_key))];
  const nDesigns = lienzos.length + linkIdeas.length;
  const names = namesOf(p);
  const title = (key: string) => names.get(key) || f.data!.ideas.find((i) => i.key === key)?.summary || f.data!.ideas.find((i) => i.key === key)?.title || "";
  const ownShown = more.own ? own : own.slice(0, SHOW.own);
  const thingsShown = more.things ? things : things.slice(0, SHOW.things);
  const prsShown = more.prs ? prs : prs.slice(0, SHOW.prs);
  return (
    <div className="cor-archivo" data-archivo={p.slug}>
      <header className="cor-door-head">
        <h2 className="cor-door-h">{w.title(p.title)}</h2>
        <p className="cor-text">
          {w.lead}{" "}
          <a className="cor-inline" href={`/p/${encodeURIComponent(p.slug)}?pagina`} data-control="pagina">
            {w.openPage}
          </a>
        </p>
      </header>
      <div className="cor-archivo-cols">
        <section aria-label="Docs" data-archivo-docs={f.data.counts.docs}>
          <div className="cor-grp">
            <h3 className="cor-label wh">{`Docs · ${f.data.counts.docs}`}</h3>
            <span className="cor-label">{w.own(own.length)}</span>
            {own.length > SHOW.own && (
              <Btn kind="link" className="cor-grp-more" aria-expanded={!!more.own} onClick={() => setMore((m) => ({ ...m, own: !m.own }))} data-control="ver-docs">
                {more.own ? w.showLess : w.showOthers(own.length - SHOW.own)}
              </Btn>
            )}
          </div>
          {own.length === 0 ? (
            <p className="cor-text cor-muted cor-door-empty">{w.noOwnDocs}</p>
          ) : (
            <ul className="cor-door-list">
              {ownShown.map((d) => (
                <li key={d.id}>
                  <Link to={links.doc(d.id)} className="cor-door-row" data-doc={d.id}>
                    <span className="cor-ellipsis">{d.title}</span>
                    <span className="cor-cap">{dayShort(d.updated_at, timeZone)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {things.length > 0 && (
            <>
              <div className="cor-grp">
                <h3 className="cor-label">{w.perThing(things.reduce((n, t) => n + t.docs.length, 0), things.length)}</h3>
                {things.length > SHOW.things && (
                  <Btn kind="link" className="cor-grp-more" aria-expanded={!!more.things} onClick={() => setMore((m) => ({ ...m, things: !m.things }))} data-control="ver-cosas">
                    {more.things ? w.showLess : w.showOthersThings(things.length - SHOW.things)}
                  </Btn>
                )}
              </div>
              <ul className="cor-door-list">
                {thingsShown.map((t) => (
                  <li key={t.key}>
                    <Link to={links.doc(t.docs[0]!.id)} className="cor-door-row" data-doc-cosa={t.key}>
                      <span className="cor-ellipsis">
                        <span className="cor-key">{t.key}</span> {title(t.key) || t.docs.map((d) => d.title).join(", ")}
                      </span>
                      <span className="cor-cap">{`${t.docs.length} ${t.docs.length === 1 ? "DOC" : "DOCS"}`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section aria-label={w.designs} data-archivo-disenos={nDesigns}>
          <div className="cor-grp">
            <h3 className="cor-label wh">{w.designsCount(nDesigns)}</h3>
          </div>
          {nDesigns === 0 ? (
            <p className="cor-text cor-muted cor-door-empty">{w.noDesigns}</p>
          ) : (
            <ul className="cor-door-cards">
              {lienzos.map((l) => (
                <li key={l.key}>
                  <Link to={links.idea(l.key)} className="cor-card cor-lienzo-card" data-lienzo={l.key}>
                    <span className="cor-lienzo-thumbs" aria-hidden>
                      {l.thumbs.slice(0, 3).map((t) => (
                        <img key={t} src={t} alt="" loading="lazy" />
                      ))}
                    </span>
                    <span className="cor-ellipsis">
                      <span className="cor-key">{l.key}</span> {l.title}
                    </span>
                    <span className="cor-cap">{w.frames(l.count, l.unseen)}</span>
                  </Link>
                </li>
              ))}
              {linkIdeas.map((k) => (
                <li key={k}>
                  <Link to={links.idea(k)} className="cor-card cor-lienzo-card" data-lienzo={k}>
                    <span className="cor-ellipsis">
                      <span className="cor-key">{k}</span> {title(k)}
                    </span>
                    <span className="cor-cap">{w.canvasOnClaude}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="PRs" data-archivo-prs={f.data.counts.prs}>
          <div className="cor-grp">
            <h3 className="cor-label wh">{`PRs · ${f.data.counts.prs}`}</h3>
            <span className="cor-label">{w.openPrs(openPrs.length)}</span>
          </div>
          {prs.length === 0 ? (
            <p className="cor-text cor-muted cor-door-empty">{w.noPrs}</p>
          ) : (
            <ul className="cor-door-list">
              {prsShown.map((x) => (
                <li key={x.number}>
                  <Link to={links.pr(x.number)} className="cor-door-row" data-pr={x.number}>
                    <span className="cor-ellipsis">
                      <span className="cor-key">#{x.number}</span> {x.title}
                    </span>
                    <span className={cls("cor-cap", x.state === "open" && "cor-state live")}>{x.merged_at ? dayShort(x.merged_at, timeZone) : x.state === "open" ? w.prOpen : w.prClosed}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {prs.length > SHOW.prs && (
            <Btn kind="link" aria-expanded={!!more.prs} onClick={() => setMore((m) => ({ ...m, prs: !m.prs }))} data-control="ver-prs">
              {more.prs ? w.showLess : w.showOthers(prs.length - SHOW.prs)}
            </Btn>
          )}
        </section>
      </div>
    </div>
  );
};

// ---- Hecho

export type HechoLinks = { iniciativa: (key: string) => string; paso: (key: string) => string; antes: (hasta: string) => string; ahora: string };

export const HechoView = ({ p, hasta, links, timeZone }: { p: OrgProject; hasta: string | null; links: HechoLinks; timeZone?: string }) => {
  const q = useQuery({ queryKey: ["hecho", p.slug, hasta ?? ""], queryFn: () => api.hecho(p.slug, hasta), staleTime: 30_000 });
  const w = words(ARCHIVO_WORDS);
  if (q.isError) return <ReadError what={w.readDone} onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className="cor-skel" role="status" style={{ height: 420, margin: "20px 32px" }} aria-busy="true" aria-label={w.readingDone} />;
  const h = q.data;
  // Every day of the window, oldest first, for the bars.
  const span: { day: string; n: number }[] = [];
  for (let d = ymd(h.from); d <= ymd(h.to); d = new Date(d.getTime() + 86_400_000)) {
    const k = d.toISOString().slice(0, 10);
    span.push({ day: k, n: h.days.find((x) => x.day === k)?.n ?? 0 });
  }
  const max = Math.max(1, ...span.map((d) => d.n));
  const today = !hasta;
  const fromPedido = h.initiatives.filter((i) => i.origin === "owner").length;
  const sentence = w.summary({
    total: h.total,
    today,
    from: dayShort(`${h.from}T12:00:00Z`, "UTC").toLowerCase(),
    to: dayShort(`${h.to}T12:00:00Z`, "UTC").toLowerCase(),
    initiatives: h.initiatives.length,
    fromPedido,
  });
  return (
    <div className="cor-hecho" data-hecho={p.slug} data-desde={h.from}>
      <header className="cor-door-head">
        <h2 className="cor-door-h">{w.doneTitle(p.title)}</h2>
        <p className="cor-text">{sentence}</p>
      </header>
      <div className="cor-hecho-cols">
        <div className="cor-hecho-left">
          <figure className="cor-card cor-hecho-chart">
            <figcaption className="cor-label">{w.perDay}</figcaption>
            <div className="cor-hecho-bars" role="img" aria-label={w.perDayAria(span.map((d) => `${dayWords(d.day).toLowerCase()} ${d.n}`).join(", "))}>
              {span.map((d, i) => (
                <span key={d.day} className="cor-hecho-bar">
                  <b className="cor-cap">{d.n || ""}</b>
                  <i className={cls(d.n === 0 && "z", today && i === span.length - 1 && "hoy")} style={{ height: d.n ? Math.max(6, Math.round((d.n / max) * 96)) : 2 }} />
                  <span className="cor-cap">{today && i === span.length - 1 ? w.today : String(ymd(d.day).getUTCDate())}</span>
                </span>
              ))}
            </div>
          </figure>
          <section aria-label={w.closed} data-cerradas={h.initiatives.length}>
            <div className="cor-grp">
              <h3 className="cor-label green">{w.closedCount(h.initiatives.length)}</h3>
            </div>
            {h.initiatives.length === 0 ? (
              <p className="cor-text cor-muted cor-door-empty">{w.noneClosed}</p>
            ) : (
              <ul className="cor-door-list">
                {h.initiatives.slice(0, 6).map((i) => (
                  <li key={i.key}>
                    <Link to={links.iniciativa(i.key)} className="cor-door-row" data-cerrada={i.key}>
                      <span className="cor-ellipsis">
                        <span className="cor-key">{i.key}</span> {i.title}
                      </span>
                      <span className="cor-cap">{[dayShort(i.done_at, timeZone), w.steps(i.steps), i.idea ? (i.origin === "owner" ? w.wasYourRequest(i.idea) : w.was(i.idea)) : null].filter(Boolean).join(" · ")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <section className="cor-hecho-days" aria-label={w.dayByDay} data-dias={h.days.length}>
          <h3 className="cor-label">{w.dayByDay}</h3>
          {h.days.length === 0 && <p className="cor-text cor-muted cor-door-empty">{w.nothingLanded}</p>}
          <ol>
            {h.days.slice(0, 5).map((d) => (
              <li key={d.day} className="cor-hecho-day" data-dia={d.day}>
                <span className="cor-label wh">{w.dayHead(dayWords(d.day), d.n)}</span>
                <p className="cor-text">
                  {d.initiatives.length > 0 && (
                    <b>{w.closedThatDay(d.initiatives.map((i) => i.title))}</b>
                  )}
                  {d.steps.map((s) => s.title).join(", ")}
                  {d.more > 0 ? w.more(d.more) : ""}
                  {d.steps.length ? "." : ""}
                  {d.prs > 0 ? w.prsMerged(d.prs) : ""}
                </p>
              </li>
            ))}
          </ol>
          <div className="cor-hecho-nav">
            {h.before && (
              <Link className="cor-btn link" to={links.antes(h.before)} data-control="ver-antes">
                {w.before(dayShort(`${h.from}T12:00:00Z`, "UTC").toLowerCase())}
              </Link>
            )}
            {!today && (
              <Link className="cor-btn link" to={links.ahora} data-control="ver-ultimos">
                {w.backToLatest}
              </Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
