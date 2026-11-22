// PLA-I2-6: the pure parts of Ajustes' new sections (src/api/project-settings.ts writes them through setProject).
//   «Avanzado»: one field per advanced setting of src/mcp/settings-registry.ts whose control is «Avanzado». Each
//               field's sentence and default come from the registry.
//   «Cómo arranca la app»: settings.capture as a form, for when Máquinas' guess is wrong.
import type { CaptureSettings } from "../captures/settings.js";
import type { ProjectSettings } from "../db/schema.js";
import { ADVANCED_KEYS, SETTINGS, type SettingKey } from "../mcp/settings-registry.js";

// PLA-133: start_branch, release_target, release_on, the GitHub key's variable and vercel left for Despliegue
// (src/camino/changes.ts): each value has one place to edit it.
export const AVANZADO_FIELDS = [
  "branch_pattern",
  "claim_from",
  "auto_done",
  "team",
  "identity",
  "resources",
  "quotas",
  "maquinas",
  "qa",
  "velocidad",
] as const;
export type AvanzadoField = (typeof AVANZADO_FIELDS)[number];
export type AvanzadoEditor = "text" | "select" | "switch" | "number" | "env" | "json";

export const AVANZADO: Record<AvanzadoField, { key: SettingKey; editor: AvanzadoEditor; options?: string[] }> = {
  branch_pattern: { key: "branch_pattern", editor: "text" },
  claim_from: { key: "claim_from", editor: "select", options: ["backlog", "ready"] },
  auto_done: { key: "auto_done", editor: "switch" },
  team: { key: "team", editor: "number" },
  identity: { key: "identity", editor: "number" }, // PLA-I2-3: the place in lists
  resources: { key: "resources", editor: "json" },
  quotas: { key: "quotas", editor: "json" },
  maquinas: { key: "maquinas", editor: "json" },
  qa: { key: "qa", editor: "json" },
  // PLA-I73: {apilar, revision por_paso|por_modulo, carriles 1-4, esqueleto_temprano, verificar}.
  velocidad: { key: "velocidad", editor: "json" },
};

/** Every advanced key of the registry whose control is «Avanzado» has a field here (test/settings-registry.test.ts);
 * PLA-133: the ones Despliegue edits have none. */
export const avanzadoKeys = (): SettingKey[] => [...new Set(Object.values(AVANZADO).map((f) => f.key))];
export const advancedWithoutField = (): SettingKey[] => ADVANCED_KEYS.filter((k) => SETTINGS[k].control === "ajustes.avanzado" && !avanzadoKeys().includes(k));

export type AvanzadoRead = { field: AvanzadoField; key: SettingKey; editor: AvanzadoEditor; options?: string[]; value: unknown; defecto: string; frase: string };

function avanzadoValue(field: AvanzadoField, s: ProjectSettings): unknown {
  switch (field) {
    case "team":
      return s.team?.idle_minutes ?? null;
    case "identity":
      return s.identity?.order ?? null;
    case "qa": {
      // The verify list has its own section; this is the rest of settings.qa.
      const { verify: _verify, ...rest } = s.qa ?? { verify: [] };
      return Object.keys(rest).length ? rest : null;
    }
    default:
      return s[AVANZADO[field].key] ?? null;
  }
}

export const avanzadoRead = (s: ProjectSettings): AvanzadoRead[] =>
  (Object.keys(AVANZADO) as AvanzadoField[]).map((field) => {
    const f = AVANZADO[field];
    const d = SETTINGS[f.key];
    return { field, key: f.key, editor: f.editor, ...(f.options ? { options: f.options } : {}), value: avanzadoValue(field, s), defecto: ("defecto" in d ? d.defecto : undefined) ?? d.default, frase: d.frase };
  });

// A page's key and flags (session, follow, full_page) are kept for the same path; a new page gets a key from its label.
export type CaptureForm = { start_command: string; port: number; install_command: string | null; ready_path: string | null; pages: { path: string; label: string }[] };

export const captureForm = (c: CaptureSettings | undefined): CaptureForm | null =>
  c ? { start_command: c.start_command, port: c.port, install_command: c.install_command ?? null, ready_path: c.ready_path ?? null, pages: c.pages.map((p) => ({ path: p.path, label: p.label })) } : null;

const pageKey = (label: string, path: string): string => {
  const base = (label || path)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34);
  return /^[a-z0-9]/.test(base) ? base : "pagina";
};

export function captureFrom(form: CaptureForm, current: CaptureSettings | undefined): CaptureSettings {
  const used = new Set<string>();
  const pages = form.pages.map((p) => {
    const path = p.path.trim();
    const label = p.label.trim();
    const had = current?.pages.find((x) => x.path === path);
    let key = had && !used.has(had.key) ? had.key : pageKey(label, path);
    for (let n = 2; used.has(key); n++) key = `${pageKey(label, path)}-${n}`;
    used.add(key);
    return { ...(had ?? {}), key, path, label };
  });
  const { install_command: _install, ready_path: _ready, ...kept } = current ?? ({} as Partial<CaptureSettings>);
  return {
    ...kept,
    start_command: form.start_command.trim(),
    port: form.port,
    ...(form.install_command?.trim() ? { install_command: form.install_command.trim() } : {}),
    ...(form.ready_path?.trim() ? { ready_path: form.ready_path.trim() } : {}),
    pages,
  } as CaptureSettings;
}
