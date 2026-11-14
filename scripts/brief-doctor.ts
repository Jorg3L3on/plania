// PLA-I41-6: pnpm brief:doctor — the Morning brief setup check (spec §9). One ✓ or ✗ line per check, never a value.
// --skip-claude leaves out the short claude dry run (the only check that uses the plan). Exit 1 when a check fails.
import { parseArgs } from "node:util";
import { formatDoctor, runDoctor } from "../src/brief/doctor.js";
import { makeDb, resetPool } from "../src/db/client.js";

const { values } = parseArgs({ options: { "skip-claude": { type: "boolean", default: false } }, strict: true });
const db = process.env.DATABASE_URL ? makeDb().db : null;
const lines = await runDoctor(db, { skipClaudeRun: values["skip-claude"] });
console.log(formatDoctor(lines));
await resetPool().catch(() => undefined);
process.exit(lines.every((l) => l.ok) ? 0 : 1);
