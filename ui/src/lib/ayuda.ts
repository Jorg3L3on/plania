// PLA-I2-18: the words of «Pedir ayuda» and «Llevarte tus datos» in Plomería, and where each file comes from.
// Pure: no "@/" imports. The files are plain downloads behind the screen's session; Plania sends neither anywhere.

/** GET: the help report, a text file (src/api/help-report.ts). */
export const HELP_REPORT_URL = "/api/help-report";
/** GET: every project in one JSON file (src/web/export.ts). */
export const EXPORT_ALL_URL = "/api/export-all";

export const AYUDA = {
  title: "Ayuda y salida",
  report: "Bajar informe para pedir ayuda",
  reportCap: "Un archivo con la versión, tu máquina, lo que falta y los últimos errores. Sin contraseñas, claves, código ni textos de tus proyectos. Tú decides si lo mandas: Plania no lo envía.",
  exportAll: "Llevarte tus datos",
  exportAllCap: "Todos tus proyectos en un archivo: tickets, documentos, decisiones y su historia.",
  leaveCap: "Para quitar Plania de esta máquina, escribe en la terminal: pnpm uninstall:plania. Tu base de datos se queda, salvo que pidas borrarla.",
} as const;
