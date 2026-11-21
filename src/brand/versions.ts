// PLA-130: how Estilo and Voz keep versions. Every change still saves at once, but a change made shortly after the
// last one updates that version instead of adding one, so trying ten colours is one version, not ten. A version the
// owner went back to, or one sent to Taller, is kept: never merged into and never the one dropped at the cap.

/** A change this soon after the last one joins it… */
export const QUIET_MS = 2 * 60_000;
/** …while that version has been open for less than this. */
export const SESSION_MS = 15 * 60_000;
/** Versions kept per project and lane; kept ones go last. */
export const MAX_VERSIONS = 60;

export type Versioned = { v: number; at: string; from?: string; keep?: boolean };
export type VersionFile<T extends Versioned> = { current: number; versions: T[] };

// Tests inject the clock, as everywhere in Plania.
let clock: () => number = () => Date.now();
export const setVersionClock = (f: (() => number) | null): void => {
  clock = f ?? (() => Date.now());
};

/** Records a new value: joins the current version when it is recent, unkept and the newest, otherwise adds one. */
export function record<T extends Versioned>(f: VersionFile<T>, make: (base: Versioned) => T, opts: { keep?: boolean; now?: number } = {}): VersionFile<T> {
  const now = opts.now ?? clock();
  const at = new Date(now).toISOString();
  const newest = Math.max(0, ...f.versions.map((x) => x.v));
  const last = f.versions.find((x) => x.v === f.current);
  const joins = !opts.keep && last && !last.keep && last.v === newest && now - Date.parse(last.at) < QUIET_MS && now - Date.parse(last.from ?? last.at) < SESSION_MS;
  if (joins) {
    const merged = make({ v: last.v, at, from: last.from ?? last.at });
    f.versions = f.versions.map((x) => (x.v === last.v ? merged : x));
    return f;
  }
  const v = newest + 1;
  f.versions.push(make({ v, at, from: at, ...(opts.keep ? { keep: true } : {}) }));
  f.current = v;
  while (f.versions.length > MAX_VERSIONS) {
    const drop = f.versions.findIndex((x) => !x.keep && x.v !== f.current);
    f.versions.splice(drop === -1 ? 0 : drop, 1);
  }
  return f;
}

/** Marks the current version as kept (it went to Taller). */
export function keepCurrent<T extends Versioned>(f: VersionFile<T>): VersionFile<T> {
  f.versions = f.versions.map((x) => (x.v === f.current ? { ...x, keep: true } : x));
  return f;
}
