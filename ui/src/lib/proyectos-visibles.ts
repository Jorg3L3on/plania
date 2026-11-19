// F7 (first-install audit): first start makes a home project (Asistente's home) the owner never made. While it holds
// no work the server marks it quiet_home (src/api/onboarding.ts), and the lists the owner reads leave it out: Inicio's
// tiles, the company's stream, the project switcher and the request box's picker. A read by slug (Asistente, Ajustes,
// a link) still finds it, so only lists go through here. Tested without a browser.

/** The projects a list shows: every one but the home project while it holds no work, unless the address asked for it
 * by slug (keep), as a link into the request box may. */
export function listedProjects<T extends { slug: string; quiet_home?: boolean }>(projects: readonly T[], keep: string | null = null): T[] {
  return projects.filter((p) => !p.quiet_home || p.slug === keep);
}
