// PLA-I2-4: what the screen says when a part of Plania needs a program this system does not have (Chrome for the
// stills, brew for the base lever, a POSIX shell for the test copy). A plain state, never an error. The server
// imports these words (src/lib/system-support.ts), so this file stays free of "@/" imports.
export const NO_DISPONIBLE = "No disponible en este sistema";

// The sub-line for each part, under NO_DISPONIBLE.
export const NO_DISPONIBLE_POR = {
  test_copy: "La copia de prueba necesita macOS o Linux.",
  stills: "Las capturas necesitan Chrome o Chromium en esta máquina.",
  base_lever: "Encender y apagar la base necesita brew o systemd en esta máquina.",
} as const;

export type SystemFeature = keyof typeof NO_DISPONIBLE_POR;
