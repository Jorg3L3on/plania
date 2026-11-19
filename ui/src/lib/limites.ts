// PLA-I2-7: the words of the page «Lo que el equipo nunca puede hacer» (/machine/limites). The page is generated
// from the real rules: GET /api/limits reads the deny groups (src/runner/deny.ts) and the list of what leaves the
// machine (src/outbound.ts) and passes them through limitsPage() below. test/i2-7-limits.test.ts fails when a group,
// a rule's `does` or an outbound entry has no sentence here. Pure: no "@/" imports, because the server imports it.
// The owner's words: no rule syntax, no branch names, no ticket keys.

/** Where the page lives; the first-start screen and Plomería link here. */
export const LIMITS_PATH = "/machine/limites";
/** The link's words, wherever it is linked from. */
export const LIMITS_LINK = "Lo que el equipo nunca puede hacer";

/** One sentence per deny group (DENY_GROUPS ids). `extra` says when the group applies on top of the others. */
export const GROUP_WORDS: Record<string, { title: string; lead: string; extra?: string }> = {
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
  "plania-self": {
    title: "Quien trabaja en Plania no toca el Plania que está corriendo",
    lead: "Cuando el proyecto es Plania mismo, el agente trabaja en su propia copia y nunca se conecta a la base de datos del Plania que usas, ni aplica migraciones, ni reinicia Plania: eso lo haces tú.",
    extra: "Además de todo lo anterior, cuando el proyecto es Plania mismo.",
  },
};

/** One sentence per thing a rule stops (DenyRule.does). */
export const DOES_WORDS: Record<string, string> = {
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
  "live-database": "Conectarse a la base de datos del Plania que estás usando.",
  "apply-migrations": "Aplicar migraciones a una base de datos.",
  "restart-live": "Reiniciar el Plania que estás usando.",
};

/** One name and sentence per destination (OUTBOUND ids, src/outbound.ts). */
export const OUTBOUND_WORDS: Record<string, { name: string; sentence: string }> = {
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
};

/** What only the owner does. Static: each line names where the screen enforces it. */
export const OWNER_ONLY: readonly string[] = [
  "Contestar las preguntas que son solo tuyas. Las contestas en esta pantalla; ninguna corrida puede contestarlas por ti.",
  "Mezclar el trabajo en el código. Lo hace Plania cuando das Aceptar, o sola si tú encendiste la aceptación automática en un proyecto; nunca un agente.",
  "Lanzar una versión. Solo pasa cuando das Lanzar.",
  "Borrar un proyecto. Pide tu contraseña y, si lo configuraste, tu código del dueño.",
];

/** The honest paragraph: what the rules cannot stop. */
export const RULES_CANNOT = [
  "Estas reglas las sigue el agente; no son un muro del sistema operativo. Plania se las da a Claude en cada corrida y Claude se niega a hacer lo que coincide con ellas, pero un comando escrito de otra forma puede no coincidir.",
  "Una corrida trabaja como tu usuario de esta máquina: puede leer cualquier archivo que tú puedes leer, incluidos tus otros proyectos y tus llaves, y puede usar internet. Lo que la contiene es que no tiene permiso para lo de arriba, que trabaja en su propia copia y que tú revisas y aceptas su trabajo.",
  "Si quieres un muro de verdad, corre Plania con un usuario propio de la máquina, o en una máquina aparte.",
] as const;

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

const MISSING = "(sin palabras)";

/** The page, from the rules. A missing sentence shows as MISSING; the test keeps that from shipping. */
export function limitsPage(input: LimitsInput): LimitsPage {
  const never = input.groups.map((g) => {
    const w = GROUP_WORDS[g.id];
    return {
      id: g.id,
      title: w?.title ?? MISSING,
      lead: w?.lead ?? MISSING,
      extra: input.everyRun.includes(g.id) ? null : (w?.extra ?? MISSING),
      items: [...new Set(g.does)].map((d) => DOES_WORDS[d] ?? MISSING),
      rules: g.rules,
    };
  });
  const isolation =
    input.isolation === null
      ? "Las corridas cargan también tus ajustes personales de Claude en esta máquina: tus skills y tus instrucciones."
      : "Las corridas no cargan tus ajustes personales de Claude: solo lo que Plania les da y lo del proyecto.";
  return {
    never,
    owner_only: [...OWNER_ONLY],
    where: [
      `Cada agente trabaja en su propia copia del código, una por tarea, en ${input.worktrees}. Esa carpeta queda fuera de la carpeta de tu proyecto, y la copia sale de la rama de inicio del proyecto.`,
      "Quien contesta tus preguntas lee la carpeta del proyecto mismo, sin cambiar nada.",
      isolation,
    ],
    outbound: input.outbound.map((o) => ({ id: o.id, name: OUTBOUND_WORDS[o.id]?.name ?? MISSING, sentence: OUTBOUND_WORDS[o.id]?.sentence ?? MISSING, optional: o.optional })),
    cannot: [...RULES_CANNOT],
  };
}
