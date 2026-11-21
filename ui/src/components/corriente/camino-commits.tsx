// PLA-I68-4: «Commits y propuestas». The project's real style mix (its last 200 non-merge commits), the conventions
// with a line in each built from the project's own last subject, the settings, a live preview, the exact text the
// agents receive and how it is enforced. Every edit is one staged change (Plania's record); the CI option adds a
// workflow file to the set, as a PR, the only way anything reaches the repo.
import { useState } from "react";
import { ALL_TYPES, followShare, historyMix, instructions, preview, prTitleWorkflow, sampleOf, STYLE_KEYS, subjectOf } from "@/lib/camino-commits";
import { commitsPageWords } from "@/lib/camino-commits-words";
import { baseBranch, caminoWords } from "@/lib/camino";
import { codigoWords } from "@/lib/camino-codigo";
import type { CaminoRead, CommitSettings, ConventionId } from "@/lib/camino-types";
import { Blk, Ed, Experto, Recom } from "./camino";
import { Tg } from "./camino-cambios";
import { Why } from "./camino-codigo";
import type { Cambios } from "./camino-store";

const CONVENTIONS: ConventionId[] = ["conventional", "area", "ticket", "gitmoji", "classic", "kernel", "custom"];
const LADDER = ["instr", "revisa", "ci", "hook", "server"] as const;
const PR_TITLE_FILE = ".github/workflows/pr-title.yml";

const validRegex = (s: string | null | undefined) => {
  if (!s?.trim()) return false;
  try {
    new RegExp(s);
    return true;
  } catch {
    return false;
  }
};

export const Commits = ({ r, cambios }: { r: CaminoRead; cambios: Cambios }) => {
  const w = commitsPageWords();
  const g = r.discovery?.github.ok ? r.discovery.github : null;
  const folders = r.discovery?.mac.folders ?? [];
  const mix = historyMix((g?.commits ?? []).map((c) => c.message));
  const stored = r.config.commits;
  const orig: CommitSettings = { ...stored, lang: stored.convention ? stored.lang : mix.lang };
  const st = (cambios.staged("commits") as { patch: { commits: CommitSettings } } | undefined)?.patch.commits ?? orig;
  const sample = sampleOf((g?.commits ?? []).map((c) => subjectOf(c.message)), folders, `${r.slug.slice(0, 3).toUpperCase()}-12`);
  const say = (x: CommitSettings) => w.say(x.convention ? w.conventions[x.convention].name : w.none, w.ladder[x.enforce]!.t);
  const set = (patch: Partial<CommitSettings>) => {
    const next = { ...st, ...patch };
    cambios.stage({ key: "commits", change: { kind: "config", label: w.label, patch: { commits: next } }, dest: "plania", from: say(orig), to: say(next) });
    // The CI option adds the workflow as a PR; leaving it (or changing the convention) takes the PR out of the set.
    const yml = next.enforce === "ci" && next.convention ? prTitleWorkflow(next.convention, next) : null;
    const existing = g?.workflow_files.find((f) => f.path === PR_TITLE_FILE)?.text ?? "";
    if (yml && yml !== existing) {
      const base = baseBranch(r);
      cambios.stage({
        key: `file:${PR_TITLE_FILE}`,
        change: { kind: "file_pr", label: w.ciLabel, path: PR_TITLE_FILE, content: yml, base, title: w.ciTitle(next.convention), body: w.ciBody },
        dest: "pr",
        from: existing ? "—" : "",
        to: PR_TITLE_FILE,
        diff: { path: PR_TITLE_FILE, before: existing, after: yml },
      });
    } else cambios.drop(`file:${PR_TITLE_FILE}`);
  };
  const conv = st.convention;
  const ex = caminoWords().expert.commits;
  // The recommendation: what the project already writes most, else Conventional Commits.
  const proposed = mix.propose ?? "conventional";
  const follow = conv ? followShare(mix, conv) : null;
  const [customText, setCustomText] = useState(st.custom_regex ?? "");
  const bars: [string, number][] = STYLE_KEYS.map((k) => [w.styles[k], mix.share[k]]);
  return (
    <Ed id="commits" title={caminoWords().sections.commits} lead={w.lead}>
      <Recom
        lines={[ex.conv(w.conventions[proposed].name), ex.ai]}
        done={conv === proposed && !st.ai}
        onUse={() => set({ convention: proposed, ai: false })}
      />
      <Experto id="commits">
      <Blk cap={w.history} hint={g ? w.historyHint(mix.n, g.repo.full_name) : undefined} data-mezcla={mix.dominant ?? ""}>
        {mix.n === 0 ? (
          <p className="cam-hint">{w.noHistory}</p>
        ) : (
          <>
            <div className="cam-bars">
              {bars.map(([label, pct]) => (
                <div key={label} className="cam-bar">
                  <span>{label}</span>
                  <span className="cam-bar-tr" aria-hidden>
                    <span className="cam-bar-fl" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="cor-mono">{pct} %</span>
                </div>
              ))}
            </div>
            <p className="cam-hint">
              {mix.recentDominant && w.recent(mix.recent.n, mix.recent.share[mix.recentDominant], w.styles[mix.recentDominant])}{" "}
              {mix.recentDominant && mix.dominant && mix.recentDominant !== mix.dominant && w.shift(w.styles[mix.recentDominant])} {w.meta(mix.lang, mix.median, mix.ai, mix.n)}
            </p>
          </>
        )}
      </Blk>

      <Blk cap={w.convention} hint={<Why text={w.whyConv} src="https://www.conventionalcommits.org/en/v1.0.0/" label={codigoWords().why} srcLabel={codigoWords().source} />}>
        <div className="cam-grid3" role="group" aria-label={w.convention}>
          {CONVENTIONS.map((k) => (
            <button key={k} type="button" className="cam-choice" aria-pressed={conv === k} onClick={() => set({ convention: k })} data-convencion={k}>
              <b>
                {w.conventions[k].name}
                {k === "conventional" && <span className="cam-bdg rec">{w.recommended}</span>}
                {mix.propose === k && <span className="cam-bdg">{w.proposed}</span>}
                {stored.convention === k && <span className="cam-bdg">{w.today}</span>}
              </b>
              <span>{w.conventions[k].note}</span>
              {k !== "custom" && <span className="cam-ex">{subjectOf(preview(k, st, sample))}</span>}
            </button>
          ))}
        </div>
        {conv ? (
          <p className="cam-line">
            {follow !== null && <span className={follow >= 60 ? "ok-t" : "warn-t"}>{w.follow(follow)}</span>} <span className="cam-hint">{w.noRewrite}</span>
          </p>
        ) : (
          <p className="cam-hint">{w.pickOne}</p>
        )}
      </Blk>

      {conv && (
        <>
          <Blk cap={w.yours}>
            {conv === "custom" && (
              <label className="cam-field">
                <span className="cam-lab">{w.custom}</span>
                <input
                  className="cor-input cor-mono"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  onBlur={() => validRegex(customText) && set({ custom_regex: customText })}
                  autoComplete="off"
                  spellCheck={false}
                  data-campo="regex"
                />
                {customText && !validRegex(customText) && <span className="cam-hint bad-t">{w.customBad}</span>}
              </label>
            )}
            {conv === "conventional" && (
              <>
                <div className="cam-field">
                  <span className="cam-lab">
                    {w.types} <i>{w.typesHint}</i>
                  </span>
                  <div className="cam-chips" role="group" aria-label={w.types}>
                    {ALL_TYPES.map((t) => (
                      <button key={t} type="button" className="cam-pill" aria-pressed={st.types.includes(t)} onClick={() => set({ types: st.types.includes(t) ? st.types.filter((x) => x !== t) : [...st.types, t] })} data-tipo={t}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="cam-field">
                  <span className="cam-lab">
                    {w.scope} <i>{w.scopeHint(folders.slice(0, 6).join(", "))}</i>
                  </span>
                  <div className="cam-chips" role="group" aria-label={w.scope}>
                    {(["no", "opcional", "obligatorio"] as const).map((v) => (
                      <button key={v} type="button" className="cam-pill" aria-pressed={st.scope === v} onClick={() => set({ scope: v })}>
                        {w.scopes[v]}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <div className="cam-grid3">
              <label className="cam-field">
                <span className="cam-lab">{w.max}</span>
                <select className="cor-input" value={st.max} onChange={(e) => set({ max: Number(e.target.value) })} data-campo="max">
                  {[50, 72, 100].map((n) => (
                    <option key={n} value={n}>
                      {w.maxOpt(n)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cam-field">
                <span className="cam-lab">{w.lang}</span>
                <select className="cor-input" value={st.lang} onChange={(e) => set({ lang: e.target.value as "es" | "en" })} data-campo="idioma">
                  {(["es", "en"] as const).map((v) => (
                    <option key={v} value={v}>
                      {w.langs[v]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cam-field">
                <span className="cam-lab">{w.ticket}</span>
                <select className="cor-input" value={st.ticket} onChange={(e) => set({ ticket: e.target.value as CommitSettings["ticket"] })} data-campo="clave">
                  {(["trailer", "prefijo", "final", "no"] as const).map((v) => (
                    <option key={v} value={v}>
                      {w.tickets[v]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="cam-grid2">
              <Tg on={st.emoji} title={w.emoji} sub={w.emojiSub} onClick={() => set({ emoji: !st.emoji })} />
              <Tg on={st.ai} title={w.ai} sub={w.aiSub} onClick={() => set({ ai: !st.ai })} data-control="marcar-ayuda" />
              <Tg on={st.body} title={w.body} sub={w.bodySub} onClick={() => set({ body: !st.body })} />
              <Tg on={st.pr_title} title={w.prTitle} sub={w.prTitleSub} onClick={() => set({ pr_title: !st.pr_title })} />
            </div>
            <div className="cam-grid2">
              <div className="cam-field">
                <span className="cam-lab">{w.preview}</span>
                {/* PLA-I70-44: a sample made for another shape would fail the owner's own pattern; for «Propio» none is shown. */}
                {conv === "custom" ? (
                  <p className="cam-hint" data-vista-previa="propio">
                    {w.previewCustom}
                  </p>
                ) : (
                  <pre className="cam-preview" data-vista-previa>
                    {preview(conv, st, sample)}
                  </pre>
                )}
              </div>
              <label className="cam-field">
                <span className="cam-lab">
                  {w.examples} <i>{w.examplesHint}</i>
                </span>
                <textarea key={`ex-${cambios.epoch}`} className="cor-input cor-mono cam-ta" defaultValue={st.examples} onBlur={(e) => e.target.value !== st.examples && set({ examples: e.target.value })} data-campo="ejemplos" />
              </label>
            </div>
          </Blk>
          <Blk cap={w.agents} hint={w.agentsHint}>
            <pre className="cam-instr" tabIndex={0} data-instrucciones>
              {instructions(st, folders)}
            </pre>
          </Blk>
          <Blk cap={w.enforce}>
            <div className="cam-ladder" role="group" aria-label={w.enforce}>
              {LADDER.map((v) => (
                <button key={v} type="button" className="cam-choice" aria-pressed={st.enforce === v} disabled={v === "server"} onClick={() => v !== "server" && set({ enforce: v })} data-cumplir={v}>
                  <b>
                    {w.ladder[v]!.t}
                    {v === "revisa" && <span className="cam-bdg rec">{w.recommended}</span>}
                    {v === "server" && <span className="cam-bdg paid">{w.paid}</span>}
                  </b>
                  <span>{w.ladder[v]!.s}</span>
                </button>
              ))}
            </div>
          </Blk>
        </>
      )}
      </Experto>
    </Ed>
  );
};
