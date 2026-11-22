// PLA-I62-4: Te toca (board A2), the page that replaces the building's Oficina (the owner's decision). Everything the
// company cannot continue without him, from every project, resolved here one at a time: the first card open with its
// one white button, the rest one line each with Abrir. Beside it the Morning brief's lines and the answers to his
// questions (Preguntar). A card he answered stays in place saying what was done.
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router";
import { BRIEF_LINK_LABEL, briefTitle } from "@/components/compania/parts";
import { api, type ConsultaView, type Decision, type OrgCompany } from "@/lib/api";
import { pending } from "@/lib/v2";
import { grupoName } from "@/lib/cosas";
import { getLanguage, words, type Language } from "@/lib/i18n";
import { TETOCA_WORDS } from "@/lib/tetoca-words";
import { redactSecrets } from "@/lib/redact";
import type { CorrienteActs } from "./acts";
import { Label } from "./parts";
import { Pendiente, PendienteRow, type PendLinks } from "./pendiente";

export function tocaHeadline(list: Decision[], language: Language = getLanguage()): string {
  const w = words(TETOCA_WORDS, language);
  const n = (k: number) => (k <= 10 ? w.numbers[k]! : String(k));
  const k = list.length;
  if (!k) return w.nothing;
  const deliveries = list.filter((d) => d.kind === "deliverable" || d.kind === "pr").length;
  if (deliveries === k) return k === 1 ? w.oneDelivery : w.deliveries(n(k));
  return k === 1 ? w.oneThing : w.things(n(k));
}

/** What is absent, said once at the foot: «Sin preguntas, planes por aprobar ni pasos tuyos pendientes.» */
export function absentLine(list: Decision[], language: Language = getLanguage()): string | null {
  const w = words(TETOCA_WORDS, language);
  const has = (...k: Decision["kind"][]) => list.some((d) => k.includes(d.kind));
  const missing = [!has("question", "proposal") && w.questions, !has("plan") && w.plans, !has("action", "step") && w.steps].filter((x): x is string => !!x);
  if (!missing.length || !list.length) return null;
  const last = missing.pop()!;
  return w.absent(missing, last);
}

export const TeToca = ({
  company,
  decisions,
  focus,
  now,
  timeZone,
  acts,
  links,
  onFocus,
  askTo,
}: {
  company: OrgCompany;
  decisions: Decision[];
  focus: string | null;
  now: number;
  timeZone: string;
  acts: CorrienteActs;
  links: PendLinks & { consulta: (slug: string, id: string) => string };
  onFocus: (id: string) => void;
  askTo: string;
}) => {
  const open = decisions.filter(pending);
  // The one he just answered stays open in place; then the next one.
  const focused = decisions.find((d) => d.id === focus) ?? open[0] ?? null;
  const rest = open.filter((d) => d.id !== focused?.id);
  const proj = (d: Decision) => company.projects.find((p) => p.slug === d.project) ?? null;
  const live = company.projects.filter((p) => !p.paused);
  // Answers to his questions (Preguntar), newest first, from every live project.
  const reads = useQueries({ queries: live.map((p) => ({ queryKey: ["consultas", p.slug], queryFn: () => api.consultas(p.slug), staleTime: 30_000 })) });
  const answers = live
    .flatMap((p, i) => (reads[i]?.data?.consultas ?? []).filter((c: ConsultaView) => c.answer).map((c) => ({ p, c })))
    .sort((a, b) => (b.c.answered_at ?? "").localeCompare(a.c.answered_at ?? ""))
    .slice(0, 3);
  const absent = absentLine(open);
  const w = words(TETOCA_WORDS);
  return (
    <div className="cor-tetoca" data-tetoca={open.length}>
      <section className="cor-tetoca-main" aria-label={w.mainAria}>
        <div>
          <Label tone={open.length ? "amber" : undefined}>{`${grupoName("toca")} · ${open.length}`}</Label>
          <h1 data-toca-headline>{tocaHeadline(open)}</h1>
          <p className="cor-text">{w.intro}</p>
        </div>
        {focused ? (
          <Pendiente key={focused.id} d={focused} p={proj(focused)} acts={acts} links={links} big />
        ) : (
          <div className="cor-card cor-empty" data-toca-empty>
            <p className="cor-h3">{w.nothing}</p>
            <p className="cor-text">{w.emptyHint}</p>
          </div>
        )}
        {rest.length > 0 && (
          <section aria-label={w.later} className="cor-sec" data-despues={rest.length}>
            <Label as="h2">{w.later}</Label>
            {rest.slice(0, 3).map((d) => (
              <PendienteRow key={d.id} d={d} p={proj(d)} onOpen={() => onFocus(d.id)} />
            ))}
            {rest.length > 3 && <p className="cor-cap">{w.more(rest.length - 3)}</p>}
          </section>
        )}
        {absent && (
          <p className="cor-tetoca-foot" data-absent>
            {absent}
          </p>
        )}
      </section>
      <aside className="cor-tetoca-side">
        {company.brief && (
          <section aria-label="Brief" data-brief>
            <div className="cor-side-head">
              <Label as="h2">{briefTitle(company.brief.generated_at, now, timeZone)}</Label>
              <span className="cor-cap">ASISTENTE</span>
            </div>
            <ul className="cor-brief">
              {company.brief.lines.slice(0, 4).map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
            <Link className="cor-btn link" to={company.brief.link}>
              {BRIEF_LINK_LABEL}
            </Link>
          </section>
        )}
        <section aria-label={w.answers} data-respuestas={answers.length}>
          <Label as="h2">{w.answers}</Label>
          {answers.length ? (
            <ul className="cor-brief">
              {answers.map(({ p, c }) => (
                <li key={c.id}>
                  <Link to={links.consulta(p.slug, c.id)} className="cor-qa" style={{ border: 0, padding: 0 }}>
                    <span className="cor-cap">{p.title}</span>
                    {/* PLA-158 (F-11): his old question shown again: a password or key he typed in it is covered. */}
                    <span>{redactSecrets(c.text)}</span>
                    <span className="cor-muted">{redactSecrets(c.answer!.short)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cor-text" style={{ padding: "10px 0" }}>
              {w.noAnswers}
            </p>
          )}
          <Link className="cor-btn link" to={askTo} data-control="hacer-pregunta">
            {w.ask}
          </Link>
        </section>
      </aside>
    </div>
  );
};
