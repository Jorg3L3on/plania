// PLA-I68-3: «Código y ramas». Repo picked from the account's repos (or a pasted link, checked by GitHub when applied),
// folder picked from this Mac's clones of that repo, the three ways to publish with their reason and source, branch
// roles picked from the real branches, a work-branch pattern with its live matches, the branches with their role and
// state, GitHub's rules per role branch in plain words, and how PRs merge. Every edit goes to the change set.
import { useState } from "react";
import { codigoWords, kindOf, matchesOf, MODEL_SOURCES, repoFromLink, roleOptions } from "@/lib/camino-codigo";
import { cambiosWords } from "@/lib/camino-cambios";
import { caminoWords } from "@/lib/camino";
import type { BranchRule, CaminoRead, PublishModel } from "@/lib/camino-types";
import { Btn } from "./parts";
import { Blk, Ed } from "./camino";
import { Tg } from "./camino-cambios";
import type { Cambios } from "./camino-store";

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
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const mac = r.discovery?.mac;
  const c = r.config;
  const [paste, setPaste] = useState("");
  const [pasteBad, setPasteBad] = useState(false);

  const orig: Roles = { model: c.model, published: c.branches.published, integration: c.branches.integration, work_pattern: c.branches.work_pattern };
  const roles = (cambios.staged("roles") as Roles | undefined) ?? orig;
  const say = (x: Roles) => `${w.models[x.model].name} · ${[x.work_pattern, x.model === "integ" ? x.integration : null, x.published].filter(Boolean).join(" → ")}`;
  const setRoles = (next: Roles) => cambios.stage({ key: "roles", change: { kind: "roles", label: w.label.roles, ...next }, dest: "plania", from: say(orig), to: say(next) });

  // repo and folder
  const repo = (cambios.staged("repo") as { repo: string } | undefined)?.repo ?? r.settings.repo ?? "";
  const repos = [...new Set([...(r.settings.repo ? [r.settings.repo] : []), ...(g?.repos ?? (r.discovery?.github.ok === false ? (r.discovery.github.repos ?? []) : []))])];
  const setRepo = (next: string) => cambios.stage({ key: "repo", change: { kind: "repo", label: w.label.repo(next), repo: next }, dest: "plania", from: r.settings.repo ?? "—", to: next });
  const folder = (cambios.staged("folder") as { path: string } | undefined)?.path ?? r.settings.folder ?? "";
  const clones = [...new Set([...(mac?.folder?.clones ?? []), ...(mac?.folder?.matches ? [mac.folder.path] : [])])];
  const setFolder = (next: string) => cambios.stage({ key: "folder", change: { kind: "folder", label: w.label.folder(next), path: next }, dest: "plania", from: r.settings.folder ?? "—", to: next });

  const opts = g ? roleOptions(g.branches) : [roles.published, ...(roles.integration ? [roles.integration] : [])];
  const names = g?.branches.map((b) => b.name) ?? [];
  const matches = matchesOf(roles.work_pattern, names);
  const priv = !!g && !g.rules.available;

  const ruleOf = (b: string): BranchRule => (cambios.staged(`rule:${b}`) as { rule: BranchRule } | undefined)?.rule ?? c.rules[b] ?? { ...DEFAULT_RULE, on: !!g?.branches.find((x) => x.name === b)?.protected || !!g?.rules.list.some((x) => x.plania && x.branches.includes(b) && x.enforcement === "active") };
  const origRule = (b: string): BranchRule => c.rules[b] ?? { ...DEFAULT_RULE, on: !!g?.branches.find((x) => x.name === b)?.protected || !!g?.rules.list.some((x) => x.plania && x.branches.includes(b) && x.enforcement === "active") };
  const setRule = (b: string, next: BranchRule) =>
    cambios.stage({ key: `rule:${b}`, change: { kind: "ruleset", label: w.label.rule(b), branch: b, rule: next }, dest: priv ? "plania" : "github", from: w.ruleText(origRule(b)), to: w.ruleText(next) });

  const merge = (cambios.staged("merge") as typeof c.merge | undefined) ?? c.merge;
  const yn = (v: boolean) => (v ? w.yes : w.no);
  const mergeSay = (m: typeof c.merge) => `squash ${yn(m.squash)} · merge ${yn(m.promo_merge)} · ${w.delOnMerge.toLowerCase()} ${yn(m.delete_on_merge)}`;
  const setMerge = (next: typeof c.merge) => cambios.stage({ key: "merge", change: { kind: "repo_merge", label: w.label.merge, ...next }, dest: "github", from: mergeSay(c.merge), to: mergeSay(next) });

  const integBranch = g?.branches.find((b) => b.name === roles.integration);
  const roleBranches = [roles.published, ...(roles.model === "integ" && roles.integration ? [roles.integration] : [])];

  return (
    <Ed id="codigo" title={caminoWords().sections.codigo} lead={w.lead}>
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
                  {x}
                </option>
              ))}
            </select>
          ) : (
            <p className="cam-hint">{w.noRepoYet}</p>
          )}
          <span className="cam-acts">
            <input className="cor-input cor-mono" value={paste} onChange={(e) => (setPaste(e.target.value), setPasteBad(false))} placeholder={w.repoPaste} aria-label={w.repoPaste} autoComplete="off" spellCheck={false} data-campo="repo-enlace" />
            <Btn
              kind="secondary"
              small
              disabled={!paste.trim()}
              onClick={() => {
                const x = repoFromLink(paste);
                if (!x) return setPasteBad(true);
                setRepo(x);
                setPaste("");
              }}
              data-control="usar-enlace"
            >
              {w.repoCheck}
            </Btn>
          </span>
          {pasteBad && (
            <span className="cam-hint bad-t" role="alert">
              {w.repoBad}
            </span>
          )}
          {g && <span className="cam-hint">{w.repoMeta(g.repo.private ? caminoWords().strip.private : caminoWords().strip.public, g.repo.default_branch, g.repo.admin)}</span>}
        </div>
        <div className="cam-field">
          <label className="cam-lab" htmlFor="cam-folder">
            {w.folder} <i>{w.folderHint}</i>
          </label>
          {clones.length ? (
            <select id="cam-folder" className="cor-input cor-mono" value={folder} onChange={(e) => setFolder(e.target.value)} data-campo="carpeta">
              {!clones.includes(folder) && folder && <option value={folder}>{folder}</option>}
              {clones.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          ) : (
            <p className="cam-hint">{w.folderNone}</p>
          )}
          {mac?.folder && <span className={cls("cam-hint", mac.folder.matches ? "ok-t" : "warn-t")}>{mac.folder.matches ? w.folderOk : w.folderBad}</span>}
        </div>
      </div>

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
            <input id="cam-work" className="cor-input cor-mono" defaultValue={roles.work_pattern} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== roles.work_pattern && setRoles({ ...roles, work_pattern: e.target.value.trim() })} autoComplete="off" spellCheck={false} data-campo="patron" />
            <span className="cam-hint" data-coinciden={matches.length}>
              {w.matches(matches.length, matches.slice(0, 3).join(", "))}
            </span>
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
                <Tg on={rule.on} title={w.ruleOn(b)} sub={priv ? w.ruleOnPlan : w.ruleOnSub} onClick={() => setRule(b, { ...rule, on: !rule.on })} data-control={`proteger-${b}`} />
                {rule.on && (
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
    </Ed>
  );
};
