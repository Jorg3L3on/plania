// PLA-I62-7: a project's PRs details (board C4), from the ficha read (GET /company/projects/:slug/ficha): the list and
// the open one beside it (Rama, Fusionado, Ver la entrega, Ver el paso, GitHub). PLA-135: the Docs detail left with
// Archivo; a doc opens in the reader (docs-proyecto.tsx).
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, type Decision, type OrgFicha, type OrgProject } from "@/lib/api";
import { deliveryFor } from "@/lib/etapas";
import { Key, Label, ReadError, You } from "./parts";
import { LOCALE } from "@/lib/locale";
import { words } from "@/lib/i18n";
import { LISTAS_WORDS } from "@/lib/listas-words";

const dayOf = (iso: string | null) => (iso ? new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" }).format(new Date(iso)).replace(".", "") : "");

/** all: every doc and PR (PLA-I64-6), so the one opened is the one clicked even past the first 30 docs or 20 PRs. */
export function useFicha(slug: string, all = false) {
  return useQuery({ queryKey: ["company-ficha", slug, all ? "todo" : "rows"], queryFn: () => api.companyFicha(slug, all), staleTime: 15_000 });
}

export const Prs = ({ p, decisions, open, links }: { p: OrgProject; decisions: Decision[]; open: number | null; links: { pr: (n: number) => string; paso: (key: string) => string; entrega: (d: Decision) => string } }) => {
  const w = words(LISTAS_WORDS);
  const f = useFicha(p.slug, true);
  if (f.isError) return <ReadError what={w.thePrs} onRetry={() => void f.refetch()} />;
  if (!f.data) return <div className="cor-skel" style={{ height: 300 }} role="status" aria-busy="true" aria-label={w.readingPrs} />;
  const prs = f.data.prs;
  const sel = prs.find((x) => x.number === open) ?? prs[0] ?? null;
  const openOnes = prs.filter((x) => x.state === "open" || (!x.merged_at && x.state !== "closed"));
  const merged = prs.filter((x) => !openOnes.includes(x));
  const waits = (key: string | null) => (key ? deliveryFor(key, decisions) : null);
  const row = (x: OrgFicha["prs"][number]) => {
    const d = waits(x.task_key);
    return (
      <li key={x.number}>
        <Link className="cor-prrow" to={links.pr(x.number)} aria-current={sel?.number === x.number ? "true" : undefined} data-pr={x.number}>
          <span className="cor-key">#{x.number}</span>
          <span className="cor-ellipsis">{x.title}</span>
          <span className="cor-cap">{x.task_key ?? "—"}</span>
          {d ? (
            <span className="cor-amber cor-prstate">
              <You small flat /> {w.yourTurnAccept}
            </span>
          ) : (
            <span className="cor-prstate cor-body">{x.merged_at ? w.mergedOn(dayOf(x.merged_at)) : x.state === "closed" ? w.closed : w.open}</span>
          )}
        </Link>
      </li>
    );
  };
  const d = sel ? waits(sel.task_key) : null;
  return (
    <div className="cor-prs" data-prs={prs.length}>
      <div className="cor-prs-list">
        <div className="cor-prrow head" aria-hidden>
          <span className="cor-label">PR</span>
          <span className="cor-label">{w.colTitle}</span>
          <span className="cor-label">{w.colStep}</span>
          <span className="cor-label">{w.colState}</span>
        </div>
        {prs.length === 0 ? (
          <p className="cor-empty cor-text" data-sin-prs>
            {w.noPrs}
          </p>
        ) : (
          <>
            {openOnes.length > 0 && (
              <section aria-label={w.openOnes}>
                <Label as="h2">{w.openOnes}</Label>
                <ul>{openOnes.slice(0, 6).map(row)}</ul>
              </section>
            )}
            {merged.length > 0 && (
              <section aria-label={w.mergedOnes}>
                <Label as="h2">{w.mergedOnes}</Label>
                <ul>{merged.slice(0, openOnes.length ? 4 : 8).map(row)}</ul>
              </section>
            )}
          </>
        )}
      </div>
      {sel && (
        <aside className="cor-card cor-prdetail" aria-label={`PR #${sel.number}`} data-pr-detail={sel.number}>
          <Label>{w.prHead(sel.number, sel.merged_at ? "merged" : sel.state === "closed" ? "closed" : "open")}</Label>
          <h2 className="cor-h3">{sel.title}</h2>
          {d && (
            <p className="cor-amber">
              <You small flat /> {w.yourTurnAcceptOf(sel.task_key ?? "")}
            </p>
          )}
          <dl className="cor-ev">
            <div>
              <dt>{w.step}</dt>
              <dd style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {sel.task_key ? (
                  <>
                    <Key>{sel.task_key}</Key>
                    <Link className="cor-btn link" to={links.paso(sel.task_key)} style={{ marginLeft: "auto" }} data-control="ver-paso">
                      {w.seeStep}
                    </Link>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>{w.branch}</dt>
              <dd className="cor-mono">{sel.head_branch ?? "—"}</dd>
            </div>
            <div>
              <dt>{w.merged}</dt>
              <dd>{sel.merged_at ? dayOf(sel.merged_at) : w.notYet}</dd>
            </div>
          </dl>
          <div className="cor-acts">
            {d && (
              <Link className="cor-btn primary" to={links.entrega(d)} data-control="ver-entrega">
                {w.seeDelivery}
              </Link>
            )}
            <a className="cor-btn secondary" href={sel.url} target="_blank" rel="noreferrer" data-control="github">
              {w.openGithub}
            </a>
          </div>
        </aside>
      )}
    </div>
  );
};

