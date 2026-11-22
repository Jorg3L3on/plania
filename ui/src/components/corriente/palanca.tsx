// PLA-I64-4: the lever on a row of the project's list. Each one is today's call (components/corriente/acts.ts and
// Ahora's MoveButton), never a new write: Te toca: the server's move, Constrúyelo, Despertar, Ver las entregas,
// Ver antes y después with Pedir ajuste, Cerrar iniciativa, Reenviar al PO and Cerrar pedido, Publicar. Se mueve:
// Detener. En fila: Hacer primero. Quieto: Pasar a Lista. One white button per screen: the first Te toca row's.
// A refusal shows under the button, in the row.
import { useState } from "react";
import { Link } from "react-router";
import type { Decision, OrgProject } from "@/lib/api";
import type { Cosa, Palanca as PalancaT } from "@/lib/cosas";
import { PALANCA } from "@/lib/corriente-parts-words";
import { words } from "@/lib/i18n";
import type { CorrienteActs } from "./acts";
import { Ajuste } from "./ajuste";
import { MoveButton, type AhoraLinks } from "./ahora";
import { Btn } from "./parts";
import { linkTo } from "@/lib/corriente";

export type PalancaLinks = {
  entrega: (id: string) => string;
  tetoca: (id: string) => string;
  idea: (key: string) => string;
  publicar: string;
  ahora: AhoraLinks;
};

/** The call key a lever's busy state and refusal live under (acts.busy / acts.failed). */
export function busyKey(slug: string, a: PalancaT): string | null {
  switch (a.kind) {
    case "construir":
      return `pedido-${a.key}:construir`;
    case "despertar":
      return `pedido-${a.key}:despertar`;
    case "cerrar":
      return `cerrar-${a.key}`;
    case "reenviar":
      return `${slug}:request`;
    case "detener":
      return `stop-${a.run}`;
    case "primero":
      return a.key ? `next-${a.key}` : `aplazar-${a.aplazar.key}`;
    case "lista":
      return `lista-${a.key}`;
    case "jugada":
      return a.action.kind === "decision" ? null : `${slug}:${a.action.kind}`;
    default:
      return null;
  }
}

/** PLA-62: the levers a ficha or a step's view does not offer by itself; opening the thing carries them over. */
export const CARRIED: ReadonlySet<PalancaT["kind"]> = new Set(["lista", "primero", "detener", "reenviar"]);

export const Palanca = ({ p, c, primary, acts, decisions, links, onFijar }: { p: OrgProject; c: Cosa; primary: boolean; acts: CorrienteActs; decisions: Decision[]; links: PalancaLinks; onFijar: (p: OrgProject) => void }) => {
  const [ajuste, setAjuste] = useState(false);
  const w = words(PALANCA);
  const a = c.palanca;
  if (!a) return null;
  const kind = primary ? "primary" : "secondary";
  const key = busyKey(p.slug, a);
  const busy = !!key && acts.busy === key;
  const decisionId = a.kind === "jugada" ? a.decision : a.kind === "decision" ? a.id : a.kind === "entregas" && a.ids.length === 1 ? a.ids[0]! : null;
  const d = decisionId ? (decisions.find((x) => x.id === decisionId) ?? null) : null;
  const error = (key && acts.failed[key]) || (a.kind === "primero" && acts.failed[`aplazar-${a.aplazar.key}`]) || (d && acts.decisions.errors[d.id]) || null;
  const data = (name: string) => ({ "data-control": name, "data-palanca": a.kind });
  const btn = (label: string, onClick: () => void, name: string, busyWord = "…", k: "primary" | "secondary" | "quiet" = kind) => (
    <Btn kind={k} onClick={onClick} disabled={busy} {...data(name)} aria-label={`${label}: ${c.title}`}>
      {busy ? busyWord : label}
    </Btn>
  );
  const link = (label: string, to: string, name: string, k: "primary" | "secondary" | "quiet" = kind) => (
    <Link className={`cor-btn ${k}`} to={to} {...data(name)} aria-label={`${label}: ${c.title}`}>
      {label}
    </Link>
  );
  const delivery = !!d && (d.kind === "deliverable" || d.kind === "pr");
  const body = (() => {
    switch (a.kind) {
      case "jugada":
        return (
          <>
            <MoveButton p={p} a={a.action} d={d} primary={primary} acts={acts} links={links.ahora} onFijar={onFijar} />
            {delivery && d && link(w.see, links.entrega(d.id), "ver-entrega", "quiet")}
          </>
        );
      case "entregas":
        if (a.ids.length > 1) return link(w.seeDeliveries, links.entrega(a.ids[0]!), "ver-entregas");
        return (
          <>
            {/* Beside Pedir ajuste the short word keeps «qué toca» readable; the label says it whole. */}
            <Link className={`cor-btn ${kind}`} to={links.entrega(a.ids[0]!)} {...data("ver-entrega")} aria-label={`${w.beforeAfter}: ${c.title}`}>
              {d?.actions.includes("cambios") ? w.see : w.beforeAfter}
            </Link>
            {d?.actions.includes("cambios") && (
              <Btn kind="quiet" aria-expanded={ajuste} onClick={() => setAjuste((x) => !x)} data-control="pedir-ajuste">
                {w.askTweak}
              </Btn>
            )}
          </>
        );
      case "decision":
        return link(d ? (w.decision[d.kind] ?? a.label) : a.label, links.tetoca(a.id), "decidir");
      case "responder":
        return link(w.answer, links.idea(a.key), "responder");
      case "construir":
        return btn(w.build, () => acts.pedido(p.slug, a.key, "construir"), "construyelo");
      case "despertar":
        return btn(w.wake, () => acts.despertar(p.slug, a.key), "despertar", w.waking);
      case "cerrar":
        return a.version == null ? null : btn(w.closeInitiative, () => acts.cerrar(p.slug, a.key, a.version!), "cerrar-iniciativa", w.closing);
      case "reenviar":
        return (
          <>
            {btn(w.resend, () => acts.resend(p.slug, a.key), "reenviar")}
            <Btn kind="quiet" onClick={() => acts.closeRequest(p.slug, a.key)} disabled={busy} data-control="cerrar-pedido" data-palanca="cerrar-pedido" aria-label={`${w.closeRequest}: ${c.title}`}>
              {w.closeRequest}
            </Btn>
          </>
        );
      case "publicar":
        return link(w.publish, links.publicar, "publicar");
      case "camino":
        // PLA-132: who migrates production is set in Despliegue.
        return link(a.label, linkTo({ slug: p.slug, tab: "camino", ...(a.sec === "resumen" ? {} : { ver: { kind: "camino", sec: a.sec } }) }), "ir-despliegue");
      case "detener":
        return btn(w.stop, () => acts.stopRun(a.run), "detener", w.stopping, "secondary");
      case "primero": {
        // PLA-63: En fila can hold many rows; their «Hacer primero» stays quiet (no border) so the list is not a wall of buttons.
        // PLA-161: Aplazar beside it, quiet too, with its own busy state.
        const later = acts.busy === `aplazar-${a.aplazar.key}`;
        return (
          <>
            {a.key && btn(w.first, () => acts.pickNext(p.slug, a.key!), "hacer-primero", "…", "quiet")}
            <Btn kind="quiet" onClick={() => acts.aplazar(p.slug, a.aplazar.key, a.aplazar.to)} disabled={busy || later} data-control="aplazar" data-palanca="aplazar" aria-label={`${w.postpone}: ${c.title}`}>
              {later ? "…" : w.postpone}
            </Btn>
          </>
        );
      }
      case "lista":
        return btn(w.toReady, () => acts.aLista(p.slug, a.key), "pasar-a-lista", w.moving, "secondary");
    }
  })();
  if (!body) return null;
  return (
    <div className="cor-palanca" data-palanca-de={c.key}>
      <div className="cor-palanca-btns">{body}</div>
      {ajuste && d && <Ajuste d={d} acts={acts} onDone={() => setAjuste(false)} />}
      {error && (
        <p className="cor-state bad" role="alert" data-row-error>
          {error}
        </p>
      )}
    </div>
  );
};
