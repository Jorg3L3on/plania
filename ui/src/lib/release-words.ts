// PLA-I2-10: the release step's words (the Bandeja's Pasos row and the Lanzar sheet), in both languages.
// No "@/" imports: the server and node tests import wording modules directly.
import { defineWords } from "./i18n.js";

const esPlural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const enPlural = esPlural;

const esTickets = (n: number) => esPlural(n, "ticket", "tickets");
const esMigrations = (n: number) => esPlural(n, "migración", "migraciones");
const esCommits = (n: number) => esPlural(n, "commit", "commits");
const enTickets = (n: number) => enPlural(n, "ticket", "tickets");
const enMigrations = (n: number) => enPlural(n, "migration", "migrations");
const enCommits = (n: number) => enPlural(n, "commit", "commits");

export const RELEASE = defineWords({
  es: {
    tickets: esTickets,
    migrations: esMigrations,
    commits: esCommits,
    // Why Lanzar is off (ShipBlock), said the way the row says everything else.
    shipBlock: {
      mode_command: "Modo comando: lo corres tú",
      no_repo: "Falta settings.github.repo",
      no_github_data: "Sin datos de GitHub",
      nothing_to_ship: "No hay nada por lanzar",
      before_steps: "Primero los pasos de arriba",
      open_checks: "Primero cierra los puntos abiertos",
      merged: "Ya fusionado",
    },
    shipFailed: "No se pudo lanzar.",
    mergeFailed: (step: string, output: string) => `GitHub no aceptó el paso ${step}: ${output}`,
    notReady: (why: string) => `Ya no se puede lanzar: ${why}.`,
    merged: (from: string, into: string, sha: string) => `${from} → ${into} fusionado (${sha}); el deploy lo cierra`,
    release: "Lanzar",
    releaseTo: (env: string) => `Lanzar a ${env}`,
    // The sheet's sentence, around the two branch names and the optional commit.
    planOpens: "Plania abre (o reutiliza) un PR de ",
    planTo: " a ",
    planMerges: " y lo fusiona con merge commit",
    planAt: " en ",
    planThen: (env: string) => `. Cuando ${env} despliegue, los tickets pasan a Released.`,
    migrationsLine: (n: number, list: string, into: string, env: string) => `${esMigrations(n)}: ${list}. ${into} las necesita en ${env}.`,
    cancel: "Cancelar",
    releasing: "Lanzando…",
    releaseN: (n: number) => `Lanzar ${esTickets(n)}`,
    ahead: (n: number) => `${esCommits(n)} por delante · `,
    noGithub: "sin datos de GitHub · ",
    waits: (t: string) => `espera ${t}`,
    ticketsAria: "Tickets",
    beforeRelease: "Antes de lanzar",
    openChecks: (n: number) => `${esPlural(n, "punto abierto", "puntos abiertos")} en el Done when de estos tickets`,
    mergedLabel: "Fusionado",
    waitDeploy: (into: string, env: string) => `; espera a que ${into} llegue a ${env}`,
    youRunIt: "Lo corres tú; Plania no hace merge",
  },
  en: {
    tickets: enTickets,
    migrations: enMigrations,
    commits: enCommits,
    shipBlock: {
      mode_command: "Command mode: you run it",
      no_repo: "settings.github.repo is missing",
      no_github_data: "No GitHub data",
      nothing_to_ship: "Nothing to release",
      before_steps: "First the steps above",
      open_checks: "First close the open points",
      merged: "Already merged",
    },
    shipFailed: "Could not release.",
    mergeFailed: (step: string, output: string) => `GitHub did not accept step ${step}: ${output}`,
    notReady: (why: string) => `It can no longer be released: ${why}.`,
    merged: (from: string, into: string, sha: string) => `${from} → ${into} merged (${sha}); the deploy closes it`,
    release: "Release",
    releaseTo: (env: string) => `Release to ${env}`,
    planOpens: "Plania opens (or reuses) a PR from ",
    planTo: " to ",
    planMerges: " and merges it with a merge commit",
    planAt: " at ",
    planThen: (env: string) => `. When ${env} deploys, the tickets move to Released.`,
    migrationsLine: (n: number, list: string, into: string, env: string) => `${enMigrations(n)}: ${list}. ${into} needs them on ${env}.`,
    cancel: "Cancel",
    releasing: "Releasing…",
    releaseN: (n: number) => `Release ${enTickets(n)}`,
    ahead: (n: number) => `${enCommits(n)} ahead · `,
    noGithub: "no GitHub data · ",
    waits: (t: string) => `waiting ${t}`,
    ticketsAria: "Tickets",
    beforeRelease: "Before releasing",
    openChecks: (n: number) => `${enPlural(n, "open point", "open points")} in these tickets' Done when`,
    mergedLabel: "Merged",
    waitDeploy: (into: string, env: string) => `; waiting for ${into} to reach ${env}`,
    youRunIt: "You run it; Plania does not merge",
  },
});
