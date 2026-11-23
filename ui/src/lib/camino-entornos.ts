// PLA-I68-6: Camino's environments, any number. Pure helpers and words for the screen (test/i68-6-entornos.test.ts):
// a new environment of a kind, the variables an environment lacks (names only), what each service can do and what its
// rollback restores, what Publicar will do with production's database settings, and the freeze window.
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import type { CaminoEnv, EnvKind, MigrateWhen, ProviderId } from "./camino-types.js";

export const KINDS: EnvKind[] = ["temporal", "permanente", "produccion", "versiones"];
export const MIGRATE_WHEN: MigrateWhen[] = ["paso", "build", "llegar", "mano", "nunca"];
/** Services that list what a saved key opens (src/camino/envs.ts ADAPTERS). */
export const LISTABLE: ProviderId[] = ["vercel", "neon", "github_releases"];

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || "entorno";

export function newEnv(existing: CaminoEnv[], kind: EnvKind, name: string, branch: string): CaminoEnv {
  let id = slug(name);
  for (let i = 2; existing.some((e) => e.id === id); i++) id = `${slug(name)}-${i}`;
  const prod = kind === "produccion";
  return {
    id,
    name,
    kind,
    runs: kind === "temporal" ? { kind: "pr" } : kind === "versiones" ? { kind: "tags", pattern: "v*" } : { kind: "branch", branch },
    url: null,
    server: { provider: null, project: null, note: null },
    database: kind === "versiones" ? null : { provider: null, name: null, data: prod ? "real" : "falsos", roles_split: false, migrate_when: prod ? "paso" : "llegar", lock: false, sql_review: prod, approve_destructive: prod, backup: prod ? "proveedor" : "ninguna" },
    vars: [],
    health: { url: null, pages: [] },
    publisher: "owner",
    freeze: false,
    record: prod ? "prod" : null,
  };
}

/** The .env.example names an environment lacks, and the ones it has; never a value. */
export function varsDiff(example: string[], present: string[]): { ok: string[]; missing: string[] } {
  return { ok: example.filter((n) => present.includes(n)), missing: example.filter((n) => !present.includes(n)) };
}

/** Who migrates production, as Publicar will read it (src/camino/prod.ts prodMigrationsFromEnv). */
export function whoMigrates(e: CaminoEnv): "deploy" | "owner" | "none" | null {
  if (!e.database) return "none";
  if (!e.database.provider) return null;
  const w = e.database.migrate_when;
  return w === "paso" || w === "build" || w === "llegar" ? "deploy" : w === "mano" ? "owner" : "none";
}

/** PLA-158 (F-25): the anchor of one part of an environment's editor, which opens Modo experto on it. */
export const envFocus = (env: string, part: "base" | "cuando"): string => `env-${env}-${part}`;

type DbSettings = NonNullable<CaminoEnv["database"]>;
/** PLA-158 (F-25): production's «Usar lo recomendado». It set the SQL review, the approval and the backup but not when
 * it migrates, so Publicar kept waiting: who migrates needs the database's service and a moment (prodMigrationsFromEnv).
 * Now the moment is the recommended «paso» whenever the service is known (the environment's own, else a database
 * service with a saved key), and when it is not, missing says so: that one field is the owner's to pick. */
export function prodRecommended(db: DbSettings, known: ProviderId | null = null): { patch: Partial<DbSettings>; done: boolean; missing: "provider" | null } {
  const provider = db.provider ?? known;
  const patch: Partial<DbSettings> = { sql_review: true, approve_destructive: true, backup: db.backup === "ninguna" ? "proveedor" : db.backup, ...(provider ? { provider, migrate_when: "paso" as const } : {}) };
  const done = db.sql_review && db.approve_destructive && db.backup !== "ninguna" && !!db.provider && db.migrate_when === "paso";
  return { patch, done, missing: provider ? null : "provider" };
}

/** The SQL to give an app its own users instead of the database owner (run by the owner; Plania never holds them). */
export function rolesSql(db: string): string {
  const d = db.replace(/[^A-Za-z0-9_]/g, "_") || "app";
  return [
    `-- ${d}: three users instead of the owner. Choose the passwords yourself; Plania never sees them.`,
    `CREATE ROLE ${d}_migrate LOGIN PASSWORD '…';`,
    `GRANT CREATE, USAGE ON SCHEMA public TO ${d}_migrate;`,
    `CREATE ROLE ${d}_app LOGIN PASSWORD '…';`,
    `GRANT USAGE ON SCHEMA public TO ${d}_app;`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${d}_migrate IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${d}_app;`,
    `CREATE ROLE ${d}_read LOGIN PASSWORD '…';`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${d}_migrate IN SCHEMA public GRANT SELECT ON TABLES TO ${d}_read;`,
  ].join("\n");
}

/** Friday from 18:00 on this machine's clock. */
export const inFreeze = (now: Date): boolean => now.getDay() === 5 && now.getHours() >= 18;

export const ENTORNOS_WORDS = defineWords({
  es: {
    kinds: { temporal: "temporal", permanente: "permanente", produccion: "producción", versiones: "versiones" } as Record<EnvKind, string>,
    leadKind: { temporal: "Uno por propuesta, que se borra al cerrarla", permanente: "Donde se prueba", produccion: "Lo que usa la gente", versiones: "Versiones que la gente descarga e instala" } as Record<EnvKind, string>,
    name: "Nombre",
    kind: "Qué es",
    runs: "Qué corre aquí",
    runsOpts: { branch: "Una rama", pr: "Cada propuesta", promote: "El build probado de otro entorno", tags: "Etiquetas", none: "Todavía nada" } as Record<string, string>,
    branch: "Rama",
    from: "De qué entorno",
    pattern: "Patrón de etiqueta",
    promoteNote: "Lo ideal es publicar el mismo build que se probó. Algunos servicios lo vuelven a construir al promover; lo dice su tarjeta.",
    url: "Dirección",
    urlHint: "de los dominios del servicio cuando está conectado",
    server: "Servidor",
    db: "Base de datos",
    none: "Ninguno",
    noneDb: "Sin base",
    paid: "de pago",
    pickFirst: "Elige un servicio",
    project: "Proyecto en el servicio",
    connectToPick: (s: string) => `Conecta ${s} para elegir de tus proyectos.`,
    connect: "Conectar",
    loading: "Leyendo…",
    nothingThere: "La llave no abre ningún proyecto.",
    keyRefused: (s: string) => `${s} rechazó la llave guardada: no es que no tengas proyectos. Cámbiala en Conexiones y llaves.`,
    rollback: "Volver atrás",
    manualTitle: "Cómo se hace a mano",
    manualLead: "Escribe cómo se despliega y cómo se vuelve atrás. Plania lo guarda en este entorno y lo muestra; nunca corre estos comandos.",
    manualDeploy: "Comando que despliega",
    manualRollback: "Comando que vuelve atrás",
    manualCheck: "Qué comprobar después (una cosa por línea)",
    window: "Ventana para restaurar",
    dbName: "Base",
    dbNameHint: "de las bases de esta Mac",
    ownDb: "la del proyecto",
    data: "Datos",
    dataOpts: { falsos: "Falsos (semilla)", copia: "Copia sin datos personales", real: "Reales" } as Record<string, string>,
    realNote: "Datos reales: ningún agente se conecta aquí. Solo el paso de migrar, con tu aprobación si borra algo.",
    tool: (t: string, dir: string) => `Migraciones: ${t} · ${dir}`,
    history: (n: number, total: number) => `${n} aplicadas de ${total} en el código`,
    historyRead: "Leer cuántas se aplicaron",
    roles: "Usar tres usuarios: migrar, app, solo lectura",
    rolesSub: "Mejor que el dueño de la base. Corres tú el SQL; Plania nunca ve las contraseñas.",
    when: "Cuándo se migra",
    whenOpts: {
      paso: { name: "Paso propio, antes del tráfico", sub: "Después de construir la versión y antes de que reciba visitas. Con copia y candado." },
      build: { name: "Dentro de la construcción de la versión", sub: "Solo si el servicio no tiene paso propio. Con candado y solo cambios que agregan." },
      llegar: { name: "Al llegar a la rama", sub: "Para bases con datos falsos." },
      mano: { name: "A mano", sub: "Alguien la corre. Fácil de olvidar." },
      nunca: { name: "Al arrancar la app", sub: "No: cada reinicio o copia de la app migraría a la vez." },
    } as Record<MigrateWhen, { name: string; sub: string }>,
    recommended: "recomendado",
    today: "hoy",
    lock: "Candado para que dos builds no migren a la vez",
    lockSub: "Un candado de la base evita que dos migren a la vez.",
    sqlReview: "Revisar el SQL antes de migrar",
    sqlReviewSub: "Una revisión gratuita avisa si una migración borra datos o bloquea tablas.",
    approve: "Pedir mi aprobación si una migración borra datos",
    approveSub: "Atada a ese archivo: si cambia, se vuelve a pedir. Un agente nunca puede aprobar.",
    backup: "Copia antes de migrar",
    backupOpts: { proveedor: "La del servicio (rama o punto en el tiempo)", dump: "Un respaldo completo de la base, hecho en esta Mac", ninguna: "Ninguna" } as Record<string, string>,
    restoreNote: "Restaurar la copia borra lo que la gente guardó después. Si lo roto es el código, se vuelve atrás el código; la base solo si los datos se dañaron.",
    publicar: (who: string) => `Publicar lee esto: ${who}`,
    who: { deploy: "el despliegue migra producción", owner: "tú migras producción a mano", none: "no hay base que migrar" } as Record<string, string>,
    vars: "Variables",
    varsHint: "Nombres de .env.example contra el servicio; nunca los valores.",
    varsNoKey: "Conecta el servicio para comparar sus variables; mientras, marca las que ya están.",
    varsNone: "No hay .env.example en esta Mac.",
    missing: (n: string) => `falta ${n}`,
    health: "Comprobar que abre",
    healthUrl: "Dirección de salud",
    healthHint: "responde en menos de 5 s y revisa la base",
    pages: "Páginas que abrir después de publicar",
    pagesHint: "de las páginas que ya conoce El Probador",
    freeze: "No publicar viernes después de las 18:00",
    freezeSub: "Una ventana sin publicaciones.",
    whoPublishes: "Quién",
    onlyYou: "Solo tú publicas aquí. Los agentes piden «desplegar» o «volver atrás» y Plania lo hace con su llave.",
    // PLA-132: how the release step ships, moved here from Ajustes.
    merge: "Fusionar desde Plania",
    mergeSub: "Encendido, publicas con un botón en Bandeja. Apagado, Plania te da el comando para correrlo tú.",
    mergeOn: "Desde Plania",
    mergeOff: "Con el comando",
    // PLA-133: what counts as released and Vercel's deployments, moved here from Ajustes › Avanzado.
    published: "Qué cuenta como publicado",
    publishedSub: "Un paso se cierra como publicado cuando pasa esto.",
    publishedOpts: { auto: "Plania lo decide", env: "El entorno corre el cambio", branch: "La rama publicada lo tiene" } as Record<"auto" | "env" | "branch", string>,
    target: "El entorno que cuenta",
    targetDefault: "prod, por defecto",
    publishedLabel: "Qué cuenta como publicado",
    vercelRead: "Leer los despliegues de Vercel",
    vercelReadSub: "Plania ya lee cada despliegue del proyecto que elegiste arriba con la llave de Conexiones. Llénalo solo para leer otro proyecto u otra llave.",
    vercelProject: "Id del proyecto en Vercel",
    vercelProjectHint: "empieza con prj_; está en Settings del proyecto",
    vercelTeam: "Id del equipo",
    vercelTeamHint: "solo si el proyecto es de un equipo",
    vercelKey: "Variable con la llave",
    vercelKeyHint: "si la dejas vacía: la llave guardada en Conexiones, o VERCEL_TOKEN",
    vercelProd: "Producción de Vercel cuenta como",
    vercelPreview: "Vista previa de Vercel cuenta como",
    vercelLabel: "Despliegues de Vercel",
    vercelOn: "Se leen",
    vercelOff: "No se leen",
    vercelNeedsId: "Falta el id del proyecto.",
    vercelTargetBad: "Va el nombre de un entorno: minúsculas, números, - y _.",
    varBad: "Va el NOMBRE de la variable (mayúsculas, números y _), nunca la llave.",
    add: "+ Agregar entorno",
    addTitle: "Agregar un entorno",
    addName: "Nombre",
    addCreate: "Agregar",
    addCancel: "Cancelar",
    remove: "Quitar este entorno",
    removeNote: "Su registro en Plania se queda con su historia.",
    label: (n: string) => `Entornos: ${n}`,
    record: (r: string) => `lo que Plania sabe de ${r}`,
    detected: "detectado",
    edited: "con cambios",
  },
  en: {
    kinds: { temporal: "temporary", permanente: "long-lived", produccion: "production", versiones: "versions" } as Record<EnvKind, string>,
    leadKind: { temporal: "One per PR, deleted when it closes", permanente: "Where things are tested", produccion: "What people use", versiones: "Versions people download and install" } as Record<EnvKind, string>,
    name: "Name",
    kind: "What it is",
    runs: "What runs here",
    runsOpts: { branch: "A branch", pr: "Each PR", promote: "Another environment's tested build", tags: "Tags", none: "Nothing yet" } as Record<string, string>,
    branch: "Branch",
    from: "From which environment",
    pattern: "Tag pattern",
    promoteNote: "Ideally the build that was tested is the one released. Some services rebuild on promote; its card says so.",
    url: "Address",
    urlHint: "from the service's domains when it is connected",
    server: "Server",
    db: "Database",
    none: "None",
    noneDb: "No database",
    paid: "paid",
    pickFirst: "Pick a service",
    project: "Project on the service",
    connectToPick: (s: string) => `Connect ${s} to pick from your projects.`,
    connect: "Connect",
    loading: "Reading…",
    nothingThere: "The key opens no project.",
    keyRefused: (s: string) => `${s} refused the saved key: it is not that you have no projects. Change it in Connections and keys.`,
    rollback: "Rollback",
    manualTitle: "How it is done by hand",
    manualLead: "Write how it deploys and how it rolls back. Plania keeps it on this environment and shows it; it never runs these commands.",
    manualDeploy: "Command that deploys",
    manualRollback: "Command that rolls back",
    manualCheck: "What to check afterwards (one per line)",
    window: "Restore window",
    dbName: "Database",
    dbNameHint: "from this Mac's databases",
    ownDb: "the project's",
    data: "Data",
    dataOpts: { falsos: "Fake (seed)", copia: "Copy without personal data", real: "Real" } as Record<string, string>,
    realNote: "Real data: no agent connects here. Only the migrate step, with your approval if it deletes anything.",
    tool: (t: string, dir: string) => `Migrations: ${t} · ${dir}`,
    history: (n: number, total: number) => `${n} applied of ${total} in the code`,
    historyRead: "Read how many were applied",
    roles: "Use three users: migrate, app, read-only",
    rolesSub: "Better than the database owner. You run the SQL; Plania never sees the passwords.",
    when: "When it migrates",
    whenOpts: {
      paso: { name: "Its own step, before traffic", sub: "After the build and before the new code gets visits. With a backup and a lock." },
      build: { name: "Inside the build", sub: "Only if the service has no step of its own. With a lock and additive changes only." },
      llegar: { name: "When it reaches the branch", sub: "For databases with fake data." },
      mano: { name: "By hand", sub: "Someone runs it. Easy to forget." },
      nunca: { name: "When the app starts", sub: "No: every restart or app copy would migrate at once." },
    } as Record<MigrateWhen, { name: string; sub: string }>,
    recommended: "recommended",
    today: "today",
    lock: "A lock so two builds never migrate at once",
    lockSub: "pg_try_advisory_lock before migrating.",
    sqlReview: "Review the SQL before migrating",
    sqlReviewSub: "squawk warns when a migration deletes data or locks tables. It is free.",
    approve: "Ask for my approval when a migration deletes data",
    approveSub: "Tied to that file: if it changes, it asks again. An agent can never approve.",
    backup: "Backup before migrating",
    backupOpts: { proveedor: "The service's (branch or point in time)", dump: "pg_dump on this Mac", ninguna: "None" } as Record<string, string>,
    restoreNote: "Restoring a backup erases what people saved afterwards. If the code is what broke, roll the code back; the database only if the data was damaged.",
    publicar: (who: string) => `Release reads this: ${who}`,
    who: { deploy: "the deploy migrates production", owner: "you migrate production by hand", none: "there is no database to migrate" } as Record<string, string>,
    vars: "Variables",
    varsHint: ".env.example names against the service; never the values.",
    varsNoKey: "Connect the service to compare its variables; meanwhile, mark the ones already there.",
    varsNone: "There is no .env.example on this Mac.",
    missing: (n: string) => `missing ${n}`,
    health: "Check that it opens",
    healthUrl: "Health address",
    healthHint: "answers in under 5 s and checks the database",
    pages: "Pages to open after releasing",
    pagesHint: "from the pages El Probador already knows",
    freeze: "No releases on Friday after 18:00",
    freezeSub: "A window with no releases.",
    whoPublishes: "Who",
    onlyYou: "Only you release here. Agents ask to «deploy» or «roll back» and Plania does it with its key.",
    merge: "Merge from Plania",
    mergeSub: "On, you release with a button in Inbox. Off, Plania gives you the command to run yourself.",
    mergeOn: "From Plania",
    mergeOff: "With the command",
    published: "What counts as released",
    publishedSub: "A step closes as released when this happens.",
    publishedOpts: { auto: "Plania decides", env: "The environment runs the change", branch: "The published branch has it" } as Record<"auto" | "env" | "branch", string>,
    target: "The environment that counts",
    targetDefault: "prod, by default",
    publishedLabel: "What counts as released",
    vercelRead: "Read Vercel's deployments",
    vercelReadSub: "Plania already reads every deployment of the project picked above, with the key in Connections. Fill this in only to read another project or another key.",
    vercelProject: "Vercel project id",
    vercelProjectHint: "starts with prj_; it is in the project's Settings",
    vercelTeam: "Team id",
    vercelTeamHint: "only if the project belongs to a team",
    vercelKey: "Variable with the key",
    vercelKeyHint: "left empty: the key saved in Connections, or VERCEL_TOKEN",
    vercelProd: "Vercel production counts as",
    vercelPreview: "Vercel preview counts as",
    vercelLabel: "Vercel deployments",
    vercelOn: "Read",
    vercelOff: "Not read",
    vercelNeedsId: "The project id is missing.",
    vercelTargetBad: "An environment's name goes here: lowercase, digits, - and _.",
    varBad: "The variable's NAME goes here (capitals, digits and _), never the key.",
    add: "+ Add an environment",
    addTitle: "Add an environment",
    addName: "Name",
    addCreate: "Add",
    addCancel: "Cancel",
    remove: "Remove this environment",
    removeNote: "Its record in Plania stays with its history.",
    label: (n: string) => `Environments: ${n}`,
    record: (r: string) => `record ${r}`,
    detected: "detected",
    edited: "changed",
  },
});
export const entornosWords = (language: Language = getLanguage()) => words(ENTORNOS_WORDS, language);

/** What a service's rollback restores and how long a backup can be restored, from the research. */
export const ROLLBACK_WORDS = defineWords({
  es: {
    vercel: { rollback: "Al instante, solo dominios: las variables no vuelven.", window: "Despliegues anteriores, mientras existan" },
    netlify: { rollback: "Restaurar un despliegue publicado antes.", window: "Despliegues anteriores, mientras existan" },
    render: { rollback: "Con build y variables de ese momento.", window: "Los últimos despliegues" },
    railway: { rollback: "Si el servicio lo permite en su plan.", window: "Los últimos despliegues" },
    fly: { rollback: "Redesplegar la imagen anterior (no hay comando de volver).", window: "Mientras exista la imagen" },
    cloudflare: { rollback: "Entre las últimas 100 versiones.", window: "100 versiones" },
    github_releases: { rollback: "Marcar la versión anterior como la última.", window: "Todas las versiones publicadas" },
    mac_service: { rollback: "Con tu comando, si guardas la versión anterior.", window: "La que guardes" },
    own_server: { rollback: "Con tu comando.", window: "La que guardes" },
    neon: { rollback: "Restaurar a un punto en el tiempo o a una rama.", window: "Plan gratis: 6 horas" },
    supabase: { rollback: "Copias automáticas en planes de pago; en el gratis, el volcado que hace Plania.", window: "Plan gratis: ninguna automática" },
    planetscale: { rollback: "Copias cada 12 horas.", window: "Según el plan (sin plan gratis)" },
    postgres: { rollback: "pg_restore de la copia que hace Plania.", window: "La que guardes" },
    mysql: { rollback: "La copia de mysqldump.", window: "La que guardes" },
    local_postgres: { rollback: "La copia que Plania hace antes de migrar.", window: "La que guardes" },
  } as Record<string, { rollback: string; window: string }>,
  en: {
    vercel: { rollback: "Instant, domains only: variables do not roll back.", window: "Earlier deployments, while they exist" },
    netlify: { rollback: "Restore a deployment published before.", window: "Earlier deployments, while they exist" },
    render: { rollback: "With the build and variables of that moment.", window: "The last deployments" },
    railway: { rollback: "If the service allows it on its plan.", window: "The last deployments" },
    fly: { rollback: "Redeploy the previous image (no rollback command).", window: "While the image exists" },
    cloudflare: { rollback: "Among the last 100 versions.", window: "100 versions" },
    github_releases: { rollback: "Mark the previous version as latest.", window: "Every published version" },
    mac_service: { rollback: "With your command, if you keep the previous version.", window: "Whatever you keep" },
    own_server: { rollback: "With your command.", window: "Whatever you keep" },
    neon: { rollback: "Restore to a point in time or to a branch.", window: "Free plan: 6 hours" },
    supabase: { rollback: "Automatic backups on paid plans; on free, the dump Plania takes.", window: "Free plan: no automatic one" },
    planetscale: { rollback: "Backups every 12 hours.", window: "Depends on the plan (no free plan)" },
    postgres: { rollback: "pg_restore of the backup Plania takes.", window: "Whatever you keep" },
    mysql: { rollback: "The mysqldump backup.", window: "Whatever you keep" },
    local_postgres: { rollback: "The backup Plania takes before migrating.", window: "Whatever you keep" },
  } as Record<string, { rollback: string; window: string }>,
});
export const rollbackOf = (id: ProviderId, language: Language = getLanguage()) => words(ROLLBACK_WORDS, language)[id] ?? null;

// ---- PLA-I70-14: the review says each changed field in plain words, one line per change.
export const ENV_CHANGE_WORDS = defineWords({
  es: {
    added: (n: string) => `Nuevo entorno «${n}»`,
    removed: (n: string) => `Se quita el entorno «${n}»`,
    field: (env: string, what: string, from: string, to: string) => `${env}: ${what} pasa de ${from} a ${to}`,
    what: { name: "el nombre", kind: "el tipo", runs: "lo que corre", url: "la dirección", server: "el servidor", project: "el proyecto del servicio", db: "la base de datos", dbName: "el nombre de la base", data: "los datos", when: "cuándo se migra", lock: "el candado de migración", sql: "la revisión del SQL", approve: "pedir tu aprobación si se borran datos", backup: "la copia antes de migrar", roles: "los tres usuarios", health: "la dirección de salud", pages: "las páginas a abrir", deploy: "el comando que despliega", rollback: "el comando que vuelve atrás", check: "lo que se comprueba", freeze: "no publicar viernes tarde", vars: "las variables marcadas" },
    yes: "sí",
    no: "no",
    nothing: "nada",
    runs: (r: CaminoEnv["runs"]) => (r.kind === "branch" ? `la rama ${r.branch}` : r.kind === "pr" ? "cada propuesta" : r.kind === "promote" ? `el build de ${r.from || "otro entorno"}` : r.kind === "tags" ? `las etiquetas ${r.pattern}` : "nada todavía"),
  },
  en: {
    added: (n: string) => `New environment «${n}»`,
    removed: (n: string) => `Environment «${n}» is removed`,
    field: (env: string, what: string, from: string, to: string) => `${env}: ${what} goes from ${from} to ${to}`,
    what: { name: "the name", kind: "the type", runs: "what runs", url: "the address", server: "the server", project: "the service project", db: "the database", dbName: "the database name", data: "the data", when: "when it migrates", lock: "the migration lock", sql: "the SQL review", approve: "asking for your approval when data is deleted", backup: "the backup before migrating", roles: "the three users", health: "the health address", pages: "the pages to open", deploy: "the deploy command", rollback: "the rollback command", check: "what is checked", freeze: "no Friday-evening releases", vars: "the ticked variables" },
    yes: "yes",
    no: "no",
    nothing: "nothing",
    runs: (r: CaminoEnv["runs"]) => (r.kind === "branch" ? `branch ${r.branch}` : r.kind === "pr" ? "each PR" : r.kind === "promote" ? `the build of ${r.from || "another environment"}` : r.kind === "tags" ? `tags ${r.pattern}` : "nothing yet"),
  },
});

/** One plain line per changed field between the environments as read and as staged. */
/** nameOf turns a service id into its name (the screen passes serviceName; ids are never shown). */
export function envChanges(before: CaminoEnv[], after: CaminoEnv[], language: Language = getLanguage(), nameOf: (id: string) => string = (id) => id): string[] {
  const w = words(ENV_CHANGE_WORDS, language);
  const e = words(ENTORNOS_WORDS, language);
  const out: string[] = [];
  for (const b of before) if (!after.some((a) => a.id === b.id)) out.push(w.removed(b.name));
  for (const a of after) {
    const b = before.find((x) => x.id === a.id);
    if (!b) {
      out.push(w.added(a.name));
      continue;
    }
    const yn = (v: boolean) => (v ? w.yes : w.no);
    const nz = (v: string | null | undefined) => v || w.nothing;
    const line = (what: string, from: string, to: string) => from !== to && out.push(w.field(a.name, what, from, to));
    line(w.what.name, b.name, a.name);
    line(w.what.kind, e.kinds[b.kind], e.kinds[a.kind]);
    line(w.what.runs, w.runs(b.runs), w.runs(a.runs));
    line(w.what.url, nz(b.url), nz(a.url));
    line(w.what.server, b.server.provider ? nameOf(b.server.provider) : w.nothing, a.server.provider ? nameOf(a.server.provider) : w.nothing);
    line(w.what.project, nz(b.server.project), nz(a.server.project));
    line(w.what.deploy, nz(b.server.manual?.deploy), nz(a.server.manual?.deploy));
    line(w.what.rollback, nz(b.server.manual?.rollback), nz(a.server.manual?.rollback));
    line(w.what.check, b.server.manual?.check.join(", ") || w.nothing, a.server.manual?.check.join(", ") || w.nothing);
    const d0 = b.database;
    const d1 = a.database;
    line(w.what.db, d0?.provider ? nameOf(d0.provider) : w.nothing, d1?.provider ? nameOf(d1.provider) : w.nothing);
    if (d1) {
      line(w.what.dbName, nz(d0?.name), nz(d1.name));
      line(w.what.data, d0 ? e.dataOpts[d0.data]! : w.nothing, e.dataOpts[d1.data]!);
      line(w.what.when, d0 ? e.whenOpts[d0.migrate_when].name : w.nothing, e.whenOpts[d1.migrate_when].name);
      line(w.what.lock, yn(!!d0?.lock), yn(d1.lock));
      line(w.what.sql, yn(!!d0?.sql_review), yn(d1.sql_review));
      line(w.what.approve, yn(!!d0?.approve_destructive), yn(d1.approve_destructive));
      line(w.what.backup, d0 ? e.backupOpts[d0.backup]! : w.nothing, e.backupOpts[d1.backup]!);
      line(w.what.roles, yn(!!d0?.roles_split), yn(d1.roles_split));
    }
    line(w.what.health, nz(b.health.url), nz(a.health.url));
    line(w.what.pages, b.health.pages.join(", ") || w.nothing, a.health.pages.join(", ") || w.nothing);
    line(w.what.freeze, yn(b.freeze), yn(a.freeze));
    line(w.what.vars, b.vars.join(", ") || w.nothing, a.vars.join(", ") || w.nothing);
  }
  return out;
}
