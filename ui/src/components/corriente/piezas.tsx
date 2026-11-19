// PLA-I62-1: the internal kit page (/corriente?v=piezas), board D4 drawn with the real pieces, so a change to a piece
// shows here first.
import { Agent, Btn, Dot, Label, Logo, Opt, State, You } from "./parts";

const Cap = ({ children }: { children: React.ReactNode }) => <span className="cor-cap">{children}</span>;

export const Piezas = () => (
  <div className="cor-piezas" data-piezas>
    <section>
      <Label as="h2">Botones</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Btn kind="primary">Aceptar</Btn>
          <Cap>principal, uno por pantalla</Cap>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Btn kind="secondary">Ver antes y después</Btn>
          <Cap>secundario</Cap>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Btn kind="quiet">Pedir ajuste</Btn>
          <Cap>callado</Cap>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Btn kind="amber">
            <You flat />2 te esperan
          </Btn>
          <Cap>solo para lo tuyo</Cap>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Opt on>Darle forma</Opt>
          <Cap>opción elegida</Cap>
        </span>
      </div>
    </section>

    <section>
      <Label as="h2">Color</Label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        {[
          ["#050507", "Fondo"],
          ["#0c0c10", "Superficie"],
          ["#f4f4f6", "Texto y botón principal"],
          ["#9a9aa6", "Texto apagado"],
          ["#8b5cf6", "Violeta: el trabajo vivo"],
          ["#ffb454", "Ámbar: te toca"],
        ].map(([c, name]) => (
          <span key={c} className="cor-swatch">
            <i style={{ background: c, boxShadow: c === "#8b5cf6" ? "0 0 30px -4px rgba(139,92,246,.8)" : c === "#ffb454" ? "0 0 30px -4px rgba(255,180,84,.7)" : undefined }} />
            <span>{name}</span>
            <Cap>{c!.toUpperCase()}</Cap>
          </span>
        ))}
      </div>
    </section>

    <section>
      <Label as="h2">Tipo</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 46, lineHeight: 1, fontWeight: 500, letterSpacing: "-0.035em" }}>Compañía</div>
          <Cap>Geist 500 · 54 / 38 / 24 · titulares</Cap>
        </div>
        <div>
          <p className="cor-text" style={{ fontSize: 15 }}>
            La entrega está en revisión y espera tu decisión.
          </p>
          <Cap>Geist 400 · 15 / 14 · texto</Cap>
        </div>
        <div>
          <div className="cor-mono" style={{ fontSize: 12, letterSpacing: "0.14em", color: "#c9c9d2" }}>
            CONSTRUCCIÓN · TND-42
          </div>
          <Cap>Geist Mono · 10.5 a 12 · etiquetas, claves, números</Cap>
        </div>
        <div>
          <div className="cor-figure" style={{ fontSize: 30 }}>
            1,140
          </div>
          <Cap>Geist 500 · 28 · cifras</Cap>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <State tone="live">Trabajando</State>
          <State>Libre</State>
          <State tone="amber">Te toca</State>
        </div>
      </div>
    </section>

    <section>
      <Label as="h2">Luces de la corriente</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div className="cor-light-row">
          <span>
            <Dot />
          </span>
          <div>
            <div style={{ fontSize: 14 }}>Trabajo en espera</div>
            <Cap>un punto por paso en su etapa</Cap>
          </div>
        </div>
        <div className="cor-light-row">
          <span>
            <Agent />
          </span>
          <div>
            <div style={{ fontSize: 14 }}>Agente trabajando</div>
            <Cap>blanco con halo violeta, late</Cap>
          </div>
        </div>
        <div className="cor-light-row">
          <span>
            <You />
          </span>
          <div>
            <div style={{ fontSize: 14 }}>Te toca</div>
            <Cap>rombo ámbar, la única luz cálida</Cap>
          </div>
        </div>
        <div className="cor-light-row">
          <span className="cor-flowline" aria-hidden />
          <div>
            <div style={{ fontSize: 14 }}>Corriente</div>
            <Cap>luz que cruza de idea a revisión; más lenta si el proyecto está quieto</Cap>
          </div>
        </div>
        <div className="cor-light-row">
          <span>
            <Logo slug="proyecto" title="Proyecto" />
          </span>
          <div>
            <div style={{ fontSize: 14 }}>Logo del proyecto</div>
            <Cap>el único lugar con su color propio</Cap>
          </div>
        </div>
      </div>
    </section>
  </div>
);
