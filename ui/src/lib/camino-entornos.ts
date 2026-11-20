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
    rollback: "Volver atrás",
    window: "Ventana para restaurar",
    dbName: "Base",
    dbNameHint: "de las bases de esta Mac",
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
      paso: { name: "Paso propio, antes del tráfico", sub: "Después del build y antes de que el código nuevo reciba visitas. Con copia y candado." },
      build: { name: "Dentro del build", sub: "Solo si el servicio no tiene paso propio. Con candado y solo cambios que agregan." },
      llegar: { name: "Al llegar a la rama", sub: "Para bases con datos falsos." },
      mano: { name: "A mano", sub: "Alguien la corre. Fácil de olvidar." },
      nunca: { name: "Al arrancar la app", sub: "No: cada reinicio o copia de la app migraría a la vez." },
    } as Record<MigrateWhen, { name: string; sub: string }>,
    recommended: "recomendado",
    today: "hoy",
    lock: "Candado para que dos builds no migren a la vez",
    lockSub: "pg_try_advisory_lock antes de migrar.",
    sqlReview: "Revisar el SQL antes de migrar",
    sqlReviewSub: "squawk avisa si una migración borra datos o bloquea tablas. Es gratis.",
    approve: "Pedir mi aprobación si una migración borra datos",
    approveSub: "Atada a ese archivo: si cambia, se vuelve a pedir. Un agente nunca puede aprobar.",
    backup: "Copia antes de migrar",
    backupOpts: { proveedor: "La del servicio (rama o punto en el tiempo)", dump: "pg_dump en esta Mac", ninguna: "Ninguna" } as Record<string, string>,
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
    add: "+ Agregar entorno",
    addTitle: "Agregar un entorno",
    addName: "Nombre",
    addCreate: "Agregar",
    remove: "Quitar este entorno",
    removeNote: "Su registro en Plania se queda con su historia.",
    label: (n: string) => `Entornos: ${n}`,
    record: (r: string) => `registro ${r}`,
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
    rollback: "Rollback",
    window: "Restore window",
    dbName: "Database",
    dbNameHint: "from this Mac's databases",
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
    add: "+ Add an environment",
    addTitle: "Add an environment",
    addName: "Name",
    addCreate: "Add",
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
