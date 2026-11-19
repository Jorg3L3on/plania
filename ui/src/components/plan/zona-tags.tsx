// PLA-I53-6: the zone tag (Pantalla · Servidor · Datos · Docs): what part of the app a ticket touches, from its areas.
// The server derives it (src/api/zonas.ts); a ticket with no areas carries none, and this draws nothing.
import type { Zona } from "@/lib/api";
import { words } from "@/lib/i18n";
import { PLAN } from "@/lib/plan-words";

// PLA-I2-10: the words live in lib/plan-words.ts; the language is fixed for the page load, so this map is too.
export const ZONA_WORD: Record<Zona, string> = words(PLAN).zona;

export const ZonaTags = ({ zonas }: { zonas?: Zona[] | null }) => {
  const w = words(PLAN);
  return zonas && zonas.length > 0 ? (
    <span className="zt-list" data-zonas={zonas.join(" ")}>
      {zonas.map((z) => (
        <span key={z} className="zt" data-zona={z} title={w.zonaTitle[z]}>
          {w.zona[z]}
        </span>
      ))}
    </span>
  ) : null;
};
