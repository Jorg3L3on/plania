// PLA-I53-6: the zone tag (Pantalla · Servidor · Datos · Docs): what part of the app a ticket touches, from its areas.
// The server derives it (src/api/zonas.ts); a ticket with no areas carries none, and this draws nothing.
import type { Zona } from "@/lib/api";

export const ZONA_WORD: Record<Zona, string> = { pantalla: "Pantalla", servidor: "Servidor", datos: "Datos", docs: "Docs" };
const ZONA_TITLE: Record<Zona, string> = {
  pantalla: "Toca la pantalla (ui)",
  servidor: "Toca el servidor (API, MCP, runner)",
  datos: "Toca los datos (esquema, migraciones)",
  docs: "Toca documentos o prompts",
};

export const ZonaTags = ({ zonas }: { zonas?: Zona[] | null }) =>
  zonas && zonas.length > 0 ? (
    <span className="zt-list" data-zonas={zonas.join(" ")}>
      {zonas.map((z) => (
        <span key={z} className="zt" data-zona={z} title={ZONA_TITLE[z]}>
          {ZONA_WORD[z]}
        </span>
      ))}
    </span>
  ) : null;
