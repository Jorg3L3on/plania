// PLA-I68-3: «Código y ramas». Repo picked from the account's repos (or a pasted link, checked by GitHub when applied),
// folder picked from this Mac's clones of that repo, the three ways to publish with their reason and source, branch
// roles picked from the real branches, a work-branch pattern with its live matches, the branches with their role and
// state, GitHub's rules per role branch in plain words, and how PRs merge. Every edit goes to the change set.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { codigoWords, kindOf, matchesOf, MODEL_SOURCES, repoFromLink, roleOptions } from "@/lib/camino-codigo";
import { cambiosWords } from "@/lib/camino-cambios";
import { caminoWords, tidyPath } from "@/lib/camino";
import type { BranchRule, CaminoRead, PublishModel } from "@/lib/camino-types";
import { Btn } from "./parts";
import { Blk, Ed, Experto, Recom } from "./camino";
import { Tg } from "./camino-cambios";
import type { Cambios } from "./camino-store";
import { PrepararCodigo } from "./preparar-codigo";

/** PLA-132: «Preparar el código» reads the project's settings (as Ajustes did) and shows only what is left to do. */
const PrepararDeCamino = ({ slug }: { slug: string }) => {
  const q = useQuery({ queryKey: ["ajustes", slug], queryFn: () => api.ajustes(slug) });
  return q.data ? <PrepararCodigo a={q.data} /> : null;
};

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
type Roles = { model: PublishModel; published: string; integration: string | null; work_pattern: string };
const DEFAULT_RULE: BranchRule = { on: false, pr: true, nodel: true, agents: false };

export const Why = ({ text, src, label, srcLabel }: { text: string; src?: string; label: string; srcLabel: string }) => (
  <details className="cam-why">
    <summary>{label}</summary>
    <p>
      {text}{" "}
      {src && (
        <a className="cor-inline" href={src} target="_blank" rel="noreferrer">
          {srcLabel}
        </a>
      )}
    </p>
  </details>
);

export const Codigo = ({ r, cambios }: { r: CaminoRead; cambios: Cambios }) => {
  const w = codigoWords();
  const cw = cambiosWords();
  const ex = caminoWords().expert.codigo;
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const mac = r.discovery?.mac;
  const c = r.config;
  const [paste, setPaste] = useState("");
  const [pasteBad, setPasteBad] = useState<string | null>(null);
  const [pasted, setPasted] = useState<Set<string>>(new Set());
  const [looking, setLooking] = useState(false);

  const orig: Roles = { model: c.model, published: c.branches.published, integration: c.branches.integration, work_pattern: c.branches.work_pattern };
  const roles = (cambios.staged("roles") as Roles | undefined) ?? orig;
  const say = (x: Roles) => `${w.models[x.model].name} · ${[x.work_pattern, x.model === "integ" ? x.integration : null, x.published].filter(Boolean).join(" → ")}`;
  const setRoles = (next: Roles) => cambios.stage({ key: "roles", change: { kind: "roles", label: w.label.roles, ...next }, dest: "plania", from: say(orig), to: say(next) });

  // repo and folder
  const repo = (cambios.staged("repo") as { repo: string } | undefined)?.repo ?? r.settings.repo ?? "";
  // PLA-I70-11: a pasted repository is an option too, marked as pasted, so the select shows what is staged.
  const repos = [...new Set([...(r.settings.repo ? [r.settings.repo] : []), ...(repo ? [repo] : []), ...(g?.repos ?? (r.discovery?.github.ok === false ? (r.discovery.github.repos ?? []) : []))])];
  const setRepo = (next: string) => cambios.stage({ key: "repo", change: { kind: "repo", label: w.label.repo(next), repo: next }, dest: "plania", from: r.settings.repo ?? "—", to: next });
  const folder = (cambios.staged("folder") as { path: string } | undefined)?.path ?? r.settings.folder ?? "";
  const clones = [...new Set([...(mac?.folder?.clones ?? []), ...(mac?.folder?.matches ? [mac.folder.path] : [])])];
  const setFolder = (next: string) => cambios.stage({ key: "folder", change: { kind: "folder", label: w.label.folder(tidyPath(next)), path: next }, dest: "plania", from: tidyPath(r.settings.folder) || "—", to: tidyPath(next) });

  const opts = g ? roleOptions(g.branches) : [roles.published, ...(roles.integration ? [roles.integration] : [])];
  const names = g?.branches.map((b) => b.name) ?? [];
  const matches = matchesOf(roles.work_pattern, names);
  const priv = !!g && !g.rules.available;
  // PLA-I70-21: creating GitHub rules needs admin on the repo; without it the controls say so instead of failing on apply.
  const noAdmin = !!g && !g.repo.admin && !priv;

  const ruleOf = (b: string): BranchRule => (cambios.staged(`rule:${b}`) as { rule: BranchRule } | undefined)?.rule ?? c.rules[b] ?? { ...DEFAULT_RULE, on: !!g?.branches.find((x) => x.name === b)?.protected || !!g?.rules.list.some((x) => x.plania && x.branches.includes(b) && x.enforcement === "active") };
  const origRule = (b: string): BranchRule => c.rules[b] ?? { ...DEFAULT_RULE, on: !!g?.branches.find((x) => x.name === b)?.protected || !!g?.rules.list.some((x) => x.plania && x.branches.includes(b) && x.enforcement === "active") };
  const setRule = (b: string, next: BranchRule) =>
    cambios.stage({ key: `rule:${b}`, change: { kind: "ruleset", label: w.label.rule(b), branch: b, rule: next }, dest: priv ? "plania" : "github", from: w.ruleText(origRule(b)), to: w.ruleText(next) });

  const merge = (cambios.staged("merge") as typeof c.merge | undefined) ?? c.merge;
  const yn = (v: boolean) => (v ? w.yes : w.no);
  const mergeSay = (m: typeof c.merge) => `squash ${yn(m.squash)} · merge ${yn(m.promo_merge)} · ${w.delOnMerge.toLowerCase()} ${yn(m.delete_on_merge)}`;
  const mergeLines = (next: typeof c.merge) => (Object.keys(w.mergeLabels) as (keyof typeof c.merge)[]).filter((k) => next[k] !== c.merge[k]).map((k) => `${w.mergeLabels[k]}: ${yn(c.merge[k])} → ${yn(next[k])}`);
  const setMerge = (next: typeof c.merge) => cambios.stage({ key: "merge", change: { kind: "repo_merge", label: w.label.merge, ...next }, dest: "github", from: mergeSay(c.merge), to: mergeSay(next), lines: mergeLines(next) });

  // PLA-132: «Todavía no hay código», moved here from Ajustes.
  const noCode = (cambios.staged("no_code") as { none: boolean } | undefined)?.none ?? r.settings.no_code;
  const setNoCode = (none: boolean) => cambios.stage({ key: "no_code", change: { kind: "no_code", label: w.noCodeLabel, none }, dest: "plania", from: r.settings.no_code ? w.noCode : w.hasCode, to: none ? w.noCode : w.hasCode });

  // PLA-133: the working branch (settings.start_branch), moved here from Ajustes › Avanzado. The integration model
  // sets it from the roles change, so it is only typed here for the other models. Empty puts the default back.
  const startDefault = r.settings.start_default ?? "sandbox";
  const startStaged = cambios.staged("start_branch") as { branch: string | null } | undefined;
  const start = startStaged ? startStaged.branch : (r.settings.start_branch ?? null);
  const [startBad, setStartBad] = useState(false);
  const setStart = (raw: string) => {
    const next = raw.trim() || null;
    if (next && (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(next) || /\.\.|\/\/|\/$|\.$|\.lock$/.test(next) || ["main", "master", "production", "prod"].includes(next.toLowerCase()))) return setStartBad(true);
    setStartBad(false);
    if (next === (r.settings.start_branch ?? null)) return cambios.drop("start_branch");
    cambios.stage({ key: "start_branch", change: { kind: "start_branch", label: w.startLabel, branch: next }, dest: "plania", from: r.settings.start_branch ?? startDefault, to: next ?? startDefault });
  };

  const integBranch = g?.branches.find((b) => b.name === roles.integration);
  const roleBranches = [roles.published, ...(roles.model === "integ" && roles.integration ? [roles.integration] : [])];

  return (
    <Ed id="codigo" title={caminoWords().sections.codigo} lead={w.lead}>
      <Recom
        lines={[...(noAdmin ? [] : [ex.rule(roles.published)]), ex.merge]}
        done={(noAdmin || (ruleOf(roles.published).on && ruleOf(roles.published).pr && ruleOf(roles.published).nodel)) && merge.squash && merge.delete_on_merge}
        onUse={() => {
          if (!noAdmin) setRule(roles.published, { on: true, pr: true, nodel: true, agents: ruleOf(roles.published).agents });
          setMerge({ ...merge, squash: true, delete_on_merge: true });
        }}
      />
      <Tg on={noCode} title={w.noCode} sub={w.noCodeSub} onClick={() => setNoCode(!noCode)} data-control="sin-codigo" />
      {/* PLA-132: «Preparar el código» (folder, repository, working branch), moved here from Ajustes. */}
      {!noCode && <PrepararDeCamino slug={r.slug} />}
      {!noCode && (
      <div className="cam-grid2">
        <div className="cam-field">
          <label className="cam-lab" htmlFor="cam-repo">
            {w.repo} <i>{w.repoHint}</i>
          </label>
          {repos.length ? (
            <select id="cam-repo" className="cor-input" value={repo} onChange={(e) => setRepo(e.target.value)} data-campo="repo">
              {!repo && <option value="">{w.noRepoYet}</option>}
              {repos.map((x) => (
                <option key={x} value={x}>
                  {pasted.has(x) && !g?.repos.includes(x) ? `${x} (${w.repoPasted})` : x}
                </option>
              ))}
            </select>
          ) : (
            <p className="cam-hint">{w.noRepoYet}</p>
          )}
          <span className="cam-acts">
            <input className="cor-input cor-mono" value={paste} onChange={(e) => (setPaste(e.target.value), setPasteBad(null))} placeholder={w.repoPaste} aria-label={w.repoPaste} autoComplete="off" spellCheck={false} data-campo="repo-enlace" />
            <Btn
              kind="secondary"
              small
              disabled={!paste.trim() || looking}
              onClick={() => {
                const x = repoFromLink(paste);
                if (!x) return setPasteBad(w.repoBad);
                setLooking(true);
                void api
                  .caminoRepoCheck(r.slug, x)
                  .then((out) => {
                    if (!out.ok && out.reason !== "no_token") return setPasteBad(out.reason === "network" ? w.repoUnreachable : w.repoMissing);
                    const name = out.repo ?? x;
                    setPasted((s) => new Set(s).add(name));
                    setRepo(name);
                    setPaste("");
                  })
                  .catch(() => setPasteBad(w.repoUnreachable))
                  .finally(() => setLooking(false));
              }}
              data-control="usar-enlace"
            >
              {w.repoCheck}
            </Btn>
          </span>
          {looking && <span className="cam-hint" role="status">{w.repoChecking}</span>}
          {pasteBad && (
            <span className="cam-hint bad-t" role="alert">
              {pasteBad}
            </span>
          )}
          {g && <span className="cam-hint">{w.repoMeta(g.repo.private ? caminoWords().strip.private : caminoWords().strip.public, g.repo.default_branch, g.repo.admin)}</span>}
        </div>
        <div className="cam-field">
          <label className="cam-lab" htmlFor="cam-folder">
            {w.folder} <i>{w.folderHint}</i>
          </label>
          {clones.length ? (
            <select id="cam-folder" className="cor-input cor-mono" title={folder} value={folder} onChange={(e) => setFolder(e.target.value)} data-campo="carpeta">
              {!clones.includes(folder) && folder && <option value={folder}>{tidyPath(folder)}</option>}
              {clones.map((x) => (
                <option key={x} value={x} title={x}>
                  {tidyPath(x)}
                </option>
              ))}
            </select>
          ) : (
            <p className="cam-hint">{w.folderNone}</p>
          )}
          {mac?.folder && <span className={cls("cam-hint", mac.folder.matches ? "ok-t" : "warn-t")}>{mac.folder.matches ? w.folderOk : w.folderBad}</span>}
        </div>
      </div>
      )}

      <Experto id="codigo">
      <Blk cap={w.howPublish} hint={<Why text={w.models[roles.model].why} src={MODEL_SOURCES[roles.model]} label={w.why} srcLabel={w.source} />}>
        <div className="cam-grid3" role="group" aria-label={w.howPublish}>
          {(["trunk", "integ", "tags"] as PublishModel[]).map((m) => (
            <button
              key={m}
              type="button"
              className="cam-choice"
              aria-pressed={roles.model === m}
              onClick={() => setRoles({ ...roles, model: m, integration: m === "integ" ? (roles.integration ?? orig.integration ?? r.settings.release?.from ?? null) : roles.integration })}
              data-modelo={m}
            >
              <b>
                {w.models[m].name}
                {m === "trunk" && <span className="cam-bdg rec">{w.recommended}</span>}
                {orig.model === m && <span className="cam-bdg">{w.today}</span>}
              </b>
              <span>{w.models[m].sub}</span>
            </button>
          ))}
        </div>
        {roles.model === "integ" && integBranch && <div className="cam-box warn">{w.integCost(w.state(integBranch.ahead, integBranch.behind, g!.repo.default_branch), roles.integration ?? "")}</div>}
        {roles.model === "trunk" && orig.model !== "trunk" && <div className="cam-box info">{w.trunkMove(roles.published)}</div>}
        <div className="cam-grid3">
          <div className="cam-field">
            <label className="cam-lab" htmlFor="cam-pub">
              {w.published}
            </label>
            <select id="cam-pub" className="cor-input cor-mono" value={roles.published} onChange={(e) => setRoles({ ...roles, published: e.target.value })} data-campo="rama-publicada">
              {[...new Set([roles.published, ...opts])].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </div>
          <div className="cam-field">
            <label className="cam-lab" htmlFor="cam-integ">
              {w.integration}
            </label>
            <select id="cam-integ" className="cor-input cor-mono" value={roles.integration ?? ""} disabled={roles.model !== "integ"} onChange={(e) => setRoles({ ...roles, integration: e.target.value || null })} data-campo="rama-integracion">
              <option value="">{w.none}</option>
              {[...new Set([...(roles.integration ? [roles.integration] : []), ...opts])]
                .filter((b) => b !== roles.published)
                .map((b) => (
                  <option key={b}>{b}</option>
                ))}
            </select>
          </div>
          <div className="cam-field">
            <label className="cam-lab" htmlFor="cam-work">
              {w.work} <i>{w.workHint}</i>
            </label>
            <input id="cam-work" key={`work-${cambios.epoch}`} className="cor-input cor-mono" defaultValue={roles.work_pattern} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== roles.work_pattern && setRoles({ ...roles, work_pattern: e.target.value.trim() })} autoComplete="off" spellCheck={false} data-campo="patron" />
            <span className="cam-hint" data-coinciden={matches.length}>
              {w.matches(matches.length, matches.slice(0, 3).join(", "))}
            </span>
          </div>
        </div>
        <div className="cam-grid3">
          <div className="cam-field" data-rama-trabajo={roles.model === "integ" ? "integracion" : "propia"}>
            <label className="cam-lab" htmlFor="cam-start">
              {w.start} <i>{w.startHint}</i>
            </label>
            {roles.model === "integ" ? (
              <p className="cam-hint">{w.startInteg(roles.integration ?? "—")}</p>
            ) : (
              <>
                <input id="cam-start" key={`start-${cambios.epoch}`} className="cor-input cor-mono" defaultValue={start ?? ""} placeholder={startDefault} onBlur={(e) => setStart(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={startBad || undefined} data-campo="rama-trabajo" />
                <span className={cls("cam-hint", startBad && "bad-t")} role={startBad ? "alert" : undefined}>
                  {startBad ? w.startBad : w.startDefault(startDefault)}
                </span>
              </>
            )}
          </div>
        </div>
        {g && (
          <div className="cam-tw" tabIndex={0} role="region" aria-label={w.tableBranch}>
            <table className="cam-tbl">
              <thead>
                <tr>
                  <th scope="col">{w.tableBranch}</th>
                  <th scope="col">{w.tableWhat}</th>
                  <th scope="col">{w.tableState}</th>
                  <th scope="col">
                    <span className="sr-only">{w.deleteBranch}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.branches.map((b) => {
                  const k = kindOf(b.name, roles);
                  const del = !!cambios.staged(`del:${b.name}`);
                  return (
                    <tr key={b.name} data-rama={b.name}>
                      <td className="cor-mono">{b.name}</td>
                      <td>{w.kinds[k]}</td>
                      <td>
                        {w.state(b.ahead, b.behind, g.repo.default_branch)}
                        {b.protected && <span className="cam-chip ok">{w.protectedChip}</span>}
                        {del && <span className="cam-chip bad">{w.willDelete}</span>}
                      </td>
                      <td>
                        {k === "otra" && b.ahead === 0 && b.name !== g.repo.default_branch && (
                          <Btn
                            kind="quiet"
                            small
                            onClick={() => (del ? cambios.drop(`del:${b.name}`) : cambios.stage({ key: `del:${b.name}`, change: { kind: "delete_branch", label: w.label.deleteBranch(b.name), branch: b.name }, dest: "github", from: b.name, to: "—" }))}
                            aria-label={`${w.deleteBranch} ${b.name}`}
                          >
                            {del ? cw.discard : w.deleteBranch}
                          </Btn>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Blk>

      <Blk cap={w.rules} hint={priv ? w.rulesPlan : w.rulesFree}>
        <div className="cam-cards">
          {roleBranches.map((b) => {
            const rule = ruleOf(b);
            return (
              <div key={b} className="cam-card" data-regla={b}>
                <div className="cam-card-h">
                  <span className="cam-card-n">
                    <b className="cor-mono">{b}</b>
                    <span className="cam-chip dim">{w.roleOf(b, roles.published)}</span>
                  </span>
                  <span className={cls("cam-chip", priv ? "warn" : rule.on ? "ok" : "warn")}>{priv ? w.chipPlan : rule.on ? w.chipProtected : w.chipOpen}</span>
                </div>
                <Tg on={rule.on} title={w.ruleOn(b)} sub={priv ? w.ruleOnPlan : w.ruleOnSub} disabled={noAdmin} onClick={() => setRule(b, { ...rule, on: !rule.on })} data-control={`proteger-${b}`} />
                {noAdmin && <p className="cam-hint" data-sin-admin>{w.needAdmin}</p>}
                {/* PLA-I70-5: «solo por propuesta» and «no borrar» are GitHub's; where GitHub cannot hold them nobody can enforce them. */}
                {rule.on && priv && <p className="cam-hint" data-sin-github>{w.ruleNoEnforce}</p>}
                {rule.on && !priv && (
                  <>
                    <Tg on={rule.pr} title={w.rulePr} sub={w.rulePrSub} onClick={() => setRule(b, { ...rule, pr: !rule.pr })} />
                    <Tg on={rule.nodel} title={w.ruleNodel} sub={w.ruleNodelSub} onClick={() => setRule(b, { ...rule, nodel: !rule.nodel })} />
                    <Tg on={rule.agents} title={w.ruleAgents} sub={w.ruleAgentsSub} onClick={() => setRule(b, { ...rule, agents: !rule.agents })} />
                    <p className="cam-hint">{w.ruleChecksHint}</p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Blk>

      <Blk cap={w.merges}>
        <div className="cam-grid2">
          <Tg on={merge.squash} title={w.squash} sub={w.squashSub} onClick={() => setMerge({ ...merge, squash: !merge.squash })} data-control="squash" />
          {roles.model === "integ" && roles.integration && <Tg on={merge.promo_merge} title={w.promo(roles.integration, roles.published)} sub={w.promoSub} onClick={() => setMerge({ ...merge, promo_merge: !merge.promo_merge })} />}
          <Tg on={merge.delete_on_merge} title={w.delOnMerge} sub={w.delOnMergeSub} onClick={() => setMerge({ ...merge, delete_on_merge: !merge.delete_on_merge })} />
          <Tg on={merge.suggest_update} title={w.suggest} sub={w.suggestSub} onClick={() => setMerge({ ...merge, suggest_update: !merge.suggest_update })} />
        </div>
      </Blk>
      <p className="cam-hint">{w.agentsRead}</p>
      </Experto>
    </Ed>
  );
};
