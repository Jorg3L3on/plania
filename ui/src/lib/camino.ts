// PLA-I68-2: Camino's pure logic and words, tested without a browser (test/i68-2-camino.test.ts). The door reads one
// payload (camino-types.ts) and everything the owner sees is computed here: the path strip, the findings by severity
// with one fix each, the sections and their dots, the setup list of a project that does not publish yet, the
// connection cards and the service catalog. Every value says where it came from (GitHub, Plania, this machine).
import { defineWords, getLanguage, words, type Language } from "./i18n.js";
import type { Badge, CaminoRead, ProviderId } from "./camino-types.js";
import { COMMITS_PAGE_WORDS } from "./camino-commits-words.js";

export type Sev = "bad" | "warn" | "info" | "ok";
type Pair = readonly [string, string];
export type SectionId = "resumen" | "conn" | "propuestas" | "codigo" | "commits" | "ci" | "hist" | `env:${string}`;
/** A fix: open a section (go), read GitHub again (recheck), or open the project's Ajustes at a section (ajustes). */
export type Fix = { label: string; go?: SectionId; act?: "recheck"; ajustes?: string };
export type Finding = { id: string; sev: Sev; sec: SectionId; title: string; detail: string; fix: Fix | null };

export const SEV_ORDER: Record<Sev, number> = { bad: 0, warn: 1, info: 2, ok: 3 };

export type ServiceInfo = { id: ProviderId; name: string; kind: "server" | "db"; badge: Badge; paid: string | null; keyed: boolean; does: string[]; token: string };

export const CAMINO_WORDS = defineWords({
  es: {
    door: "Camino",
    toFix: (n: number) => `${n} POR RESOLVER`,
    clear: "LISTO",
    title: (p: string) => `Camino de ${p}`,
    lead: "Cómo llega el código de este proyecto a la gente. Solo configuración: publicar, migrar y fusionar siguen en Publicar.",
    checkedAgo: (ago: string) => `Comprobado ${ago} contra GitHub, los servicios y esta Mac`,
    neverChecked: "Todavía sin comprobar",
    checking: "Comprobando…",
    recheck: "Volver a comprobar",
    ready: { bad: (n: number) => `${n} ${n === 1 ? "bloquea" : "bloquean"}`, warn: "Funciona, con avisos", ok: "Todo en orden", more: (n: number) => `· ${n} por mejorar` },
    sections: {
      resumen: "Resumen",
      conn: "Conexiones y llaves",
      propuestas: "Propuestas",
      codigo: "Código y ramas",
      commits: "Commits y propuestas",
      ci: "Pruebas (CI)",
      hist: "Historial",
      envs: "Entornos",
    },
    sub: {
      resumenSetup: "Lista para empezar",
      resumen: "Lo que pide atención",
      conn: (n: number) => `${n} ${n === 1 ? "conexión" : "conexiones"}`,
      propuestas: (open: number) => (open ? `${open} ${open === 1 ? "abierta" : "abiertas"}` : "Ninguna abierta"),
      hist: (n: number) => `${n} ${n === 1 ? "cambio" : "cambios"}`,
      envOff: "Apagado",
      noServer: "sin servidor",
    },
    models: { trunk: "Una rama principal", integ: "Rama de integración", tags: "Versiones por etiqueta" },
    resumen: {
      lead: "El camino de este proyecto y lo que Plania encontró, de lo que bloquea a lo que está bien.",
      leadSetup: "Este proyecto todavía no se publica. Lo que falta para un camino sano, en orden.",
      attention: (n: number) => `Necesita atención · ${n}`,
      bySeverity: "Ordenado por gravedad",
      good: "Bien",
      seeAll: (n: number) => `Ver las ${n}`,
      seeLess: "Ver menos",
      nothing: "Nada pide atención.",
      foot: "Solo tú cambias el camino. Los agentes lo leen y pueden proponer cambios; te llegan a Bandeja.",
      setup: "Para empezar",
      open: "Abrir",
    },
    strip: {
      code: "Código",
      tests: "Pruebas",
      noRepo: "sin repositorio",
      none: "ninguna",
      required: "exigidas",
      notRequired: "no exigidas",
      public: "público",
      private: "privado",
      off: "apagado",
    },
    setup: {
      repo: "Repositorio en GitHub",
      roles: "Qué significa cada rama",
      tests: "Pruebas que corren en cada propuesta",
      commits: "Cómo se escriben los commits",
      where: "Dónde se publicará",
      noneYet: "Ninguna todavía",
      noConvention: "Sin convención",
      later: "Más adelante",
      onEach: "En cada propuesta",
    },
    f: {
      noRepo: ["Sin repositorio en GitHub", "Sin repositorio, Plania no puede leer ramas, pruebas ni propuestas."] as Pair,
      noToken: ["Plania no tiene llave de GitHub", "Sin llave no lee ramas, reglas, pruebas ni corridas. Guarda una en Conexiones y llaves."] as Pair,
      unauthorized: ["GitHub rechazó la llave", "La llave venció o no tiene acceso a este repositorio."] as Pair,
      notFound: (r: string) => [`GitHub no encuentra ${r}`, "El nombre cambió, el repo se borró o la llave no lo ve."] as Pair,
      network: ["No se pudo leer GitHub", "La red falló al comprobar. Lo que ves es lo último que se leyó."] as Pair,
      unprotected: (b: string) => [`${b} no está protegida`, "Se puede empujar directo o borrarla, sin propuesta ni pruebas. En un repo público las reglas son gratis."] as Pair,
      noRulesPlan: ["GitHub no protege ramas en este repo", "Es privado en el plan gratis. Plania hará cumplir tus reglas en sus propias fusiones; GitHub no impide un empujón directo."] as Pair,
      pubMissing: (b: string) => [`La rama publicada ${b} no existe en GitHub`, "Publicar y Taller la esperan. Elige la rama real en Código y ramas."] as Pair,
      integMissing: (b: string) => [`La rama de integración ${b} no existe en GitHub`, "Las entregas se fusionan ahí. Elige una rama real o quita la integración."] as Pair,
      folderMissing: (f: string) => [`La carpeta ${f} no existe`, "Taller parte de esa carpeta. Elige un clon de este repo en Código y ramas."] as Pair,
      folderNotClone: (f: string) => [`${f} no es un clon de este repo`, "Su origen es otro repositorio o no tiene. Taller trabajaría sobre el código equivocado."] as Pair,
      noWorkflows: ["No hay pruebas en GitHub", "Nada revisa una propuesta antes de fusionarla. Plania puede proponer un flujo con tus scripts."] as Pair,
      ghostCheck: (r: string, state: string) => [`La regla «${r}» exige una prueba que nadie produce`, `Está ${state}. Si se enciende, ninguna propuesta se podrá fusionar.`] as Pair,
      nothingRequired: (b: string) => [`Nada exige pruebas en verde para entrar a ${b}`, "Hoy una propuesta en rojo se puede fusionar."] as Pair,
      envBehind: (e: string, commit: string, head: string, b: string) => [`${e}: el registro no coincide con ${b}`, `El registro dice ${commit}; ${b} ya está en ${head}.`] as Pair,
      envCount: (e: string, applied: number, list: number) => [`${e}: las migraciones no cuadran`, `El registro dice ${applied} aplicadas, pero su lista tiene ${list}.`] as Pair,
      envMissing: (e: string, n: number) => [`${e}: faltan ${n} ${n === 1 ? "migración" : "migraciones"}`, `El código tiene más migraciones de las que el registro dice aplicadas.`] as Pair,
      prodUnset: ["Nadie dijo quién migra la base de producción", "Una publicación con migraciones espera hasta que lo digas."] as Pair,
      noteStale: ["La nota del proyecto está vieja", "Algo cambió después de escribirla. Los agentes la leen al empezar."] as Pair,
      aiTrailers: (n: number, of: number) => [`${n} de ${of} commits llevan coautor de IA`, "Tu regla no lo permite. Plania quitará esa línea antes de subir."] as Pair,
      noConvention: ["Elige una convención de commits", "Los agentes escriben como quieren hasta que elijas una."] as Pair,
      ghSession: ["Plania usa tu sesión de gh, con control total de tus repos", "Más seguro: una llave solo para este repo, o la app de Plania en GitHub con los repos que elijas."] as Pair,
      keyFailed: (s: string) => [`La llave de ${s} no pasó la última prueba`, "El servicio la rechazó. Cámbiala en Conexiones y llaves."] as Pair,
      keyExpired: (s: string) => [`La llave de ${s} venció`, "Plania ya no puede usarla."] as Pair,
      keyExpiring: (s: string, d: number) => [`La llave de ${s} vence en ${d} ${d === 1 ? "día" : "días"}`, "Cámbiala antes de que venza."] as Pair,
      byHand: (e: string) => [`${e} se migra a mano`, "Recomendado: un paso propio después del build y antes del tráfico, con copia y candado."] as Pair,
      buildNoLock: (e: string) => [`${e} migra dentro del build sin candado`, "Dos builds a la vez migrarían a la vez, y si el build falla después de migrar queda esquema nuevo con código viejo."] as Pair,
      noSqlReview: (e: string) => [`${e}: nadie revisa el SQL antes de migrar`, "squawk avisa si una migración borra datos o bloquea tablas. Es gratis."] as Pair,
      noHealth: (e: string) => [`${e} no tiene cómo comprobar que abre`, "Sin una dirección de salud ni páginas que abrir, nada avisa si una publicación rompe la app."] as Pair,
      missingVars: (e: string, n: number, list: string) => [`${e}: faltan ${n} ${n === 1 ? "variable" : "variables"}`, list] as Pair,
      publicRepo: "Repo público: reglas de GitHub y minutos de Actions gratis",
      fakeData: (e: string) => `${e} usa datos falsos`,
      allGood: "GitHub, la carpeta y las llaves responden",
    },
    fix: {
      code: "Abrir Código y ramas",
      conn: "Conectar",
      connChange: "Cambiar la llave",
      recheck: "Volver a leer",
      ci: "Abrir Pruebas",
      env: "Abrir el entorno",
      commits: "Elegir",
      who: "Decir quién migra",
      see: "Ver",
    },
    conn: {
      lead: "Cada cuenta que Plania usa para este proyecto: cómo se conectó, qué puede hacer, qué le falta y cuándo vence. Las llaves viven en el llavero de esta Mac; nunca entran a la base de Plania, a git ni a una corrida de un agente.",
      leadFile: "Cada cuenta que Plania usa para este proyecto: cómo se conectó, qué puede hacer, qué le falta y cuándo vence. Las llaves viven en un archivo que solo tu usuario puede leer; nunca entran a la base de Plania, a git ni a una corrida de un agente.",
      connected: "conectado",
      notConnected: "sin conectar",
      how: "Cómo",
      can: "Puede",
      expires: "Vence",
      lastUse: "Último uso",
      neverExpires: "No vence",
      keychain: (l4: string) => `Llave en el llavero de esta Mac · ••••${l4}`,
      file: (l4: string) => `Llave en un archivo protegido · ••••${l4}`,
      ghSession: "Tu sesión de gh (gh auth token)",
      ghEnv: (v: string) => `La variable ${v}`,
      ghFile: "El archivo ~/.config/plania/github-token",
      onlyProject: "Solo lo que la llave abre",
      allRepos: (scopes: string) => `${scopes}: control total de todos tus repos`,
      scopes: (scopes: string) => scopes,
      test: "Probar",
      testing: "Probando…",
      change: "Cambiar",
      connect: "Conectar",
      remove: "Quitar",
      paste: "Pega la llave",
      save: "Guardar y probar",
      saving: "Probando…",
      keyNote: "Se guarda solo si el servicio la acepta. Solo Plania la usa; los agentes nunca la ven. Después solo se muestran los últimos 4 caracteres.",
      works: "Responde",
      rejected: (status: number | null, msg: string) => `El servicio rechazó la llave${status ? ` (${status})` : ""}${msg ? `: ${msg}` : "."} No se guardó.`,
      invalid: "Esa llave tiene espacios, comillas o una etiqueta. Pega solo la llave.",
      storeFailed: "El llavero no la guardó. Nada cambió.",
      unreachable: "No se pudo llegar al servicio. Intenta de nuevo.",
      addTitle: "Agregar una conexión",
      addHint: "Nativo: por su API · Detectado: solo lectura · Manual: tu comando con una lista",
      servers: "Servicios",
      dbs: "Bases de datos",
      manualNote: "¿No está el tuyo? «Manual» funciona con cualquier servicio: das el comando que despliega, el que vuelve atrás y la dirección que comprueba.",
      paid: "de pago",
      badge: { native: "Nativo", detected: "Detectado", manual: "Manual" } as Record<Badge, string>,
      detectedHow: "Leído de esta Mac, sin llave",
      localDbs: (n: number) => `${n} ${n === 1 ? "base" : "bases"} en el Postgres de esta Mac`,
      macHow: "Corre en esta Mac",
      ghWorks: ["Leer ramas, propuestas y corridas", "Abrir propuestas que corren el CI nuevo", "Encender y apagar flujos"],
      ghNeedsAdmin: "Crear reglas de GitHub necesita permiso de administración",
      ghAdmin: "Tienes permiso de administración en este repo",
      providerWorks: "Leer y probar con su API",
      providerMore: "Sin llave, Plania solo ve lo que GitHub reporta",
    },
    prop: {
      lead: "Las propuestas (PR) de este proyecto, agrupadas por la rama a la que entran.",
      into: (b: string) => `Hacia ${b}`,
      noBase: "Sin rama destino",
      open: "abierta",
      merged: "fusionada",
      closed: "cerrada",
      none: "Ninguna propuesta en los últimos 30 días.",
      ci: { success: "pruebas ✓", failure: "pruebas ✗", pending: "pruebas corriendo", none: "sin pruebas" } as Record<string, string>,
      openOnGithub: "Abrir en GitHub",
    },
    hist: {
      lead: "Cada cambio del camino: quién, dónde y cómo se deshace. También los cambios hechos fuera de Plania que Plania detectó.",
      when: "Cuándo",
      who: "Quién",
      what: "Qué",
      where: "Dónde",
      undo: "Cómo se deshace",
      none: "Todavía no hay cambios.",
      table: "Tabla de cambios",
      whoOwner: "Tú",
      whoOutside: "Fuera de Plania",
      dest: { plania: "Plania", proveedor: "Servicio", github: "GitHub", pr: "Propuesta", llavero: "Llavero" } as Record<string, string>,
    },
    runs: { branch: (b: string) => `Rama ${b}`, pr: "Cada propuesta", promote: (e: string) => `El build de ${e}`, tags: (p: string) => `Etiquetas ${p}`, none: "Todavía nada" },
    soon: "Esta sección llega en el siguiente paso de Camino.",
    readError: "el camino de este proyecto",
    reading: "Leyendo el camino…",
    ago: { now: "hace un momento", min: (n: number) => `hace ${n} min`, h: (n: number) => `hace ${n} h`, d: (n: number) => `hace ${n} ${n === 1 ? "día" : "días"}` },
    sources: { github: "de GitHub", plania: "de Plania", mac: "de esta Mac", camino: "de Camino", settings: "de Ajustes", default: "por defecto" } as Record<string, string>,
  },
  en: {
    door: "Path",
    toFix: (n: number) => `${n} TO FIX`,
    clear: "READY",
    title: (p: string) => `${p}'s path`,
    lead: "How this project's code reaches people. Configuration only: releasing, migrating and merging stay in Release.",
    checkedAgo: (ago: string) => `Checked ${ago} against GitHub, the services and this Mac`,
    neverChecked: "Not checked yet",
    checking: "Checking…",
    recheck: "Check again",
    ready: { bad: (n: number) => `${n} ${n === 1 ? "blocks" : "block"}`, warn: "Works, with warnings", ok: "All in order", more: (n: number) => `· ${n} to improve` },
    sections: {
      resumen: "Summary",
      conn: "Connections and keys",
      propuestas: "Pull requests",
      codigo: "Code and branches",
      commits: "Commits and PRs",
      ci: "Tests (CI)",
      hist: "History",
      envs: "Environments",
    },
    sub: {
      resumenSetup: "Getting started",
      resumen: "What needs attention",
      conn: (n: number) => `${n} ${n === 1 ? "connection" : "connections"}`,
      propuestas: (open: number) => (open ? `${open} open` : "None open"),
      hist: (n: number) => `${n} ${n === 1 ? "change" : "changes"}`,
      envOff: "Off",
      noServer: "no server",
    },
    models: { trunk: "One main branch", integ: "Integration branch", tags: "Versions by tag" },
    resumen: {
      lead: "This project's path and what Plania found, from what blocks to what is fine.",
      leadSetup: "This project is not released yet. What is missing for a healthy path, in order.",
      attention: (n: number) => `Needs attention · ${n}`,
      bySeverity: "By severity",
      good: "Fine",
      seeAll: (n: number) => `See all ${n}`,
      seeLess: "See less",
      nothing: "Nothing needs attention.",
      foot: "Only you change the path. Agents read it and may propose changes; they reach your Inbox.",
      setup: "To get started",
      open: "Open",
    },
    strip: {
      code: "Code",
      tests: "Tests",
      noRepo: "no repository",
      none: "none",
      required: "required",
      notRequired: "not required",
      public: "public",
      private: "private",
      off: "off",
    },
    setup: {
      repo: "Repository on GitHub",
      roles: "What each branch means",
      tests: "Tests that run on every PR",
      commits: "How commits are written",
      where: "Where it will be released",
      noneYet: "None yet",
      noConvention: "No convention",
      later: "Later",
      onEach: "On every PR",
    },
    f: {
      noRepo: ["No repository on GitHub", "Without a repository, Plania cannot read branches, tests or PRs."] as Pair,
      noToken: ["Plania has no GitHub key", "Without a key it reads no branches, rules, tests or runs. Save one in Connections and keys."] as Pair,
      unauthorized: ["GitHub refused the key", "The key expired or has no access to this repository."] as Pair,
      notFound: (r: string) => [`GitHub cannot find ${r}`, "The name changed, the repo was deleted, or the key cannot see it."] as Pair,
      network: ["GitHub could not be read", "The network failed while checking. What you see is the last read."] as Pair,
      unprotected: (b: string) => [`${b} is not protected`, "Anyone can push to it or delete it, with no PR and no tests. On a public repo rules are free."] as Pair,
      noRulesPlan: ["GitHub does not protect branches on this repo", "It is private on the free plan. Plania will enforce your rules on its own merges; GitHub does not stop a direct push."] as Pair,
      pubMissing: (b: string) => [`The published branch ${b} does not exist on GitHub`, "Release and Taller expect it. Pick the real branch in Code and branches."] as Pair,
      integMissing: (b: string) => [`The integration branch ${b} does not exist on GitHub`, "Deliveries merge there. Pick a real branch or drop integration."] as Pair,
      folderMissing: (f: string) => [`The folder ${f} does not exist`, "Taller starts from that folder. Pick a clone of this repo in Code and branches."] as Pair,
      folderNotClone: (f: string) => [`${f} is not a clone of this repo`, "Its origin is another repository, or none. Taller would work on the wrong code."] as Pair,
      noWorkflows: ["No tests on GitHub", "Nothing checks a PR before it merges. Plania can propose a workflow with your scripts."] as Pair,
      ghostCheck: (r: string, state: string) => [`The rule «${r}» requires a check nobody produces`, `It is ${state}. If it is turned on, no PR can merge.`] as Pair,
      nothingRequired: (b: string) => [`Nothing requires green tests to enter ${b}`, "Today a red PR can be merged."] as Pair,
      envBehind: (e: string, commit: string, head: string, b: string) => [`${e}: the record does not match ${b}`, `The record says ${commit}; ${b} is already at ${head}.`] as Pair,
      envCount: (e: string, applied: number, list: number) => [`${e}: the migrations do not add up`, `The record says ${applied} applied, but its list has ${list}.`] as Pair,
      envMissing: (e: string, n: number) => [`${e}: ${n} ${n === 1 ? "migration" : "migrations"} missing`, "The code has more migrations than the record says were applied."] as Pair,
      prodUnset: ["Nobody said who migrates the production database", "A release with migrations waits until you say."] as Pair,
      noteStale: ["The project's note is stale", "Something changed after it was written. Agents read it when they start."] as Pair,
      aiTrailers: (n: number, of: number) => [`${n} of ${of} commits carry an AI co-author`, "Your rule does not allow it. Plania will strip that line before pushing."] as Pair,
      noConvention: ["Pick a commit convention", "Agents write as they like until you pick one."] as Pair,
      ghSession: ["Plania uses your gh session, with full control of your repos", "Safer: a key for this repo only, or Plania's GitHub app with the repos you pick."] as Pair,
      keyFailed: (s: string) => [`The ${s} key failed its last test`, "The service refused it. Change it in Connections and keys."] as Pair,
      keyExpired: (s: string) => [`The ${s} key expired`, "Plania can no longer use it."] as Pair,
      keyExpiring: (s: string, d: number) => [`The ${s} key expires in ${d} ${d === 1 ? "day" : "days"}`, "Change it before it expires."] as Pair,
      byHand: (e: string) => [`${e} is migrated by hand`, "Recommended: its own step after the build and before traffic, with a backup and a lock."] as Pair,
      buildNoLock: (e: string) => [`${e} migrates inside the build with no lock`, "Two builds at once would migrate at once, and a build that fails after migrating leaves a new schema with old code."] as Pair,
      noSqlReview: (e: string) => [`${e}: nobody reviews the SQL before migrating`, "squawk warns when a migration deletes data or locks tables. It is free."] as Pair,
      noHealth: (e: string) => [`${e} has no way to check it opens`, "With no health address and no pages to open, nothing warns when a release breaks the app."] as Pair,
      missingVars: (e: string, n: number, list: string) => [`${e}: ${n} ${n === 1 ? "variable" : "variables"} missing`, list] as Pair,
      publicRepo: "Public repo: GitHub rules and Actions minutes are free",
      fakeData: (e: string) => `${e} uses fake data`,
      allGood: "GitHub, the folder and the keys answer",
    },
    fix: {
      code: "Open Code and branches",
      conn: "Connect",
      connChange: "Change the key",
      recheck: "Read again",
      ci: "Open Tests",
      env: "Open the environment",
      commits: "Pick",
      who: "Say who migrates",
      see: "See",
    },
    conn: {
      lead: "Every account Plania uses for this project: how it was connected, what it can do, what it lacks and when it expires. Keys live in this Mac's keychain; they never enter Plania's database, git or an agent's run.",
      leadFile: "Every account Plania uses for this project: how it was connected, what it can do, what it lacks and when it expires. Keys live in a file only your user can read; they never enter Plania's database, git or an agent's run.",
      connected: "connected",
      notConnected: "not connected",
      how: "How",
      can: "Can",
      expires: "Expires",
      lastUse: "Last used",
      neverExpires: "Never",
      keychain: (l4: string) => `Key in this Mac's keychain · ••••${l4}`,
      file: (l4: string) => `Key in a protected file · ••••${l4}`,
      ghSession: "Your gh session (gh auth token)",
      ghEnv: (v: string) => `The variable ${v}`,
      ghFile: "The file ~/.config/plania/github-token",
      onlyProject: "Only what the key opens",
      allRepos: (scopes: string) => `${scopes}: full control of all your repos`,
      scopes: (scopes: string) => scopes,
      test: "Test",
      testing: "Testing…",
      change: "Change",
      connect: "Connect",
      remove: "Remove",
      paste: "Paste the key",
      save: "Save and test",
      saving: "Testing…",
      keyNote: "It is saved only if the service accepts it. Only Plania uses it; agents never see it. Afterwards only its last 4 characters show.",
      works: "Answers",
      rejected: (status: number | null, msg: string) => `The service refused the key${status ? ` (${status})` : ""}${msg ? `: ${msg}` : "."} Not saved.`,
      invalid: "That key has spaces, quotes or a label. Paste just the key.",
      storeFailed: "The keychain did not save it. Nothing changed.",
      unreachable: "The service could not be reached. Try again.",
      addTitle: "Add a connection",
      addHint: "Native: through its API · Detected: read-only · Manual: your command with a checklist",
      servers: "Services",
      dbs: "Databases",
      manualNote: "Yours is not here? «Manual» works with any service: you give the command that deploys, the one that rolls back and the address to check.",
      paid: "paid",
      badge: { native: "Native", detected: "Detected", manual: "Manual" } as Record<Badge, string>,
      detectedHow: "Read from this Mac, no key",
      localDbs: (n: number) => `${n} ${n === 1 ? "database" : "databases"} on this Mac's Postgres`,
      macHow: "Runs on this Mac",
      ghWorks: ["Read branches, PRs and runs", "Open PRs that run the new CI", "Turn workflows on and off"],
      ghNeedsAdmin: "Creating GitHub rules needs admin permission",
      ghAdmin: "You have admin permission on this repo",
      providerWorks: "Read and test through its API",
      providerMore: "Without a key, Plania only sees what GitHub reports",
    },
    prop: {
      lead: "This project's pull requests, grouped by the branch they go into.",
      into: (b: string) => `Into ${b}`,
      noBase: "No target branch",
      open: "open",
      merged: "merged",
      closed: "closed",
      none: "No pull requests in the last 30 days.",
      ci: { success: "tests ✓", failure: "tests ✗", pending: "tests running", none: "no tests" } as Record<string, string>,
      openOnGithub: "Open on GitHub",
    },
    hist: {
      lead: "Every change to the path: who, where and how to undo it. Also changes made outside Plania that Plania noticed.",
      when: "When",
      who: "Who",
      what: "What",
      where: "Where",
      undo: "How to undo",
      none: "No changes yet.",
      table: "Changes table",
      whoOwner: "You",
      whoOutside: "Outside Plania",
      dest: { plania: "Plania", proveedor: "Service", github: "GitHub", pr: "PR", llavero: "Keychain" } as Record<string, string>,
    },
    runs: { branch: (b: string) => `Branch ${b}`, pr: "Each PR", promote: (e: string) => `${e}'s build`, tags: (p: string) => `Tags ${p}`, none: "Nothing yet" },
    soon: "This section arrives in Camino's next step.",
    readError: "this project's path",
    reading: "Reading the path…",
    ago: { now: "just now", min: (n: number) => `${n} min ago`, h: (n: number) => `${n} h ago`, d: (n: number) => `${n} ${n === 1 ? "day" : "days"} ago` },
    sources: { github: "from GitHub", plania: "from Plania", mac: "from this Mac", camino: "from Camino", settings: "from Settings", default: "default" } as Record<string, string>,
  },
});

export const caminoWords = (language: Language = getLanguage()) => words(CAMINO_WORDS, language);
type W = ReturnType<typeof caminoWords>;

export function agoText(iso: string | null, now: Date, w: W = caminoWords()): string | null {
  if (!iso) return null;
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return w.ago.now;
  if (s < 3600) return w.ago.min(Math.floor(s / 60));
  if (s < 86_400) return w.ago.h(Math.floor(s / 3600));
  return w.ago.d(Math.floor(s / 86_400));
}

// ---- the catalog (from the research: what each service does through its API, and what costs money)
const SERVICES: Pick<ServiceInfo, "id" | "kind" | "badge">[] = [
  { id: "vercel", kind: "server", badge: "native" },
  { id: "netlify", kind: "server", badge: "native" },
  { id: "render", kind: "server", badge: "native" },
  { id: "railway", kind: "server", badge: "native" },
  { id: "fly", kind: "server", badge: "native" },
  { id: "cloudflare", kind: "server", badge: "native" },
  { id: "github_releases", kind: "server", badge: "native" },
  { id: "mac_service", kind: "server", badge: "manual" },
  { id: "own_server", kind: "server", badge: "manual" },
  { id: "neon", kind: "db", badge: "native" },
  { id: "supabase", kind: "db", badge: "native" },
  { id: "planetscale", kind: "db", badge: "native" },
  { id: "postgres", kind: "db", badge: "manual" },
  { id: "mysql", kind: "db", badge: "manual" },
  { id: "local_postgres", kind: "db", badge: "detected" },
];
type ServiceWords = Record<string, Pick<ServiceInfo, "name" | "paid" | "does" | "token">>;
export const CATALOG_WORDS = defineWords({
  es: {
    vercel: { name: "Vercel", paid: null, does: ["Ver cada despliegue", "Volver atrás al instante (solo dominios; las variables no vuelven)", "Leer nombres de variables"], token: "Token con vencimiento" },
    netlify: { name: "Netlify", paid: null, does: ["Ver cada despliegue", "Volver atrás (restaurar un despliegue)", "Leer nombres de variables"], token: "Token personal con vencimiento" },
    render: { name: "Render", paid: "Previas por propuesta: plan Pro", does: ["Ver cada despliegue", "Volver atrás con build y variables"], token: "Llave de API" },
    railway: { name: "Railway", paid: null, does: ["Ver cada despliegue", "Volver atrás si el servicio lo permite"], token: "Token de cuenta" },
    fly: { name: "Fly.io", paid: null, does: ["Ver cada versión", "Volver atrás: redesplegar la imagen anterior"], token: "Token de despliegue con vencimiento" },
    cloudflare: { name: "Cloudflare", paid: null, does: ["Ver versiones", "Volver atrás entre las últimas 100 versiones"], token: "Token con permisos y vencimiento" },
    github_releases: { name: "GitHub Releases", paid: null, does: ["Publicar una versión por etiqueta", "Marcar la anterior como la última"], token: "Tu conexión de GitHub" },
    mac_service: { name: "Servicio en esta Mac", paid: null, does: ["Reiniciar con tu comando", "Volver atrás si guardas la versión anterior"], token: "Sin llave: corre en esta Mac" },
    own_server: { name: "Servidor propio", paid: null, does: ["Desplegar con tu comando", "Volver atrás con tu comando"], token: "Tu propio acceso" },
    neon: { name: "Neon", paid: null, does: ["Copia antes de migrar (rama)", "Restaurar en segundos"], token: "Llave de API" },
    supabase: { name: "Supabase", paid: "Copias automáticas y ramas: planes de pago", does: ["Leer el estado de migraciones"], token: "Token de acceso" },
    planetscale: { name: "PlanetScale", paid: "Sin plan gratis", does: ["Copias cada 12 h", "Cambios por solicitud revisable"], token: "Token de servicio (id:token)" },
    postgres: { name: "Postgres", paid: null, does: ["Copia con pg_dump en esta Mac", "Restaurar con pg_restore"], token: "Un usuario que solo migra" },
    mysql: { name: "MySQL", paid: null, does: ["Copia con mysqldump", "Restaurar esa copia"], token: "Un usuario que solo migra" },
    local_postgres: { name: "Postgres local", paid: null, does: ["Copia antes de migrar", "Restaurar esa copia"], token: "Sin llave: esta Mac" },
  } as ServiceWords,
  en: {
    vercel: { name: "Vercel", paid: null, does: ["See each deployment", "Instant rollback (domains only; variables do not roll back)", "Read variable names"], token: "Token with an expiry" },
    netlify: { name: "Netlify", paid: null, does: ["See each deployment", "Roll back (restore a deployment)", "Read variable names"], token: "Personal token with an expiry" },
    render: { name: "Render", paid: "PR previews: Pro plan", does: ["See each deployment", "Roll back with build and variables"], token: "API key" },
    railway: { name: "Railway", paid: null, does: ["See each deployment", "Roll back when the service allows it"], token: "Account token" },
    fly: { name: "Fly.io", paid: null, does: ["See each release", "Roll back: redeploy the previous image"], token: "Deploy token with an expiry" },
    cloudflare: { name: "Cloudflare", paid: null, does: ["See versions", "Roll back among the last 100 versions"], token: "Token with permissions and an expiry" },
    github_releases: { name: "GitHub Releases", paid: null, does: ["Publish a version per tag", "Mark the previous one as latest"], token: "Your GitHub connection" },
    mac_service: { name: "Service on this Mac", paid: null, does: ["Restart with your command", "Roll back if you keep the previous version"], token: "No key: runs on this Mac" },
    own_server: { name: "Own server", paid: null, does: ["Deploy with your command", "Roll back with your command"], token: "Your own access" },
    neon: { name: "Neon", paid: null, does: ["Backup before migrating (a branch)", "Restore in seconds"], token: "API key" },
    supabase: { name: "Supabase", paid: "Automatic backups and branches: paid plans", does: ["Read the migration state"], token: "Access token" },
    planetscale: { name: "PlanetScale", paid: "No free plan", does: ["Backups every 12 h", "Changes through reviewable requests"], token: "Service token (id:token)" },
    postgres: { name: "Postgres", paid: null, does: ["Backup with pg_dump on this Mac", "Restore with pg_restore"], token: "A user that only migrates" },
    mysql: { name: "MySQL", paid: null, does: ["Backup with mysqldump", "Restore that backup"], token: "A user that only migrates" },
    local_postgres: { name: "Local Postgres", paid: null, does: ["Backup before migrating", "Restore that backup"], token: "No key: this Mac" },
  },
});
/** The services a key can be saved for (src/camino/providers.ts KEYED). */
export const KEYED: ProviderId[] = ["github", "vercel", "netlify", "render", "railway", "fly", "cloudflare", "neon", "supabase", "planetscale"];

export function catalog(language: Language = getLanguage()): ServiceInfo[] {
  const w = words(CATALOG_WORDS, language);
  return SERVICES.map((s) => ({ ...s, ...w[s.id]!, keyed: KEYED.includes(s.id) }));
}
export const serviceName = (id: ProviderId, language: Language = getLanguage()): string =>
  id === "github" ? "GitHub" : (catalog(language).find((s) => s.id === id)?.name ?? id);

// ---- reading the payload
const gh = (r: CaminoRead) => (r.discovery?.github.ok ? r.discovery.github : null);
const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "—");

/** The project does not publish yet: no release step and no production environment. */
export const isSetup = (r: CaminoRead): boolean => !r.settings.release && !r.config.envs.some((e) => e.kind === "produccion" || e.kind === "versiones");

/** Whether the published branch is protected on GitHub: by Plania's or anyone's ruleset, or classic protection. */
export function protectedOn(r: CaminoRead, branch: string): boolean {
  const g = gh(r);
  if (!g) return false;
  if (g.branches.find((b) => b.name === branch)?.protected) return true;
  return g.rules.list.some((x) => x.enforcement === "active" && x.target === "branch" && x.branches.some((b) => b === branch || b === "~DEFAULT_BRANCH" && g.repo.default_branch === branch || b === "~ALL"));
}

/** The connection cards, in order: GitHub, every saved key, the services the environments name, then detected ones. */
export type Card = { id: ProviderId; badge: Badge; saved: boolean; via: "key" | "session" | "env" | "file" | "detected" | "mac" | null };
export function cards(r: CaminoRead): Card[] {
  const out: Card[] = [];
  const add = (c: Card) => {
    if (!out.some((x) => x.id === c.id)) out.push(c);
  };
  const g = r.discovery?.github;
  const src = g && g.ok ? g.token.source : null;
  add({ id: "github", badge: "native", saved: !!r.config.connections.github, via: r.config.connections.github ? "key" : src === "gh auth token" ? "session" : src && src.startsWith("~") ? "file" : src ? "env" : null });
  for (const id of Object.keys(r.config.connections) as ProviderId[]) if (id !== "github") add({ id, badge: "native", saved: true, via: "key" });
  for (const e of r.config.envs) {
    for (const id of [e.server.provider, e.database?.provider]) {
      if (!id || id === "github") continue;
      const info = catalog("es").find((s) => s.id === id);
      if (!info) continue;
      add({ id, badge: info.badge, saved: !!r.config.connections[id], via: info.badge === "detected" ? "detected" : info.badge === "manual" ? "mac" : r.config.connections[id] ? "key" : null });
    }
  }
  if (r.settings.vercel) add({ id: "vercel", badge: "native", saved: !!r.config.connections.vercel, via: r.config.connections.vercel ? "key" : null });
  if (r.discovery?.mac.postgres?.ok) add({ id: "local_postgres", badge: "detected", saved: false, via: "detected" });
  return out;
}

// ---- findings
export function findings(r: CaminoRead, now: Date, language: Language = getLanguage()): Finding[] {
  const w = caminoWords(language);
  const F: Finding[] = [];
  const add = (id: string, sev: Sev, sec: SectionId, [title, detail]: readonly [string, string], fix: Fix | null = null) => F.push({ id, sev, sec, title, detail, fix });
  const c = r.config;
  const pub = c.branches.published;
  const integ = c.model === "integ" ? c.branches.integration : null;
  const d = r.discovery;
  const g = gh(r);

  // GitHub reachable at all
  if (!r.settings.repo && !r.settings.no_code) add("no-repo", "warn", "codigo", w.f.noRepo, { label: w.fix.code, go: "codigo" });
  else if (d && !d.github.ok) {
    const e = d.github.error;
    if (e === "no_token") add("no-token", "bad", "conn", w.f.noToken, { label: w.fix.conn, go: "conn" });
    else if (e === "unauthorized") add("unauthorized", "bad", "conn", w.f.unauthorized, { label: w.fix.connChange, go: "conn" });
    else if (e === "not_found") add("not-found", "bad", "codigo", w.f.notFound(r.settings.repo ?? ""), { label: w.fix.code, go: "codigo" });
    else if (e === "network") add("network", "info", "resumen", w.f.network, { label: w.fix.recheck, act: "recheck" });
  }

  if (g) {
    const names = g.branches.map((b) => b.name);
    if (!names.includes(pub)) add("pub-missing", "bad", "codigo", w.f.pubMissing(pub), { label: w.fix.code, go: "codigo" });
    else if (!g.rules.available && g.rules.reason === "plan") add("no-rules-plan", "warn", "codigo", w.f.noRulesPlan, { label: w.fix.code, go: "codigo" });
    else if (!protectedOn(r, pub)) add(`unprotected:${pub}`, "warn", "codigo", w.f.unprotected(pub), { label: w.fix.code, go: "codigo" });
    if (integ && !names.includes(integ)) add("integ-missing", "warn", "codigo", w.f.integMissing(integ), { label: w.fix.code, go: "codigo" });

    if (!g.workflows.length) add("no-workflows", "warn", "ci", w.f.noWorkflows, { label: w.fix.ci, go: "ci" });
    const seen = new Set(g.checks.map((x) => x.name));
    for (const rs of g.rules.list) {
      const ghost = rs.required_checks.filter((n) => !seen.has(n));
      if (ghost.length) add(`ghost:${rs.name}`, "warn", "ci", w.f.ghostCheck(rs.name, rs.enforcement === "active" ? (language === "en" ? "on" : "encendida") : language === "en" ? "off" : "apagada"), { label: w.fix.ci, go: "ci" });
    }
    const requiredByRule = g.rules.list.some((rs) => rs.enforcement === "active" && rs.required_checks.length && rs.branches.some((b) => b === pub || (b === "~DEFAULT_BRANCH" && g.repo.default_branch === pub)));
    if (g.workflows.length && !requiredByRule && !(c.required_checks[pub]?.length)) add(`nothing-required:${pub}`, "warn", "ci", w.f.nothingRequired(pub), { label: w.fix.ci, go: "ci" });

    // commits
    const ai = g.commits.filter((x) => /^co-authored-by:.*\b(claude|anthropic|copilot|chatgpt|openai|gpt|cursor|codex|gemini|devin)\b/im.test(x.message)).length;
    if (ai && !c.commits.ai) add("ai-trailers", "warn", "commits", w.f.aiTrailers(ai, g.commits.length), { label: w.fix.see, go: "commits" });
    if (!c.commits.convention && g.commits.length) add("no-convention", "info", "commits", w.f.noConvention, { label: w.fix.commits, go: "commits" });

    if (!c.connections.github && g.token.source === "gh auth token" && (g.token.scopes ?? []).includes("repo")) add("gh-session", "info", "conn", w.f.ghSession, { label: w.fix.see, go: "conn" });
    if (!g.repo.private) add("public-repo", "ok", "ci", [w.f.publicRepo, ""]);
  }

  // the folder on this Mac
  const folder = d?.mac.folder;
  if (folder && r.settings.repo) {
    if (!folder.exists) add("folder-missing", "warn", "codigo", w.f.folderMissing(folder.path), { label: w.fix.code, go: "codigo" });
    else if (folder.matches === false || !folder.clone) add("folder-not-clone", "warn", "codigo", w.f.folderNotClone(folder.path), { label: w.fix.code, go: "codigo" });
  }

  // environments: Plania's record against GitHub and the code
  for (const e of c.envs) {
    const rec = e.record ? r.plania.envs.find((x) => x.env === e.record) : null;
    const sec: SectionId = `env:${e.id}`;
    if (rec && g && e.runs.kind === "branch") {
      const head = g.branches.find((b) => b.name === (e.runs as { branch: string }).branch)?.sha;
      if (rec.commit && head && !head.startsWith(rec.commit) && !rec.commit.startsWith(head)) add(`env-behind:${e.id}`, "info", sec, w.f.envBehind(e.name, short(rec.commit), short(head), (e.runs as { branch: string }).branch), { label: w.fix.env, go: sec });
    }
    if (rec && rec.migrations > 0 && rec.migrations_applied != null && rec.migrations_applied !== rec.migrations) add(`env-count:${e.id}`, "info", sec, w.f.envCount(e.name, rec.migrations_applied, rec.migrations), { label: w.fix.env, go: sec });
    else if (rec && rec.migrations_applied != null && d?.mac.migrations && d.mac.migrations.count > rec.migrations_applied && e.kind === "produccion") add(`env-missing:${e.id}`, "info", sec, w.f.envMissing(e.name, d.mac.migrations.count - rec.migrations_applied), { label: w.fix.env, go: sec });
    if (e.database?.data === "falsos" && e.kind !== "produccion") add(`fake:${e.id}`, "ok", sec, [w.f.fakeData(e.name), ""]);
    // PLA-I68-6: production's database and checks.
    const fix = { label: w.fix.env, go: sec } as Fix;
    if (e.kind === "produccion" && e.database?.provider) {
      if (e.database.migrate_when === "mano") add(`by-hand:${e.id}`, "warn", sec, w.f.byHand(e.name), fix);
      if (e.database.migrate_when === "build" && !e.database.lock) add(`build-lock:${e.id}`, "warn", sec, w.f.buildNoLock(e.name), fix);
      if (!e.database.sql_review) add(`sql:${e.id}`, "info", sec, w.f.noSqlReview(e.name), fix);
    }
    if (e.kind === "produccion" && e.runs.kind !== "none" && e.server.provider && e.server.provider !== "mac_service" && !e.health.url && !e.health.pages.length) add(`health:${e.id}`, "warn", sec, w.f.noHealth(e.name), fix);
    const example = d?.mac.env_example ?? [];
    if (e.kind === "produccion" && example.length && e.vars.length) {
      const miss = example.filter((n) => !e.vars.includes(n));
      if (miss.length) add(`vars:${e.id}`, "info", sec, w.f.missingVars(e.name, miss.length, miss.join(", ")), fix);
    }
  }
  if (r.settings.release && !r.settings.release.prod_migrations) add("prod-unset", "info", "resumen", w.f.prodUnset, { label: w.fix.who, ajustes: "lanzamiento" });

  // Plania's own note
  if (r.plania.note_stale) add("note-stale", "info", "resumen", w.f.noteStale);

  // keys
  for (const [id, m] of Object.entries(c.connections) as [ProviderId, NonNullable<CaminoRead["config"]["connections"][ProviderId]>][]) {
    const name = serviceName(id, language);
    if (m.test && !m.test.ok) add(`key-failed:${id}`, "bad", "conn", w.f.keyFailed(name), { label: w.fix.connChange, go: "conn" });
    else if (m.expires_at) {
      const days = Math.ceil((new Date(m.expires_at).getTime() - now.getTime()) / 86_400_000);
      if (days <= 0) add(`key-expired:${id}`, "bad", "conn", w.f.keyExpired(name), { label: w.fix.connChange, go: "conn" });
      else if (days <= 14) add(`key-expiring:${id}`, "warn", "conn", w.f.keyExpiring(name, days), { label: w.fix.connChange, go: "conn" });
    }
  }
  if (g && !F.some((f) => f.sev === "bad")) add("all-good", "ok", "conn", [w.f.allGood, ""]);
  return F.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
}

/** The worst severity among a section's findings (env:x matches env sections; ok when there are none). */
export function worst(F: Finding[], sec: SectionId): Sev {
  const f = F.filter((x) => x.sec === sec);
  return f.some((x) => x.sev === "bad") ? "bad" : f.some((x) => x.sev === "warn") ? "warn" : "ok";
}

/** The door's word in the project bar and its dot: N POR RESOLVER (bad + warn) or LISTO. */
export function doorState(F: Finding[], language: Language = getLanguage()): { dot: Sev; text: string; n: number } {
  const w = caminoWords(language);
  const n = F.filter((f) => f.sev === "bad" || f.sev === "warn").length;
  return { dot: F.some((f) => f.sev === "bad") ? "bad" : n ? "warn" : "ok", text: n ? w.toFix(n) : w.clear, n };
}

/** The pill on the page head: how many block, and how many to improve. */
export function readyLine(F: Finding[], language: Language = getLanguage()): { dot: Sev; text: string; more: string | null } {
  const w = caminoWords(language);
  const bad = F.filter((f) => f.sev === "bad").length;
  const warn = F.filter((f) => f.sev === "warn").length;
  return { dot: bad ? "bad" : warn ? "warn" : "ok", text: bad ? w.ready.bad(bad) : warn ? w.ready.warn : w.ready.ok, more: warn ? w.ready.more(warn) : null };
}

// ---- sections and the path strip
export type Section = { id: SectionId; name: string; sub: string; dot: Sev | "off" };
export function sections(r: CaminoRead, F: Finding[], language: Language = getLanguage()): { main: Section[]; envs: Section[]; hist: Section } {
  const w = caminoWords(language);
  const g = gh(r);
  const dot = (id: SectionId): Sev => worst(F, id);
  const open = r.proposals.filter((p) => p.state === "open").length;
  const resumenDot: Sev = F.some((f) => f.sev === "bad") ? "bad" : F.some((f) => f.sev === "warn") ? "warn" : "ok";
  const nWorkflows = g?.workflows.length ?? 0;
  const conv = r.config.commits.convention;
  const main: Section[] = [
    { id: "resumen", name: w.sections.resumen, sub: isSetup(r) ? w.sub.resumenSetup : w.sub.resumen, dot: resumenDot },
    { id: "conn", name: w.sections.conn, sub: w.sub.conn(cards(r).length), dot: dot("conn") },
    { id: "codigo", name: w.sections.codigo, sub: w.models[r.config.model], dot: dot("codigo") },
    { id: "commits", name: w.sections.commits, sub: conv ? words(COMMITS_PAGE_WORDS, language).conventions[conv].name : w.setup.noConvention, dot: dot("commits") },
    { id: "ci", name: w.sections.ci, sub: nWorkflows ? `${nWorkflows} ${language === "en" ? (nWorkflows === 1 ? "workflow" : "workflows") : nWorkflows === 1 ? "flujo" : "flujos"}` : w.setup.noneYet, dot: dot("ci") },
    { id: "propuestas", name: w.sections.propuestas, sub: w.sub.propuestas(open), dot: "ok" },
  ];
  const envs: Section[] = r.config.envs.map((e) => ({
    id: `env:${e.id}` as SectionId,
    name: e.name,
    sub: `${runsText(e.runs, language)} · ${e.server.provider ? serviceName(e.server.provider, language) : w.sub.noServer}`,
    dot: dot(`env:${e.id}`),
  }));
  return { main, envs, hist: { id: "hist", name: w.sections.hist, sub: w.sub.hist(r.history.length), dot: "off" } };
}

export function runsText(runs: CaminoRead["config"]["envs"][number]["runs"], language: Language = getLanguage()): string {
  const w = caminoWords(language).runs;
  switch (runs.kind) {
    case "branch":
      return w.branch(runs.branch);
    case "pr":
      return w.pr;
    case "promote":
      return w.promote(runs.from);
    case "tags":
      return w.tags(runs.pattern);
    default:
      return w.none;
  }
}

export type StripNode = { go: SectionId; title: string; sub: string; meta: string; dot: Sev | "off"; off: boolean };
export function strip(r: CaminoRead, F: Finding[], language: Language = getLanguage()): StripNode[] {
  const w = caminoWords(language);
  const g = gh(r);
  const pub = r.config.branches.published;
  const repo = r.settings.repo?.split("/")[1];
  const required = !!r.config.required_checks[pub]?.length || !!g?.rules.list.some((x) => x.enforcement === "active" && x.required_checks.length && x.branches.includes(pub));
  const nodes: StripNode[] = [
    { go: "codigo", title: w.strip.code, sub: repo ? `${repo} · ${w.models[r.config.model].toLowerCase()}` : w.strip.noRepo, meta: g ? (g.repo.private ? w.strip.private : w.strip.public) : "", dot: worst(F, "codigo"), off: false },
    { go: "ci", title: w.strip.tests, sub: g?.workflows.length ? g.workflows.map((x) => x.name).join(" · ") : w.strip.none, meta: required ? w.strip.required : w.strip.notRequired, dot: worst(F, "ci"), off: false },
  ];
  for (const e of r.config.envs) {
    const off = e.runs.kind === "none";
    nodes.push({
      go: `env:${e.id}`,
      title: e.name,
      sub: off ? w.strip.off : `${e.server.provider ? serviceName(e.server.provider, language) : w.sub.noServer}${e.database?.provider ? ` · ${serviceName(e.database.provider, language)}` : ""}`,
      meta: runsText(e.runs, language),
      dot: off ? "off" : worst(F, `env:${e.id}`),
      off,
    });
  }
  return nodes;
}

/** The setup list of a project that does not publish yet: each line done (✓), missing (○) or later (—). */
export type SetupItem = { mark: "✓" | "○" | "—"; title: string; sub: string; go: SectionId };
export function setupList(r: CaminoRead, language: Language = getLanguage()): SetupItem[] {
  const w = caminoWords(language);
  const g = gh(r);
  const c = r.config;
  return [
    { mark: r.settings.repo && g ? "✓" : "○", title: w.setup.repo, sub: r.settings.repo ?? w.setup.noneYet, go: "codigo" },
    { mark: c.source.branches === "default" ? "○" : "✓", title: w.setup.roles, sub: [c.branches.work_pattern, c.model === "integ" ? c.branches.integration : null, c.branches.published].filter(Boolean).join(" → "), go: "codigo" },
    { mark: g?.workflows.length ? "✓" : "○", title: w.setup.tests, sub: g?.workflows.length ? w.setup.onEach : w.setup.noneYet, go: "ci" },
    { mark: c.commits.convention ? "✓" : "○", title: w.setup.commits, sub: c.commits.convention ? words(COMMITS_PAGE_WORDS, language).conventions[c.commits.convention].name : w.setup.noConvention, go: "commits" },
    { mark: "—", title: w.setup.where, sub: w.setup.later, go: c.envs[0] ? `env:${c.envs[0].id}` : "resumen" },
  ];
}

/** Proposals grouped by the branch they go into: the published branch first, then integration, then the rest. */
export function proposalGroups(r: CaminoRead): { base: string | null; items: CaminoRead["proposals"] }[] {
  const order = [r.config.branches.published, r.config.branches.integration];
  const by = new Map<string | null, CaminoRead["proposals"]>();
  for (const p of r.proposals) by.set(p.base_branch, [...(by.get(p.base_branch) ?? []), p]);
  const rank = (b: string | null) => {
    const i = order.indexOf(b ?? "");
    return i < 0 ? (b ? 10 : 20) : i;
  };
  return [...by.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || String(a).localeCompare(String(b)))
    .map(([base, items]) => ({ base, items: [...items].sort((x, y) => Number(y.state === "open") - Number(x.state === "open") || y.updated_at.localeCompare(x.updated_at)) }));
}
