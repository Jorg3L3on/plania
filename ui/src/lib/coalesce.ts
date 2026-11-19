// NEWPROJ-5: runs `fn` once, `ms` after the first call of a burst; calls that arrive while it waits are folded in.
// La corriente's company read is the heaviest on the screen, and a working agent writes many changes in a row:
// each burst costs one refetch, not one per change. `cancel` drops a pending run.
export function coalesce(fn: () => void, ms: number): { (): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
  run.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return run;
}
