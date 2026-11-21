// PLA-I68-3: Camino's «Código y ramas»: where the code is and what each branch means. Everything is picked from what
// exists (the account's repos, the local clones, the repo's branches); only a work-branch pattern is typed, and it
// shows its live matches. The three ways to publish carry their reason and a source; the current one is marked.
// Pure, tested without a browser (test/i68-3-codigo.test.ts).
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import type { BranchRule, GhBranch, PublishModel } from "./camino-types.js";

export const MODEL_SOURCES: Record<PublishModel, string> = {
  trunk: "https://dora.dev/capabilities/trunk-based-development/",
  integ: "https://martinfowler.com/articles/branching-patterns.html",
  tags: "https://12factor.net/build-release-run",
};

export const CODIGO_WORDS = defineWords({
  es: {
    lead: "Dónde está el código y qué significa cada rama. Taller, QA y Publicar leen esto en vez de suponerlo.",
    repo: "Repositorio",
    repoHint: "elegido de tu cuenta de GitHub",
    repoPaste: "o pega su enlace",
    repoCheck: "Usar este",
    repoBad: "Eso no es un enlace de GitHub (github.com/dueño/repo).",
    repoPasted: "pegado",
    repoChecking: "Buscándolo en GitHub…",
    repoMissing: "GitHub no encontró ese repositorio con la llave de este proyecto. Revisa el enlace o los permisos de la llave.",
    repoUnreachable: "No se pudo consultar GitHub. Prueba de nuevo.",
    repoMeta: (vis: string, def: string, admin: boolean) => `${vis} · rama por defecto ${def}${admin ? " · tu permiso: administración" : ""}`,
    noRepoYet: "Sin repositorio todavía",
    folder: "Carpeta en esta Mac",
    folderHint: "un clon de este repo, encontrado en tu carpeta de proyectos",
    folderOk: "Comprobada: es un clon de este repo",
    folderBad: "No es un clon de este repo",
    folderNone: "No encontré clones de este repo en esta Mac.",
    // PLA-132: moved here from Ajustes.
    noCode: "Todavía no hay código",
    noCodeSub: "El equipo trabaja sin carpeta ni repositorio hasta que los tenga. Apágalo para elegir su repositorio.",
    noCodeLabel: "Si tiene código",
    hasCode: "Tiene código",
    // PLA-133: the working branch, moved here from Ajustes › Avanzado.
    start: "Rama de trabajo del equipo",
    startHint: "de donde parte Taller y adonde entra lo que aceptas",
    startInteg: (b: string) => `Es la rama de integración (${b}): se cambia arriba, con las ramas.`,
    startDefault: (b: string) => `Si la dejas vacía: ${b}.`,
    startBad: "No se puede: nunca una rama protegida (main, master, production, prod) ni un nombre con espacios.",
    startLabel: "Rama de trabajo",
    howPublish: "Cómo se publica",
    why: "Por qué",
    source: "Fuente",
    today: "hoy",
    recommended: "recomendado",
    models: {
      trunk: { name: "Una rama principal", sub: "Cada cambio entra por propuesta a la rama publicada; cada propuesta tiene su previa.", why: "Menos ramas que se separan y lo que se probó es lo que sale. DORA recomienda pocas ramas que vivan horas; Fowler llama antipatrón a las ramas por entorno." },
      integ: { name: "Rama de integración", sub: "Los tickets se juntan en una rama y se publica fusionándola en la principal.", why: "Sirve para probar varios cambios juntos antes de publicar, o si publicar no depende de ti (tiendas de apps). Cuesta: las ramas se separan, las fusiones se acumulan en la principal y las actualizaciones de seguridad siempre llegan a la rama por defecto." },
      tags: { name: "Versiones por etiqueta", sub: "Todo entra a la principal; una etiqueta (v1.4.0) publica una versión que no cambia.", why: "Para apps que la gente instala y para librerías: cada versión es un paquete fijo al que se puede volver." },
    } as Record<PublishModel, { name: string; sub: string; why: string }>,
    integCost: (state: string, b: string) => `Lo que cuesta hoy: ${state}. Las actualizaciones de seguridad siempre llegan a la rama por defecto, no a ${b}.`,
    trunkMove: (pub: string) => `Con una rama principal, Publicar apunta a ${pub}. Taller sigue juntando lo aceptado en su rama de trabajo hasta que la quites.`,
    published: "Rama publicada",
    integration: "Rama de integración",
    none: "Ninguna",
    work: "Ramas de trabajo",
    workHint: "patrón",
    matches: (n: number, list: string) => (n ? `${n} ${n === 1 ? "rama coincide" : "ramas coinciden"}: ${list}` : "Ninguna rama coincide todavía"),
    tableBranch: "Rama en GitHub",
    tableWhat: "Qué es",
    tableState: "Estado",
    kinds: { publicada: "publicada", integracion: "integración", trabajo: "trabajo", fuera: "de fuera (actualizaciones automáticas)", otra: "otra" } as Record<string, string>,
    state: (ahead: number | null, behind: number | null, def: string) =>
      ahead === null ? "—" : ahead === 0 && behind === 0 ? `igual que ${def}` : `${ahead} adelante · ${behind ?? 0} detrás de ${def}`,
    protectedChip: "protegida",
    deleteBranch: "Borrar",
    willDelete: "se borrará",
    rules: "Reglas de GitHub",
    rulesFree: "Gratis en repos públicos",
    rulesPlan: "No disponibles en este plan",
    ruleOn: (b: string) => `Proteger ${b}`,
    ruleOnSub: "Una regla de GitHub: gratis en repos públicos.",
    ruleOnPlan: "Repo privado en el plan gratis: GitHub no aplica reglas. Plania las hace cumplir en sus propias fusiones.",
    needAdmin: "Crear reglas de GitHub necesita permiso de administración. La llave de este proyecto no lo tiene.",
    ruleNoEnforce: "«Solo por propuesta» y «No se puede borrar» las hace cumplir GitHub, y en este plan no puede. Lo que sí cumple Plania: las pruebas que elijas en Pruebas › Exigir.",
    rulePr: "Solo entra por propuesta",
    rulePrSub: "Nadie empuja directo. Sin aprobaciones obligatorias: trabajas solo y GitHub no deja aprobar lo propio.",
    ruleNodel: "No se puede borrar ni reescribir",
    ruleNodelSub: "Bloquea el borrado y el empujón forzado.",
    ruleAgents: "Los agentes pueden saltarla",
    ruleAgentsSub: "Recomendado: no. Nadie la salta; en una emergencia la apagas aquí.",
    ruleChecksHint: "Las pruebas exigidas se eligen en Pruebas › Exigir.",
    chipProtected: "protegida",
    chipOpen: "sin proteger",
    chipPlan: "GitHub no lo permite",
    roleOf: (b: string, pub: string): string => (b === pub ? "publicada" : "integración"),
    ruleText: (r: BranchRule) => (!r.on ? "sin regla" : [r.pr ? "solo por propuesta" : null, r.nodel ? "no se borra ni reescribe" : null, r.agents ? "los agentes pueden saltarla" : "nadie la salta"].filter(Boolean).join(" · ")),
    merges: "Cómo se fusionan las propuestas",
    mergeLabels: { squash: "Un solo commit por propuesta de ticket", promo_merge: "Commit de fusión al publicar", delete_on_merge: "Borrar la rama al fusionar", suggest_update: "Sugerir poner al día la rama" },
    squash: "Cada propuesta de ticket entra como un solo commit",
    squashSub: "El título de la propuesta es el commit. Fácil de revertir.",
    promo: (from: string, to: string) => `Publicar (${from} → ${to}): commit de fusión`,
    promoSub: "Squash al publicar repetiría commits y conflictos la próxima vez.",
    delOnMerge: "Borrar la rama al fusionar",
    delOnMergeSub: "Seguro si las ramas largas están protegidas.",
    suggest: "Sugerir poner al día la propuesta",
    suggestSub: "GitHub muestra un botón cuando la rama destino avanzó.",
    agentsRead: "Los agentes leen estos papeles en Plania (get_project y start) y no suponen nombres de ramas.",
    label: {
      repo: (r: string) => `Repositorio: ${r}`,
      folder: (f: string) => `Carpeta: ${f}`,
      roles: "Cómo se publica y qué es cada rama",
      rule: (b: string) => `Regla de GitHub para ${b}`,
      merge: "Cómo se fusionan las propuestas",
      deleteBranch: (b: string) => `Borrar la rama ${b}`,
    },
    yes: "sí",
    no: "no",
  },
  en: {
    lead: "Where the code is and what each branch means. Taller, QA and Release read this instead of guessing.",
    repo: "Repository",
    repoHint: "picked from your GitHub account",
    repoPaste: "or paste its link",
    repoCheck: "Use this one",
    repoBad: "That is not a GitHub link (github.com/owner/repo).",
    repoPasted: "pasted",
    repoChecking: "Looking it up on GitHub…",
    repoMissing: "GitHub did not find that repository with this project's key. Check the link or the key's permissions.",
    repoUnreachable: "Could not reach GitHub. Try again.",
    repoMeta: (vis: string, def: string, admin: boolean) => `${vis} · default branch ${def}${admin ? " · your permission: admin" : ""}`,
    noRepoYet: "No repository yet",
    folder: "Folder on this Mac",
    folderHint: "a clone of this repo, found in your projects folder",
    folderOk: "Checked: it is a clone of this repo",
    folderBad: "It is not a clone of this repo",
    folderNone: "I found no clones of this repo on this Mac.",
    noCode: "There is no code yet",
    noCodeSub: "The team works with no folder and no repository until it has them. Turn it off to pick its repository.",
    noCodeLabel: "Whether it has code",
    hasCode: "Has code",
    start: "The team's working branch",
    startHint: "where Taller starts and where what you accept goes",
    startInteg: (b: string) => `It is the integration branch (${b}): change it above, with the branches.`,
    startDefault: (b: string) => `Left empty: ${b}.`,
    startBad: "Not allowed: never a protected branch (main, master, production, prod) nor a name with spaces.",
    startLabel: "Working branch",
    howPublish: "How it is released",
    why: "Why",
    source: "Source",
    today: "today",
    recommended: "recommended",
    models: {
      trunk: { name: "One main branch", sub: "Every change enters the published branch by PR; every PR has its preview.", why: "Fewer branches drift apart and what was tested is what ships. DORA recommends few branches that live hours; Fowler calls branches per environment an antipattern." },
      integ: { name: "Integration branch", sub: "Tickets collect on one branch, and releasing merges it into the main one.", why: "Useful to test several changes together before releasing, or when releasing is not up to you (app stores). It costs: branches drift, merges pile up on the main branch and security updates always go to the default branch." },
      tags: { name: "Versions by tag", sub: "Everything enters main; a tag (v1.4.0) publishes a version that never changes.", why: "For apps people install and for libraries: every version is a fixed package you can go back to." },
    },
    integCost: (state: string, b: string) => `What it costs today: ${state}. Security updates always go to the default branch, not to ${b}.`,
    trunkMove: (pub: string) => `With one main branch, Release points at ${pub}. Taller keeps collecting accepted work on its working branch until you remove it.`,
    published: "Published branch",
    integration: "Integration branch",
    none: "None",
    work: "Work branches",
    workHint: "pattern",
    matches: (n: number, list: string) => (n ? `${n} ${n === 1 ? "branch matches" : "branches match"}: ${list}` : "No branch matches yet"),
    tableBranch: "Branch on GitHub",
    tableWhat: "What it is",
    tableState: "State",
    kinds: { publicada: "published", integracion: "integration", trabajo: "work", fuera: "outside (dependabot)", otra: "other" },
    state: (ahead: number | null, behind: number | null, def: string) => (ahead === null ? "—" : ahead === 0 && behind === 0 ? `same as ${def}` : `${ahead} ahead · ${behind ?? 0} behind ${def}`),
    protectedChip: "protected",
    deleteBranch: "Delete",
    willDelete: "will be deleted",
    rules: "GitHub rules",
    rulesFree: "Free on public repos",
    rulesPlan: "Not available on this plan",
    ruleOn: (b: string) => `Protect ${b}`,
    ruleOnSub: "A GitHub rule: free on public repos.",
    ruleOnPlan: "Private repo on the free plan: GitHub applies no rules. Plania enforces them on its own merges.",
    needAdmin: "Creating GitHub rules needs admin permission. This project's key does not have it.",
    ruleNoEnforce: "«PR only» and «cannot be deleted» are enforced by GitHub, and on this plan it cannot. What Plania does enforce: the checks you pick in Tests › Require.",
    rulePr: "Only through a PR",
    rulePrSub: "Nobody pushes directly. No required approvals: you work alone and GitHub does not let you approve your own.",
    ruleNodel: "Cannot be deleted or rewritten",
    ruleNodelSub: "Blocks deletion and force-push.",
    ruleAgents: "Agents may bypass it",
    ruleAgentsSub: "Recommended: no. Nobody bypasses it; in an emergency you turn it off here.",
    ruleChecksHint: "Required checks are picked in Tests › Require.",
    chipProtected: "protected",
    chipOpen: "not protected",
    chipPlan: "GitHub does not allow it",
    roleOf: (b: string, pub: string) => (b === pub ? "published" : "integration"),
    ruleText: (r: BranchRule) => (!r.on ? "no rule" : [r.pr ? "PR only" : null, r.nodel ? "no delete or rewrite" : null, r.agents ? "agents may bypass" : "nobody bypasses"].filter(Boolean).join(" · ")),
    merges: "How PRs merge",
    mergeLabels: { squash: "One commit per ticket PR", promo_merge: "Merge commit on release", delete_on_merge: "Delete the branch on merge", suggest_update: "Suggest updating the branch" },
    squash: "Ticket PRs: a single commit (squash)",
    squashSub: "The PR's title is the commit. Easy to revert.",
    promo: (from: string, to: string) => `Release (${from} → ${to}): merge commit`,
    promoSub: "Squashing on release would repeat commits and conflicts next time.",
    delOnMerge: "Delete the branch on merge",
    delOnMergeSub: "Safe when long-lived branches are protected.",
    suggest: "Suggest updating the PR",
    suggestSub: "GitHub shows a button when the target branch moved.",
    agentsRead: "Agents read these roles from Plania (get_project and start) and never assume branch names.",
    label: {
      repo: (r: string) => `Repository: ${r}`,
      folder: (f: string) => `Folder: ${f}`,
      roles: "How it is released and what each branch is",
      rule: (b: string) => `GitHub rule for ${b}`,
      merge: "How PRs merge",
      deleteBranch: (b: string) => `Delete the branch ${b}`,
    },
    yes: "yes",
    no: "no",
  },
});
export const codigoWords = (language: Language = getLanguage()) => words(CODIGO_WORDS, language);

/** A work-branch pattern as a regular expression: <anything> is one or more characters, the rest literal. */
export function patternRegex(pattern: string): RegExp | null {
  const t = pattern.trim();
  if (!t) return null;
  const parts = t.split(/<[^>]*>/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join(".+")}$`);
}
export const matchesOf = (pattern: string, branches: string[]): string[] => {
  const re = patternRegex(pattern);
  return re ? branches.filter((b) => re.test(b)) : [];
};

/** What a branch is, given the roles. */
export function kindOf(name: string, roles: { published: string; integration: string | null; work_pattern: string }): "publicada" | "integracion" | "trabajo" | "fuera" | "otra" {
  if (name === roles.published) return "publicada";
  if (roles.integration && name === roles.integration) return "integracion";
  if (/^dependabot\//.test(name) || /^renovate\//.test(name)) return "fuera";
  if (patternRegex(roles.work_pattern)?.test(name)) return "trabajo";
  return "otra";
}

/** The parsed owner/name from a pasted GitHub link or an owner/name, or null. */
export function repoFromLink(text: string): string | null {
  const t = text.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const m = t.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})$/) ?? t.match(/^git@github\.com:([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})$/) ?? t.match(/^([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})$/);
  return m ? m[1]! : null;
}

/** The branches the owner can pick for a role: real branches, without dependabot's. */
export const roleOptions = (branches: GhBranch[]): string[] => branches.map((b) => b.name).filter((n) => !/^(dependabot|renovate)\//.test(n));
