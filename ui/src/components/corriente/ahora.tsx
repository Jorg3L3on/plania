// PLA-I62-3, PLA-I64-7: what is left of a project's Ahora tab once the list became the project's entry: the server's
// move as one button (MoveButton, the list's Te toca lever) and the words of «Arma el plan». Every call is /ceo's
// (components/corriente/acts.ts).
import { Link } from "react-router";
import type { Decision, OrgProject } from "@/lib/api";
import type { NowAction } from "@/lib/edificio";
import { acceptWords } from "@/lib/evidencia";
import type { CorrienteActs } from "./acts";
import { Btn } from "./parts";
import { words } from "@/lib/i18n";
import { AHORA_WORDS } from "@/lib/ahora-words";

// PLA-I2-10: the words are in @/lib/ahora-words; the export stays for pages/corriente.tsx.
export const PLAN_ASK: string = words(AHORA_WORDS).planAsk;

export type AhoraLinks = {
  entrega: (d: Decision) => string;
  /** A decision whose answer lives in Te toca (a question to reveal). */
  tetoca: (d: Decision | null) => string;
  paso: (key: string) => string;
  tablero: string;
  equipo: string;
  miembro: (agent: string) => string;
  publicar: string;
  pausar: string;
  pagina: string;
  /** The server's in-page links (#te-toca, #publicar). */
  hash: (href: string) => string;
};

/** The move's one button: what a click does is runOf's in the building, here with La corriente's calls. */
export const MoveButton = ({ p, a, d, primary, acts, links, onFijar }: { p: OrgProject; a: NowAction; d: Decision | null; primary: boolean; acts: CorrienteActs; links: AhoraLinks; onFijar: (p: OrgProject) => void }) => {
  const kind = primary ? "primary" : "secondary";
  const data = { "data-move-action": a.kind, "data-control": `ahora-${a.kind}` };
  if (a.kind === "link")
    return a.href.startsWith("#") ? (
      <Link className={`cor-btn ${kind}`} to={links.hash(a.href)} {...data}>
        {a.label}
      </Link>
    ) : (
      <a className={`cor-btn ${kind}`} href={a.href} {...data}>
        {a.label}
      </a>
    );
  if (a.kind === "reveal")
    return (
      <Link className={`cor-btn ${kind}`} to={links.tetoca(d)} {...data}>
        {a.label}
      </Link>
    );
  if (a.kind === "publish")
    return (
      <Link className={`cor-btn ${kind}`} to={links.publicar} {...data}>
        {a.label}
      </Link>
    );
  const busy = a.kind === "decision" ? acts.decisions.busy?.id === a.id : acts.busy === `${p.slug}:${a.kind}`;
  const accept = a.kind === "decision" && (a.action === "aceptar" || a.action === "fusionar") && d ? acceptWords(d).aria : undefined;
  const onClick = () => {
    if (a.kind === "decision") {
      if (!d) return;
      // A leg's plan goes with its suggested answers and its check list as they are.
      const plan = a.action === "empezar" && d.plan?.leg ? { answers: (d.plan.questions ?? []).map((q) => q.suggested), checklist: d.plan.checklist ?? [] } : {};
      acts.decisions.decide(d, { action: a.action, ...plan }, `now-${a.action}`);
    } else if (a.kind === "start") acts.start(p.slug, a.agent, "pastGuard" in a ? a.pastGuard : false, "key" in a ? (a.key ?? null) : null);
    else if (a.kind === "fijar") onFijar(p);
    else if (a.kind === "plan") acts.plan(p.slug, a.text);
  };
  return (
    <Btn kind={kind} onClick={onClick} disabled={busy} title={accept} aria-label={accept} {...data}>
      {busy ? "…" : accept ? words(AHORA_WORDS).accept : a.label}
    </Btn>
  );
};
