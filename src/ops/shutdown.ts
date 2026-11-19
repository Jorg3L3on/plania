// PLA-111 (guided test PLA-86, F-39): `launchctl kickstart -k` (pnpm server:restart) sends SIGTERM, and the server
// exited at once, so a request in flight was cut: an owner's «Aceptar» (a GitHub merge) vanished in the restart.
// On a signal the HTTP server stops taking connections, lets the requests it has finish (up to DRAIN_MS) and then
// the process exits.
type Closable = { close(cb?: (err?: Error) => void): unknown; closeIdleConnections?(): void };

export const DRAIN_MS = 15_000;
let server: Closable | null = null;
let exiting = false;

export function setHttpServer(s: Closable | null): void {
  server = s;
}

export function exitAfterDrain(code: number, deps: { exit?: (code: number) => void; ms?: number } = {}): void {
  if (exiting) return;
  exiting = true;
  const exit = deps.exit ?? ((c: number) => process.exit(c));
  if (!server) return exit(code);
  let gone = false;
  const done = () => {
    if (gone) return;
    gone = true;
    exit(code);
  };
  const timer = setTimeout(done, deps.ms ?? DRAIN_MS);
  timer.unref?.();
  server.close(() => {
    clearTimeout(timer);
    done();
  });
  server.closeIdleConnections?.();
}

// PLA-I2-19 (audit B5): Windows has no SIGTERM. The Windows service's supervisor (src/packaging/win-supervisor.ts)
// starts the server with an IPC channel and sends this message instead; the channel closing (the supervisor ended)
// counts the same, so the server never outlives it.
export const SHUTDOWN_MESSAGE = "plania:shutdown";
export function drainOnParentRequest(proc: Pick<NodeJS.Process, "send" | "on"> = process, onDrain: () => void = () => exitAfterDrain(143)): boolean {
  if (!proc.send) return false;
  proc.on("message", (m: unknown) => {
    if ((m as { type?: unknown } | null)?.type === SHUTDOWN_MESSAGE) onDrain();
  });
  proc.on("disconnect", () => onDrain());
  return true;
}

/** Tests only: forget an earlier exit. */
export function resetShutdown(): void {
  exiting = false;
  server = null;
}
