// PLA-I3-7 (the project page on a phone): at 639 px and under an initiative's card does not draw one button per step.
// Its steps are ONE 44 px control: the segments (10 px tall, in each step's tone), «3 de 8» and a chevron. Tapping it
// opens a sheet from the foot (Hoja, bottom): the initiative's key, «3 DE 8 PASOS» and its title, then one row per
// step, 56 px or more: a 10 px square in the step's tone, the title on up to two lines, its state line under it and a
// chevron. A row opens the step (ver=paso:<K>); the live step's row is tinted violet. Cerrar (44 px) and Esc close it.
// Above 639 px the control is not drawn (corriente.css) and the row keeps its thread of buttons (hilo.tsx).
// Words in lib/tramo.ts.
import { Link } from "react-router";
import type { Cosa } from "@/lib/cosas";
import { tramoState, tramoWords, tramoTip, tramosAria, tramosCuenta, tramosPos } from "@/lib/tramo";
import { Hoja } from "./hojas";

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const CHEVRON = "M6.5 3.5 11 8l-4.5 4.5";

type Iniciativa = Pick<Cosa, "key" | "title" | "hilo">;

/** The one control on the card: the segments, «3 de 8», a chevron. */
export const TramosBoton = ({ c, onOpen, open }: { c: Iniciativa; onOpen: () => void; open: boolean }) => {
  const ts = c.hilo.tramos;
  const fin = c.hilo.publicado;
  return (
    <button type="button" className="cor-tramos" aria-haspopup="dialog" aria-expanded={open} aria-label={tramosAria(c.title, ts)} onClick={onOpen} data-tramos={c.key}>
      <span className="cor-tramos-sg" aria-hidden>
        {ts.map((t) => (
          <i key={t.key} className={fin ? "fin" : t.tono} />
        ))}
      </span>
      <span className="cor-tramos-n" aria-hidden>
        {tramosCuenta(ts)}
      </span>
      <Icon d={CHEVRON} />
    </button>
  );
};

/** The sheet with one row per step. paso is where a step opens (ver=paso:<K>). */
export const TramosHoja = ({ c, paso, onClose, now }: { c: Iniciativa; paso: (key: string) => string; onClose: () => void; now?: number }) => {
  const ts = c.hilo.tramos;
  return (
    <Hoja
      bottom
      label={
        <>
          <span className="cor-key">{c.key}</span>
          {` · ${tramosPos(ts)}`}
        </>
      }
      title={c.title}
      onClose={onClose}
    >
      <button type="button" className="cor-lado-ic cor-hoja-x" aria-label={tramoWords().cerrar} onClick={onClose} data-control="tramos-cerrar">
        <Icon d="M4 4l8 8M12 4l-8 8" size={18} />
      </button>
      <ol className="cor-tramos-list" aria-label={tramoWords().lista} data-tramos-hoja={c.key}>
        {ts.map((t, i) => (
          <li key={t.key}>
            <Link to={paso(t.key)} className={cls("cor-tramo", t.tono)} aria-label={tramoTip(t, i, ts.length, now).aria} data-tramo={t.key} data-tono={t.tono}>
              <i className={cls("cor-lado-sq", t.tono)} aria-hidden />
              <span className="cor-tramo-tx">
                <b>{t.title}</b>
                <span className="cor-tramo-st">{tramoState(t, now)}</span>
              </span>
              <Icon d={CHEVRON} />
            </Link>
          </li>
        ))}
      </ol>
    </Hoja>
  );
};
