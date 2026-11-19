// PLA-I2-3: the one place the server reads its time zone and locale from. Nothing here names a place.
//   time zone   PLANIA_TZ, which first start fills from the zone the owner's browser sent (src/install-state.ts
//               copies install_state.time_zone into it at load); UTC when neither is set.
//   locale      PLANIA_LOCALE, else the Spanish the screen's wording is written in (es-MX: "." for decimals).
// The screen has its twin in ui/src/lib/locale.ts.

export const FALLBACK_TZ = "UTC";
export const FALLBACK_LOCALE = "es-MX";

/** The zone days and hours are counted in. */
export const screenTz = (env: NodeJS.ProcessEnv = process.env): string => env.PLANIA_TZ?.trim() || FALLBACK_TZ;

/** The locale numbers and dates are written in. */
export const screenLocale = (env: NodeJS.ProcessEnv = process.env): string => env.PLANIA_LOCALE?.trim() || FALLBACK_LOCALE;
