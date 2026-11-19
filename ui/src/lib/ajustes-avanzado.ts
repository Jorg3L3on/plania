// PLA-I2-6: the words and checks of Ajustes' «Cómo arranca la app» and «Avanzado» sections (PUT …/settings/capture and
// …/settings/advanced, src/api/project-settings.ts). Each advanced field's sentence and default come from the server's
// one list of settings (src/mcp/settings-registry.ts); its label is here. Plain Spanish, pure, tested without a
// browser (test/settings-registry.test.ts). The server checks everything again.

export type AvanzadoEditor = "text" | "select" | "switch" | "number" | "env" | "json";
export type AvanzadoRead = { field: string; key: string; editor: AvanzadoEditor; options?: string[]; value: unknown; defecto: string; frase: string };
export type ArranqueRead = { start_command: string; port: number; install_command: string | null; ready_path: string | null; pages: { path: string; label: string }[] };

export const ARRANQUE = {
  titulo: "Cómo arranca la app",
  texto: "Plania arranca una copia de la app para probar cada entrega y tomarle fotos. Corrige aquí lo que adivinó mal.",
  vacio: "Todavía no sabe cómo arrancarla. Llénalo aquí, o usa «Configurar su app» en Máquinas para que lo adivine.",
  comando: { label: "Comando para arrancarla", hint: "{port} se cambia por el puerto libre." },
  puerto: { label: "Puerto", hint: "El primero que prueba; si está ocupado, usa el siguiente." },
  instalar: { label: "Comando para instalar (opcional)", hint: "Vacío: el que pida su archivo de dependencias." },
  lista: { label: "Dirección que responde cuando ya arrancó (opcional)", hint: "Vacía: /" },
  paginas: { label: "Páginas para las fotos", hint: "Una por línea: la dirección, un espacio y su nombre. Por ejemplo: /carrito Carrito" },
} as const;

export const AVANZADO_SECCION = {
  titulo: "Avanzado",
  texto: "Lo que casi nunca hace falta tocar. Cada ajuste dice qué pasa si lo dejas como está.",
} as const;

/** The label for each «Avanzado» field. A field the server sends with no label here shows its key. */
export const AVANZADO_ETIQUETAS: Record<string, string> = {
  start_branch: "Rama de trabajo",
  branch_pattern: "Forma de los nombres de rama",
  claim_from: "De dónde toman trabajo los agentes",
  release_target: "Entorno de producción",
  release_on: "Qué cuenta como publicado",
  auto_done: "Cerrar solo lo publicado",
  team: "Minutos para «atorado»",
  github_token_env: "Variable con la llave de GitHub",
  vercel: "Vercel",
  resources: "Recursos por turnos",
  quotas: "Límites diarios",
  maquinas: "Comandos de la base de la app",
  qa: "Otros ajustes de QA",
};

export const OPCIONES: Record<string, string> = {
  backlog: "De lo pendiente",
  ready: "Solo de lo listo",
  env: "El entorno corre el cambio",
  branch: "La rama publicada lo tiene",
};
export const AUTOMATICO = "Automático";

/** What holds while the field is empty, in the server's words. */
export const porDefecto = (f: Pick<AvanzadoRead, "defecto">): string => `Si lo dejas vacío: ${f.defecto}`;

/** What the field shows: a JSON value as indented text, a number or text as itself, nothing as empty. */
export function avanzadoTexto(f: Pick<AvanzadoRead, "editor" | "value">): string {
  if (f.value === null || f.value === undefined) return "";
  if (f.editor === "json") return JSON.stringify(f.value, null, 2);
  return String(f.value);
}

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The value to send for what the field holds, or an error line. Empty is null: the default comes back. */
export function avanzadoValor(editor: AvanzadoEditor, text: string): { ok: true; value: unknown } | { ok: false; aviso: string } {
  const t = text.trim();
  if (!t) return { ok: true, value: null };
  switch (editor) {
    case "number": {
      const n = Number(t);
      return Number.isInteger(n) && n >= 1 && n <= 1440 ? { ok: true, value: n } : { ok: false, aviso: "Un número entero de minutos, de 1 a 1440." };
    }
    case "env":
      return ENV_NAME.test(t) ? { ok: true, value: t } : { ok: false, aviso: "Va el NOMBRE de la variable (mayúsculas, números y _), nunca la llave." };
    case "json":
      try {
        const v = JSON.parse(t) as unknown;
        return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, value: v } : { ok: false, aviso: "Va un objeto entre llaves { }." };
      } catch {
        return { ok: false, aviso: "No es un objeto válido: revisa comas y comillas." };
      }
    case "switch":
      return { ok: true, value: t === "true" };
    default:
      return { ok: true, value: t };
  }
}

/** The pages field: one per line, «/path Label». */
export const paginasTexto = (pages: ArranqueRead["pages"]): string => pages.map((p) => `${p.path} ${p.label}`).join("\n");
export function paginas(text: string): { path: string; label: string }[] | null {
  const out: { path: string; label: string }[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const m = /^(\/\S*)\s+(.+)$/.exec(l);
    if (!m) return null;
    out.push({ path: m[1]!, label: m[2]!.trim().slice(0, 60) });
  }
  return out.length >= 1 && out.length <= 12 ? out : null;
}

export type ArranqueForm = { start_command: string; port: string; install_command: string; ready_path: string; pages: string };
export const arranqueForm = (c: ArranqueRead | null): ArranqueForm => ({
  start_command: c?.start_command ?? "",
  port: c ? String(c.port) : "3000",
  install_command: c?.install_command ?? "",
  ready_path: c?.ready_path ?? "",
  pages: c ? paginasTexto(c.pages) : "/ Inicio",
});

/** The body to send, or the line that says what is not right yet. */
export function arranqueBody(f: ArranqueForm): { ok: true; capture: ArranqueRead } | { ok: false; aviso: string } {
  const start = f.start_command.trim();
  if (!start || start.length > 300) return { ok: false, aviso: "Falta el comando para arrancarla." };
  const port = Number(f.port.trim());
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, aviso: "El puerto va de 1024 a 65535." };
  const ready = f.ready_path.trim();
  if (ready && !/^\/\S*$/.test(ready)) return { ok: false, aviso: "La dirección empieza con /." };
  const pages = paginas(f.pages);
  if (!pages) return { ok: false, aviso: "Entre 1 y 12 páginas, una por línea: la dirección (empieza con /), un espacio y su nombre." };
  return { ok: true, capture: { start_command: start, port, install_command: f.install_command.trim() || null, ready_path: ready || null, pages } };
}

/** The refusal lines these sections add to ajustesError; null for a code they do not own. */
export function avanzadoError(code: string | null, detail: Record<string, unknown> = {}): string | null {
  if (code === "SECRET_VALUE") return "No se guardó: eso parece una llave o una contraseña. Aquí nunca va su valor; guárdala en una variable y escribe su nombre.";
  if (code === "NOT_A_VARIABLE_NAME") return "No se guardó: va el nombre de la variable (mayúsculas, números y _), nunca la llave.";
  if (code === "INVALID_FILTER" && typeof detail.field === "string" && detail.field.startsWith("settings.capture"))
    return "No se guardó: revisa el comando, el puerto y las páginas (cada dirección empieza con /).";
  if (code === "INVALID_BODY" && detail.field === "github_token_env") return "No se guardó: primero guarda el repositorio de GitHub.";
  return null;
}
