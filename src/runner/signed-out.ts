// PLA-I2-12: a run that ends because Claude Code is signed out on this machine. Before this, the runner wrote
// "fail: no result" or "fail: success (1 turns)" and the screen said «sin resultado», so a stranger with a signed-out
// Claude saw nothing start and no reason. The brief already knew the failure (src/brief/claude.ts re-exports SIGN_IN
// from here); the runner, the brief and the machine check (src/machine-check/) now share one test.
import type { RunResult } from "./stream.js";

/** Claude's own sign-in failures ("Failed to authenticate", "OAuth session expired", "Not logged in · Please run /login"). */
export const SIGN_IN = /authenticat|oauth|\/login|log ?in|not signed in|credential|invalid api key|\b401\b/i;

/** The run summary's reason; ui/src/lib/calidad.ts words it, src/runner/start-failures.ts lists it. */
export const SIGNED_OUT = "signed out";

/**
 * A signed-out Claude answers with an error result before any work: at most one turn and no model usage. The turn and
 * usage guard keeps a real run whose last words mention a login page (an agent building one) from reading as this.
 */
export function isSignedOut(result: Pick<RunResult, "isError" | "numTurns" | "hasModelUsage" | "resultText"> | null, stderr = ""): boolean {
  if (!result) return SIGN_IN.test(stderr);
  if (!result.isError || result.numTurns > 1 || result.hasModelUsage) return false;
  return SIGN_IN.test(`${result.resultText ?? ""} ${stderr}`);
}
