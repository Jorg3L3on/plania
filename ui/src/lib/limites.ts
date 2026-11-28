// PLA-I2-7: the words of the page «Lo que el equipo nunca puede hacer» (/machine/limites). The page is generated
// from the real rules: GET /api/limits reads the deny groups (src/runner/deny.ts) and the list of what leaves the
// machine (src/outbound.ts) and passes them through limitsPage() below. test/i2-7-limits.test.ts fails when a group,
// a rule's `does` or an outbound entry has no sentence here. Pure: no "@/" imports, because the server imports it.
// The owner's words: no rule syntax, no branch names, no ticket keys.
// PLA-I2-10: in both languages (LIMITS_WORDS); the server passes the install's language (src/language.ts). The
// English avoids the words main and production too: they read as branch names.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

/** Where the page lives; the first-start screen and Plomería link here. */
export const LIMITS_PATH = "/machine/limites";

type GroupWords = { title: string; lead: string; extra?: string };
type OutboundWords = { name: string; sentence: string };

export const LIMITS_WORDS = defineWords({
  es: {
    /** The link's words, wherever it is linked from; also the page's title. */
    link: "Lo que el equipo nunca puede hacer",
    /** One sentence per deny group (DENY_GROUPS ids). `extra` says when the group applies on top of the others. */
    groups: {
      "protected-branches": {
        title: "Nunca tocar la rama principal ni la de producción",
        lead: "Cada agente trabaja en una rama suya. La rama principal del proyecto y la de producción no las toca: lo que entra ahí lo decides tú.",
      },
      "force-push": {
        title: "Nunca reescribir lo que ya se subió",
        lead: "Ningún agente fuerza una subida que reemplace trabajo ya guardado en GitHub.",
      },
      "pull-requests": {
        title: "Nunca aceptar su propio trabajo",
        lead: "Un agente abre propuestas de cambio, pero no las mezcla, y no las dirige a la rama principal ni a la de producción.",
      },
      production: {
        title: "Nunca tocar producción",
        lead: "Ningún agente publica en producción ni se conecta a su base de datos.",
      },
      "plania-writes": {
        title: "Nunca cambiar las reglas de Plania",
        lead: "Ningún agente cambia los ajustes de un proyecto, el equipo o cómo se publica, ni contesta por ti.",
      },
      qa: {
        title: "Quien revisa no cambia nada",
        lead: "El agente que revisa una entrega solo lee y prueba. Plania guarda su informe.",
        extra: "Además de todo lo anterior, cuando revisa una entrega.",
      },
      preguntar: {
        title: "Quien contesta tus preguntas solo lee",
        lead: "Cuando le preguntas algo a un proyecto, el agente lee la carpeta del proyecto mismo, así que tampoco cambia archivos ni corre las herramientas de la app. Solo contesta.",
        extra: "Además de todo lo anterior y de lo de quien revisa, cuando contesta una pregunta tuya.",
      },
      probar: {
        title: "Una prueba de una habilidad no entrega nada",
        lead: "Cuando pruebas una habilidad en una entrega pasada, el agente trabaja en una copia aparte que se borra al terminar. No toca el plan, no guarda ni sube cambios y no toca la rama ni la propuesta de esa entrega.",
        extra: "Además de todo lo anterior, cuando pruebas una habilidad.",
      },
      "plania-self": {
        title: "Quien trabaja en Plania no toca el Plania que está corriendo",
        lead: "Cuando el proyecto es Plania mismo, el agente trabaja en su propia copia y nunca se conecta a la base de datos del Plania que usas, ni aplica migraciones, ni reinicia Plania: eso lo haces tú.",
        extra: "Además de todo lo anterior, cuando el proyecto es Plania mismo.",
      },
    } as Record<string, GroupWords>,
    /** One sentence per thing a rule stops (DenyRule.does). */
    does: {
      "push-protected": "Subir cambios a la rama principal o a la de producción.",
      "checkout-protected": "Cambiarse a la rama principal o a la de producción.",
      "merge-protected": "Mezclar su trabajo con la rama principal o con la de producción.",
      "reset-protected": "Tirar su trabajo para dejar su copia igual a la rama principal o a la de producción.",
      "move-protected": "Mover, borrar o reescribir la rama principal o la de producción.",
      "force-push": "Forzar una subida que reemplaza lo que ya estaba en GitHub.",
      "merge-pr": "Mezclar una propuesta de cambio, la suya o cualquier otra.",
      "pr-to-protected": "Abrir o dirigir una propuesta de cambio hacia la rama principal o la de producción.",
      "deploy-production": "Publicar en producción o pasar una versión a producción.",
      "production-database": "Conectarse a la base de datos de producción.",
      "set-env": "Cambiar los ambientes de un proyecto y cómo se publica.",
      "set-project": "Cambiar los ajustes de un proyecto.",
      "set-agent": "Cambiar quién está en el equipo y cómo se le despierta.",
      "answer-for-owner": "Contestar por ti una pregunta que solo tú contestas.",
      "create-project": "Crear un proyecto nuevo.",
      "edit-files": "Editar o escribir archivos.",
      commit: "Guardar cambios en la historia del código.",
      push: "Subir cambios a GitHub.",
      "move-branch": "Mover, deshacer, mezclar o limpiar su copia del código.",
      "change-pr": "Abrir, cambiar, comentar, aprobar o cerrar una propuesta de cambio.",
      "take-ticket": "Tomar, mover o terminar una tarea.",
      "post-thread": "Escribir en las conversaciones del equipo.",
      "change-files-shell": "Borrar, mover, copiar o crear archivos desde la terminal.",
      "run-tooling": "Correr las herramientas de la app: instalar, compilar o probar.",
      "git-sync": "Traer cambios de GitHub o crear ramas y copias.",
      "plan-writes": "Escribir en el plan: preguntas, tareas, documentos o imágenes.",
      "plania-in-trial": "Usar Plania mientras prueba una habilidad.",
      "live-database": "Conectarse a la base de datos del Plania que estás usando.",
      "apply-migrations": "Aplicar migraciones a una base de datos.",
      "restart-live": "Reiniciar el Plania que estás usando.",
    } as Record<string, string>,
    /** One name and sentence per destination (OUTBOUND ids, src/outbound.ts). */
    outbound: {
      claude: {
        name: "Claude",
        sentence: "Cada corrida, el resumen de la mañana y la revisión de la máquina usan el programa de Claude con tu cuenta. Lo que el agente lee para trabajar (código, tareas, documentos) llega a Anthropic.",
      },
      "github-read": {
        name: "GitHub, para leer",
        sentence: "Cada pocos minutos Plania lee las propuestas de cambio, sus revisiones y las ramas de los proyectos que tienen repositorio.",
      },
      "github-merge": {
        name: "GitHub, para mezclar",
        sentence: "Cuando das Aceptar o Lanzar, Plania abre y mezcla la propuesta en GitHub. Si encendiste la aceptación automática en un proyecto, también lo hace sola con las entregas que pasaron su revisión.",
      },
      "vercel-read": {
        name: "Vercel",
        sentence: "Si un proyecto tiene llave de Vercel, Plania lee sus publicaciones para saber qué está en línea. Nunca publica.",
      },
      push: {
        name: "Avisos al teléfono",
        sentence: "Si encendiste los avisos, Plania manda un aviso corto a tu teléfono por el servicio de avisos de Apple, Google o Mozilla.",
      },
      "qa-browser": {
        name: "El navegador de revisión",
        sentence: "La primera revisión en navegador descarga sus herramientas y el navegador que usa.",
      },
      connections: {
        name: "Las conexiones de cada agente",
        sentence: "Si le conectaste una herramienta a un agente, sus corridas la descargan con su versión fija y hablan con su servicio (GitHub, Neon, Sentry o Context7).",
      },
      "agent-wake": {
        name: "Agentes que se despiertan por internet",
        sentence: "Si un agente se despierta por una dirección web, Plania le manda ahí la clave de la tarea.",
      },
      tailscale: {
        name: "Tailscale",
        sentence: "Si abres una copia de prueba en tu teléfono, viaja por tu red privada de Tailscale.",
      },
      "scanner-download": {
        name: "El revisor de secretos",
        sentence: "La primera vez, el revisor de secretos descarga su herramienta de GitHub y comprueba que sea la esperada.",
      },
    } as Record<string, OutboundWords>,
    /** What only the owner does. Static: each line names where the screen enforces it. */
    ownerOnly: [
      "Contestar las preguntas que son solo tuyas. Las contestas en esta pantalla; ninguna corrida puede contestarlas por ti.",
      "Mezclar el trabajo en el código. Lo hace Plania cuando das Aceptar, o sola si tú encendiste la aceptación automática en un proyecto; nunca un agente.",
      "Lanzar una versión. Solo pasa cuando das Lanzar.",
      "Borrar un proyecto. Pide tu contraseña y, si lo configuraste, tu código del dueño.",
    ] as readonly string[],
    /** The honest paragraph: what the rules cannot stop. */
    cannot: [
      "Estas reglas las sigue el agente; no son un muro del sistema operativo. Plania se las da a Claude en cada corrida y Claude se niega a hacer lo que coincide con ellas, pero un comando escrito de otra forma puede no coincidir.",
      "Una corrida trabaja como tu usuario de esta máquina: puede leer cualquier archivo que tú puedes leer, incluidos tus otros proyectos y tus llaves, y puede usar internet. Lo que la contiene es que no tiene permiso para lo de arriba, que trabaja en su propia copia y que tú revisas y aceptas su trabajo.",
      "Si quieres un muro de verdad, corre Plania con un usuario propio de la máquina, o en una máquina aparte.",
    ] as readonly string[],
    whereCopy: (worktrees: string) =>
      `Cada agente trabaja en su propia copia del código, una por tarea, en ${worktrees}. Esa carpeta queda fuera de la carpeta de tu proyecto, y la copia sale de la rama de inicio del proyecto.`,
    whereAsk: "Quien contesta tus preguntas lee la carpeta del proyecto mismo, sin cambiar nada.",
    isolationOff: "Las corridas cargan también tus ajustes personales de Claude en esta máquina: tus skills y tus instrucciones.",
    isolationOn: "Las corridas no cargan tus ajustes personales de Claude: solo lo que Plania les da y lo del proyecto.",
    missing: "(sin palabras)",
    // The page (/machine/limites).
    kicker: "Tu equipo",
    intro: "Lo que tienen prohibido los agentes, lo que solo haces tú y lo que sale de esta máquina. Sale de las mismas reglas que Plania les da en cada corrida.",
    failed: "No se pudieron leer las reglas.",
    neverTitle: "Lo que un agente nunca puede hacer",
    ownerTitle: "Lo que solo haces tú",
    whereTitle: "Dónde trabajan los agentes",
    outboundTitle: "Lo que sale de esta máquina",
    cannotTitle: "Lo que estas reglas no pueden impedir",
    optional: "solo si lo configuras",
  },
  en: {
    link: "What the team can never do",
    groups: {
      "protected-branches": {
        title: "Never touch the primary branch or the live branch",
        lead: "Each agent works on a branch of its own. It does not touch the project's primary branch or its live branch: what goes in there is your call.",
      },
      "force-push": {
        title: "Never rewrite what was already pushed",
        lead: "No agent forces a push that replaces work already saved on GitHub.",
      },
      "pull-requests": {
        title: "Never accept its own work",
        lead: "An agent opens change proposals, but does not merge them, and does not aim them at the primary branch or the live branch.",
      },
      production: {
        title: "Never touch the live site",
        lead: "No agent publishes to the live site or connects to its database.",
      },
      "plania-writes": {
        title: "Never change Plania's rules",
        lead: "No agent changes a project's settings, the team or how it publishes, or answers for you.",
      },
      qa: {
        title: "Whoever reviews changes nothing",
        lead: "The agent that reviews a delivery only reads and tests. Plania keeps its report.",
        extra: "On top of all the above, when it reviews a delivery.",
      },
      preguntar: {
        title: "Whoever answers your questions only reads",
        lead: "When you ask a project something, the agent reads the project's own folder, so it does not change files or run the app's tools either. It only answers.",
        extra: "On top of all the above and the reviewer's limits, when it answers a question of yours.",
      },
      probar: {
        title: "A skill trial delivers nothing",
        lead: "When you try a skill on a past delivery, the agent works in a separate copy that is deleted when it ends. It does not touch the plan, does not save or push changes and does not touch that delivery's branch or proposal.",
        extra: "On top of all the above, when you try a skill.",
      },
      "plania-self": {
        title: "Whoever works on Plania does not touch the Plania that is running",
        lead: "When the project is Plania itself, the agent works in its own copy and never connects to the database of the Plania you use, applies migrations or restarts Plania: you do that.",
        extra: "On top of all the above, when the project is Plania itself.",
      },
    },
    does: {
      "push-protected": "Push changes to the primary branch or the live branch.",
      "checkout-protected": "Switch to the primary branch or the live branch.",
      "merge-protected": "Merge its work into the primary branch or the live branch.",
      "reset-protected": "Throw away its work to make its copy match the primary branch or the live branch.",
      "move-protected": "Move, delete or rewrite the primary branch or the live branch.",
      "force-push": "Force a push that replaces what was already on GitHub.",
      "merge-pr": "Merge a change proposal, its own or anyone else's.",
      "pr-to-protected": "Open a change proposal aimed at the primary branch or the live branch, or point one there.",
      "deploy-production": "Publish to the live site or promote a version to it.",
      "production-database": "Connect to the live site's database.",
      "set-env": "Change a project's environments and how it publishes.",
      "set-project": "Change a project's settings.",
      "set-agent": "Change who is on the team and how they are woken.",
      "answer-for-owner": "Answer for you a question only you answer.",
      "create-project": "Create a new project.",
      "edit-files": "Edit or write files.",
      commit: "Save changes to the code's history.",
      push: "Push changes to GitHub.",
      "move-branch": "Move, undo, merge or clean up its copy of the code.",
      "change-pr": "Open, change, comment on, approve or close a change proposal.",
      "take-ticket": "Take, move or finish a task.",
      "post-thread": "Write in the team's conversations.",
      "change-files-shell": "Delete, move, copy or create files from the terminal.",
      "run-tooling": "Run the app's tools: install, build or test.",
      "git-sync": "Fetch changes from GitHub or create branches and copies.",
      "plan-writes": "Write to the plan: questions, tasks, documents or images.",
      "plania-in-trial": "Use Plania while it tries a skill.",
      "live-database": "Connect to the database of the Plania you are using.",
      "apply-migrations": "Apply migrations to a database.",
      "restart-live": "Restart the Plania you are using.",
    },
    outbound: {
      claude: {
        name: "Claude",
        sentence: "Every run, the morning brief and the machine check use the Claude program with your account. What the agent reads to work (code, tasks, documents) reaches Anthropic.",
      },
      "github-read": {
        name: "GitHub, to read",
        sentence: "Every few minutes Plania reads the change proposals, their reviews and the branches of the projects that have a repository.",
      },
      "github-merge": {
        name: "GitHub, to merge",
        sentence: "When you press Accept or Release, Plania opens and merges the proposal on GitHub. If you turned on automatic acceptance in a project, it also does that on its own for deliveries that passed their review.",
      },
      "vercel-read": {
        name: "Vercel",
        sentence: "If a project has a Vercel key, Plania reads its deployments to know what is online. It never publishes.",
      },
      push: {
        name: "Phone notifications",
        sentence: "If you turned notifications on, Plania sends a short notice to your phone through Apple's, Google's or Mozilla's notification service.",
      },
      "qa-browser": {
        name: "The review browser",
        sentence: "The first review in a browser downloads its tools and the browser it uses.",
      },
      connections: {
        name: "Each agent's connections",
        sentence: "If you connected a tool to an agent, its runs download it at its pinned version and talk to its service (GitHub, Neon, Sentry or Context7).",
      },
      "agent-wake": {
        name: "Agents woken over the internet",
        sentence: "If an agent is woken at a web address, Plania sends it the task's key there.",
      },
      tailscale: {
        name: "Tailscale",
        sentence: "If you open a test copy on your phone, it travels over your private Tailscale network.",
      },
      "scanner-download": {
        name: "The secrets scanner",
        sentence: "The first time, the secrets scanner downloads its tool from GitHub and checks that it is the expected one.",
      },
    },
    ownerOnly: [
      "Answering the questions that are yours alone. You answer them on this screen; no run can answer them for you.",
      "Merging work into the code. Plania does it when you press Accept, or on its own if you turned on automatic acceptance in a project; never an agent.",
      "Releasing a version. It only happens when you press Release.",
      "Deleting a project. It asks for your password and, if you set one up, your owner code.",
    ],
    cannot: [
      "The agent follows these rules; they are not a wall built by the operating system. Plania gives them to Claude on every run and Claude refuses to do what matches them, but a command written another way may not match.",
      "A run works as your user on this machine: it can read any file you can read, including your other projects and your keys, and it can use the internet. What holds it in is that it has no permission for the above, that it works in its own copy, and that you review and accept its work.",
      "If you want a real wall, run Plania under a machine user of its own, or on a separate machine.",
    ],
    whereCopy: (worktrees: string) =>
      `Each agent works in its own copy of the code, one per task, in ${worktrees}. That folder sits outside your project's folder, and the copy comes from the project's starting branch.`,
    whereAsk: "Whoever answers your questions reads the project's own folder, without changing anything.",
    isolationOff: "Runs also load your personal Claude settings on this machine: your skills and your instructions.",
    isolationOn: "Runs do not load your personal Claude settings: only what Plania gives them and what is in the project.",
    missing: "(no words)",
    kicker: "Your team",
    intro: "What the agents may not do, what only you do and what leaves this machine. It comes from the same rules Plania gives them on every run.",
    failed: "The rules could not be read.",
    neverTitle: "What an agent can never do",
    ownerTitle: "What only you do",
    whereTitle: "Where the agents work",
    outboundTitle: "What leaves this machine",
    cannotTitle: "What these rules cannot stop",
    optional: "only if you set it up",
  },
});

/** The link's words in the screen's language (fixed for the page load), wherever it is linked from. */
export const LIMITS_LINK = words(LIMITS_WORDS).link;

// The Spanish lists under their first names, for readers that predate the two languages.
export const GROUP_WORDS: Record<string, GroupWords> = LIMITS_WORDS.es.groups;
export const DOES_WORDS: Record<string, string> = LIMITS_WORDS.es.does;
export const OUTBOUND_WORDS: Record<string, OutboundWords> = LIMITS_WORDS.es.outbound;
export const OWNER_ONLY: readonly string[] = LIMITS_WORDS.es.ownerOnly;
export const RULES_CANNOT: readonly string[] = LIMITS_WORDS.es.cannot;

export type LimitsInput = {
  groups: { id: string; does: string[]; rules: number }[];
  /** Ids of the groups every run carries; the others apply on top in their own runs. */
  everyRun: string[];
  outbound: { id: string; optional: boolean }[];
  /** Where the agents' own copies live (the worktrees folder). */
  worktrees: string;
  /** PLANIA_RUN_ISOLATION as the runner reads it. */
  isolation: "project" | "bare" | null;
};

export type LimitsPage = {
  never: { id: string; title: string; lead: string; extra: string | null; items: string[]; rules: number }[];
  owner_only: string[];
  where: string[];
  outbound: { id: string; name: string; sentence: string; optional: boolean }[];
  cannot: string[];
};

/** The page, from the rules. A missing sentence shows as the `missing` words; the test keeps that from shipping. */
export function limitsPage(input: LimitsInput, language: Language = getLanguage()): LimitsPage {
  const t = words(LIMITS_WORDS, language);
  const MISSING = t.missing;
  const never = input.groups.map((g) => {
    const w = t.groups[g.id];
    return {
      id: g.id,
      title: w?.title ?? MISSING,
      lead: w?.lead ?? MISSING,
      extra: input.everyRun.includes(g.id) ? null : (w?.extra ?? MISSING),
      items: [...new Set(g.does)].map((d) => t.does[d] ?? MISSING),
      rules: g.rules,
    };
  });
  return {
    never,
    owner_only: [...t.ownerOnly],
    where: [t.whereCopy(input.worktrees), t.whereAsk, input.isolation === null ? t.isolationOff : t.isolationOn],
    outbound: input.outbound.map((o) => ({ id: o.id, name: t.outbound[o.id]?.name ?? MISSING, sentence: t.outbound[o.id]?.sentence ?? MISSING, optional: o.optional })),
    cannot: [...t.cannot],
  };
}
