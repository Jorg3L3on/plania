// PLA-82 (F-32): a release that carries database changes says so, and who migrates the app's own database.
// PLA-I2-10: its words in both languages.
// PLA-I68-1: two different databases, said apart. The copy Plania migrates is the local test copy, never production;
// production is migrated by whoever settings.release.prod_migrations names, and with nobody named Publicar waits.
import { envFocus } from "./camino-entornos.js";
import { defineWords, getLanguage, words, type Language } from "./i18n.js";

export type ProdMigrations = "deploy" | "owner" | "none";

export const PUBLICAR_WORDS = defineWords({
  es: {
    andMore: (shown: string, more: number) => `${shown} y ${more} más`,
    carries: (n: number, list: string) => `Lleva ${n === 1 ? "un cambio" : `${n} cambios`} a la base de datos (${list}).`,
    copy: (title: string) => `Al publicar, Plania respalda la copia de prueba de ${title} en esta computadora y la migra.`,
    prod: {
      deploy: "En producción, el despliegue corre las migraciones.",
      owner: "En producción las corres tú después de publicar.",
      none: "Este proyecto no tiene base en producción que migrar.",
    } as Record<ProdMigrations, string>,
    prodUnset: (title: string) => `Nadie dijo quién migra la base de producción de ${title}: Publicar espera hasta que lo digas.`,
    waitTitle: "Publicar espera",
    waitWhy: "Lleva cambios a la base y nadie dijo quién migra producción.",
    setIt: "Decir quién migra",
    pickDb: (env: string) => `Elige la base de datos de ${env}`,
    pickDbWhy: (env: string) => `Falta un dato: la base de datos de ${env}. Con ella, Plania sabe quién migra.`,
    options: {
      deploy: { label: "El despliegue", hint: "El servicio que publica la app corre las migraciones antes de recibir tráfico." },
      owner: { label: "Yo, a mano", hint: "Tú corres las migraciones en producción después de publicar." },
      none: { label: "No hay base en producción", hint: "La app publicada no usa una base que migrar." },
    } as Record<ProdMigrations, { label: string; hint: string }>,
    unsetOption: "Sin decir (Publicar espera si lleva migraciones)",
    field: "Quién migra la base de producción",
  },
  en: {
    andMore: (shown: string, more: number) => `${shown} and ${more} more`,
    carries: (n: number, list: string) => `Carries ${n === 1 ? "one change" : `${n} changes`} to the database (${list}).`,
    copy: (title: string) => `On release, Plania backs up ${title}'s test copy on this computer and migrates it.`,
    prod: {
      deploy: "In production, the deploy runs the migrations.",
      owner: "In production you run them after releasing.",
      none: "This project has no production database to migrate.",
    } as Record<ProdMigrations, string>,
    prodUnset: (title: string) => `Nobody said who migrates ${title}'s production database: Release waits until you say.`,
    waitTitle: "Release waits",
    waitWhy: "It carries database changes and nobody said who migrates production.",
    setIt: "Say who migrates",
    pickDb: (env: string) => `Pick ${env}'s database`,
    pickDbWhy: (env: string) => `One thing is missing: ${env}'s database. With it, Plania knows who migrates.`,
    options: {
      deploy: { label: "The deploy", hint: "The service that publishes the app runs the migrations before taking traffic." },
      owner: { label: "Me, by hand", hint: "You run the migrations in production after releasing." },
      none: { label: "No production database", hint: "The released app uses no database to migrate." },
    } as Record<ProdMigrations, { label: string; hint: string }>,
    unsetOption: "Not said (Release waits if it carries migrations)",
    field: "Who migrates the production database",
  },
});

export const publicarWords = (language: Language = getLanguage()) => words(PUBLICAR_WORDS, language);

/** The release carries migrations and nobody is named to migrate production: Publicar waits. */
export const prodWaits = (r: { migrations?: string[]; prod_migrations?: ProdMigrations | null } | null | undefined): boolean =>
  !!r?.migrations?.length && !r.prod_migrations;

/** PLA-158 (F-25): where «Decir quién migra» goes and what it says. With Camino's production environment it opens that
 * environment on the field that is missing (the database's service), else the older Ajustes setting. */
export function prodFixLink(r: { prod_fix?: { env: string; name: string; missing: "provider" | null } | null } | null | undefined, language: Language = getLanguage()): { label: string; why: string | null; env: string | null; focus: string | null } {
  const w = words(PUBLICAR_WORDS, language);
  const f = r?.prod_fix;
  if (!f) return { label: w.setIt, why: null, env: null, focus: null };
  if (f.missing === "provider") return { label: w.pickDb(f.name), why: w.pickDbWhy(f.name), env: f.env, focus: envFocus(f.env, "base") };
  return { label: w.setIt, why: null, env: f.env, focus: envFocus(f.env, "cuando") };
}

/** What the sheet says about the database: what the release carries, the local test copy (only when Plania has one),
 * and production, always on its own line of meaning. Never says production is migrated when only the copy is. */
export function migrationLine(files: string[], how: "auto" | "manual" | null, title: string, language: Language = getLanguage(), prod: ProdMigrations | null = null): string {
  const w = words(PUBLICAR_WORDS, language);
  const list = files.length > 3 ? w.andMore(files.slice(0, 3).join(", "), files.length - 3) : files.join(", ");
  const parts = [w.carries(files.length, list)];
  if (how === "auto") parts.push(w.copy(title));
  parts.push(prod ? w.prod[prod] : w.prodUnset(title));
  return parts.join(" ");
}
