// PLA-I2-7: run isolation is on for a new install and unchanged for an existing one.
//
// The runner reads PLANIA_RUN_ISOLATION (isolationOf in runner.ts): "project" loads no user-level Claude settings,
// skills or CLAUDE.md of the account the server runs as. That limits what a run picks up from the account; it is not
// a barrier: a run still reads any file its user can.
//
// A new install is one whose settings file did not exist yet: the install command (src/db/install.ts writeSettings)
// writes these values only when it creates .env, so the owner's existing install keeps today's behaviour unless the owner
// sets the variable. First start (PLA-I2-2), if it ever writes a new settings file of its own, calls
// newInstallSettings() for the same values. To turn isolation off on a new install: PLANIA_RUN_ISOLATION=off.

export const NEW_INSTALL_ISOLATION = "project";

/** The settings a new install starts with, as .env keys and values. */
export const newInstallSettings = (): Record<string, string> => ({ PLANIA_RUN_ISOLATION: NEW_INSTALL_ISOLATION });
