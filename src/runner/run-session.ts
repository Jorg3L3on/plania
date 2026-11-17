// PLA-I60-1: the Plania session id a runner run writes as. It was run-<first 8 hex of the run id> (32 bits: over
// ~100k runs two would collide and an actor would map to the wrong run). New runs use the first 16 hex of the id
// without dashes; the 8-hex form is still read for runs started before 0060.
export const runSession = (runId: string): string => `run-${runId.replace(/-/g, "").slice(0, 16)}`;
export const legacyRunSession = (runId: string): string => `run-${runId.slice(0, 8)}`;

const RUN_SESSION_RE = /^run-([0-9a-f]{16}|[0-9a-f]{8})$/;

export const isRunSession = (sessionId: string | null | undefined): boolean => RUN_SESSION_RE.test(sessionId ?? "");

// Both spellings a run may have written under (new first).
export const sessionsOf = (runId: string): string[] => [runSession(runId), legacyRunSession(runId)];

export const isSessionOf = (sessionId: string | null | undefined, runId: string): boolean => !!sessionId && sessionsOf(runId).includes(sessionId);

// The hex prefix of the run id a session names (8 or 16 hex, dashes removed), or null.
export const runPrefixOf = (sessionId: string | null | undefined): string | null => RUN_SESSION_RE.exec(sessionId ?? "")?.[1] ?? null;
