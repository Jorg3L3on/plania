// PLA-I48: errors of the Máquinas routes. These are screen-only routes (session cookie), not MCP tools, so their
// codes live here instead of the MCP contract catalog (src/mcp/errors.ts). hint is Spanish, shown on the floor.
export const MAQUINA_ERRORS = {
  BASE_NOT_FOUND: 404, // the app's env names no Postgres base
  BASE_NOT_LOCAL: 403, // a host that is not 127.0.0.1, localhost or ::1
  BASE_REGISTERED: 403, // Plania's own base, or one an environment (env_states) has registered
  BASE_UNREACHABLE: 503, // the base does not answer (off)
  BASE_READ_FAILED: 500,
  BASE_LEVER_REFUSED: 403, // not a brew service on this machine, or Plania's own Postgres
  TABLE_NOT_FOUND: 404,
  ROW_COUNT_CHANGED: 409, // Vaciar y sembrar with a count that no longer matches
  NOT_CONFIGURED: 400, // the floor lacks the settings or the commands this needs
  NO_TEST_COPY: 409, // the test copy's worktree does not exist yet
  TESTS_RUNNING: 409,
  NOT_A_TEST_USER: 403, // a user outside the reserved test domains
  COMMAND_FAILED: 500,
  // PLA-116: Poner una llave.
  KEY_NOT_LISTED: 400, // a name Llaves does not list for this app
  VALUE_NOT_WRITABLE: 400, // empty, more than one line, too long, or quotes an env file cannot hold
  ENV_FILE_TRACKED: 409, // the env file is in git: a value there would be committed
  NO_APP_DIR: 409, // neither the test copy nor the repo checkout exists on this machine
  // PLA-I72-1: the copies.
  COPY_NOT_FOUND: 404, // no start copy or open initiative by that id
  COPY_NOT_DELETABLE: 403, // Borrar on the start copy
  BASE_PROTECTED: 403, // a name that is the app's base or the start copy's
  INITIATIVE_CLOSED: 409, // Encender on a Done or Won't do initiative
  NO_BRANCH: 409, // the initiative has neither an integration branch nor a base branch
  // PLA-I72-3: Sobrantes.
  LEFTOVER_NOT_FOUND: 404, // no longer on the list
  LEFTOVERS_CHANGED: 409, // Borrar todo with a total that no longer matches the list
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
