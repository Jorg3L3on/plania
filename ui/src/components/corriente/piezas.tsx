// PLA-I62-1: the internal kit page (/corriente?v=piezas), board D4 drawn with the real pieces, so a change to a piece
// shows here first.
import { grupoName } from "@/lib/cosas";
import { words } from "@/lib/i18n";
import { PIEZAS_WORDS } from "@/lib/piezas-words";
import { Agent, Btn, Dot, Label, Logo, Opt, State, You } from "./parts";

const Cap = ({ children }: { children: React.ReactNode }) => <span className="cor-cap">{children}</span>;

const SWATCH_COLORS = ["#050507", "#0c0c10", "#f4f4f6", "#9a9aa6", "#8b5cf6", "#ffb454"];

export const Piezas = () => {
  const w = words(PIEZAS_WORDS);
  return (
    <div className="cor-piezas" data-piezas>
      <section>
        <Label as="h2">{w.buttons}</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Btn kind="primary">{w.accept}</Btn>
            <Cap>{w.primary}</Cap>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Btn kind="secondary">{w.seeBeforeAfter}</Btn>
            <Cap>{w.secondary}</Cap>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Btn kind="quiet">{w.askFix}</Btn>
            <Cap>{w.quiet}</Cap>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Btn kind="amber">
              <You flat />
              {w.waiting(2)}
            </Btn>
            <Cap>{w.amberOnly}</Cap>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Opt on>{w.shapeIt}</Opt>
            <Cap>{w.chosen}</Cap>
          </span>
        </div>
      </section>

      <section>
        <Label as="h2">{w.color}</Label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          {SWATCH_COLORS.map((c, i) => [c, w.swatches[i]] as const).map(([c, name]) => (
            <span key={c} className="cor-swatch">
              <i style={{ background: c, boxShadow: c === "#8b5cf6" ? "0 0 30px -4px rgba(139,92,246,.8)" : c === "#ffb454" ? "0 0 30px -4px rgba(255,180,84,.7)" : undefined }} />
              <span>{name}</span>
              <Cap>{c!.toUpperCase()}</Cap>
            </span>
          ))}
        </div>
      </section>

      <section>
        <Label as="h2">{w.type}</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 46, lineHeight: 1, fontWeight: 500, letterSpacing: "-0.035em" }}>{w.company}</div>
            <Cap>{w.headlines}</Cap>
          </div>
          <div>
            <p className="cor-text" style={{ fontSize: 15 }}>
              {w.sample}
            </p>
            <Cap>{w.text}</Cap>
          </div>
          <div>
            <div className="cor-mono" style={{ fontSize: 12, letterSpacing: "0.14em", color: "#c9c9d2" }}>
              {w.stageSample}
            </div>
            <Cap>{w.mono}</Cap>
          </div>
          <div>
            <div className="cor-figure" style={{ fontSize: 30 }}>
              1,140
            </div>
            <Cap>{w.figures}</Cap>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <State tone="live">{w.working}</State>
            <State>{w.free}</State>
            <State tone="amber">{grupoName("toca")}</State>
          </div>
        </div>
      </section>

      <section>
        <Label as="h2">{w.lights}</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div className="cor-light-row">
            <span>
              <Dot />
            </span>
            <div>
              <div style={{ fontSize: 14 }}>{w.waitingWork}</div>
              <Cap>{w.waitingWorkHint}</Cap>
            </div>
          </div>
          <div className="cor-light-row">
            <span>
              <Agent />
            </span>
            <div>
              <div style={{ fontSize: 14 }}>{w.agentWorking}</div>
              <Cap>{w.agentHint}</Cap>
            </div>
          </div>
          <div className="cor-light-row">
            <span>
              <You />
            </span>
            <div>
              <div style={{ fontSize: 14 }}>{grupoName("toca")}</div>
              <Cap>{w.youHint}</Cap>
            </div>
          </div>
          <div className="cor-light-row">
            <span className="cor-flowline" aria-hidden />
            <div>
              <div style={{ fontSize: 14 }}>{w.current}</div>
              <Cap>{w.currentHint}</Cap>
            </div>
          </div>
          <div className="cor-light-row">
            <span>
              <Logo slug="proyecto" title={w.project} />
            </span>
            <div>
              <div style={{ fontSize: 14 }}>{w.logo}</div>
              <Cap>{w.logoHint}</Cap>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
