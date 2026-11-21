// PLA-I64-6 (PLA-IDEA28, board B3): Hecho, what happened day by day: steps done per day for 14 days, the initiatives
// closed, and a summary per day capped at a few titles (the rest counted); «Ver antes» walks back 14 days at a time.
// PLA-135: it lived beside Archivo; Archivo is gone and Hecho opens from Todo as before.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, type OrgProject } from "@/lib/api";
import { ReadError } from "./parts";
import { LOCALE } from "@/lib/locale";
import { words } from "@/lib/i18n";
import { HECHO_WORDS } from "@/lib/hecho-words";

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
const dayShort = (iso: string | null, timeZone?: string) => (iso ? new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone }).format(new Date(iso)).replace(".", "").toUpperCase() : "");
const ymd = (d: string) => new Date(`${d}T12:00:00Z`);
const dayWords = (d: string) => new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(ymd(d)).replace(/\./g, "").toUpperCase();

export type HechoLinks = { iniciativa: (key: string) => string; paso: (key: string) => string; antes: (hasta: string) => string; ahora: string };

export const HechoView = ({ p, hasta, links, timeZone }: { p: OrgProject; hasta: string | null; links: HechoLinks; timeZone?: string }) => {
  const q = useQuery({ queryKey: ["hecho", p.slug, hasta ?? ""], queryFn: () => api.hecho(p.slug, hasta), staleTime: 30_000 });
  const w = words(HECHO_WORDS);
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
