// PLA-I2-12: pnpm machine:check — what this machine lacks to run Plania, one line per item with its fix.
// Exit 1 when a required item is missing. --json prints the items as the screen reads them (GET /api/machine-check).
// It runs one short `claude -p` to tell whether Claude is signed in.
import { parseArgs } from "node:util";
import { followSystemLocale } from "../src/language.js";
import { blocking, formatMachineCheck, machineCheck } from "../src/machine-check/index.js";

const { values } = parseArgs({ options: { json: { type: "boolean", default: false } }, strict: true });
// P4: until a language is chosen, the system's locale.
followSystemLocale();
const items = await machineCheck();
console.log(values.json ? JSON.stringify({ items }, null, 2) : formatMachineCheck(items));
process.exit(blocking(items).length ? 1 : 0);
