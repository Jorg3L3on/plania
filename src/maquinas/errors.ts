// PLA-I48: errors of the Máquinas routes. These are screen-only routes (session cookie), not MCP tools, so their
// codes live here instead of the MCP contract catalog (src/mcp/errors.ts). hint is Spanish, shown on the floor.
export const MAQUINA_ERRORS = {
  BASE_NOT_FOUND: 404, // the app's env names no Postgres base
  BASE_NOT_LOCAL: 403, // a host that is not 127.0.0.1, localhost or ::1
  BASE_REGISTERED: 403, // Plania's own base, or one an environment (env_states) has registered
  BASE_UNREACHABLE: 503, // the base does not answer (off)
  BASE_READ_FAILED: 500,
  BASE_LEVER_REFUSED: 403, // not a brew service on this Mac, or Plania's own Postgres
  TABLE_NOT_FOUND: 404,
  ROW_COUNT_CHANGED: 409, // Vaciar y sembrar with a count that no longer matches
  NOT_CONFIGURED: 400, // the floor lacks the settings or the commands this needs
  NO_TEST_COPY: 409, // the test copy's worktree does not exist yet
  TESTS_RUNNING: 409,
  NOT_A_TEST_USER: 403, // a user outside the reserved test domains
  COMMAND_FAILED: 500,
} as const;
export type MaquinaCode = keyof typeof MAQUINA_ERRORS;

export class MaquinaError extends Error {
  constructor(
    readonly code: MaquinaCode,
    readonly hint: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(`${code}: ${hint}`);
  }
  get status() {
    return MAQUINA_ERRORS[this.code];
  }
}
