// Which of Inicio's sections show, by how far the owner is into the first delivery (GET /api/guia) and by what each
// section would hold. A section that would only show an empty shell, or a second way to do what the guide asks for
// right now, waits until it has something to say. The city is not here: it is Inicio's face and always shows,
// asleep until its first tower. Pure: the page (ui/src/pages/home.tsx) passes the counts in.
import { pasosDe, tarjetaDe, type GuiaRead } from "./primera-entrega.js";
import type { Machine } from "./types.js";

/**
 * guia: the wizard's three steps are not done yet. equipo: they are, and the guide waits on the team's plan or
 * delivery. normal: no guide (a first delivery was accepted). Unknown (no reading) counts as normal, so a failed
 * /api/guia never hides an established owner's page.
 */
export type Etapa = "guia" | "equipo" | "normal";

export function etapaDe(r: GuiaRead | null | undefined): Etapa {
  if (!r || !r.visible) return "normal";
  return tarjetaDe(pasosDe(r)).enAsistente ? "guia" : "equipo";
}

/** The machine holds something worth a look: a port, a database, worktrees on disk, or a finding. */
export function maquinaEnUso(m: Machine | null | undefined, servidores: number): boolean {
  if (!m) return false;
  const t = m.totals;
  return servidores > 0 || t.databases > 0 || t.worktree_kb > 0 || t.orphan > 0 || t.stale > 0 || m.findings.length > 0;
}

/** maquina: the block that holds the projects; cifrasMaquina: its own figures in that block's header. */
export type Secciones = { metas: boolean; maquina: boolean; cifrasMaquina: boolean };

export function seccionesDe(i: {
  etapa: Etapa;
  /** Projects listed on Inicio. */
  proyectos: number;
  /** Company goals; null while unknown. */
  metas: number | null;
  maquinaEnUso: boolean;
}): Secciones {
  // The guide card leaves Inicio once the wizard is done, so the team's turn reads like a normal day.
  const normal = i.etapa !== "guia";
  return {
    // Goals are for later: shown once there is one, or once the guide is done (with its empty state and its button).
    metas: (i.metas ?? 0) > 0 || normal,
    // La máquina holds the projects, so it shows with the first one, at any stage.
    maquina: i.proyectos > 0,
    // Its figures (databases, worktrees) only once it holds something: a row of zeros says nothing.
    cifrasMaquina: i.maquinaEnUso,
  };
}
