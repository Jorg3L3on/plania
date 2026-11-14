// PLA-I39-3: the night panel. Stars and the moon (or the sun, by the hour viewed), the sentence in the sky
// (companyLine, then Asistente's last summary), the roof, the tower of floors, the street and the basement.
// The scene stays a night panel in both app themes, as Inicio's city does. Nothing moves to look busy: PLA-I46-3,
// the stars are still; only the Ahora card with the owner's move breathes.
import type { ReactNode } from "react";
import type { CSSProperties } from "react";
import { skyAt } from "@/lib/edificio";

// Fixed positions, so a render is the same every time (no Math.random on render).
const STARS = [
  [4, 12],
  [11, 30],
  [17, 8],
  [23, 22],
  [29, 5],
  [36, 18],
  [42, 9],
  [48, 27],
  [55, 6],
  [61, 20],
  [67, 11],
  [73, 25],
  [79, 4],
  [85, 16],
  [91, 28],
  [96, 9],
  [8, 44],
  [33, 40],
  [58, 38],
  [88, 42],
] as const;

export const Scene = ({
  hour,
  pre,
  line,
  by,
  meta,
  children,
  label = "Compañía",
}: {
  hour: number;
  pre: string;
  line: string;
  by?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  label?: string;
}) => {
  const sky = skyAt(hour);
  return (
    <section
      className="edi"
      aria-label={label}
      data-edi
      style={
        {
          "--sky1": sky.top,
          "--sky2": sky.bottom,
          "--dark": sky.stars,
        } as CSSProperties
      }
    >
      <div aria-hidden>
        {STARS.map(([x, y], i) => (
          <span
            key={i}
            className="edi-star"
            style={{
              left: `${x}%`,
              top: `${y}%`,
            }}
          />
        ))}
      </div>
      <span className="edi-orb" data-orb={sky.orb} aria-hidden />
      <header className="edi-sky">
        {meta && <div className="edi-meta">{meta}</div>}
        <h1 className="edi-voice">
          <span className="edi-vpre">{pre}</span>
          <span data-voice>{line}</span>
        </h1>
        {by && <div className="edi-by">{by}</div>}
      </header>
      {children}
    </section>
  );
};

// Loading: the building's outline with three floors and dark windows; the same height as a real floor.
export const EdificioSkeleton = () => (
  <section className="edi" aria-hidden data-testid="edificio-skeleton" style={{ "--sky1": "#070a18", "--sky2": "#171d3d", "--dark": 1 } as CSSProperties}>
    <header className="edi-sky">
      <div className="edi-voice edi-ghost-line" />
    </header>
    <div className="edi-rooftop">
      <div className="edi-pent edi-pent-ghost" />
    </div>
    <div className="edi-tower">
      {[0, 1, 2].map((i) => (
        <div key={i} className="edi-floor" style={{ "--c": "#3a4057" } as CSSProperties}>
          <div className="edi-plate">
            <span className="edi-ghost-line" />
          </div>
          <div className="edi-wins">
            {[0, 1, 2, 3].map((w) => (
              <span key={w} className="edi-win" data-state="idle">
                <span className="edi-glass" />
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
    <div className="edi-street" />
  </section>
);
