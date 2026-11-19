// PLA-I2-2: a retry limit for the password (login) and the one-time setup code (first start). Ten wrong tries
// inside a minute and the next one is refused, right or wrong, until the oldest of the ten is a minute old.
// In memory: Plania is one process on one machine, and a restart only gives back the same ten tries.
// One bucket per door, not per address: behind tailscale serve every request comes from 127.0.0.1.
export const LIMIT_TRIES = 10;
export const LIMIT_WINDOW_MS = 60_000;

export const limitClock = { now: (): number => Date.now() };

const failures = new Map<string, number[]>();

function recent(door: string, now: number): number[] {
  const list = (failures.get(door) ?? []).filter((t) => now - t < LIMIT_WINDOW_MS);
  failures.set(door, list);
  return list;
}

/** Seconds to wait before the next try, or null when a try is allowed now. */
export function waitSeconds(door: string, now = limitClock.now()): number | null {
  const list = recent(door, now);
  if (list.length < LIMIT_TRIES) return null;
  return Math.max(1, Math.ceil((list[0]! + LIMIT_WINDOW_MS - now) / 1000));
}

export function noteFailure(door: string, now = limitClock.now()): void {
  recent(door, now).push(now);
}

export function clearFailures(door: string): void {
  failures.delete(door);
}

/** Tests. */
export function resetLimits(): void {
  failures.clear();
}
