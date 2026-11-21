// PLA-I71-5: «Traer una habilidad de fuera» (PLA-IDEA34 board Traer). A pasted link (GitHub folder or file, a gist's
// raw SKILL.md, any SKILL.md address) or a pick from skills.sh's public catalog. Nothing is installed before the owner
// reads it: the full text the agent would carry (secrets and outside links marked), what Plania checked (text only,
// the files left out, the pin, the word budget) and that a clean review is no guarantee; then «para quién», with
// today's scopes and «nadie todavía». It stays pinned; a newer upstream is marked in the store and shown as a diff.
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type CatalogHit, type OrgProject } from "@/lib/api";
import { seatName } from "@/lib/corriente";
import { words } from "@/lib/i18n";
import type { SkillScope } from "@/lib/oficio-skills";
import type { ImportPreview, SkillMark } from "@/lib/oficio-trials";
import { TRAER_WORDS } from "@/lib/traer-words";
import { Btn, Label, useOnce } from "./parts";

type Whom = SkillScope | "nobody";
const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : e ? "NETWORK" : null);

/** The text with each marked line flagged (a secret or an outside link), for the owner to read whole. */
export const Marked = ({ text, file, marks }: { text: string; file: string; marks: SkillMark[] }) => {
  const w = words(TRAER_WORDS);
  const mine = marks.filter((m) => m.file === file);
  return (
    <>
      {text.split("\n").map((line, i) => {
        const m = mine.find((x) => x.line === i + 1);
        return (
          <span key={i} className={m ? `trr-mark ${m.kind}` : undefined} data-mark={m?.kind}>
            {line}
            {m && <span className="trr-flag">{m.kind === "secret" ? w.secretMark : w.linkMark}</span>}
            {"\n"}
          </span>
        );
      })}
    </>
  );
};

export const TraerPage = ({ p, back, onBrought }: { p: OrgProject; back: string; onBrought: (slug: string) => void }) => {
  const w = words(TRAER_WORDS);
  const client = useQueryClient();
  const [mode, setMode] = useState<"link" | "catalog">("link");
  const [url, setUrl] = useState("");
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [via, setVia] = useState<"skills.sh" | null>(null);
  const po = p.team.find((m) => m.template === "product-owner") ?? p.team[0];
  const [agent, setAgent] = useState(po?.agent ?? "");
  const [whom, setWhom] = useState<Whom>("agent");
  const m = p.team.find((x) => x.agent === agent) ?? po;
  const seat = m ? (m.puesto ?? seatName(m.role)) : "";
  const hits = useQuery({ queryKey: ["catalog", asked], queryFn: () => api.catalogSkills(asked), enabled: asked.length >= 2 });
  const lq = useQuery({ queryKey: ["lessons", p.slug, agent], queryFn: () => api.lessons(p.slug, agent), enabled: !!agent });
  const preview = useMutation({
    mutationFn: (x: { url: string } | { pick: CatalogHit }) => ("url" in x ? api.previewImport(p.slug, agent, x.url) : api.previewCatalog(p.slug, agent, { source: x.pick.source, skill: x.pick.skill })),
    onSuccess: (_d, x) => setVia("url" in x ? null : "skills.sh"),
  });
  const onceBring = useOnce({ sticky: true, key: preview.data?.source_hash });
  const bring = useMutation({
    mutationFn: (pv: ImportPreview) => api.bringSkill(p.slug, agent, { url: pv.url, source_hash: pv.source_hash, scope: whom === "nobody" ? "agent" : whom, on: whom !== "nobody", via }),
    onSuccess: (card) => {
      void client.invalidateQueries({ queryKey: ["tienda", p.slug] });
      void client.invalidateQueries({ queryKey: ["oficio", p.slug] });
      onBrought(card.slug);
    },
  });
  const pv = preview.data;
  const r = pv?.review;
  const budget = lq.data?.budget;
  const total = (budget?.used ?? 0) + (r?.words ?? 0);
  const secrets = r?.marks.filter((x) => x.kind === "secret").length ?? 0;
  const links = r?.marks.filter((x) => x.kind === "link").length ?? 0;
  const err = codeOf(preview.error ?? bring.error);
  const scopes: [Whom, string][] = [
    ["agent", w.scopeAgent(seat)],
    ["project", w.scopeProject],
    ["seat", w.scopeSeat(seat)],
    ["company", w.scopeCompany],
    ["nobody", w.scopeNobody],
  ];
  return (
    <div className="trr" data-traer>
      <div className="sum-head">
        <Link to={back} className="cor-strip-back" data-control="volver-habilidades">
          ‹ {w.back}
        </Link>
        <h2 className="eq-title">{w.title}</h2>
        <form
          className="trr-link"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "link" && url.trim()) preview.mutate({ url: url.trim() });
            if (mode === "catalog" && q.trim().length >= 2) setAsked(q.trim());
          }}
        >
          <span className="eq-places trr-modes" role="group" aria-label={w.catalog}>
            <button type="button" aria-pressed={mode === "link"} onClick={() => setMode("link")} data-control="traer-enlace">
              {w.fromLink}
            </button>
            <button type="button" aria-pressed={mode === "catalog"} onClick={() => setMode("catalog")} data-control="traer-catalogo">
              {w.fromCatalog}
            </button>
          </span>
          {mode === "link" ? (
            <input className="cor-input" aria-label={w.linkLabel} placeholder={w.linkPlaceholder} value={url} onChange={(e) => setUrl(e.target.value)} data-control="enlace-habilidad" />
          ) : (
            <input className="cor-input" type="search" aria-label={w.searchLabel} placeholder={w.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} data-control="buscar-catalogo" />
          )}
          <Btn kind="secondary" type="submit" disabled={preview.isPending || (mode === "link" ? !url.trim() : q.trim().length < 2)} data-control={mode === "link" ? "revisar" : "buscar"}>
            {preview.isPending ? w.reviewing : mode === "link" ? w.review : hits.isFetching ? w.searching : w.search}
          </Btn>
        </form>
      </div>
      {err && <p className="cor-state bad" role="status">{err === "SKILL_EXISTS" ? w.taken : w.failed(err)}</p>}
      {!pv ? (
        <div className="trr-empty">
          {mode === "catalog" && asked ? (
            hits.data?.skills.length ? (
              <ul className="tda-grid" aria-label={w.fromCatalog}>
                {hits.data.skills.map((h) => (
                  <li key={h.id}>
                    <button type="button" className="sum-card" onClick={() => preview.mutate({ pick: h })} data-hit={h.id}>
                      <span className="sum-card-top">
                        <b className="tda-name">{h.name}</b>
                        <span className="org-tag">{h.publisher}</span>
                      </span>
                      <span className="sum-card-line">{h.source}</span>
                      {h.installs != null && <span className="cor-cap">{w.installs(h.installs)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : hits.isError ? (
              <p className="cor-state bad">{w.failed(codeOf(hits.error) ?? "NETWORK")}</p>
            ) : hits.data ? (
              <p className="cor-text cor-muted">{w.noHits}</p>
            ) : null
          ) : (
            <p className="cor-text cor-muted">{w.pickHint}</p>
          )}
          {mode === "catalog" && <p className="cor-cap">{w.catalogNote}</p>}
        </div>
      ) : (
        <div className="trr-body" data-review={pv.slug}>
          <section className="cor-card trr-col trr-text" aria-label={pv.name}>
            <span className="sum-card-top">
              <b className="eq-side-name">{pv.name}</b>
              <span className="org-tag">{w.words(r?.words ?? 0)}</span>
            </span>
            <p className="cor-cap">{w.from(pv.publisher ?? "", pv.source_kind === "skills.sh" ? "skills.sh" : (pv.source_kind ?? "link"))}</p>
            <p className="cor-text">{pv.description}</p>
            <pre className="agt-pre trr-pre" tabIndex={0}>
              {pv.files.map((f) => (
                <span key={f.path}>
                  {pv.files.length > 1 && <span className="trr-file">{`── ${f.path}\n`}</span>}
                  <Marked text={f.content} file={f.path} marks={r?.marks ?? []} />
                </span>
              ))}
            </pre>
            <p className="cor-cap">{w.fullText}</p>
          </section>
          <section className="cor-card trr-col" aria-label={w.checked}>
            <Label as="h3">{w.checked}</Label>
            <ul className="trr-checks">
              <li className="ok">{w.textOnly}</li>
              <li className={r?.dropped.length ? "warn" : "ok"}>{r?.dropped.length ? w.dropped(r.dropped.length, r.dropped.join(", ")) : w.noDropped}</li>
              <li className="ok">{w.pinned((pv.commit ?? pv.source_hash).slice(0, 7))}</li>
              <li className={secrets ? "warn" : "ok"}>{secrets ? w.secrets(secrets) : w.noSecrets}</li>
              <li className={links ? "warn" : "ok"}>{links ? w.links(links) : w.noLinks}</li>
              {budget && <li className={total > budget.budget ? "warn" : "ok"}>{(total > budget.budget ? w.tooBig : w.fits)(seat, total, budget.budget)}</li>}
            </ul>
            <p className="cor-card trr-note">{w.notGuarantee}</p>
          </section>
          <section className="cor-card trr-col" aria-label={w.forWhom}>
            <Label as="h3">{w.forWhom}</Label>
            <label className="agt-kv">
              <span>{w.seat}</span>
              <select className="cor-select" value={agent} onChange={(e) => setAgent(e.target.value)} data-control="traer-puesto">
                {p.team.map((x) => (
                  <option key={x.agent} value={x.agent}>
                    {x.puesto ?? seatName(x.role)}
                  </option>
                ))}
              </select>
            </label>
            <div role="radiogroup" aria-label={w.forWhom} className="trr-whom">
              {scopes.map(([k, label]) => (
                <label key={k} className="trr-radio" data-inline-ok>
                  <input type="radio" name="trr-whom" checked={whom === k} onChange={() => setWhom(k)} data-control={`para-${k}`} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="cor-cap">{w.savedNote}</p>
            <Btn kind="primary" disabled={bring.isPending || pv.taken} onClick={() => onceBring(() => bring.mutateAsync(pv))} data-control="traerla">
              {bring.isPending ? w.bringing : whom === "nobody" ? w.bringKeep : whom === "agent" ? w.bring(seat) : w.bringAll}
            </Btn>
            <Btn kind="quiet" onClick={() => preview.reset()} data-control="no-traerla">
              {w.cancel}
            </Btn>
            {pv.taken && <p className="cor-state warn">{w.taken}</p>}
          </section>
        </div>
      )}
    </div>
  );
};
