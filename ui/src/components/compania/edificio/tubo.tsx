// PLA-I54-1 (Pedidos con recorrido): el tubo. A row on the floor between the stage board and the Pedir bar, on the
// board's own grid (150 px label + six columns), so its six stops sit under the six stations: Buzón, Entendido,
// Investigación, Diseño, Plan, Lista. A capsule per idea the owner asked to shape (the server's pedidos), coloured by
// its state; a valve at the end that only «Constrúyelo» opens (the idea then becomes a track on the board). With no
// capsule it folds to one line, giving the board its height back. Guardadas (PLA-I54-3) are counted on the label.
import type { CSSProperties } from "react";
import type { OrgPedido, PedidoState, PedidoStop } from "@/lib/api";
import { roleName } from "@/lib/org";

export const STOPS: { id: PedidoStop; name: string; line: string }[] = [
  { id: "buzon", name: "Buzón", line: "nadie la ha abierto" },
  { id: "entendido", name: "Entendido", line: "el PO dice qué entendió" },
  { id: "investigacion", name: "Investigación", line: "Research" },
  { id: "diseno", name: "Diseño", line: "Artist" },
  { id: "plan", name: "Plan", line: "PO: pasos y tamaño" },
  { id: "lista", name: "Lista", line: "espera tu «Constrúyelo»" },
];
export const stopName = (s: PedidoStop) => STOPS.find((x) => x.id === s)?.name ?? s;

export const PEDIDO_TONE: Record<PedidoState, string> = {
  espera: "var(--status-jorge)",
  trabajando: "var(--status-now)",
  quieta: "var(--status-ready)",
  cola: "var(--status-idle)",
  valvula: "var(--status-review)",
};

// The capsule's first line: what it waits on, in the owner's words.
export function pedidoWord(x: Pick<OrgPedido, "state" | "who">): string {
  if (x.state === "espera") return "Te espera";
  if (x.state === "trabajando") return x.who === "product-owner" ? "El PO la trabaja" : `${roleName(x.who)} la trabaja`;
  if (x.state === "cola") return "En el buzón";
  if (x.state === "valvula") return "Pasando la válvula";
  return "Quieta";
}

export type TuboActs = {
  // A capsule opens in La ficha's Pedido tab (PLA-I54-3).
  onOpen?: (slug: string, key: string, el: HTMLElement) => void;
  // Guardadas · n opens the shelf (PLA-I54-3).
  onGuardadas?: (slug: string, el: HTMLElement) => void;
  selected?: string | null;
};

export const Capsule = ({ slug, x, acts, where }: { slug: string; x: OrgPedido; acts: TuboActs; where?: string }) => {
  const word = pedidoWord(x);
  const label = `${x.title}: ${word}${where ? `, en ${where}` : ""}${x.images ? `, ${x.images} ${x.images === 1 ? "imagen" : "imágenes"}` : ""}`;
  const inner = (
    <>
      <span className="sb-st">
        <i aria-hidden />
        {word}
      </span>
      <span className="sb-tt">{x.title}</span>
      <span className="sb-mt">
        <span className="sb-key">{x.key}</span>
        {/* PLA-I54-5: the image count shows here once F5 counts them. */}
        {x.images > 0 && <span data-imgs={x.images}>▣ {x.images}</span>}
      </span>
    </>
  );
  return (
    <div className="sb-card tubo-cap" data-cap={x.key} data-state={x.state} data-live={x.state === "trabajando" ? "" : undefined} style={{ "--sc": PEDIDO_TONE[x.state] } as CSSProperties}>
      {acts.onOpen ? (
        <button type="button" className="sb-card-main" aria-label={label} aria-current={acts.selected === x.key ? "true" : undefined} title={x.title} onClick={(e) => acts.onOpen!(slug, x.key, e.currentTarget)} data-control="tubo-capsula">
          {inner}
        </button>
      ) : (
        <div className="sb-card-main" title={x.title}>
          {inner}
        </div>
      )}
    </div>
  );
};

export const Tubo = ({ slug, title, pedidos, acts = {} }: { slug: string; title: string; pedidos: OrgPedido[]; acts?: TuboActs }) => {
  const live = pedidos.filter((x) => !x.guardada);
  const saved = pedidos.length - live.length;
  const shelf =
    saved > 0 && acts.onGuardadas ? (
      <button type="button" className="tubo-link" onClick={(e) => acts.onGuardadas!(slug, e.currentTarget)} data-control="tubo-guardadas">
        Guardadas · {saved}
      </button>
    ) : saved > 0 ? (
      <span className="tubo-link">Guardadas · {saved}</span>
    ) : null;
  if (live.length === 0)
    return (
      <section className="tubo" data-tubo="folded" aria-label={`Pedidos de ${title}`}>
        <p className="tubo-fold">
          <span className="sb-eyebrow">Pedidos</span>
          <span>Nada tomando forma. Pide algo con «Darle forma» y entra aquí.</span>
          {shelf}
        </p>
      </section>
    );
  return (
    <section className="tubo" data-tubo={live.length} aria-label={`Pedidos de ${title}`}>
      <div className="tubo-scroll">
        <div className="tubo-grid">
          <div className="tubo-label">
            <span className="sb-eyebrow">Pedidos</span>
            <b>Tomando forma · {live.length}</b>
            {shelf}
          </div>
          {STOPS.map((s, i) => {
            const caps = live.filter((x) => x.stop === s.id);
            return (
              <div key={s.id} className="tubo-stop" data-stop={s.id} data-empty={caps.length ? undefined : ""}>
                <span className="tubo-sname">{s.name}</span>
                <small className="tubo-sline" data-last={i === STOPS.length - 1 ? "" : undefined}>
                  {s.line}
                </small>
                {caps.map((x) => (
                  <Capsule key={x.key} slug={slug} x={x} acts={acts} where={s.name} />
                ))}
              </div>
            );
          })}
          <span className="tubo-valve" title="Válvula: solo se abre con «Constrúyelo»" aria-hidden />
        </div>
      </div>
    </section>
  );
};
