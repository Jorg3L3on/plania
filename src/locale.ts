// PLA-I2-3: the one place the server reads its time zone and locale from. Nothing here names a place.
//   time zone   PLANIA_TZ, which first start fills from the zone the owner's browser sent (src/install-state.ts
//               copies install_state.time_zone into it at load); UTC when neither is set.
//   locale      PLANIA_LOCALE, else the install's language's own (PLA-I2-10, src/language.ts): es-MX ("." for
//               decimals) for Spanish, en-US for English.
// The screen has its twin in ui/src/lib/locale.ts.
import { installLanguage } from "./language.js";
import { FALLBACK_LOCALES } from "../ui/src/lib/locale.js";

export const FALLBACK_TZ = "UTC";
export const FALLBACK_LOCALE = FALLBACK_LOCALES.es;

/** The zone days and hours are counted in. */
export const screenTz = (env: NodeJS.ProcessEnv = process.env): string => env.PLANIA_TZ?.trim() || FALLBACK_TZ;

/** The locale numbers and dates are written in. */
export const screenLocale = (env: NodeJS.ProcessEnv = process.env): string => env.PLANIA_LOCALE?.trim() || FALLBACK_LOCALES[installLanguage(env)];
